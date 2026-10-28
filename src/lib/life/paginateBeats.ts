/**
 * LIFE-PAGE-1 — a long moment is PAGINATED in code, not rationed in the prompt.
 *
 * ── THE PROBLEM THIS REPLACES ───────────────────────────────────────────────
 *
 * The UI shows two beat slots, so the schema capped `beats` at 2 everywhere and
 * the SI spent a section teaching the model to work within it — including the
 * `continuation` node kind, whose whole job is "one more pair of beats, then a
 * Continue". Two consequences, both measured:
 *
 *  · **A big moment could not be told.** Anything needing three beats had to be
 *    compressed into two or split across turns, which costs a whole extra
 *    `life_step` call (~22k tokens) to say what is really one thing happening.
 *  · **The model kept getting the continuation shape wrong.** The lean arm
 *    returned a `continuation` carrying TWO options when the rule is exactly
 *    one, and "exactly ONE option with id continue" was already in the prompt.
 *
 * ── THE SHAPE INSTEAD ───────────────────────────────────────────────────────
 *
 * The model writes what happened — two beats normally, more ONLY when one event
 * genuinely needs them — and CODE cuts the array into pages of two, putting a
 * Continue between pages and the node's real options on the last one. The
 * player sees the same rhythm; the model stops having to produce it.
 *
 * This is the `LIFE-LANG-9.1` principle again: a decision code can make
 * correctly every time does not belong in a 19k-character instruction where it
 * competes for attention. Here it is stronger than that — pagination is not
 * merely reliable in code, it is IMPOSSIBLE to get wrong, because a malformed
 * page cannot be expressed.
 *
 * ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 * It does NOT delete the `continuation` node kind. That is a separate change
 * touching the engine, the event stream and its tests, and it should follow
 * once pagination has been measured rather than ride along with it. What is
 * true today is that pagination makes `continuation` redundant, not absent.
 */


/** Beats visible at once. The UI has exactly two slots (`LIFE-CONTRACT-BUBBLE-1/2`);
 *  a third would render off-screen. */
export const PAGE_SIZE = 2;

/**
 * Upper bound on beats in one response.
 *
 * Not arbitrary: six is three pages, which is two Continues before the player
 * gets a real choice. Beyond that a "moment" has become a cutscene, and the
 * thing this app is for — the player acting — has stopped happening. The cap is
 * enforced in the SCHEMA so an over-long response is a parse failure the retry
 * ladder can see, rather than something silently truncated here.
 */
export const MAX_BEATS = 6;

export type BeatPage<T> = {
  beats: T[];
  /** True on every page but the last: the player taps Continue to advance. */
  more: boolean;
  /** 0-based, for the engine's own bookkeeping and for tests. */
  index: number;
};

/**
 * Cut a beat array into pages of at most `PAGE_SIZE`.
 *
 * An EMPTY array yields ONE empty page rather than none. A question node
 * legitimately carries zero lead-in beats (`LIFE-CONTRACT-EX-7`, after a speech
 * pick), and a caller that received no pages would have nothing to render and
 * no options to attach — the node would vanish. One empty page renders as "no
 * beats, here are the options", which is exactly the current behaviour.
 */
export function paginateBeats<T>(beats: readonly T[], pageSize = PAGE_SIZE): BeatPage<T>[] {
  const size = Math.max(1, Math.trunc(pageSize));
  if (beats.length === 0) return [{ beats: [], more: false, index: 0 }];
  const pages: BeatPage<T>[] = [];
  for (let i = 0; i < beats.length; i += size) {
    pages.push({ beats: beats.slice(i, i + size), more: false, index: pages.length });
  }
  return pages.map((p, i) => ({ ...p, more: i < pages.length - 1 }));
}

/** Does this response need a Continue at all? */
export function needsPaging(beats: readonly unknown[], pageSize = PAGE_SIZE): boolean {
  return beats.length > Math.max(1, Math.trunc(pageSize));
}

/**
 * The rule as the model sees it, rendered into the prompt.
 *
 * States the DEFAULT first and the exception second, and names the cost of the
 * exception. An earlier version of the beat rules stated the cap as a flat
 * maximum, which is the shape that produced a `continuation` node with two
 * options: a bound with no stated purpose reads as a target to work around.
 */
export function beatBudgetRule(): string {
  return (
    `BEATS PER RESPONSE: write TWO, nearly always — that is one exchange, and it is the rhythm the player reads in.` +
    ` You MAY write up to ${MAX_BEATS} when a single event genuinely needs them: something big happening at once,` +
    ` an arrival that has to be seen, a piece of news that lands in stages. Do NOT use the extra room for two` +
    ` unrelated moments — that is two turns, and the player should get to act between them. The client pages` +
    ` anything over two, showing a Continue between pages, so a long moment costs the player a tap, not a choice.`
  );
}

/** LIFE-PAGE-1: the synthetic option the client shows between pages. It is
 *  never authored by the model and never reaches the event stream as a
 *  decision — paging is a display act, not a choice. */
export const CONTINUE_OPTION_ID = 'continue';
