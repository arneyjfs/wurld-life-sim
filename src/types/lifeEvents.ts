/**
 * LIFE-EVENT-1: the append-only memory log's event-kind catalogue.
 *
 * Split out of firestore.ts, which sits at the 600-LOC cap: this is a data table
 * rather than logic, and it grows whenever a new kind of thing can happen in a
 * world. Re-exported from firestore.ts so every existing import is unchanged.
 */
import { z } from 'zod';

/** LIFE-EVENT-1: append-only memory log. Each turn writes 1+ rows. */
export const ZLifeEventKind = z.enum([
  'beat',
  'flashcard_added',
  'npc_introduced',
  'backdrop_visited',
  'decision',
  'correction',
  'npc_forgotten',
  /** LIFE-EX-CADENCE-1: a question node was planned but its generator rejected
   *  the plan, so the node was demoted to a branch (`LIFE-NODE-8` graceful
   *  demote). No practice happened, so this is NOT a `correction` — but the
   *  cadence counter must still see that a graded slot was SPENT, or the
   *  `<practiceCadence>` directive re-forces a question on the very next node
   *  and a demote loop burns three calls a turn. Never rendered into the
   *  prompt. */
  'question_demoted',
  /** LIFE-SCENE-6: a new scene was accepted + outline written. */
  'scene_started',
  /** LIFE-SCENE-10: a scene resolved + archived. */
  'scene_completed',
  /** LIFE-WORLD-ARC-*: a new chapter began (worldArcGenerate landed). */
  'world_arc_started',
  /** LIFE-WORLD-ARC-*: the current chapter resolved + archived. */
  'world_arc_completed',
  /** LIFE-NPC-RECUR-*: an NPC was promoted to world-scope. */
  'npc_promoted_world',
  /** LIFE-NPC-RECUR-*: an NPC was demoted to transient (retiring). */
  'npc_retiring',
]);
export type LifeEventKind = z.infer<typeof ZLifeEventKind>;
