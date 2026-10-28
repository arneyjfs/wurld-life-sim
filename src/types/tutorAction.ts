import { z } from 'zod';

/**
 * TUTOR-ACTION-5: a structured tutor action, rendered as a centered card in
 * the chat timeline (flashcards confirmation / explain card) instead of a
 * plain bubble. Authored + written COMPLETE server-side so it bypasses the
 * translation pipeline (TUTOR-ACTION-4). Leaf fields are plain text — no
 * inline quoted markup (the TUTOR-UI-4 lesson); vocab is a nested array.
 *
 * Extracted from `firestore.ts` to keep that hub under the 600-LOC cap.
 */
export const ZTutorActionCard = z.object({
  phrase: z.string(),
  translation: z.string(),
});
export const ZTutorActionVocab = z.object({
  word: z.string(),
  gloss: z.string(),
});
export const ZTutorActionSection = z.object({
  heading: z.string(),
  body: z.string(),
  vocab: z.array(ZTutorActionVocab).optional(),
});
export const ZTutorAction = z.object({
  kind: z.enum(['flashcards', 'explain', 'practice']),
  /** flashcards: the phrase/translation pairs the tutor added. */
  cards: z.array(ZTutorActionCard).optional(),
  /** flashcards: how many were newly written (dedupe hits excluded). */
  addedCount: z.number().optional(),
  /** explain: the card title + sections. */
  explanation: z
    .object({
      title: z.string(),
      sections: z.array(ZTutorActionSection),
    })
    .optional(),
  /** practice (TUTOR-ACTION-10): a custom session the tutor kicked off.
   *  `sessionIntent` is passed verbatim to the planner via
   *  `/cards/practice?intent=…`; `label` is the card's tap-target text. */
  practice: z
    .object({
      sessionIntent: z.string(),
      label: z.string(),
      /** TUTOR-ACTION-10.2 — the question-type filter; absent = all. An
       *  unknown value reads as absent rather than dropping the card. */
      skill: z.enum(['reading', 'writing', 'listening']).optional().catch(undefined),
    })
    .optional(),
});
export type TutorAction = z.infer<typeof ZTutorAction>;
