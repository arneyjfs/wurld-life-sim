/**
 * LIFE-EX-10: card-matching — an occasional REVISION that repurposes a graded
 * slot. Instead of the LLM authoring a question, the CLIENT builds a two-column
 * tap-to-match grid from the KEY VOCAB of the RECENT QUESTIONS (the annotated
 * words in the last few turns' beats) — spaced review of what the player just
 * practised, for FREE (no gen call). The story continues afterward as a neutral
 * turn (a review has no outcome to fork on — LIFE-CONTRACT-EX-3).
 *
 * v2 (2026-07): the source became the recent-turn vocab (was the whole saved
 * deck, which repeated identically — the "same card-match every time" loop).
 *
 * v3 (LIFE-EX-13, 2026-08): the review moved to the END OF THE SCENE and its
 * source to the whole scene, misses first. The v2 mid-scene builder
 * (`buildReviewPairs`) and its `REVIEW_EVERY` cadence helper are DELETED
 * rather than left beside `buildSceneReviewPairs` — two pair builders answering
 * "what should the player revise?" is precisely the shape that drifts, and
 * nothing called them any more.
 *
 * Pure data helpers here; the grid UI is `CardMatchExercise`, the trigger +
 * advance are `nodeEngineCardMatch`.
 */
import type { LifeEvent } from '@/types/firestore';

/** One review pair: a practice phrase and its native gloss. */
export type CardMatchPair = { id: string; practice: string; native: string };

/** A single tappable tile — one SIDE of a pair, placed in a column. */
export type CardMatchTile = {
  /** Stable unique key (`${pairId}:${side}`). */
  key: string;
  pairId: string;
  side: 'practice' | 'native';
  text: string;
};

/** A review needs enough pairs to be a real game (and to avoid a trivial
 *  2-card match). Below this the slot falls back to a normal question. */
export const CARD_MATCH_MIN_PAIRS = 3;
/** Cap the grid so it stays a quick review, not a memory marathon. */
export const CARD_MATCH_MAX_PAIRS = 5;

/** Safely read a beat event's `wordTranslations` map (practice → native). */
function beatVocab(
  e: LifeEvent,
): Array<{ practice: string; native: string }> {
  const payload = e.payload as
    | { complexWords?: unknown; wordTranslations?: unknown }
    | undefined;
  const wt = payload?.wordTranslations;
  if (!wt || typeof wt !== 'object') return [];
  const map = wt as Record<string, unknown>;
  // Prefer the model-flagged hard words (in emphasis order); else every glossed
  // key. `complexWords` are the "key vocab" the beat highlighted.
  const complex = Array.isArray(payload?.complexWords)
    ? (payload!.complexWords as unknown[]).map(String)
    : Object.keys(map);
  const out: Array<{ practice: string; native: string }> = [];
  for (const w of complex) {
    const practice = String(w).trim();
    const nativeRaw = map[w] ?? map[practice.toLocaleLowerCase()];
    const native = typeof nativeRaw === 'string' ? nativeRaw.trim() : '';
    if (practice && native) out.push({ practice, native });
  }
  return out;
}

/**
 * LIFE-EX-13: the END-OF-SCENE review set — the whole scene, misses first.
 *
 * `buildReviewPairs` above answers "what did the last few turns teach?", which
 * was right for a mid-scene interruption. This answers the question a scene's
 * LAST exercise should ask: of everything this scene put in front of you, what
 * is worth one more look? Three tiers, in order:
 *
 *   1. MISSED     — corrections the player got WRONG. The one tier guaranteed
 *                   to be useful, so it goes first and takes as many slots as
 *                   it needs. A review drawn uniformly spends most of its grid
 *                   on words the player already knew.
 *   2. PRACTISED  — corrections they got right. Met under test, worth locking.
 *   3. NARRATION  — annotated words from the scene's beats, MOST FREQUENT
 *                   first. Frequency, not recency: a word the scene used four
 *                   times is what the scene was about, whereas the newest word
 *                   is an accident of where the scene happened to stop.
 *
 * Scoped to the scene by walking back to its own `scene_started` marker — the
 * same boundary `buildSceneLog` uses, so the review and the close agree about
 * what "this scene" means.
 */
export function buildSceneReviewPairs(
  events: ReadonlyArray<LifeEvent>,
  cap: number = CARD_MATCH_MAX_PAIRS,
): CardMatchPair[] {
  const scene = eventsSinceSceneStart(events);
  const missed: CardMatchPair[] = [];
  const practised: CardMatchPair[] = [];
  /** practice phrase → { native, count } for tier 3. */
  const narration = new Map<string, { practice: string; native: string; count: number }>();

  for (const e of scene) {
    if (e.kind === 'correction') {
      const p = correctionPair(e);
      if (p) (isCorrect(e) ? practised : missed).push(p);
      continue;
    }
    if (e.kind !== 'beat') continue;
    for (const { practice, native } of beatVocab(e)) {
      const key = practice.toLocaleLowerCase();
      const hit = narration.get(key);
      if (hit) hit.count += 1;
      else narration.set(key, { practice, native, count: 1 });
    }
  }

  // Newest-first WITHIN the graded tiers: a scene can test the same target
  // twice, and the later attempt is the one that reflects where the player
  // actually is.
  missed.reverse();
  practised.reverse();
  const byFrequency = [...narration.values()]
    .sort((a, b) => b.count - a.count)
    .map((v) => ({ id: `w:${v.practice.toLocaleLowerCase()}`, practice: v.practice, native: v.native }));

  const out: CardMatchPair[] = [];
  const seen = new Set<string>();
  for (const pair of [...missed, ...practised, ...byFrequency]) {
    const key = pair.practice.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(pair);
    if (out.length >= cap) break;
  }
  return out;
}

/** The scene's own events. Falls back to the WHOLE window when no marker is
 *  present (a world mid-migration, or a listener that has scrolled past its
 *  own `scene_started`) — the same fallback `buildSceneLog` makes, for the
 *  same reason: a review over too much is better than no review. */
function eventsSinceSceneStart(
  events: ReadonlyArray<LifeEvent>,
): ReadonlyArray<LifeEvent> {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.kind === 'scene_started') return events.slice(i + 1);
  }
  return events;
}

function isCorrect(e: LifeEvent): boolean {
  return (e.payload as { correct?: unknown } | undefined)?.correct === true;
}

/** A graded answer as a review pair: the CORRECT answer and its gloss — never
 *  what the player picked, which on a miss is the wrong word and the last
 *  thing to drill. `correctAnswerNative` is spread-when-present on the write
 *  (LIFE-VOCAB-RECAP-7), so a correction without one yields no pair rather
 *  than a half-filled tile. */
function correctionPair(e: LifeEvent): CardMatchPair | null {
  const p = (e.payload ?? {}) as { correctAnswer?: unknown; correctAnswerNative?: unknown };
  const practice = typeof p.correctAnswer === 'string' ? p.correctAnswer.trim() : '';
  const native = typeof p.correctAnswerNative === 'string' ? p.correctAnswerNative.trim() : '';
  if (!practice || !native) return null;
  return { id: `q:${practice.toLocaleLowerCase()}`, practice, native };
}

/** Deterministic Fisher-Yates using an LCG seeded by `seed` — NO `Math.random`
 *  (predictable in tests; play varies it via the seed). */
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

/** Split pairs into two INDEPENDENTLY-shuffled columns (practice · native) so
 *  matching sides never line up across the gap (LIFE-EX-10 UI). */
export function buildReviewColumns(
  pairs: ReadonlyArray<CardMatchPair>,
  seed: number,
): { practice: CardMatchTile[]; native: CardMatchTile[] } {
  const practice = pairs.map((p) => ({
    key: `${p.id}:practice`,
    pairId: p.id,
    side: 'practice' as const,
    text: p.practice,
  }));
  const native = pairs.map((p) => ({
    key: `${p.id}:native`,
    pairId: p.id,
    side: 'native' as const,
    text: p.native,
  }));
  return {
    practice: seededShuffle(practice, seed),
    // A distinct seed for the native column so the two don't shuffle in lockstep.
    native: seededShuffle(native, (seed ^ 0x9e3779b9) >>> 0),
  };
}

/** True when two tiles are opposite sides of the SAME pair (a correct match). */
export function isMatch(a: CardMatchTile, b: CardMatchTile): boolean {
  return a.pairId === b.pairId && a.side !== b.side;
}
