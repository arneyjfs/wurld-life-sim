import { cn } from '@/lib/cn';
import { tokenizeVocab } from '@/lib/vocabTags';
import type { TranslationData } from '@/types/firestore';

type Props = {
  /** The translation data to render. */
  translation: TranslationData;
  /** Which side of the chat — determines underline color. */
  mine: boolean;
  /** Optional tap-to-define handler. Called with the bare word (no punctuation). */
  onWordTap?: (word: string) => void;
  /** The currently-open word (lowercased-matched) — it gets the same
   *  background HIGHLIGHT the chat bubble paints on the tapped word
   *  (`--color-underline-active-bg-*`). Absent → no highlight. */
  activeWord?: string | null;
};

/**
 * Renders translated text with complex words underlined. Multi-word
 * phrases (e.g. "il y a") match as single segments via the
 * `tokenizeVocab` alternation regex — the previous whitespace-split
 * version only ever underlined single tokens.
 *
 * Uses the same CSS-only two-color underline as MessageBubble for
 * consistency. Visual distinction from the original text comes from font
 * size + opacity in the parent container. When `activeWord` matches a
 * segment it also gets the chat bubble's tapped-word background highlight.
 */
export function AnnotatedText({ translation, mine, onWordTap, activeWord }: Props) {
  const activeNorm = activeWord?.toLowerCase();
  const segments = tokenizeVocab(
    translation.text || '',
    translation.complexWords ?? [],
  );
  // EITHER the tapped-word background highlight (active) OR the underline —
  // never both, exactly like the chat bubble (`renderVocabLeaf`, BubbleRows).
  const decorationCls = (norm: string) =>
    activeNorm !== undefined && norm === activeNorm
      ? cn(
          'rounded-[3px] px-0.5 -mx-0.5',
          mine
            ? 'bg-(--color-underline-active-bg-mine) text-(--color-underline-active-fg-mine)'
            : 'bg-(--color-underline-active-bg-theirs)',
        )
      : cn(
          'underline decoration-2 underline-offset-[3px] [text-decoration-skip-ink:none]',
          mine
            ? 'decoration-(--color-bubble-mine-underline)'
            : 'decoration-(--color-bubble-theirs-underline)',
        );
  return (
    <span>
      {segments.map((seg, i) => {
        if (seg.kind === 'plain') return <span key={i}>{seg.text}</span>;
        const norm = seg.match.toLowerCase();
        if (onWordTap) {
          return (
            <button
              key={i}
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onWordTap(norm);
              }}
              className={cn(
                'cursor-pointer bg-transparent border-0 p-0 m-0 font-inherit text-inherit',
                decorationCls(norm),
              )}
            >
              {seg.match}
            </button>
          );
        }
        return (
          <span key={i} className={decorationCls(norm)}>
            {seg.match}
          </span>
        );
      })}
    </span>
  );
}
