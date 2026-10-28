/**
 * LIFE-BENCH-6 — what the transcript records about a graded question.
 *
 * It used to record `prompt: JSON.stringify(q.practicePrompt).slice(0, 400)`
 * and `choices: string[]`. That drops three things, and they turn out to be
 * exactly the three the questions get asked about afterwards:
 *
 *   1. WHICH chip was correct — so "how often is the right answer first?" or
 *      "does the correct chip differ from the others by meaning or by form?"
 *      cannot be answered from the artefact at all.
 *   2. `whyWrong` per distractor — a REQUIRED field the generator is validated
 *      on (LIFE-EX-9), and the only record of what the distractor was FOR.
 *   3. Anything past the 400th character of the prompt. `completedNativeText`
 *      and `disambiguation` both sort late in `JSON.stringify` key order, and
 *      `completedNativeText` is the native anchor the whole of LIFE-EX-8.2
 *      turns on.
 *
 * The consequence, concretely: the LIFE-EX-8.2 analysis — *"was a native target
 * ever shown on a fill-blank?"* — had to be reconstructed from the raw Gemini
 * call log, because the transcript, which exists so that reconstruction is
 * unnecessary, could not answer a question about its own run.
 *
 * Same class as LIFE-BENCH-5's `freeText`: a value the harness is holding and
 * simply does not write down.
 *
 * Extracted into its own module for the same reason `playSeeds.ts` was:
 * `playWorld.ts` reaches Gemini, so anything asserted about it inline would
 * have to be a copy of the logic — a test that passes forever and catches
 * nothing.
 */
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';

/** One chip as the player would have seen it, with the verdict attached. */
export type CapturedChoice = {
  /** The chip face. Practice text where there is one, else the native gloss —
   *  a comprehension question's chips are native-language by construction. */
  text: string;
  /** `null` for a CYOA option set, where no chip is "correct" (LIFE-GRID). */
  correctness: 'correct' | 'wrong' | null;
  /** LIFE-EX-9. `null` on the correct chip and on anything that omitted it. */
  whyWrong: string | null;
};

export type CapturedGraded = {
  kind: string;
  target: string | null;
  line: string;
  /** The WHOLE prompt object, not a truncated JSON string. */
  prompt: PracticePrompt;
  choices: CapturedChoice[];
  /** LIFE-SPEECH-1. `outbound` = the player produces the line (fill-blank);
   *  `inbound` = the player interprets an NPC's (comprehension). */
  direction: 'outbound' | 'inbound';
  /** `client` = intercepted by `gradedSayPlan` off a `say` pick
   *  (LIFE-SPEECH-3); `model` = the step call authored a question node. */
  origin: 'client' | 'model';
};

/**
 * Post-generation, so what is written down is what a player would have been
 * shown: `runGradedQuestionGenerate` has already applied `applyGradedDirection`
 * and `shuffleChoices`, and the shuffle in particular is the whole reason chip
 * ORDER is worth recording — recording the pre-shuffle order would answer
 * "where does the model put the answer", which nobody sees.
 */
export function captureGraded(input: {
  kind: string;
  target: string | null;
  line: string;
  practicePrompt: PracticePrompt;
  choices: StepChoice[];
  direction: 'outbound' | 'inbound';
  origin: 'client' | 'model';
}): CapturedGraded {
  return {
    kind: input.kind,
    target: input.target,
    line: input.line,
    prompt: input.practicePrompt,
    choices: input.choices.map(capturedChoice),
    direction: input.direction,
    origin: input.origin,
  };
}

function capturedChoice(c: StepChoice): CapturedChoice {
  return {
    // `?? ''` and not `|| ''`: a chip whose practiceText is the empty string is
    // a defect worth seeing in the artefact, not one to paper over with the
    // gloss. `answerGloss` deliberately emits `nativeText: ""` on some paths.
    text: c.practiceText ?? c.nativeText ?? '',
    correctness: c.correctness ?? null,
    whyWrong: c.whyWrong?.trim() || null,
  };
}
