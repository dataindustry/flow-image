import { randomBytes } from "node:crypto";

function ymd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function makeSessionId(date = new Date()) {
  return `sess_${ymd(date)}_${randomBytes(8).toString("hex")}`;
}

export function makeSessionSecret() {
  return `sec_${randomBytes(24).toString("base64url").slice(0, 32)}`;
}

export function makeScreenshotId(index) {
  return `shot_${String(index).padStart(4, "0")}`;
}

export function makeAnnotationId(index) {
  return `ann_${String(index).padStart(4, "0")}`;
}
