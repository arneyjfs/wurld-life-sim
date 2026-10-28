/**
 * LIFE-BUBBLE-7 — the persisted shape of one life-sim beat.
 *
 * Lives in its own module rather than `firestore.ts` because that file is at
 * the repo's 600-line cap; this schema is self-contained and has one job, so
 * it is the natural thing to lift out. `firestore.ts` re-exports it, so every
 * existing import keeps working unchanged.
 */
import { z } from 'zod';

/** Bilingual payload carried on every narrator / NPC beat so the
 *  bubble UI can flip view modes without a re-fetch. Mirrors the
 *  shape `ZTranslationData` uses on regular messages. */
export const ZLifeBeatPayload = z.object({
  speaker: z.enum(['narrator', 'npc', 'user']),
  /** NPC display name; null/absent for narrator-only beats. */
  speakerName: z.string().nullable().optional(),
  /** Stable NPC slug (persistent NPCs only). */
  npcId: z.string().nullable().optional(),
  /** Practice-language text. */
  practiceText: z.string(),
  /** Native-language translation. */
  nativeText: z.string().nullable().optional(),
  complexWords: z.array(z.string()).optional(),
  wordTranslations: z.record(z.string(), z.string()).optional(),
  // LIFE-LANG-18 (`swapWords`) is RETIRED. Beat events written before the cut
  // may still carry it; zod's default object mode strips the unknown key on
  // read rather than failing the parse.
});
export type LifeBeatPayload = z.infer<typeof ZLifeBeatPayload>;
