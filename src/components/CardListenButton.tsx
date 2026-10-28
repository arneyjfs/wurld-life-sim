import { TTSButton } from '@/components/TTSButton';
import { getSpeechLanguageCode } from '@/lib/languages';
import { cn } from '@/lib/cn';

type Props = {
  /** The flashcard's practice-language phrase. */
  phrase: string;
  /** The card's practice language (display name). No speech support → nothing renders. */
  language?: string;
  /** Card id when the phrase IS a saved card — keys playback per card (CARDS-TTS-6). */
  cardId?: string;
  /** Inline button size in px (TTSButton `size`). */
  size?: number;
  /** Wrapper testid; defaults to `card-listen`. */
  testId?: string;
  /** TTSButton variant; `bare` is the glyph alone in the text colour (CARDS-TTS-9). */
  variant?: 'inline' | 'bare';
  className?: string;
};

/** CARDS-TTS-6 — one key per card, so a re-tap anywhere stops it. */
function cardPlaybackKey(phrase: string, cardId?: string): string {
  return cardId ? `card:${cardId}` : `card-phrase:${phrase.trim().toLowerCase()}`;
}

/**
 * The listen button every flashcard surface carries (docs/specs/cards-screen.md
 * CARDS-TTS-*). A thin wrapper over the shared `<TTSButton>` (TTS-BUTTON-*):
 *  - on demand only, never warmed on mount (CARDS-TTS-2);
 *  - renders nothing at all when the language can't be spoken, so no row
 *    reserves a gap for it (CARDS-TTS-3);
 *  - swallows its own pointer + click events so a tap never long-presses,
 *    flips, saves or selects whatever it sits on (CARDS-TTS-4).
 */
export function CardListenButton({
  phrase,
  language,
  cardId,
  size = 26,
  testId = 'card-listen',
  variant = 'inline',
  className,
}: Props) {
  const text = phrase.trim();
  if (!text || !language || !getSpeechLanguageCode(language)) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  return (
    <span
      data-testid={testId}
      className={cn('inline-flex shrink-0', className)}
      onClick={stop}
      onPointerDown={stop}
      onMouseDown={stop}
      onTouchStart={stop}
      onKeyDown={stop}
    >
      <TTSButton
        text={text}
        language={language}
        playbackKey={cardPlaybackKey(text, cardId)}
        warmOnMount={false}
        size={size}
        variant={variant}
      />
    </span>
  );
}
