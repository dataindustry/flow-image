export function mapPointToNative(point, metrics) {
  return {
    x: point.x * (metrics.imageWidth / metrics.cssWidth),
    y: point.y * (metrics.imageHeight / metrics.cssHeight)
  };
}

export function computeStrokeWidth(event, baseWidth) {
  const pressure = event.pointerType === "pen" ? event.pressure || 0.5 : 0.5;
  return baseWidth * (0.6 + pressure * 1.2);
}

const PAIR_STATE_KEY = "flowImagePair";

export function savePairState(storage, state) {
  storage.setItem(
    PAIR_STATE_KEY,
    JSON.stringify({
      pair_id: state.pair_id,
      pair_device_token: state.pair_device_token
    })
  );
}

export function readPairState(storage) {
  try {
    const raw = storage.getItem(PAIR_STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSafeText(node, value) {
  node.textContent = String(value ?? "");
}

export async function fetchImageObjectUrl(
  url,
  pairDeviceToken,
  fetchImpl = fetch,
  urlImpl = URL
) {
  const res = await fetchImpl(url, {
    headers: { "X-Pair-Device-Token": pairDeviceToken }
  });
  if (!res.ok) throw new Error(`Image load failed: ${res.status}`);
  return urlImpl.createObjectURL(await res.blob());
}

function getSessionInfo() {
  const match = window.location.pathname.match(/\/s\/([^/]+)/);
  const params = new URLSearchParams(window.location.search);
  return {
    sessionId: match?.[1],
    secret: params.get("secret")
  };
}

function withSecret(url, secret) {
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}secret=${encodeURIComponent(secret)}`;
}

function getPairState() {
  return readPairState(window.localStorage);
}

function pairHeaders(pairState) {
  return { "X-Pair-Device-Token": pairState.pair_device_token };
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
    lastPoint: null
  };

  const { sessionId, secret } = getSessionInfo();
  const pairState = getPairState();
  const pairPanel = doc.getElementById("pairPanel");
  const annotationPanel = doc.getElementById("annotationPanel");
  const baseImage = doc.getElementById("baseImage");
  const canvas = doc.getElementById("drawCanvas");
  const ctx = canvas.getContext("2d");
  const status = doc.getElementById("saveStatus");
  const pageStatus = doc.getElementById("pageStatus");
  const colorInput = doc.getElementById("colorInput");
  const widthInput = doc.getElementById("widthInput");

  function currentPage() {
    return state.session?.screenshots[state.pageIndex];
  }

  function updateToolButtons() {
    for (const button of doc.querySelectorAll("[data-tool]")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
    }
  }

  async function loadPage(index) {
    state.pageIndex = Math.max(0, Math.min(index, state.session.screenshots.length - 1));
    const page = currentPage();
    pageStatus.value = `Page ${state.pageIndex + 1} / ${state.session.screenshots.length}`;
    baseImage.src = pairState
      ? await fetchImageObjectUrl(page.image_url, pairState.pair_device_token)
      : withSecret(page.image_url, secret);
    await baseImage.decode();
    canvas.width = page.width;
    canvas.height = page.height;
    canvas.style.width = `${baseImage.clientWidth}px`;
    canvas.style.height = `${baseImage.clientHeight}px`;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
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

  function drawSegment(from, to, event) {
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = computeStrokeWidth(event, Number(widthInput.value));
    if (state.tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
    } else {
      ctx.globalCompositeOperation = "source-over";
      ctx.strokeStyle = colorInput.value;
    }
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.restore();
  }

  canvas.addEventListener("pointerdown", (event) => {
    canvas.setPointerCapture(event.pointerId);
    state.drawing = true;
    state.lastPoint = pointerToNative(event);
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!state.drawing) return;
    const events =
      typeof event.getCoalescedEvents === "function" ? event.getCoalescedEvents() : [event];
    for (const item of events) {
      const nextPoint = pointerToNative(item);
      drawSegment(state.lastPoint, nextPoint, item);
      state.lastPoint = nextPoint;
    }
  });

  canvas.addEventListener("pointerup", () => {
    state.drawing = false;
    state.lastPoint = null;
  });

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
  doc.getElementById("submitPage").addEventListener("click", async () => {
    try {
      status.value = "Saving";
      const page = currentPage();
      const merged = doc.createElement("canvas");
      merged.width = page.width;
      merged.height = page.height;
      const mergedCtx = merged.getContext("2d");
      mergedCtx.drawImage(baseImage, 0, 0, page.width, page.height);
      mergedCtx.drawImage(canvas, 0, 0);
      const blob = await blobFromCanvas(merged);
      const body = new FormData();
      body.append("merged_png", blob, "merged.png");
      const res = await fetch(`/api/sessions/${sessionId}/annotations/${page.screenshot_id}`, {
        method: "POST",
        headers: pairState ? pairHeaders(pairState) : { "X-Session-Secret": secret },
        body
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      status.value = "Saved";
    } catch (error) {
      status.value = error.message;
    }
  });

  async function start() {
    if (!sessionId) {
      await startPairHome(doc);
      return;
    }
    if (!sessionId || !secret) {
      if (!pairState) {
        status.value = "Missing session";
        return;
      }
    }
    if (pairPanel) pairPanel.hidden = true;
    if (annotationPanel) annotationPanel.hidden = false;
    const res = pairState
      ? await fetch(`/api/sessions/${sessionId}`, { headers: pairHeaders(pairState) })
      : await fetch(`/api/sessions/${sessionId}?secret=${encodeURIComponent(secret)}`);
    if (!res.ok) {
      status.value = `Load failed: ${res.status}`;
      return;
    }
    state.session = await res.json();
    updateToolButtons();
    if (!state.session.screenshots.length) {
      status.value = "No screenshots";
      return;
    }
    await loadPage(0);
  }

  return { start, state };
}

async function startPairHome(doc) {
  const pairPanel = doc.getElementById("pairPanel");
  const annotationPanel = doc.getElementById("annotationPanel");
  const pairCodeOutput = doc.getElementById("pairCodeOutput");
  const pairStatus = doc.getElementById("pairStatus");
  const bindInput = doc.getElementById("bindPairCode");
  const sessionList = doc.getElementById("sessionList");
  if (!pairPanel) return;

  pairPanel.hidden = false;
  if (annotationPanel) annotationPanel.hidden = true;

  async function loadCurrent() {
    const pairState = getPairState();
    if (!pairState) {
      setSafeText(pairStatus, "Not paired");
      return;
    }
    const res = await fetch("/api/pairs/current", { headers: pairHeaders(pairState) });
    if (!res.ok) {
      setSafeText(pairStatus, `Pair load failed: ${res.status}`);
      return;
    }
    const pair = await res.json();
    setSafeText(pairStatus, `Paired: ${pair.pair_id}`);
    sessionList.replaceChildren();
    for (const session of pair.sessions ?? []) {
      const item = doc.createElement("button");
      item.type = "button";
      item.className = "session-item";
      setSafeText(item, `${session.title} · ${session.status}`);
      item.addEventListener("click", () => {
        window.location.assign(`/s/${session.session_id}`);
      });
      sessionList.append(item);
    }
  }

  doc.getElementById("generatePair").addEventListener("click", async () => {
    const res = await fetch("/api/pairs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: navigator.userAgent.slice(0, 80) })
    });
    if (!res.ok) {
      setSafeText(pairStatus, `Generate failed: ${res.status}`);
      return;
    }
    const pair = await res.json();
    savePairState(window.localStorage, pair);
    setSafeText(pairCodeOutput, pair.pair_code);
    await loadCurrent();
  });

  doc.getElementById("bindPair").addEventListener("click", async () => {
    const res = await fetch("/api/pairs/bind-device", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pair_code: bindInput.value, label: navigator.userAgent.slice(0, 80) })
    });
    if (!res.ok) {
      setSafeText(pairStatus, `Bind failed: ${res.status}`);
      return;
    }
    const pair = await res.json();
    savePairState(window.localStorage, pair);
    setSafeText(pairCodeOutput, "");
    await loadCurrent();
  });

  await loadCurrent();
}

if (typeof document !== "undefined" && document.getElementById("drawCanvas")) {
  initViewer().start();
}
