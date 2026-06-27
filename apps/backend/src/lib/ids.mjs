import { randomBytes, randomInt } from "node:crypto";

const PAIR_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

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

export function makePairId(date = new Date()) {
  return `pair_${ymd(date)}_${randomBytes(8).toString("hex")}`;
}

export function makePairDeviceId(date = new Date()) {
  return `pdev_${ymd(date)}_${randomBytes(8).toString("hex")}`;
}

export function makePairDeviceToken() {
  return `pdevtok_${randomBytes(32).toString("base64url")}`;
}

export function makePairCode() {
  const chars = [];
  for (let index = 0; index < 24; index += 1) {
    chars.push(PAIR_CODE_ALPHABET[randomInt(PAIR_CODE_ALPHABET.length)]);
  }
  const groups = [];
  for (let index = 0; index < chars.length; index += 4) {
    groups.push(chars.slice(index, index + 4).join(""));
  }
  return `FIMG-${groups.join("-")}`;
}

export function makeScreenshotId(index) {
  return `shot_${String(index).padStart(4, "0")}`;
}

export function makeAnnotationId(index) {
  return `ann_${String(index).padStart(4, "0")}`;
}
