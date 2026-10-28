/**
 * MSG-BUBBLE-8.1 — the entrance's timings, pinned.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-BUBBLE-8.1.
 *
 * These are tuned numbers, not arbitrary ones, and they are only correct
 * RELATIVE to each other — which is the whole reason they live in one module.
 * Pinning them here means a future tune has to move the pair deliberately
 * rather than nudge one and silently break the other.
 */
import { describe, expect, it } from 'vitest';
import { ENTER_GAP_MS, MINE_ENTER_MS, MINE_ENTER_TRAVEL } from './bubbleMotion';

describe('MSG-BUBBLE-8.1 — entrance timings', () => {
  it('MSG-BUBBLE-8.1 — the bubble enters over 320ms', () => {
    // Owner, 2026-09-23: *"new message appearing - animates upwards from
    // composer"* was listed under "a TINY bit too slow". The constant's own doc
    // comment anticipated exactly this: an entrance covering a gap that has got
    // shorter is just latency.
    expect(MINE_ENTER_MS).toBe(320);
  });

  it('MSG-BUBBLE-8.1 — the gap opens over 190ms', () => {
    expect(ENTER_GAP_MS).toBe(190);
  });

  it('MSG-BUBBLE-8.1 — the gap FINISHES before the bubble stops travelling', () => {
    // If they finished together the bubble's top would sit exactly on the gap's
    // bottom edge for the whole animation and only become visible at the end —
    // which reads as growing from zero inside the space rather than sliding into
    // it. This is the constraint; the exact numbers above are the tuning.
    expect(ENTER_GAP_MS).toBeLessThan(MINE_ENTER_MS);
  });

  it('MSG-BUBBLE-8.1 — the gap keeps its share of the travel when the pair is tuned', () => {
    // 240/400 and 190/320 are the same ratio. Speeding the entrance up without
    // scaling the gap would move the frame the bubble becomes visible, which is
    // the thing the split was tuned for in the first place.
    const ratio = ENTER_GAP_MS / MINE_ENTER_MS;
    expect(ratio).toBeGreaterThan(0.55);
    expect(ratio).toBeLessThan(0.65);
  });

  it('MSG-BUBBLE-8.2 — the bubble travels a full height, not a fixed pixel count', () => {
    expect(MINE_ENTER_TRAVEL).toBe('100%');
  });
});
