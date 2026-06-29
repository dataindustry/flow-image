import { createHash } from "node:crypto";

export function hashCredential(value) {
  return createHash("sha256").update(String(value), "utf8").digest("hex");
}
