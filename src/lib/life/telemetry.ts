/**
 * In-memory telemetry buffer for life-sim Gemini round-trips.
 *
 * Each `recordGeminiCall(...)` push stores one entry. The buffer
 * is per-world (mirrors `debugLog.ts` — switching worlds wipes
 * prior entries) and powers the Telemetry tab in the debug log
 * overlay.
 *
 * Per-category running totals are derived on read (cheap — ≤100
 * entries) so we don't have to keep them in sync on every push.
 *
 * Spec: docs/specs/life-sim.md §10.55 (LIFE-WORLD-SAGA-*) plus
 * the cache-observability note in §19.
 */

import { onGeminiCall, type GeminiCallRecord } from '../geminiCallSink';
import { estimateCallCost } from './geminiPricing';

export type { GeminiCallTokens } from '../geminiCallSink';
/** One recorded call — the sink's record (BOOT-SPLIT-6). */
export type GeminiTelemetryEntry = GeminiCallRecord;

export type CategoryTotals = {
  category: string;
  calls: number;
  inputTokens: number;
  /** VISIBLE output only (`candidatesTokenCount`). Billed output is
   *  `outputTokens + thoughtsTokens` — see `thoughtsTokens`. */
  outputTokens: number;
  cachedTokens: number;
  /** LIFE-COST-2: reasoning tokens, billed at the output rate. Broken out
   *  rather than folded into `outputTokens` so "what is thinking costing me"
   *  is answerable per category — it was the single largest unmodelled line
   *  in the 2026-07 cost audit. */
  thoughtsTokens: number;
  /** LIFE-COST-3: calls in this category that were regenerations
   *  (`attempt > 0`). `retryCalls / calls` is the retry rate; the money burnt
   *  is `retryCostUsd`. */
  retryCalls: number;
  /** USD spent on those regenerations — the directly-recoverable waste. */
  retryCostUsd: number;
  totalDurationMs: number;
  /** LIFE-COST-1: estimated USD across this category's calls. Tokens alone
   *  hide the thing you actually need to know — output costs 6× input on
   *  flash-lite and a cached input token costs a tenth of an uncached one, so
   *  two categories with identical token counts can differ ~10× in price. */
  costUsd: number;
  /** What the same calls would have cost with no cache hits — the saving the
   *  prompt's prefix ordering is actually buying. */
  uncachedCostUsd: number;
};

const BUFFER_MAX = 100;
const buffer: GeminiTelemetryEntry[] = [];
const listeners = new Set<(entries: ReadonlyArray<GeminiTelemetryEntry>) => void>();
let currentWorldId: string | null = null;

function fanout(): void {
  const snapshot = buffer.slice();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore listener errors */
    }
  });
}

export function recordGeminiCall(entry: GeminiTelemetryEntry): void {
  // This is the LIFE-SIM telemetry buffer, but `recordGeminiCall` fires for
  // EVERY app-wide generateGemini (chat translate, topic-classify, imports…).
  // Buffering those polluted the per-world cost/token totals with unrelated
  // spend. Scope to life categories (all `life_`-prefixed) so the Telemetry
  // tab reflects the wurld the player is in, nothing else.
  if (!entry.category.startsWith('life_')) return;
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  fanout();
}

// BOOT-SPLIT-6 — subscribe on load: the app-wide client emits into the sink
// and never imports this Life module.
onGeminiCall(recordGeminiCall);

export function readTelemetryBuffer(): ReadonlyArray<GeminiTelemetryEntry> {
  return buffer.slice();
}

export function subscribeTelemetry(
  fn: (entries: ReadonlyArray<GeminiTelemetryEntry>) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearTelemetryBuffer(): void {
  buffer.length = 0;
  fanout();
}

/** Bind to a worldId. Switching worlds wipes the buffer so the new
 *  world's totals don't inherit the prior world's traces. */
export function setTelemetryWorld(worldId: string | null): void {
  if (worldId === currentWorldId) return;
  if (worldId !== null && currentWorldId !== null) {
    clearTelemetryBuffer();
  }
  currentWorldId = worldId;
}

/** Derived per-category running totals across the current buffer. */
export function computeCategoryTotals(
  entries: ReadonlyArray<GeminiTelemetryEntry>,
): CategoryTotals[] {
  const by = new Map<string, CategoryTotals>();
  for (const e of entries) {
    const t = by.get(e.category) ?? {
      category: e.category,
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      cachedTokens: 0,
      thoughtsTokens: 0,
      retryCalls: 0,
      retryCostUsd: 0,
      totalDurationMs: 0,
      costUsd: 0,
      uncachedCostUsd: 0,
    };
    t.calls += 1;
    if (e.tokens) {
      t.inputTokens += e.tokens.in;
      t.outputTokens += e.tokens.out;
      t.cachedTokens += e.tokens.cached;
      t.thoughtsTokens += e.tokens.thoughts ?? 0;
      // Priced per ENTRY, not per category total: categories can span models
      // (a fallback, a mid-session model bump), and averaging the rate would
      // quietly misprice them.
      const c = estimateCallCost(e.tokens, e.modelUsed);
      t.costUsd += c.totalUsd;
      t.uncachedCostUsd += c.uncachedTotalUsd;
      if ((e.attempt ?? 0) > 0) t.retryCostUsd += c.totalUsd;
    }
    if ((e.attempt ?? 0) > 0) t.retryCalls += 1;
    if (typeof e.durationMs === 'number') {
      t.totalDurationMs += e.durationMs;
    }
    by.set(e.category, t);
  }
  // Sort by MONEY, not tokens — the whole point is to surface what is
  // actually expensive, and the priciest category is rarely the wordiest.
  return Array.from(by.values()).sort((a, b) => b.costUsd - a.costUsd);
}
