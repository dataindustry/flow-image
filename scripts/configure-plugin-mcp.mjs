import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const repoDir = path.resolve(process.argv[2] ?? process.cwd());
const pluginManifest = JSON.parse(
  await readFile(path.join(repoDir, "plugins", "flow-image", ".codex-plugin", "plugin.json"), "utf8")
);
const pluginCacheEnv = String(process.env.FLOWIMAGE_PLUGIN_CACHE ?? "").trim();
const pluginCache =
  pluginCacheEnv ||
  path.join(
    os.homedir(),
    ".codex",
    "plugins",
    "cache",
    "flow-image-local",
    "flow-image",
    pluginManifest.version
  );
const configPathEnv = String(process.env.FLOWIMAGE_CONFIG_PATH ?? "").trim();
const configPath = configPathEnv || path.join(os.homedir(), ".flowimage", "config.json");
const mcpPath = path.join(pluginCache, ".mcp.json");

await mkdir(path.dirname(mcpPath), { recursive: true });
await writeFile(
  mcpPath,
  JSON.stringify(
    {
      mcpServers: {
        flow_image: {
          command: "node",
          args: [path.join(repoDir, "apps", "mcp-bridge", "src", "index.mjs")],
          env: {
            FLOWIMAGE_CONFIG_PATH: configPath
          }
        }
      }
    },
    null,
    2
  )
);

console.log(`FlowImage plugin MCP config written to ${mcpPath}`);
