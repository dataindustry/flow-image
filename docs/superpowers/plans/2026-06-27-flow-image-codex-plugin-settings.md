# FlowImage Codex Plugin Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Package FlowImage as a real Codex plugin that appears in the plugin directory, opens a local settings web page, saves server URL and pair code, and uses those settings from the bundled MCP bridge.

**Architecture:** Keep the existing backend and MCP bridge as the runtime implementation. Add a repo-local Codex plugin under `plugins/flow-image` with `.codex-plugin/plugin.json`, `.mcp.json`, a setup skill, and a local settings server script that writes `~/.flowimage/config.json`. The MCP bridge reads environment variables first, then the config file, so plugin settings work without hand-editing MCP env vars.

**Tech Stack:** Node.js ESM, Codex plugin manifest, Codex marketplace JSON, MCP stdio server, Express backend, Vitest and Node built-in test runner.

## Global Constraints

- Product/UI name is `FlowImage`.
- Codex plugin name is `flow-image`.
- Codex MCP alias inside the plugin is `flow_image`.
- Default hosted server is `https://flow-image.like-water.net`.
- Local development server is `http://127.0.0.1:3939`.
- Pair code format is `FIMG-...`.
- Do not reintroduce legacy `BRIDGE_TOKEN`, `session_secret`, `secret=`, or `X-Session-Secret`.
- Settings file path is `~/.flowimage/config.json`, overridable with `FLOWIMAGE_CONFIG_PATH`.
- Existing `FLOWIMAGE_SERVER_URL` and `FLOWIMAGE_PAIR_CODE` environment variables override the settings file.

---

### Task 1: Add Pair Code Verification API

**Files:**
- Modify: `apps/backend/src/routes/pairs.mjs`
- Modify: `apps/backend/test/backend.test.mjs`

**Interfaces:**
- Consumes: `store.getPairForCode(pairCode)` from `apps/backend/src/lib/store.mjs`
- Produces: `GET /api/pairs/verify-code` with header `X-FlowImage-Pair-Code`; returns `{ ok: true, pair_id }` on valid code.

- [ ] **Step 1: Write failing tests**

Add tests in `apps/backend/test/backend.test.mjs`:

```js
test("verifies a valid pair code without exposing sessions", async () => {
  const pair = await agent.post("/api/pairs").send({ label: "ipad" }).expect(200);

  const res = await agent
    .get("/api/pairs/verify-code")
    .set("X-FlowImage-Pair-Code", pair.body.pair_code)
    .expect(200);

  expect(res.body).toEqual({
    ok: true,
    pair_id: pair.body.pair_id
  });
});

test("rejects missing or wrong pair code verification", async () => {
  await agent.get("/api/pairs/verify-code").expect(401, { error: "missing_pair_code" });

  await agent
    .get("/api/pairs/verify-code")
    .set("X-FlowImage-Pair-Code", "FIMG-WRONG-WRONG-WRONG-WRONG-WRONG-WRONG")
    .expect(403, { error: "wrong_pair_code" });
});
```

- [ ] **Step 2: Run backend tests and verify failure**

Run: `corepack pnpm@11.7.0 --filter backend test`

Expected: FAIL because `GET /api/pairs/verify-code` is not implemented.

- [ ] **Step 3: Implement endpoint**

Add to `pairsRouter` before `/:dynamic` style routes:

```js
  router.get("/verify-code", async (req, res) => {
    const pairCode = req.get("X-FlowImage-Pair-Code");
    if (!pairCode) {
      res.status(401).json({ error: "missing_pair_code" });
      return;
    }
    const pair = await store.getPairForCode(pairCode);
    if (!pair) {
      res.status(403).json({ error: "wrong_pair_code" });
      return;
    }
    res.json({ ok: true, pair_id: pair.pair_id });
  });
```

- [ ] **Step 4: Run backend tests and verify pass**

Run: `corepack pnpm@11.7.0 --filter backend test`

Expected: PASS.

### Task 2: Add FlowImage Config File Support to MCP Bridge

**Files:**
- Create: `apps/mcp-bridge/src/flowimage-config.mjs`
- Modify: `apps/mcp-bridge/src/backend-client.mjs`
- Modify: `apps/mcp-bridge/test/bridge.test.mjs`

**Interfaces:**
- Produces: `resolveFlowImageConfig(env)` returning `{ serverUrl, pairCode, configPath }`
- Produces: `writeFlowImageConfig(config, env)` writing `{ server_url, pair_code, updated_at }`
- Consumes: `BackendClient` constructor defaults from `resolveFlowImageConfig(process.env)`

- [ ] **Step 1: Write failing config tests**

Add tests in `apps/mcp-bridge/test/bridge.test.mjs`:

```js
test("loads server URL and pair code from FLOWIMAGE_CONFIG_PATH when env values are absent", async () => {
  const configPath = path.join(tmp, "flowimage-config.json");
  await writeFile(
    configPath,
    JSON.stringify({
      server_url: "https://custom.example",
      pair_code: "FIMG-CONFIG-PAIR"
    })
  );

  const config = resolveFlowImageConfig({ FLOWIMAGE_CONFIG_PATH: configPath });

  expect(config).toMatchObject({
    serverUrl: "https://custom.example",
    pairCode: "FIMG-CONFIG-PAIR",
    configPath
  });
});

test("environment values override config file values", async () => {
  const configPath = path.join(tmp, "flowimage-config-env.json");
  await writeFile(
    configPath,
    JSON.stringify({
      server_url: "https://file.example",
      pair_code: "FIMG-FILE"
    })
  );

  const config = resolveFlowImageConfig({
    FLOWIMAGE_CONFIG_PATH: configPath,
    FLOWIMAGE_SERVER_URL: "https://env.example",
    FLOWIMAGE_PAIR_CODE: "FIMG-ENV"
  });

  expect(config).toMatchObject({
    serverUrl: "https://env.example",
    pairCode: "FIMG-ENV"
  });
});
```

- [ ] **Step 2: Run bridge tests and verify failure**

Run: `corepack pnpm@11.7.0 --filter mcp-bridge test`

Expected: FAIL because `flowimage-config.mjs` does not exist.

- [ ] **Step 3: Implement config module and wire `BackendClient`**

Create `apps/mcp-bridge/src/flowimage-config.mjs`:

```js
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_FLOWIMAGE_SERVER_URL = "https://flow-image.like-water.net";

export function defaultFlowImageConfigPath(env = process.env) {
  return env.FLOWIMAGE_CONFIG_PATH ?? path.join(os.homedir(), ".flowimage", "config.json");
}

function readConfigFile(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

export function resolveFlowImageConfig(env = process.env) {
  const configPath = defaultFlowImageConfigPath(env);
  const fileConfig = readConfigFile(configPath);
  return {
    serverUrl:
      env.FLOWIMAGE_SERVER_URL ??
      fileConfig.server_url ??
      fileConfig.serverUrl ??
      DEFAULT_FLOWIMAGE_SERVER_URL,
    pairCode: env.FLOWIMAGE_PAIR_CODE ?? fileConfig.pair_code ?? fileConfig.pairCode,
    configPath
  };
}

export function writeFlowImageConfig(config, env = process.env) {
  const configPath = defaultFlowImageConfigPath(env);
  const serverUrl = String(config.server_url ?? config.serverUrl ?? "").trim();
  const pairCode = String(config.pair_code ?? config.pairCode ?? "").trim();
  if (!serverUrl) throw new Error("server_url is required");
  if (!pairCode) throw new Error("pair_code is required");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        server_url: serverUrl.replace(/\/$/, ""),
        pair_code: pairCode,
        updated_at: new Date().toISOString()
      },
      null,
      2
    )
  );
  return { configPath, serverUrl: serverUrl.replace(/\/$/, ""), pairCode };
}
```

Modify `BackendClient` default constructor values to use `resolveFlowImageConfig`.

- [ ] **Step 4: Run bridge tests and verify pass**

Run: `corepack pnpm@11.7.0 --filter mcp-bridge test`

Expected: PASS.

### Task 3: Add Plugin Settings Web Server

**Files:**
- Create: `plugins/flow-image/scripts/settings-server.mjs`
- Create: `plugins/flow-image/test/settings-server.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `startSettingsServer({ configPath, host, port, openBrowser })`
- Produces: local web UI with `GET /`, `GET /api/config`, `POST /api/config`, and `POST /api/test`
- Consumes: backend `GET /api/pairs/verify-code`

- [ ] **Step 1: Write failing Node tests**

Create `plugins/flow-image/test/settings-server.test.mjs`:

```js
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
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
      server_url: "http://127.0.0.1:3939/",
      pair_code: "FIMG-TEST-PAIR"
    })
  });

  assert.equal(res.status, 200);
  const saved = JSON.parse(await readFile(configPath, "utf8"));
  assert.equal(saved.server_url, "http://127.0.0.1:3939");
  assert.equal(saved.pair_code, "FIMG-TEST-PAIR");
});
```

- [ ] **Step 2: Run plugin test and verify failure**

Run: `node --test plugins/flow-image/test/settings-server.test.mjs`

Expected: FAIL because `settings-server.mjs` does not exist.

- [ ] **Step 3: Implement settings server**

Create a Node `http` server that:

- Binds to `127.0.0.1` and random port by default.
- Renders an HTML form for server URL and pair code.
- Saves JSON to `FLOWIMAGE_CONFIG_PATH` or `~/.flowimage/config.json`.
- Tests connection by calling `${server_url}/api/pairs/verify-code` with `X-FlowImage-Pair-Code`.
- Prints `FlowImage settings: http://127.0.0.1:<port>/`.
- Uses macOS `open` only when `--open` is passed.

- [ ] **Step 4: Run plugin test and verify pass**

Run: `node --test plugins/flow-image/test/settings-server.test.mjs`

Expected: PASS.

- [ ] **Step 5: Include plugin tests in root test command**

Modify root `package.json`:

```json
"test": "pnpm -r test && node --test plugins/flow-image/test/*.test.mjs"
```

Run: `corepack pnpm@11.7.0 test`

Expected: PASS.

### Task 4: Create Codex Plugin Package and Marketplace Entry

**Files:**
- Create: `plugins/flow-image/.codex-plugin/plugin.json`
- Create: `plugins/flow-image/.mcp.json`
- Create: `plugins/flow-image/skills/flow-image/SKILL.md`
- Create: `.agents/plugins/marketplace.json`

**Interfaces:**
- Produces: Codex plugin `flow-image`
- Produces: plugin-bundled MCP server `flow_image`
- Produces: default prompt `Open FlowImage settings`

- [ ] **Step 1: Scaffold plugin**

Run from the plugin creator skill root:

```bash
python3 scripts/create_basic_plugin.py flow-image \
  --path /Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/plugins \
  --marketplace-path /Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/.agents/plugins/marketplace.json \
  --with-skills --with-scripts --with-mcp --with-marketplace
```

Expected: plugin files and marketplace entry exist.

- [ ] **Step 2: Replace plugin manifest and MCP config**

`plugins/flow-image/.codex-plugin/plugin.json` must include:

```json
{
  "name": "flow-image",
  "version": "0.1.0",
  "description": "Send UI screenshots to FlowImage for iPad annotation and collect marked-up images in Codex.",
  "author": {
    "name": "Like Water",
    "url": "https://like-water.net"
  },
  "homepage": "https://like-water.net",
  "license": "MIT",
  "keywords": ["flow-image", "ui-review", "mcp", "annotation"],
  "skills": "./skills/",
  "mcpServers": "./.mcp.json",
  "interface": {
    "displayName": "FlowImage",
    "shortDescription": "Send screenshots to iPad annotation and collect marked-up images.",
    "longDescription": "FlowImage pairs Codex with a web or iPad annotation canvas. Configure a server URL and pair code, publish screenshots through the bundled MCP server, then collect annotated PNGs back into Codex.",
    "developerName": "Like Water",
    "category": "Productivity",
    "capabilities": ["Interactive", "Write"],
    "websiteURL": "https://like-water.net",
    "defaultPrompt": [
      "Open FlowImage settings",
      "Verify FlowImage setup",
      "Publish screenshots with FlowImage"
    ],
    "brandColor": "#2563EB"
  }
}
```

`plugins/flow-image/.mcp.json` must use the local bridge entry:

```json
{
  "mcpServers": {
    "flow_image": {
      "command": "node",
      "args": [
        "/Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/apps/mcp-bridge/src/index.mjs"
      ],
      "env": {
        "FLOWIMAGE_CONFIG_PATH": "/Users/ryu/.flowimage/config.json"
      }
    }
  }
}
```

- [ ] **Step 3: Add plugin skill instructions**

Create `plugins/flow-image/skills/flow-image/SKILL.md`:

```md
---
name: flow-image
description: Configure and use FlowImage to publish UI screenshots for iPad/Web annotation and collect marked-up PNGs back into Codex.
---

Use this skill when the user asks to configure FlowImage, open FlowImage settings, publish screenshots with FlowImage, or collect FlowImage annotations.

## Configure

Run:

```bash
node /Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/plugins/flow-image/scripts/settings-server.mjs --open
```

Keep the settings server running while the user edits the page. It saves config to `~/.flowimage/config.json`.

## Verify

Run:

```bash
node /Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/plugins/flow-image/scripts/settings-server.mjs --print-config
```

## Use

After configuration, use the bundled `flow_image` MCP server tools:

- `ui_publish_screenshots`
- `ui_collect_annotations`

Never modify application code immediately after collecting annotations. First show or summarize the returned images and wait for the user to confirm.
```

- [ ] **Step 4: Validate plugin**

Run:

```bash
python3 /Users/ryu/.codex/skills/.system/plugin-creator/scripts/validate_plugin.py /Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image/plugins/flow-image
```

Expected: PASS.

### Task 5: Install, Verify, and Remove Naked MCP Duplicate

**Files:**
- Modify: `~/.codex/config.toml` through CLI commands only
- Modify: plugin cache through CLI commands only

**Interfaces:**
- Consumes: `.agents/plugins/marketplace.json`
- Produces: installed Codex plugin `flow-image`

- [ ] **Step 1: Install repo marketplace if needed**

Run:

```bash
codex plugin marketplace list
```

If the repo marketplace is missing, run:

```bash
codex plugin marketplace add /Users/ryu/projects/AgenticProjects/LIKE-WATER/flow-image
```

- [ ] **Step 2: Install plugin**

Run:

```bash
codex plugin add flow-image@local-repo
```

If the marketplace name differs, read `.agents/plugins/marketplace.json` and use its `name`.

- [ ] **Step 3: Remove the old naked MCP registration**

Run:

```bash
codex mcp remove flow_image
```

Expected: only the plugin-bundled `flow_image` remains after restart/new thread.

- [ ] **Step 4: Verify plugin and MCP visibility**

Run:

```bash
codex plugin list
codex mcp list
```

Expected: `flow-image` appears as installed/enabled plugin. The plugin-bundled MCP may require a new thread or Codex restart before appearing as tools.

### Task 6: End-to-End Acceptance

**Files:**
- No source changes expected.

**Interfaces:**
- Uses: visible in-app browser at `http://127.0.0.1:3939`
- Uses: `plugins/flow-image/scripts/settings-server.mjs --open`
- Uses: MCP `ui_publish_screenshots` and `ui_collect_annotations`

- [ ] **Step 1: Start or confirm backend**

Run:

```bash
lsof -nP -iTCP:3939 -sTCP:LISTEN || corepack pnpm@11.7.0 dev:backend
```

Expected: FlowImage backend listens on `127.0.0.1:3939`.

- [ ] **Step 2: Open settings page**

Run:

```bash
node plugins/flow-image/scripts/settings-server.mjs --open
```

Expected: local settings URL opens. Save `http://127.0.0.1:3939` and the current `FIMG-...` pair code.

- [ ] **Step 3: Verify config file**

Run:

```bash
cat ~/.flowimage/config.json
```

Expected: JSON includes `server_url` and `pair_code`.

- [ ] **Step 4: Run full tests**

Run:

```bash
corepack pnpm@11.7.0 test
git diff --check
```

Expected: PASS.

- [ ] **Step 5: Report remaining risks**

Run:

```bash
corepack pnpm@11.7.0 audit --audit-level low
```

Expected: Known Vitest/Vite/esbuild dev dependency advisories may remain.

