import { createHash } from "crypto";

/**
 * The repo's one short content hash: sha256, first 16 hex chars (64 bits).
 * Replaces a 32-bit djb2 (`hashString`) whose collisions could make an explicit
 * cache adopt the wrong system instruction (audit CPLX-FN-14/18).
 */
export function shortHash(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16);
}
