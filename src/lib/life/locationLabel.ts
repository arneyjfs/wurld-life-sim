/**
 * LIFE-BACKDROP-27 — the location label, normalised in CODE.
 *
 * TWO prompt rules already forbid a time suffix — `step.ts`: *"locationLabel is
 * … A PLACE ONLY — no time of day"*, and `playerKnowledge.ts`: *"do NOT append
 * the hour to it ('Ton appartement · matin')"* — and a production label still
 * arrived as `Ton appartement · nuit` on 2026-08-06. Adding a THIRD sentence
 * saying the same thing is the move that has already failed twice; a rule the
 * model can break with no consequence is not a mechanism.
 *
 * It matters more than a cosmetic slip because **the label IS the backdrop
 * cache key** (LIFE-BACKDROP-2). A time baked into it regenerates the same
 * place once per hour of story time — a fresh SVG, a fresh bill — and then the
 * ribbon contradicts the light on screen the moment the clock moves.
 *
 * Applied at the SCHEMA boundary (`ZBackdropIntent`), which is the one place
 * every consumer passes through: `commitNode`'s world patch, the
 * `backdrop_visited` event, the cache key, the ribbon, and the graded prompt's
 * `<location>` block. Same technique, and the same reasoning, as the
 * `actionType` preprocess in `stepSchema.ts`: fix the value where it costs
 * nothing rather than at the seam where it costs a turn.
 */

/** The one separator with no legitimate use in a place name, and the exact
 *  shape both prompt rules cite. Cut here and everything after it goes. */
const TIME_SUFFIX = /\s*·.*$/;

/**
 * A ribbon label reduced to a place name.
 *
 * Deliberately NARROW. It cuts only what is unambiguous:
 *
 *  - everything from the first `·` — the documented failure. MEASURED over 145
 *    distinct archived labels: zero legitimate uses.
 *  - a terminal full stop. A name does not end in one; a sentence does, and
 *    2.8% of archived labels were descriptions rather than names ("Pedro's
 *    Hearth, a bakery that stays warm even in the dead of winter.").
 *
 * It does NOT cut at a comma, even though that is where those descriptions
 * begin, because a comma tail is often a real sub-location ("Pedro's Hearth,
 * in the cellar") — a DIFFERENT backdrop that must keep its own cache key.
 * Merging those would be a worse bug than the one being fixed.
 *
 * Never returns empty from a non-empty input: a label that is ONLY a time
 * would cut to `''`, which the ribbon renders as a blank pill and the cache
 * keys as the empty string — every timeless place colliding on one entry. A
 * bad label is recoverable; an empty one is not.
 */
export function normaliseLocationLabel(raw: string): string {
  const trimmed = raw.trim().replace(/\s+/g, ' ');
  if (!trimmed) return '';
  const cut = trimmed.replace(TIME_SUFFIX, '').replace(/\.$/, '').trim();
  return cut || trimmed;
}

/** True when normalising would CHANGE the label — the caller logs on this, so
 *  the rate is observable in production instead of assumed. */
export function locationLabelWasNormalised(raw: string): boolean {
  return normaliseLocationLabel(raw) !== raw;
}
