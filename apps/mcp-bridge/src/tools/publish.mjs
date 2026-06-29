import { access } from "node:fs/promises";
import { BackendClient } from "../backend-client.mjs";
import { rememberFlowImageSession } from "../flowimage-config.mjs";

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
  const sessionRegistry = deps.sessionRegistry ?? {
    remember: (record) => rememberFlowImageSession(record)
  };
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
    screenshotPaths,
    labels,
    session.owner_token
  );
  sessionRegistry.remember({
    sessionId: session.session_id,
    ownerToken: session.owner_token,
    viewUrl: session.view_url,
    editUrl: session.edit_url,
    ownerUrl: session.owner_url
  });

  return {
    content: [
      {
        type: "text",
        text:
          `已创建 FlowImage session ${session.session_id}，并上传 ${uploaded.count} 张截图。` +
          `View Link: ${session.view_url} ` +
          `Edit Link: ${session.edit_url}. ` +
          `Owner Link: ${session.owner_url}. ` +
          `只把 Edit Link 分享给允许修改画布的人。` +
          `在结果图被收取并完成目视检查前，不要修改代码。`
      }
    ],
    structuredContent: {
      session_id: session.session_id,
      view_url: session.view_url,
      edit_url: session.edit_url,
      owner_url: session.owner_url,
      uploaded_pages: uploaded.items
    }
  };
}
