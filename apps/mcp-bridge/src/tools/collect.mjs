import { readFile } from "node:fs/promises";
import { BackendClient } from "../backend-client.mjs";

export async function collectAnnotations(args, deps = {}) {
  const backend = deps.backend ?? new BackendClient();
  const read = deps.readFile ?? readFile;
  const ready =
    !args.session_id && typeof backend.collectLatestAnnotations === "function"
      ? await backend.collectLatestAnnotations()
      : !args.session_secret && typeof backend.collectAnnotations === "function"
        ? await backend.collectAnnotations(args.session_id)
        : await backend.readyAnnotations(args.session_id, args.session_secret);

  if (!ready.items?.length) {
    return {
      content: [{ type: "text", text: `No ready annotations for ${args.session_id ?? "latest session"}.` }],
      structuredContent: {
        session_id: ready.session_id ?? args.session_id,
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
            `已收到 ${ready.items.length} 张 FlowImage 标注图。请先目视检查图片或打开 ${ready.review_url}。` +
            `确认无误后说“确认，按这些标注修改”。在确认前我不会修改代码。`
        }
      ]
    : [];
  for (const item of ready.items) {
    if (!ready.review_url) content.push({ type: "text", text: `Page ${item.page_index}:` });
    const bytes = await read(item.merged_png_path);
    content.push({
      type: "image",
      mimeType: "image/png",
      data: Buffer.from(bytes).toString("base64")
    });
  }

  return {
    content,
    structuredContent: {
      session_id: ready.session_id ?? args.session_id,
      ready_count: ready.items.length,
      review_url: ready.review_url,
      annotations: ready.items
    }
  };
}
