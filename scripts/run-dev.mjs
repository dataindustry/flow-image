import { spawn } from "node:child_process";
import { pnpmCommand } from "./platform.mjs";

const mode = process.argv[2] ?? "backend";
const env = { ...process.env };

if (mode === "backend" || mode === "lan") {
  env.BIND_HOST = env.BIND_HOST || "0.0.0.0";
} else if (mode === "https") {
  env.BIND_HOST = env.BIND_HOST || "0.0.0.0";
  env.HTTPS_CERT_PATH = env.HTTPS_CERT_PATH || ".certs/flowimage.pem";
  env.HTTPS_KEY_PATH = env.HTTPS_KEY_PATH || ".certs/flowimage-key.pem";
} else {
  console.error(`Unknown dev mode: ${mode}`);
  process.exit(1);
}

const pnpm = pnpmCommand();
const child = spawn(
  pnpm.command,
  [...pnpm.args, "--filter", "backend", "dev"],
  { stdio: "inherit", env, windowsHide: false }
);

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
