/**
 * PRACTICE-OWN-8 / PRACTICE-OWN-10 — what is left of the client's
 * practice-generator "prompts" module: three types. No prose, no schemas.
 *
 * It used to carry a full copy of all eight generator system instructions and
 * their user-prompt builders — ~380 lines of the exact text
 * `functions/src/prompts/practiceGeneration.ts` holds — plus the four response
 * schemas. PRACTICE-OWN-1 moved the prompt building to the server, which left
 * the prose dead in production and dangerous in place: a second copy of a
 * prompt is a second thing to edit, and this repo has already shipped a bug
 * that way (trust note 17, `docs/archive/model-migration-2026-07.md` — the client copy
 * was edited and the canonical one was not). PRACTICE-OWN-10 then took the
 * schemas, because a schema is the half of the artefact that constrains the
 * ANSWER and splitting it from the prompt is the same mistake one layer down.
 *
 * It matters more than hygiene now the app is heading for an App Store.
 * `capacitor.config.ts` sets `webDir: 'dist'` with no `server.url`, so a native
 * binary FREEZES its JS at build time: a prompt shipped inside the bundle can
 * only be corrected by a store release, while one built in `functions/` is a
 * `deploy:prod:functions` away.
 *
 * The types stay because they are the client's own: the orchestrator, the
 * planner stream and the question renderers are written against them, and they
 * describe the data the client SENDS rather than anything the model is told.
 *
 * Renamed from `prompts.ts`: a file called "prompts" holding no prompt is
 * exactly the stale signpost this whole change exists to remove.
 */

export type PracticeQuestionType =
  | 'multiple-choice'
  | 'practice-to-native'
  | 'native-to-practice'
  | 'fill-the-blank'
  | 'vocab-matching'
  | 'listen-and-pick'
  | 'listen-and-fill'
  | 'listen-and-write'
  | 'find-the-mistake';

export type MCSlotType =
  | 'multiple-choice'
  | 'practice-to-native'
  | 'native-to-practice'
  | 'listen-and-pick';

/** A saved card as the planner sees it. Travels in the planner prompt spec. */
export type PracticePlannerCard = {
  id: string;
  phrase: string;
  translation: string;
  topic?: string;
};
