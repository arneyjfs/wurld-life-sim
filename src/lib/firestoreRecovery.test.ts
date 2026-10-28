import { describe, expect, it } from 'vitest';
import {
  isFatalFirestoreError,
  decideRecoveryAction,
  SAME_INCIDENT_MS,
} from './firestoreRecovery';

// OBS-FIRESTORE-1 — detect the async-queue-fatal Firestore error and self-heal:
// fresh incident → reload; fast recurrence → clear-and-reload; then give up.
describe('isFatalFirestoreError', () => {
  it('matches the b815 internal assertion (both raw + wrapped forms)', () => {
    expect(
      isFatalFirestoreError(
        'FIRESTORE (12.13.0) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815) CONTEXT: {"Rc":"Failed to delete record from object store"}',
      ),
    ).toBe(true);
    expect(isFatalFirestoreError('Error: AsyncQueue is already failed: transaction')).toBe(true);
    expect(isFatalFirestoreError('Failed to delete record from object store')).toBe(true);
  });

  it('does NOT match unrelated / transient errors', () => {
    expect(isFatalFirestoreError('Load failed')).toBe(false);
    expect(isFatalFirestoreError('callHttp processMessagePipeline 500')).toBe(false);
    expect(isFatalFirestoreError(undefined)).toBe(false);
    expect(isFatalFirestoreError(null)).toBe(false);
    expect(isFatalFirestoreError({ message: 'INTERNAL ASSERTION FAILED' })).toBe(false); // non-string
  });
});

describe('decideRecoveryAction', () => {
  const now = 1_000_000;

  it('fresh incident (no prior recovery) → reload', () => {
    expect(decideRecoveryAction(null, now)).toBe('reload');
  });

  it('a prior recovery older than the window → fresh incident → reload again', () => {
    expect(decideRecoveryAction({ ts: now - SAME_INCIDENT_MS - 1, stage: 'reloaded' }, now)).toBe(
      'reload',
    );
  });

  it('fatal recurs right after a reload → escalate to clear-and-reload', () => {
    expect(decideRecoveryAction({ ts: now - 1_000, stage: 'reloaded' }, now)).toBe(
      'clear-and-reload',
    );
  });

  it('fatal still recurs right after a clear → give up (no reload loop)', () => {
    expect(decideRecoveryAction({ ts: now - 1_000, stage: 'cleared' }, now)).toBe('give-up');
  });

  it('a clear long ago → fresh incident → reload (not give-up)', () => {
    expect(decideRecoveryAction({ ts: now - SAME_INCIDENT_MS - 1, stage: 'cleared' }, now)).toBe(
      'reload',
    );
  });
});
