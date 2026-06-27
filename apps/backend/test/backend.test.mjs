import { describe, expect, test, beforeEach, afterEach } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/server.mjs";

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
