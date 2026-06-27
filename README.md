# FlowImage

MVP for an explicit Codex image feedback loop:

1. Codex publishes one or more PNG screenshots through `ui_publish_screenshots`.
2. The paired iPad/Web FlowImage page shows those screenshots.
3. The browser draws annotations and submits one merged PNG per page.
4. Codex collects ready merged images through `ui_collect_annotations` for review.
5. Codex modifies code only after explicit user confirmation.

This MVP is intentionally merged-only and accountless. It uses a long-lived private pair code instead of email/OAuth accounts.

## Requirements

- Node.js 22+
- pnpm 11+
- Codex with MCP support
- A FlowImage server: the official hosted server, your self-hosted server, or a local dev server

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

FLOWIMAGE_SERVER_URL=https://flow-image.like-water.net
FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2CZ-V6DZ-J3WY
```

## Public Pair Mode

1. Open your FlowImage server on iPad/Web.
2. Click **Generate Pair Code**.
3. Copy the generated code into `FLOWIMAGE_PAIR_CODE`.
4. Set `FLOWIMAGE_SERVER_URL` to the server you opened.
5. Register the MCP bridge with those values.

```bash
codex mcp add flow_image \
  --env FLOWIMAGE_SERVER_URL=https://flow-image.like-water.net \
  --env FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2CZ-V6DZ-J3WY \
  -- node /Users/ryu/projects/AgenticProjects/like-water/flow-image/apps/mcp-bridge/src/index.mjs
```

The pair code is a private credential. It is shown once by the server and should not be pasted into screenshots or public logs.

## Local Legacy Mode

For local iPad testing over LAN, set:

```bash
BIND_HOST=0.0.0.0
PUBLIC_BASE_URL=http://<mac-lan-ip>:3939
```

For an HTTPS tunnel running on the same Mac, keep `BIND_HOST=127.0.0.1` and set `PUBLIC_BASE_URL` to the tunnel URL.

## Run

```bash
BRIDGE_TOKEN=dev-token PUBLIC_BASE_URL=http://127.0.0.1:3939 pnpm dev:backend
```

Register the legacy MCP bridge:

```bash
codex mcp add flow_image -- node /Users/ryu/projects/AgenticProjects/like-water/flow-image/apps/mcp-bridge/src/index.mjs
```

In public pair mode, the bridge reads `FLOWIMAGE_SERVER_URL` and `FLOWIMAGE_PAIR_CODE`. In local legacy mode, it reads `PUBLIC_BASE_URL` and `BRIDGE_TOKEN`.

Naming:

- Product/UI name: `FlowImage`
- Local Codex MCP alias: `flow_image`
- Package/slug name: `flow-image`
- Future MCP Registry name: `net.like-water/flow-image`

## Manual E2E

1. Start the backend.
2. Start/register the MCP bridge.
3. Generate or bind a pair code in the FlowImage web page.
4. Call `ui_publish_screenshots` with one or more local PNG paths.
5. Open the paired iPad/Web page and annotate the new session.
6. Click Submit/Return for the annotated page.
7. Call `ui_collect_annotations` with `session_id`, or omit it to collect the latest returned session for that pair.
8. Inspect the returned images/review URL.
9. Tell Codex explicitly: `确认，按这些标注修改`.

## Tests

```bash
pnpm test
```
