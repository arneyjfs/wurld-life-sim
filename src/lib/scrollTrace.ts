/**
 * Structured ring-buffer trace for the chat-scroll system. THE single
 * observability sink — every scroll write, pagination decision, anchor
 * lifecycle event, sentinel fire, and commit classification lands here
 * so any jump or stuck state can be attributed from one dump.
 * (See docs/CHAT-SCROLL-AUDIT-2026-06.md (deleted 2026-09-29, git history) §4.)
 *
 * Gating:
 *   - DEV builds: always on.
 *   - Prod/beta: on when `localStorage.wurldScrollDebug` is '1' or '2'
 *     (read once at module init — set the flag, then reload).
 *   - '2' additionally mirrors each event to the console as one
 *     compact line (for live watching in Safari Web Inspector).
 *   - Otherwise: `trace()` is a constant-false early return; call
 *     sites are cheap in production.
 *
 * Consumers:
 *   - `window.__chatScrollTrace.events` — last RING_SIZE events.
 *   - `window.__chatScrollTrace.dump()` — JSON snapshot; Playwright
 *     specs attach this on failure (tests/e2e/helpers/scroll.ts).
 *   - `window.__chatScrollTrace.clear()` — reset between tests.
 *
 * On-device capture (iOS PWA):
 *   1. Safari Web Inspector console:
 *      `localStorage.setItem('wurldScrollDebug','1')`, reload.
 *   2. Reproduce the jump.
 *   3. `copy(window.__chatScrollTrace.dump())` → paste into an issue.
 *
 * Event vocabulary (kind → what it attributes):
 *   - 'write'     — every scrollTop write: strategy, target, before/after.
 *   - 'atBottom'  — at-bottom signal flips, with source + gap.
 *   - 'case'      — items-commit classification (CASE 1-5 + id-diff counts).
 *   - 'ro'        — ResizeObserver growth/resize summaries.
 *   - 'anchor'    — anchor lifecycle: capture/refresh/consume/expire/discard,
 *                   with ageMs so stale-anchor consumption is visible.
 *   - 'io'        — top/bottom sentinel observer fires + gate decisions.
 *   - 'load'      — pagination state machine: trigger/suppress/defer/dedupe/
 *                   watchdog/append-page/data-landed/spinner-on/spinner-off/
 *                   exhausted.
 *   - 'jump'      — go-to-message lifecycle: request/window-mounted/land/
 *                   pin-tick/complete/abort.
 *   - 'lifecycle' — mount, unmount, chatId switch.
 *   - 'note'      — anything else worth a line in the timeline.
 */

const RING_SIZE = 1000;

function readDebugFlag(): '0' | '1' | '2' {
  try {
    if (typeof window === 'undefined') return '0';
    const v = window.localStorage.getItem('wurldScrollDebug');
    return v === '1' || v === '2' ? v : '0';
  } catch {
    return '0';
  }
}
const DEBUG_FLAG = readDebugFlag();
const ENABLED = import.meta.env.DEV || DEBUG_FLAG !== '0';
const MIRROR = DEBUG_FLAG === '2';

/**
 * True when the trace ring is live (DEV or the wurldScrollDebug flag is set).
 * Exported so hot-path call sites can gate EXTRA diagnostic work (e.g. a
 * short rAF scrollTop-trajectory sampler) that would otherwise add cost in
 * untraced prod builds. `trace()` itself is already a no-op when disabled.
 */
export const SCROLL_TRACE_ENABLED = ENABLED;

export type ScrollTraceEvent = {
  /** ms since page load (performance.now-style, integer). */
  t: number;
  kind:
    | 'write'
    | 'atBottom'
    | 'case'
    | 'ro'
    | 'anchor'
    | 'io'
    | 'load'
    | 'jump'
    | 'lifecycle'
    | 'note';
  label: string;
  data?: Record<string, unknown>;
};

type ScrollTraceGlobal = {
  events: ScrollTraceEvent[];
  push: (ev: Omit<ScrollTraceEvent, 't'>) => void;
  clear: () => void;
  dump: () => string;
  // Diagnostic counter — total events ever recorded (useful to
  // confirm the buffer is live + ring-overwriting as expected).
  totalEvents: number;
};

function makeBuffer(): ScrollTraceGlobal {
  const events: ScrollTraceEvent[] = [];
  let total = 0;
  let startMs = 0;
  try {
    startMs = performance.timeOrigin;
  } catch {
    /* SSR / non-browser — leave zero */
  }
  // Capture `events` + `startMs` via closure so consumers reading
  // `events` always see the live buffer (assigning a new array
  // inside push would orphan the global reference).
  return {
    events,
    totalEvents: 0,
    push(ev) {
      total += 1;
      this.totalEvents = total;
      const t = Math.round(performance.now());
      events.push({ t, ...ev });
      if (events.length > RING_SIZE) events.shift();
    },
    clear() {
      events.length = 0;
      total = 0;
      this.totalEvents = 0;
    },
    dump() {
      return JSON.stringify({
        startMs,
        totalEvents: total,
        events,
      });
    },
  };
}

declare global {
  interface Window {
    __chatScrollTrace?: ScrollTraceGlobal;
  }
}

/**
 * Record an event. No-op unless DEV or the wurldScrollDebug flag is
 * set — the early return lets terser strip call sites in untraced
 * prod builds' hot paths.
 */
export function trace(
  kind: ScrollTraceEvent['kind'],
  label: string,
  data?: Record<string, unknown>,
): void {
  if (!ENABLED) return;
  if (typeof window === 'undefined') return;
  let buf = window.__chatScrollTrace;
  if (!buf) {
    buf = makeBuffer();
    window.__chatScrollTrace = buf;
  }
  buf.push({ kind, label, data });
  if (MIRROR) {
    // eslint-disable-next-line no-console
    console.log(`[st:${kind}] ${label}`, data ?? '');
  }
}
