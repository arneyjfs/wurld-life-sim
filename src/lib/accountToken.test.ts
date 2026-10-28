/**
 * BILL-APPLE-1 — the client account token (Web Crypto twin). Server parity is
 * pinned in functions/src/billing/__tests__/accountTokenParity.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { WURLD_ACCOUNT_NAMESPACE, accountTokenForUid, uuidV5 } from './accountToken';

describe('BILL-APPLE-1 — client uuidV5 / accountTokenForUid', () => {
  it('BILL-APPLE-1 — matches the RFC/Python DNS vector', async () => {
    expect(await uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8'))
      .toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('BILL-APPLE-1 — pinned vector under the Wurld namespace', async () => {
    expect(WURLD_ACCOUNT_NAMESPACE).toBe('334b6457-d450-414a-bef4-cd2e80593741');
    expect(await accountTokenForUid('u1')).toBe('625fe207-4a95-5afc-beb4-0daa57340225');
  });

  it('BILL-APPLE-1 — rejects an empty uid', async () => {
    await expect(accountTokenForUid('')).rejects.toThrow();
  });
});
