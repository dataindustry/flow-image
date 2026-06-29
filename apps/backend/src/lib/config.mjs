import path from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_SCREENSHOTS = 10;
export const MAX_PNG_BYTES = 15 * 1024 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, "../../data");

export function makeConfig(overrides = {}) {
  const port = Number(overrides.port ?? process.env.PORT ?? 3939);
  const bindHost = overrides.bindHost ?? process.env.BIND_HOST ?? "127.0.0.1";
  const publicBaseUrl =
    overrides.publicBaseUrl ?? process.env.PUBLIC_BASE_URL ?? `http://${bindHost}:${port}`;
  const dataDir = overrides.dataDir ?? defaultDataDir;
  const now = overrides.now ?? (() => new Date());
  const rateLimit = makeRateLimitConfig(overrides.rateLimit ?? {});

  return {
    port,
    bindHost,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    dataDir,
    now,
    rateLimit
  };
}

function envNumber(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name, fallback) {
  const value = process.env[name];
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(value).toLowerCase());
}

function configNumber(overrides, key, envName, fallback) {
  return Number(overrides[key] ?? envNumber(envName, fallback));
}

export function makeRateLimitConfig(overrides = {}) {
  return {
    enabled: overrides.enabled ?? envBool("FLOWIMAGE_RATE_LIMIT_ENABLED", true),
    windowMs: configNumber(overrides, "windowMs", "FLOWIMAGE_RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000),
    createLimit: configNumber(overrides, "createLimit", "FLOWIMAGE_CREATE_LIMIT", 30),
    qrLimit: configNumber(overrides, "qrLimit", "FLOWIMAGE_QR_LIMIT", 120),
    uploadRequestLimit: configNumber(
      overrides,
      "uploadRequestLimit",
      "FLOWIMAGE_UPLOAD_REQUEST_LIMIT",
      30
    ),
    uploadBytesLimit: configNumber(
      overrides,
      "uploadBytesLimit",
      "FLOWIMAGE_UPLOAD_BYTES_LIMIT",
      600 * 1024 * 1024
    ),
    sessionBytesLimit: configNumber(
      overrides,
      "sessionBytesLimit",
      "FLOWIMAGE_SESSION_BYTES_LIMIT",
      500 * 1024 * 1024
    )
  };
}
