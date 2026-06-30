import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

export const MAX_SCREENSHOTS = 10;
export const MAX_PNG_BYTES = 15 * 1024 * 1024;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDataDir = path.resolve(__dirname, "../../data");

export function makeConfig(overrides = {}) {
  const env = overrides.env ?? process.env;
  const port = Number(overrides.port ?? envValue(env, "PORT") ?? 3939);
  const bindHost = overrides.bindHost ?? envValue(env, "BIND_HOST") ?? "0.0.0.0";
  const https = makeHttpsConfig(overrides.https, env);
  const scheme = https ? "https" : "http";
  const publicHost = isWildcardHost(bindHost)
    ? overrides.lanAddress?.() ?? detectLanAddress() ?? "127.0.0.1"
    : bindHost;
  const publicBaseUrl =
    overrides.publicBaseUrl ?? envValue(env, "PUBLIC_BASE_URL") ?? `${scheme}://${publicHost}:${port}`;
  const dataDir = overrides.dataDir ?? defaultDataDir;
  const now = overrides.now ?? (() => new Date());
  const rateLimit = makeRateLimitConfig(overrides.rateLimit ?? {}, env);

  return {
    port,
    bindHost,
    publicBaseUrl: publicBaseUrl.replace(/\/$/, ""),
    dataDir,
    now,
    rateLimit,
    https
  };
}

function envValue(env, name) {
  const value = env[name];
  return value === undefined || value === "" ? undefined : value;
}

function envNumber(env, name, fallback) {
  const value = envValue(env, name);
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(env, name, fallback) {
  const value = envValue(env, name);
  if (value === undefined || value === "") return fallback;
  return !["0", "false", "off", "no"].includes(String(value).toLowerCase());
}

function configNumber(overrides, key, env, envName, fallback) {
  return Number(overrides[key] ?? envNumber(env, envName, fallback));
}

export function makeRateLimitConfig(overrides = {}, env = process.env) {
  return {
    enabled: overrides.enabled ?? envBool(env, "FLOWIMAGE_RATE_LIMIT_ENABLED", true),
    windowMs: configNumber(overrides, "windowMs", env, "FLOWIMAGE_RATE_LIMIT_WINDOW_MS", 10 * 60 * 1000),
    createLimit: configNumber(overrides, "createLimit", env, "FLOWIMAGE_CREATE_LIMIT", 30),
    qrLimit: configNumber(overrides, "qrLimit", env, "FLOWIMAGE_QR_LIMIT", 120),
    uploadRequestLimit: configNumber(
      overrides,
      "uploadRequestLimit",
      env,
      "FLOWIMAGE_UPLOAD_REQUEST_LIMIT",
      30
    ),
    uploadBytesLimit: configNumber(
      overrides,
      "uploadBytesLimit",
      env,
      "FLOWIMAGE_UPLOAD_BYTES_LIMIT",
      600 * 1024 * 1024
    ),
    capabilityUploadLimit: configNumber(
      overrides,
      "capabilityUploadLimit",
      env,
      "FLOWIMAGE_CAPABILITY_UPLOAD_LIMIT",
      240
    ),
    capabilityUploadBytesLimit: configNumber(
      overrides,
      "capabilityUploadBytesLimit",
      env,
      "FLOWIMAGE_CAPABILITY_UPLOAD_BYTES_LIMIT",
      600 * 1024 * 1024
    ),
    sessionBytesLimit: configNumber(
      overrides,
      "sessionBytesLimit",
      env,
      "FLOWIMAGE_SESSION_BYTES_LIMIT",
      500 * 1024 * 1024
    )
  };
}

function makeHttpsConfig(overrides, env) {
  if (overrides === false) return null;
  const certPath = overrides?.certPath ?? envValue(env, "HTTPS_CERT_PATH");
  const keyPath = overrides?.keyPath ?? envValue(env, "HTTPS_KEY_PATH");
  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) {
    throw new Error("HTTPS_CERT_PATH and HTTPS_KEY_PATH must be set together");
  }
  return { certPath, keyPath };
}

function isWildcardHost(host) {
  return host === "0.0.0.0" || host === "::";
}

function detectLanAddress() {
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) {
        return entry.address;
      }
    }
  }
  return null;
}
