/**
 * Logs tab of the life-sim debug overlay. Renders the structured
 * [LIFE/...] event ring buffer plus the copy + clear affordances.
 *
 * Pulled out of LifeDebugLogOverlay.tsx when the overlay grew tabs.
 */
import { useEffect, useState } from 'react';
import { Trash2, Copy, Check } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import {
  clearLifeDebugBuffer,
  readLifeDebugBuffer,
  subscribeLifeDebug,
  type LifeDebugEntry,
} from '@/lib/life/debugLog';

export function LifeDebugLogsTab() {
  const t = useT();
  const [entries, setEntries] = useState<ReadonlyArray<LifeDebugEntry>>(() =>
    readLifeDebugBuffer(),
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeLifeDebug(setEntries), []);

  async function handleCopy() {
    const text = entries
      .map(
        (e) =>
          `[${new Date(e.ts).toISOString()}] [${e.tag}] ${e.summary}\n${safeStringify(e.payload)}`,
      )
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      /* silent — devtools clipboard may be unavailable */
    }
  }

  return (
    <>
      <div className="flex items-center justify-between px-3 py-2 border-b border-(--color-border) text-[11px]">
        <span className="text-(--color-fg-muted)">
          {t('life.debug.count', { n: entries.length })}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleCopy()}
            disabled={entries.length === 0}
            aria-label={t('life.debug.copy')}
            data-testid="LifeScreen-DebugLog-Copy"
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
            onClick={() => clearLifeDebugBuffer()}
            aria-label={t('life.debug.clear')}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs text-(--color-fg-muted) hover:bg-(--color-bg-hover)"
          >
            <Trash2 size={12} />
            {t('life.debug.clear')}
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 flex flex-col gap-2">
        {entries.length === 0 ? (
          <div className="text-center text-xs text-(--color-fg-muted) py-8">
            {t('life.debug.empty')}
          </div>
        ) : (
          entries
            .slice()
            .reverse()
            .map((e, i) => <DebugEntry key={`${e.ts}-${i}`} entry={e} />)
        )}
      </div>
    </>
  );
}

function DebugEntry({ entry }: { entry: LifeDebugEntry }) {
  const [expanded, setExpanded] = useState(false);
  const time = new Date(entry.ts).toLocaleTimeString();
  return (
    <div
      className={cn(
        'rounded-lg border p-2.5 text-xs',
        entry.level === 'warn'
          ? 'bg-amber-50 border-amber-200'
          : 'bg-(--color-bg-hover)/40 border-(--color-border)/60',
      )}
    >
      <button
        type="button"
        onClick={() => setExpanded((p) => !p)}
        className="w-full text-left flex items-start gap-2"
      >
        <span className="text-[10px] tabular-nums text-(--color-fg-muted) shrink-0 mt-0.5">
          {time}
        </span>
        <span
          className={cn(
            'text-[10px] font-semibold tracking-wider shrink-0 mt-0.5',
            entry.level === 'warn' ? 'text-amber-700' : 'text-(--color-accent)',
          )}
        >
          {entry.tag}
        </span>
        <span className="text-(--color-fg) leading-snug">{entry.summary}</span>
      </button>
      {expanded && (
        <pre className="mt-2 text-[10px] leading-snug bg-(--color-bg)/60 rounded p-2 overflow-x-auto whitespace-pre-wrap break-words text-(--color-fg-muted)">
          {safeStringify(entry.payload)}
        </pre>
      )}
    </div>
  );
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
