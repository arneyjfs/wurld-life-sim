/**
 * PRACTICE-OWN-3 — the SERVER-OWNED copy of the streaming planner's system
 * instruction + user prompt. This is now the live one.
 *
 * It was `src/lib/practiceGenerator/streamingPlannerPrompts.ts`, built in the
 * client and sent up the wire on every practice build — which meant any
 * authenticated caller could hand `geminiStreamV2` whatever prose they liked
 * and have it run on this project's key. `practiceSpec.ts` closes that by
 * taking DATA and assembling the text here; the client copy is being retired.
 *
 * THE STRINGS ARE BYTE-IDENTICAL BY CONSTRUCTION. This file was produced by
 * copying the client module verbatim and editing nothing but the import block
 * — the type-only `@/`-aliased imports became local declarations (functions/
 * is a separate build with no `@/` alias) and `levelLabel` now comes from this
 * package's own `practiceGeneration.ts`. Prompt prose, whitespace, punctuation
 * and template structure are untouched, so the model sees exactly what it saw
 * before the move and the existing eval suites remain valid. Keep it that way:
 * any edit to the text below is a prompt change and owes `npm run
 * test:prompts` before deploy.
 *
 * Original module docs follow.
 *
 * Streaming planner SI + user prompt (PRACTICE-PLAN-40).
 *
 * The planner owns SESSION FRAMING — title, description, and the
 * scenario decision. The card selector (upstream) has already picked
 * the topics + intelligentCards; the planner sees the curated card
 * list, decides whether a SCENARIO fits across the slots, and threads
 * it through every slot.prompt that can carry it. When no scenario
 * fits naturally, it skips and writes generic framing.
 *
 * Output is XML, streamed. Header tags (title/description) land first
 * so LessonIntro can paint incrementally; slots stream after. The card selector's `intelligentCards[]` is rendered
 * alongside the streaming header — the planner is told what those
 * cards say so its description can complement them without overlap.
 */
import { levelLabel, type PracticeQuestionType } from "./practiceGeneration";

export type { PracticeQuestionType };

/** Local declaration of the client's `practiceGenerator/prompts.ts`
 *  `PracticePlannerCard` — same shape, no cross-package import. */
export type PracticePlannerCard = {
  id: string;
  phrase: string;
  translation: string;
  topic?: string;
};

/** Local declaration of `z.infer<typeof ZIntelligentCard>` from the client's
 *  `practiceCardSelector/schemas.ts`. Structural copy only — validation of the
 *  selector's response still happens against the zod schema on the client. */
export type IntelligentCard = {
  kind: 'struggle' | 'recent' | 'weakest' | 'fresh' | 'due' | 'requested';
  topic?: string;
  context: string;
};

const TYPE_GUIDE: Record<PracticeQuestionType, string> = {
  'multiple-choice':
    'versatile — short word/phrase comprehension, good default',
  'practice-to-native': '{p} sentence → understand meaning in {n}',
  'native-to-practice': '{n} cue → produce {p} word/phrase',
  'fill-the-blank': 'short {p} sentence with target word missing',
  'vocab-matching':
    '4-6 atomic vocab pairs, emitted inline as <pair left="..." right="..."/> children',
  'listen-and-pick': 'aural discrimination — hear {p}, pick meaning',
  'listen-and-fill': 'hear {p} sentence, type the missing word',
  'listen-and-write': 'hear {p}, write what you heard',
  'find-the-mistake':
    'sentence-level error detection — needs a well-formed but wrong {p} sentence',
};

export function streamingPlannerSystemInstruction(
  practice: string,
  native: string,
): string {
  return `You plan ${practice} practice lessons for a ${native}-speaking learner. You produce an XML plan that drives both the lesson-intro framing AND the per-question slot specs. The slots feed downstream generators that write the actual question text.

OUTPUT FORMAT — well-formed XML, no markdown fence, no leading prose. Emit elements IN THIS EXACT ORDER so the client can paint the lesson-intro incrementally as your stream arrives:

<plan>
  <title>3-6 words, ${native}</title>
  <description>1-2 sentences in ${native} — see DESCRIPTION RULE below</description>
  <slot type="QUESTION_TYPE" cardId="SAVED_ID_OR_GENERATED">
    <prompt>${native} sentence describing what to test (see SLOT PROMPT RULE)</prompt>
    <flashcard cardId="SAVED_ID" phrase="${practice} word" translation="${native} word"/>
    <!-- vocab-matching only: include 4-6 <flashcard/> entries AND 4-6 <pair/> entries -->
  </slot>
  ...more <slot> blocks...
</plan>

ATTRIBUTE ENCODING: use HTML entities inside attribute values — &amp; &lt; &gt; &quot; &apos;. Inside <prompt> and other text children you can use them too OR write literally if no XML metacharacter appears.

SCENARIO DECISION (do this FIRST, before writing title/description):
The card selector has chosen the topics; you now decide whether a SCENARIO can naturally hold the session together. A scenario is a single real-world situation the user can imagine themselves in — "ordering at a café", "checking in at the airport", "passing a job interview", "buying groceries at a market", "small talk with a neighbour", "asking for directions in town", "video-calling a friend".
- Skim the SAVED CARDS + SELECTED TOPICS. Could you weave most of them naturally into ONE scenario? If yes, pick it. The scenario doesn't need to cover EVERY card — slots that don't fit can carry generic framing without the metaphor.
- If no scenario fits without forcing (e.g. the topics are "weather + numbers + chess vocabulary" — no natural shared situation), SKIP IT. Skipping is better than fabricating an awkward fit.
- Hard rule: NEVER force the scenario onto a card that doesn't fit. The pedagogy comes first; the scenario is a cohesion layer, not a constraint.

TITLE / DESCRIPTION:
- WITH a scenario picked:
  • title — the scenario name, 3-6 words. e.g. "Café conversation", "Airport check-in", "Coffee chat with Marie", "Asking directions in Lyon".
  • description — 1-2 sentences ${native}. Anchor the scenario AND nod to WHY these topics: "You're at a café in Paris and need to order. We picked this because your food vocab is your weakest topic, and you have several greetings cards due."
- WITHOUT a scenario:
  • title — generic but specific to the focus, 3-6 words. e.g. "Grammar refresher", "Food vocab review", "Weak-spot drill".
  • description — 1-2 sentences ${native} nodding to WHY. "Focused on the topics where your accuracy has been lowest." NEVER restate what the IntelligentCards already say in numerical detail — those render alongside your description. Stay qualitative; the cards have the numbers.

The user reads your title → description while the cards render alongside. Don't repeat the same point twice in two voices.

SLOT PROMPT RULE — slot.prompt is INTERNAL briefing for the per-type generator (the user NEVER sees it). Two cases:
- With a scenario AND the slot fits → start slot.prompt with the scenario anchor, then the test target. Bad: \`Test the verb "commander".\` Good: \`At the café, the user wants to order a coffee — test the verb "commander".\`. The downstream generator weaves the anchor into the user-facing instruction so the question reads as part of the scenario.
- Without a scenario OR with a slot that doesn't fit → write the slot.prompt plainly: \`Test the meaning of "commander".\`.

SLOT BUDGET (non-negotiable — DEFAULT path): when USER INTENT is unset, the SLOT LAYOUT line specifies the EXACT total slot count AND the EXACT card-based / generated split. Honour both numbers literally. (card-based slots) + (generated slots) MUST equal the requested total, and each subtotal MUST match exactly.

OVERRIDE PATH (ONLY when USER INTENT is set + signals a deviation):
- COUNT OVERRIDE: if USER INTENT names an explicit question count (e.g. "give me 15 questions"), emit EXACTLY that many slots — IGNORE the SLOT LAYOUT default count. Hard ceiling: 20.
- CARD MIX OVERRIDE: if USER INTENT signals fresh content ("all new vocabulary"), set every slot to cardId="generated". If it signals existing deck only, bias slots toward card-based.
- When USER INTENT is set but doesn't override count or mix, the SLOT LAYOUT default still binds.

EMPTY-DECK FALLBACK: when SAVED CARDS is "(none)", ALL slots are generated regardless. Build a sensible starter session.

SELECTED TOPICS: the card selector has chosen these. Pick cards from the SAVED CARDS list whose topic matches; shape generated slots around them. A slot may step outside the selected topics sparingly (e.g. a useful linker) when it genuinely serves the lesson.

CARDID RULES (apply to every slot):
- cardId is a SINGLE saved card id (e.g. "c1") OR the literal "generated". NEVER pipe-separated.
- For vocab-matching, set the slot-level cardId to the FIRST pair's saved card id (or "generated").
- A saved card id MUST NOT appear on more than one slot in the same session. If you've already used "c1" on a slot, use a different saved card or a "generated" slot for the next one — never re-test "c1" twice in the same lesson.

VOCAB-MATCHING IS SPECIAL: the planner emits the full set of pairs DIRECTLY in the slot — no downstream generator runs. Emit 4 to 6 <flashcard/> entries AND 4 to 6 <pair left="${practice} word" right="${native} match"/> entries. The phrases across the array must be unique.

For all OTHER slot types: exactly ONE <flashcard/> entry — the phrase+translation being tested.

LISTENING IS MANDATORY WHEN AVAILABLE: if ANY listen-* type appears in ALLOWED QUESTION TYPES (user prompt), you MUST include at least one listen question in the plan (aim for ~1 per 4-5 slots) — prefer listen-and-pick / listen-and-fill. Audio is enabled and listening practice is core; do NOT ship an all-reading session when listening is allowed.

Before emitting, mentally count slots and verify totals against the rules. If USER INTENT did not override count, the total must match SLOT LAYOUT.

Return ONLY the XML — no \`\`\`xml fence, no commentary outside <plan>.`;
}

export type PracticeStreamingPlannerInput = {
  practice: string;
  native: string;
  difficulty: number;
  cards: PracticePlannerCard[];
  count: number;
  cardCount: number;
  genCount: number;
  allowedTypes: PracticeQuestionType[];
  custom?: string;
  recentCardIds?: string[];
  recentTopics?: string[];
  strugglingTopics?: Array<{ topic: string; accuracy: number; total: number }>;
  strugglingChallenges?: Array<{ challenge: string; accuracy: number; total: number }>;
  dueCards?: string[];
  /** Selected topics from the card selector. The planner shapes the
   *  session around these. */
  selectedTopics?: string[];
  /** PRACTICE-PLAN-40: the card selector's `intelligentCards[]` — passed
   *  through so the planner KNOWS what signals the user is being shown
   *  alongside its <description>. Avoids two LLMs writing overlapping
   *  copy; the planner stays qualitative and lets the cards carry the
   *  numbers. */
  intelligentCards?: IntelligentCard[];
  /** PRACTICE-REVIEW-1: when true the user is retesting failed cards.
   *  Planner must emit exactly one slot per supplied card, no
   *  generated slots, no scenario fabrication. */
  reviewMode?: boolean;
};

export function buildStreamingPlannerUserPrompt(
  input: PracticeStreamingPlannerInput,
): string {
  const { level, label } = levelLabel(input.difficulty);
  const cardLines = input.cards
    .map(
      (c) =>
        `  - [id:${c.id}] "${c.phrase}" = "${c.translation}"` +
        (c.topic ? ` (topic: ${c.topic})` : ''),
    )
    .join('\n');
  const cardsBlock = input.cards.length
    ? `SAVED CARDS:\n${cardLines}\n`
    : 'SAVED CARDS: (none)\n';

  const typesList = input.allowedTypes.join(', ');
  const typeGuideLines = input.allowedTypes
    .map(
      (t) =>
        `  - ${t}: ${TYPE_GUIDE[t]
          .replace(/\{p\}/g, input.practice)
          .replace(/\{n\}/g, input.native)}`,
    )
    .join('\n');
  const customLine = input.custom ? `USER INTENT: ${input.custom}\n` : '';
  const selectedTopicsLine =
    input.selectedTopics && input.selectedTopics.length > 0
      ? `SELECTED TOPICS: ${input.selectedTopics.join(', ')}\n`
      : '';
  const intelligentCardsBlock = buildIntelligentCardsBlock(input.intelligentCards);
  // PRACTICE-REVIEW-1: review-mode prepends a load-bearing constraint.
  // The model produces ONE slot per card in SAVED CARDS, no generated
  // slots, no scenario invention. title/description acknowledge it's
  // a retest of the failed cards.
  const reviewModeBlock = input.reviewMode
    ? `REVIEW MODE (load-bearing — overrides SLOT BUDGET and SCENARIO DECISION):
The user just finished a practice session and is retesting the cards they got wrong. Constraints:
- Emit EXACTLY ${input.cards.length} slot(s) — one per card in SAVED CARDS, in order.
- EVERY slot has cardId from SAVED CARDS. NEVER cardId="generated" in review mode.
- DO NOT invent a scenario — there's no narrative arc, just a retest. <title> should read like "Retesting your mistakes" or "Quick retry"; <description> should be one short sentence acknowledging the retest.
- Vary the question type from the previous attempt where the allowed types support it (e.g. if the original was native-to-practice MC, prefer practice-to-native or fill-the-blank now) so the learner isn't just memorising the previous wrong answer's position.
- IGNORE the count in SLOT LAYOUT below — review mode uses the count above.

`
    : '';
  const contextBlock = buildContextBlock(input);

  const slotsParts: string[] = [];
  if (input.cardCount) {
    slotsParts.push(`${input.cardCount} card-based (cardId from list above)`);
  }
  if (input.genCount) {
    slotsParts.push(
      `${input.genCount} generated (cardId="generated", pick concepts that complement the cards)`,
    );
  }
  const slotsSpec = slotsParts.length
    ? slotsParts.join(' + ')
    : `${input.count} generated`;

  // PRACTICE-PLAN-7a: when listening is allowed, REQUIRE at least one listen
  // question — the planner otherwise defaults to an all-reading session.
  const hasListen = input.allowedTypes.some((t) => t.startsWith('listen-'));
  // PRACTICE-SKILL-7: a listening-only session (the user's question-type
  // filter) must not read the ratio hint as "only some slots listen".
  const onlyListen = hasListen && input.allowedTypes.every((t) => t.startsWith('listen-'));
  const listenLine = onlyListen
    ? `\nLISTENING ONLY: the user asked for a listening session — every slot must use one of the allowed listen-* types.`
    : hasListen
      ? `\nLISTENING REQUIRED: audio is enabled — include AT LEAST one listen-* question (prefer listen-and-pick / listen-and-fill), ~1 per 4-5 slots.`
      : '';

  return `Session context: ${input.native} speaker learning ${input.practice} at ${label} level (${level}/7).

${reviewModeBlock}${customLine}${selectedTopicsLine}${intelligentCardsBlock}${cardsBlock}${contextBlock}
SLOT LAYOUT: produce EXACTLY ${input.count} slots = ${slotsSpec}.
ALLOWED QUESTION TYPES: ${typesList}${listenLine}

TYPE GUIDE (pick what fits each concept):
${typeGuideLines}`;
}

/**
 * The card-selector intelligentCards array as the planner sees it.
 * Tells the planner WHAT the user is already reading alongside its
 * <description> so the two surfaces complement rather than overlap.
 */
function buildIntelligentCardsBlock(cards: IntelligentCard[] | undefined): string {
  if (!cards || cards.length === 0) return '';
  const lines = cards.map((c) => {
    const topicPart = c.topic ? ` (topic: ${c.topic})` : '';
    return `  - [${c.kind}]${topicPart}: ${c.context}`;
  });
  return `INTELLIGENT CARDS (rendered alongside your description — your description should NOT restate these in number form):\n${lines.join('\n')}\n`;
}

function buildContextBlock(input: PracticeStreamingPlannerInput): string {
  const lines: string[] = [];
  if (input.dueCards && input.dueCards.length > 0) {
    lines.push(`  due for review (favor): ${input.dueCards.slice(0, 30).join(', ')}`);
  }
  if (input.recentCardIds && input.recentCardIds.length > 0) {
    lines.push(
      `  RECENTLY TESTED cards — AVOID using these as card-based slots. Only fall back to one if the rest of the deck is exhausted: ${input.recentCardIds.slice(0, 20).join(', ')}`,
    );
  }
  if (input.recentTopics && input.recentTopics.length > 0) {
    lines.push(
      `  PREVIOUS SESSION'S TOPICS — DO NOT pick the same focus as the immediately previous session unless every other topic in the deck is also recent. If you would otherwise repeat, prefer fresh / generated content + flag this in <description> ("revisiting <topic> for spaced-repetition"). Previous: ${input.recentTopics.slice(0, 5).join(', ')}`,
    );
  }
  if (input.strugglingTopics && input.strugglingTopics.length > 0) {
    const struggling = input.strugglingTopics
      .map((s) => `${s.topic} (${Math.round(s.accuracy * 100)}% of ${s.total})`)
      .join(', ');
    lines.push(`  weakest topics (favor for revision): ${struggling}`);
  }
  if (input.strugglingChallenges && input.strugglingChallenges.length > 0) {
    const challenges = input.strugglingChallenges
      .map((c) => `${c.challenge} (${Math.round(c.accuracy * 100)}%)`)
      .join(', ');
    lines.push(`  weakest skills (favor matching question types): ${challenges}`);
  }
  if (lines.length === 0) return '';
  return `LEARNER CONTEXT:\n${lines.join('\n')}\n`;
}
