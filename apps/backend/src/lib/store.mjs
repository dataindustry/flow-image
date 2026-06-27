import path from "node:path";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { DEFAULT_TTL_HOURS } from "./config.mjs";
import { hashCredential, isValidPairCode, normalizePairCode } from "./auth.mjs";
import {
  makeAnnotationId,
  makePairCode,
  makePairDeviceId,
  makePairDeviceToken,
  makePairId,
  makeScreenshotId,
  makeSessionId,
  makeSessionSecret
} from "./ids.mjs";

const PUBLIC_PAIR_TTL_HOURS = 24 * 7;

export class SessionStore {
  constructor({ dataDir, publicBaseUrl, now }) {
    this.dataDir = dataDir;
    this.publicBaseUrl = publicBaseUrl;
    this.now = now;
  }

  sessionDir(sessionId) {
    return path.join(this.dataDir, sessionId);
  }

  pairsDir() {
    return path.join(this.dataDir, "pairs");
  }

  pairDir(pairId) {
    return path.join(this.pairsDir(), pairId);
  }

  pairJsonPath(pairId) {
    return path.join(this.pairDir(pairId), "pair.json");
  }

  pairDevicesDir(pairId) {
    return path.join(this.pairDir(pairId), "devices");
  }

  pairDeviceJsonPath(pairId, deviceId) {
    return path.join(this.pairDevicesDir(pairId), `${deviceId}.json`);
  }

  pairSessionsDir(pairId) {
    return path.join(this.pairDir(pairId), "sessions");
  }

  pairSessionDir(pairId, sessionId) {
    return path.join(this.pairSessionsDir(pairId), sessionId);
  }

  sessionDirFor(session) {
    if (session.pair_id) return this.pairSessionDir(session.pair_id, session.session_id);
    return this.sessionDir(session.session_id);
  }

  sessionJsonPath(sessionId) {
    return path.join(this.sessionDir(sessionId), "session.json");
  }

  sessionJsonPathFor(session) {
    return path.join(this.sessionDirFor(session), "session.json");
  }

  async createSession({ title, pairId }) {
    const createdAt = this.now();
    const ttlHours = pairId ? PUBLIC_PAIR_TTL_HOURS : DEFAULT_TTL_HOURS;
    const expiresAt = new Date(createdAt.getTime() + ttlHours * 60 * 60 * 1000);
    const sessionId = makeSessionId(createdAt);
    const sessionSecret = makeSessionSecret();
    const session = {
      session_id: sessionId,
      title,
      viewer_url: pairId
        ? `${this.publicBaseUrl}/s/${sessionId}`
        : `${this.publicBaseUrl}/s/${sessionId}?secret=${sessionSecret}`,
      ...(pairId ? { pair_id: pairId, status: "pending_annotation" } : { session_secret: sessionSecret }),
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      screenshots: [],
      annotations: []
    };

    await mkdir(path.join(this.sessionDirFor(session), "screenshots"), { recursive: true });
    await mkdir(path.join(this.sessionDirFor(session), "annotations"), { recursive: true });
    await this.saveSession(session);
    return session;
  }

  async getSession(sessionId) {
    try {
      const raw = await readFile(this.sessionJsonPath(sessionId), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async saveSession(session) {
    await mkdir(this.sessionDirFor(session), { recursive: true });
    await writeFile(this.sessionJsonPathFor(session), JSON.stringify(session, null, 2));
  }

  screenshotPath(session, screenshotId) {
    return path.join(this.sessionDirFor(session), "screenshots", `${screenshotId}.png`);
  }

  annotationPath(session, screenshotId) {
    return path.join(this.sessionDirFor(session), "annotations", `${screenshotId}-merged.png`);
  }

  async addScreenshots(session, files) {
    const items = [];
    for (const file of files) {
      const pageIndex = session.screenshots.length + 1;
      const screenshotId = makeScreenshotId(pageIndex);
      const imageUrl = `/files/sessions/${session.session_id}/screenshots/${screenshotId}.png`;
      await writeFile(this.screenshotPath(session, screenshotId), file.buffer);
      const item = {
        screenshot_id: screenshotId,
        page_index: pageIndex,
        label: file.label ?? "",
        image_url: imageUrl,
        width: file.width,
        height: file.height
      };
      session.screenshots.push(item);
      items.push(item);
    }
    await this.saveSession(session);
    return items;
  }

  async saveMergedAnnotation(session, screenshotId, buffer) {
    const screenshot = session.screenshots.find((item) => item.screenshot_id === screenshotId);
    if (!screenshot) return null;

    await writeFile(this.annotationPath(session, screenshotId), buffer);
    const existingIndex = session.annotations.findIndex((item) => item.screenshot_id === screenshotId);
    const annotation = {
      annotation_id: existingIndex >= 0 ? session.annotations[existingIndex].annotation_id : makeAnnotationId(session.annotations.length + 1),
      screenshot_id: screenshotId,
      page_index: screenshot.page_index,
      merged_png_url: `/files/sessions/${session.session_id}/annotations/${screenshotId}-merged.png`,
      merged_png_path: this.annotationPath(session, screenshotId),
      updated_at: this.now().toISOString()
    };

    if (existingIndex >= 0) {
      session.annotations[existingIndex] = annotation;
    } else {
      session.annotations.push(annotation);
    }
    session.updated_at = annotation.updated_at;
    if (session.pair_id) {
      session.status =
        session.annotations.length >= session.screenshots.length ? "returned" : "partially_returned";
      this.refreshPairSessionExpiry(session);
    }
    await this.saveSession(session);
    return annotation;
  }

  isExpired(session) {
    return new Date(session.expires_at).getTime() <= this.now().getTime();
  }

  refreshPairSessionExpiry(session) {
    if (!session.pair_id) return;
    const now = this.now();
    session.updated_at = now.toISOString();
    session.expires_at = new Date(now.getTime() + PUBLIC_PAIR_TTL_HOURS * 60 * 60 * 1000).toISOString();
  }

  async createPair({ label = "" } = {}) {
    const createdAt = this.now();
    const pairId = makePairId(createdAt);
    const pairCode = makePairCode();
    const deviceToken = makePairDeviceToken();
    const deviceId = makePairDeviceId(createdAt);
    const pair = {
      pair_id: pairId,
      pair_code_hash: hashCredential(normalizePairCode(pairCode)),
      created_at: createdAt.toISOString(),
      last_seen_at: createdAt.toISOString(),
      revoked_at: null,
      display_name: String(label ?? "").slice(0, 120)
    };
    const device = {
      device_id: deviceId,
      pair_id: pairId,
      device_token_hash: hashCredential(deviceToken),
      created_at: createdAt.toISOString(),
      last_seen_at: createdAt.toISOString(),
      revoked_at: null,
      label: String(label ?? "").slice(0, 120)
    };

    await mkdir(this.pairDevicesDir(pairId), { recursive: true });
    await mkdir(this.pairSessionsDir(pairId), { recursive: true });
    await writeFile(this.pairJsonPath(pairId), JSON.stringify(pair, null, 2));
    await writeFile(this.pairDeviceJsonPath(pairId, deviceId), JSON.stringify(device, null, 2));
    return { pair, pair_code: pairCode, pair_device_token: deviceToken };
  }

  async getPair(pairId) {
    try {
      const raw = await readFile(this.pairJsonPath(pairId), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async savePair(pair) {
    await writeFile(this.pairJsonPath(pair.pair_id), JSON.stringify(pair, null, 2));
  }

  async listPairs() {
    try {
      return await readdir(this.pairsDir());
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async getPairForCode(pairCode) {
    const normalized = normalizePairCode(pairCode);
    if (!isValidPairCode(normalized)) return null;
    const targetHash = hashCredential(normalized);
    for (const pairId of await this.listPairs()) {
      const pair = await this.getPair(pairId);
      if (pair && !pair.revoked_at && pair.pair_code_hash === targetHash) return pair;
    }
    return null;
  }

  async listDevices(pairId) {
    try {
      const names = await readdir(this.pairDevicesDir(pairId));
      const devices = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        devices.push(JSON.parse(await readFile(path.join(this.pairDevicesDir(pairId), name), "utf8")));
      }
      return devices;
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async getPairForDeviceToken(deviceToken) {
    const targetHash = hashCredential(deviceToken);
    for (const pairId of await this.listPairs()) {
      const pair = await this.getPair(pairId);
      if (!pair || pair.revoked_at) continue;
      for (const device of await this.listDevices(pairId)) {
        if (!device.revoked_at && device.device_token_hash === targetHash) {
          return { pair, device };
        }
      }
    }
    return null;
  }

  async bindDeviceByPairCode({ pairCode, label = "" }) {
    const pair = await this.getPairForCode(pairCode);
    if (!pair) return null;
    const now = this.now();
    const deviceToken = makePairDeviceToken();
    const deviceId = makePairDeviceId(now);
    const device = {
      device_id: deviceId,
      pair_id: pair.pair_id,
      device_token_hash: hashCredential(deviceToken),
      created_at: now.toISOString(),
      last_seen_at: now.toISOString(),
      revoked_at: null,
      label: String(label ?? "").slice(0, 120)
    };
    pair.last_seen_at = now.toISOString();
    await this.savePair(pair);
    await writeFile(this.pairDeviceJsonPath(pair.pair_id, deviceId), JSON.stringify(device, null, 2));
    return { pair, pair_device_token: deviceToken };
  }

  async rotatePairCode({ deviceToken }) {
    const resolved = await this.getPairForDeviceToken(deviceToken);
    if (!resolved) return null;
    const now = this.now();
    const pairCode = makePairCode();
    resolved.pair.pair_code_hash = hashCredential(normalizePairCode(pairCode));
    resolved.pair.last_seen_at = now.toISOString();
    await this.savePair(resolved.pair);
    for (const device of await this.listDevices(resolved.pair.pair_id)) {
      if (device.device_id === resolved.device.device_id) continue;
      if (!device.revoked_at) {
        device.revoked_at = now.toISOString();
        await writeFile(
          this.pairDeviceJsonPath(resolved.pair.pair_id, device.device_id),
          JSON.stringify(device, null, 2)
        );
      }
    }
    return { pair: resolved.pair, pair_code: pairCode };
  }

  async listSessionsForPair(pairId) {
    try {
      const sessionIds = await readdir(this.pairSessionsDir(pairId));
      const sessions = [];
      for (const sessionId of sessionIds) {
        const session = await this.getPairSession(pairId, sessionId);
        if (session) sessions.push(session);
      }
      return sessions.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
    } catch (error) {
      if (error.code === "ENOENT") return [];
      throw error;
    }
  }

  async getPairSession(pairId, sessionId) {
    try {
      const raw = await readFile(path.join(this.pairSessionDir(pairId, sessionId), "session.json"), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }
}

export function publicSession(session) {
  return {
    session_id: session.session_id,
    title: session.title,
    viewer_url: session.viewer_url,
    expires_at: session.expires_at,
    screenshots: session.screenshots,
    annotations: session.annotations
  };
}
