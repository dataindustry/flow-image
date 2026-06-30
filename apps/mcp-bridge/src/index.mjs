import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { flowImagePublish, flowImageRepublish, publishScreenshots } from "./tools/publish.mjs";
import { collectAnnotations, flowImageSync } from "./tools/collect.mjs";
import { flowImageSettings } from "./tools/settings.mjs";

export function createServer() {
  const server = new McpServer({
    name: "net.like-water/flow-image",
    version: "0.1.0"
  });

  const publishSchema = {
    session_title: z.string().min(1).max(120),
    screenshot_paths: z.array(z.string()).min(1).max(10),
    labels: z.array(z.string()).max(10).optional()
  };

  server.tool("flow_image_settings", {}, async (args) => flowImageSettings(args));

  server.tool("flow_image_publish", publishSchema, async (args) => flowImagePublish(args));

  server.tool(
    "flow_image_republish",
    {
      owner_url: z.string().url(),
      screenshot_paths: z.array(z.string()).min(1).max(10),
      labels: z.array(z.string()).max(10).optional()
    },
    async (args) => flowImageRepublish(args)
  );

  server.tool(
    "flow_image_sync",
    {
      owner_url: z.string().url().optional(),
      session_id: z.string().min(1).optional()
    },
    async (args) => flowImageSync(args)
  );

  server.tool("ui_publish_screenshots", publishSchema, async (args) => publishScreenshots(args));

  server.tool(
    "ui_collect_annotations",
    {
      session_id: z.string().min(1).optional()
    },
    async (args) => collectAnnotations(args)
  );

  return server;
}

export async function startServer() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await startServer();
}
