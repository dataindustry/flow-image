import path from "node:path";

export const DEFAULT_TTL_HOURS = 24;
export const MAX_SCREENSHOTS = 10;
export const MAX_PNG_BYTES = 15 * 1024 * 1024;

export function makeConfig(overrides = {}) {
  const port = Number(overrides.port ?? process.env.PORT ?? 3939);
  const bindHost = overrides.bindHost ?? process.env.BIND_HOST ?? "127.0.0.1";
  const publicBaseUrl =
    overrides.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? `http://${bindHost}:${port}`;
  const bridgeToken = overrides.bridgeToken ?? process.env.BRIDGE_TOKEN;
  const dataDir =
    overrides.dataDir ?? path.resolve(process.cwd(), "apps/backend/data/sessions");
  const now = overrides.now ?? (() => new Date());

  return {
    port,
    bindHost,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    bridgeToken,
    dataDir,
    now
  };
}
