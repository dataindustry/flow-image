import { readFile } from "node:fs/promises";
import path from "node:path";

export class BackendClient {
  constructor({
    baseUrl = process.env.FLOWIMAGE_SERVER_URL ??
      process.env.PUBLIC_BASE_URL ??
      "http://127.0.0.1:3939",
    bridgeToken = process.env.BRIDGE_TOKEN,
    pairCode = process.env.FLOWIMAGE_PAIR_CODE
  } = {}) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.bridgeToken = bridgeToken;
    this.pairCode = pairCode;
  }

  get isPairMode() {
    return Boolean(this.pairCode);
  }

  async createSession({ title }) {
    const res = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(this.isPairMode
          ? { "X-FlowImage-Pair-Code": this.pairCode }
          : { "X-Bridge-Token": this.bridgeToken ?? "" })
      },
      body: JSON.stringify({ title })
    });
    return readJson(res);
  }

  async uploadScreenshots(sessionId, sessionSecret, filePaths, labels = []) {
    const body = new FormData();
    for (const [index, filePath] of filePaths.entries()) {
      const bytes = await readFile(filePath);
      body.append("files[]", new Blob([bytes], { type: "image/png" }), path.basename(filePath));
      if (labels[index]) body.append("labels[]", labels[index]);
    }
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/screenshots`, {
      method: "POST",
      headers: this.isPairMode
        ? { "X-FlowImage-Pair-Code": this.pairCode }
        : { "X-Session-Secret": sessionSecret },
      body
    });
    return readJson(res);
  }

  async readyAnnotations(sessionId, sessionSecret) {
    const url = `${this.baseUrl}/api/sessions/${sessionId}/annotations/ready?secret=${encodeURIComponent(sessionSecret)}`;
    const res = await fetch(url);
    return readJson(res);
  }

  async collectAnnotations(sessionId) {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/annotations/collect`, {
      method: "POST",
      headers: { "X-FlowImage-Pair-Code": this.pairCode ?? "" }
    });
    return readJson(res);
  }

  async collectLatestAnnotations() {
    const res = await fetch(`${this.baseUrl}/api/annotations/collect-latest`, {
      method: "POST",
      headers: { "X-FlowImage-Pair-Code": this.pairCode ?? "" }
    });
    return readJson(res);
  }
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Backend request failed: ${res.status}`);
  }
  return body;
}
