import { defaultFlowImageConfigPath } from "../flowimage-config.mjs";
import {
  loadConfig,
  startSettingsServer
} from "../../../../plugins/flow-image/scripts/settings-server.mjs";

let settingsServerPromise;

export async function flowImageSettings(_args = {}, deps = {}) {
  const configPath = deps.configPath ?? defaultFlowImageConfigPath();
  const starter = deps.startSettingsServer ?? startSettingsServer;
  const configLoader = deps.loadConfig ?? loadConfig;
  if (!settingsServerPromise) {
    settingsServerPromise = starter({ configPath, openBrowser: false });
  }
  const server = await settingsServerPromise;
  const config = await configLoader(configPath);
  return {
    content: [
      {
        type: "text",
        text: `FlowImage Settings: ${server.url}/`
      }
    ],
    structuredContent: {
      settings_url: `${server.url}/`,
      config_path: configPath,
      server_url: config.server_url
    }
  };
}
