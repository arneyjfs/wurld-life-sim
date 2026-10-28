import {
  useEffect,
  useImperativeHandle,
  useRef,
  type FormEvent,
  type KeyboardEvent,
  type Ref,
} from 'react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { getBaseLanguageName, localizedLanguageName } from '@/lib/languages';
import { prefersEnterToSend } from '@/lib/capabilities';
import { useT } from '@/i18n';
import { useI18nStore } from '@/i18n/store';
import { deliverComposerImagePaste, imageFilesFrom } from '@/lib/composerImagePaste';

type Props = {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled?: boolean;
  /**
   * When both languages are known, the placeholder reads
   * "Type in {Native} or {Practice}…". When one is missing, falls back to
   * the single-language hint or a generic "Type a message…".
   * Source: chat-screen-with-messages-and-reply.png.
   */
  nativeLanguage?: string;
  practiceLanguage?: string;
  placeholder?: string;
  /**
   * MSG-REVIEW-CLARIFY-2 — paint the placeholder in the clarify blue instead
   * of the usual muted grey. The composer in clarify mode is asking for
   * something categorically different from a message (a description of what
   * you meant), and it must not look like a normal empty input.
   */
  placeholderTone?: 'muted' | 'clarify';
  /**
   * Sets `aria-label` on the underlying textarea. Required when the
   * Composer is used outside the main chat send flow (image caption
   * modal, explain follow-up) so callers can target it deterministically
   * via `getByLabel`/`getByRole('textbox', { name })` rather than
   * relying on the placeholder-as-accessible-name fallback.
   */
  ariaLabel?: string;
  /**
   * Stable identifier exposed via `data-testid` on the textarea. Used by
   * E2E specs that need to target a specific composer (e.g. the image
   * caption vs. the explain follow-up) without relying on locale-
   * dependent placeholders.
   */
  testId?: string;
  /**
   * Maximum visible rows before the textarea scrolls. Defaults to 6 —
   * the chat composer's original behaviour. Smaller values (4-5) make
   * sense for height-constrained modals like the explain follow-up.
   */
  maxRows?: number;
  /** Focuses the textarea after mount. Used by the image-caption modal
   *  when seeded with a starter caption so the user can edit immediately. */
  autoFocus?: boolean;
  /**
   * Optional ref forwarded onto the underlying <textarea>. MessageInput
   * uses this to imperatively focus/blur the input to drive the
   * on-screen keyboard (keep keyboard up after send, dismiss it when a
   * review starts, raise it when the user taps Reply, etc.). Kept as a
   * second ref instead of converting the component to forwardRef so the
   * internal `ref` (used for auto-sizing) and the external ref can both
   * point at the same node without one stomping the other.
   */
  textareaRef?: Ref<HTMLTextAreaElement>;
  /** COMP-IMG-8 — route pasted images to the chat's review. The chat composer
   *  only; the review caption and explain follow-up leave pastes alone. */
  imagePaste?: boolean;
  /**
   * Opt-in `data-setup-target` on the input-box wrapper (the rounded pill),
   * so the setup-mode step pointer (TUTOR-SETUP-12, SetupPointerLayer.tsx)
   * hugs the actual text input rather than the whole composer row (attach +
   * input + send). Only the main chat composer sets this ("composer"); the
   * modal/explain composers leave it undefined.
   */
  setupTarget?: string;
};

const LINE_HEIGHT_PX = 24;
const DEFAULT_MAX_ROWS = 6;

/**
 * Autosizing textarea composer. Grows from 1 line up to `maxRows` lines
 * (default 6), then scrolls. Enter-key semantics are device-aware
 * (COMP-SEND-3): on desktop (mouse + physical keyboard) Enter submits and
 * Shift+Enter inserts a newline; on touch devices Enter inserts a newline
 * and sending is via the button.
 *
 * Shared by the main chat send flow, the image-caption review modal,
 * and the explain follow-up input — the surrounding action button(s)
 * (send, save edit, cancel, etc.) stay with each call site.
 */
export function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  nativeLanguage,
  practiceLanguage,
  placeholder,
  placeholderTone = 'muted',
  ariaLabel,
  testId,
  maxRows = DEFAULT_MAX_ROWS,
  autoFocus,
  textareaRef,
  imagePaste = false,
  setupTarget,
}: Props) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  // Mirror the internal autosize ref onto the external one so the
  // caller can call `.focus()` / `.blur()` on the same node without us
  // losing our own handle to it.
  useImperativeHandle(textareaRef, () => ref.current as HTMLTextAreaElement, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    const maxHeight = maxRows * LINE_HEIGHT_PX;
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  }, [value, maxRows]);

  // Focus on mount when requested. We do this in an effect (not the
  // `autoFocus` attribute) so the focus is deterministic even when the
  // Composer is portaled into a modal that mounts after its parent.
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);

  function handleSubmit(e?: FormEvent) {
    e?.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSubmit();
  }

  function handleKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    // COMP-SEND-3: Enter sends ONLY on desktop-like devices (physical
    // keyboard). On touch devices Enter falls through to the textarea's
    // default (newline); sending is via the Send button. Shift+Enter is
    // always a newline.
    if (e.key === 'Enter' && !e.shiftKey && prefersEnterToSend()) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const t = useT();
  const locale = useI18nStore((s) => s.locale);
  const ph =
    placeholder ?? buildPlaceholder(t, locale, nativeLanguage, practiceLanguage);

  return (
    // Wrapper owns the border + rounding + clip — the textarea inside is
    // unbordered and unrounded so its scrollbar (when content exceeds
    // the max-height) sits flush against the wrapper's inner edge and
    // gets visually trimmed by `overflow-clip` against the rounded
    // corners rather than poking past them. The fixed 20px radius reads
    // as a pill on a single line (height ≈ 40px → r ≈ height / 2) and
    // stays the same radius as the input grows multi-line, so the corners
    // never balloon into "stadium" territory at full height.
    <div
      data-setup-target={setupTarget}
      className={cn(
        'flex-1 rounded-[20px] border border-(--color-border) bg-(--color-bg-hover) overflow-clip',
        'focus-within:bg-(--color-bg-elevated) focus-within:border-(--color-border-strong)',
      )}
    >
      <textarea
        ref={ref}
        value={value}
        dir={dirOf(value)}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKey}
        onPaste={(e) => {
          // COMP-IMG-8 — images open the review; anything else is a normal paste.
          if (imagePaste && deliverComposerImagePaste(imageFilesFrom(e.clipboardData))) e.preventDefault();
        }}
        placeholder={ph}
        aria-label={ariaLabel}
        data-testid={testId}
        rows={1}
        disabled={disabled}
        style={{ maxHeight: `${maxRows * LINE_HEIGHT_PX}px` }}
        className={cn(
          'block w-full resize-none px-3.5 py-2 bg-transparent outline-none leading-6 disabled:opacity-60',
          // Italic + the soft blue together. Italic is what says "hint" — the
          // colour alone had to be loud to carry that on its own, and a loud
          // placeholder reads as text already typed.
          placeholderTone === 'clarify'
            ? 'placeholder:text-(--color-clarify-placeholder) placeholder:italic'
            : 'placeholder:text-(--color-fg-muted)',
        )}
      />
    </div>
  );
}

function buildPlaceholder(
  t: ReturnType<typeof useT>,
  locale: string,
  native?: string,
  practice?: string,
): string {
  // Localise the interpolated language name to the current UI locale —
  // e.g. "French" → "français" when the UI is in French. The CANONICAL
  // English name is still what flows through the database; this is
  // a display transformation only. `getBaseLanguageName` strips the
  // qualifier first so "English (British)" → "English" → "anglais",
  // matching the pre-i18n placeholder behaviour (no qualifiers in
  // the typing-prompt — the picker is where users disambiguate).
  const n = native ? localizedLanguageName(getBaseLanguageName(native), locale) : undefined;
  const p = practice ? localizedLanguageName(getBaseLanguageName(practice), locale) : undefined;
  if (n && p && n !== p)
    return t('chat.composerPlaceholderBoth', { native: n, practice: p });
  if (p) return t('chat.composerPlaceholderOne', { language: p });
  if (n) return t('chat.composerPlaceholderOne', { language: n });
  return t('chat.composerPlaceholder');
}
