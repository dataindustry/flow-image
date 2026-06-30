---
name: flow-image
description: Configure and use FlowImage to publish UI screenshots for iPad/Web canvas review and collect returned PNGs back into Codex.
---

Use this skill when the user asks to configure FlowImage, open FlowImage settings, publish screenshots with FlowImage, republish screenshots to an existing FlowImage owner session, or sync FlowImage canvas results.

## Configure

Call the bundled MCP tool `flow_image_settings`.
It starts or reuses the local settings page and returns the actual settings URL.
Open or show that returned URL directly; do not infer the port or inspect source code.
The page saves config to `~/.flowimage/config.json`.
Only the FlowImage server URL is required. Published sessions store their owner tokens locally after `flow_image_publish` or `flow_image_republish`.

## Verify

Run:

```bash
node <flow-image-repo>/plugins/flow-image/scripts/settings-server.mjs --print-config
```

## Use

After configuration, use the bundled `flow_image` MCP server tools:

- `flow_image_settings`
- `flow_image_publish`
- `flow_image_republish`
- `flow_image_sync`

Never modify application code immediately after collecting returned images. First show or summarize the returned images and wait for the user to confirm.
