# FlowImage

FlowImage is a Codex image feedback loop for UI work.

It lets Codex publish screenshots to a browser/iPad canvas, lets a human draw or edit on that canvas, then lets Codex collect the returned PNG results before making code changes.

The MVP is intentionally small:

1. Codex publishes one or more PNG screenshots through `flow_image_publish`.
2. FlowImage creates a session with short View, Edit, and Owner links.
3. The Edit link opens a canvas where a human can draw, erase, zoom, and save results.
4. Codex collects ready merged PNG results through `flow_image_sync`.
5. Codex modifies code only after explicit user confirmation.

FlowImage is accountless. Permissions are capability links:

- `View Link`: read-only.
- `Edit Link`: can draw and submit canvas results.
- `Owner Link`: can manage retention and copy View/Edit links.
- `Owner Token`: stored locally by the Codex bridge so Codex can upload screenshots and collect results.

Do not post Edit or Owner links publicly. Anyone with an Edit Link can change that session. Anyone with an Owner Link can change retention and share links.

## Repo Layout

```text
flow-image/
├─ .agents/plugins/marketplace.json
├─ apps/
│  ├─ backend/       # Express + SQLite FlowImage server
│  ├─ mcp-bridge/    # MCP tools used by Codex
│  └─ web/           # Browser/iPad canvas frontend
├─ plugins/
│  └─ flow-image/    # Codex plugin package
│     ├─ .codex-plugin/plugin.json
│     ├─ .mcp.json
│     ├─ scripts/
│     └─ skills/
└─ package.json
```

Server state is stored in SQLite at:

```text
apps/backend/data/flowimage.sqlite
```

PNG files live under:

```text
apps/backend/data/files/
```

## Requirements

- Node.js 22+
- pnpm 11+
- Codex with plugin and MCP support
- A reachable FlowImage server:
  - official hosted server, or
  - your self-hosted server, or
  - a local/LAN dev server

## Install From GitHub

This repository is designed to be shared as a standalone GitHub repo.

On another computer, install the plugin directly from GitHub:

```bash
codex plugin marketplace add https://github.com/<github-owner>/flow-image --ref main
codex plugin add flow-image@flow-image-local
```

Then configure the FlowImage server URL:

```bash
mkdir -p ~/.flowimage
cat > ~/.flowimage/config.json <<'JSON'
{
  "server_url": "https://flow-image.liujinhang.com"
}
JSON
chmod 600 ~/.flowimage/config.json
```

For a LAN dev server, use your server machine IP instead:

```json
{
  "server_url": "http://192.168.2.72:3939"
}
```

Verify:

```bash
codex plugin list --marketplace flow-image-local
node ~/.codex/plugins/cache/flow-image-local/flow-image/0.1.0/scripts/settings-server.mjs --print-config
```

Restart Codex or open a new Codex thread after installation.

## AI Agent Install Instructions

If you are an AI coding agent installing FlowImage for a user, follow this exact flow.

Assumptions:

- The user gives you the GitHub repo URL.
- The user gives you the FlowImage server URL, or asks you to use the default hosted server.
- Do not ask for a pair code. FlowImage no longer uses pair codes.
- Prefer plugin installation over naked `codex mcp add`.

Set variables:

```bash
FLOWIMAGE_REPO_URL="https://github.com/<github-owner>/flow-image"
FLOWIMAGE_SERVER_URL="https://flow-image.liujinhang.com"
```

One-block install command for agents:

```bash
FLOWIMAGE_REPO_URL="https://github.com/<github-owner>/flow-image" \
FLOWIMAGE_SERVER_URL="https://flow-image.liujinhang.com" \
bash <<'FLOWIMAGE_INSTALL'
set -euo pipefail

: "${FLOWIMAGE_REPO_URL:?FLOWIMAGE_REPO_URL is required}"
: "${FLOWIMAGE_SERVER_URL:?FLOWIMAGE_SERVER_URL is required}"

codex plugin marketplace add "$FLOWIMAGE_REPO_URL" --ref main
codex plugin add flow-image@flow-image-local

mkdir -p "$HOME/.flowimage"
cat > "$HOME/.flowimage/config.json" <<JSON
{
  "server_url": "$FLOWIMAGE_SERVER_URL"
}
JSON
chmod 600 "$HOME/.flowimage/config.json"

codex plugin list --marketplace flow-image-local
node "$HOME/.codex/plugins/cache/flow-image-local/flow-image/0.1.0/scripts/settings-server.mjs" --print-config
FLOWIMAGE_INSTALL
```

Install the marketplace and plugin:

```bash
codex plugin marketplace add "$FLOWIMAGE_REPO_URL" --ref main
codex plugin add flow-image@flow-image-local
```

Write local config:

```bash
mkdir -p ~/.flowimage
cat > ~/.flowimage/config.json <<JSON
{
  "server_url": "$FLOWIMAGE_SERVER_URL"
}
JSON
chmod 600 ~/.flowimage/config.json
```

Verify installation:

```bash
codex plugin list --marketplace flow-image-local
node ~/.codex/plugins/cache/flow-image-local/flow-image/0.1.0/scripts/settings-server.mjs --print-config
```

Expected:

- `flow-image` appears in `codex plugin list`.
- The printed config contains the selected `server_url`.
- A new Codex thread exposes the FlowImage skill and bundled `flow_image` MCP tools.

Then tell the user:

```text
FlowImage is installed. Restart Codex or open a new thread, then ask Codex to publish screenshots with FlowImage.
```

## Configure With Settings Page

Instead of writing `~/.flowimage/config.json` manually, you can open the plugin settings page:

```bash
node ~/.codex/plugins/cache/flow-image-local/flow-image/0.1.0/scripts/settings-server.mjs --open
```

The settings page writes:

```text
~/.flowimage/config.json
```

Only `server_url` is required.

## Use With Codex

After installation and configuration, ask Codex to publish screenshots:

```text
Use FlowImage to publish screenshots of the current UI.
```

Codex should call:

```text
flow_image_publish
```

FlowImage returns:

- View Link
- Edit Link
- Owner Link
- `session_id`

Open the Edit Link on iPad/Web, draw on the canvas, and save or use Realtime mode.

Then ask Codex to collect results:

```text
Collect the latest FlowImage results.
```

Codex should call:

```text
flow_image_sync
```

Important workflow rule:

```text
After collecting results, Codex should show or summarize the returned images first.
Codex should not modify application code until the user explicitly confirms.
```

Example confirmation:

```text
确认，按这些结果修改。
```

## Run A Local Server

Install dependencies:

```bash
corepack pnpm@11.7.0 install
cp .env.example .env
```

Start the dev server for LAN/iPad use:

```bash
corepack pnpm@11.7.0 dev:backend
```

The default dev bind host is `0.0.0.0`. The backend prints a usable `FlowImage public URL`, such as:

```bash
FlowImage public URL http://192.168.2.72:3939
```

Use that URL in each Codex computer's FlowImage config:

```json
{
  "server_url": "http://<server-lan-ip>:3939"
}
```

If you need to force a specific public URL:

```bash
BIND_HOST=0.0.0.0 PUBLIC_BASE_URL=http://<server-lan-ip>:3939 corepack pnpm@11.7.0 dev:backend
```

For local-only testing, explicitly bind localhost:

```bash
BIND_HOST=127.0.0.1 PUBLIC_BASE_URL=http://127.0.0.1:3939 corepack pnpm@11.7.0 dev:backend
```

### Local HTTPS For Clipboard Support

Browsers only allow writing PNG images to the system clipboard in a secure context, usually HTTPS or localhost. For iPad/LAN use, run FlowImage over HTTPS with a locally trusted certificate.

Recommended local certificate flow:

```bash
brew install mkcert
corepack pnpm@11.7.0 cert:local
```

The script creates:

```text
.certs/flowimage.pem
.certs/flowimage-key.pem
```

Start the HTTPS server:

```bash
PUBLIC_BASE_URL=https://<server-lan-ip>:3939 corepack pnpm@11.7.0 dev:https
```

Then configure each Codex computer with:

```json
{
  "server_url": "https://<server-lan-ip>:3939"
}
```

For iPad, install and trust the mkcert Root CA:

```bash
mkcert -CAROOT
```

Copy `rootCA.pem` from that directory to the iPad, install the profile, then enable full trust in:

```text
Settings -> General -> About -> Certificate Trust Settings
```

The certificate generated by `cert:local` includes the current LAN IP, `localhost`, `127.0.0.1`, and `::1`.

### Copy Image On HTTP LAN

On plain HTTP LAN URLs, the `Copy Image` button automatically downloads a PNG instead of showing an HTTPS error. On HTTPS deployments, the same button writes the PNG to the system clipboard when the browser allows it.

## Direct MCP Development Mode

For development, you can bypass plugin installation and register the MCP bridge directly:

```bash
codex mcp add flow_image \
  --env FLOWIMAGE_SERVER_URL=http://127.0.0.1:3939 \
  -- node <flow-image-repo>/apps/mcp-bridge/src/index.mjs
```

This is useful while editing the bridge. For normal distribution, prefer the Codex plugin install path.

## Publish This Repo To GitHub

Recommended: make `flow-image/` its own standalone GitHub repository.

```bash
cd /path/to/flow-image
git init
git add .
git commit -m "Package FlowImage Codex plugin"
git branch -M main
git remote add origin git@github.com:<github-owner>/flow-image.git
git push -u origin main
```

Another computer can then install it with:

```bash
codex plugin marketplace add https://github.com/<github-owner>/flow-image --ref main
codex plugin add flow-image@flow-image-local
```

If the repo is private, make sure the target computer has GitHub credentials that can clone it.

## Naming

- Product/UI name: `FlowImage`
- Codex plugin name: `flow-image`
- Local Codex MCP alias: `flow_image`
- Package/slug name: `flow-image`
- Future MCP Registry name: `net.like-water/flow-image`

## Manual E2E

1. Start a FlowImage server.
2. Install the Codex plugin.
3. Configure `~/.flowimage/config.json`.
4. Ask Codex to call `flow_image_publish`.
5. Open the returned Edit Link on iPad/Web.
6. Draw, erase, zoom, submit, or use Realtime save.
7. Open the View Link on another browser to confirm sync.
8. Ask Codex to call `flow_image_sync`.
9. Inspect the returned images/review URL.
10. Tell Codex explicitly: `确认，按这些结果修改`.

## Tests

```bash
corepack pnpm@11.7.0 test
corepack pnpm@11.7.0 dev:check
git diff --check
```

## Troubleshooting

If the plugin is installed but tools do not appear:

1. Restart Codex or open a new thread.
2. Check that the plugin is installed:

```bash
codex plugin list --marketplace flow-image-local
```

3. Check config:

```bash
cat ~/.flowimage/config.json
```

4. Check server reachability:

```bash
curl -i "$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME + "/.flowimage/config.json", "utf8")).server_url)')/"
```

5. If another bare MCP server named `flow_image` was registered before, remove it:

```bash
codex mcp remove flow_image
```

Then restart Codex.
