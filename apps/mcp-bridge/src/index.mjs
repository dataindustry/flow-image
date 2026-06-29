import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { publishScreenshots } from "./tools/publish.mjs";
import { collectAnnotations } from "./tools/collect.mjs";

export function createServer() {
  const server = new McpServer({
    name: "net.like-water/flow-image",
    version: "0.1.0"
  });

  server.tool(
    "ui_publish_screenshots",
    {
      session_title: z.string().min(1).max(120),
      screenshot_paths: z.array(z.string()).min(1).max(10),
      labels: z.array(z.string()).max(10).optional()
    },
    async (args) => publishScreenshots(args)
  );

  server.tool(
    "ui_collect_annotations",
    {
      session_id: z.string().min(1).optional()
    },
    async (args) => collectAnnotations(args)
  );

  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
