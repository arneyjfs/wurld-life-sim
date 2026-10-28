import { useDocSnapshot } from './firestore/useDocSnapshot';
import {
  DEFAULT_LEGAL_CONFIG,
  ZLegalConfig,
  type LegalConfigState,
} from '@/lib/legalConfig';

/**
 * Live legal-policy config — AUTH-LEGAL-1.
 *
 * Reads `config/legal` via the standard 3-stage hydrated snapshot
 * (localStorage mirror → IndexedDB cache → live `onSnapshot`), so a
 * version bump in the doc redirects a live session into the agreements
 * step with no reload (AUTH-LEGAL-3), and a cached copy keeps it
 * flash-free on cold boot.
 *
 * State contract:
 *  - `unknown` — never loaded, no cache yet. The gate must NOT raise
 *    agreement gaps here (don't gate on a config we haven't seen).
 *  - `ready` — effective versions/URLs from the live doc, the cached
 *    mirror, OR the shipped `DEFAULT_LEGAL_CONFIG` when the doc is
 *    absent (so a baseline is always enforced and the app works before
 *    the doc exists).
 *
 * The underlying snapshot's stage-3 listener is gated on an authed user,
 * so this is only ever read post-sign-in (AUTH-LEGAL-4); the welcome
 * screen never triggers it.
 */
export function useLegalConfig(): LegalConfigState {
  const snap = useDocSnapshot(ZLegalConfig, 'config/legal', 'config:legal');
  if (snap.data) {
    return { status: 'ready', ...snap.data };
  }
  if (snap.loading) {
    return { status: 'unknown' };
  }
  // Loaded but the doc doesn't exist → enforce the shipped baseline.
  return { status: 'ready', ...DEFAULT_LEGAL_CONFIG };
}
