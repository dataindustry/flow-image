# FlowImage MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the simplified FlowImage MVP: explicit screenshot publishing, iPad/Web merged-only annotation, and explicit annotation collection.

**Architecture:** A pnpm monorepo contains a local Express backend, a static Web/iPad canvas frontend served by that backend, and a stdio MCP bridge. The backend owns sessions, PNG storage, authenticated same-origin file reads, and upload validation. The bridge owns the two explicit Codex-facing tools and uses backend APIs plus local merged image paths.

**Tech Stack:** Node.js ESM, pnpm workspaces, Express, Multer 2.x, Vitest, Supertest, browser Canvas/Pointer Events, `@modelcontextprotocol/sdk`.

## Global Constraints

- Multi-screenshot per session is kept: pages, prev/next, optional labels stay.
- Output is merged PNG only; transparent overlay is not built in the MVP.
- Public reachability is via a user-controlled HTTPS tunnel.
- `BRIDGE_TOKEN` is required on `POST /api/sessions`.
- Only env vars are `PORT`, `BIND_HOST`, `PUBLIC_BASE_URL`, and `BRIDGE_TOKEN`; TTL, max PNG size, max screenshots, and data dir are code constants.
- Session TTL is 24h; max PNG size is 15 MB; max screenshots per session is 10; `DATA_DIR = apps/backend/data/sessions`.
- All session-scoped endpoints, including file reads, require the session secret.
- PNG magic bytes and IHDR dimensions are validated before storage.
- The frontend draws and exports in native screenshot pixels and sets `touch-action: none`.
- The return mechanism is chosen by a Day-1 spike; build only inline image return or local-path return, not a fallback chain.
- Do not build overlay output, atomic temp-rename writes, automated cleanup, rate limiting, one-time viewer tokens, hosted backend, OS-level capture, shapes, undo, thumbnails, WebSocket, `ops.json`, PencilKit, or team features.

---

## File Structure

Create:

- `package.json` — root scripts and workspace dev dependencies.
- `pnpm-workspace.yaml` — workspace package globs.
- `.env.example` — `PORT`, `BIND_HOST`, `PUBLIC_BASE_URL`, `BRIDGE_TOKEN`.
- `.gitignore` — dependency, build, env, and data ignores.
- `apps/backend/package.json` — backend package scripts and deps.
- `apps/backend/src/server.mjs` — Express app factory and server entry.
- `apps/backend/src/routes/sessions.mjs` — create/get session routes.
- `apps/backend/src/routes/screenshots.mjs` — screenshot upload route.
- `apps/backend/src/routes/annotations.mjs` — merged annotation upload and ready route.
- `apps/backend/src/routes/files.mjs` — authenticated PNG file reads.
- `apps/backend/src/lib/config.mjs` — env and constants.
- `apps/backend/src/lib/ids.mjs` — session, secret, screenshot, and annotation ids.
- `apps/backend/src/lib/png.mjs` — PNG magic/IHDR validation.
- `apps/backend/src/lib/store.mjs` — filesystem session store.
- `apps/backend/test/backend.test.mjs` — backend API tests.
- `apps/web/public/index.html` — viewer shell.
- `apps/web/public/styles.css` — compact touch-usable UI styles.
- `apps/web/public/app.js` — session loading, drawing, export, submit.
- `apps/web/test/frontend.test.mjs` — static frontend behavior tests with jsdom.
- `apps/mcp-bridge/package.json` — bridge package scripts and deps.
- `apps/mcp-bridge/src/index.mjs` — MCP server entry.
- `apps/mcp-bridge/src/backend-client.mjs` — backend API client.
- `apps/mcp-bridge/src/tools/publish.mjs` — `ui_publish_screenshots`.
- `apps/mcp-bridge/src/tools/collect.mjs` — `ui_collect_annotations`.
- `apps/mcp-bridge/test/bridge.test.mjs` — bridge tool tests.
- `README.md` — local run, Codex MCP registration, and manual E2E.

## Task 1: Workspace, Git, And Test Harness

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `.env.example`
- Create: `.gitignore`
- Create: `apps/backend/package.json`
- Create: `apps/mcp-bridge/package.json`
- Test: package script wiring

**Interfaces:**
- Produces root commands: `pnpm test`, `pnpm --filter backend test`, `pnpm --filter mcp-bridge test`.
- Produces env contract: `PORT`, `BIND_HOST`, `PUBLIC_BASE_URL`, `BRIDGE_TOKEN`.

- [ ] **Step 1: Initialize git safely**

Run:

```bash
git init -b main
git add docs/superpowers/specs docs/superpowers/plans
git commit -m "docs: add codex ui loop design and plan"
git switch -c feature/flow-image
```

Expected: repository exists on `feature/flow-image`. If `git commit` fails because identity is missing, set repo-local identity:

```bash
git config user.name "Codex"
git config user.email "codex@example.local"
git commit -m "docs: add codex ui loop design and plan"
git switch -c feature/flow-image
```

- [ ] **Step 2: Create package files**

Create root `package.json`:

```json
{
  "name": "flow-image",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r test",
    "dev:backend": "pnpm --filter backend dev",
    "dev:mcp": "pnpm --filter mcp-bridge dev"
  },
  "devDependencies": {
    "vitest": "^2.1.9"
  }
}
```

Create `pnpm-workspace.yaml`:

```yaml
packages:
  - "apps/*"
```

Create `.env.example`:

```bash
PORT=3939
BIND_HOST=127.0.0.1
PUBLIC_BASE_URL=http://127.0.0.1:3939
BRIDGE_TOKEN=change-me
```

Create `.gitignore`:

```gitignore
node_modules/
.env
apps/backend/data/
coverage/
dist/
.DS_Store
```

Create `apps/backend/package.json`:

```json
{
  "name": "backend",
  "type": "module",
  "scripts": {
    "dev": "node src/server.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "express": "^4.19.2",
    "multer": "^2.0.2"
  },
  "devDependencies": {
    "supertest": "^7.0.0"
  }
}
```

Create `apps/mcp-bridge/package.json`:

```json
{
  "name": "mcp-bridge",
  "type": "module",
  "scripts": {
    "dev": "node src/index.mjs",
    "test": "vitest run"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.17.4",
    "form-data": "^4.0.1"
  }
}
```

- [ ] **Step 3: Install dependencies**

Run:

```bash
pnpm install
```

Expected: lockfile created and dependencies installed.

- [ ] **Step 4: Verify empty package baseline**

Run:

```bash
pnpm test
```

Expected: command reports no test files or package-level no-op failure. If Vitest exits non-zero because there are no tests yet, proceed to Task 2 and treat this as expected baseline before tests exist.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json pnpm-workspace.yaml pnpm-lock.yaml .env.example .gitignore apps/backend/package.json apps/mcp-bridge/package.json
git commit -m "chore: scaffold workspace"
```

Expected: commit succeeds on feature branch.

## Task 2: Backend Session Store And Session Routes

**Files:**
- Create: `apps/backend/src/lib/config.mjs`
- Create: `apps/backend/src/lib/ids.mjs`
- Create: `apps/backend/src/lib/store.mjs`
- Create: `apps/backend/src/routes/sessions.mjs`
- Create: `apps/backend/src/server.mjs`
- Test: `apps/backend/test/backend.test.mjs`

**Interfaces:**
- Produces `createApp(options?: object): express.Application`.
- Produces `createSession({ title }): Promise<Session>`.
- Produces endpoints `POST /api/sessions` and `GET /api/sessions/:sessionId`.

- [ ] **Step 1: Write failing session route tests**

Create `apps/backend/test/backend.test.mjs` with:

```javascript
import { describe, expect, test, beforeEach } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createApp } from "../src/server.mjs";

let dataDir;
let app;

beforeEach(async () => {
  dataDir = await mkdtemp(path.join(tmpdir(), "flow-image-"));
  app = createApp({
    dataDir,
    bridgeToken: "test-token",
    publicBaseUrl: "https://example.test",
    now: () => new Date("2026-06-27T10:00:00.000Z")
  });
  return async () => {
    await rm(dataDir, { recursive: true, force: true });
  };
});

describe("sessions", () => {
  test("requires bridge token to create a session", async () => {
    const res = await request(app).post("/api/sessions").send({ title: "Settings" });
    expect(res.status).toBe(403);
  });

  test("creates a session with public viewer url", async () => {
    const res = await request(app)
      .post("/api/sessions")
      .set("X-Bridge-Token", "test-token")
      .send({ title: "Settings" });

    expect(res.status).toBe(200);
    expect(res.body.session_id).toMatch(/^sess_20260627_[0-9a-f]{16}$/);
    expect(res.body.session_secret).toMatch(/^sec_[A-Za-z0-9_-]{32}$/);
    expect(res.body.viewer_url).toBe(`https://example.test/s/${res.body.session_id}?secret=${res.body.session_secret}`);
    expect(res.body.expires_at).toBe("2026-06-28T10:00:00.000Z");
  });

  test("reads session only with secret", async () => {
    const create = await request(app)
      .post("/api/sessions")
      .set("X-Bridge-Token", "test-token")
      .send({ title: "Settings" });

    const denied = await request(app).get(`/api/sessions/${create.body.session_id}`);
    expect(denied.status).toBe(401);

    const ok = await request(app)
      .get(`/api/sessions/${create.body.session_id}`)
      .query({ secret: create.body.session_secret });
    expect(ok.status).toBe(200);
    expect(ok.body.title).toBe("Settings");
    expect(ok.body.screenshots).toEqual([]);
    expect(ok.body.annotations).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter backend test -- backend.test.mjs
```

Expected: FAIL because `../src/server.mjs` does not exist.

- [ ] **Step 3: Implement config, ids, store, sessions, server**

Create focused modules matching the interfaces above. Use `crypto.randomBytes`, `fs/promises`, JSON files under `dataDir/<session_id>/session.json`, and Express JSON middleware. `createApp()` must accept test overrides.

- [ ] **Step 4: Run test to verify it passes**

Run:

```bash
pnpm --filter backend test -- backend.test.mjs
```

Expected: all session tests PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/backend/src apps/backend/test/backend.test.mjs
git commit -m "feat: add backend sessions"
```

## Task 3: Backend PNG Uploads, File Reads, And Ready Annotations

**Files:**
- Modify: `apps/backend/src/server.mjs`
- Modify: `apps/backend/src/lib/store.mjs`
- Create: `apps/backend/src/lib/png.mjs`
- Create: `apps/backend/src/routes/screenshots.mjs`
- Create: `apps/backend/src/routes/annotations.mjs`
- Create: `apps/backend/src/routes/files.mjs`
- Modify: `apps/backend/test/backend.test.mjs`

**Interfaces:**
- Produces `parsePngMeta(buffer): { width: number, height: number }`.
- Produces endpoints for screenshot upload, merged annotation upload, ready annotations, and authenticated file reads.

- [ ] **Step 1: Add failing upload and file tests**

Append tests that create a session, upload a known 1x1 PNG buffer as `files[]`, verify IHDR dimensions, verify labels map by order, verify non-PNG is 415, verify file reads require secret, verify path traversal is 400, upload `merged_png`, and verify ready returns `merged_png_path`.

Use this 1x1 transparent PNG helper in the test file:

```javascript
const png1x1 = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c6360000002000150a0f53a0000000049454e44ae426082",
  "hex"
);
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter backend test -- backend.test.mjs
```

Expected: FAIL because upload/file/annotation routes are missing.

- [ ] **Step 3: Implement PNG and route logic**

Implement Multer 2 `memoryStorage`, max 10 files, 15 MB per file, magic byte check, IHDR parse, backend-generated filenames, session-scoped secret auth, safe file path resolution constrained to `dataDir`, and plain sequential writes.

- [ ] **Step 4: Run backend tests**

Run:

```bash
pnpm --filter backend test -- backend.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/backend/src apps/backend/test/backend.test.mjs
git commit -m "feat: add screenshot and annotation storage"
```

## Task 4: Static Web Viewer And Canvas Annotation

**Files:**
- Create: `apps/web/public/index.html`
- Create: `apps/web/public/styles.css`
- Create: `apps/web/public/app.js`
- Create: `apps/web/test/frontend.test.mjs`
- Modify: `apps/backend/src/server.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces browser globals for loading `/s/:sessionId?secret=...`, drawing, erasing, exporting one `merged_png`, and submitting.
- Backend serves `apps/web/public` and rewrites `/s/:sessionId` to `index.html`.

- [ ] **Step 1: Write failing frontend tests**

Create jsdom-based tests that import `apps/web/public/app.js` and verify:

```javascript
// expected exported helpers
mapPointToNative({ x: 50, y: 25 }, { cssWidth: 100, cssHeight: 50, imageWidth: 200, imageHeight: 100 })
// returns { x: 100, y: 50 }

computeStrokeWidth({ pointerType: "pen", pressure: 1 }, 4)
// returns 7.2
```

Also assert `styles.css` contains `touch-action: none`.

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm test
```

Expected: FAIL because frontend files/helpers do not exist.

- [ ] **Step 3: Implement static viewer**

Implement compact HTML/CSS/JS. Keep visible UI to viewport, prev/next, brush, eraser, color swatches, line width, submit, and status. Export only merged PNG at native screenshot dimensions. Do not implement overlay, shapes, undo, thumbnails, or WebSocket.

- [ ] **Step 4: Run tests**

Run:

```bash
pnpm test
```

Expected: backend and frontend tests PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/web apps/backend/src/server.mjs package.json
git commit -m "feat: add web annotation viewer"
```

## Task 5: MCP Bridge Tools

**Files:**
- Create: `apps/mcp-bridge/src/backend-client.mjs`
- Create: `apps/mcp-bridge/src/tools/publish.mjs`
- Create: `apps/mcp-bridge/src/tools/collect.mjs`
- Create: `apps/mcp-bridge/src/index.mjs`
- Create: `apps/mcp-bridge/test/bridge.test.mjs`

**Interfaces:**
- Produces `publishScreenshots(args, deps): Promise<McpResult>`.
- Produces `collectAnnotations(args, deps): Promise<McpResult>`.
- Produces MCP tools `ui_publish_screenshots` and `ui_collect_annotations`.

- [ ] **Step 1: Write failing bridge tests**

Create tests with fake backend client:

```javascript
test("publish rejects missing local png before creating session", async () => {
  await expect(publishScreenshots({ session_title: "X", screenshot_paths: ["/missing.png"] }, deps)).rejects.toThrow(/missing/i);
  expect(deps.backend.createSession).not.toHaveBeenCalled();
});

test("collect returns ready_count zero without error", async () => {
  deps.backend.readyAnnotations.mockResolvedValue({ ready_count: 0, items: [] });
  const result = await collectAnnotations({ session_id: "sess_x", session_secret: "sec_x" }, deps);
  expect(result.structuredContent.ready_count).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
pnpm --filter mcp-bridge test
```

Expected: FAIL because bridge modules do not exist.

- [ ] **Step 3: Implement bridge tools**

Implement local file existence checks, backend calls, and collection result. For the return mechanism spike, start with inline image content because MCP spec supports image content. If manual verification shows Codex does not render it, switch the implementation to text/local path only and delete the inline path.

- [ ] **Step 4: Run bridge tests**

Run:

```bash
pnpm --filter mcp-bridge test
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add apps/mcp-bridge
git commit -m "feat: add mcp bridge tools"
```

## Task 6: End-To-End Smoke Test And README

**Files:**
- Create: `README.md`
- Modify: tests only if E2E exposes integration gaps.

**Interfaces:**
- Documents `pnpm install`, backend start, MCP registration command, tunnel setup expectations, and manual E2E flow.

- [ ] **Step 1: Write README**

Include exact commands:

```bash
pnpm install
cp .env.example .env
pnpm dev:backend
codex mcp add flow_image -- node /Users/ryu/projects/AgenticProjects/LIKE-WATER/apps/mcp-bridge/src/index.mjs
```

State that iPad testing requires `PUBLIC_BASE_URL` to point at an HTTPS tunnel or LAN URL.

- [ ] **Step 2: Run all automated tests**

Run:

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 3: Start backend**

Run:

```bash
BRIDGE_TOKEN=dev-token PUBLIC_BASE_URL=http://127.0.0.1:3939 pnpm dev:backend
```

Expected: server prints listening URL. Keep it running for smoke test.

- [ ] **Step 4: Exercise API smoke path**

In another shell:

```bash
curl -s -X POST http://127.0.0.1:3939/api/sessions \
  -H 'Content-Type: application/json' \
  -H 'X-Bridge-Token: dev-token' \
  -d '{"title":"Smoke"}'
```

Expected: JSON with `session_id`, `session_secret`, `viewer_url`, and `expires_at`.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md
git commit -m "docs: add local mvp runbook"
```

## Task 7: Final Verification

**Files:**
- No planned code changes.

**Interfaces:**
- Verifies all requirements in the simplified design.

- [ ] **Step 1: Run full test suite**

Run:

```bash
pnpm test
```

Expected: all tests PASS.

- [ ] **Step 2: Verify no forbidden MVP scope crept in**

Run:

```bash
rg -n "overlay|include_overlay|include_merged|page_indices|WebSocket|ops\\.json|cleanup" apps README.md
```

Expected: no production implementation of deferred features. Mentions in README as "deferred" are acceptable.

- [ ] **Step 3: Verify git state**

Run:

```bash
git status --short
```

Expected: clean worktree.
