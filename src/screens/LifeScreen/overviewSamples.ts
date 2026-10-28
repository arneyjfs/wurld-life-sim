/**
 * LIFE-WORLD-*: example worlds shown on the overview's empty state.
 * These are illustrative only — they're not selectable, they exist
 * to show the range of what a world can be. Tapping any of them
 * routes the player to onboarding.
 */
export type SampleWorld = {
  /** Display title — "Character · Setting hook". */
  title: string;
  /** One-line premise — what kind of story this world tells. */
  premise: string;
  /** Practice language label. */
  language: string;
  /** Country / regional emoji that gives a quick visual cue. */
  emoji: string;
  /**
   * LIFE-WORLD-12: the card's HUE, as a single CSS colour.
   *
   * Deliberately NOT a Tailwind palette class pair (it used to be
   * `from-rose-200 to-amber-200` etc.). The card never paints this
   * colour opaquely — `LifeOverviewEmpty` mixes it down to a low
   * percentage over `--color-bg-elevated`, so the SURFACE stays the
   * themed card surface and this only shifts its hue. That's what
   * makes it survive a light/dark flip: a fixed pastel fill needs
   * fixed dark text to stay legible, and both of those then fight
   * the theme in dark mode.
   *
   * Mid-saturation, mid-lightness values on purpose — they have to
   * read as a distinguishable tint over BOTH white (#ffffff) and the
   * dark elevated surface (#1a1928).
   */
  tint: string;
};

/**
 * LIFE-WORLD-16 — WHAT THESE CARDS TEACH, and why they were all rewritten.
 *
 * MEASURED across every four-world benchmark run: the two weakest judged
 * dimensions are CAST-DEPTH and CHARACTER, and the recurring note on the worst
 * of them is that people *"function primarily as quest-givers"*. The previous
 * four cards were all shaped as a HOOK — a piece to submit, a grimoire that
 * goes missing, a wife who is missing, mountains that hum and nobody talks
 * about. Each names a mystery or a mission and nothing else, so the only role
 * left for a person is to hand the player the next step.
 *
 * They also contradicted the engine they advertise. `LIFE-STORY-*` deliberately
 * removed the in-medias-res high-drama opening so stories could build, and the
 * step prompt's tone rule is that most scenes are ordinary. A player whose
 * expectation is set by "the school is hiding something" has been promised a
 * different product from the one that runs.
 *
 * So each premise is now a SITUATION WITH PEOPLE IN IT: someone who wants
 * something, someone else in the way, and a reason they keep meeting. Nothing
 * here is a puzzle to solve, and none of it decides how the story goes — which
 * is also `LIFE-ARCH-3` (nothing anywhere stores a future) applied to the copy
 * that sets a player's expectations.
 */
export const SAMPLE_WORLDS: SampleWorld[] = [
  {
    title: 'Marc · painter in Paris',
    premise:
      'You share a cold studio with two other painters. Only one of you can afford to stay past winter.',
    language: 'French',
    emoji: '🎨',
    // Warm amber — Montmartre lamplight.
    tint: '#e08a3c',
  },
  {
    title: 'Anna · undergraduate in magic',
    premise:
      'First year, third floor of the halls. Your roommate is better at this than you and lectures keep rearranging what you thought was true.',
    language: 'Spanish',
    emoji: '🪄',
    // Brand violet (sits beside --color-gradient-accent-start #7340f5).
    tint: '#7b4ff0',
  },
  {
    title: 'Hiroshi · private investigator',
    premise:
      '1940s Osaka. The rent on the office is late, and most of the work is other people’s small dishonesties.',
    language: 'Japanese',
    emoji: '🕵️',
    // Steel blue — cool and nocturnal, where the old slate→stone pair
    // just went muddy.
    tint: '#4f86c6',
  },
  {
    title: 'Sofia · frontier settler',
    premise:
      'Two hundred people, one greenhouse, and a supply ship twice a year. Everyone here is somebody’s neighbour.',
    language: 'Portuguese',
    emoji: '🏔️',
    // Teal-green — the only cool-green in the set, so it can't be
    // confused with the steel blue above it.
    tint: '#2fa389',
  },
];
