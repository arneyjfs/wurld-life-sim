/**
 * LIFE-CONTRACT-EX-3 (non-mutation): the bubble for a practised line
 * lands at resolution with the PLANNED line — never the player's
 * pick.
 *
 *   - Outbound (fill-blank): the planned line is the practicePrompt
 *     template with the CORRECT chip substituted into the blank,
 *     regardless of which chip the player picked. Wrong picks are
 *     pure teaching slips; the in-world utterance is always the
 *     correct form.
 *   - Inbound (comprehension): the NPC bubble carries the verbatim
 *     npcUtterance, regardless of pick.
 *
 * Extracted from LifeScreen.tsx so it can be unit-tested without
 * spinning up the screen.
 */
import type { StepChoice } from './stepSchema';
import { stripAttributionWrapper } from './utterance';

export type FeedbackForResolve = {
  outcomeKind: 'generation' | 'comprehension';
  /** Outbound: the template ("Je ___ un café"). Inbound: the
   *  verbatim NPC utterance. */
  promptSource: string;
  /** The chip marked `correctness: 'correct'` on the practice turn.
   *  Outbound: substituted into the template's blank to form the
   *  planned line. Inbound: unused (the npcUtterance IS the line). */
  correctAnswer: StepChoice;
  /** Inbound only: the NPC's display name + stable slug. The
   *  resolved bubble carries them so the UI can label the bubble
   *  and the persistent roster can promote on first sighting. */
  speakerName?: string | null;
  npcId?: string | null;
  /** LIFE-LANG-8/12: the resolved bubble's system-language gloss —
   *  fill-blank = `completedNativeText` (the full sentence with the
   *  blank filled), comprehension = `utteranceNativeText` (the faithful
   *  translation of the whole line). Populated post-answer (no leak — the
   *  answer is committed), so the resolved npc/user bubble is bilingual
   *  like every other dialogue bubble and obeys viewMode. `gradePick`
   *  passes `FeedbackState.sentenceNative`. Absent ⇒ practice-only. */
  nativeText?: string | null;
  /** LIFE-EX-VOCAB-3: `practicePrompt.lineVocab` — annotations for the line
   *  that is ABOUT to become a bubble, both directions. Comprehension had none
   *  at all; fill-blank had only the answer chip's, which covers one token
   *  while the bubble is the whole sentence. Reported as graded messages
   *  arriving with no tappable words. */
  lineVocab?: Record<string, string> | null;
};

export type ResolvedBubble = {
  id: string;
  speaker: 'npc' | 'user';
  speakerName?: string | null;
  npcId?: string | null;
  practiceText: string;
  nativeText: string | null;
  /** LIFE-BUBBLE-7: outbound only — the correct chip's annotations
   *  activate in the resolved user bubble. Inbound (comprehension)
   *  bubbles carry none (the gradedPlan has no annotations). */
  complexWords?: string[];
  wordTranslations?: Record<string, string>;
};

export function buildResolvedBubble(
  fb: FeedbackForResolve,
  now: number = Date.now(),
): ResolvedBubble {
  if (fb.outcomeKind === 'comprehension') {
    // LIFE-CONTRACT-BUBBLE-4: the planned utterance lands in an NPC bubble
    // verbatim, so strip any narrator wrapper the planner wrote around it.
    const rep = stripAttributionWrapper(fb.promptSource);
    return {
      id: `inbound-${now}`,
      speaker: 'npc',
      speakerName: fb.speakerName ?? null,
      npcId: fb.npcId ?? null,
      practiceText: rep.text,
      // LIFE-LANG-12: the faithful translation of the utterance, so the
      // revealed NPC bubble is bilingual like every other npc bubble.
      nativeText: fb.nativeText ?? null,
      // LIFE-EX-VOCAB-3: the utterance is a full practice-language line and is
      // the densest thing in a comprehension turn — it used to land with no
      // tappable words at all. `complexWords` is derived from the keys, same
      // contract as a beat (LIFE-COST-5).
      ...(fb.lineVocab && Object.keys(fb.lineVocab).length > 0
        ? { complexWords: Object.keys(fb.lineVocab), wordTranslations: fb.lineVocab }
        : {}),
    };
  }
  const userPracticeText = fb.promptSource.replace(
    /_{2,}/,
    fb.correctAnswer.practiceText,
  );
  return {
    id: `outbound-${now}`,
    speaker: 'user',
    practiceText: userPracticeText,
    // LIFE-LANG-6: the completed-sentence translation, so the player's
    // resolved bubble carries its gloss (bilingual, viewMode-aware).
    nativeText: fb.nativeText ?? null,
    // LIFE-EX-VOCAB-3: the COMPLETED sentence's annotations when the generator
    // supplied them. The chip's own gloss covers the answer token only, so it
    // annotated one word of a full line — kept as the fallback for responses
    // authored before `lineVocab` existed.
    complexWords: fb.lineVocab
      ? Object.keys(fb.lineVocab)
      : fb.correctAnswer.complexWords,
    wordTranslations: fb.lineVocab ?? fb.correctAnswer.wordTranslations,
  };
}
