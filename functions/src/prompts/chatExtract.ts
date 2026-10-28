/**
 * Source-of-truth copy of the chat-import flashcard extraction prompt.
 * Mirrored byte-for-byte by `src/lib/chatImportPrompts.ts` on the client.
 * `prompts.test.ts` (TODO if drift becomes a problem) asserts the two
 * stay in lockstep; the harness loads its SI from this side via
 * `scripts/build-prompts.mjs` → `tests/prompts/.dumps/`.
 */

import { difficultyLevelGuide } from "./explain";

export const MAX_CANDIDATES = 20;

export type ExtractMessage = {
  text: string;
  language: string;
  messageId: string;
  chatId: string;
};

/**
 * PRACTICE-IMPORT-25 — the level band appended to the SI. Three bands, not
 * seven: the exact level is still NAMED (from `difficultyLevelGuide`, the
 * server's level table) for finer pitch. `level` must already be an integer
 * 1–7 — the spec builder validates and clamps it (PRACTICE-IMPORT-26).
 */
export function chatExtractLevelBlock(level: number): string {
  const band =
    level <= 2
      ? "BEGINNER: prefer everyday words and short, common phrases the learner will reuse constantly (greetings, set phrases, high-frequency verbs and nouns). Skip anything niche, rare, slangy or idiomatic."
      : level <= 4
        ? "INTERMEDIATE: prefer useful verbs, collocations and everyday idioms that stretch the learner a little. Skip the most basic words (greetings, numbers, the commonest nouns) unless the learner clearly lacks them."
        : "ADVANCED: prefer nuanced, idiomatic or less common expressions — idioms, phrasal or separable verbs, colloquialisms, register-specific or precise vocabulary. Skip basics the learner surely knows (greetings, numbers, common nouns and verbs); return fewer candidates rather than padding with basics.";
  return `LEARNER LEVEL: ${level} of 7 (${difficultyLevelGuide(level)})
Pitch every candidate at this level. ${band}`;
}

export function chatExtractSystemInstruction(
  practice: string,
  native: string,
  level?: number,
): string {
  const levelBlock = level === undefined ? "" : `\n\n${chatExtractLevelBlock(level)}`;
  return `You extract candidate flashcards from a ${native}-speaking learner's recent ${practice} chat messages. Your job is to surface up to ${MAX_CANDIDATES} HIGH-QUALITY (phrase, translation) pairs the learner has been exposed to but doesn't yet have in their deck.

WHAT TO EXTRACT:
- Single words: useful vocabulary (verbs, nouns, adjectives, adverbs). Skip articles, particles, copulas, common pronouns ("the", "a", "is", "I" — not flashcard material).
- Multi-word phrases (2-5 words): collocations, idioms, common turn-of-phrase. These are usually the highest-value flashcards.
- Conjugated/inflected forms ONLY if the form itself is the learning concept (e.g. the past tense of an irregular verb). Otherwise prefer the base form.

QUALITY BAR:
- The pair must be SOMETHING THE LEARNER WOULD WANT TO LEARN — not trivia. A proper noun ("Madrid") is rarely useful. A common-sense phrase ("good morning") is fine but obvious — only include if the learner clearly hasn't seen it.
- The translation must be ACCURATE for the source context. If the same word means different things in two messages, pick the most common one and reference one of the source messages in \`context\`.
- DEDUPE against the EXCLUDE list — if a phrase is in there, the learner already has it and we MUST NOT propose it.
- DEDUPE within your own output — never emit the same phrase twice.

CONTEXT FIELD:
- A short (≤200-char) snippet of the source message in ${practice}, with the candidate phrase NOT removed/obscured (the learner sees the snippet beside the new card).
- If the candidate is a multi-word phrase, the snippet should be the natural sentence it appeared in.

OUTPUT SCHEMA (return ONLY this JSON):
{
  "candidates": [
    {
      "phrase":          "${practice} word or phrase",
      "translation":     "${native} translation",
      "context":         "short ${practice} snippet showing the phrase in use",
      "sourceMessageId": "id from MESSAGES block, optional"
    }
  ]
}

RULES:
- 5-${MAX_CANDIDATES} candidates ideal. Return [] if there's nothing genuinely worth surfacing.
- Order roughly by usefulness (most useful first). Do NOT order alphabetically.
- RECURRING phrases first: a word or phrase that comes up in several messages (or several chats) is worth more than one seen once. Rank those first, and when you have more good candidates than you can return, keep the recurring ones.
- NEVER include items in the EXCLUDE list.
- NEVER fabricate phrases that don't appear in the MESSAGES block.${levelBlock}`;
}

export type ExtractPromptInput = {
  practice: string;
  native: string;
  messages: ExtractMessage[];
  existingPhrases: string[];
};

export function buildChatExtractUserPrompt(input: ExtractPromptInput): string {
  const msgLines = input.messages
    .map((m, idx) => `  [${idx + 1}|id:${m.messageId}] ${m.text}`)
    .join("\n");
  const messagesBlock = input.messages.length
    ? `MESSAGES (most recent first, in ${input.practice}):\n${msgLines}`
    : "MESSAGES: (none)";

  const excludeLines = input.existingPhrases
    .slice(0, 200) // PRACTICE-IMPORT-13 — the client also caps the bytes
    .map((p) => `  - ${p}`)
    .join("\n");
  const excludeBlock = input.existingPhrases.length
    ? `EXCLUDE (already in deck — never propose):\n${excludeLines}`
    : "EXCLUDE: (deck is empty)";

  return `Extract flashcard candidates from a ${input.native} speaker's recent ${input.practice} chat messages.

${messagesBlock}

${excludeBlock}

Return up to ${MAX_CANDIDATES} candidates, ordered by usefulness.`;
}

export const CHAT_EXTRACT_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    candidates: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          phrase: { type: "STRING" },
          translation: { type: "STRING" },
          context: { type: "STRING" },
          sourceMessageId: { type: "STRING" },
        },
        required: ["phrase", "translation"],
      },
    },
  },
  required: ["candidates"],
};
