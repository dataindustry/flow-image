# FlowImage

Local MVP for an explicit Codex image feedback loop:

1. Codex publishes one or more PNG screenshots through `ui_publish_screenshots`.
2. The user opens the returned viewer URL on desktop or iPad.
3. The browser draws annotations and submits one merged PNG per page.
4. Codex collects ready merged images through `ui_collect_annotations`.

This MVP is intentionally merged-only. It does not build transparent overlays, undo, shapes, WebSocket push, hosted accounts, OS-level capture, or automatic cleanup.

## Requirements

- Node.js 22+
- pnpm 11+
- Codex with MCP support
- A user-controlled HTTPS tunnel or LAN URL for iPad testing

## Setup

```bash
pnpm install
cp .env.example .env
```

Edit `.env`:

```bash
PORT=3939
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=http://127.0.0.1:3939
BRIDGE_TOKEN=change-me
```

For iPad over LAN, set:

```bash
BIND_HOST=0.0.0.0
PUBLIC_BASE_URL=http://<mac-lan-ip>:3939
```

For an HTTPS tunnel running on the same Mac, keep `BIND_HOST=127.0.0.1` and set `PUBLIC_BASE_URL` to the tunnel URL.

## Run

```bash
BRIDGE_TOKEN=dev-token PUBLIC_BASE_URL=http://127.0.0.1:3939 pnpm dev:backend
```

Register the MCP bridge:

```bash
codex mcp add flow_image -- node /Users/ryu/projects/AgenticProjects/like-water/flow-image/apps/mcp-bridge/src/index.mjs
```

The bridge reads `PUBLIC_BASE_URL` and `BRIDGE_TOKEN` from its environment.

Naming:

- Product/UI name: `FlowImage`
- Local Codex MCP alias: `flow_image`
- Package/slug name: `flow-image`
- Future MCP Registry name: `net.like-water/flow-image`

## Manual E2E

1. Start the backend.
2. Start/register the MCP bridge.
3. Call `ui_publish_screenshots` with one or more local PNG paths.
4. Open the returned `viewer_url`.
5. Draw, erase, and submit the current page.
6. Call `ui_collect_annotations` with `session_id` and `session_secret`.
7. Confirm Codex receives the merged image content for each ready page.

## Tests

```bash
pnpm test
```
