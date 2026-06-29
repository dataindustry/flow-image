import { BackendClient } from "../backend-client.mjs";
import { readFlowImageSession, readLatestFlowImageSession } from "../flowimage-config.mjs";

export async function collectAnnotations(args, deps = {}) {
  const backend = deps.backend ?? new BackendClient();
  const sessionRegistry = deps.sessionRegistry ?? {
    read: (sessionId) => readFlowImageSession(sessionId),
    latest: () => readLatestFlowImageSession()
  };
  const remembered = args.session_id
    ? sessionRegistry.read(args.session_id)
    : sessionRegistry.latest();
  if (!remembered?.sessionId || !remembered?.ownerToken) {
    throw new Error(
      "Missing FlowImage owner token for this session. Publish the session from this Codex setup again or provide a remembered session."
    );
  }
  const ready = await backend.collectAnnotations(remembered.sessionId, remembered.ownerToken);
  if (remembered.viewUrl) ready.review_url = remembered.viewUrl;

  if (!ready.items?.length) {
    return {
      content: [{ type: "text", text: `会话 ${remembered.sessionId} 当前没有可收取的 FlowImage 结果。` }],
      structuredContent: {
        session_id: ready.session_id ?? remembered.sessionId,
        ready_count: 0,
        annotations: []
      }
    };
  }

  const content = ready.review_url
    ? [
        {
          type: "text",
          text:
            `已收到 ${ready.items.length} 张 FlowImage 结果图。请先目视检查图片或打开 ${ready.review_url}。` +
            `确认无误后说“确认，按这些结果修改”。在确认前我不会修改代码。`
        }
      ]
    : [];
  for (const item of ready.items) {
    if (!ready.review_url) content.push({ type: "text", text: `第 ${item.page_index} 页：` });
    const bytes = await backend.fetchAnnotationImage(item.merged_png_url, remembered.ownerToken);
    content.push({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from(bytes).toString("base64")
    });
  }

  return {
    content,
    structuredContent: {
      session_id: ready.session_id ?? remembered.sessionId,
      ready_count: ready.items.length,
      review_url: ready.review_url,
      annotations: ready.items
    }
  };
}
