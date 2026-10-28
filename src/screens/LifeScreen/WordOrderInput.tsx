/**
 * LIFE-EX-11: word-order — build the sentence you're about to say by tapping
 * the shuffled words in order. A word-bank at the bottom, a sentence tray above
 * it; tap a bank word to append it to the tray, tap a tray word to send it
 * back. Submit (enabled once every word is placed) grades the assembled order
 * against the target sentence (`wordOrder.ts` / the engine's `submitOrder`).
 */
import { useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { useT } from '@/i18n';
import { buildWordBank } from '@/lib/life/wordOrder';

export function WordOrderInput({
  sentence,
  nativePrompt,
  seed,
  onSubmit,
}: {
  /** The COMPLETED practice sentence the player reassembles. */
  sentence: string;
  /** The native meaning to convey (shown as the "say this" cue). Hidden when
   *  empty. */
  nativePrompt?: string;
  /** Shuffle seed (stable per question, varies across them). */
  seed: number;
  onSubmit: (built: string) => void;
}) {
  const t = useT();
  const allTiles = useMemo(() => buildWordBank(sentence, seed), [sentence, seed]);
  // Placed word indices, in tap order (duplicate words stay addressable by index).
  const [placedIndices, setPlacedIndices] = useState<number[]>([]);

  const placedSet = new Set(placedIndices);
  const bank = allTiles.filter((tl) => !placedSet.has(tl.index));
  const placed = placedIndices
    .map((i) => allTiles.find((tl) => tl.index === i))
    .filter((tl): tl is (typeof allTiles)[number] => !!tl);
  const allPlaced = bank.length === 0 && placed.length > 0;

  const dir = dirOf(sentence);

  return (
    <div
      data-testid="LifeScreen-WordOrder"
      className="px-3 pt-2 pb-[max(var(--spacing-safe-bottom),1rem)] bg-(--color-bg)"
    >
      <div className="mx-auto max-w-md w-full">
        <div className="text-[10px] font-bold uppercase tracking-wider text-(--color-accent) mb-1 text-center">
          {t('life.wordOrder.eyebrow')}
        </div>
        {nativePrompt?.trim() && (
          <div
            dir={dirOf(nativePrompt)}
            data-testid="LifeScreen-WordOrder-Cue"
            className="text-sm text-(--color-fg) text-center mb-2 leading-snug"
          >
            {t('life.wordOrder.sayThis', { text: nativePrompt })}
          </div>
        )}
        {/* Sentence tray — the assembled line. */}
        <div
          data-testid="LifeScreen-WordOrder-Sentence"
          dir={dir}
          className="min-h-[3.25rem] px-2 py-2 rounded-2xl border border-(--color-accent)/30 bg-(--color-bg-elevated) flex flex-wrap gap-1.5 items-center mb-2.5"
        >
          {placed.length === 0 ? (
            <span className="text-sm text-(--color-fg-muted) px-1.5">
              {t('life.wordOrder.hint')}
            </span>
          ) : (
            placed.map((tl) => (
              <button
                key={tl.index}
                type="button"
                data-testid={`LifeScreen-WordOrder-Placed-${tl.index}`}
                onClick={() => setPlacedIndices((p) => p.filter((i) => i !== tl.index))}
                className="px-2.5 py-1.5 rounded-lg text-sm font-medium bg-gradient-accent text-white"
              >
                {tl.text}
              </button>
            ))
          )}
        </div>
        {/* Word bank — the remaining tiles. */}
        <div className="flex flex-wrap gap-1.5 justify-center mb-2.5 min-h-[2.5rem]">
          {bank.map((tl) => (
            <button
              key={tl.index}
              type="button"
              data-testid={`LifeScreen-WordOrder-Bank-${tl.index}`}
              onClick={() => setPlacedIndices((p) => [...p, tl.index])}
              className="px-2.5 py-1.5 rounded-lg text-sm font-medium border border-(--color-border) bg-(--color-bg-elevated) text-(--color-fg)"
            >
              {tl.text}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="LifeScreen-WordOrder-Submit"
          disabled={!allPlaced}
          onClick={() => onSubmit(placed.map((tl) => tl.text).join(' '))}
          className={cn(
            'w-full py-2.5 rounded-full text-sm font-semibold',
            allPlaced
              ? 'bg-gradient-accent text-white'
              : 'bg-(--color-bg-hover) text-(--color-fg-muted) cursor-not-allowed',
          )}
        >
          {t('life.wordOrder.submit')}
        </button>
      </div>
    </div>
  );
}
