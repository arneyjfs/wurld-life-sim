/**
 * LIFE-EX-10: card-matching review — a TWO-COLUMN tap-to-match grid built from
 * the recent-question vocab (`cardMatch.ts`). Left column = practice words,
 * right column = native glosses (each independently shuffled). Tap a tile then
 * its partner in the OTHER column; a correct pair locks in the primary theme
 * colour and SORTS TO THE TOP of both columns (so solved pairs line up and the
 * remaining work shrinks); a wrong pair flashes and clears. When every pair is
 * matched, `onComplete` advances the story.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { useT } from '@/i18n';
import {
  buildReviewColumns,
  isMatch,
  type CardMatchPair,
  type CardMatchTile,
} from '@/lib/life/cardMatch';

/** How long a mismatched pair stays flagged before it resets. */
const WRONG_FLASH_MS = 650;

export function CardMatchExercise({
  pairs,
  seed,
  onComplete,
}: {
  pairs: ReadonlyArray<CardMatchPair>;
  /** Shuffle seed (stable per review, varies across them). */
  seed: number;
  onComplete: () => void;
}) {
  const t = useT();
  const cols = useMemo(() => buildReviewColumns(pairs, seed), [pairs, seed]);
  const [matched, setMatched] = useState<ReadonlySet<string>>(new Set());
  // Match ORDER (pairIds) so solved rows sort to the top in the order solved.
  const [order, setOrder] = useState<ReadonlyArray<string>>([]);
  const [selected, setSelected] = useState<CardMatchTile | null>(null);
  const [wrong, setWrong] = useState<ReadonlySet<string>>(new Set());
  const wrongTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (wrongTimer.current != null) window.clearTimeout(wrongTimer.current);
    },
    [],
  );

  /** Matched tiles (in solve order) first, then the rest in shuffle order. */
  function ordered(tiles: CardMatchTile[]): CardMatchTile[] {
    const solved = order
      .map((id) => tiles.find((x) => x.pairId === id))
      .filter((x): x is CardMatchTile => !!x);
    const rest = tiles.filter((x) => !matched.has(x.pairId));
    return [...solved, ...rest];
  }

  function handleTap(tile: CardMatchTile) {
    if (matched.has(tile.pairId) || wrong.size > 0) return;
    if (!selected) {
      setSelected(tile);
      return;
    }
    if (selected.key === tile.key) {
      setSelected(null); // tap the same tile → deselect
      return;
    }
    if (selected.side === tile.side) {
      setSelected(tile); // re-pick within the same column
      return;
    }
    // Opposite columns → evaluate the pair.
    if (isMatch(selected, tile)) {
      const next = new Set(matched);
      next.add(tile.pairId);
      setMatched(next);
      setOrder((o) => [...o, tile.pairId]);
      setSelected(null);
      if (next.size === pairs.length) onComplete();
    } else {
      setWrong(new Set([selected.key, tile.key]));
      setSelected(null);
      wrongTimer.current = window.setTimeout(() => setWrong(new Set()), WRONG_FLASH_MS);
    }
  }

  const renderTile = (tile: CardMatchTile) => {
    const isMatched = matched.has(tile.pairId);
    const isSelected = selected?.key === tile.key;
    const isWrong = wrong.has(tile.key);
    return (
      <button
        key={tile.key}
        type="button"
        data-testid={`LifeScreen-CardMatch-Tile-${tile.key}`}
        data-matched={isMatched ? 'true' : undefined}
        onClick={() => handleTap(tile)}
        disabled={isMatched}
        dir={dirOf(tile.text)}
        className={cn(
          'px-2.5 py-3 rounded-2xl text-sm font-medium border text-center leading-snug break-words min-h-[3rem] transition-colors',
          // Matched → practice-mode SUCCESS green (LIFE-EX-10 parity with
          // MatchingQuestion's 'matched' cell), sorted to the top.
          isMatched && 'border-(--color-success) bg-(--color-success)/10 text-(--color-success)',
          !isMatched &&
            isSelected &&
            'border-(--color-accent) bg-(--color-accent)/10 ring-2 ring-(--color-accent)/40 text-(--color-fg)',
          !isMatched && isWrong && 'border-(--color-danger) bg-(--color-danger)/10 text-(--color-danger)',
          !isMatched &&
            !isSelected &&
            !isWrong &&
            'border-(--color-border) bg-(--color-bg-elevated) text-(--color-fg)',
        )}
      >
        {tile.text}
      </button>
    );
  };

  return (
    <div
      data-testid="LifeScreen-CardMatch"
      className="px-3 pt-2 pb-[max(var(--spacing-safe-bottom),1rem)] bg-(--color-bg)"
    >
      <div className="mx-auto max-w-md w-full motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200">
        <div className="text-[10px] font-bold uppercase tracking-wider text-(--color-accent) mb-2 text-center">
          {t('life.cardMatch.eyebrow')}
        </div>
        <div className="grid grid-cols-2 gap-2" data-testid="LifeScreen-CardMatch-Grid">
          <div className="flex flex-col gap-2" data-testid="LifeScreen-CardMatch-Practice">
            {ordered(cols.practice).map(renderTile)}
          </div>
          <div className="flex flex-col gap-2" data-testid="LifeScreen-CardMatch-Native">
            {ordered(cols.native).map(renderTile)}
          </div>
        </div>
      </div>
    </div>
  );
}
