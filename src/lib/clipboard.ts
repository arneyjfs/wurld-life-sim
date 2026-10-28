import { Clipboard } from '@capacitor/clipboard';
import { isNativeRuntime } from './capabilities';

/**
 * Copy a string to the system clipboard, reliably across native + web + iOS.
 *
 * Three tiers, in order:
 *  1. NATIVE (Capacitor): the native clipboard manager. Works on a synced
 *     iOS/Android build regardless of origin/scheme. Falls through if the
 *     plugin isn't present (e.g. not `cap sync`'d).
 *  2. SECURE-CONTEXT async API (`navigator.clipboard.writeText`): desktop +
 *     deployed (HTTPS) iOS Safari / installed PWA, where it succeeds inside
 *     the tap gesture. Skipped on non-secure origins (dev LAN `http://…`)
 *     where iOS does not expose `navigator.clipboard`.
 *  3. SYNCHRONOUS `execCommand('copy')` fallback — the iOS-copy fix. iOS
 *     WKWebView / Safari blocks or omits the async API on non-secure origins
 *     and is gesture-strict, but a synchronous textarea-select-execCommand
 *     inside the tap gesture works in both cases. It MUST run synchronously
 *     (no awaited work before it on this path), which is why tier 2 is gated
 *     on `isSecureContext` rather than tried-and-caught first.
 *
 * Throws if every tier fails so callers can show an error toast.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (isNativeRuntime()) {
    try {
      await Clipboard.write({ string: text });
      return;
    } catch {
      /* plugin missing / not synced → fall through to the web strategies */
    }
  }

  const secure = typeof window !== 'undefined' && window.isSecureContext;
  const hasAsyncApi =
    typeof navigator !== 'undefined' &&
    !!navigator.clipboard &&
    typeof navigator.clipboard.writeText === 'function';

  if (secure && hasAsyncApi) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      /* permission / transient → fall through to the synchronous fallback */
    }
  }

  // Synchronous fallback (gesture-safe) — runs with no awaited work before it
  // when reached via the non-secure path (the iOS dev / WKWebView case).
  if (legacyCopy(text)) return;

  // Last resort: the async API even on a non-secure context (some engines
  // still resolve it).
  if (hasAsyncApi) {
    await navigator.clipboard.writeText(text);
    return;
  }

  throw new Error('clipboard unavailable');
}

/**
 * Synchronous clipboard write via a hidden textarea + `document.execCommand`.
 * Deprecated but the only API that works in iOS WKWebView / Safari on
 * non-secure origins and inside a strict gesture window. Returns whether the
 * copy succeeded. Restores any prior selection so the user's highlight is
 * untouched.
 *
 * The scratch textarea is mounted INSIDE the currently-focused element's
 * subtree (not `document.body`) so a focus-trap — vaul / Radix dialog
 * `FocusScope`, as used by `<BottomSheet>` / `<ExplainModal>` — doesn't yank
 * focus back out of it before `execCommand` runs. That trap is exactly why
 * copy worked from the un-trapped message-actions menu but silently failed
 * from any copy icon inside a sheet: `ta.focus()` fired the trap's focusin
 * guard, which moved focus to a sentinel, so `execCommand('copy')` had no
 * selection to copy. Mounting within the trapped region keeps focus "inside"
 * and the copy succeeds.
 */
function legacyCopy(text: string): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  const active = document.activeElement;
  const host =
    active instanceof HTMLElement && active !== document.body && document.body.contains(active)
      ? (active.parentElement ?? document.body)
      : document.body;
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;';
  host.appendChild(ta);
  const sel = typeof document.getSelection === 'function' ? document.getSelection() : null;
  const saved = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
  ta.focus();
  ta.select();
  // iOS requires an explicit range, not just .select().
  if (typeof ta.setSelectionRange === 'function') ta.setSelectionRange(0, ta.value.length);
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  // Restore focus to the element the gesture left focused (the tapped copy
  // button, inside the trap) so the dialog's focus-scope stays consistent.
  if (active instanceof HTMLElement && document.body.contains(active)) {
    try {
      active.focus();
    } catch {
      /* element may have been removed mid-copy — harmless */
    }
  }
  if (saved && sel) {
    sel.removeAllRanges();
    sel.addRange(saved);
  }
  return ok;
}
