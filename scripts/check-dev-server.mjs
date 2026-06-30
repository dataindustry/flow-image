import { firstLanIPv4 } from "./platform.mjs";

const lanHost = process.env.FLOWIMAGE_LAN_HOST || firstLanIPv4();
const urls = [process.env.FLOWIMAGE_LOCAL_URL || "http://127.0.0.1:3939/"];

if (!["0", "false", "off", "no"].includes(String(process.env.FLOWIMAGE_CHECK_LAN ?? "1").toLowerCase())) {
  urls.push(process.env.FLOWIMAGE_LAN_URL || `http://${lanHost}:3939/`);
}

for (const url of urls) {
  console.log(`Checking ${url}`);
  await checkUrl(url);
}

console.log("FlowImage dev server is reachable.");

async function checkUrl(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } finally {
    clearTimeout(timeout);
  }
}
