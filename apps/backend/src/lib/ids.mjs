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

export function makeViewToken() {
  return randomBytes(9).toString("base64url");
}

export function makeEditToken() {
  return randomBytes(9).toString("base64url");
}

export function makeOwnerToken() {
  return randomBytes(9).toString("base64url");
}

export function makeScreenshotId(index) {
  return `shot_${String(index).padStart(4, "0")}`;
}

export function makeAnnotationId(index) {
  return `ann_${String(index).padStart(4, "0")}`;
}
