/**
 * OBS-FIRESTORE-6 (docs/specs/observability.md) — set once the recovery ladder
 * is about to `terminate` the Firestore client. Every call on a terminated
 * client throws synchronously ("The client has already been terminated"), so
 * the snapshot hooks check this before touching it. Never cleared: the page
 * reloads right after.
 *
 * Its own module, with no imports, so the hooks can read it without pulling in
 * the recovery code (or its mocks in tests).
 */
let shutDown = false;

export function markFirestoreShutDown(): void {
  shutDown = true;
}

export function isFirestoreShutDown(): boolean {
  return shutDown;
}

export function _resetFirestoreShutDownForTest(): void {
  shutDown = false;
}
