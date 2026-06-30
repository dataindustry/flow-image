import path from "node:path";
import { mkdirSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import Database from "better-sqlite3";
import { hashCredential } from "./auth.mjs";
import { createBlankPng } from "./png.mjs";
import {
  makeAnnotationId,
  makeEditToken,
  makeOwnerToken,
  makeScreenshotId,
  makeSessionId,
  makeViewToken
} from "./ids.mjs";

export const DEFAULT_RETENTION_HOURS = 24 * 7;
export const MAX_RETENTION_HOURS = 24 * 30;

export class SessionStore {
  constructor({ dataDir, publicBaseUrl, now }) {
    this.dataDir = dataDir;
    this.publicBaseUrl = publicBaseUrl;
    this.now = now;
    mkdirSync(dataDir, { recursive: true });
    this.db = new Database(path.join(dataDir, "flowimage.sqlite"));
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        session_id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        view_token TEXT,
        edit_token TEXT,
        owner_token TEXT,
        view_token_hash TEXT NOT NULL,
        edit_token_hash TEXT NOT NULL,
        owner_token_hash TEXT NOT NULL,
        idempotency_key_hash TEXT,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        retention_hours INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS screenshots (
        session_id TEXT NOT NULL,
        screenshot_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        label TEXT NOT NULL,
        image_url TEXT NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, screenshot_id),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS results (
        session_id TEXT NOT NULL,
        screenshot_id TEXT NOT NULL,
        annotation_id TEXT NOT NULL,
        page_index INTEGER NOT NULL,
        merged_png_url TEXT NOT NULL,
        revision INTEGER NOT NULL,
        width INTEGER NOT NULL,
        height INTEGER NOT NULL,
        byte_size INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (session_id, screenshot_id),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket_key TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0,
        reset_at INTEGER NOT NULL
      );

    `);
    this.ensureSessionColumn("view_token", "TEXT");
    this.ensureSessionColumn("edit_token", "TEXT");
    this.ensureSessionColumn("owner_token", "TEXT");
    this.ensureSessionColumn("idempotency_key_hash", "TEXT");
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_idempotency_key_hash
        ON sessions(idempotency_key_hash)
        WHERE idempotency_key_hash IS NOT NULL;
    `);
  }

  ensureSessionColumn(name, type) {
    const exists = this.db
      .prepare("PRAGMA table_info(sessions)")
      .all()
      .some((column) => column.name === name);
    if (!exists) {
      this.db.prepare(`ALTER TABLE sessions ADD COLUMN ${name} ${type}`).run();
    }
  }

  sessionsDir() {
    return path.join(this.dataDir, "files", "sessions");
  }

  sessionDir(sessionId) {
    return path.join(this.sessionsDir(), sessionId);
  }

  sessionDirFor(session) {
    return this.sessionDir(session.session_id);
  }

  shareUrl(mode, sessionIdOrToken, maybeToken) {
    const token = maybeToken ?? sessionIdOrToken;
    const routeMode = mode === "view" ? "v" : mode === "edit" ? "e" : "o";
    return `${this.publicBaseUrl}/${routeMode}/${token}`;
  }

  ownerUrl(sessionId, ownerToken) {
    return this.shareUrl("owner", sessionId, ownerToken);
  }

  async createSession({
    title,
    retentionHours = DEFAULT_RETENTION_HOURS,
    defaultPage,
    idempotencyKey
  }) {
    await this.cleanupExpiredSessions();
    const idempotencyKeyHash = idempotencyKey ? hashCredential(idempotencyKey) : null;
    if (idempotencyKeyHash) {
      const existing = await this.getSessionByIdempotencyKeyHash(idempotencyKeyHash);
      if (existing && !this.isExpired(existing)) {
        return this.sessionCreationResult(existing);
      }
    }

    const createdAt = this.now();
    const sessionId = makeSessionId(createdAt);
    const viewToken = makeViewToken();
    const editToken = makeEditToken();
    const ownerToken = makeOwnerToken();
    const normalizedRetention = normalizeRetentionHours(retentionHours);
    const expiresAt = addHours(createdAt, normalizedRetention);
    const session = {
      session_id: sessionId,
      title,
      view_token: viewToken,
      edit_token: editToken,
      owner_token: ownerToken,
      view_token_hash: hashCredential(viewToken),
      edit_token_hash: hashCredential(editToken),
      owner_token_hash: hashCredential(ownerToken),
      idempotency_key_hash: idempotencyKeyHash,
      status: "pending_result",
      created_at: createdAt.toISOString(),
      updated_at: createdAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      retention_hours: normalizedRetention,
      screenshots: [],
      annotations: []
    };
    session.public_base_url = this.publicBaseUrl;

    await mkdir(path.join(this.sessionDirFor(session), "screenshots"), { recursive: true });
    await mkdir(path.join(this.sessionDirFor(session), "annotations"), { recursive: true });
    await this.saveSession(session);
    if (defaultPage === "blank_grid") {
      await this.addScreenshots(session, [
        {
          buffer: createBlankPng(1440, 900),
          label: "Blank canvas",
          width: 1440,
          height: 900
        }
      ]);
    }
    return this.sessionCreationResult(session);
  }

  sessionCreationResult(session) {
    const viewToken = session.view_token;
    const editToken = session.edit_token;
    const ownerToken = session.owner_token;
    const viewUrl = this.shareUrl("view", session.session_id, viewToken);
    const editUrl = this.shareUrl("edit", session.session_id, editToken);
    return {
      session,
      view_token: viewToken,
      edit_token: editToken,
      owner_token: ownerToken,
      view_url: viewUrl,
      edit_url: editUrl,
      owner_url: this.ownerUrl(session.session_id, ownerToken)
    };
  }

  async saveSession(session) {
    await mkdir(this.sessionDirFor(session), { recursive: true });
    this.db
      .prepare(
        `INSERT INTO sessions (
          session_id, title, view_token, edit_token, owner_token,
          view_token_hash, edit_token_hash, owner_token_hash, idempotency_key_hash,
          status, created_at, updated_at, expires_at, retention_hours
        ) VALUES (
          @session_id, @title, @view_token, @edit_token, @owner_token,
          @view_token_hash, @edit_token_hash, @owner_token_hash, @idempotency_key_hash,
          @status, @created_at, @updated_at, @expires_at, @retention_hours
        )
        ON CONFLICT(session_id) DO UPDATE SET
          title = excluded.title,
          view_token = excluded.view_token,
          edit_token = excluded.edit_token,
          owner_token = excluded.owner_token,
          view_token_hash = excluded.view_token_hash,
          edit_token_hash = excluded.edit_token_hash,
          owner_token_hash = excluded.owner_token_hash,
          idempotency_key_hash = excluded.idempotency_key_hash,
          status = excluded.status,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          expires_at = excluded.expires_at,
          retention_hours = excluded.retention_hours`
      )
      .run(toSessionRow(session));

    for (const screenshot of session.screenshots ?? []) {
      this.upsertScreenshot(session.session_id, screenshot);
    }
    for (const annotation of session.annotations ?? []) {
      this.upsertResult(session.session_id, annotation);
    }
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
        height: file.height,
        byte_size: file.buffer.length
      };
      session.screenshots.push(item);
      this.upsertScreenshot(session.session_id, item);
      items.push(publicScreenshot(item));
    }
    return items;
  }

  async replaceScreenshots(session, files) {
    await rm(path.join(this.sessionDirFor(session), "screenshots"), { recursive: true, force: true });
    await rm(path.join(this.sessionDirFor(session), "annotations"), { recursive: true, force: true });
    await mkdir(path.join(this.sessionDirFor(session), "screenshots"), { recursive: true });
    await mkdir(path.join(this.sessionDirFor(session), "annotations"), { recursive: true });
    this.db.prepare("DELETE FROM results WHERE session_id = ?").run(session.session_id);
    this.db.prepare("DELETE FROM screenshots WHERE session_id = ?").run(session.session_id);
    session.screenshots = [];
    session.annotations = [];
    session.status = "pending_result";
    session.updated_at = this.now().toISOString();
    await this.saveSession(session);
    return this.addScreenshots(session, files);
  }

  async saveMergedAnnotation(session, screenshotId, buffer, meta = {}) {
    const screenshot = session.screenshots.find((item) => item.screenshot_id === screenshotId);
    if (!screenshot) return null;

    await writeFile(this.annotationPath(session, screenshotId), buffer);
    const existingIndex = session.annotations.findIndex((item) => item.screenshot_id === screenshotId);
    const existing = existingIndex >= 0 ? session.annotations[existingIndex] : null;
    const annotation = {
      annotation_id: existing ? existing.annotation_id : makeAnnotationId(session.annotations.length + 1),
      screenshot_id: screenshotId,
      page_index: screenshot.page_index,
      merged_png_url: `/files/sessions/${session.session_id}/annotations/${screenshotId}-merged.png`,
      revision: Number(existing?.revision ?? 0) + 1,
      width: meta.width ?? screenshot.width,
      height: meta.height ?? screenshot.height,
      byte_size: buffer.length,
      updated_at: this.now().toISOString()
    };

    if (existingIndex >= 0) {
      session.annotations[existingIndex] = annotation;
    } else {
      session.annotations.push(annotation);
    }
    session.updated_at = annotation.updated_at;
    session.status =
      session.annotations.length >= session.screenshots.length ? "returned" : "partially_returned";
    await this.saveSession(session);
    return publicAnnotation(annotation);
  }

  async setRetention(session, { value, unit }) {
    const numericValue = Number(value);
    if (!Number.isInteger(numericValue) || numericValue < 1) return null;
    const retentionHours = unit === "days" ? numericValue * 24 : numericValue;
    const normalizedRetention = normalizeRetentionHours(retentionHours);
    const now = this.now();
    session.retention_hours = normalizedRetention;
    session.updated_at = now.toISOString();
    session.expires_at = addHours(now, normalizedRetention).toISOString();
    await this.saveSession(session);
    await this.cleanupExpiredSessions();
    return session;
  }

  isExpired(session) {
    return new Date(session.expires_at).getTime() <= this.now().getTime();
  }

  async getStandaloneSession(sessionId) {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE session_id = ?")
      .get(sessionId);
    return row ? this.hydrateSession(row) : null;
  }

  async getSessionByIdempotencyKeyHash(idempotencyKeyHash) {
    const row = this.db
      .prepare("SELECT * FROM sessions WHERE idempotency_key_hash = ?")
      .get(idempotencyKeyHash);
    return row ? this.hydrateSession(row) : null;
  }

  async listStandaloneSessionIds() {
    return this.db
      .prepare("SELECT session_id FROM sessions ORDER BY created_at ASC")
      .all()
      .map((row) => row.session_id);
  }

  async cleanupExpiredSessions() {
    const now = this.now().toISOString();
    this.db.prepare("DELETE FROM rate_limits WHERE reset_at <= ?").run(this.now().getTime());
    const expired = this.db
      .prepare("SELECT session_id FROM sessions WHERE expires_at <= ?")
      .all(now);
    const deleteSession = this.db.transaction((sessionId) => {
      this.db.prepare("DELETE FROM results WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM screenshots WHERE session_id = ?").run(sessionId);
      this.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(sessionId);
    });
    for (const row of expired) {
      await rm(this.sessionDir(row.session_id), { recursive: true, force: true });
      deleteSession(row.session_id);
    }
  }

  async getSessionForCapabilityAndId(kind, token, sessionId) {
    const session = await this.getStandaloneSession(sessionId);
    if (!session) return null;
    const hashField = `${kind}_token_hash`;
    return session[hashField] === hashCredential(token) ? session : null;
  }

  async getSessionForCapability(kind, token) {
    const hashField = `${kind}_token_hash`;
    const row = this.db
      .prepare(`SELECT * FROM sessions WHERE ${hashField} = ?`)
      .get(hashCredential(token));
    return row ? this.hydrateSession(row) : null;
  }

  sessionStoredBytes(sessionId, { replaceResultFor } = {}) {
    const screenshotBytes =
      this.db
        .prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM screenshots WHERE session_id = ?")
        .get(sessionId).total ?? 0;
    const resultQuery = replaceResultFor
      ? this.db
          .prepare(
            "SELECT COALESCE(SUM(byte_size), 0) AS total FROM results WHERE session_id = ? AND screenshot_id != ?"
          )
          .get(sessionId, replaceResultFor)
      : this.db
          .prepare("SELECT COALESCE(SUM(byte_size), 0) AS total FROM results WHERE session_id = ?")
          .get(sessionId);
    return Number(screenshotBytes) + Number(resultQuery.total ?? 0);
  }

  consumeRateLimit(bucketKey, { limit, windowMs, cost = 1, byteCost = 0 }) {
    const nowMs = this.now().getTime();
    const resetAt = nowMs + windowMs;
    const current = this.db
      .prepare("SELECT * FROM rate_limits WHERE bucket_key = ?")
      .get(bucketKey);
    const expired = !current || current.reset_at <= nowMs;
    const nextCount = expired ? cost : current.count + cost;
    const nextBytes = expired ? byteCost : current.bytes + byteCost;
    const effectiveReset = expired ? resetAt : current.reset_at;

    if (nextCount > limit || nextBytes > limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((effectiveReset - nowMs) / 1000))
      };
    }

    this.db
      .prepare(
        `INSERT INTO rate_limits (bucket_key, count, bytes, reset_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(bucket_key) DO UPDATE SET
          count = excluded.count,
          bytes = excluded.bytes,
          reset_at = excluded.reset_at`
      )
      .run(bucketKey, nextCount, nextBytes, effectiveReset);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  upsertScreenshot(sessionId, screenshot) {
    this.db
      .prepare(
        `INSERT INTO screenshots (
          session_id, screenshot_id, page_index, label, image_url, width, height, byte_size
        ) VALUES (
          @session_id, @screenshot_id, @page_index, @label, @image_url, @width, @height, @byte_size
        )
        ON CONFLICT(session_id, screenshot_id) DO UPDATE SET
          page_index = excluded.page_index,
          label = excluded.label,
          image_url = excluded.image_url,
          width = excluded.width,
          height = excluded.height,
          byte_size = excluded.byte_size`
      )
      .run({ session_id: sessionId, ...screenshot, byte_size: screenshot.byte_size ?? 0 });
  }

  upsertResult(sessionId, annotation) {
    this.db
      .prepare(
        `INSERT INTO results (
          session_id, screenshot_id, annotation_id, page_index, merged_png_url,
          revision, width, height, byte_size, updated_at
        ) VALUES (
          @session_id, @screenshot_id, @annotation_id, @page_index, @merged_png_url,
          @revision, @width, @height, @byte_size, @updated_at
        )
        ON CONFLICT(session_id, screenshot_id) DO UPDATE SET
          annotation_id = excluded.annotation_id,
          page_index = excluded.page_index,
          merged_png_url = excluded.merged_png_url,
          revision = excluded.revision,
          width = excluded.width,
          height = excluded.height,
          byte_size = excluded.byte_size,
          updated_at = excluded.updated_at`
      )
      .run({ session_id: sessionId, ...annotation, byte_size: annotation.byte_size ?? 0 });
  }

  hydrateSession(row) {
    const screenshots = this.db
      .prepare("SELECT * FROM screenshots WHERE session_id = ? ORDER BY page_index ASC")
      .all(row.session_id)
      .map(fromScreenshotRow);
    const annotations = this.db
      .prepare("SELECT * FROM results WHERE session_id = ? ORDER BY page_index ASC")
      .all(row.session_id)
      .map(fromResultRow);
    return {
      ...fromSessionRow(row),
      public_base_url: this.publicBaseUrl,
      screenshots,
      annotations
    };
  }
}

export function publicSession(session, access) {
  return {
    session_id: session.session_id,
    title: session.title,
    ...(access ? { access } : {}),
    ...(access === "owner"
      ? {
          view_url: shortShareUrl("view", session),
          edit_url: shortShareUrl("edit", session)
        }
      : {}),
    expires_at: session.expires_at,
    retention_hours: session.retention_hours ?? DEFAULT_RETENTION_HOURS,
    screenshots: session.screenshots.map(publicScreenshot),
    annotations: session.annotations.map(publicAnnotation)
  };
}

export function publicScreenshot(screenshot) {
  return {
    screenshot_id: screenshot.screenshot_id,
    page_index: screenshot.page_index,
    label: screenshot.label,
    image_url: screenshot.image_url,
    width: screenshot.width,
    height: screenshot.height
  };
}

export function publicAnnotation(annotation) {
  return {
    annotation_id: annotation.annotation_id,
    screenshot_id: annotation.screenshot_id,
    page_index: annotation.page_index,
    merged_png_url: annotation.merged_png_url,
    revision: annotation.revision ?? 1,
    width: annotation.width,
    height: annotation.height,
    updated_at: annotation.updated_at
  };
}

function toSessionRow(session) {
  return {
    session_id: session.session_id,
    title: session.title,
    view_token: session.view_token,
    edit_token: session.edit_token,
    owner_token: session.owner_token,
    view_token_hash: session.view_token_hash,
    edit_token_hash: session.edit_token_hash,
    owner_token_hash: session.owner_token_hash,
    idempotency_key_hash: session.idempotency_key_hash,
    status: session.status,
    created_at: session.created_at,
    updated_at: session.updated_at,
    expires_at: session.expires_at,
    retention_hours: session.retention_hours
  };
}

function fromSessionRow(row) {
  return {
    session_id: row.session_id,
    title: row.title,
    view_token: row.view_token,
    edit_token: row.edit_token,
    owner_token: row.owner_token,
    view_token_hash: row.view_token_hash,
    edit_token_hash: row.edit_token_hash,
    owner_token_hash: row.owner_token_hash,
    idempotency_key_hash: row.idempotency_key_hash,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
    expires_at: row.expires_at,
    retention_hours: row.retention_hours
  };
}

function fromScreenshotRow(row) {
  return {
    screenshot_id: row.screenshot_id,
    page_index: row.page_index,
    label: row.label,
    image_url: row.image_url,
    width: row.width,
    height: row.height,
    byte_size: row.byte_size
  };
}

function fromResultRow(row) {
  return {
    annotation_id: row.annotation_id,
    screenshot_id: row.screenshot_id,
    page_index: row.page_index,
    merged_png_url: row.merged_png_url,
    revision: row.revision,
    width: row.width,
    height: row.height,
    byte_size: row.byte_size,
    updated_at: row.updated_at
  };
}

function normalizeRetentionHours(value) {
  return Math.min(MAX_RETENTION_HOURS, Math.max(1, Number(value) || DEFAULT_RETENTION_HOURS));
}

function addHours(date, hours) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function shortShareUrl(mode, session) {
  const token = mode === "view" ? session.view_token : session.edit_token;
  const pathMode = mode === "view" ? "v" : "e";
  if (!token) return "";
  return `${sessionPublicBaseUrl(session)}/${pathMode}/${token}`;
}

function sessionPublicBaseUrl(session) {
  return session.public_base_url ?? "";
}
