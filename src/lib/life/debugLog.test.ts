/**
 * LIFE-NODE-15 — the ring buffer contract the debug overlay reads.
 *
 * `generateStepOptions.test.ts` / `generateWithRetry.test.ts` mock this module,
 * so they prove the generators CALL it and stop there. These close the last
 * link in the chain the owner actually asked about — *"make sure events logged
 * to the debug window ... log even if they fail"* — by asserting the entry that
 * comes out the other side, which is exactly what `LifeDebugLogsTab` renders
 * (`readLifeDebugBuffer` / `subscribeLifeDebug`, level → amber, tag → badge).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('./telemetry', () => ({ setTelemetryWorld: vi.fn() }));

import * as log from '../log';
import {
  clearLifeDebugBuffer,
  lifeDebug,
  lifeFailed,
  lifeWarn,
  readLifeDebugBuffer,
  subscribeLifeDebug,
} from './debugLog';

beforeEach(() => {
  clearLifeDebugBuffer();
  vi.clearAllMocks();
});

describe('LIFE-NODE-15 — lifeWarn is warn-level WITHOUT the -FAILED tag', () => {
  it('LIFE-NODE-15 — pushes level "warn" under the plain LIFE/<channel> tag', () => {
    lifeWarn('GEN-RETRY', 'life_step transport attempt 1 failed → retrying', {
      attempt: 0,
    });

    const [entry] = readLifeDebugBuffer();
    expect(entry).toBeDefined();
    // Amber in the overlay: this IS a problem the reader should see.
    expect(entry!.level).toBe('warn');
    // ...but NOT a failure. `-FAILED` would read identically to an abandoned
    // turn, and the beat clamp (LIFE-LANG-13.1) fires on the ordinary `say`
    // turn — stamping every healthy speech turn FAILED buries the real ones.
    expect(entry!.tag).toBe('LIFE/GEN-RETRY');
    expect(entry!.tag).not.toContain('FAILED');
    expect(entry!.payload).toEqual({ attempt: 0 });
    expect(entry!.summary).toContain('retrying');
  });

  it('LIFE-NODE-15 — lifeFailed stays the -FAILED marker, so the two are distinguishable', () => {
    lifeWarn('STEP', 'beat budget clamped to 1 (player already spoke)');
    lifeFailed('STEP', 'step exhausted retries → snag', { lastReason: 'schema' });

    const entries = readLifeDebugBuffer();
    expect(entries.map((e) => e.tag)).toEqual(['LIFE/STEP', 'LIFE/STEP-FAILED']);
    // Both are warn-level, which is the point: the LEVEL says "look at this",
    // the TAG says whether the turn survived.
    expect(entries.every((e) => e.level === 'warn')).toBe(true);
  });

  it('LIFE-NODE-15 — a warn still reaches the console, so the change is additive', () => {
    lifeWarn('GEN-RETRY', 'retrying', { attempt: 1 });
    expect(vi.mocked(log.warn)).toHaveBeenCalledWith('[LIFE/GEN-RETRY] retrying', {
      attempt: 1,
    });
  });

  it('LIFE-NODE-15 — a warn notifies live subscribers (the overlay updates without a remount)', () => {
    const seen: string[][] = [];
    const unsubscribe = subscribeLifeDebug((entries) =>
      seen.push(entries.map((e) => e.tag)),
    );

    lifeDebug('STEP', 'live turn ok');
    lifeWarn('GEN-RETRY', 'retrying');
    lifeFailed('STEP', 'snag');
    unsubscribe();
    lifeWarn('GEN-RETRY', 'after unsubscribe');

    expect(seen).toEqual([
      ['LIFE/STEP'],
      ['LIFE/STEP', 'LIFE/GEN-RETRY'],
      ['LIFE/STEP', 'LIFE/GEN-RETRY', 'LIFE/STEP-FAILED'],
    ]);
    // The buffer still took the last push; only the listener detached.
    expect(readLifeDebugBuffer()).toHaveLength(4);
  });

  it('LIFE-NODE-15 — an omitted payload is stored as {} so the overlay can always stringify it', () => {
    lifeWarn('GEN-RETRY', 'retrying');
    expect(readLifeDebugBuffer()[0]!.payload).toEqual({});
  });
});
