# FlowImage Public Pairing MVP Design

**Date:** 2026-06-27  
**Status:** Proposed design for latest business adjustment  
**Workspace:** `/Users/ryu/projects/AgenticProjects/like-water/flow-image`  
**Relationship to current MVP:** This is an incremental design on top of `2026-06-27-flow-image-mvp-design.md`. The existing local single-user MVP stays valid; this document defines the minimal public/self-hosted multi-user pairing model.

## 1. Executive Summary

FlowImage is moving from a local single-user screenshot annotation loop toward an open-source service that can run on any server, with an official hosted endpoint at:

```text
https://flow-image.like-water.net
```

The new business requirement is still intentionally accountless. Users should not need email login, OAuth, organizations, teams, or a permission admin panel. The minimum viable public model is:

```text
server URL + long-lived pair code
```

The FlowImage Codex integration is configured with:

```bash
FLOWIMAGE_SERVER_URL=https://flow-image.like-water.net
FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2LC-V6DZ
```

The pair code is created from the iPad/Web side first. The user opens the FlowImage server, generates a long-lived private pair code, then copies that pair code into the Codex MCP bridge/plugin configuration. After that, Codex and the iPad/Web page are paired through the same FlowImage backend. Codex can publish screenshots into that pair; the iPad can see only sessions belonging to that pair; annotations are returned only to a Codex integration holding the same pair code.

The important design choice: **the pair code is not a short room number. It is a long-lived private pairing key.** It may be shown to the user as a friendly segmented code, but it must have high entropy and must be treated like a password.

## 2. Goals

- Support official hosted FlowImage and self-hosted FlowImage with the same Codex integration.
- Let users configure only two values in the Codex integration: server URL and pair code.
- Let the iPad/Web side generate the pair code first, then copy it into Codex.
- Keep the system accountless: no email, no OAuth, no organization/team model, no billing identity.
- Isolate user data by `pair_id`, so each pair sees only its own sessions, screenshots, and annotations.
- Preserve the explicit Codex loop: publish screenshots, annotate on iPad, collect annotations for review, then modify code only after user confirmation.
- Avoid long-running Codex waits as the default; publishing and collecting remain separate explicit steps.

## 3. Non-Goals

- No full account system.
- No password reset or email recovery.
- No role-based access control.
- No multi-member team management.
- No real-time collaboration.
- No server-side visual interpretation of annotations.
- No automatic code edits immediately after iPad upload.
- No short permanent codes such as `482913`.
- No global hosted-service `BRIDGE_TOKEN` shared by all users.

## 4. Terminology

| Term | Meaning |
|---|---|
| Pair | An accountless private workspace created by the iPad/Web user. |
| Pair code | A long-lived high-entropy private key copied from iPad/Web into Codex configuration. |
| Pair ID | Internal stable identifier for the pair; never used as a secret. |
| Pair device token | Opaque browser token stored on the iPad/Web device after pair creation or binding. |
| Session | One screenshot annotation job created by Codex under a pair. |
| Review-only collect | Codex receives annotation images and stops for human inspection before editing code. |

## 5. Product Flow

### 5.1 First-Time Pair Creation

```text
1. User opens https://flow-image.like-water.net on iPad/Web.
2. User clicks "Generate Pair Code".
3. Backend creates a new pair.
4. Backend returns:
   - pair_id
   - pair_code, shown once/copyable
   - pair_device_token, stored by the browser
5. iPad/Web stores pair_id and pair_device_token locally.
6. User copies pair_code into Codex MCP bridge/plugin configuration.
```

Example pair code format:

```text
FIMG-K7Q9-M4TN-X8PA-R2LC-V6DZ
```

Requirements:

- Code prefix: `FIMG`.
- Code alphabet: uppercase letters and digits excluding visually confusing characters (`0`, `O`, `1`, `I`, `L`).
- Random payload: at least 100 bits of entropy.
- Display: segmented with hyphens for copy/readability.
- Storage: backend stores only `pair_code_hash`, never plaintext.

### 5.2 Codex Configuration

The integration has exactly two required public-mode settings:

```bash
FLOWIMAGE_SERVER_URL=https://flow-image.like-water.net
FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2LC-V6DZ
```

Self-hosted users set:

```bash
FLOWIMAGE_SERVER_URL=https://my-flow-image.example.com
FLOWIMAGE_PAIR_CODE=FIMG-H8RM-Q6WD-P9TA-C3VY-N5ZX
```

For current local development, `PUBLIC_BASE_URL` and `BRIDGE_TOKEN` may continue to exist as compatibility variables. Public paired mode must not rely on a global `BRIDGE_TOKEN`; `FLOWIMAGE_PAIR_CODE` is the user-scoped credential.

### 5.3 Publish Screenshots

```text
1. User asks Codex to screenshot one or more app pages and send them through FlowImage.
2. Codex creates local PNGs using existing Codex/browser/computer-use ability.
3. Codex calls ui_publish_screenshots.
4. MCP bridge sends pair_code to the configured FlowImage server.
5. Backend verifies pair_code and creates a session under that pair_id.
6. Backend stores screenshots under that session.
7. iPad/Web pair page shows the new session in "Pending Annotation".
8. Codex reports that the images were published and stops.
```

Codex should not stay blocked waiting for iPad annotation by default.

### 5.4 Annotate And Return

```text
1. User opens FlowImage on iPad/Web.
2. Browser authenticates with pair_device_token.
3. Browser lists sessions for that pair only.
4. User opens a pending session, annotates one or more pages, and clicks "Return".
5. Backend stores merged PNG annotations under the same pair/session.
6. Session status becomes partially or fully returned.
```

Multi-page behavior remains determined by the number of screenshots Codex uploaded.

### 5.5 Collect For Review

```text
1. User tells Codex: "收取 FlowImage 标注图，先不要修改代码。"
2. Codex calls ui_collect_annotations.
3. MCP bridge uses FLOWIMAGE_PAIR_CODE and session_id to fetch ready annotations.
4. Tool returns:
   - text summary
   - review_url
   - one merged PNG per returned page
   - structured metadata
5. Codex displays or references the images, then stops.
6. User visually checks the images.
7. User says: "确认，按这些标注修改。"
8. Codex modifies code using the already collected images as context.
```

This review gate is mandatory. Returning annotations into context is not permission to edit.

## 6. Data Model

### Pair

```json
{
  "pair_id": "pair_20260627_a1b2c3d4e5f6a7b8",
  "pair_code_hash": "sha256-of-normalized-pair-code",
  "created_at": "2026-06-27T10:00:00.000Z",
  "last_seen_at": "2026-06-27T10:05:00.000Z",
  "revoked_at": null,
  "display_name": "My iPad"
}
```

Rules:

- `pair_id` is public-ish metadata and not a secret.
- `pair_code_hash` is the server-side lookup credential.
- A revoked pair rejects all future session creation, listing, upload, and collect requests.
- Display name is optional and purely local product polish.

### Pair Device

```json
{
  "device_id": "pdev_20260627_001",
  "pair_id": "pair_20260627_a1b2c3d4e5f6a7b8",
  "device_token_hash": "sha256-of-random-device-token",
  "created_at": "2026-06-27T10:00:00.000Z",
  "last_seen_at": "2026-06-27T10:05:00.000Z",
  "revoked_at": null,
  "label": "iPad Safari"
}
```

Rules:

- The browser stores `pair_id` and plaintext `pair_device_token` in localStorage or an HTTP-only cookie.
- Device tokens are used by the iPad/Web app after initial pair creation.
- Pair code can bind a new device if the user opens FlowImage on another browser.

### Session

```json
{
  "session_id": "sess_20260627_8f4a1b9c0d2e3f4a",
  "pair_id": "pair_20260627_a1b2c3d4e5f6a7b8",
  "title": "Settings page review",
  "status": "pending_annotation",
  "created_at": "2026-06-27T10:10:00.000Z",
  "updated_at": "2026-06-27T10:12:00.000Z",
  "expires_at": "2026-06-28T10:10:00.000Z",
  "screenshots": [],
  "annotations": []
}
```

Session status values:

| Status | Meaning |
|---|---|
| `pending_annotation` | Screenshots uploaded, no returned annotation yet. |
| `partially_returned` | Some pages have returned annotations. |
| `returned` | All uploaded pages have returned annotations. |
| `collected` | Codex collected returned annotations for review. |
| `expired` | Session is outside TTL and rejects mutation. |

Screenshot and annotation records stay mostly unchanged from the local MVP, with one addition: every stored file is reachable only after resolving through `pair_id`.

## 7. Storage Layout

The local filesystem store can remain simple, but it must become pair-scoped:

```text
apps/backend/data/pairs/<pair_id>/
├─ pair.json
├─ devices/<device_id>.json
└─ sessions/<session_id>/
   ├─ session.json
   ├─ screenshots/shot_0001.png
   └─ annotations/shot_0001-merged.png
```

Public hosted deployments may later replace this with a database/object store, but the interface should still be pair-scoped.

## 8. Backend API

### Pair APIs

**`POST /api/pairs`**  
Creates a new pair from iPad/Web. No prior auth. Returns:

```json
{
  "pair_id": "pair_20260627_a1b2c3d4e5f6a7b8",
  "pair_code": "FIMG-K7Q9-M4TN-X8PA-R2LC",
  "pair_device_token": "pdevtok_a8b9c0d1e2f34455aa66bb77cc88dd99",
  "server_url": "https://flow-image.like-water.net"
}
```

The backend stores only hashes for `pair_code` and `pair_device_token`.

**`POST /api/pairs/bind-device`**  
Body `{ pair_code, label? }`. Used when the user opens FlowImage on a second browser/device. Returns `{ pair_id, pair_device_token }`.

**`GET /api/pairs/current`**  
Header `X-Pair-Device-Token`. Returns pair metadata and active sessions for that pair.

**`POST /api/pairs/rotate-code`**  
Header `X-Pair-Device-Token`. Returns a new pair code and invalidates the previous pair code. Existing device tokens remain valid.

### Codex/Bridge APIs

**`POST /api/sessions`**  
Header `X-FlowImage-Pair-Code`. Body `{ title }`. Creates a session under the resolved `pair_id`. Returns `{ session_id, status, expires_at }`.

**`POST /api/sessions/:sessionId/screenshots`**  
Header `X-FlowImage-Pair-Code`. Uploads `files[]` and optional `labels[]`. The backend verifies that the session belongs to the pair resolved from the pair code.

**`GET /api/sessions/:sessionId/annotations/ready`**  
Header `X-FlowImage-Pair-Code`. Returns ready merged annotations for that pair/session. Also marks the session `collected` after successful collection.

### iPad/Web Session APIs

**`GET /api/pairs/current/sessions`**  
Header `X-Pair-Device-Token`. Returns sessions belonging to the pair only.

**`GET /api/sessions/:sessionId`**  
Header `X-Pair-Device-Token`. Returns session detail only if the session belongs to the device's pair.

**`GET /api/files/sessions/:sessionId/:kind/:fileName`**  
Header `X-Pair-Device-Token` for browser fetches, or `X-FlowImage-Pair-Code` for bridge reads. The frontend should fetch images as blobs with headers and create object URLs, instead of putting secrets in query strings.

**`POST /api/sessions/:sessionId/annotations/:screenshotId`**  
Header `X-Pair-Device-Token`. Uploads `merged_png` for a screenshot in the same pair.

## 9. MCP Bridge / Plugin Contract

The integration should be described as the **FlowImage Codex integration**. It may be packaged as an MCP bridge now and as a Codex plugin later. The user-facing configuration remains the same.

Required public-mode environment variables:

```bash
FLOWIMAGE_SERVER_URL=https://flow-image.like-water.net
FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2LC-V6DZ
```

Tool changes:

| Tool | Current MVP | Public pairing mode |
|---|---|---|
| `ui_publish_screenshots` | Requires local PNG paths and creates a secret session via `BRIDGE_TOKEN`. | Requires local PNG paths and creates a pair-scoped session via `FLOWIMAGE_PAIR_CODE`. |
| `ui_collect_annotations` | Requires `session_id` and `session_secret`. | Requires `session_id`; pair auth comes from `FLOWIMAGE_PAIR_CODE`. |

Tool result rules:

- Publish returns `session_id`, page count, and a short instruction to open the paired iPad/Web app.
- Publish does not wait for annotation.
- Collect is review-only by default.
- Collect returns `review_url` plus merged PNG images when supported by the client.
- After collect, Codex must wait for explicit user confirmation before modifying files.

Recommended collect text:

```text
已收到 3 张 FlowImage 标注图。请先目视检查图片或打开 review_url。
确认无误后说“确认，按这些标注修改”。在确认前我不会修改代码。
```

## 10. Frontend Changes

The existing annotation canvas stays intentionally small. The main change is the landing and session list flow.

### Landing View

If no local pair device token exists:

- Show product name `FlowImage`.
- Show two actions:
  - `Generate Pair Code`
  - `Enter Existing Pair Code`

After pair creation:

- Show the pair code in copyable segmented form.
- Explain briefly that this is a private code for Codex configuration.
- Show the server URL.
- Show active pending sessions.

### Paired Home View

After local pairing:

- List sessions under this pair only.
- Group by simple statuses: pending, returned, collected/expired.
- Open newest pending session by default when a new one appears.

### Annotation View

Keep existing MVP controls:

- page prev/next
- brush
- eraser
- color
- width
- return button

No account UI, no team settings, no billing, no sharing panel.

## 11. Review Gate

The review gate is part of the business flow, not just a prompt convention.

Rules:

- iPad upload marks annotations as returned, not approved.
- `ui_collect_annotations` brings images into the Codex thread for review, not for immediate editing.
- Codex must stop after collection and ask the user to confirm.
- Code modification begins only after an explicit user phrase such as:

```text
确认，按这些标注修改。
```

This protects the user from accidental or poor-quality annotations being applied without inspection.

## 12. Security And Privacy

### P0 Requirements

- Pair code must be high entropy and long-lived; never use a short permanent numeric code.
- Backend stores pair code hashes only.
- Public hosted mode must not use a shared global `BRIDGE_TOKEN`.
- All sessions, screenshots, annotations, and files must resolve through `pair_id`.
- No endpoint may list sessions across pairs.
- File reads must reject path traversal and verify pair ownership.
- Pair code and device token must not be placed in image URLs.
- Rotate-code invalidates the old pair code immediately.

### Accepted MVP Risks

- No account recovery. If the user loses both iPad/browser state and pair code, the pair is unrecoverable.
- Anyone with the pair code can bind a new device or publish/collect sessions for that pair.
- No server-side per-user quota beyond simple deployment-level limits.
- No audit log beyond created/updated timestamps.

These risks are acceptable for an accountless MVP because the pair code is explicitly treated as a private credential.

## 13. Compatibility And Migration

The local MVP remains useful:

```bash
BRIDGE_TOKEN=dev-token PUBLIC_BASE_URL=http://127.0.0.1:3939 pnpm dev:backend
```

Public pairing mode introduces:

```bash
FLOWIMAGE_SERVER_URL=https://flow-image.like-water.net
FLOWIMAGE_PAIR_CODE=FIMG-K7Q9-M4TN-X8PA-R2LC-V6DZ
```

Implementation should support both modes during transition:

- If `FLOWIMAGE_PAIR_CODE` is present, use public pair mode.
- If `FLOWIMAGE_PAIR_CODE` is absent and `BRIDGE_TOKEN` is present, use local legacy mode.
- README should lead with pair mode once implemented; local legacy mode can move to a development section.

## 14. Testing Requirements

Backend tests:

- Pair creation returns pair code once and stores only hash.
- Pair code format has prefix, segmentation, and sufficient entropy source.
- Pair code can bind a second device.
- Rotating pair code invalidates old pair code.
- Session creation requires a valid pair code.
- Pair A cannot read, list, annotate, or collect Pair B's sessions.
- File reads reject missing token, wrong token, and path traversal.
- iPad upload changes session status from `pending_annotation` to `returned` when all pages are annotated.

Bridge tests:

- Bridge reads `FLOWIMAGE_SERVER_URL` and `FLOWIMAGE_PAIR_CODE`.
- Publish sends pair code and returns pair-scoped session metadata.
- Collect requires only `session_id` from tool input and uses configured pair code.
- Collect returns review-only text and image content.

Frontend tests:

- First visit with no stored token shows generate/bind actions.
- Pair creation stores device token locally.
- Paired home lists only sessions returned by the pair API.
- Session images are fetched as blobs with auth headers.
- Return button uploads merged PNG with device token.

## 15. Open Decisions Locked For MVP

Locked:

- Use pair code instead of account login.
- Pair code is generated from iPad/Web server interaction first.
- Pair code is long-lived and high-entropy.
- Codex integration configuration is server URL plus pair code.
- Public hosted mode does not use global `BRIDGE_TOKEN`.
- Collect remains review-only until explicit user confirmation.

Deferred:

- Email/OAuth login.
- Team sharing.
- Device management UI beyond rotate pair code.
- Per-user quota/billing.
- Database/object storage migration.
- Push notifications or always-on Codex wait loop.
