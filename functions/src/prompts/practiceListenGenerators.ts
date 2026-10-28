/**
 * Listening-question prompt builders — `listen-and-fill` (user sees a
 * blanked sentence + hears full audio + types the missing word) and
 * `listen-and-write` (user only hears audio + types the full text).
 *
 * Split out of `practiceGeneration.ts` so the active pipeline module
 * stays under the per-file LOC budget. Mirrors the corresponding
 * Python harnesses in
 * `tests/prompts/practice-generator-listen-fill/run-tests.py` and
 * `tests/prompts/practice-generator-listen-write/run-tests.py`.
 */
import { generatorSiPrefix, noVocabListRule, scenarioWeavingRule } from "./practiceGeneration";

export function listenFillGeneratorSystemInstruction(
  practice: string,
  native: string,
): string {
  return `${generatorSiPrefix(practice, native, "listen-and-fill")}

TYPE: listen-and-fill
- User SEES a ${practice} sentence with exactly one '___' blank.
- User HEARS the full ${practice} sentence including the missing word.
- User TYPES the missing word.

RULES:
- practiceText: ${practice} sentence with EXACTLY one '___' (three underscores) where the target word goes.
- correctAnswer: the missing word (a single token, lowercase unless proper noun). When substituted into practiceText it must produce the natural full sentence the audio plays.
- Target word = flashcard.phrase (or its most natural inflected form in the sentence).
- Surrounding words must be simpler than the target — blank is the only challenge.
- instruction (${native}): short cue like "Listen and fill in the missing word." — no ${practice}.
- explanation (${native}): restate the full sentence, translate it, note pronunciation or spelling pitfalls. ${noVocabListRule(native)}

${scenarioWeavingRule(practice, native)}

THINKING STEPS — fill \`thinking\`, 1 sentence each:
  step "interpret": identify target word and its inflected form if any.
  step "compose": full sentence (to be spoken) + its ___-blanked version (to be shown).
  step "self-check": exactly one ___? correctAnswer fills blank naturally? instruction has no ${practice}?

OUTPUT SCHEMA (enforced):
{
  "thinking":    [{"step": "...", "reasoning": "..."}, ...],
  "instruction": "${native} task cue",
  "practiceText": "${practice} sentence with ___ (shown to user)",
  "correctAnswer": "${practice} word (fills the blank)",
  "explanation": "${native} explanation"
}`;
}

export function listenWriteGeneratorSystemInstruction(
  practice: string,
  native: string,
): string {
  return `${generatorSiPrefix(practice, native, "listen-and-write")}

TYPE: listen-and-write
- User hears the ${practice} text played as audio.
- UI HIDES the text — user must type what they heard.
- No visible hint, no options.

RULES:
- correctAnswer: the EXACT ${practice} text the user should type. Use flashcard.phrase when it fully captures the target; otherwise produce a short ${practice} sentence naturally containing the target concept.
- practiceText: equals correctAnswer (UI will play this text as audio and hide it).
- instruction (${native}): short cue like "Write what you hear." — no ${practice} inside.
- explanation (${native}, 1-3 sentences): restate the phrase, translate it, note any tricky pronunciation or spelling. ${noVocabListRule(native)}

${scenarioWeavingRule(practice, native)}

THINKING STEPS — fill \`thinking\`, 1 sentence each:
  step "interpret": identify the target phrase to be spoken.
  step "draft": write the exact phrase + instruction + explanation.
  step "self-check": practiceText == correctAnswer? instruction has no ${practice}? phrase matches spec?

OUTPUT SCHEMA (enforced):
{
  "thinking":    [{"step": "...", "reasoning": "..."}, ...],
  "instruction": "${native} task cue",
  "practiceText": "${practice} text (same as correctAnswer — UI hides it)",
  "correctAnswer": "${practice} text",
  "explanation": "${native} explanation"
}`;
}

export const FREE_TEXT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    intent: { type: "STRING" },
    instruction: { type: "STRING" },
    practiceText: { type: "STRING" },
    correctAnswer: { type: "STRING" },
    explanation: { type: "STRING" },
  },
  required: [
    "intent",
    "instruction",
    "practiceText",
    "correctAnswer",
    "explanation",
  ],
};
