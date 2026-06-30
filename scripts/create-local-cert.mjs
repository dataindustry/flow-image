import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { firstLanIPv4 } from "./platform.mjs";

const lanHost = process.env.FLOWIMAGE_LAN_HOST || firstLanIPv4();
const certPath = process.env.HTTPS_CERT_PATH || ".certs/flowimage.pem";
const keyPath = process.env.HTTPS_KEY_PATH || ".certs/flowimage-key.pem";

await mkdir(".certs", { recursive: true });

run("mkcert", ["-install"], {
  missingMessage:
    "mkcert is required. Install it first: macOS `brew install mkcert`; Windows `winget install FiloSottile.mkcert` or use Chocolatey/Scoop."
});
run("mkcert", [
  "-cert-file",
  certPath,
  "-key-file",
  keyPath,
  lanHost,
  "localhost",
  "127.0.0.1",
  "::1"
]);

console.log(`
FlowImage local HTTPS certificate created.

Start HTTPS server:
  PUBLIC_BASE_URL=https://${lanHost}:3939 corepack pnpm@11.7.0 dev:https

Configure FlowImage plugin server_url:
  https://${lanHost}:3939

For iPad, the mkcert root CA still has to be trusted on the device.
`);

function run(command, args, { missingMessage } = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    windowsHide: false,
    shell: process.platform === "win32"
  });
  if (result.error?.code === "ENOENT") {
    console.error(missingMessage ?? `${command} is required.`);
    process.exit(1);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}
