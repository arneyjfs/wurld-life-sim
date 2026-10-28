/**
 * BILL-APPLE-1 / BILL-GOOGLE-1 — the client twin of the account token.
 *
 * Spec: docs/specs/billing.md §BILL-APPLE-1.
 *
 * `accountTokenForUid(uid)` = RFC 4122 UUIDv5 of the uid under
 * `WURLD_ACCOUNT_NAMESPACE`. Passed as Apple's `appAccountToken` and Google's
 * `obfuscatedAccountId` when a purchase starts; the server recomputes it from
 * the verified caller and refuses a mismatch (BILL-SEC-2).
 *
 * ⚠ Server twin: `functions/src/billing/accountToken.ts` (node crypto, sync).
 * The two cannot import each other (different runtimes), so
 * `functions/src/billing/__tests__/accountTokenParity.test.ts` runs both over
 * the same uids. NEVER change the namespace — see the server header.
 *
 * Async because Web Crypto's digest is. No dependency.
 */

/** Fixed forever. Must equal the server's constant. */
export const WURLD_ACCOUNT_NAMESPACE = '334b6457-d450-414a-bef4-cd2e80593741';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuidToBytes(uuid: string): Uint8Array {
  if (!UUID_RE.test(uuid)) throw new Error(`uuidV5: malformed namespace ${uuid}`);
  const hex = uuid.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** RFC 4122 §4.3 name-based UUID, version 5 (SHA-1), via Web Crypto. */
export async function uuidV5(name: string, namespace: string): Promise<string> {
  const ns = uuidToBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-1', input));
  const b = digest.slice(0, 16);
  b[6] = (b[6]! & 0x0f) | 0x50; // version 5
  b[8] = (b[8]! & 0x3f) | 0x80; // RFC 4122 variant
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The account token for `uid`. Rejects an empty uid. */
export async function accountTokenForUid(uid: string): Promise<string> {
  if (typeof uid !== 'string' || uid.length === 0) throw new Error('accountTokenForUid: uid required');
  return uuidV5(uid, WURLD_ACCOUNT_NAMESPACE);
}
