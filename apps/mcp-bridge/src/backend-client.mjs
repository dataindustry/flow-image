import { readFile } from "node:fs/promises";
import path from "node:path";
import { resolveFlowImageConfig } from "./flowimage-config.mjs";

export class BackendClient {
  constructor(options = {}) {
    const config = resolveFlowImageConfig();
    const baseUrl = options.baseUrl ?? config.serverUrl;
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  ownerHeaders(ownerToken) {
    return { "X-FlowImage-Owner-Token": ownerToken ?? "" };
  }

  async createSession({ title }) {
    const res = await fetch(`${this.baseUrl}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ title })
    });
    return readJson(res);
  }

  async resolveOwnerSession(ownerUrl) {
    const parsed = new URL(ownerUrl);
    const [, mode, token] = parsed.pathname.split("/");
    if (mode !== "o" || !token) throw new Error("owner_url must be a FlowImage Owner URL");
    const res = await fetch(`${this.baseUrl}/api/share/owner/${token}`);
    const session = await readJson(res);
    return {
      ...session,
      owner_token: token,
      owner_url: new URL(`/o/${token}`, this.baseUrl).toString()
    };
  }

  async uploadScreenshots(sessionId, filePaths, labels = [], ownerToken, options = {}) {
    const body = new FormData();
    if (options.replace) body.append("replace", "true");
    for (const [index, filePath] of filePaths.entries()) {
      const bytes = await readFile(filePath);
      body.append("files[]", new Blob([bytes], { type: "image/png" }), path.basename(filePath));
      if (labels[index]) body.append("labels[]", labels[index]);
    }
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/screenshots`, {
      method: "POST",
      headers: this.ownerHeaders(ownerToken),
      body
    });
    return readJson(res);
  }

  async collectResults(sessionId, ownerToken) {
    const res = await fetch(`${this.baseUrl}/api/sessions/${sessionId}/annotations/collect`, {
      method: "POST",
      headers: this.ownerHeaders(ownerToken)
    });
    return readJson(res);
  }

  async fetchAnnotationImage(url, ownerToken) {
    const resolved = new URL(url, `${this.baseUrl}/`).toString();
    const res = await fetch(resolved, {
      headers: this.ownerHeaders(ownerToken)
    });
    if (!res.ok) {
      throw new Error(`Annotation image request failed: ${res.status}`);
    }
    return Buffer.from(await res.arrayBuffer());
  }
}

async function readJson(res) {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(body.error ?? `Backend request failed: ${res.status}`);
  }
  return body;
}
