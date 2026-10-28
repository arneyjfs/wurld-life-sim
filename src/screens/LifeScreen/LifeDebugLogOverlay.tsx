/**
 * In-app viewer for life-sim debug data. Two tabs:
 *
 *   - Logs       — the structured [LIFE/...] event ring buffer.
 *   - Telemetry  — per-Gemini-call cost, cache-hit, and duration
 *                  data + per-category running totals.
 *
 * Reached via the LifeScreen header's 3-dot menu → "View life debug
 * logs". Read-only; each tab carries its own clear affordance.
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { LifeDebugLogsTab } from './LifeDebugLogsTab';
import { LifeDebugTelemetryTab } from './LifeDebugTelemetryTab';

export type LifeDebugLogOverlayProps = {
  onClose: () => void;
};

type Tab = 'logs' | 'telemetry';

export function LifeDebugLogOverlay({ onClose }: LifeDebugLogOverlayProps) {
  const t = useT();
  const [tab, setTab] = useState<Tab>('logs');

  return (
    // LIFE-UI-16 — the shared BottomSheet, not a hand-rolled overlay.
    //
    // This was `fixed inset-0 flex items-end` with a `max-h-[80dvh]` card:
    // bottom-docked with NO safe-area padding, so on a phone the card ran
    // under the home indicator and its footer was unreachable (owner,
    // 2026-08-01, twice: "the debug modal no longer scrolls and goes off
    // screen at the bottom" → "still not centred and goes off the bottom on
    // mobile"). The second report came with the fix: "base it off the phone
    // number region picked dialogue and it will work" — CountryDialPicker
    // renders through this same primitive, which already owns the whole
    // problem (safe-area pad via `.pb-keyboard`, the `.max-h-sheet` cap,
    // drag-to-dismiss, and centring on desktop rather than docking).
    //
    // `keyboardInset='none'`: there is no input in here at all, so the sheet
    // must not spend height clearing a keyboard that never opens.
    <BottomSheet
      open
      onClose={onClose}
      ariaLabel={t('life.debug.title')}
      desktopWidthClass="sm:max-w-2xl"
      keyboardInset="none"
      className="max-h-[85dvh]"
    >
      <div
        data-testid="LifeScreen-DebugLog"
        className={cn('flex flex-col min-h-0 flex-1 overflow-hidden')}
      >
        <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-(--color-border)">
          <div className="text-sm font-semibold text-(--color-fg)">
            {t('life.debug.title')}
          </div>
          <div className="flex items-center gap-1 ml-auto rounded-full bg-(--color-bg-hover)/60 p-0.5">
            <TabButton
              active={tab === 'logs'}
              onClick={() => setTab('logs')}
              label={t('life.debug.tab.logs')}
              testid="LifeScreen-DebugLog-Tab-Logs"
            />
            <TabButton
              active={tab === 'telemetry'}
              onClick={() => setTab('telemetry')}
              label={t('life.debug.tab.telemetry')}
              testid="LifeScreen-DebugLog-Tab-Telemetry"
            />
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('common.close')}
            className="p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)"
          >
            <X size={16} />
          </button>
        </header>
        {tab === 'logs' ? <LifeDebugLogsTab /> : <LifeDebugTelemetryTab />}
      </div>
    </BottomSheet>
  );
}

function TabButton({
  active,
  onClick,
  label,
  testid,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  testid: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      className={cn(
        'px-3 py-1 rounded-full text-xs font-medium transition',
        active
          ? 'bg-(--color-bg-elevated) text-(--color-fg) shadow-sm'
          : 'text-(--color-fg-muted) hover:text-(--color-fg)',
      )}
    >
      {label}
    </button>
  );
}
