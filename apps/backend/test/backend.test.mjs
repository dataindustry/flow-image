import { describe, expect, test, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
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

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "ui-loop-"));
  app = createApp({
    dataDir,
    bridgeToken: "test-token",
    publicBaseUrl: "https://example.test",
    now: () => new Date("2026-06-27T10:00:00.000Z")
  });
});

afterEach(async () => {
  await rm(dataDir, { recursive: true, force: true });
});

describe("sessions", () => {
  test("requires bridge token to create a session", async () => {
    const res = await request(app).post("/api/sessions").send({ title: "Settings" });

    expect(res.status).toBe(403);
  });

  test("creates a session with public viewer url", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("X-Bridge-Token", "test-token")
      .send({ title: "Settings" });

    expect(res.status).toBe(200);
    expect(res.body.session_id).toMatch(/^sess_20260627_[0-9a-f]{16}$/);
    expect(res.body.session_secret).toMatch(/^sec_[A-Za-z0-9_-]{32}$/);
    expect(res.body.viewer_url).toBe(
      `https://example.test/s/${res.body.session_id}?secret=${res.body.session_secret}`
    );
    expect(res.body.expires_at).toBe("2026-06-28T10:00:00.000Z");
  });

  test("reads session only with secret", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .set("X-Bridge-Token", "test-token")
      .send({ title: "Settings" });

    const denied = await request(app).get(`/api/sessions/${create.body.session_id}`);
    expect(denied.status).toBe(401);

    const ok = await request(app)
      .get(`/api/sessions/${create.body.session_id}`)
      .query({ secret: create.body.session_secret });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe("Settings");
    expect(ok.body.screenshots).toEqual([]);
    expect(ok.body.annotations).toEqual([]);
  });
});

describe("config", () => {
  test("default data dir is stable when backend runs from package cwd", () => {
    const originalCwd = process.cwd();
    const repoRoot = path.resolve(originalCwd, "../..");
    process.chdir(path.resolve(repoRoot, "apps/backend"));
    try {
      const config = makeConfig({ bridgeToken: "x" });
      expect(config.dataDir).toBe(path.resolve(repoRoot, "apps/backend/data/sessions"));
    } finally {
      process.chdir(originalCwd);
    }
  });
});

async function createSession(title = "Settings") {
  const res = await request(app)
    .post("/api/sessions")
    .set("X-Bridge-Token", "test-token")
    .send({ title });
  return res.body;
}

describe("screenshots and files", () => {
  test("uploads PNG screenshots with generated filenames and IHDR dimensions", async () => {
    const session = await createSession();

    const res = await request(app)
      .post(`/api/sessions/${session.session_id}/screenshots`)
      .set("X-Session-Secret", session.session_secret)
      .field("labels[]", "Settings page")
      .attach("files[]", png1x1, { filename: "client-name.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.count).toBe(1);
    expect(res.body.items[0]).toMatchObject({
      screenshot_id: "shot_0001",
      page_index: 1,
      label: "Settings page",
      image_url: `/files/sessions/${session.session_id}/screenshots/shot_0001.png`,
      width: 1,
      height: 1
    });
  });

  test("rejects non-PNG screenshots before storage", async () => {
    const session = await createSession();

    const res = await request(app)
      .post(`/api/sessions/${session.session_id}/screenshots`)
      .set("X-Session-Secret", session.session_secret)
      .attach("files[]", Buffer.from("not a png"), {
        filename: "bad.txt",
        contentType: "text/plain"
      });

    expect(res.status).toBe(415);
  });

  test("requires secret and blocks traversal for file reads", async () => {
    const session = await createSession();
    await request(app)
      .post(`/api/sessions/${session.session_id}/screenshots`)
      .set("X-Session-Secret", session.session_secret)
      .attach("files[]", png1x1, { filename: "shot.png", contentType: "image/png" });

    const denied = await request(app).get(
      `/files/sessions/${session.session_id}/screenshots/shot_0001.png`
    );
    expect(denied.status).toBe(401);

    const traversal = await request(app)
      .get(`/files/sessions/${session.session_id}/screenshots/..%2Fsession.json`)
      .query({ secret: session.session_secret });
    expect(traversal.status).toBe(400);

    const ok = await request(app)
      .get(`/files/sessions/${session.session_id}/screenshots/shot_0001.png`)
      .query({ secret: session.session_secret });
    expect(ok.status).toBe(200);
    expect(ok.headers["content-type"]).toMatch(/image\/png/);
    expect(Buffer.from(ok.body)).toEqual(png1x1);
  });
});

describe("annotations", () => {
  test("uploads merged annotation and exposes ready metadata with local path", async () => {
    const session = await createSession();
    const upload = await request(app)
      .post(`/api/sessions/${session.session_id}/screenshots`)
      .set("X-Session-Secret", session.session_secret)
      .attach("files[]", png1x1, { filename: "shot.png", contentType: "image/png" });
    const screenshotId = upload.body.items[0].screenshot_id;

    const annotation = await request(app)
      .post(`/api/sessions/${session.session_id}/annotations/${screenshotId}`)
      .set("X-Session-Secret", session.session_secret)
      .attach("merged_png", png1x1, { filename: "merged.png", contentType: "image/png" });

    expect(annotation.status).toBe(200);
    expect(annotation.body).toMatchObject({
      annotation_id: "ann_0001",
      ready: true,
      merged_png_url: `/files/sessions/${session.session_id}/annotations/shot_0001-merged.png`
    });

    const ready = await request(app)
      .get(`/api/sessions/${session.session_id}/annotations/ready`)
      .query({ secret: session.session_secret });
    expect(ready.status).toBe(200);
    expect(ready.body.ready_count).toBe(1);
    expect(ready.body.items[0].merged_png_path).toMatch(/shot_0001-merged\.png$/);
  });

  test("ready annotations returns zero before merged upload", async () => {
    const session = await createSession();

    const ready = await request(app)
      .get(`/api/sessions/${session.session_id}/annotations/ready`)
      .query({ secret: session.session_secret });

    expect(ready.status).toBe(200);
    expect(ready.body.ready_count).toBe(0);
    expect(ready.body.items).toEqual([]);
  });
});
