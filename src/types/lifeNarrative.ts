/**
 * Life-sim narrative sub-schemas: the UNIVERSE (the setting a saga happens in)
 * and the CANON (the ledger of what the story has established).
 *
 * Extracted from `firestore.ts` for the 600-LOC cap. Both hang off life-sim
 * documents — `ZUniverse` off `ZWorldSaga`, `ZWorldCanon` off `ZLifeWorld`.
 */
import { z } from 'zod';

/** The SETTING, as distinct from the plot: Middle-earth vs the story of the
 *  Ring. Generated once with the saga and never regenerated, so it is the most
 *  stable block in the entire prompt and anchors the prefix cache.
 *
 *  `laws` is the load-bearing field: the rules this world runs on, present
 *  tense ("the hush-spirits cannot speak aloud; they answer by moving
 *  objects"). Failures like "offers to talk to something established as unable
 *  to talk" are LAW violations — and a law the model is shown on every single
 *  turn is far harder to contradict than one buried in a beat forty events
 *  ago. */
export const ZUniverse = z.object({
  setting: z.string().default(''),
  era: z.string().default(''),
  laws: z.array(z.string()).default([]),
  places: z.array(z.string()).default([]),
  figures: z.array(z.object({ name: z.string(), what: z.string() })).default([]),
});
export type Universe = z.infer<typeof ZUniverse>;

/** LIFE-CANON-1: one established entity. `id` is a stable slug the model
 *  references from an option's `targetId`, which is what makes "does this
 *  thing actually exist yet?" a machine check instead of a prompt plea. */
export const ZCanonEntry = z.object({
  id: z.string(),
  name: z.string(),
  /** What it IS — 'person' | 'spirit' | 'animal' | 'creature' | 'place' |
   *  'object' | 'fact' | 'faction'. Free-form so a world can invent its own
   *  categories; only `canSpeak` is interpreted programmatically. */
  kind: z.string().default('person'),
  /** One line: what it is / what the player knows about it. */
  note: z.string().default(''),
  /** LIFE-CANON-3 affordance. `false` means this entity produces no spoken
   *  words; the player may still address it, but its response is rendered as
   *  narration (a narrator beat), never an npc speech bubble — enforced at
   *  commit time (`muteEntityIds`). Absent ⇒ unconstrained. */
  canSpeak: z.boolean().optional(),
  /** Chapter this entered the canon; purely informational. */
  chapter: z.number().optional(),
});
export type CanonEntry = z.infer<typeof ZCanonEntry>;

export const ZWorldCanon = z.object({
  characters: z.array(ZCanonEntry).default([]),
  places: z.array(ZCanonEntry).default([]),
  objects: z.array(ZCanonEntry).default([]),
  facts: z.array(ZCanonEntry).default([]),
});
export type WorldCanon = z.infer<typeof ZWorldCanon>;
