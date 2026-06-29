import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { startSettingsServer } from "../scripts/settings-server.mjs";

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
