import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginDir, "../..");
const bridgeUrl = pathToFileURL(path.join(repoRoot, "apps/mcp-bridge/src/index.mjs")).href;
const { startServer } = await import(bridgeUrl);

await startServer();
