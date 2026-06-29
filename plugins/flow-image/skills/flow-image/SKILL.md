---
name: flow-image
description: Configure and use FlowImage to publish UI screenshots for iPad/Web canvas review and collect returned PNGs back into Codex.
---

Use this skill when the user asks to configure FlowImage, open FlowImage settings, publish screenshots with FlowImage, or collect FlowImage canvas results.

## Configure

Run:

```bash
node <flow-image-repo>/plugins/flow-image/scripts/settings-server.mjs --open
```

Keep the settings server running while the user edits the page. It saves config to `~/.flowimage/config.json`.
Only the FlowImage server URL is required. Published sessions store their owner tokens locally after `ui_publish_screenshots`.

## Verify

Run:

```bash
node <flow-image-repo>/plugins/flow-image/scripts/settings-server.mjs --print-config
```

## Use

After configuration, use the bundled `flow_image` MCP server tools:

- `ui_publish_screenshots`
- `ui_collect_annotations`

Never modify application code immediately after collecting returned images. First show or summarize the returned images and wait for the user to confirm.
