export function mapPointToNative(point, metrics) {
  return {
    x: point.x * (metrics.imageWidth / metrics.cssWidth),
    y: point.y * (metrics.imageHeight / metrics.cssHeight)
  };
}

export function computeStrokeWidth(event, baseWidth) {
  if (event.pointerType !== "pen" && event.pointerType !== "touch") {
    return baseWidth * 1.2;
  }
  const rawPressure = Number.isFinite(event.pressure) ? event.pressure : 0.5;
  const pressure = Math.max(0.05, Math.min(1, rawPressure || 0.5));
  return baseWidth * (0.35 + pressure * 2.65);
}

export function strokeWidthForTool(tool, event, baseWidth) {
  const width = computeStrokeWidth(event, baseWidth);
  return tool === "eraser" ? width * 4 : width;
}

export function canDrawWithPointer(event) {
  return event.pointerType === "pen" || event.pointerType === "mouse" || !event.pointerType;
}

export function drawingPointerEvents(event) {
  if (typeof event.getCoalescedEvents !== "function") return [event];
  const events = event.getCoalescedEvents();
  return events.length ? events : [event];
}

export function drawingTouchEvent(event) {
  const touch = event.changedTouches?.[0] ?? event.touches?.[0];
  if (!touch) return null;
  return {
    clientX: touch.clientX,
    clientY: touch.clientY,
    pointerType: "touch",
    pressure: touch.force || 0.5
  };
}

export function touchPanDelta(previousTouch, nextTouch) {
  return {
    scrollX: previousTouch.clientX - nextTouch.clientX,
    scrollY: previousTouch.clientY - nextTouch.clientY
  };
}

export function drawingStatusText(event, tool = "brush") {
  const action = tool === "eraser" ? "Erasing" : "Drawing";
  return event.pointerType ? `${action} ${event.pointerType}` : action;
}

const SYNC_INTERVAL_KEY = "flowImageSyncInterval";
const ROOT_IDEMPOTENCY_KEY = "flowImageRootIdempotencyKey";
const DEFAULT_SYNC_INTERVAL = "5000";
const VALID_SYNC_INTERVALS = new Set(["manual", "stroke", "5000", "10000", "60000"]);
const WORKSPACE_EDGE_GUARD = 160;
const WORKSPACE_GROW_STEP = 480;
const WORKSPACE_MAX_SIDE = 4096;

export function autosaveIntervalFromValue(value) {
  if (value === "manual" || value === "stroke") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : Number(DEFAULT_SYNC_INTERVAL);
}

export function readSyncInterval(storage) {
  const value = storage.getItem(SYNC_INTERVAL_KEY);
  return VALID_SYNC_INTERVALS.has(value) ? value : DEFAULT_SYNC_INTERVAL;
}

export function writeSyncInterval(storage, value) {
  const safeValue = VALID_SYNC_INTERVALS.has(value) ? value : DEFAULT_SYNC_INTERVAL;
  storage.setItem(SYNC_INTERVAL_KEY, safeValue);
}

export function shouldAutosave({ dirty, drawing, intervalMs, now, lastSaveAt }) {
  return Boolean(dirty && !drawing && intervalMs > 0 && now - lastSaveAt >= intervalMs);
}

export function shouldSyncOnStrokeEnd({ value, dirty, saving }) {
  return Boolean(value === "stroke" && dirty && !saving);
}

export function shouldApplyRemoteAnnotation({ localDirty, localRevision, remoteRevision }) {
  if (!remoteRevision || remoteRevision <= localRevision) return "ignore";
  return localDirty ? "defer" : "apply";
}

export function createWorkspaceMetrics(image, scale = 3) {
  const imageScale = Math.min(1, WORKSPACE_MAX_SIDE / image.width, WORKSPACE_MAX_SIDE / image.height);
  const imageWidth = Math.max(1, Math.round(image.width * imageScale));
  const imageHeight = Math.max(1, Math.round(image.height * imageScale));
  const workspaceWidth = Math.min(WORKSPACE_MAX_SIDE, Math.max(imageWidth, imageWidth * scale));
  const workspaceHeight = Math.min(WORKSPACE_MAX_SIDE, Math.max(imageHeight, imageHeight * scale));
  return {
    imageWidth,
    imageHeight,
    workspaceWidth,
    workspaceHeight,
    imageX: Math.max(0, Math.round((workspaceWidth - imageWidth) / 2)),
    imageY: Math.max(0, Math.round((workspaceHeight - imageHeight) / 2))
  };
}

export function annotationLayerPlacement(annotation, metrics) {
  const sameWorkspace =
    Number(annotation?.width) === metrics.workspaceWidth &&
    Number(annotation?.height) === metrics.workspaceHeight;
  return sameWorkspace
    ? { x: 0, y: 0, width: metrics.workspaceWidth, height: metrics.workspaceHeight }
    : {
        x: metrics.imageX,
        y: metrics.imageY,
        width: metrics.imageWidth,
        height: metrics.imageHeight
      };
}

export function workspaceExpansionForPoint(
  point,
  metrics,
  { edgeGuard = WORKSPACE_EDGE_GUARD, growStep = WORKSPACE_GROW_STEP, maxSide = WORKSPACE_MAX_SIDE } = {}
) {
  let remainingWidth = Math.max(0, maxSide - metrics.workspaceWidth);
  let remainingHeight = Math.max(0, maxSide - metrics.workspaceHeight);
  const left = point.x < edgeGuard ? Math.min(growStep, remainingWidth) : 0;
  remainingWidth -= left;
  const right =
    point.x > metrics.workspaceWidth - edgeGuard ? Math.min(growStep, remainingWidth) : 0;
  const top = point.y < edgeGuard ? Math.min(growStep, remainingHeight) : 0;
  remainingHeight -= top;
  const bottom =
    point.y > metrics.workspaceHeight - edgeGuard ? Math.min(growStep, remainingHeight) : 0;
  return { left, right, top, bottom };
}

export function expandWorkspaceMetrics(metrics, expansion) {
  return {
    ...metrics,
    workspaceWidth: metrics.workspaceWidth + expansion.left + expansion.right,
    workspaceHeight: metrics.workspaceHeight + expansion.top + expansion.bottom,
    imageX: metrics.imageX + expansion.left,
    imageY: metrics.imageY + expansion.top
  };
}

export function cacheBustedImageUrl(url, revision) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}v=${encodeURIComponent(String(revision ?? 0))}`;
}

export function canCopyPngToClipboard(clipboard, ClipboardItemCtor, isSecureContext = true) {
  return Boolean(isSecureContext && clipboard?.write && ClipboardItemCtor);
}

export function createRootIdempotencyKey(cryptoImpl = globalThis.crypto) {
  const bytes = new Uint8Array(9);
  cryptoImpl.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export function readOrCreateRootIdempotencyKey(storage, cryptoImpl = globalThis.crypto) {
  const existing = storage.getItem(ROOT_IDEMPOTENCY_KEY);
  if (existing) return existing;
  const value = createRootIdempotencyKey(cryptoImpl);
  storage.setItem(ROOT_IDEMPOTENCY_KEY, value);
  return value;
}

export async function createRootSession(idempotencyKey, fetchImpl = fetch) {
  const res = await fetchImpl("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: "Untitled FlowImage",
      default_page: "blank_grid",
      idempotency_key: idempotencyKey
    })
  });
  if (!res.ok) throw new Error(`Create failed: ${res.status}`);
  return res.json();
}

export function shareRouteFromPath(pathname) {
  const match = pathname.match(/^\/([veo])\/([^/]+)$/);
  if (!match) return { mode: "home", token: null, sessionId: null };
  const mode = match[1] === "v" ? "view" : match[1] === "e" ? "edit" : "owner";
  return {
    mode,
    sessionId: null,
    token: decodeURIComponent(match[2])
  };
}

export function canEditAccess(access) {
  return access === "edit" || access === "owner";
}

export function accessHeaders(access) {
  if (access?.mode === "view") return { "X-FlowImage-View-Token": access.token };
  if (access?.mode === "edit") return { "X-FlowImage-Edit-Token": access.token };
  if (access?.mode === "owner") return { "X-FlowImage-Owner-Token": access.token };
  return {};
}

export function shareControlState(accessMode, links = {}) {
  return {
    copyView: accessMode === "owner" && Boolean(links.viewUrl),
    copyEdit: accessMode === "owner" && Boolean(links.editUrl),
    ownerSettings: accessMode === "owner"
  };
}

export function qrTargetsForAccess(accessMode, links = {}, currentUrl = "") {
  if (accessMode === "owner") {
    return [
      links.viewUrl ? { kind: "view", label: "View QR", url: links.viewUrl } : null,
      links.editUrl ? { kind: "edit", label: "Edit QR", url: links.editUrl } : null
    ].filter(Boolean);
  }
  return [];
}

export function retentionMaxForUnit(unit) {
  return unit === "days" ? 30 : 720;
}

export async function copyPngBlobToClipboard(blob, clipboard, ClipboardItemCtor, isSecureContext = true) {
  if (!isSecureContext) {
    throw new Error("Clipboard needs HTTPS");
  }
  if (!canCopyPngToClipboard(clipboard, ClipboardItemCtor, isSecureContext)) {
    throw new Error("Clipboard unavailable");
  }
  await clipboard.write([new ClipboardItemCtor({ "image/png": blob })]);
}

export async function copyTextToClipboard(value, clipboard, doc = document) {
  if (clipboard?.writeText) {
    await clipboard.writeText(value);
    return;
  }
  if (!doc?.body || typeof doc.createElement !== "function" || typeof doc.execCommand !== "function") {
    throw new Error("Clipboard unavailable");
  }
  const textarea = doc.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "-1000px";
  textarea.style.left = "-1000px";
  doc.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  const copied = doc.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

export function setSafeText(node, value) {
  node.textContent = String(value ?? "");
}

export function releaseObjectUrl(objectUrl, urlImpl = URL) {
  if (objectUrl && String(objectUrl).startsWith("blob:") && typeof urlImpl.revokeObjectURL === "function") {
    urlImpl.revokeObjectURL(objectUrl);
  }
}

export async function fetchImageObjectUrl(
  url,
  access,
  fetchImpl = fetch,
  urlImpl = URL
) {
  const res = await fetchImpl(url, {
    headers: accessHeaders(access),
    cache: "no-store"
  });
  if (!res.ok) throw new Error(`Image load failed: ${res.status}`);
  return urlImpl.createObjectURL(await res.blob());
}

export async function fetchQrObjectUrl(text, fetchImpl = fetch, urlImpl = URL) {
  const res = await fetchImpl("/api/qr", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text })
  });
  if (!res.ok) throw new Error(`QR failed: ${res.status}`);
  return urlImpl.createObjectURL(await res.blob());
}

function bytesToBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded =
    typeof btoa === "function" ? btoa(binary) : Buffer.from(bytes).toString("base64");
  return encoded.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function getSessionInfo() {
  return shareRouteFromPath(window.location.pathname);
}

function currentAbsoluteUrl() {
  return window.location.href;
}

async function blobFromCanvas(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Canvas export failed"));
      else resolve(blob);
    }, "image/png");
  });
}

export function initViewer(doc = document) {
  const state = {
    session: null,
    pageIndex: 0,
    tool: "brush",
    drawing: false,
    lastPoint: null,
    dirty: false,
    saving: false,
    polling: false,
    localRevision: 0,
    lastSaveAt: 0,
    lastPollAt: 0,
    zoom: 1,
    gesture: null,
    workspace: null,
    baseImageObjectUrl: "",
    qrObjectUrl: "",
    qrCurrentUrl: ""
  };

  const route = getSessionInfo();
  const access = { mode: route.mode, token: route.token };
  const annotationPanel = doc.getElementById("annotationPanel");
  const stage = doc.querySelector(".stage");
  const baseImage = doc.getElementById("baseImage");
  const baseCanvas = doc.getElementById("baseCanvas");
  const baseCtx = baseCanvas.getContext("2d");
  const canvas = doc.getElementById("drawCanvas");
  const ctx = canvas.getContext("2d");
  const status = doc.getElementById("saveStatus");
  const pageStatus = doc.getElementById("pageStatus");
  const colorInput = doc.getElementById("colorInput");
  const widthInput = doc.getElementById("widthInput");
  const syncInput = doc.getElementById("syncInterval");
  const ownerControls = doc.getElementById("ownerControls");
  const retentionValue = doc.getElementById("retentionValue");
  const retentionUnit = doc.getElementById("retentionUnit");
  const qrDialog = doc.getElementById("qrDialog");
  const qrTitle = doc.getElementById("qrTitle");
  const qrImage = doc.getElementById("qrImage");
  const qrStatus = doc.getElementById("qrStatus");
  const roleChip = doc.getElementById("roleChip");
  const sharePanel = doc.getElementById("sharePanel");
  const shareButton = doc.getElementById("shareButton");
  const viewShareUrl = doc.getElementById("viewShareUrl");
  const editShareUrl = doc.getElementById("editShareUrl");
  syncInput.value = readSyncInterval(window.localStorage);

  function sessionIdForRequests() {
    return state.session?.session_id;
  }

  function ownerLinks() {
    if (access.mode !== "owner") return {};
    return {
      viewUrl: state.session?.view_url ?? "",
      editUrl: state.session?.edit_url ?? ""
    };
  }

  function currentPage() {
    return state.session?.screenshots[state.pageIndex];
  }

  function currentAnnotation(session = state.session) {
    const page = currentPage();
    return session?.annotations?.find((item) => item.screenshot_id === page?.screenshot_id) ?? null;
  }

  function updateToolButtons() {
    for (const button of doc.querySelectorAll("[data-tool]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
    }
  }

  function applyCanvasSize() {
    const width = `${state.workspace.workspaceWidth * state.zoom}px`;
    const height = `${state.workspace.workspaceHeight * state.zoom}px`;
    baseCanvas.style.width = width;
    baseCanvas.style.height = height;
    canvas.style.width = width;
    canvas.style.height = height;
  }

  function setCanvasDimensions() {
    baseCanvas.width = state.workspace.workspaceWidth;
    baseCanvas.height = state.workspace.workspaceHeight;
    canvas.width = state.workspace.workspaceWidth;
    canvas.height = state.workspace.workspaceHeight;
  }

  function centerWorkspaceOnImage() {
    if (!stage || !state.workspace) return;
    stage.scrollLeft = Math.max(0, state.workspace.imageX * state.zoom - 24);
    stage.scrollTop = Math.max(0, state.workspace.imageY * state.zoom - 24);
  }

  function drawGrid(targetCtx, metrics) {
    targetCtx.save();
    targetCtx.fillStyle = "#f8fafc";
    targetCtx.fillRect(0, 0, metrics.workspaceWidth, metrics.workspaceHeight);
    targetCtx.lineWidth = 1;
    for (let x = 0; x <= metrics.workspaceWidth; x += 24) {
      targetCtx.strokeStyle = x % 120 === 0 ? "#cbd5e1" : "#e2e8f0";
      targetCtx.beginPath();
      targetCtx.moveTo(x + 0.5, 0);
      targetCtx.lineTo(x + 0.5, metrics.workspaceHeight);
      targetCtx.stroke();
    }
    for (let y = 0; y <= metrics.workspaceHeight; y += 24) {
      targetCtx.strokeStyle = y % 120 === 0 ? "#cbd5e1" : "#e2e8f0";
      targetCtx.beginPath();
      targetCtx.moveTo(0, y + 0.5);
      targetCtx.lineTo(metrics.workspaceWidth, y + 0.5);
      targetCtx.stroke();
    }
    targetCtx.strokeStyle = "#64748b";
    targetCtx.strokeRect(
      metrics.imageX + 0.5,
      metrics.imageY + 0.5,
      metrics.imageWidth,
      metrics.imageHeight
    );
    targetCtx.fillStyle = "#64748b";
    targetCtx.font = "14px sans-serif";
    targetCtx.fillText("1x", metrics.imageX + 8, metrics.imageY - 10);
    targetCtx.restore();
  }

  async function drawImageUrl(targetCtx, url, x, y, width, height) {
    const image = new Image();
    const objectUrl = await fetchImageObjectUrl(url, access);
    try {
      image.src = objectUrl;
      await image.decode();
      targetCtx.drawImage(image, x, y, width, height);
    } finally {
      releaseObjectUrl(objectUrl);
    }
  }

  async function replaceDrawingWithImageUrl(targetCtx, url, x, y, width, height) {
    const image = new Image();
    const objectUrl = await fetchImageObjectUrl(url, access);
    try {
      image.src = objectUrl;
      await image.decode();
      const staged = doc.createElement("canvas");
      staged.width = targetCtx.canvas.width;
      staged.height = targetCtx.canvas.height;
      staged.getContext("2d").drawImage(image, x, y, width, height);
      targetCtx.clearRect(0, 0, targetCtx.canvas.width, targetCtx.canvas.height);
      targetCtx.drawImage(staged, 0, 0);
    } finally {
      releaseObjectUrl(objectUrl);
    }
  }

  function setBaseImageObjectUrl(objectUrl) {
    releaseObjectUrl(state.baseImageObjectUrl);
    state.baseImageObjectUrl = objectUrl;
    baseImage.src = objectUrl;
  }

  async function renderBase(annotation = currentAnnotation()) {
    const page = currentPage();
    if (annotation?.merged_png_url) {
      const annotationWidth = Number(annotation.width);
      const annotationHeight = Number(annotation.height);
      if (
        Number.isFinite(annotationWidth) &&
        Number.isFinite(annotationHeight) &&
        (annotationWidth !== state.workspace.workspaceWidth ||
          annotationHeight !== state.workspace.workspaceHeight)
      ) {
        const workspaceWidth = Math.max(state.workspace.workspaceWidth, annotationWidth);
        const workspaceHeight = Math.max(state.workspace.workspaceHeight, annotationHeight);
        state.workspace = {
          ...state.workspace,
          workspaceWidth,
          workspaceHeight,
          imageX: Math.max(0, Math.round((workspaceWidth - state.workspace.imageWidth) / 2)),
          imageY: Math.max(0, Math.round((workspaceHeight - state.workspace.imageHeight) / 2))
        };
        setCanvasDimensions();
        applyCanvasSize();
      }
    }
    const metrics = state.workspace;
    drawGrid(baseCtx, metrics);
    baseCtx.drawImage(baseImage, metrics.imageX, metrics.imageY, metrics.imageWidth, metrics.imageHeight);
    if (annotation?.merged_png_url) {
      const url = cacheBustedImageUrl(annotation.merged_png_url, annotation.revision);
      const placement = annotationLayerPlacement(annotation, metrics);
      await replaceDrawingWithImageUrl(
        ctx,
        url,
        placement.x,
        placement.y,
        placement.width,
        placement.height
      );
      state.localRevision = annotation.revision ?? 1;
      return;
    }
    clearDrawing();
    state.localRevision = 0;
  }

  function clearDrawing() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  async function loadPage(index) {
    state.pageIndex = Math.max(0, Math.min(index, state.session.screenshots.length - 1));
    const page = currentPage();
    pageStatus.value = `Page ${state.pageIndex + 1} / ${state.session.screenshots.length}`;
    setBaseImageObjectUrl(await fetchImageObjectUrl(page.image_url, access));
    await baseImage.decode();
    state.workspace = createWorkspaceMetrics(page);
    setCanvasDimensions();
    state.zoom = 1;
    applyCanvasSize();
    await renderBase();
    state.dirty = false;
    window.requestAnimationFrame(() => centerWorkspaceOnImage());
    status.value = "Ready";
  }

  function pointerToNative(event) {
    const rect = canvas.getBoundingClientRect();
    return mapPointToNative(
      { x: event.clientX - rect.left, y: event.clientY - rect.top },
      {
        cssWidth: rect.width,
        cssHeight: rect.height,
        imageWidth: canvas.width,
        imageHeight: canvas.height
      }
    );
  }

  function configureDrawContext(event) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = strokeWidthForTool(state.tool, event, Number(widthInput.value));
    if (state.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorInput.value;
    }
  }

  function drawPoint(point, event) {
    configureDrawContext(event);
    ctx.beginPath();
    ctx.arc(point.x, point.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    if (state.tool === "eraser") {
      ctx.fillStyle = "rgba(0,0,0,1)";
    } else {
      ctx.fillStyle = colorInput.value;
    }
    ctx.fill();
    ctx.restore();
    state.dirty = true;
  }

  function drawSegment(from, to, event) {
    configureDrawContext(event);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
    state.dirty = true;
  }

  function startDrawing(event) {
    if (!canEditAccess(access.mode)) return;
    event.preventDefault?.();
    state.drawing = true;
    state.lastPoint = pointerToNative(event);
    if (state.tool === "eraser") {
      drawPoint(state.lastPoint, event);
    }
    status.value = drawingStatusText(event, state.tool);
  }

  function cloneCanvas(source) {
    const clone = doc.createElement("canvas");
    clone.width = source.width;
    clone.height = source.height;
    clone.getContext("2d").drawImage(source, 0, 0);
    return clone;
  }

  function hasExpansion(expansion) {
    return expansion.left || expansion.right || expansion.top || expansion.bottom;
  }

  function expandWorkspaceForDrawing(point) {
    const expansion = workspaceExpansionForPoint(point, state.workspace);
    if (!hasExpansion(expansion)) return point;

    const previousBase = cloneCanvas(baseCanvas);
    const previousDrawing = cloneCanvas(canvas);
    state.workspace = expandWorkspaceMetrics(state.workspace, expansion);
    setCanvasDimensions();
    applyCanvasSize();
    drawGrid(baseCtx, state.workspace);
    baseCtx.drawImage(previousBase, expansion.left, expansion.top);
    ctx.drawImage(previousDrawing, expansion.left, expansion.top);

    if (state.lastPoint) {
      state.lastPoint = {
        x: state.lastPoint.x + expansion.left,
        y: state.lastPoint.y + expansion.top
      };
    }
    if (stage) {
      stage.scrollLeft += expansion.left * state.zoom;
      stage.scrollTop += expansion.top * state.zoom;
    }
    return {
      x: point.x + expansion.left,
      y: point.y + expansion.top
    };
  }

  function continueDrawing(event) {
    event.preventDefault?.();
    if (!state.drawing) return;
    for (const item of drawingPointerEvents(event)) {
      const nextPoint = expandWorkspaceForDrawing(pointerToNative(item));
      drawSegment(state.lastPoint, nextPoint, item);
      state.lastPoint = nextPoint;
    }
  }

  function stopDrawing() {
    const wasDrawing = state.drawing;
    state.drawing = false;
    state.lastPoint = null;
    if (
      wasDrawing &&
      shouldSyncOnStrokeEnd({ value: syncInput.value, dirty: state.dirty, saving: state.saving })
    ) {
      saveCurrentPage({ automatic: true });
      return;
    }
    status.value = "Ready";
  }

  function mergedCanvas() {
    const merged = doc.createElement("canvas");
    merged.width = state.workspace.workspaceWidth;
    merged.height = state.workspace.workspaceHeight;
    const mergedCtx = merged.getContext("2d");
    mergedCtx.drawImage(baseCanvas, 0, 0);
    mergedCtx.drawImage(canvas, 0, 0);
    return merged;
  }

  async function saveCurrentPage({ automatic = false } = {}) {
    if (!canEditAccess(access.mode)) {
      status.value = "View only";
      return;
    }
    if (state.saving || !state.workspace) return;
    try {
      state.saving = true;
      status.value = automatic ? "Auto saving" : "Saving";
      const page = currentPage();
      const body = new FormData();
      body.append("merged_png", await blobFromCanvas(mergedCanvas()), "merged.png");
      const res = await fetch(`/api/sessions/${sessionIdForRequests()}/annotations/${page.screenshot_id}`, {
        method: "POST",
        headers: accessHeaders(access),
        body
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      const annotation = await res.json();
      const existingIndex = state.session.annotations.findIndex(
        (item) => item.screenshot_id === annotation.screenshot_id
      );
      if (existingIndex >= 0) {
        state.session.annotations[existingIndex] = annotation;
      } else {
        state.session.annotations.push(annotation);
      }
      state.localRevision = annotation.revision ?? state.localRevision + 1;
      state.dirty = false;
      state.lastSaveAt = Date.now();
      status.value = automatic ? "Synced" : "Saved";
    } catch (error) {
      status.value = error.message;
    } finally {
      state.saving = false;
    }
  }

  async function pollSession() {
    const intervalMs = autosaveIntervalFromValue(syncInput.value);
    if (intervalMs <= 0 || state.polling || state.saving) return;
    try {
      state.polling = true;
      const res = await fetch(`/api/sessions/${sessionIdForRequests()}`, {
        headers: accessHeaders(access),
        cache: "no-store"
      });
      if (!res.ok) throw new Error(`Sync failed: ${res.status}`);
      const remoteSession = await res.json();
      const page = currentPage();
      const remoteAnnotation =
        remoteSession.annotations?.find((item) => item.screenshot_id === page?.screenshot_id) ?? null;
      const action = shouldApplyRemoteAnnotation({
        localDirty: state.dirty,
        localRevision: state.localRevision,
        remoteRevision: remoteAnnotation?.revision ?? 0
      });
      state.session = remoteSession;
      if (action === "apply") {
        await renderBase(remoteAnnotation);
        state.dirty = false;
        status.value = "Synced";
      } else if (action === "defer") {
        status.value = "Remote update available";
      }
    } catch (error) {
      status.value = error.message;
    } finally {
      state.polling = false;
      state.lastPollAt = Date.now();
    }
  }

  function tickSync() {
    const now = Date.now();
    const intervalMs = autosaveIntervalFromValue(syncInput.value);
    if (
      shouldAutosave({
        dirty: state.dirty,
        drawing: state.drawing,
        intervalMs,
        now,
        lastSaveAt: state.lastSaveAt
      })
    ) {
      saveCurrentPage({ automatic: true });
    }
    if (intervalMs > 0 && now - state.lastPollAt >= intervalMs) {
      pollSession();
    }
  }

  function pinchDistance(touches) {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  function pinchCenter(touches) {
    return {
      x: (touches[0].clientX + touches[1].clientX) / 2,
      y: (touches[0].clientY + touches[1].clientY) / 2
    };
  }

  function clampZoom(value) {
    return Math.max(0.5, Math.min(3, value));
  }

  function updateZoom(nextZoom, center) {
    const previousZoom = state.zoom;
    state.zoom = clampZoom(nextZoom);
    applyCanvasSize();
    if (!stage || !center) return;
    const ratio = state.zoom / previousZoom;
    stage.scrollLeft = (stage.scrollLeft + center.x) * ratio - center.x;
    stage.scrollTop = (stage.scrollTop + center.y) * ratio - center.y;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!canEditAccess(access.mode)) return;
    if (!canDrawWithPointer(event)) return;
    canvas.setPointerCapture?.(event.pointerId);
    startDrawing(event);
  });

  canvas.addEventListener("pointermove", continueDrawing);
  canvas.addEventListener("pointerup", stopDrawing);
  canvas.addEventListener("pointercancel", stopDrawing);

  canvas.addEventListener(
    "touchstart",
    (event) => {
      if (state.drawing) {
        event.preventDefault();
        return;
      }
      if (event.touches.length >= 2) {
        event.preventDefault();
        state.gesture = {
          type: "pinch",
          distance: pinchDistance(event.touches),
          center: pinchCenter(event.touches),
          zoom: state.zoom,
          scrollLeft: stage?.scrollLeft ?? 0,
          scrollTop: stage?.scrollTop ?? 0
        };
        status.value = "Zooming";
        return;
      }
      const touch = event.touches[0];
      if (!touch) return;
      event.preventDefault();
      state.gesture = {
        type: "pan",
        touch: { clientX: touch.clientX, clientY: touch.clientY }
      };
      status.value = "Panning";
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchmove",
    (event) => {
      if (state.drawing) {
        event.preventDefault();
        return;
      }
      if (state.gesture?.type === "pinch" && event.touches.length >= 2) {
        event.preventDefault();
        const center = pinchCenter(event.touches);
        const nextDistance = pinchDistance(event.touches);
        updateZoom(state.gesture.zoom * (nextDistance / state.gesture.distance), center);
        if (stage) {
          stage.scrollLeft -= center.x - state.gesture.center.x;
          stage.scrollTop -= center.y - state.gesture.center.y;
        }
        state.gesture.center = center;
        return;
      }
      if (state.gesture?.type === "pan" && event.touches.length === 1) {
        const touch = event.touches[0];
        const delta = touchPanDelta(state.gesture.touch, touch);
        if (stage) {
          stage.scrollLeft += delta.scrollX;
          stage.scrollTop += delta.scrollY;
        }
        state.gesture.touch = { clientX: touch.clientX, clientY: touch.clientY };
        event.preventDefault();
        status.value = "Panning";
        return;
      }
      event.preventDefault();
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchend",
    () => {
      state.gesture = null;
      if (!state.drawing) status.value = "Ready";
    },
    { passive: false }
  );
  canvas.addEventListener(
    "touchcancel",
    () => {
      state.gesture = null;
      if (!state.drawing) status.value = "Ready";
    },
    { passive: false }
  );

  canvas.addEventListener("mousedown", (event) => {
    if (!canEditAccess(access.mode)) return;
    if (!canDrawWithPointer(event)) return;
    startDrawing(event);
  });
  canvas.addEventListener("mousemove", continueDrawing);
  doc.addEventListener?.("mouseup", stopDrawing);

  doc.getElementById("prevPage").addEventListener("click", () => loadPage(state.pageIndex - 1));
  doc.getElementById("nextPage").addEventListener("click", () => loadPage(state.pageIndex + 1));
  doc.getElementById("brushTool").addEventListener("click", () => {
    state.tool = "brush";
    updateToolButtons();
  });
  doc.getElementById("eraserTool").addEventListener("click", () => {
    state.tool = "eraser";
    updateToolButtons();
  });
  syncInput.addEventListener("change", () => {
    writeSyncInterval(window.localStorage, syncInput.value);
    if (syncInput.value === "manual") {
      status.value = "Manual save";
    } else if (syncInput.value === "stroke") {
      status.value = "Realtime save";
    } else {
      status.value = `Save ${Number(syncInput.value) / 1000}s`;
    }
  });

  doc.getElementById("newSession").addEventListener("click", () => {
    window.localStorage.removeItem(ROOT_IDEMPOTENCY_KEY);
    window.location.assign("/");
  });
  doc.getElementById("copyImage").addEventListener("click", async () => {
    try {
      status.value = "Copying";
      await copyPngBlobToClipboard(
        await blobFromCanvas(mergedCanvas()),
        window.navigator?.clipboard,
        window.ClipboardItem,
        window.isSecureContext
      );
      status.value = "Copied";
    } catch (error) {
      status.value = error.message || "Clipboard unavailable";
    }
  });
  doc.getElementById("submitPage").addEventListener("click", () => saveCurrentPage());

  function setEditControls() {
    const editable = canEditAccess(access.mode);
    for (const id of ["brushTool", "eraserTool", "submitPage"]) {
      const node = doc.getElementById(id);
      if (node) node.hidden = !editable;
    }
    for (const id of ["colorControl", "widthControl", "syncControl"]) {
      const node = doc.getElementById(id);
      if (node) node.hidden = !editable;
    }
    canvas.style.cursor = editable ? "crosshair" : "grab";
  }

  function setShareControls() {
    const links = ownerLinks();
    const controls = shareControlState(access.mode, links);
    const qrTargets = qrTargetsForAccess(access.mode, links, currentAbsoluteUrl());
    const copyView = doc.getElementById("copyViewLink");
    const copyEdit = doc.getElementById("copyEditLink");
    const showViewQr = doc.getElementById("showViewQr");
    const showEditQr = doc.getElementById("showEditQr");
    if (viewShareUrl) viewShareUrl.value = links.viewUrl ?? "";
    if (editShareUrl) editShareUrl.value = links.editUrl ?? "";
    if (shareButton) shareButton.hidden = !controls.ownerSettings;
    if (sharePanel && !controls.ownerSettings) sharePanel.hidden = true;
    if (copyView) copyView.hidden = !controls.copyView;
    if (copyEdit) copyEdit.hidden = !controls.copyEdit;
    if (showViewQr) showViewQr.hidden = !qrTargets.some((item) => item.kind === "view");
    if (showEditQr) showEditQr.hidden = !qrTargets.some((item) => item.kind === "edit");
    if (ownerControls) ownerControls.hidden = !controls.ownerSettings;
    if (controls.ownerSettings && retentionValue && state.session?.retention_hours) {
      const hours = Number(state.session.retention_hours);
      if (hours % 24 === 0) {
        retentionValue.value = String(hours / 24);
        retentionUnit.value = "days";
      } else {
        retentionValue.value = String(hours);
        retentionUnit.value = "hours";
      }
      updateRetentionMax();
    }
  }

  function updateRetentionMax() {
    if (!retentionValue || !retentionUnit) return;
    retentionValue.max = String(retentionMaxForUnit(retentionUnit.value));
    if (Number(retentionValue.value) > Number(retentionValue.max)) {
      retentionValue.value = retentionValue.max;
    }
  }

  async function copyText(value, label) {
    try {
      await copyTextToClipboard(value, window.navigator?.clipboard, doc);
      status.value = `${label} copied`;
    } catch (error) {
      status.value = error.message || `${label} copy failed`;
    }
  }

  doc.getElementById("copyViewLink")?.addEventListener("click", () => {
    const links = ownerLinks();
    if (links.viewUrl) copyText(links.viewUrl, "View Link");
  });
  doc.getElementById("copyEditLink")?.addEventListener("click", () => {
    const links = ownerLinks();
    if (links.editUrl) copyText(links.editUrl, "Edit Link");
  });
  async function showQr(kind) {
    const target = qrTargetsForAccess(access.mode, ownerLinks(), currentAbsoluteUrl()).find(
      (item) => item.kind === kind
    );
    if (!target) return;
    try {
      setSafeText(qrStatus, "Loading");
      setSafeText(qrTitle, target.label);
      releaseObjectUrl(state.qrObjectUrl);
      state.qrObjectUrl = await fetchQrObjectUrl(target.url);
      state.qrCurrentUrl = target.url;
      qrImage.src = state.qrObjectUrl;
      qrDialog?.showModal?.();
      setSafeText(qrStatus, target.url);
    } catch (error) {
      status.value = error.message;
    }
  }

  doc.getElementById("showViewQr")?.addEventListener("click", () => showQr("view"));
  doc.getElementById("showEditQr")?.addEventListener("click", () => showQr("edit"));
  shareButton?.addEventListener("click", () => {
    if (sharePanel) sharePanel.hidden = !sharePanel.hidden;
  });
  doc.getElementById("closeSharePanel")?.addEventListener("click", () => {
    if (sharePanel) sharePanel.hidden = true;
  });
  doc.getElementById("copyQrLink")?.addEventListener("click", () => {
    if (state.qrCurrentUrl) copyText(state.qrCurrentUrl, "QR Link");
  });
  qrDialog?.addEventListener?.("close", () => {
    releaseObjectUrl(state.qrObjectUrl);
    state.qrObjectUrl = "";
    state.qrCurrentUrl = "";
    if (qrImage) qrImage.removeAttribute("src");
  });
  retentionUnit?.addEventListener("change", updateRetentionMax);
  doc.getElementById("saveRetention")?.addEventListener("click", async () => {
    if (access.mode !== "owner") return;
    try {
      status.value = "Saving retention";
      const res = await fetch(`/api/sessions/${sessionIdForRequests()}/retention`, {
        method: "PATCH",
        headers: {
          ...accessHeaders(access),
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          value: Number(retentionValue?.value ?? 1),
          unit: retentionUnit?.value ?? "hours"
        })
      });
      if (!res.ok) throw new Error(`Retention failed: ${res.status}`);
      const updated = await res.json();
      state.session = {
        ...state.session,
        expires_at: updated.expires_at,
        retention_hours: updated.retention_hours
      };
      setShareControls();
      status.value = "Retention saved";
    } catch (error) {
      status.value = error.message;
    }
  });

  async function start() {
    try {
      if (route.mode === "home") {
        if (annotationPanel) annotationPanel.hidden = false;
        if (roleChip) roleChip.textContent = "Creating";
        status.value = "Creating canvas";
        const rootKey = readOrCreateRootIdempotencyKey(window.localStorage, window.crypto);
        const created = await createRootSession(rootKey);
        window.location.replace(created.owner_url);
        return;
      }
      if (annotationPanel) annotationPanel.hidden = false;
      if (roleChip) {
        roleChip.textContent =
          route.mode === "owner" ? "Owner" : route.mode === "edit" ? "Editor" : "Viewer";
      }
      setEditControls();
      const res = await fetch(
        `/api/share/${route.mode}/${encodeURIComponent(route.token)}`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        status.value = `Load failed: ${res.status}`;
        return;
      }
      state.session = await res.json();
      setShareControls();
      updateToolButtons();
      if (!state.session.screenshots.length) {
        status.value = "No screenshots";
        return;
      }
      await loadPage(0);
      state.lastSaveAt = Date.now();
      state.lastPollAt = Date.now();
      window.setInterval(tickSync, 1000);
    } catch (error) {
      status.value = error.message || "Load failed";
      return;
    }
  }

  window.addEventListener?.("pagehide", () => {
    releaseObjectUrl(state.baseImageObjectUrl);
    releaseObjectUrl(state.qrObjectUrl);
  });

  return { start, state };
}

if (typeof document !== "undefined" && document.getElementById("drawCanvas")) {
  initViewer().start();
}
