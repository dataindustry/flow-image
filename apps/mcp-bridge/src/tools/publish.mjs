import { access } from "node:fs/promises";
import { BackendClient } from "../backend-client.mjs";

async function assertLocalFiles(paths) {
  for (const filePath of paths) {
    try {
      await access(filePath);
    } catch {
      throw new Error(`Missing local PNG: ${filePath}`);
    }
  }
}

export async function publishScreenshots(args, deps = {}) {
  const backend = deps.backend ?? new BackendClient();
  const sessionTitle = String(args.session_title ?? "").trim();
  const screenshotPaths = args.screenshot_paths ?? [];
  const labels = args.labels ?? [];

  if (!sessionTitle) throw new Error("session_title is required");
  if (!Array.isArray(screenshotPaths) || !screenshotPaths.length) {
    throw new Error("screenshot_paths must contain at least one path");
  }

  await assertLocalFiles(screenshotPaths);
  const session = await backend.createSession({ title: sessionTitle });
  const uploaded = await backend.uploadScreenshots(
    session.session_id,
    session.session_secret,
    screenshotPaths,
    labels
  );

  return {
    content: [
      {
        type: "text",
        text:
          `Created annotation session ${session.session_id} with ${uploaded.count} screenshot(s). ` +
          `Open ${session.viewer_url} to annotate. do not modify code until annotations are collected.`
      }
    ],
    structuredContent: {
      session_id: session.session_id,
      session_secret: session.session_secret,
      viewer_url: session.viewer_url,
      uploaded_pages: uploaded.items
    }
  };
}
