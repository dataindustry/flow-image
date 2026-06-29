import { describe, expect, test, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/server.mjs";
import { makeConfig } from "../src/lib/config.mjs";

const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000150a0f53a0000000049454e44ae426082",
  "hex"
);

let dataDir;
let app;
let now;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "flow-image-"));
  now = new Date("2026-06-27T10:00:00.000Z");
  app = createApp({
    dataDir,
    publicBaseUrl: "https://example.test",
    now: () => now
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

function shareParts(url) {
  const parsed = new URL(url);
  const [, mode, token] = parsed.pathname.split("/");
  return { mode, token, hash: parsed.hash };
}

async function createLinkSession(title = "Settings") {
  const session = await request(app).post("/api/sessions").send({ title });
  expect(session.status).toBe(200);
  return {
    session: session.body,
    view: shareParts(session.body.view_url),
    edit: shareParts(session.body.edit_url),
    owner: shareParts(session.body.owner_url)
  };
}

async function uploadScreenshot(session) {
  const upload = await request(app)
    .post(`/api/sessions/${session.session_id}/screenshots`)
    .set("X-FlowImage-Owner-Token", session.owner_token)
    .attach("files[]", png1x1, { filename: "shot.png", contentType: "image/png" });
  expect(upload.status).toBe(200);
  return upload.body.items[0];
}

describe("link-scoped sessions", () => {
  test("creates short view, edit, and owner capability links with recoverable share tokens", async () => {
    const { session, view, edit, owner } = await createLinkSession();

    expect(session.session_id).toMatch(/^sess_20260627_[0-9a-f]{16}$/);
    expect(view).toMatchObject({ mode: "v" });
    expect(edit).toMatchObject({ mode: "e" });
    expect(owner).toMatchObject({ mode: "o" });
    expect(view.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(edit.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(owner.token).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(session.viewer_url).toBeUndefined();
    expect(session.view_url).toBe(`https://example.test/v/${view.token}`);
    expect(session.edit_url).toBe(`https://example.test/e/${edit.token}`);
    expect(session.owner_url).toBe(`https://example.test/o/${owner.token}`);
    expect(session.owner_url).not.toContain("#");
    expect(session.expires_at).toBe("2026-07-04T10:00:00.000Z");
    expect(session.retention_hours).toBe(168);

    const row = app.locals.store.db.prepare("SELECT * FROM sessions WHERE session_id = ?").get(session.session_id);
    expect(row.view_token).toBe(view.token);
    expect(row.edit_token).toBe(edit.token);
    expect(row.owner_token).toBe(owner.token);
    expect(row.view_token_hash).toBeTruthy();
    expect(row.edit_token_hash).toBeTruthy();
    expect(row.owner_token_hash).toBeTruthy();
    await expect(
      access(path.join(dataDir, "sessions", session.session_id, "session.json"))
    ).rejects.toThrow();
  });

  test("uses short token-only share lookups and returns owner share URLs only to owner", async () => {
    const { session, view, edit, owner } = await createLinkSession();
    await uploadScreenshot(session);

    const viewSession = await request(app).get(`/api/share/view/${view.token}`);
    expect(viewSession.status).toBe(200);
    expect(viewSession.body.access).toBe("view");
    expect(viewSession.body.screenshots).toHaveLength(1);
    expect(viewSession.body.view_url).toBeUndefined();
    expect(viewSession.body.edit_url).toBeUndefined();

    const editSession = await request(app).get(`/api/share/edit/${edit.token}`);
    expect(editSession.status).toBe(200);
    expect(editSession.body.access).toBe("edit");
    expect(editSession.body.view_url).toBeUndefined();
    expect(editSession.body.edit_url).toBeUndefined();

    const ownerSession = await request(app).get(`/api/share/owner/${owner.token}`);
    expect(ownerSession.status).toBe(200);
    expect(ownerSession.body.access).toBe("owner");
    expect(ownerSession.body.view_url).toBe(session.view_url);
    expect(ownerSession.body.edit_url).toBe(session.edit_url);

    const wrongMode = await request(app).get(`/api/share/edit/${view.token}`);
    expect(wrongMode.status).toBe(403);

    const oldLongRoute = await request(app).get(`/api/share/view/${session.session_id}/${view.token}`);
    expect(oldLongRoute.status).toBe(404);
  });

  test("separates view, edit, and owner permissions on API operations", async () => {
    const { session, view, edit } = await createLinkSession();
    const screenshot = await uploadScreenshot(session);

    const viewFile = await request(app)
      .get(`/files/sessions/${session.session_id}/screenshots/${screenshot.screenshot_id}.png`)
      .set("X-FlowImage-View-Token", view.token);
    expect(viewFile.status).toBe(200);
    expect(Buffer.from(viewFile.body)).toEqual(png1x1);

    const viewCannotSave = await request(app)
      .post(`/api/sessions/${session.session_id}/annotations/${screenshot.screenshot_id}`)
      .set("X-FlowImage-View-Token", view.token)
      .attach("merged_png", png1x1, { filename: "merged.png", contentType: "image/png" });
    expect(viewCannotSave.status).toBe(401);

    const editCanSave = await request(app)
      .post(`/api/sessions/${session.session_id}/annotations/${screenshot.screenshot_id}`)
      .set("X-FlowImage-Edit-Token", edit.token)
      .attach("merged_png", png1x1, { filename: "merged.png", contentType: "image/png" });
    expect(editCanSave.status).toBe(200);
    expect(editCanSave.body.revision).toBe(1);

    const ownerCanSave = await request(app)
      .post(`/api/sessions/${session.session_id}/annotations/${screenshot.screenshot_id}`)
      .set("X-FlowImage-Owner-Token", session.owner_token)
      .attach("merged_png", png1x1, { filename: "merged.png", contentType: "image/png" });
    expect(ownerCanSave.status).toBe(200);
    expect(ownerCanSave.body.revision).toBe(2);

    const ownerCollect = await request(app)
      .post(`/api/sessions/${session.session_id}/annotations/collect`)
      .set("X-FlowImage-Owner-Token", session.owner_token);
    expect(ownerCollect.status).toBe(200);
    expect(ownerCollect.body.ready_count).toBe(1);
    expect(ownerCollect.body.review_url).toBeUndefined();
  });

  test("lets owner set retention in hours or days and rejects non-owner changes", async () => {
    const { session, view } = await createLinkSession();

    now = new Date("2026-06-27T11:00:00.000Z");
    const denied = await request(app)
      .patch(`/api/sessions/${session.session_id}/retention`)
      .set("X-FlowImage-View-Token", view.token)
      .send({ value: 12, unit: "hours" });
    expect(denied.status).toBe(401);

    const savedHours = await request(app)
      .patch(`/api/sessions/${session.session_id}/retention`)
      .set("X-FlowImage-Owner-Token", session.owner_token)
      .send({ value: 12, unit: "hours" });
    expect(savedHours.status).toBe(200);
    expect(savedHours.body.retention_hours).toBe(12);
    expect(savedHours.body.expires_at).toBe("2026-06-27T23:00:00.000Z");

    const savedDays = await request(app)
      .patch(`/api/sessions/${session.session_id}/retention`)
      .set("X-FlowImage-Owner-Token", session.owner_token)
      .send({ value: 2, unit: "days" });
    expect(savedDays.status).toBe(200);
    expect(savedDays.body.retention_hours).toBe(48);
    expect(savedDays.body.expires_at).toBe("2026-06-29T11:00:00.000Z");
  });

  test("cleans up expired standalone sessions during new session creation", async () => {
    const { session } = await createLinkSession("Old");
    const oldPath = path.join(dataDir, "files", "sessions", session.session_id);
    await access(oldPath);

    now = new Date("2026-07-05T10:00:00.000Z");
    const fresh = await request(app).post("/api/sessions").send({ title: "Fresh" });
    expect(fresh.status).toBe(200);
    await expect(access(oldPath)).rejects.toThrow();
  });

  test("removes legacy pair and /s entrypoints from the server surface", async () => {
    const pair = await request(app).post("/api/pairs").send({ label: "iPad" });
    expect(pair.status).toBe(404);

    const legacy = await request(app).get("/s/sess_20260627_deadbeefdeadbeef");
    expect(legacy.status).toBe(404);
  });

  test("stores screenshot files under the SQLite data files tree", async () => {
    const { session } = await createLinkSession();
    const screenshot = await uploadScreenshot(session);

    await access(
      path.join(
        dataDir,
        "files",
        "sessions",
        session.session_id,
        "screenshots",
        `${screenshot.screenshot_id}.png`
      )
    );
  });

  test("keeps GET root side-effect free", async () => {
    expect(app.locals.store.db.prepare("SELECT COUNT(*) AS total FROM sessions").get().total).toBe(0);

    const root = await request(app).get("/");

    expect(root.status).toBe(200);
    expect(app.locals.store.db.prepare("SELECT COUNT(*) AS total FROM sessions").get().total).toBe(0);
  });

  test("idempotently creates one default blank canvas for the same root key", async () => {
    const first = await request(app)
      .post("/api/sessions")
      .send({
        title: "Untitled FlowImage",
        default_page: "blank_grid",
        idempotency_key: "root-key-1"
      });
    const second = await request(app)
      .post("/api/sessions")
      .send({
        title: "Ignored Retry Title",
        default_page: "blank_grid",
        idempotency_key: "root-key-1"
      });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({
      session_id: first.body.session_id,
      view_url: first.body.view_url,
      edit_url: first.body.edit_url,
      owner_url: first.body.owner_url,
      owner_token: first.body.owner_token
    });
    expect(app.locals.store.db.prepare("SELECT COUNT(*) AS total FROM sessions").get().total).toBe(1);
    expect(app.locals.store.db.prepare("SELECT COUNT(*) AS total FROM screenshots").get().total).toBe(1);

    const page = app.locals.store.db.prepare("SELECT * FROM screenshots").get();
    expect(page).toMatchObject({
      session_id: first.body.session_id,
      page_index: 1,
      label: "Blank canvas",
      width: 1440,
      height: 900
    });
    await access(
      path.join(dataDir, "files", "sessions", first.body.session_id, "screenshots", `${page.screenshot_id}.png`)
    );
  });

  test("creates different sessions for different root idempotency keys", async () => {
    const first = await request(app)
      .post("/api/sessions")
      .send({ title: "One", default_page: "blank_grid", idempotency_key: "root-key-a" });
    const second = await request(app)
      .post("/api/sessions")
      .send({ title: "Two", default_page: "blank_grid", idempotency_key: "root-key-b" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.session_id).not.toBe(first.body.session_id);
    expect(app.locals.store.db.prepare("SELECT COUNT(*) AS total FROM sessions").get().total).toBe(2);
  });
});

describe("qr endpoint", () => {
  test("returns a real SVG QR image for share links", async () => {
    const qr = await request(app)
      .post("/api/qr")
      .send({ text: "https://example.test/edit/sess/token" });

    expect(qr.status).toBe(200);
    expect(qr.headers["content-type"]).toContain("image/svg+xml");
    expect(Buffer.from(qr.body).toString("utf8")).toContain("<svg");
  });

  test("rejects empty and oversized QR payloads", async () => {
    const empty = await request(app).post("/api/qr").send({ text: "" });
    const tooLong = await request(app).post("/api/qr").send({ text: "x".repeat(2049) });

    expect(empty.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });
});

describe("built-in rate limits", () => {
  test("limits public session creation in-process", async () => {
    const limited = createApp({
      dataDir,
      publicBaseUrl: "https://example.test",
      now: () => now,
      rateLimit: {
        enabled: true,
        windowMs: 60_000,
        createLimit: 1
      }
    });

    expect((await request(limited).post("/api/sessions").send({ title: "One" })).status).toBe(200);
    const blocked = await request(limited).post("/api/sessions").send({ title: "Two" });

    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBe("rate_limited");
    expect(blocked.headers["retry-after"]).toBeDefined();
  });

  test("enforces per-session storage limits", async () => {
    const constrained = createApp({
      dataDir,
      publicBaseUrl: "https://example.test",
      now: () => now,
      rateLimit: {
        enabled: true,
        sessionBytesLimit: png1x1.length - 1
      }
    });
    const created = await request(constrained).post("/api/sessions").send({ title: "Bytes" });

    const upload = await request(constrained)
      .post(`/api/sessions/${created.body.session_id}/screenshots`)
      .set("X-FlowImage-Owner-Token", created.body.owner_token)
      .attach("files[]", png1x1, { filename: "shot.png", contentType: "image/png" });

    expect(upload.status).toBe(413);
    expect(upload.body.error).toBe("session_storage_limit");
  });

  test("cleans expired rate limit buckets during cleanup", async () => {
    const store = app.locals.store;
    store.db
      .prepare("INSERT INTO rate_limits (bucket_key, count, bytes, reset_at) VALUES (?, ?, ?, ?)")
      .run("expired", 1, 0, now.getTime() - 1);
    store.db
      .prepare("INSERT INTO rate_limits (bucket_key, count, bytes, reset_at) VALUES (?, ?, ?, ?)")
      .run("active", 1, 0, now.getTime() + 60_000);

    await store.cleanupExpiredSessions();

    const keys = store.db
      .prepare("SELECT bucket_key FROM rate_limits ORDER BY bucket_key")
      .all()
      .map((row) => row.bucket_key);
    expect(keys).toEqual(["active"]);
  });
});

describe("sqlite storage", () => {
  test("enables foreign key cascade for session children", async () => {
    const { session, edit } = await createLinkSession();
    const screenshot = await uploadScreenshot(session);
    const store = app.locals.store;

    const saved = await request(app)
      .post(`/api/sessions/${session.session_id}/annotations/${screenshot.screenshot_id}`)
      .set("X-FlowImage-Edit-Token", edit.token)
      .attach("merged_png", png1x1, { filename: "merged.png", contentType: "image/png" });
    expect(saved.status).toBe(200);

    expect(store.db.pragma("foreign_keys", { simple: true })).toBe(1);
    store.db.prepare("DELETE FROM sessions WHERE session_id = ?").run(session.session_id);

    expect(
      store.db.prepare("SELECT COUNT(*) AS total FROM screenshots WHERE session_id = ?").get(session.session_id)
        .total
    ).toBe(0);
    expect(
      store.db.prepare("SELECT COUNT(*) AS total FROM results WHERE session_id = ?").get(session.session_id)
        .total
    ).toBe(0);
  });
});

describe("static frontend assets", () => {
  test("serves app assets without browser caching during dev", async () => {
    const appJs = await request(app).get("/app.js");
    const css = await request(app).get("/styles.css");

    expect(appJs.status).toBe(200);
    expect(css.status).toBe(200);
    expect(appJs.headers["cache-control"]).toBe("no-store");
    expect(css.headers["cache-control"]).toBe("no-store");
  });
});

describe("config", () => {
  test("defaults development server to a LAN bind address with a usable public URL", () => {
    const config = makeConfig({
      env: {},
      lanAddress: () => "192.168.2.72"
    });

    expect(config.bindHost).toBe("0.0.0.0");
    expect(config.publicBaseUrl).toBe("http://192.168.2.72:3939");
  });

  test("uses HTTPS public URLs when certificate paths are configured", () => {
    const config = makeConfig({
      env: {
        HTTPS_CERT_PATH: ".certs/flowimage.pem",
        HTTPS_KEY_PATH: ".certs/flowimage-key.pem"
      },
      lanAddress: () => "192.168.2.72"
    });

    expect(config.https).toEqual({
      certPath: ".certs/flowimage.pem",
      keyPath: ".certs/flowimage-key.pem"
    });
    expect(config.publicBaseUrl).toBe("https://192.168.2.72:3939");
  });

  test("default data dir is stable when backend runs from package cwd", () => {
    const originalCwd = process.cwd();
    const repoRoot = path.resolve(originalCwd, "../..");
    process.chdir(path.resolve(repoRoot, "apps/backend"));
    try {
      const config = makeConfig();
      expect(config.dataDir).toBe(path.resolve(repoRoot, "apps/backend/data"));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

describe("static security headers", () => {
  test("serves the web app with a minimal content security policy", async () => {
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'self'");
  });
});
