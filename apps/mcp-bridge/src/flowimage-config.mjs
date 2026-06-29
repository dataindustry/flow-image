import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const DEFAULT_FLOWIMAGE_SERVER_URL = "https://flow-image.liujinhang.com";

export function defaultFlowImageConfigPath(env = process.env) {
  return env.FLOWIMAGE_CONFIG_PATH ?? path.join(os.homedir(), ".flowimage", "config.json");
}

function readConfigFile(configPath) {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return {};
    throw error;
  }
}

function envValue(value) {
  const trimmed = String(value ?? "").trim();
  return trimmed || undefined;
}

function withoutDeprecatedConfig(config) {
  const { pair_code, pairCode, ...rest } = config;
  return rest;
}

export function resolveFlowImageConfig(env = process.env) {
  const configPath = defaultFlowImageConfigPath(env);
  const fileConfig = readConfigFile(configPath);
  return {
    serverUrl:
      envValue(env.FLOWIMAGE_SERVER_URL) ??
      envValue(env.PUBLIC_BASE_URL) ??
      fileConfig.server_url ??
      fileConfig.serverUrl ??
      DEFAULT_FLOWIMAGE_SERVER_URL,
    configPath
  };
}

function normalizeSessionRecord(record) {
  return {
    session_id: String(record.sessionId ?? record.session_id ?? ""),
    owner_token: String(record.ownerToken ?? record.owner_token ?? ""),
    view_url: String(record.viewUrl ?? record.view_url ?? ""),
    edit_url: String(record.editUrl ?? record.edit_url ?? ""),
    owner_url: String(record.ownerUrl ?? record.owner_url ?? ""),
    updated_at: new Date().toISOString()
  };
}

export function rememberFlowImageSession(record, env = process.env) {
  const configPath = defaultFlowImageConfigPath(env);
  const fileConfig = readConfigFile(configPath);
  const normalized = normalizeSessionRecord(record);
  if (!normalized.session_id || !normalized.owner_token) {
    throw new Error("session_id and owner_token are required");
  }
  const sessions = Array.isArray(fileConfig.sessions) ? fileConfig.sessions : [];
  const nextSessions = [
    normalized,
    ...sessions.filter((item) => item.session_id !== normalized.session_id)
  ].slice(0, 20);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify({ ...fileConfig, sessions: nextSessions }, null, 2)
  );
  chmodSync(configPath, 0o600);
  return normalized;
}

export function readFlowImageSession(sessionId, env = process.env) {
  const fileConfig = readConfigFile(defaultFlowImageConfigPath(env));
  const found = Array.isArray(fileConfig.sessions)
    ? fileConfig.sessions.find((item) => item.session_id === sessionId)
    : null;
  if (!found) return null;
  return {
    sessionId: found.session_id,
    ownerToken: found.owner_token,
    viewUrl: found.view_url,
    editUrl: found.edit_url,
    ownerUrl: found.owner_url
  };
}

export function readLatestFlowImageSession(env = process.env) {
  const fileConfig = readConfigFile(defaultFlowImageConfigPath(env));
  const found = Array.isArray(fileConfig.sessions) ? fileConfig.sessions[0] : null;
  if (!found) return null;
  return {
    sessionId: found.session_id,
    ownerToken: found.owner_token,
    viewUrl: found.view_url,
    editUrl: found.edit_url,
    ownerUrl: found.owner_url
  };
}

export function writeFlowImageConfig(config, env = process.env) {
  const configPath = defaultFlowImageConfigPath(env);
  const serverUrl = String(config.server_url ?? config.serverUrl ?? "").trim();
  if (!serverUrl) throw new Error("server_url is required");

  const normalizedServerUrl = serverUrl.replace(/\/$/, "");
  const existing = readConfigFile(configPath);
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(
    configPath,
    JSON.stringify(
      {
        ...withoutDeprecatedConfig(existing),
        server_url: normalizedServerUrl,
        updated_at: new Date().toISOString()
      },
      null,
      2
    )
  );
  chmodSync(configPath, 0o600);
  return { configPath, serverUrl: normalizedServerUrl };
}
