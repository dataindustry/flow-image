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
    baseImage.src = withSecret(page.image_url, secret);
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
        headers: { "X-Session-Secret": secret },
        body
      });
      if (!res.ok) throw new Error(`Save failed: ${res.status}`);
      status.value = "Saved";
    } catch (error) {
      status.value = error.message;
    }
  });

  async function start() {
    if (!sessionId || !secret) {
      status.value = "Missing session";
      return;
    }
    const res = await fetch(`/api/sessions/${sessionId}?secret=${encodeURIComponent(secret)}`);
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

if (typeof document !== "undefined" && document.getElementById("drawCanvas")) {
  initViewer().start();
}
