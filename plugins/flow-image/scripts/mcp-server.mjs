import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const pluginDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(pluginDir, "../..");

await import(pathToFileURL(path.join(repoRoot, "apps/mcp-bridge/src/index.mjs")).href);
