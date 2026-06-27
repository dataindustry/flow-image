import { readFile } from "node:fs/promises";
import { BackendClient } from "../backend-client.mjs";

export async function collectAnnotations(args, deps = {}) {
  const backend = deps.backend ?? new BackendClient();
  const read = deps.readFile ?? readFile;
  const ready = await backend.readyAnnotations(args.session_id, args.session_secret);

  if (!ready.items?.length) {
    return {
      content: [{ type: "text", text: `No ready annotations for ${args.session_id}.` }],
      structuredContent: {
        session_id: args.session_id,
        ready_count: 0,
        annotations: []
      }
    };
  }

  const content = [];
  for (const item of ready.items) {
    content.push({ type: "text", text: `Page ${item.page_index}:` });
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
      session_id: args.session_id,
      ready_count: ready.items.length,
      annotations: ready.items
    }
  };
}
