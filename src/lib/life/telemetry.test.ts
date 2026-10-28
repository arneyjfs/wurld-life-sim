/**
 * LIFE-COST-2 / LIFE-COST-3 — the telemetry buffer's derived totals.
 *
 * These aggregates are what the Telemetry tab shows and what cost decisions
 * get made from. The 2026-07 audit found the buffer was silently dropping two
 * things: reasoning tokens (billed, invisible) and regenerations (paid twice,
 * uncounted). Both are asserted here.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearTelemetryBuffer,
  computeCategoryTotals,
  readTelemetryBuffer,
  recordGeminiCall,
  type GeminiTelemetryEntry,
} from './telemetry';

const LITE = 'gemini-3.1-flash-lite';

function entry(over: Partial<GeminiTelemetryEntry> = {}): GeminiTelemetryEntry {
  return {
    ts: 1,
    category: 'life_step',
    modelUsed: LITE,
    tokens: { in: 1_000, out: 100, cached: 0 },
    durationMs: 10,
    ...over,
  };
}

describe('LIFE-COST-2 — thinking tokens in category totals', () => {
  beforeEach(() => clearTelemetryBuffer());

  it('accumulates thoughts into their own column, not into out', () => {
    recordGeminiCall(entry({ tokens: { in: 10, out: 100, cached: 0, thoughts: 60 } }));
    recordGeminiCall(entry({ tokens: { in: 10, out: 200, cached: 0, thoughts: 40 } }));
    const [row] = computeCategoryTotals(readTelemetryBuffer());
    expect(row!.outputTokens).toBe(300);
    expect(row!.thoughtsTokens).toBe(100);
  });

  it('charges the thinking tokens — a thinking call costs more than a mute one', () => {
    recordGeminiCall(entry({ tokens: { in: 10, out: 100, cached: 0 } }));
    const mute = computeCategoryTotals(readTelemetryBuffer())[0]!.costUsd;
    clearTelemetryBuffer();
    recordGeminiCall(entry({ tokens: { in: 10, out: 100, cached: 0, thoughts: 900 } }));
    const thinking = computeCategoryTotals(readTelemetryBuffer())[0]!.costUsd;
    expect(thinking).toBeGreaterThan(mute);
  });

  it('treats a legacy entry with no thoughts field as zero, not NaN', () => {
    recordGeminiCall(entry({ tokens: { in: 10, out: 100, cached: 0 } }));
    const [row] = computeCategoryTotals(readTelemetryBuffer());
    expect(row!.thoughtsTokens).toBe(0);
    expect(Number.isFinite(row!.costUsd)).toBe(true);
  });
});

describe('LIFE-COST-3 — retry accounting', () => {
  beforeEach(() => clearTelemetryBuffer());

  it('counts only attempt > 0 as a retry', () => {
    recordGeminiCall(entry({ attempt: 0 }));
    recordGeminiCall(entry({ attempt: 1 }));
    recordGeminiCall(entry({ attempt: 1 }));
    const [row] = computeCategoryTotals(readTelemetryBuffer());
    expect(row!.calls).toBe(3);
    expect(row!.retryCalls).toBe(2);
  });

  it('an entry with no attempt field is a first attempt, not a retry', () => {
    recordGeminiCall(entry());
    const [row] = computeCategoryTotals(readTelemetryBuffer());
    expect(row!.retryCalls).toBe(0);
    expect(row!.retryCostUsd).toBe(0);
  });

  it('attributes the retry spend — the directly-recoverable waste', () => {
    // Two identical calls, one of which was a regeneration: exactly half the
    // category's cost is waste.
    recordGeminiCall(entry({ attempt: 0 }));
    recordGeminiCall(entry({ attempt: 1 }));
    const [row] = computeCategoryTotals(readTelemetryBuffer());
    expect(row!.retryCostUsd).toBeCloseTo(row!.costUsd / 2, 10);
  });

  it('still counts a retry that came back without usage metadata', () => {
    // A call can fail to report tokens (older backend, stub); it was still
    // paid for, so it must not vanish from the retry RATE.
    recordGeminiCall(entry({ attempt: 1, tokens: null }));
    const [row] = computeCategoryTotals(readTelemetryBuffer());
    expect(row!.retryCalls).toBe(1);
    expect(row!.retryCostUsd).toBe(0);
  });
});

describe('BOOT-SPLIT-6 — telemetry records through the call sink', () => {
  beforeEach(() => clearTelemetryBuffer());

  it('a life call emitted by the app-wide client lands in the buffer; others do not', async () => {
    const { emitGeminiCall } = await import('@/lib/geminiCallSink');
    emitGeminiCall(entry({ category: 'life_step' }));
    emitGeminiCall(entry({ category: 'topic_classify' }));
    expect(readTelemetryBuffer().map((e) => e.category)).toEqual(['life_step']);
  });
});
