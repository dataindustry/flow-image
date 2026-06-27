import { createHash } from "node:crypto";

export const PAIR_CODE_PATTERN =
  /^FIMG-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizePairCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isValidPairCode(value) {
  return PAIR_CODE_PATTERN.test(normalizePairCode(value));
}

export function hashCredential(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}
