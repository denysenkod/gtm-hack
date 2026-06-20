import { createHash } from "node:crypto";

export function normalizeForHash(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function hashText(text: string): string {
  return sha256(normalizeForHash(text));
}
