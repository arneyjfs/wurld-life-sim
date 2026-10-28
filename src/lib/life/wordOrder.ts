/**
 * LIFE-EX-11: word-order — the player builds the sentence they're about to say
 * by tapping the shuffled words in the right ORDER (a word-bank builder). It is
 * a CLIENT render variant of a fill-blank (LIFE-EX-8/9 pattern): the graded
 * generator still authors the chips; the client takes the COMPLETED sentence
 * (template with the correct chip), splits it into word tiles, shuffles them,
 * and grades the tapped order against the original sentence. Production practice
 * — you assemble the whole line, not just fill one gap.
 */

/** Synthetic choice id for the assembled-order answer (not one of the chips). */
export const ORDER_ANSWER_ID = '__ordered__';

/** A shuffled word tile. `index` is its ORIGINAL position in the bank so
 *  duplicate words stay individually addressable (place / remove the right one). */
export type WordTile = { index: number; text: string };

/** Deterministic LCG shuffle (no `Math.random` — predictable in tests). */
function seededShuffle<T>(arr: ReadonlyArray<T>, seed: number): T[] {
  const a = [...arr];
  let s = seed >>> 0 || 1;
  for (let i = a.length - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/** Split the target sentence into word tiles and shuffle them for the bank. */
export function buildWordBank(sentence: string, seed: number): WordTile[] {
  const tiles = sentence
    .split(/\s+/)
    .filter(Boolean)
    .map((text, index) => ({ index, text }));
  return seededShuffle(tiles, seed);
}

/** Normalise a sentence for order comparison: trim, collapse internal
 *  whitespace, lowercase. Punctuation stays (it rides on the word tiles);
 *  accents stay (load-bearing). */
export function normalizeOrder(s: string): string {
  return s.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
}

/** True when the built sentence matches the target order (both normalised,
 *  non-empty). */
export function isOrderCorrect(built: string, target: string): boolean {
  const b = normalizeOrder(built);
  return b.length > 0 && b === normalizeOrder(target);
}
