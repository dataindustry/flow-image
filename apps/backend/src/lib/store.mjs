import path from "node:path";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { DEFAULT_TTL_HOURS } from "./config.mjs";
import { makeSessionId, makeSessionSecret } from "./ids.mjs";

export class SessionStore {
  constructor({ dataDir, publicBaseUrl, now }) {
    this.dataDir = dataDir;
    this.publicBaseUrl = publicBaseUrl;
    this.now = now;
  }

  sessionDir(sessionId) {
    return path.join(this.dataDir, sessionId);
  }

  sessionJsonPath(sessionId) {
    return path.join(this.sessionDir(sessionId), "session.json");
  }

  async createSession({ title }) {
    const createdAt = this.now();
    const expiresAt = new Date(createdAt.getTime() + DEFAULT_TTL_HOURS * 60 * 60 * 1000);
    const sessionId = makeSessionId(createdAt);
    const sessionSecret = makeSessionSecret();
    const session = {
      session_id: sessionId,
      session_secret: sessionSecret,
      title,
      viewer_url: `${this.publicBaseUrl}/s/${sessionId}?secret=${sessionSecret}`,
      created_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      screenshots: [],
      annotations: []
    };

    await mkdir(path.join(this.sessionDir(sessionId), "screenshots"), { recursive: true });
    await mkdir(path.join(this.sessionDir(sessionId), "annotations"), { recursive: true });
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
    await mkdir(this.sessionDir(session.session_id), { recursive: true });
    await writeFile(this.sessionJsonPath(session.session_id), JSON.stringify(session, null, 2));
  }

  isExpired(session) {
    return new Date(session.expires_at).getTime() <= this.now().getTime();
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
