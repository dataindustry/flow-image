import { describe, expect, test } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  mapPointToNative,
  computeStrokeWidth,
  strokeWidthForTool,
  canDrawWithPointer,
  drawingPointerEvents,
  drawingTouchEvent,
  drawingStatusText,
  touchPanDelta,
  autosaveIntervalFromValue,
  readSyncInterval,
  writeSyncInterval,
  shouldAutosave,
  shouldSyncOnStrokeEnd,
  shouldApplyRemoteAnnotation,
  createWorkspaceMetrics,
  annotationLayerPlacement,
  workspaceExpansionForPoint,
  expandWorkspaceMetrics,
  cacheBustedImageUrl,
  releaseObjectUrl,
  canCopyPngToClipboard,
  copyPngBlobToClipboard,
  copyOrDownloadPngBlob,
  copyTextToClipboard,
  shareRouteFromPath,
  createRootIdempotencyKey,
  readOrCreateRootIdempotencyKey,
  createRootSession,
  accessHeaders,
  canEditAccess,
  shareControlState,
  qrTargetsForAccess,
  fetchQrObjectUrl,
  retentionMaxForUnit,
  setSafeText,
  fetchImageObjectUrl
} from "../public/app.js";

describe("canvas helpers", () => {
  test("maps CSS pointer coordinates to native screenshot pixels", () => {
    expect(
      mapPointToNative(
        { x: 50, y: 25 },
        { cssWidth: 100, cssHeight: 50, imageWidth: 200, imageHeight: 100 }
      )
    ).toEqual({ x: 100, y: 50 });
  });

  test("computes pressure-adjusted pen width", () => {
    expect(computeStrokeWidth({ pointerType: "pen", pressure: 1 }, 4)).toBeCloseTo(12);
    expect(computeStrokeWidth({ pointerType: "pen", pressure: 0.1 }, 4)).toBeCloseTo(2.46);
    expect(computeStrokeWidth({ pointerType: "touch", pressure: 0.8 }, 4)).toBeCloseTo(9.88);
    expect(computeStrokeWidth({ pointerType: "mouse", pressure: 0 }, 4)).toBeCloseTo(4.8);
  });

  test("uses a wider eraser stroke so removal is visibly responsive", () => {
    expect(strokeWidthForTool("brush", { pointerType: "pen", pressure: 1 }, 4)).toBeCloseTo(12);
    expect(strokeWidthForTool("eraser", { pointerType: "pen", pressure: 1 }, 4)).toBeCloseTo(48);
  });

  test("allows drawing only from pen and desktop mouse input", () => {
    expect(canDrawWithPointer({ pointerType: "pen" })).toBe(true);
    expect(canDrawWithPointer({ pointerType: "mouse" })).toBe(true);
    expect(canDrawWithPointer({ pointerType: "touch" })).toBe(false);
  });

  test("falls back to the pointermove event when coalesced events are empty", () => {
    const event = {
      clientX: 10,
      clientY: 20,
      getCoalescedEvents: () => []
    };

    expect(drawingPointerEvents(event)).toEqual([event]);
  });

  test("normalizes touch input for drawing fallback", () => {
    const event = {
      changedTouches: [{ clientX: 12, clientY: 34, force: 0.8 }],
      touches: []
    };

    expect(drawingTouchEvent(event)).toEqual({
      clientX: 12,
      clientY: 34,
      pointerType: "touch",
      pressure: 0.8
    });
  });

  test("computes single-finger pan deltas without creating drawing input", () => {
    expect(
      touchPanDelta(
        { clientX: 100, clientY: 80 },
        { clientX: 130, clientY: 70 }
      )
    ).toEqual({ scrollX: -30, scrollY: 10 });
  });

  test("reports drawing input type for troubleshooting", () => {
    expect(drawingStatusText({ pointerType: "pen" })).toBe("Drawing pen");
    expect(drawingStatusText({ pointerType: "pen" }, "eraser")).toBe("Erasing pen");
    expect(drawingStatusText({ pointerType: "touch" })).toBe("Drawing touch");
    expect(drawingStatusText({})).toBe("Drawing");
  });
});

describe("annotation sync helpers", () => {
  test("uses a 5 second sync interval by default and stores user choices", () => {
    const storage = new Map();
    const adapter = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    };

    expect(readSyncInterval(adapter)).toBe("5000");
    writeSyncInterval(adapter, "stroke");

    expect(readSyncInterval(adapter)).toBe("stroke");
    expect(autosaveIntervalFromValue("manual")).toBe(0);
    expect(autosaveIntervalFromValue("stroke")).toBe(0);
    expect(autosaveIntervalFromValue("60000")).toBe(60000);
  });

  test("syncs immediately when the realtime stroke mode is selected", () => {
    expect(shouldSyncOnStrokeEnd({ value: "stroke", dirty: true, saving: false })).toBe(true);
    expect(shouldSyncOnStrokeEnd({ value: "stroke", dirty: false, saving: false })).toBe(false);
    expect(shouldSyncOnStrokeEnd({ value: "5000", dirty: true, saving: false })).toBe(false);
    expect(shouldSyncOnStrokeEnd({ value: "stroke", dirty: true, saving: true })).toBe(false);
  });

  test("autosaves only when dirty, idle, and the interval has elapsed", () => {
    expect(
      shouldAutosave({
        dirty: true,
        drawing: false,
        intervalMs: 5000,
        now: 10_000,
        lastSaveAt: 4_000
      })
    ).toBe(true);
    expect(
      shouldAutosave({
        dirty: true,
        drawing: true,
        intervalMs: 5000,
        now: 10_000,
        lastSaveAt: 4_000
      })
    ).toBe(false);
    expect(
      shouldAutosave({
        dirty: true,
        drawing: false,
        intervalMs: 0,
        now: 10_000,
        lastSaveAt: 0
      })
    ).toBe(false);
  });

  test("applies remote annotations only when newer and local canvas is clean", () => {
    expect(
      shouldApplyRemoteAnnotation({
        localDirty: false,
        localRevision: 1,
        remoteRevision: 2
      })
    ).toBe("apply");
    expect(
      shouldApplyRemoteAnnotation({
        localDirty: true,
        localRevision: 1,
        remoteRevision: 2
      })
    ).toBe("defer");
    expect(
      shouldApplyRemoteAnnotation({
        localDirty: false,
        localRevision: 2,
        remoteRevision: 2
      })
    ).toBe("ignore");
  });
});

describe("workspace helpers", () => {
  test("creates an expanded workspace with the screenshot centered", () => {
    expect(createWorkspaceMetrics({ width: 100, height: 50 })).toEqual({
      imageWidth: 100,
      imageHeight: 50,
      workspaceWidth: 300,
      workspaceHeight: 150,
      imageX: 100,
      imageY: 50
    });
  });

  test("keeps large screenshot workspaces inside the canvas safety cap", () => {
    const metrics = createWorkspaceMetrics({ width: 3000, height: 2000 });

    expect(metrics.workspaceWidth).toBeLessThanOrEqual(4096);
    expect(metrics.workspaceHeight).toBeLessThanOrEqual(4096);
    expect(metrics.imageWidth).toBe(3000);
    expect(metrics.imageHeight).toBe(2000);
    expect(metrics.imageX).toBeGreaterThanOrEqual(0);
    expect(metrics.imageY).toBeGreaterThanOrEqual(0);
    expect(metrics.imageX + metrics.imageWidth).toBeLessThanOrEqual(metrics.workspaceWidth);
    expect(metrics.imageY + metrics.imageHeight).toBeLessThanOrEqual(metrics.workspaceHeight);
  });

  test("scales extra-large screenshots down to the canvas safety cap", () => {
    const metrics = createWorkspaceMetrics({ width: 5120, height: 2880 });

    expect(metrics.workspaceWidth).toBe(4096);
    expect(metrics.workspaceHeight).toBeLessThanOrEqual(4096);
    expect(metrics.imageWidth).toBe(4096);
    expect(metrics.imageHeight).toBe(2304);
    expect(metrics.imageX).toBe(0);
    expect(metrics.imageY).toBeGreaterThanOrEqual(0);
  });

  test("expands the workspace near edges without exceeding the safety cap", () => {
    const metrics = createWorkspaceMetrics({ width: 100, height: 50 });
    const expansion = workspaceExpansionForPoint(
      { x: 4, y: 149 },
      metrics,
      { edgeGuard: 10, growStep: 40, maxSide: 340 }
    );

    expect(expansion).toEqual({ left: 40, right: 0, top: 0, bottom: 40 });
    expect(expandWorkspaceMetrics(metrics, expansion)).toEqual({
      imageWidth: 100,
      imageHeight: 50,
      workspaceWidth: 340,
      workspaceHeight: 190,
      imageX: 140,
      imageY: 50
    });
    expect(
      workspaceExpansionForPoint({ x: 2, y: 2 }, { ...metrics, workspaceWidth: 340 }, { maxSide: 340 })
    ).toMatchObject({ left: 0, right: 0 });
  });

  test("adds annotation revision as an image cache buster", () => {
    expect(cacheBustedImageUrl("/files/a.png", 3)).toBe("/files/a.png?v=3");
    expect(cacheBustedImageUrl("/files/a.png?x=1", 4)).toBe("/files/a.png?x=1&v=4");
  });

  test("places saved annotations on the editable drawing layer", () => {
    const metrics = createWorkspaceMetrics({ width: 100, height: 50 });

    expect(
      annotationLayerPlacement({ width: metrics.workspaceWidth, height: metrics.workspaceHeight }, metrics)
    ).toEqual({
      x: 0,
      y: 0,
      width: metrics.workspaceWidth,
      height: metrics.workspaceHeight
    });
    expect(annotationLayerPlacement({ width: 100, height: 50 }, metrics)).toEqual({
      x: metrics.imageX,
      y: metrics.imageY,
      width: metrics.imageWidth,
      height: metrics.imageHeight
    });
  });
});

describe("clipboard helpers", () => {
  test("detects whether PNG clipboard copy is available", () => {
    expect(canCopyPngToClipboard({ write: async () => {} }, class ClipboardItem {})).toBe(true);
    expect(canCopyPngToClipboard(null, class ClipboardItem {})).toBe(false);
    expect(canCopyPngToClipboard({ write: async () => {} }, null)).toBe(false);
    expect(canCopyPngToClipboard({ write: async () => {} }, class ClipboardItem {}, false)).toBe(false);
  });

  test("writes PNG blobs to the system clipboard", async () => {
    const writes = [];
    class ClipboardItem {
      constructor(items) {
        this.items = items;
      }
    }
    const clipboard = {
      write: async (items) => {
        writes.push(items);
      }
    };
    const blob = new Blob(["png"], { type: "image/png" });

    await copyPngBlobToClipboard(blob, clipboard, ClipboardItem);

    expect(writes).toHaveLength(1);
    expect(writes[0][0].items).toEqual({ "image/png": blob });
  });

  test("explains insecure contexts for PNG clipboard writes", async () => {
    const blob = new Blob(["png"], { type: "image/png" });

    await expect(
      copyPngBlobToClipboard(blob, { write: async () => {} }, class ClipboardItem {}, false)
    ).rejects.toThrow("Clipboard needs HTTPS");
  });

  test("downloads the PNG when browser security blocks image clipboard writes", async () => {
    const clicks = [];
    const revoked = [];
    const anchors = [];
    const doc = {
      body: {
        appendChild(node) {
          anchors.push(node);
        }
      },
      createElement(tagName) {
        expect(tagName).toBe("a");
        return {
          style: {},
          click() {
            clicks.push(this);
          },
          remove() {
            this.removed = true;
          }
        };
      }
    };
    const urlImpl = {
      createObjectURL: () => "blob:flowimage-result",
      revokeObjectURL: (url) => revoked.push(url)
    };
    const result = await copyOrDownloadPngBlob(
      new Blob(["png"], { type: "image/png" }),
      {
        clipboard: { write: async () => {} },
        ClipboardItemCtor: class ClipboardItem {},
        isSecureContext: false,
        doc,
        urlImpl,
        filename: "qa.png"
      }
    );

    expect(result).toBe("downloaded");
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe("blob:flowimage-result");
    expect(anchors[0].download).toBe("qa.png");
    expect(clicks).toEqual([anchors[0]]);
    expect(anchors[0].removed).toBe(true);
    expect(revoked).toEqual(["blob:flowimage-result"]);
  });

  test("writes text links through the async clipboard when available", async () => {
    const writes = [];

    await copyTextToClipboard("https://example.test/view", {
      writeText: async (value) => writes.push(value)
    });

    expect(writes).toEqual(["https://example.test/view"]);
  });

  test("falls back to a temporary textarea for HTTP share links", async () => {
    const removed = [];
    const body = {
      appended: [],
      appendChild(node) {
        this.appended.push(node);
      }
    };
    const textarea = {
      style: {},
      setAttribute(name, value) {
        this[name] = value;
      },
      focusCalled: false,
      selectCalled: false,
      focus() {
        this.focusCalled = true;
      },
      select() {
        this.selectCalled = true;
      },
      remove() {
        removed.push(this);
      }
    };
    const doc = {
      body,
      createElement: () => textarea,
      execCommand: (command) => command === "copy"
    };

    await copyTextToClipboard("http://192.168.2.72:3939/v/viewtoken12", undefined, doc);

    expect(body.appended).toEqual([textarea]);
    expect(textarea.value).toBe("http://192.168.2.72:3939/v/viewtoken12");
    expect(textarea.readonly).toBe("");
    expect(textarea.focusCalled).toBe(true);
    expect(textarea.selectCalled).toBe(true);
    expect(removed).toEqual([textarea]);
  });
});

describe("share link helpers", () => {
  test("parses short view, edit, owner, and home routes", () => {
    expect(shareRouteFromPath("/v/view_token12")).toEqual({
      mode: "view",
      token: "view_token12",
      sessionId: null
    });
    expect(shareRouteFromPath("/e/edit_token12")).toEqual({
      mode: "edit",
      token: "edit_token12",
      sessionId: null
    });
    expect(shareRouteFromPath("/o/own_token123")).toEqual({
      mode: "owner",
      token: "own_token123",
      sessionId: null
    });
    expect(shareRouteFromPath("/")).toEqual({
      mode: "home",
      token: null,
      sessionId: null
    });
  });

  test("maps access modes to API headers and edit capability", () => {
    expect(accessHeaders({ mode: "view", token: "view_1" })).toEqual({
      "X-FlowImage-View-Token": "view_1"
    });
    expect(accessHeaders({ mode: "edit", token: "edit_1" })).toEqual({
      "X-FlowImage-Edit-Token": "edit_1"
    });
    expect(accessHeaders({ mode: "owner", token: "own_1" })).toEqual({
      "X-FlowImage-Owner-Token": "own_1"
    });
    expect(canEditAccess("view")).toBe(false);
    expect(canEditAccess("edit")).toBe(true);
    expect(canEditAccess("owner")).toBe(true);
  });

  test("shows share controls only to owner", () => {
    expect(shareControlState("view")).toEqual({
      copyView: false,
      copyEdit: false,
      ownerSettings: false
    });
    expect(shareControlState("edit")).toEqual({
      copyView: false,
      copyEdit: false,
      ownerSettings: false
    });
    expect(
      shareControlState("owner", {
        viewUrl: "https://example.test/v/viewtoken12",
        editUrl: "https://example.test/e/edittoken12"
      })
    ).toEqual({
      copyView: true,
      copyEdit: true,
      ownerSettings: true
    });
  });

  test("chooses QR targets only from owner share URLs", () => {
    expect(qrTargetsForAccess("view", {}, "https://example.test/v/viewtoken12")).toEqual([]);
    expect(qrTargetsForAccess("edit", {}, "https://example.test/e/edittoken12")).toEqual([]);
    expect(
      qrTargetsForAccess(
        "owner",
        {
          viewUrl: "https://example.test/v/viewtoken12",
          editUrl: "https://example.test/e/edittoken12"
        },
        "https://example.test/o/owntoken123"
      )
    ).toEqual([
      { kind: "view", label: "View QR", url: "https://example.test/v/viewtoken12" },
      { kind: "edit", label: "Edit QR", url: "https://example.test/e/edittoken12" }
    ]);
  });

  test("creates stable root idempotency keys in browser storage", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const cryptoImpl = { getRandomValues: (target) => target.set(bytes) };
    const storage = new Map();
    const adapter = {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value)
    };

    expect(createRootIdempotencyKey(cryptoImpl)).toBe("AQIDBAUGBwgJ");
    expect(readOrCreateRootIdempotencyKey(adapter, cryptoImpl)).toBe("AQIDBAUGBwgJ");
    expect(readOrCreateRootIdempotencyKey(adapter, {
      getRandomValues: () => {
        throw new Error("should reuse stored key");
      }
    })).toBe("AQIDBAUGBwgJ");
  });

  test("root mode creates a default blank canvas idempotently", async () => {
    const calls = [];
    const created = await createRootSession(
      "root-key",
      async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          json: async () => ({ owner_url: "https://example.test/o/own123456789" })
        };
      }
    );

    expect(created.owner_url).toBe("https://example.test/o/own123456789");
    expect(calls[0]).toEqual({
      url: "/api/sessions",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Untitled FlowImage",
          default_page: "blank_grid",
          idempotency_key: "root-key"
        })
      }
    });
  });
});

describe("qr and retention helpers", () => {
  test("fetches QR SVGs as revokable object URLs", async () => {
    const calls = [];
    const objectUrl = await fetchQrObjectUrl(
      "https://example.test/edit/sess/edit",
      async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          blob: async () => new Blob(["<svg></svg>"], { type: "image/svg+xml" })
        };
      },
      { createObjectURL: () => "blob:qr" }
    );

    expect(objectUrl).toBe("blob:qr");
    expect(calls[0]).toEqual({
      url: "/api/qr",
      options: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "https://example.test/edit/sess/edit" })
      }
    });
  });

  test("releases object URLs when available", () => {
    const revoked = [];
    releaseObjectUrl("blob:shot", { revokeObjectURL: (url) => revoked.push(url) });
    releaseObjectUrl("", { revokeObjectURL: (url) => revoked.push(url) });

    expect(revoked).toEqual(["blob:shot"]);
  });

  test("sets retention maximums by selected unit", () => {
    expect(retentionMaxForUnit("hours")).toBe(720);
    expect(retentionMaxForUnit("days")).toBe(30);
  });
});

describe("styles", () => {
  test("disables browser touch gestures on drawing canvas", async () => {
    const css = await readFile(path.resolve("public/styles.css"), "utf8");
    expect(css).toMatch(/touch-action:\s*none/);
    expect(css).toMatch(/\.stage\s*\{[^}]*touch-action:\s*none/s);
    expect(css).toMatch(/body\s*\{[^}]*overscroll-behavior:\s*none/s);
  });

  test("keeps the canvas as the interactive layer above the screenshot", async () => {
    const css = await readFile(path.resolve("public/styles.css"), "utf8");

    expect(css).toMatch(/#baseImage\s*\{[^}]*pointer-events:\s*none/s);
    expect(css).toMatch(/#drawCanvas\s*\{[^}]*position:\s*relative/s);
    expect(css).toMatch(/#drawCanvas\s*\{[^}]*z-index:\s*1/s);
  });

  test("aligns the oversized workspace at the scroll origin", async () => {
    const css = await readFile(path.resolve("public/styles.css"), "utf8");

    expect(css).toMatch(/\.stage\s*\{[^}]*place-items:\s*start/s);
  });

  test("keeps the annotation stage as the viewport scroll container", async () => {
    const css = await readFile(path.resolve("public/styles.css"), "utf8");

    expect(css).toMatch(/\.annotation-panel\s*\{[^}]*grid-template-rows:\s*auto minmax\(0,\s*1fr\)/s);
    expect(css).toMatch(/\.annotation-panel\s*\{[^}]*height:\s*100vh/s);
    expect(css).toMatch(/\.annotation-panel\s*\{[^}]*overflow:\s*hidden/s);
  });

  test("keeps QR dialog content inside the modal on narrow screens", async () => {
    const css = await readFile(path.resolve("public/styles.css"), "utf8");

    expect(css).toMatch(/\.qr-dialog form\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.qr-dialog img\s*\{[^}]*min-width:\s*0/s);
    expect(css).toMatch(/\.qr-dialog img\s*\{[^}]*max-width:\s*100%/s);
    expect(css).toMatch(/#qrStatus\s*\{[^}]*overflow-wrap:\s*anywhere/s);
  });
});

describe("html shell", () => {
  test("uses versioned frontend assets so iPad Safari reloads fixes", async () => {
    const html = await readFile(path.resolve("public/index.html"), "utf8");

    expect(html).toMatch(/href="\/styles\.css\?v=[^"]+"/);
    expect(html).toMatch(/src="\/app\.js\?v=[^"]+"/);
  });

  test("uses the compact canvas shell without the legacy paste-link home", async () => {
    const html = await readFile(path.resolve("public/index.html"), "utf8");

    expect(html).not.toContain('id="homePanel"');
    expect(html).not.toContain('id="shareLinkInput"');
    expect(html).not.toContain('id="openShareLink"');
    expect(html).not.toContain('class="brand-mark"');
    expect(html).not.toContain(">FlowImage</strong>");
    expect(html).toContain('id="newSession"');
    expect(html).toContain('id="shareButton"');
    expect(html).toContain('id="sharePanel"');
    expect(html).toContain('id="copyImage"');
    expect(html).toContain('id="copyViewLink"');
    expect(html).toContain('id="copyEditLink"');
    expect(html).toContain('id="showViewQr"');
    expect(html).toContain('id="showEditQr"');
    expect(html).toContain('id="qrDialog"');
    expect(html).not.toContain('id="showShareQr"');
    expect(html).toContain('id="ownerControls"');
    expect(html).toContain('id="retentionValue"');
    expect(html).not.toContain('id="devSessionLink"');
    expect(html).not.toContain("/s/");
    expect(html).not.toContain("/view/");
    expect(html).not.toContain("/edit/");
    expect(html).not.toContain("/owner/");
    expect(html).toContain('<span>Save</span>');
    expect(html).toContain('<option value="stroke">Realtime</option>');
  });
});

describe("legacy secret mode", () => {
  test("does not keep session-secret, pair-code, or /s browser branches", async () => {
    const js = await readFile(path.resolve("public/app.js"), "utf8");
    expect(js).not.toContain("X-Session-Secret");
    expect(js).not.toContain("secret=");
    expect(js).not.toContain("withSecret");
    expect(js).not.toContain("X-Pair-Device-Token");
    expect(js).not.toContain("/api/pairs");
    expect(js).not.toContain('mode === "legacy"');
  });
});

describe("safe DOM and fetch helpers", () => {
  test("renders untrusted values with textContent", () => {
    const node = { textContent: "", innerHTML: "" };

    setSafeText(node, "<img src=x onerror=alert(1)>");

    expect(node.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(node.innerHTML).toBe("");
  });

  test("fetches image blobs with share token headers", async () => {
    const calls = [];
    const objectUrl = await fetchImageObjectUrl(
      "/files/sessions/sess/screenshots/shot_0001.png",
      { mode: "owner", token: "own_1" },
      async (url, options) => {
        calls.push({ url, options });
        return {
          ok: true,
          blob: async () => new Blob(["png"], { type: "image/png" })
        };
      },
      { createObjectURL: () => "blob:shot" }
    );

    expect(objectUrl).toBe("blob:shot");
    expect(calls[0]).toEqual({
      url: "/files/sessions/sess/screenshots/shot_0001.png",
      options: {
        headers: { "X-FlowImage-Owner-Token": "own_1" },
        cache: "no-store"
      }
    });
  });
});
