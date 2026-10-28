/**
 * LIFE-EX-10 — the card-match GRID mechanics, which LIFE-EX-13 left untouched.
 *
 * The rest of this file used to cover `buildReviewPairs` / `shouldReview` —
 * the v2 mid-scene builder and its cadence. LIFE-EX-13 replaced both with
 * `buildSceneReviewPairs` (covered in `cardMatchScene.test.ts`) and the source
 * functions were deleted, so their tests went with them. These did NOT: the
 * columns, the independent per-column shuffle and the match rule are the same
 * grid they always were.
 */
import { describe, it, expect } from 'vitest';
import { buildReviewColumns, isMatch, type CardMatchTile } from './cardMatch';

describe('buildReviewColumns + isMatch — LIFE-EX-10', () => {
  const pairs = [
    { id: 'w:a', practice: 'a', native: 'A' },
    { id: 'w:b', practice: 'b', native: 'B' },
    { id: 'w:c', practice: 'c', native: 'C' },
    { id: 'w:d', practice: 'd', native: 'D' },
  ];

  it('splits pairs into a practice column and a native column (N each)', () => {
    const cols = buildReviewColumns(pairs, 1);
    expect(cols.practice).toHaveLength(4);
    expect(cols.native).toHaveLength(4);
    expect(cols.practice.every((t) => t.side === 'practice')).toBe(true);
    expect(cols.native.every((t) => t.side === 'native')).toBe(true);
    // Same pair set on both sides.
    expect(new Set(cols.practice.map((t) => t.pairId))).toEqual(
      new Set(cols.native.map((t) => t.pairId)),
    );
  });

  it('is deterministic per seed but shuffles the two columns INDEPENDENTLY', () => {
    const a = buildReviewColumns(pairs, 7);
    const b = buildReviewColumns(pairs, 7);
    expect(a.practice.map((t) => t.key)).toEqual(b.practice.map((t) => t.key));
    // Distinct column seeds → the two columns don't line up pair-for-pair.
    expect(a.practice.map((t) => t.pairId)).not.toEqual(a.native.map((t) => t.pairId));
  });

  it('isMatch: opposite sides of the SAME pair only', () => {
    const t = (pairId: string, side: 'practice' | 'native'): CardMatchTile => ({
      key: `${pairId}:${side}`,
      pairId,
      side,
      text: '',
    });
    expect(isMatch(t('w:a', 'practice'), t('w:a', 'native'))).toBe(true);
    expect(isMatch(t('w:a', 'practice'), t('w:a', 'practice'))).toBe(false);
    expect(isMatch(t('w:a', 'practice'), t('w:b', 'native'))).toBe(false);
  });
});
