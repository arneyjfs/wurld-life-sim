import { type ReactNode } from 'react';
import { Copy as CopyIcon, Sparkles, Star } from 'lucide-react';
import { cn } from '@/lib/cn';
import { copyToClipboard } from '@/lib/clipboard';
import { dirOf } from '@/lib/textDirection';
import { getLanguageFlag } from '@/lib/languages';
import { TTSButton } from '@/components/TTSButton';
import type { Difficulty } from '@/types/firestore';
import type { ParsedExplanation, ParsedSection } from '@/lib/explain';
import { renderInline, type VocabState } from './SimpleMarkdownInline';
// eslint-disable-next-line react-refresh/only-export-components
export { parseVocabTag } from './SimpleMarkdownInline';

/**
 * Hand-written markdown renderer that supports inline <vocab phrase="..."
 * translation="..." /> chips. Ports the source's SimpleMarkdownWithVocab
 * (components/ExplainModal.tsx:45-192) into a React-DOM equivalent.
 *
 * Supported syntax:
 *   - # / ## / ###  → headings
 *   - - / *         → bullets (single level)
 *   - 1.            → numbered list (single level)
 *   - **bold**, *italic*, _italic_, ~~strike~~, `code`, [label](url)
 *   - <vocab phrase="..." translation="..." />  → tappable chip
 *
 * Emphasis runs may wrap vocab chips: `**<vocab .../>**` renders the chip
 * inside a `<strong>`. See `SimpleMarkdownInline.tsx` for the matcher.
 *
 * Plain paragraphs render as-is. Blank lines separate blocks.
 */

type Props = {
  source: string;
  vocab?: VocabState;
};

export function SimpleMarkdown({ source, vocab }: Props) {
  const lines = source.split('\n');
  const blocks: ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    const trimmed = line.trim();

    if (!trimmed) {
      i++;
      continue;
    }

    // Headings — all collapse to the body size with a semibold weight so the
    // modal stays at a clean two-level scale (only the SectionCard title and
    // page title go up to text-base).
    let m: RegExpMatchArray | null;
    if ((m = trimmed.match(/^### (.+)/))) {
      blocks.push(
        <h3 key={i} className="text-sm font-semibold text-(--color-fg) mt-2 mb-1">
          {renderInline(m[1]!, vocab)}
        </h3>,
      );
      i++;
      continue;
    }
    if ((m = trimmed.match(/^## (.+)/))) {
      blocks.push(
        <h2 key={i} className="text-sm font-semibold text-(--color-fg) mt-2 mb-1">
          {renderInline(m[1]!, vocab)}
        </h2>,
      );
      i++;
      continue;
    }
    if ((m = trimmed.match(/^# (.+)/))) {
      blocks.push(
        <h1 key={i} className="text-sm font-semibold text-(--color-fg) mt-2 mb-1">
          {renderInline(m[1]!, vocab)}
        </h1>,
      );
      i++;
      continue;
    }

    // Bullet list — group consecutive bullets into a single <ul>.
    if (/^[-*] /.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*[-*] /.test(lines[i] ?? '')) {
        const item = (lines[i] ?? '').trim().replace(/^[-*] /, '');
        items.push(<li key={i}>{renderInline(item, vocab)}</li>);
        i++;
      }
      blocks.push(
        <ul
          key={`ul-${i}`}
          className="list-disc pl-5 my-1 space-y-0.5 text-sm leading-relaxed text-(--color-fg)"
        >
          {items}
        </ul>,
      );
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(trimmed)) {
      const items: ReactNode[] = [];
      while (i < lines.length && /^\s*\d+\.\s/.test(lines[i] ?? '')) {
        const item = (lines[i] ?? '').trim().replace(/^\d+\.\s/, '');
        items.push(<li key={i}>{renderInline(item, vocab)}</li>);
        i++;
      }
      blocks.push(
        <ol
          key={`ol-${i}`}
          className="list-decimal pl-5 my-1 space-y-0.5 text-sm leading-relaxed text-(--color-fg)"
        >
          {items}
        </ol>,
      );
      continue;
    }

    // Paragraph: collect lines until a blank line or block boundary.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      (lines[i] ?? '').trim() &&
      !/^(#{1,3} )/.test((lines[i] ?? '').trim()) &&
      !/^[-*] /.test((lines[i] ?? '').trim()) &&
      !/^\d+\.\s/.test((lines[i] ?? '').trim())
    ) {
      paraLines.push((lines[i] ?? '').trim());
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push(
        <p key={`p-${i}`} className="text-sm text-(--color-fg) leading-relaxed my-1">
          {renderInline(paraLines.join(' '), vocab)}
        </p>,
      );
    }
  }
  return <div className="flex flex-col">{blocks}</div>;
}

// ─── Presentational pieces shared with ExplainModal ──────────────────────
// Extracted from ExplainModal.tsx to keep that file under the 600-LOC cap.
// These are pure-render UI cards; they don't manage streaming state.

type VocabBag = {
  saved: Set<string>;
  saving: string | null;
  onSave: (phrase: string, translation: string) => void;
  /** CARDS-TTS-1 — see `VocabState.speakLanguage`. */
  speakLanguage?: string;
};

export function LanguageCards({
  practiceLanguage,
  nativeLanguage,
  practiceText,
  nativeText,
  messageId,
  onCopy,
}: {
  practiceLanguage: string;
  nativeLanguage: string;
  practiceText: string;
  nativeText: string;
  messageId: string;
  /** Retained for call-site compatibility; explain TTS is on-demand
   *  (natural pace) so difficulty no longer affects it. */
  wordDifficulty?: Difficulty;
  onCopy: (text: string) => void;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      <LangCard
        flag={getLanguageFlag(practiceLanguage)}
        label={practiceLanguage}
        text={practiceText}
        language={practiceLanguage}
        playbackKey={`explain-${messageId}-practice`}
        onCopy={onCopy}
      />
      <LangCard
        flag={getLanguageFlag(nativeLanguage)}
        label={nativeLanguage}
        text={nativeText}
        language={nativeLanguage}
        playbackKey={`explain-${messageId}-native`}
        onCopy={onCopy}
      />
    </div>
  );
}

export function LangCard({
  flag,
  label,
  text,
  language,
  playbackKey,
  onCopy,
}: {
  flag: string;
  label: string;
  text: string;
  language: string;
  playbackKey: string;
  onCopy: (text: string) => void;
}) {
  // Explain cards are an on-demand surface (TTS-SURFACE-3): natural
  // pace, lite-primary model order, no difficulty pacing. The shared
  // <TTSButton> owns the 3-state ring + gating (renders nothing when
  // the language has no speech support).
  return (
    <div className="p-3 rounded-2xl bg-(--color-bg-elevated) border border-(--color-border)">
      <div className="flex items-center gap-1.5 mb-1 text-xs text-(--color-fg-muted)">
        <span className="text-base leading-none">{flag}</span>
        <span className="truncate">{label}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onCopy(text)}
            aria-label="Copy"
            className="p-1 rounded hover:bg-(--color-bg-hover)"
          >
            <CopyIcon size={14} />
          </button>
          <TTSButton
            text={text}
            language={language}
            playbackKey={playbackKey}
            size={24}
          />
        </div>
      </div>
      <div dir={dirOf(text)} className="text-sm whitespace-pre-wrap break-words text-(--color-fg)">{text}</div>
    </div>
  );
}

export function ReviewCard({
  review,
  vocab,
}: {
  review: NonNullable<ParsedExplanation['review']>;
  vocab: VocabBag;
}) {
  return (
    <div className="p-3 rounded-2xl border border-(--color-accent)/20 bg-(--color-accent)/8 dark:bg-(--color-accent)/10">
      <div className="flex items-center gap-2 mb-1">
        <div className="flex items-center gap-0.5">
          {Array.from({ length: 5 }, (_, i) => (
            <Star
              key={i}
              size={14}
              className={
                i < review.score
                  ? 'text-(--color-warning) fill-current'
                  : 'text-(--color-fg-subtle)'
              }
            />
          ))}
        </div>
        <span className="text-xs text-(--color-fg-muted) ml-1">Translation review</span>
      </div>
      <SimpleMarkdown source={review.body} vocab={vocab} />
    </div>
  );
}

export function SectionCard({
  section,
  vocab,
}: {
  section: ParsedSection;
  vocab: VocabBag;
}) {
  return (
    <div className="flex flex-col">
      <h3 className="flex items-center gap-1.5 text-base font-semibold text-(--color-fg) mb-1">
        <Sparkles size={14} className="text-(--color-accent)" />
        {section.title}
      </h3>
      {/* Body sits slightly inset under the title (aligned with the text,
          past the sparkles icon) to give a subtle visual hierarchy. */}
      <div className="pl-[18px]">
        <SimpleMarkdown source={section.body} vocab={vocab} />
      </div>
    </div>
  );
}

/**
 * PRACTICE-EXPLAIN-9. Single card that combines (in order):
 *   1. Verdict pill (Correct / Incorrect / Overturned) + the "Marked
 *      correct" subline when overturned.
 *   2. The user's answer + the accepted answer, side-by-side.
 *   3. The LLM's "answer check" reasoning body (renderable with
 *      inline `<vocab/>` chips).
 *
 * Replaces the earlier two-card layout (banner + separate Section).
 * One unit so the visual relationship is obvious: verdict → here's why.
 *
 * Tone: success for correct + overturned (both net-positive); danger
 * for incorrect.
 */
export function PracticeAnswerCheckCard({
  verdict,
  userAnswer,
  correctAnswer,
  body,
  vocab,
}: {
  verdict: 'correct' | 'incorrect' | 'overturned';
  userAnswer: string;
  correctAnswer: string;
  body: string;
  vocab: VocabBag;
}) {
  const isOk = verdict === 'correct' || verdict === 'overturned';
  const showCorrectRow =
    verdict === 'incorrect' && correctAnswer && correctAnswer.trim().length > 0;
  return (
    <div
      data-testid="PracticeAnswerCheckCard"
      data-verdict={verdict}
      className={cn(
        'flex flex-col gap-2 p-3 rounded-2xl border',
        isOk
          ? 'border-(--color-success)/30 bg-(--color-success)/5'
          : 'border-(--color-danger)/30 bg-(--color-danger)/5',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wide',
            verdict === 'correct' && 'bg-(--color-success) text-white',
            verdict === 'incorrect' && 'bg-(--color-danger) text-white',
            verdict === 'overturned' && 'bg-(--color-success) text-white',
          )}
        >
          {verdict}
        </span>
        {verdict === 'overturned' && (
          <span className="text-xs font-semibold text-(--color-success)">
            Answer overturned — marked correct
          </span>
        )}
      </div>

      {(userAnswer || showCorrectRow) && (
        <div className="flex flex-col gap-1 text-sm">
          {userAnswer && (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-(--color-fg-muted) min-w-[5rem]">
                Your answer
              </span>
              <span
                dir={dirOf(userAnswer)}
                className={cn(
                  'font-medium',
                  isOk ? 'text-(--color-success)' : 'text-(--color-danger) line-through',
                )}
              >
                {userAnswer}
              </span>
            </div>
          )}
          {showCorrectRow && (
            <div className="flex items-baseline gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wide text-(--color-fg-muted) min-w-[5rem]">
                Accepted
              </span>
              <span dir={dirOf(correctAnswer)} className="font-medium text-(--color-success)">{correctAnswer}</span>
            </div>
          )}
        </div>
      )}

      {body && body.trim().length > 0 && (
        <div className="pt-1">
          <SimpleMarkdown source={body} vocab={vocab} />
        </div>
      )}
    </div>
  );
}

// eslint-disable-next-line react-refresh/only-export-components
export async function copyText(
  text: string,
  push: (t: { kind: 'info' | 'error'; message: string }) => void,
): Promise<void> {
  try {
    await copyToClipboard(text);
    push({ kind: 'info', message: 'Copied' });
  } catch {
    push({ kind: 'error', message: "Couldn't copy" });
  }
}
