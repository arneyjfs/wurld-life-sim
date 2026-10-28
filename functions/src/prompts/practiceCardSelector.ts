/**
 * PRACTICE-OWN-2 — the SERVER-OWNED copy of the card-selector's system
 * instruction + user prompt. This is now the live one.
 *
 * It was `src/lib/practiceCardSelector/prompt.ts`, built in the client and
 * sent up the wire on every practice build — which meant any authenticated
 * caller could hand `geminiGenerate` whatever prose they liked and have it run
 * on this project's key. `practiceSpec.ts` closes that by taking DATA (the
 * topic manifest is aggregate counts the server can validate, plus the user's
 * own intent string) and assembling the text here; the client copy is being
 * retired.
 *
 * THE STRINGS ARE BYTE-IDENTICAL BY CONSTRUCTION. This file was produced by
 * copying the client module verbatim and editing nothing but the import block
 * — the type-only `TopicManifest` import became a local declaration, because
 * functions/ is a separate build and the client's `topicManifest.ts` reaches
 * into `@/types/firestore` for the deck-summarising helper we do not want
 * here. Prompt prose, whitespace, punctuation, and the `JSON.stringify(…, null,
 * 2)` key ORDER in the user prompt are untouched, so the model sees exactly
 * what it saw before the move. Keep it that way: any edit to the text below is
 * a prompt change and owes `npm run test:prompts` before deploy.
 *
 * Original module docs follow.
 *
 * Card-selector LLM prompt (PRACTICE-PLAN-30 v2).
 *
 * The selector's ONE job: deck analysis. It picks the topics the
 * session should focus on and explains the signals behind that pick
 * as `intelligentCards[]`. Session framing (title, subtitle,
 * description, scenario) is owned by the planner — see
 * `streamingPlannerPrompts.ts`.
 *
 * Two branches:
 *   PICK     — no user-imposed topic filter. The model chooses 2-4
 *              topics from the manifest based on accuracy / due /
 *              recency / anti-repeat.
 *   ALLOCATE — the manifest carries a non-empty `topicFilter`. The
 *              model echoes those topics verbatim into selectedTopics
 *              and emits one or more `requested` intelligentCards.
 *
 * The model is told the practice + native language pair so it writes
 * `intelligentCards.context` in the native language (the UI language).
 */
/** Local declaration of the client's `practiceCardSelector/topicManifest.ts`
 *  `TopicManifest` — the per-topic deck summary the selector consumes. Same
 *  shape, no cross-package import; the manifest is BUILT on the client (it
 *  needs the loaded deck) and travels in the practice prompt spec. */
export type TopicManifest = {
  /** Total cards considered (after the language filter). */
  totalCards: number;
  /** The practice language this manifest is scoped to. */
  language: string;
  /** Overall correct/total over the rolling stats window. Null if no
   *  attempts logged yet — the selector treats null as "cold-start". */
  overallAccuracy: number | null;
  /** Cards whose nextReviewAt is in the past (or unset). Aggregate
   *  number, not the ids. */
  dueCount: number;
  /** Per-topic summaries — sorted by `count` descending. */
  perTopic: TopicSummary[];
  /** Pre-selected topics from the start screen's multi-select chips.
   *  Empty array means "no constraint — the selector may PICK". */
  topicFilter: string[];
};

export type TopicSummary = {
  /** Canonical English topic key. */
  name: string;
  /** Cards tagged with this topic, after the manifest's language filter. */
  count: number;
  /** Mean accuracy across the topic's cards' lifetime attempts. */
  accuracyMean: number | null;
  /** Population standard deviation of the per-card accuracies. */
  accuracyStd: number | null;
  /** Card-count breakdown by `createdAt` recency. */
  recency: {
    fresh: number;
    recent: number;
    older: number;
  };
  /** Cards in this topic with nextReviewAt in the past or unset. */
  dueCount: number;
};

export function cardSelectorSystemInstruction(
  practice: string,
  native: string,
): string {
  return `You are the CARD SELECTOR for a language practice session.

The user is learning ${practice}; their NATIVE language is ${native}.
ALL prose in intelligentCards.context MUST be in ${native}.
Topic NAMES in selectedTopics + intelligentCards.topic stay in their canonical English form (the deck stores them that way).

SCOPE — this call ONLY decides the deck-level filters. Do NOT write a title, subtitle, description, or scenario; do NOT describe the upcoming session. The PLANNER (next stage) sees the cards you select and decides those things. You produce exactly two fields:

1. selectedTopics — the topics the session will focus on. In INTENT mode, only the topics that serve the request (possibly none); 2-4 topics in PICK mode; in ALLOCATE mode echo the manifest's topicFilter verbatim.
2. intelligentCards — 1-4 TipCards that name the specific signals behind the pick. The user reads these while the planner runs, so they should be concrete and specific (cite accuracy %, card counts, recency).

CARD KINDS (use as appropriate to the data):
  struggle  — a topic with low accuracy and enough attempts to trust. Include the topic + the accuracy %.
  weakest   — the SINGLE lowest-accuracy topic with enough attempts. Include the topic + the accuracy %.
  recent    — topic was practised in a recent session and could use reinforcement. Include the topic.
  fresh     — topic has cards added in the last 7 days. Include the topic + the card count.
  due       — N cards are SRS-due for review (cross-topic). Omit topic. Include the count.
  requested — ALLOCATE mode only: user picked these topics directly. Include the topic.

INTENT PATH (userIntent is a non-empty string, and manifest.topicFilter is empty) — CHECK THIS BEFORE THE PICK PATH:
  The user asked for something SPECIFIC, in their own words. It may have been typed on the start screen, or distilled by the in-chat tutor from a conversation ("French adjectives that are placed before the noun", "the ser vs estar distinction"). Serve THAT and nothing else.
  - selectedTopics = ONLY the deck topics that genuinely serve the request. Judge by MEANING, not by string overlap.
  - Returning an EMPTY array is a correct, expected answer, and often the right one. If the deck has nothing that serves the request, say so by returning none — the session is then built from questions written for the topic, which is exactly what the user asked for. An empty deck intersection is NOT a failure and NOT something to paper over.
  - Do NOT substitute the nearest available topic. Do NOT pad toward 2-4. Do NOT apply the PICK path's variety or anti-repeat rules — none of them apply here. Adding a topic the user did not ask for is the single worst thing you can do on this path: it dilutes a specific request into a general review, and the user notices immediately because most of the session is then about something else.
  - A deck topic counts as serving the request only if a question drawn from it would teach the thing asked for. "Food" does not serve "adjective placement" merely because food cards contain adjectives.
  - intelligentCards: one "requested" card naming what they asked for. If some of the deck feeds it, say which topic and how many cards; if none does, say the session is being written for the topic instead.

PICK PATH (manifest.topicFilter is empty AND userIntent is empty):
  - Weigh signals: low accuracyMean, high dueCount, recency.fresh > 0.
  - RECENCY (load-bearing): manifest.recentTopics lists the topics from the user's IMMEDIATELY PREVIOUS session. DO NOT pick those again. If the only weak topics overlap with recentTopics, pick a different topic that's "next-weakest" OR a topic with high dueCount instead — anything to avoid repeating the previous session's focus. Two sessions back-to-back with the same topics is the worst-case UX; we'd rather show a slightly less-targeted session that feels fresh.
  - Aim for 2-4 selectedTopics. Prefer variety over hammering the single weakest.
  - intelligentCards explain WHY: e.g. one "weakest" card naming the topic and accuracy, one "fresh" card naming the new arrivals, one "due" card with the SRS count is a balanced read.

ALLOCATE PATH (manifest.topicFilter has values):
  - selectedTopics MUST equal manifest.topicFilter verbatim — the client overwrites yours with the filter if you stray.
  - intelligentCards: one "requested" card per topic, OR a single combined one. If a chosen topic is also the user's weakest, layer in a second card noting that — useful signal.

COLD-START (manifest.totalCards small or overallAccuracy null):
  - Lean on fresh/recent kinds; cite the card counts.
  - Pick whatever topics exist; if only one topic is present, return one.

intelligentCards.context style — one specific sentence, ${native}-language, naming a number where one is available. Examples:
  • good (weakest): "Food at 38% — your lowest topic with 12 cards attempted."
  • good (due): "8 cards across your deck are due for review."
  • good (fresh): "5 greetings cards added in the last week — fair game."
  • avoid: "We're focusing on grammar." (no specifics)
  • avoid: "This session will help you learn." (planner's job, not yours)`;
}

export function buildCardSelectorUserPrompt(
  manifest: TopicManifest,
  opts: {
    /** Topics from the user's PREVIOUS session (or empty). Used for the
     *  PICK path's anti-repeat constraint. */
    recentTopics: string[];
    /** Free-text intent from PracticeStartScreen, if any. Empty string
     *  if not set. */
    intent: string;
  },
): string {
  // Precedence: explicit chips beat free text. A user who picked topics in
  // Advanced has said which topics in the only unambiguous way available, so
  // the intent (if any) narrows within them rather than replacing them.
  const isAllocate = manifest.topicFilter.length > 0;
  const isIntent = !isAllocate && opts.intent.trim().length > 0;
  return JSON.stringify(
    {
      mode: isAllocate ? 'ALLOCATE' : isIntent ? 'INTENT' : 'PICK',
      manifest: {
        language: manifest.language,
        totalCards: manifest.totalCards,
        overallAccuracy: manifest.overallAccuracy,
        dueCount: manifest.dueCount,
        topicFilter: manifest.topicFilter,
        perTopic: manifest.perTopic.map((t) => ({
          name: t.name,
          count: t.count,
          accuracyMean: t.accuracyMean,
          accuracyStd: t.accuracyStd,
          recency: t.recency,
          dueCount: t.dueCount,
        })),
      },
      recentTopics: opts.recentTopics,
      userIntent: opts.intent,
    },
    null,
    2,
  );
}

/**
 * PRACTICE-OWN-10 — the selector's response schema, moved here to sit with the
 * prompt it constrains.
 *
 * It was the ONE practice schema with no server copy at all: the prompt moved
 * under PRACTICE-OWN-2 and the schema stayed in
 * `src/lib/practiceCardSelector/schemas.ts`, so the half that decides what the
 * model may SAY was still shipping in the bundle after the half that decides
 * what it is ASKED had left.
 *
 * `type` is lower-case here and upper-case in the generator schemas. Both ship
 * today and Gemini accepts both; the case is left exactly as it was, because
 * normalising it would be an unmeasured edit to a working schema on a path
 * whose only eval suite does not exist yet (PRACTICE-OWN-7, known gap).
 *
 * `ZCardSelectorResponse` stays client-side and keeps validating the response —
 * the schema constrains the model, the Zod parse defends against it. Those are
 * different jobs and belong on different sides of the wire.
 */
export const CARD_KINDS = [
  "struggle",
  "recent",
  "weakest",
  "fresh",
  "due",
  "requested",
] as const;

export const CARD_SELECTOR_RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    intelligentCards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          kind: { type: "string", enum: [...CARD_KINDS] },
          topic: { type: "string" },
          context: { type: "string" },
        },
        required: ["kind", "context"],
      },
    },
    selectedTopics: { type: "array", items: { type: "string" } },
  },
  required: ["intelligentCards", "selectedTopics"],
};
