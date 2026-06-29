import http from "node:http";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_SERVER_URL = "https://flow-image.like-water.net";

export function defaultConfigPath(env = process.env) {
  return env.FLOWIMAGE_CONFIG_PATH ?? path.join(os.homedir(), ".flowimage", "config.json");
}

function normalizeServerUrl(value) {
  return String(value ?? "").trim().replace(/\/$/, "");
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

async function loadConfig(configPath) {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") {
      return {
        server_url: DEFAULT_SERVER_URL
      };
    }
    throw error;
  }
}

async function saveConfig(configPath, input) {
  const serverUrl = normalizeServerUrl(input.server_url ?? input.serverUrl);
  if (!serverUrl) throw new Error("server_url is required");

  const existing = await loadConfig(configPath);
  const { pair_code, pairCode, ...cleanExisting } = existing;
  const config = {
    ...cleanExisting,
    server_url: serverUrl,
    updated_at: new Date().toISOString()
  };
  await mkdir(path.dirname(configPath), { recursive: true });
  await writeFile(configPath, JSON.stringify(config, null, 2));
  await chmod(configPath, 0o600);
  return config;
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(body));
}

function sendHtml(res, html) {
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(html);
}

function settingsHtml() {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>FlowImage Settings</title>
    <style>
      :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; background: #f6f7f9; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; }
      main { width: min(680px, calc(100vw - 32px)); display: grid; gap: 18px; }
      h1 { margin: 0; font-size: 28px; }
      form { display: grid; gap: 14px; }
      label { display: grid; gap: 6px; font-weight: 600; }
      input { min-height: 40px; border: 1px solid #c7ceda; border-radius: 6px; padding: 0 10px; font: inherit; }
      .actions { display: flex; gap: 8px; flex-wrap: wrap; }
      button { min-height: 38px; border: 1px solid #c7ceda; border-radius: 6px; background: #fff; padding: 0 12px; font: inherit; }
      output { min-height: 24px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace; overflow-wrap: anywhere; }
    </style>
  </head>
  <body>
    <main>
      <h1>FlowImage Settings</h1>
      <form id="settingsForm">
        <label>
          Server URL
          <input id="serverUrl" name="server_url" type="url" required />
        </label>
        <div class="actions">
          <button type="submit">Save</button>
          <button id="testConnection" type="button">Test Connection</button>
        </div>
      </form>
      <output id="status">Loading</output>
    </main>
    <script>
      const status = document.getElementById("status");
      const serverUrl = document.getElementById("serverUrl");
      const form = document.getElementById("settingsForm");
      async function load() {
        const res = await fetch("/api/config");
        const config = await res.json();
        serverUrl.value = config.server_url || "";
        status.value = "Ready";
      }
      async function save() {
        const res = await fetch("/api/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ server_url: serverUrl.value })
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error || "Save failed");
        status.value = "Saved to " + body.config_path;
      }
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        try { await save(); } catch (error) { status.value = error.message; }
      });
      document.getElementById("testConnection").addEventListener("click", async () => {
        try {
          const res = await fetch("/api/test", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ server_url: serverUrl.value })
          });
          const body = await res.json();
          if (!res.ok) throw new Error(body.error || "Connection failed");
          status.value = "Connected to " + body.server_url;
        } catch (error) {
          status.value = error.message;
        }
      });
      load().catch((error) => { status.value = error.message; });
    </script>
  </body>
</html>`;
}

async function testConnection(input) {
  const serverUrl = normalizeServerUrl(input.server_url ?? input.serverUrl);
  if (!serverUrl) throw new Error("server_url is required");
  const res = await fetch(`${serverUrl}/`, { method: "GET" });
  if (!res.ok) throw new Error(`Connection failed: ${res.status}`);
  return { ok: true, server_url: serverUrl };
}

export async function startSettingsServer({
  configPath = defaultConfigPath(),
  host = "127.0.0.1",
  port = 0,
  openBrowser = false
} = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      if (req.method === "GET" && url.pathname === "/") {
        sendHtml(res, settingsHtml());
        return;
      }
      if (req.method === "GET" && url.pathname === "/api/config") {
        sendJson(res, 200, await loadConfig(configPath));
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/config") {
        const config = await saveConfig(configPath, await readJsonBody(req));
        sendJson(res, 200, { ...config, config_path: configPath });
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/test") {
        sendJson(res, 200, await testConnection(await readJsonBody(req)));
        return;
      }
      sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      sendJson(res, 400, { error: error.message });
    }
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const address = server.address();
  const url = `http://${host}:${address.port}`;
  if (openBrowser) spawn("open", [`${url}/`], { stdio: "ignore", detached: true }).unref();
  return {
    url,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  };
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const configPath = defaultConfigPath();
  if (args.has("--print-config")) {
    console.log(JSON.stringify({ config_path: configPath, ...(await loadConfig(configPath)) }, null, 2));
    return;
  }
  const server = await startSettingsServer({ configPath, openBrowser: args.has("--open") });
  console.log(`FlowImage settings: ${server.url}/`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
