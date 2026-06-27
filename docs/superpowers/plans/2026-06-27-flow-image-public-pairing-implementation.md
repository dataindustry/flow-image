# FlowImage Public Pairing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade FlowImage from local secret sessions to an accountless public/self-hosted pairing model using `FLOWIMAGE_SERVER_URL` and `FLOWIMAGE_PAIR_CODE`.

**Architecture:** Keep the existing pnpm monorepo and filesystem store. Add pair-scoped storage under `apps/backend/data/pairs/<pair_id>`, expose pair/device APIs for the iPad/Web app, use pair-code headers for Codex bridge APIs, and keep legacy `BRIDGE_TOKEN`/session-secret mode during transition. The frontend becomes pair-aware and fetches images as authenticated blobs; the bridge supports public pair mode and review-only collection.

**Tech Stack:** Node.js ESM, Express, Multer 2.x, Vitest, Supertest, browser Canvas/Pointer Events, `@modelcontextprotocol/sdk`.

## Global Constraints

- Product/UI name remains `FlowImage`.
- Official hosted default is `https://flow-image.like-water.net`.
- Public mode configuration is exactly `FLOWIMAGE_SERVER_URL` plus `FLOWIMAGE_PAIR_CODE`.
- Pair code format is `FIMG-xxxx-xxxx-xxxx-xxxx-xxxx-xxxx`, with 6 groups of 4 effective characters from the approved alphabet.
- Public hosted mode must not rely on a shared global `BRIDGE_TOKEN`.
- Browser stores `pair_id` and `pair_device_token` in localStorage and sends `X-Pair-Device-Token`.
- Pair code and device token must never be placed in image URLs.
- Collection uses `POST /api/sessions/:sessionId/annotations/collect` or `POST /api/annotations/collect-latest`; no state-changing GET.
- Collect is review-only; Codex must wait for explicit user confirmation before modifying files.
- Frontend renders user/Codex-controlled strings with `textContent`, never `innerHTML`.
- Public paired sessions expire 7 days after last activity.

---

## File Structure

- Modify `apps/backend/src/lib/ids.mjs` — add pair/device/token/code ID generators.
- Modify `apps/backend/src/lib/store.mjs` — add pair-scoped storage while preserving legacy sessions.
- Create `apps/backend/src/lib/auth.mjs` — normalize pair codes, hash codes/tokens, resolve pair/device credentials.
- Create `apps/backend/src/routes/pairs.mjs` — pair creation, bind, current, rotate.
- Modify `apps/backend/src/routes/sessions.mjs` — support pair-code session creation and legacy bridge-token creation.
- Modify `apps/backend/src/routes/screenshots.mjs` — accept pair-code auth or legacy session secret.
- Modify `apps/backend/src/routes/annotations.mjs` — accept pair-device upload and pair-code collect POST APIs.
- Modify `apps/backend/src/routes/files.mjs` — accept pair-device or pair-code headers; keep legacy secret query support.
- Modify `apps/backend/src/server.mjs` — wire pair routes and CSP header.
- Modify `apps/backend/test/backend.test.mjs` — add public pairing behavior tests before implementation.
- Modify `apps/mcp-bridge/src/backend-client.mjs` — support `FLOWIMAGE_SERVER_URL`/`FLOWIMAGE_PAIR_CODE` and collect-latest.
- Modify `apps/mcp-bridge/src/tools/publish.mjs` — branch between public pair mode and legacy mode.
- Modify `apps/mcp-bridge/src/tools/collect.mjs` — make `session_id` optional in public mode and return review-only text.
- Modify `apps/mcp-bridge/src/index.mjs` — make `session_id` optional in collect schema.
- Modify `apps/mcp-bridge/test/bridge.test.mjs` — add pair-mode client tests.
- Modify `apps/web/public/index.html` — add pair landing/home containers.
- Modify `apps/web/public/app.js` — localStorage pair state, pair APIs, authenticated blob image loads, safe text rendering.
- Modify `apps/web/public/styles.css` — compact pair landing/home UI.
- Modify `apps/web/test/frontend.test.mjs` — pair helper and no-HTML-injection tests.
- Modify `README.md` and `.env.example` — document pair mode first and local legacy mode second.

## Task 1: Backend Pair Credentials And Pair APIs

**Files:**
- Modify: `apps/backend/src/lib/ids.mjs`
- Create: `apps/backend/src/lib/auth.mjs`
- Modify: `apps/backend/src/lib/store.mjs`
- Create: `apps/backend/src/routes/pairs.mjs`
- Modify: `apps/backend/src/server.mjs`
- Test: `apps/backend/test/backend.test.mjs`

**Interfaces:**
- Produces `makePairCode(): string`, `normalizePairCode(code): string`, `hashCredential(value): string`.
- Produces store methods `createPair({ label })`, `bindDeviceByPairCode({ pairCode, label })`, `rotatePairCode({ deviceToken })`, `getPairForCode(pairCode)`, `getPairForDeviceToken(deviceToken)`.
- Produces API endpoints `POST /api/pairs`, `POST /api/pairs/bind-device`, `GET /api/pairs/current`, `POST /api/pairs/rotate-code`.

- [ ] **Step 1: Write failing backend tests for pair creation, binding, current, rotation.**
- [ ] **Step 2: Run `pnpm --filter backend test -- --runInBand` or `pnpm --filter backend test` and confirm new tests fail.**
- [ ] **Step 3: Implement pair code generation, hashing, pair/device storage, and routes.**
- [ ] **Step 4: Run backend tests and confirm pass.**
- [ ] **Step 5: Commit `feat: add FlowImage pair APIs`.**

## Task 2: Pair-Scoped Sessions, Files, And Collection

**Files:**
- Modify: `apps/backend/src/lib/store.mjs`
- Modify: `apps/backend/src/routes/sessions.mjs`
- Modify: `apps/backend/src/routes/screenshots.mjs`
- Modify: `apps/backend/src/routes/annotations.mjs`
- Modify: `apps/backend/src/routes/files.mjs`
- Test: `apps/backend/test/backend.test.mjs`

**Interfaces:**
- Consumes pair credential helpers from Task 1.
- Produces pair-mode `POST /api/sessions`, `POST /api/sessions/:sessionId/screenshots`, `POST /api/sessions/:sessionId/annotations/:screenshotId`, `POST /api/sessions/:sessionId/annotations/collect`, `POST /api/annotations/collect-latest`, and authenticated file reads.

- [ ] **Step 1: Write failing tests for pair-scoped session creation/upload/file/annotation/collect and cross-pair denial.**
- [ ] **Step 2: Run backend tests and confirm new tests fail.**
- [ ] **Step 3: Implement pair-scoped session storage and auth while preserving legacy tests.**
- [ ] **Step 4: Run backend tests and confirm pass.**
- [ ] **Step 5: Commit `feat: add pair-scoped sessions`.**

## Task 3: MCP Bridge Public Pair Mode

**Files:**
- Modify: `apps/mcp-bridge/src/backend-client.mjs`
- Modify: `apps/mcp-bridge/src/tools/publish.mjs`
- Modify: `apps/mcp-bridge/src/tools/collect.mjs`
- Modify: `apps/mcp-bridge/src/index.mjs`
- Test: `apps/mcp-bridge/test/bridge.test.mjs`

**Interfaces:**
- Consumes public backend APIs from Task 2.
- Produces `BackendClient` behavior using `FLOWIMAGE_SERVER_URL` and `FLOWIMAGE_PAIR_CODE` when present, otherwise legacy mode.
- `ui_collect_annotations` accepts optional `session_id` in public mode and returns review-only text plus images.

- [ ] **Step 1: Write failing bridge tests for pair-mode publish, collect by session, collect latest, and review-only text.**
- [ ] **Step 2: Run bridge tests and confirm new tests fail.**
- [ ] **Step 3: Implement pair-mode backend client and tool behavior.**
- [ ] **Step 4: Run bridge tests and confirm pass.**
- [ ] **Step 5: Commit `feat: add pair mode to mcp bridge`.**

## Task 4: Pair-Aware Web Frontend

**Files:**
- Modify: `apps/web/public/index.html`
- Modify: `apps/web/public/app.js`
- Modify: `apps/web/public/styles.css`
- Test: `apps/web/test/frontend.test.mjs`

**Interfaces:**
- Consumes `POST /api/pairs`, `POST /api/pairs/bind-device`, `GET /api/pairs/current`, `GET /api/sessions/:sessionId`, file blob fetches with `X-Pair-Device-Token`, and annotation upload with `X-Pair-Device-Token`.
- Produces pair landing/home and existing annotation view.

- [ ] **Step 1: Write failing frontend tests for pair localStorage state, safe text rendering, and secret-free blob image URLs.**
- [ ] **Step 2: Run web tests and confirm new tests fail.**
- [ ] **Step 3: Implement pair landing/home, authenticated blob loads, and safe rendering.**
- [ ] **Step 4: Run web tests and confirm pass.**
- [ ] **Step 5: Commit `feat: add paired web flow`.**

## Task 5: Docs, Full Verification, And App Smoke

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

**Interfaces:**
- Documents public pair mode and legacy local mode.

- [ ] **Step 1: Update README and `.env.example` with pair-mode configuration.**
- [ ] **Step 2: Run `pnpm test`; expected all backend, bridge, and web tests pass.**
- [ ] **Step 3: Start backend with local defaults and verify `GET /` returns FlowImage HTML.**
- [ ] **Step 4: Check `git status --short` and commit `docs: document FlowImage pair mode`.**

## Self-Review

- Spec coverage: Tasks cover pair code generation, pair/device APIs, pair-scoped storage, collect POST semantics, collect-latest, bridge pair-mode config, pair-aware frontend, review-only text, token/header image loading, CSP/safe rendering, and docs.
- Placeholder scan: no TBD/TODO/fill-in placeholders.
- Type consistency: `pair_code`, `pair_id`, `pair_device_token`, `X-FlowImage-Pair-Code`, and `X-Pair-Device-Token` are used consistently with the design doc.
