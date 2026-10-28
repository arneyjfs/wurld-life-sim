/**
 * Telemetry tab of the life-sim debug overlay. Surfaces per-call
 * Gemini telemetry (model, tokens, cache hits, duration) plus
 * per-category running totals at the top.
 *
 * Used to measure whether Gemini's implicit prefix cache is hitting
 * in practice (look for non-zero `cached` columns). Drives the
 * decision about whether to invest in explicit `cachedContent`
 * caching at chapter boundaries.
 */
import { useEffect, useMemo, useState } from 'react';
import { Trash2, Copy, Check } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { RATES_VERIFIED_ON, formatUsd } from '@/lib/life/geminiPricing';
import {
  clearTelemetryBuffer,
  computeCategoryTotals,
  readTelemetryBuffer,
  subscribeTelemetry,
  type GeminiTelemetryEntry,
} from '@/lib/life/telemetry';

export function LifeDebugTelemetryTab() {
  const t = useT();
  const [entries, setEntries] = useState<ReadonlyArray<GeminiTelemetryEntry>>(
    () => readTelemetryBuffer(),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeTelemetry(setEntries), []);

  async function handleCopy() {
    const totalsBlock = computeCategoryTotals(entries)
      .map(
        (r) =>
          `  ${r.category.padEnd(28)} calls=${String(r.calls).padStart(3)}  in=${String(r.inputTokens).padStart(7)}  out=${String(r.outputTokens).padStart(6)}  think=${String(r.thoughtsTokens).padStart(6)}  cached=${String(r.cachedTokens).padStart(6)}  retries=${String(r.retryCalls).padStart(2)}(${formatUsd(r.retryCostUsd)})  cost=${formatUsd(r.costUsd).padStart(9)}  totalMs=${r.totalDurationMs}`,
      )
      .join('\n');
    const callsBlock = entries
      .map((e) => {
        const iso = new Date(e.ts).toISOString();
        const tokens = e.tokens
          ? `in=${e.tokens.in} out=${e.tokens.out} think=${e.tokens.thoughts ?? 0} cached=${e.tokens.cached}`
          : 'tokens=—';
        const ms = typeof e.durationMs === 'number' ? `${e.durationMs}ms` : '—';
        const model = e.modelUsed ?? '—';
        const retry = (e.attempt ?? 0) > 0 ? `  RETRY#${e.attempt}` : '';
        return `  [${iso}] ${e.category}  model=${model}  ${tokens}  duration=${ms}${retry}`;
      })
      .join('\n');
    const text = `=== Telemetry totals by category ===\n${totalsBlock || '  (no calls)'}\n\n=== Recent calls ===\n${callsBlock || '  (no calls)'}\n`;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — clipboard may be unavailable */
    }
  }

  const totals = useMemo(() => computeCategoryTotals(entries), [entries]);
  const grand = useMemo(() => {
    return totals.reduce(
      (a, t) => ({
        calls: a.calls + t.calls,
        input: a.input + t.inputTokens,
        output: a.output + t.outputTokens,
        thoughts: a.thoughts + t.thoughtsTokens,
        cached: a.cached + t.cachedTokens,
        ms: a.ms + t.totalDurationMs,
        cost: a.cost + t.costUsd,
        uncached: a.uncached + t.uncachedCostUsd,
        retryCalls: a.retryCalls + t.retryCalls,
        retryCost: a.retryCost + t.retryCostUsd,
      }),
      {
        calls: 0, input: 0, output: 0, thoughts: 0, cached: 0, ms: 0,
        cost: 0, uncached: 0, retryCalls: 0, retryCost: 0,
      },
    );
  }, [totals]);

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 border-b border-(--color-border) text-[11px]">
        <span className="text-(--color-fg-muted)">
          {t('life.debug.telemetry.callCount', { n: entries.length })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={entries.length === 0}
            aria-label={t('life.debug.copy')}
            data-testid="LifeScreen-Telemetry-Copy"
            className={cn(
              'inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs hover:bg-(--color-bg-hover)',
              copied
                ? 'text-(--color-accent)'
                : 'text-(--color-fg-muted) disabled:opacity-40',
            )}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            {copied ? t('life.debug.copied') : t('life.debug.copy')}
          </button>
          <button
            type="button"
            onClick={() => clearTelemetryBuffer()}
            aria-label={t('life.debug.clear')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-(--color-fg-muted) hover:bg-(--color-bg-hover)"
          >
            <Trash2 size={12} />
            {t('life.debug.clear')}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-3">
        {entries.length === 0 ? (
          <div className="text-center text-xs text-(--color-fg-muted) py-8">
            {t('life.debug.telemetry.empty')}
          </div>
        ) : (
          <>
            <section className="rounded-lg border border-(--color-border)/60 bg-(--color-bg-hover)/40 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-(--color-fg-muted) mb-2">
                {t('life.debug.telemetry.totalsHeading')}
              </div>
              <div className="grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] gap-x-3 gap-y-1 text-[11px] tabular-nums">
                <div className="text-(--color-fg-muted)">
                  {t('life.debug.telemetry.category')}
                </div>
                <div className="text-right text-(--color-fg-muted)">
                  {t('life.debug.telemetry.calls')}
                </div>
                <div className="text-right text-(--color-fg-muted)">
                  {t('life.debug.telemetry.tokensIn')}
                </div>
                <div className="text-right text-(--color-fg-muted)">
                  {t('life.debug.telemetry.tokensOut')}
                </div>
                <div className="text-right text-(--color-fg-muted)">
                  {t('life.debug.telemetry.thinking')}
                </div>
                <div className="text-right text-(--color-fg-muted)">
                  {t('life.debug.telemetry.cached')}
                </div>
                <div className="text-right text-(--color-fg-muted)">
                  {t('life.debug.telemetry.cost')}
                </div>
                {totals.map((row) => (
                  <RowFragment
                    key={row.category}
                    label={row.category}
                    calls={row.calls}
                    inputTokens={row.inputTokens}
                    outputTokens={row.outputTokens}
                    thoughtsTokens={row.thoughtsTokens}
                    cachedTokens={row.cachedTokens}
                    costUsd={row.costUsd}
                  />
                ))}
                <div className="border-t border-(--color-border)/60 col-span-7 mt-1" />
                <RowFragment
                  label={t('life.debug.telemetry.grand')}
                  calls={grand.calls}
                  inputTokens={grand.input}
                  outputTokens={grand.output}
                  thoughtsTokens={grand.thoughts}
                  cachedTokens={grand.cached}
                  costUsd={grand.cost}
                  bold
                />
              </div>
              {/* LIFE-COST-1: what the prefix cache is actually buying. Worth
                  surfacing on its own line — Google's implicit cache has
                  silently stopped discounting before (gemini-3.1-flash-lite,
                  ~2026-06-30) while STILL reporting cached tokens, so a
                  healthy `cached` column is not proof of a healthy bill. */}
              <div
                data-testid="LifeScreen-Telemetry-CacheSaving"
                className="text-[10px] text-(--color-fg-muted) mt-1"
              >
                {t('life.debug.telemetry.cacheSaving', {
                  saved: formatUsd(Math.max(0, grand.uncached - grand.cost)),
                  full: formatUsd(grand.uncached),
                  rates: RATES_VERIFIED_ON,
                })}
              </div>
              {/* LIFE-COST-3: regenerations are the one line of spend that buys
                  the player nothing at all. Shown unconditionally (including
                  the healthy "0" case) so its absence reads as "measured and
                  clean" rather than "not instrumented". */}
              <div
                data-testid="LifeScreen-Telemetry-Retries"
                className="text-[10px] text-(--color-fg-muted) mt-1"
              >
                {t('life.debug.telemetry.retries', {
                  count: grand.retryCalls,
                  calls: grand.calls,
                  pct:
                    grand.calls > 0
                      ? Math.round((grand.retryCalls / grand.calls) * 100)
                      : 0,
                  cost: formatUsd(grand.retryCost),
                })}
              </div>
            </section>
            <section className="flex flex-col gap-2">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-(--color-fg-muted)">
                {t('life.debug.telemetry.callsHeading')}
              </div>
              {entries
                .slice()
                .reverse()
                .map((e, i) => (
                  <TelemetryRow key={`${e.ts}-${i}`} entry={e} />
                ))}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function RowFragment({
  label,
  calls,
  inputTokens,
  outputTokens,
  thoughtsTokens,
  cachedTokens,
  costUsd,
  bold,
}: {
  label: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  /** LIFE-COST-2: reasoning tokens — billed as output, absent from
   *  `outputTokens`. Its own column so a thinking-heavy category is visibly
   *  thinking-heavy rather than just mysteriously expensive. */
  thoughtsTokens: number;
  cachedTokens: number;
  costUsd: number;
  bold?: boolean;
}) {
  const cls = bold ? 'font-semibold text-(--color-fg)' : 'text-(--color-fg)';
  return (
    <>
      <div className={cls + ' truncate'}>{label}</div>
      <div className={cls + ' text-right'}>{calls}</div>
      <div className={cls + ' text-right'}>{inputTokens}</div>
      <div className={cls + ' text-right'}>{outputTokens}</div>
      <div className={cls + ' text-right'}>{thoughtsTokens}</div>
      <div className={cls + ' text-right'}>{cachedTokens}</div>
      <div className={cls + ' text-right'}>{formatUsd(costUsd)}</div>
    </>
  );
}

function TelemetryRow({ entry }: { entry: GeminiTelemetryEntry }) {
  const t = useT();
  const time = new Date(entry.ts).toLocaleTimeString();
  const tokens = entry.tokens;
  return (
    <div className="rounded-lg border border-(--color-border)/60 bg-(--color-bg-hover)/30 p-2 text-[11px]">
      <div className="flex items-baseline justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] tabular-nums text-(--color-fg-muted) shrink-0">
            {time}
          </span>
          <span className="font-semibold text-(--color-accent) shrink-0">
            {entry.category}
          </span>
          {/* LIFE-COST-3: a regeneration. Flagged inline so a retry storm is
              visible while scrolling the call list, not just in the total. */}
          {(entry.attempt ?? 0) > 0 && (
            <span className="text-[10px] font-semibold text-(--color-danger) shrink-0">
              {t('life.debug.telemetry.retryBadge', { n: entry.attempt ?? 0 })}
            </span>
          )}
          {entry.modelUsed && (
            <span className="text-[10px] text-(--color-fg-muted) truncate">
              {entry.modelUsed}
            </span>
          )}
        </div>
        <div className="text-[10px] text-(--color-fg-muted) tabular-nums shrink-0">
          {typeof entry.durationMs === 'number'
            ? t('life.debug.telemetry.ms', { ms: entry.durationMs })
            : '—'}
        </div>
      </div>
      <div className="mt-1 grid grid-cols-4 gap-x-2 text-[10px] tabular-nums text-(--color-fg-muted)">
        <div>
          {t('life.debug.telemetry.tokensIn')}{' '}
          <span className="text-(--color-fg)">{tokens?.in ?? '—'}</span>
        </div>
        <div>
          {t('life.debug.telemetry.tokensOut')}{' '}
          <span className="text-(--color-fg)">{tokens?.out ?? '—'}</span>
        </div>
        <div>
          {t('life.debug.telemetry.thinking')}{' '}
          <span className="text-(--color-fg)">{tokens?.thoughts ?? '—'}</span>
        </div>
        <div>
          {t('life.debug.telemetry.cached')}{' '}
          <span className="text-(--color-fg)">{tokens?.cached ?? '—'}</span>
        </div>
      </div>
    </div>
  );
}
