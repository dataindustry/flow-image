import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { loadConfig, startSettingsServer } from "../scripts/settings-server.mjs";

const servers = [];

afterEach(async () => {
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

test("settings server saves FlowImage config JSON", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flow-image-settings-"));
  const configPath = path.join(dir, "config.json");
  const server = await startSettingsServer({ configPath, host: "127.0.0.1", port: 0 });
  servers.push(server);

  const res = await fetch(`${server.url}/api/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      server_url: "http://127.0.0.1:3939/"
    })
  });

  assert.equal(res.status, 200);
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(saved.server_url, "http://127.0.0.1:3939");
  assert.equal(saved.pair_code, undefined);
  assert.equal((await stat(configPath)).mode & 0o777, 0o600);
});

test("plugin MCP config does not pin a user-specific config path", async () => {
  const mcpConfig = JSON.parse(await readFile(path.resolve(import.meta.dirname, "../.mcp.json"), "utf8"));

  assert.equal(mcpConfig.mcpServers.flow_image.env?.FLOWIMAGE_CONFIG_PATH, undefined);
});

test("settings config loading hides legacy pair code fields", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flow-image-settings-"));
  const configPath = path.join(dir, "config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      server_url: "https://flow-image.liujinhang.com",
      pair_code: "legacy",
      pairCode: "legacyCamel"
    })
  );

  const config = await loadConfig(configPath);

  assert.equal(config.server_url, "https://flow-image.liujinhang.com");
  assert.equal(config.pair_code, undefined);
  assert.equal(config.pairCode, undefined);
});

test("plugin MCP launcher delegates startup to the bridge", async () => {
  const launcher = await readFile(
    path.resolve(import.meta.dirname, "../scripts/mcp-server.mjs"),
    "utf8"
  );

  assert.match(launcher, /apps\/mcp-bridge\/src\/index\.mjs/);
  assert.match(launcher, /startServer/);
});

test("plugin manifest exposes only fixed FlowImage product commands", async () => {
  const manifest = JSON.parse(
    await readFile(path.resolve(import.meta.dirname, "../.codex-plugin/plugin.json"), "utf8")
  );

  assert.deepEqual(manifest.interface.defaultPrompt, [
    "FlowImage Settings",
    "FlowImage Publish",
    "FlowImage Republish",
    "FlowImage Sync"
  ]);
});

test("settings server uses the fixed preferred local port when available", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "flow-image-settings-"));
  const configPath = path.join(dir, "config.json");
  const server = await startSettingsServer({ configPath, host: "127.0.0.1" });
  servers.push(server);

  assert.equal(server.url, "http://127.0.0.1:47839");
});

test("settings server falls back when the preferred fixed port is occupied", async () => {
  const blocker = http.createServer((_req, res) => res.end("busy"));
  await new Promise((resolve) => blocker.listen(47839, "127.0.0.1", resolve));
  servers.push({ close: () => new Promise((resolve) => blocker.close(resolve)) });

  const dir = await mkdtemp(path.join(os.tmpdir(), "flow-image-settings-"));
  const configPath = path.join(dir, "config.json");
  const server = await startSettingsServer({ configPath, host: "127.0.0.1" });
  servers.push(server);

  assert.match(server.url, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(server.url, "http://127.0.0.1:47839");
});
