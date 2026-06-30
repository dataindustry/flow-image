import os from "node:os";

export function firstLanIPv4(interfaces = os.networkInterfaces()) {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

export function commandName(command, platform = process.platform) {
  return platform === "win32" ? `${command}.cmd` : command;
}

export function pnpmCommand() {
  const npmExecPath = process.env.npm_execpath;
  if (npmExecPath && /pnpm/i.test(npmExecPath)) {
    return { command: process.execPath, args: [npmExecPath] };
  }
  return { command: commandName("pnpm"), args: [] };
}
