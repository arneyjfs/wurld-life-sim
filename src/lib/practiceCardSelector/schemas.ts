/**
 * Card-selector LLM response schema (PRACTICE-PLAN-30, v2).
 *
 * The selector's only job is the deck-analysis step:
 *   - pick the topics the session should focus on (selectedTopics)
 *   - explain the signals behind that pick (intelligentCards)
 *
 * Session framing — title, subtitle, description, scenario — moved to
 * the planner (PRACTICE-PLAN-40+). The planner sees the final slot
 * shape and is the right entity to decide whether a scenario fits.
 */
import { z } from 'zod';

/** Visual kinds the LessonIntro TipCard renderer knows about.
 *  Adding one here requires a matching case in the renderer + an icon. */
export const CARD_KINDS = [
  'struggle',
  'recent',
  'weakest',
  'fresh',
  'due',
  'requested',
] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/** UI bounds for the NORMALISED payload (PRACTICE-PLAN-46). */
export const MAX_INTELLIGENT_CARDS = 4;
export const MAX_CONTEXT_CHARS = 280;
/** Outside ALLOCATE only — ALLOCATE echoes the user's chips however many. */
export const MAX_SELECTED_TOPICS = 6;

export const ZIntelligentCard = z.object({
  kind: z.enum(CARD_KINDS),
  /** Canonical English topic name. Optional so cross-topic kinds
   *  (e.g. 'due' = "10 cards due across your deck") don't have to pin
   *  to a single topic. */
  topic: z.string().optional(),
  /** Short LLM-written paragraph (≤ 2 sentences) explaining the
   *  signal — what the user has been struggling with, what's been
   *  added recently, etc. Native-language. */
  context: z.string().min(1).max(MAX_CONTEXT_CHARS),
});
export type IntelligentCard = z.infer<typeof ZIntelligentCard>;

/**
 * PRACTICE-PLAN-46 — what the model may SEND, mirrored exactly from the
 * server's `CARD_SELECTOR_RESPONSE_SCHEMA` (functions/src/prompts/
 * practiceCardSelector.ts, PRACTICE-OWN-10). No count or length bounds,
 * because the server schema has none and Gemini is therefore free to exceed
 * them: the ALLOCATE prompt itself asks for one card per picked chip and a
 * verbatim echo of the chips, so 5+ chips used to fail `max(4)` and 7+ chips
 * `max(6)` — and every such rejection reached the user as "Network issue".
 * The bounds the UI needs are applied by `normaliseSelectorResponse`, which
 * produces a `CardSelectorResponse`. `schemas.test.ts` pins this against the
 * server module itself.
 */
export const ZCardSelectorWire = z.object({
  intelligentCards: z.array(
    z.object({
      kind: z.enum(CARD_KINDS),
      topic: z.string().optional(),
      context: z.string(),
    }),
  ),
  selectedTopics: z.array(z.string()),
});
export type CardSelectorWire = z.infer<typeof ZCardSelectorWire>;

/**
 * The NORMALISED selector payload consumers read (LessonIntro, the planner).
 * Never parsed off the wire directly — see `ZCardSelectorWire`.
 */
export const ZCardSelectorResponse = z.object({
  /** Per-topic explanation cards rendered as TipCards. 1-4 items. */
  intelligentCards: z.array(ZIntelligentCard).min(1).max(MAX_INTELLIGENT_CARDS),
  /** Topics the deterministic card curator should pull from. Subset of
   *  manifest.perTopic[].name. In ALLOCATE mode the LLM is told to
   *  echo `topicFilter` verbatim — the client still validates.
   *
   *  PRACTICE-PLAN-38 — EMPTY IS LEGAL, and it carries meaning. On the INTENT
   *  path "no deck topic serves what they asked for" is the correct answer,
   *  and the session is then written for the topic instead of assembled from
   *  the deck. A `min(1)` here forced the model to name something, and the
   *  something it named became the session — which is how a request about
   *  adjective placement came back as a quiz on food and family.
   *
   *  PRACTICE-PLAN-46 — no `max` here: in ALLOCATE the list is the user's
   *  chips, however many they picked. Outside ALLOCATE the normaliser caps it
   *  at MAX_SELECTED_TOPICS. */
  selectedTopics: z.array(z.string()),
});
export type CardSelectorResponse = z.infer<typeof ZCardSelectorResponse>;
