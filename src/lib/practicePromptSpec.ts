/**
 * PRACTICE-OWN-* / SRV-PROMPT-1 — the WIRE CONTRACT for prompts the server builds.
 *
 * The client sends one of these instead of prompt text; the server assembles
 * both the system instruction and the user prompt from its own copies
 * (`functions/src/prompts/practiceSpec.ts`) and ignores the body's `prompt` /
 * `systemInstruction` entirely. Everything here is either a scalar the server
 * re-validates or content the user already owns.
 *
 * Kept in its OWN module rather than in `gemini.ts` because the three shapes
 * pull types from three feature modules, and every one of those modules
 * imports `gemini.ts` back. Type-only imports would erase, but a value import
 * added later would close the cycle — this file has no runtime exports at all,
 * so it cannot.
 *
 * `kind` doubles as the telemetry category and the server REQUIRES the two to
 * be equal (PRACTICE-OWN-4), which is why each shape pins it to a literal.
 */
import type { IntelligentCard } from './practiceCardSelector/schemas';
import type { TopicManifest } from './practiceCardSelector/topicManifest';
import type { PracticePlannerCard, PracticeQuestionType } from './practiceGenerator/types';
import type { TimeOfDay } from '@/types/lifeState';

/** One per-slot generator call. `kind` is the per-slot-type telemetry bucket. */
export type PracticeGeneratorPromptSpec = {
  kind: string;
  spec: {
    type: string;
    /** The planner's briefing for this slot. Model-authored, carried not
     *  trusted — its blast radius is one slot of one session. */
    prompt: string;
    flashcard: { phrase: string; translation: string };
  };
  practice: string;
  native: string;
  difficulty: number;
};

/** The deck-analysis call that picks the session's topics. */
export type PracticeSelectorPromptSpec = {
  kind: 'practice_card_selector';
  practice: string;
  native: string;
  manifest: TopicManifest;
  recentTopics: string[];
  intent: string;
};

/**
 * The streaming planner. Field-for-field the old
 * `buildStreamingPlannerUserPrompt` input — the prompt did not change, only
 * which side of the wire assembles it.
 */
export type PracticePlannerPromptSpec = {
  kind: 'practice_planner_stream';
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
  selectedTopics?: string[];
  intelligentCards?: IntelligentCard[];
  reviewMode?: boolean;
};

/**
 * SRV-PROMPT-1 / TOPIC-SET-7 — topic classification. Not a practice prompt; the
 * same mechanism, because the reason for it is not practice-specific. `themes`
 * is the live closed theme set read from `/topics` (docs with a non-empty
 * description, `other` excluded); the server renders the glossary into the SI
 * AND builds the response schema from it (`topic: enum(themes ∪ "other")`).
 */
export type TopicClassifyPromptSpec = {
  kind: 'topic_classify';
  phrase: string;
  translation: string;
  themes: Array<{ name: string; description: string }>;
  /** The card's practice language name (e.g. "French"), so a phrase that is
   *  also an English word ("Pain") is read in the right language. Omitted
   *  when unknown — never sent as ''. */
  practiceLanguage?: string;
};

/**
 * SRV-PROMPT-4 — chat-to-flashcard extraction (PRACTICE-IMPORT-12).
 *
 * `messages` is the user's own chat text, already trimmed to 280 chars each by
 * `PRACTICE-IMPORT-9` and capped at 50 by `PRACTICE-IMPORT-7`; `existingPhrases`
 * is the EXCLUDE list built from their own deck. Both are content the caller
 * owns rather than instruction, which is the test a spec field has to pass.
 *
 * `kind` is `chat_import_extract` — the CATEGORY the client already sent, not
 * `chat_extract` after the server module. Renaming it would have moved a
 * telemetry bucket for a refactor.
 */
export type ChatExtractPromptSpec = {
  kind: 'chat_import_extract';
  practice: string;
  native: string;
  messages: Array<{
    text: string;
    language: string;
    messageId: string;
    chatId: string;
  }>;
  existingPhrases: string[];
  /** PRACTICE-IMPORT-25 — learner level 1–7 for `practice`; optional so the
   *  server's unbanded path stays the old-client contract (PRACTICE-IMPORT-26). */
  level?: number;
};

/**
 * SRV-PROMPT-5 — the card editor's phrase translator (CARDS-LIST-8).
 *
 * `text` is user-typed and is the one genuine injection surface on this prompt.
 * It reaches the USER prompt because it is the thing being translated, and the
 * server builds the system instruction from the two language names alone.
 */
export type CardTranslatePromptSpec = {
  kind: 'card_translate';
  text: string;
  from: string;
  to: string;
};

/**
 * SRV-PROMPT-6 — the three Explain prompts.
 *
 * `explain` reviews a chat message; `explain_practice` reviews a quiz answer
 * and carries the verdict-overturn rules (PRACTICE-EXPLAIN-3); `explain_followup`
 * continues the conversation. Three kinds rather than one with a mode flag,
 * because PRACTICE-EXPLAIN-3 is explicit that the chat and practice
 * instructions must not be confused — and a flag is how they would be.
 *
 * `previousXml` on the follow-up is the model's OWN earlier answer fed back:
 * carried but not trusted, same standing as the planner's per-slot briefing,
 * blast radius one follow-up in one modal.
 */
export type ExplainPromptSpec = {
  kind: 'explain';
  practice: string;
  native: string;
  originalText: string;
  originalLanguage: string;
  translatedText: string;
  wordDifficulty?: number;
  contextMessages?: { sender: string; text: string }[];
  senderName?: string;
  senderPronouns?: 'he' | 'she' | 'other' | '';
};

export type ExplainPracticePromptSpec = {
  kind: 'explain_practice';
  practice: string;
  native: string;
  userAnswer: string;
  wasCorrect: boolean;
  wordDifficulty?: number;
  question: {
    questionType: string;
    instruction: string;
    practiceText?: string;
    options?: string[];
    correctAnswer: string;
    explanation?: string;
    matchingPairs?: { left: string[]; right: string[] };
  };
};

export type ExplainFollowUpPromptSpec = {
  kind: 'explain_followup';
  practice: string;
  native: string;
  question: string;
  previousXml: string;
  translatedText: string;
  wordDifficulty?: number;
};

/** EXPLAIN-PHRASE-3 — one underlined phrase, explained in its message
 *  (docs/specs/explain.md §2). No review, no follow-up. */
export type ExplainPhrasePromptSpec = {
  kind: 'explain_phrase';
  practice: string;
  native: string;
  phrase: string;
  /** The card's gloss; '' when the card had none. */
  gloss: string;
  /** The practice-language text the phrase was tapped in. */
  sentence: string;
  nativeSentence?: string;
  wordDifficulty?: number;
  contextMessages?: { sender: string; text: string }[];
};

/**
 * SRV-PROMPT-8..13 batch 1 — the SVG backdrop generator (LIFE-BACKDROP-5), and
 * the first `life_*` kind to send a spec instead of prose.
 *
 * Its SYSTEM INSTRUCTION left the bundle under `LIFE-BACKDROP-30`; this is the
 * other half, and the reason the half was not enough is `PRACTICE-OWN-1`:
 * replacing only the SI leaves the user prompt as the other place prose enters.
 *
 * FLAT, not a nested `BackdropDescriptor`. The descriptor also carries `label`
 * and `labelNative`, which key the backdrop cache (LIFE-BACKDROP-2/28) and fill
 * the location ribbon (LIFE-BACKDROP-26) — the prompt has never read either, so
 * they do not travel. A field on the wire that reaches nothing is a field
 * someone later wires INTO something.
 *
 * `timeOfDay` is the `TimeOfDay` enum, not the rendered clause. Sending the
 * rendered text would re-open the proxy through the very field the migration
 * was meant to close — SRV-PROMPT-12's point, reached from the other direction.
 */
export type LifeBackdropPromptSpec = {
  kind: 'life_backdrop';
  locationType: string;
  vibe: string;
  persistent: boolean;
  /** The world's practice language — all text inside the SVG must be in it. */
  practice: string;
  flavour?: string;
  timeOfDay?: TimeOfDay;
};

/**
 * SRV-PROMPT-8..13 batch 2 — the three portrait/profile prompts.
 *
 * Batch 2 because their inputs are scalars and all three are fired ASYNC by
 * `kickoffNpcAssets` without blocking a turn, so a regression costs an avatar
 * rather than a session.
 *
 * WHAT THESE FIELDS ARE. Every one is model-authored WORLD STATE, not
 * instruction: `name` and `role` come from the turn's `introduces[]` or the
 * saga's `keyArchetypes` via `resolveNpcRole`, `worldVibe` from the saga tone
 * or the world seed, `sagaPremise` from `world.situation`. Carried but not
 * trusted — the same standing PRACTICE-OWN-9 gives the planner's per-slot
 * briefing, and the reason the XML escaping moved to the server with the
 * prompts rather than staying in the bundle.
 *
 * An absent optional is ABSENT rather than `null`. The server REJECTS a null
 * instead of reading it as absent, deliberately: `kickoffNpcAssets` holds
 * `role ?? null` internally, so the spec builders below are the one place that
 * turns "we do not know" into an omission, and a null arriving means that
 * stopped happening. LIFE-NPC-8 is about exactly this field going missing.
 */
type LifeNpcCharacterFields = {
  name: string;
  /** Short role / relationship. Drives clothing + bearing, and framing. */
  role?: string;
  /** Saga tone or world-seed register (modern, noir, fantasy, sci-fi). */
  worldVibe: string;
};

/**
 * LIFE-NPC-7 — the avatar-card blurb. The server owns the RESPONSE SCHEMA for
 * this one too (`{ description: string }`, SRV-PROMPT-1): it used to sit inline
 * at the call site and travel in the request body, which left the half deciding
 * what the model may SAY frozen in the app bundle.
 */
export type LifeNpcProfilePromptSpec = LifeNpcCharacterFields & {
  kind: 'life_npc_profile';
  /** LIFE-NPC-8 — the fuller "who they are" line. The field that carries the
   *  ANSWER; `role` is only a label. */
  archetype?: string;
  /** The world's current situation, so the profile can place the character
   *  inside the larger story without spoiling it. */
  sagaPremise?: string;
};

/** LIFE-NPC-2 — the direct SVG draw. The FALLBACK path, ~8x the output of the
 *  parts picker below, taken only when the library cannot dress the character. */
export type LifeNpcAvatarPromptSpec = LifeNpcCharacterFields & {
  kind: 'life_npc_avatar';
};

/**
 * LIFE-NPC-2b — the parts picker, tried FIRST. Same fields as the draw and a
 * different prompt, which is why they are two kinds rather than one with a mode
 * flag: the server must not be able to confuse them.
 *
 * The part NAMES are not here. They are rendered into the server's system
 * instruction from its own table — sending them would let a client write
 * arbitrary text into an SI, which is the proxy this migration closes.
 */
export type LifeAvatarParamsPromptSpec = LifeNpcCharacterFields & {
  kind: 'life_npc_avatar_params';
};

/**
 * SRV-PROMPT-8..13 batch 3 — the "Previously on…" resume recap (LIFE-FLOW-5).
 *
 * Batch 3 in §6.8's order is this plus `life_world_arc`, the two calls where
 * being wrong costs least, picked as the place to answer SRV-PROMPT-9's payload
 * question. **Only this half shipped.** `life_world_arc` renders `previousArcs`,
 * which `readCompletedArcs` returned UNCAPPED until LIFE-WORLD-ARC-7 bounded
 * it at the call site, and a long-played world's
 * assembled pair exceeds `MAX_PROMPT_BYTES` — where the built path answers
 * `too-large` and the legacy path, which caps the two halves separately, still
 * serves it. It stays on the legacy path until that input is bounded.
 *
 * The recap passes because every one of its inputs is bounded IN CODE:
 * `capStoryLog` holds `storyLines` to 60, and `RESUME_RECAP_EVENT_COUNT` caps
 * what renders at 10 however big the listener window is.
 *
 * NOT a `LifeWorld`. Six fields, flat, rebuilt server-side field-by-field —
 * `world` carries canon, goals, fronts, cast and a saga this prompt has never
 * read, and a field on the wire that reaches nothing is a field someone later
 * wires INTO something.
 *
 * `systemLanguage` is ALREADY RESOLVED (`systemLanguage ?? nativeLanguage`).
 * It used to be resolved twice — at the call site for the SI, and again inside
 * the prompt builder for the `<character>` tag — and two copies of one rule is
 * how they come to disagree.
 *
 * `chapter` carries BOTH registers and the SERVER picks. The pick is the
 * spoiler rule (LIFE-WORLD-ARC-REGISTER: a player-facing output never gets the
 * planner premise), and a rule about what the model may be shown belongs where
 * `deploy:prod:functions` can correct it.
 */
export type LifeResumeRecapPromptSpec = {
  kind: 'life_resume_recap';
  characterName: string;
  practiceLanguage: string;
  /** Resolved system language — the single language the recap is written in
   *  (LIFE-LANG-8). */
  systemLanguage: string;
  chapter?: { chapterNumber: number; premise: string; playerTeaser?: string };
  /** `world.storyLog.entries` — the durable spine (WS1-C / LIFE-MEM-2). */
  storyLines: string[];
  /**
   * The listener window OLDEST → NEWEST, narrowed to the four payload strings
   * this prompt reads. The whole window travels: which KINDS render, the
   * narrator default, the empty-row skip and the 10-row cap are the prompt's
   * rules, not the caller's, so they stayed with the prompt.
   */
  events: Array<{
    kind: string;
    speaker?: string;
    speakerName?: string;
    practiceText?: string;
    text?: string;
  }>;
};

/**
 * SRV-PROMPT-8..13 batch 3 — the chapter-open prompt (LIFE-WORLD-ARC-*).
 *
 * ⚠ THE OTHER HALF OF BATCH 3, AND IT LANDED ONE CHANGE LATER. The recap
 * cleared SRV-PROMPT-9's size gate on first measurement; this did not.
 * `readCompletedArcs` returned the whole `completedArcs` subcollection and the
 * prompt rendered all of it, so a long-played world's assembled pair hit 148.8%
 * of `MAX_PROMPT_BYTES` at twenty chapters — which the built path answers
 * `too-large` and `runWorldArcGenerate` then hides behind `trivialArc`. That
 * was a real pre-existing bug (the legacy path's separate caps only postponed
 * the same cliff); `LIFE-WORLD-ARC-7` bounded the input and re-measurement put
 * the realistic worst case at 73.7% of cap.
 *
 * NOT a `LifeWorld`. `canon`, `goalLadder`, `storyLog`, `saga`, `currentArc`
 * and `sagaHistory` all sit on the world doc and have never been read by this
 * prompt; a field on the wire that reaches nothing is a field someone later
 * wires INTO something.
 *
 * THREE RENDERING RULES ARE VISIBLE HERE BY THEIR ABSENCE, because each decides
 * what the MODEL SEES rather than what the caller has, so each stayed with the
 * prompt:
 *   - the LIVE-front filter — every front travels with its `resolved` flag and
 *     the server drops the closed ones (and never sees a clock, LIFE-FRONT-1.1);
 *   - the regulars ceiling — the whole cast travels and the server renders
 *     eight regulars plus every principal (LIFE-CAST-3);
 *   - the six-memory slice per prior chapter.
 *
 * `previousArcs` is the one bound applied HERE rather than server-side, and
 * that is a deliberate split from the recap. The recap ships its whole event
 * window because the window is bounded at 40; a world's arc history is bounded
 * by nothing, so `capCompletedArcs` runs at the call site and at most
 * `COMPLETED_ARCS_CAP` chapters ever reach the wire.
 *
 * `playerTeaser` is ABSENT from `previousArcs` on purpose — the inverse of the
 * recap's pick (LIFE-WORLD-ARC-REGISTER). A recap is PLAYER-facing and gets the
 * spoiler-safe teaser; this prompt is read by the MODEL and gets the planner
 * premise. The surest way to keep the player-facing string out of a planner
 * prompt is for it never to cross the wire at all.
 */
export type LifeWorldArcPromptSpec = {
  kind: 'life_world_arc';
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  worldSeedKey: string;
  /** Only when the seed is `manual`: the user's verbatim text. */
  worldSeedText?: string;
  universe?: {
    setting: string;
    era: string;
    laws: string[];
    places: string[];
    figures: Array<{ name: string; what: string }>;
  };
  situation?: string;
  /** ALL fronts, narrowed to the three fields the prompt reads. The clock and
   *  the consequence never travel (LIFE-FRONT-1.1). */
  fronts: Array<{ driverId: string; agenda: string; resolved?: string | null }>;
  /** ALL cast, narrowed to what the state block renders. `gender` /
   *  `voiceRegister` are TTS fields this prompt has never read. */
  cast: Array<{
    id: string;
    name: string;
    voice: string;
    standing: number;
    tier: 'principal' | 'regular';
    known: string;
    wants?: string;
    nextMove?: string;
    limit?: string;
    routine?: string;
    ties: Array<{ id: string; how: string }>;
  }>;
  /** LIFE-ONBOARD-17: the pre-rendered `<bio>` block, emitted verbatim. */
  bio?: string;
  currentLocationLabel?: string;
  chapterNumber: number;
  /** Already capped by `capCompletedArcs` (LIFE-WORLD-ARC-7). */
  previousArcs: Array<{
    chapterNumber: number;
    premise: string;
    themes: string[];
    outcomeLine?: string | null;
    completedSceneMemories: Array<{ title: string; endingKey: string; summary: string }>;
  }>;
};

/**
 * SRV-PROMPT-8..13 batch 4 — the scene PLANNER (LIFE-SCENE-*).
 *
 * ⚠ THE KIND IS `life_scene_gen` AND IT IS THE **OPEN**. `life_scene` below is
 * the CLOSE. The pair reads inverted and is NOT a typo: these are the wire
 * values `runSceneOpen.ts` / `runSceneClose.ts` have always sent, so
 * `kind === category` holds without renaming anything — and renaming either
 * would move a telemetry bucket and orphan every historical usage doc
 * (SRV-PROMPT-4, the same reason `chat_import_extract` kept its name).
 *
 * NOT a `LifeWorld`, a `Front` or a `CastMember`. The fields below are what the
 * prompt reads and nothing else:
 *
 *  - a front sends id + driver + agenda and NO CLOCK. LIFE-FRONT-1.1 says the
 *    planner never sees one, and the surest way to guarantee that is for the
 *    clock not to exist on the wire. The LIVE filter runs at the call site for
 *    the same reason — `resolved` is the other half of the clock's story.
 *  - a cast member sends no `voice`, `gender`, `voiceRegister`, `limit`, `ties`
 *    or `wrongAbout`. The first three are TTS fields; `wrongAbout` is the raw
 *    material for `ironyAvailable`, which is computed against canon at the call
 *    site (LIFE-CAST-2) — a belief the player cannot yet see through is a
 *    private opinion, not irony, and putting it in front of the planner asks it
 *    to explain the gap in order to use it.
 *  - `universe` sends setting/laws/places. `era` and `figures` are on the
 *    world's `Universe` and this prompt has never rendered them.
 *
 * FOUR DECISIONS TRAVEL ALREADY MADE, each because it is a rule a model can
 * satisfy by doing nothing: `focus` (LIFE-SCENE-2, rotated), `needSign`
 * (LIFE-FRONT-8, read off clocks that do not cross), `ironyAvailable`
 * (LIFE-CAST-2) and the `canon` DORMANCY ORDER (LIFE-CANON-6).
 *
 * `chapterNumber` / `chapterTurns` are the RAW counters, never a computed
 * stage. Where the story-stage ladder's rungs sit is a decision about what the
 * model may be told, so it stays server-side next to the prose it gates.
 */
export type LifeSceneOpenPromptSpec = {
  kind: 'life_scene_gen';
  characterName: string;
  practiceLanguage: string;
  universe?: { setting: string; laws: string[]; places: string[] };
  situation: string;
  cast: Array<{
    id: string;
    name: string;
    tier: 'principal' | 'regular';
    standing: number;
    known: string;
    wants?: string;
    nextMove?: string;
    routine?: string;
  }>;
  /** LIVE fronts only, and no clock (LIFE-FRONT-1.1). */
  fronts: Array<{ id: string; driverId: string; agenda: string }>;
  /** `canonDormancy`'s output: capped, and ORDERED longest-dormant first. The
   *  order IS the instruction ("prefer what has been away longest"). */
  canon: Array<{ id: string; name: string; note: string; scenesSince: number }>;
  /** Saga history, oldest → newest. The six-line render slice is server-side. */
  history: string[];
  sceneIndex: number;
  /** LIFE-FRONT-8: front ids whose clock is past half. */
  needSign: string[];
  /** LIFE-CAST-2: beliefs the player can now see through. */
  ironyAvailable: Array<{ castId: string; believes: string }>;
  /** LIFE-SCENE-2. `null` is a VALUE — an ordinary day belonging to nobody's
   *  ambition — so it is nullable rather than optional. The server REJECTS an
   *  absent one, because absent means `focusForScene` stopped being called and
   *  the rotation that stops every scene being about one person is gone. */
  focus: { castId: string; name: string } | null;
  recentSubjects: string[];
  chapterNumber?: number;
  chapterTurns?: number;
};

/**
 * SRV-PROMPT-8..13 batch 4 — the scene CLOSE (LIFE-ARCH-4). The single most
 * important call in the design, and the only one that writes to the world's
 * permanent memory.
 *
 * ⚠ THE KIND IS `life_scene` AND IT IS THE **CLOSE**. See the note above.
 *
 * THE CLOCKS TRAVEL HERE, inverting LIFE-FRONT-1.1's rule for every other
 * prompt. That is the job: this is the only caller that decides deltas, and
 * "how much closer did it get" cannot be judged without knowing where it
 * stands. What still does not travel is the engine's own bookkeeping — `peak`,
 * `unattended`, `sinceAdvance`, `scope`, `name`, `resolved` — and `known`,
 * which LIFE-ARCH-2.1 keeps out of the RESPONSE schema and which has no job in
 * the prompt either.
 *
 * `realistic` picks the SI's register branch (LIFE-FRONT-6), so it is the one
 * field here that decides which system instruction is built at all. It travels
 * as the BOOLEAN the world mode resolves to, never as the rendered clause.
 *
 * `sceneLog` travels whole (bounded at `SCENE_LOG_CAP` 60 by `buildSceneLog`);
 * the 24-beat render slice stayed with the prompt, because it decides what the
 * model sees rather than what the caller has.
 */
export type LifeSceneClosePromptSpec = {
  kind: 'life_scene';
  sceneLog: string[];
  subject: string;
  atStake: string;
  cast: Array<{
    id: string;
    name: string;
    tier: 'principal' | 'regular';
    standing: number;
    wants?: string;
    nextMove?: string;
    routine?: string;
  }>;
  fronts: Array<{
    id: string;
    kind: string;
    driverId: string;
    agenda: string;
    clock: { filled: number; size: number; consequence: string };
  }>;
  /** LIFE-FRONT-6: caps consequence severity in the SI's REGISTER block. */
  realistic: boolean;
  /** LIFE-GOAL-11: the live near objective. ABSENT when there is none — asking
   *  for a verdict on nothing invites the model to invent an objective to have
   *  an opinion about. */
  objective?: { id: string; text: string };
};

/**
 * SRV-PROMPT-8..13 batch 5 — the WORLD OPEN (LIFE-ARCH-1/3).
 *
 * Batch 5 because it fires ONCE PER WORLD and `runSagaOpen` has no fallback
 * saga on purpose: a world with an invented front and no cast plays badly for
 * its whole life, silently. A rejected spec is a dead world-open.
 *
 * ⚠ THE SHAPE OF THIS TYPE IS THE POINT, and it is SRV-PROMPT-1's own case.
 * `sagaOpenResponseSchema(succession)` forks — a new world's schema carries a
 * `universe` for the model to author, a succession's does not — so the half that
 * constrains the ANSWER moved with the half that constrains the question. What
 * did NOT move is the FLAG:
 *
 *  - there is no `succession`. The server derives it from `universe` being
 *    present, which is the same expression this call site used to compute
 *    (`input.universe != null`). A boolean beside the payload would be a second
 *    copy of one fact, and a caller could then request the succession SCHEMA
 *    with a new-world PAYLOAD — a world whose universe nobody ever writes.
 *  - there is no `realistic`. The server derives it from `worldMode`, which has
 *    to travel anyway (it renders into `<world mode="…">`). It picks the
 *    consequence CEILING (LIFE-FRONT-6), so a separate copy could open a
 *    FANTASY world under REALISTIC rules with the prompt still saying fantasy.
 *
 * NOT a `LifeWorld`. `situation`, `canon`, `storyLog`, `saga`, `currentArc`,
 * `sagaHistory`, `fronts` and `cast` are all on the world doc and none has ever
 * been read by this prompt — this is the call that WRITES them.
 *
 * ⚠ `universe` HERE IS THE CALLER'S ARGUMENT, not `world.universe`. Succession
 * is a parameter of `runSagaOpen` because the world being opened is the one that
 * has none yet; reading it off the doc would make every re-open of an existing
 * world a succession by accident, and that bit picks the response schema.
 * `universe.figures` does not travel: the prompt renders setting, era, laws and
 * places, and a field that reaches nothing is a field someone later wires INTO
 * something.
 *
 * `worldId` travels so the server can render `<texture>` (LIFE-STORY-EXEMPLAR-2).
 * The POOLS stay server-side — they are prompt text, and a client supplying them
 * could write arbitrary prose into a user prompt, which is this migration's own
 * hole reached from the other direction (batch 2's `avatar/parts.ts`).
 *
 * `systemLanguage` is ALREADY RESOLVED (`systemLanguage ?? nativeLanguage`), for
 * the reason `life_resume_recap` recorded in batch 3: it used to be resolved at
 * the call site for the SI and again inside the prompt builder for the
 * `<character>` tag, and two copies of one rule is how they come to disagree.
 */
export type LifeSagaOpenPromptSpec = {
  kind: 'life_saga';
  /** Hashed server-side for `<texture>`; never rendered as text. */
  worldId: string;
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  /** Resolved system language — the chrome the player reads (LIFE-LANG-8/14). */
  systemLanguage: string;
  worldSeedKey: string;
  /** LIFE-ONBOARD-3: persisted for EVERY seed. Also DERIVES the SI's register
   *  branch server-side (LIFE-FRONT-6), which is why no `realistic` travels. */
  worldMode?: 'realistic' | 'fantasy';
  /** Only when the seed is `manual`: the user's verbatim text. */
  worldSeedText?: string;
  /** SUCCESSION only (LIFE-ARCH-6). Its PRESENCE is the fork that picks both the
   *  system instruction and the response schema, so it is absent rather than
   *  null when there is none — the server rejects a null instead of reading it
   *  as absent (the batch-2 `role` precedent). */
  universe?: {
    setting: string;
    era: string;
    laws: string[];
    places: string[];
  };
  /** Narrowed to the four fields `<person>` renders. `voice`, `standing`,
   *  `wants`, `wrongAbout` and `ties` are on `CastMember` and are not read here. */
  survivingCast?: Array<{
    id: string;
    name: string;
    tier: 'principal' | 'regular';
    known: string;
  }>;
  /** Oldest → newest. The ten-line render slice is server-side, because it
   *  decides what the model sees rather than what the caller has. */
  priorSagaHistory?: string[];
};

/**
 * SRV-PROMPT-8..13 batch 6 — the character BIO (LIFE-ONBOARD-6 / LIFE-ARCH-3).
 *
 * ⚠ BATCH 6 AND NOT EARLIER BECAUSE `story` IS BATCH 5'S OUTPUT. It is the
 * `title` / `tone` / `situation` / `cast` / `fronts` that `runSagaOpen` has just
 * written, so where this shape and `LifeSagaOpenPromptSpec` describe the same
 * thing they AGREE rather than being designed twice:
 *
 *  - `characterName`, `practiceLanguage`, `nativeLanguage`, `worldSeedKey`,
 *    `worldSeedText`, `worldMode` — the same six names and types, `worldMode`
 *    included. ⚠ The deleted `BioPromptInput` had it as a bare `string` while
 *    the prompt branches `=== 'realistic'`, so anything else rendered as itself
 *    in the mode line and silently took the fantasy register. It is the closed
 *    enum now, which is what `ZWorldMode` already promised.
 *  - `story.cast[]` uses the saga survivor's `name` / `known`, and
 *    `story.fronts[]` uses the world-state block's `agenda` / `resolved`.
 *
 * WHERE THEY DIVERGE, DELIBERATELY: no `worldId` (this prompt renders no
 * `<texture>`) and no `systemLanguage` (it reads `nativeLanguage`) — a field
 * that reaches nothing is a field someone later wires INTO something.
 *
 * ⚠ THE STORY IS NESTED, where the two SCENE specs carry `situation`, `cast`
 * and `fronts` flat. The `<world>` block renders as a UNIT, so nesting makes a
 * half-present world unrepresentable rather than merely rejected — the same
 * argument `universe` makes for being a payload rather than a flag.
 *
 * ⚠ ABSENT, NEVER NULL. `generateCharacterBio` is handed `story: null` when
 * `sagaOpen` failed, and this is the one place that turns that into an
 * OMISSION: the server rejects a null on this field rather than reading it as
 * absent, because its PRESENCE is the fork the `<world>` block renders on.
 * `fronts[].resolved` is the opposite case — there `null` is a VALUE the live
 * filter reads, so it travels.
 *
 * ⚠ WHAT DOES NOT TRAVEL: everything else on a `CastMember` or a `Front`. The
 * call site holds whole ones and this prompt reads two fields off each;
 * `clock.consequence` in particular is withheld from prompts by LIFE-FRONT-1.1
 * on measured evidence. The LIVE filter stays SERVER-side, because which fronts
 * the model sees is a prompt rule.
 */
export type LifeBioStory = {
  title: string;
  tone: string;
  situation: string;
  cast: Array<{ name: string; known: string }>;
  fronts: Array<{ agenda: string; resolved?: string | null }>;
};

export type LifeBioPromptSpec = {
  kind: 'life_bio';
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  worldSeedKey: string;
  /** LIFE-ONBOARD-3: the register the player picked. Absent on legacy worlds. */
  worldMode?: 'realistic' | 'fantasy';
  /** Only when the seed is `manual`: the user's verbatim text. */
  worldSeedText?: string;
  story?: LifeBioStory;
};

/**
 * SRV-PROMPT-12 — the CRITIC'S VERDICT, as data.
 *
 * `life_graded_question` runs a two-attempt ladder whose second attempt is
 * steered by a critic that runs HERE, on the client, over the model's own
 * response. Before batch 7 that critic wrote English sentences and the client
 * posted them up as `violationHint`, which the prompt builder interpolated into
 * a `<violationHint>` block. Migrating the prompt without changing that would
 * have left the proxy OPEN through the retry path while attempt 1 looked
 * migrated — a caller could put any text it liked in front of the model by
 * claiming the previous attempt failed.
 *
 * So the client says WHICH guards fired and the SERVER writes the words
 * (`functions/src/prompts/lifeGradedViolations.ts`). Three properties make that
 * worth doing rather than just moving the string:
 *
 *  - it is a CLOSED union on `code`; an unrecognised code is a 400, not a
 *    silently dropped entry that would weaken the retry with nothing saying so;
 *  - every parameter is narrowly typed, and every STRING one is sliced and
 *    escaped server-side (SRV-PROMPT-14 — they land inside an XML block);
 *  - nothing the server already holds travels. The two templates that quote the
 *    plan's `sentenceContext` / `testTarget` read them off the validated spec,
 *    so a caller cannot restate the plan inside its own critique.
 *
 * ⚠ ORDER IS MEANING. The array is rendered in the order it arrives, because
 * that is the order the three guards pushed (leak, then direction, then vocab)
 * and the joined hint has always read that way. The server never re-sorts.
 */
export type GradedViolation =
  | { code: 'comprehension-kind-mismatch' }
  | { code: 'comprehension-missing-why-wrong' }
  | { code: 'comprehension-utterance-narrated'; quote: string }
  | { code: 'comprehension-question-empty' }
  | { code: 'comprehension-utterance-native-missing' }
  | { code: 'comprehension-chip-echoes-utterance'; chipIndex: number }
  | { code: 'comprehension-chip-native-in-utterance'; chipIndex: number }
  | { code: 'comprehension-chip-native-empty'; chipIndex: number }
  | {
      code: 'comprehension-chips-share-native';
      chipIndex: number;
      otherChipIndex: number;
      quote: string;
    }
  | { code: 'fill-blank-kind-mismatch' }
  | { code: 'fill-blank-missing-blank-marker' }
  | { code: 'fill-blank-completed-native-missing' }
  | { code: 'fill-blank-completed-native-has-blank' }
  | { code: 'fill-blank-correct-chip-not-in-sentence'; quote: string }
  | { code: 'fill-blank-correct-chip-diverges'; quote: string }
  | { code: 'fill-blank-chip-has-native-gloss'; chipIndex: number; quote: string }
  | { code: 'fill-blank-chip-practice-empty'; chipIndex: number }
  | { code: 'fill-blank-chip-contains-template-before'; chipIndex: number; quote: string }
  | { code: 'fill-blank-chip-contains-template-after'; chipIndex: number; quote: string }
  | { code: 'fill-blank-chip-too-long'; chipIndex: number; tokenCount: number }
  | {
      code: 'fill-blank-chips-share-practice';
      chipIndex: number;
      otherChipIndex: number;
      quote: string;
    }
  | { code: 'fill-blank-disambiguation-missing' }
  | { code: 'fill-blank-missing-why-wrong' }
  | { code: 'fill-blank-anchor-leaks-answer'; quote: string }
  | { code: 'line-vocab-missing' }
  | { code: 'direction-kind-mismatch' }
  | { code: 'direction-player-line-narrated'; quote: string }
  | { code: 'direction-npc-line-narrated'; quote: string }
  | { code: 'schema-issue'; path: string; message: string }
  | { code: 'invalid-json' };

/**
 * SRV-PROMPT-8..13 batch 7 — the graded-question generator (LIFE-EX-GEN-*).
 *
 * ⚠ THE PLAN IS THE DIRECTION. `plan.kind` is what `gradedDirection` reads to
 * decide who the resolved bubble belongs to, and it is what the server reads to
 * render `<direction>`. There is no `speaker` field and no `direction` object
 * on the wire: a second spelling of one fact is how the card came to say
 * "Élise said:" beside a bubble that said "?" (LIFE-EX-DIR-1). `npcId` does not
 * travel either — the prompt never renders it; only `applyGradedDirection`
 * reads it, and that runs on the RESULT, here.
 *
 * ⚠ `systemLanguage` AND `difficulty` TRAVEL RESOLVED, and are NOT on `scene`.
 * The call site applies the two fallbacks (`scene?.systemLanguage ??
 * nativeLanguage`, `scene?.difficulty ?? 2`) before building this, so the
 * server never re-applies a default the client already applied and the two
 * cannot disagree — the rule batch 5's harness seam had to learn twice.
 *
 * ⚠ AND `nativeLanguage` DOES NOT TRAVEL AT ALL. `buildGradedQuestionPrompt`
 * never read it (the deleted `GradedQuestionPromptInput` declared it and the
 * builder touched neither language), and the SI reads the SYSTEM language. A
 * field that reaches nothing is a field someone later wires INTO something —
 * the same narrowing `life_bio` made for `worldId`.
 */
export type LifeGradedQuestionPromptSpec = {
  kind: 'life_graded_question';
  plan:
    | { kind: 'generation'; testTarget: string; sentenceContext: string }
    | { kind: 'comprehension'; npcUtterance: string; speakerName?: string | null };
  practiceLanguage: string;
  /** LIFE-LANG-7/8, resolved at the call site. */
  systemLanguage: string;
  /** LIFE-CTX-3, resolved at the call site. */
  difficulty: number;
  recentTargets: string[];
  /** Narrowed to the four fields `<sceneContext>` renders. */
  scene?: {
    sagaTitle?: string;
    locationLabel?: string;
    speakerName?: string;
    recentBeats?: string[];
  };
  /** SRV-PROMPT-12. Absent on attempt 1. */
  violations?: GradedViolation[];
};

/**
 * SRV-PROMPT-12 — the `life_step` critic's verdict, as CODES.
 *
 * `generateStepOptions` builds a `retryHint` at FIVE sites and used to APPEND
 * it to the prompt (`${prompt}\n\n${retryHint}`). Once the server builds the
 * prompt there is nothing to append to, so the verdict crosses as a closed
 * union and the server writes the words
 * (`functions/src/prompts/lifeStepViolations.ts`).
 *
 * ⚠ THE FAMILY IS DERIVED FROM THE CODES, not sent. Each of the five sites
 * `continue`s immediately, so a verdict has always held issues from exactly one
 * site — a `family` field the codes contradict would be representable, and this
 * way it is not. Same shape as batch 7's `direction-kind-mismatch`.
 *
 * ⚠ AND AN UNKNOWN CODE IS *DROPPED* SERVER-SIDE, NOT REJECTED — the one place
 * this kind disagrees with `GradedViolation`. A rejected `life_graded_question`
 * demotes to CYOA; a rejected `life_step` is the hard loop of SRV-PROMPT-10.
 * The fallback for a dropped verdict is an UNHINTED retry, which is
 * byte-identical to the attempt the endpoint just served.
 *
 * ⚠ ORDER IS MEANING. The array renders in the order it arrives, because that
 * is the order the producing site pushed, and the joined hint has always read
 * that way. The server never re-sorts.
 */
export type StepViolation =
  // `safeParseJson` returned nothing.
  | { kind?: never; code: 'invalid-json' }
  // One `ZodIssue` off `ZRawNodeResponse.safeParse`, capped at six by the
  // caller's own `.slice(0, 6)`.
  | { code: 'schema-issue'; path: string; message: string }
  // `applyRequestShape` (LIFE-NODE-2) — the request-shape rules the schema
  // cannot know, because they depend on what was ASKED for.
  | { code: 'live-turn-missing-node' }
  | { code: 'question-carries-options'; count: number }
  | { code: 'continuation-option-count'; count: number }
  | { code: 'continuation-option-id'; optionId: string }
  | { code: 'branch-option-count'; count: number }
  | { code: 'options-repeat-action-type'; actionTypes: string[] }
  | { code: 'options-none-active' }
  | { code: 'option-ids-duplicated'; optionIds: string[] }
  // `gradeOptionSet` (LIFE-GRID-6).
  | { code: 'dangled-goal'; goal: string; takes: number }
  // `validateNodeResponse` — the three BLOCKING cross-turn codes. The warn-only
  // ones never reached the prompt and do not travel.
  | { code: 'unknown-entity-ref'; optionId: string; targetId: string }
  | { code: 'lead-in-leaks-tested-line' }
  | { code: 'question-omits-lead-in' };

/**
 * SRV-PROMPT-8..13 batch 8 — the turn prompt (LIFE-CTX-1/3), and the last
 * life-sim prompt in the bundle.
 *
 * ⚠ THE EVENT ROWS TRAVEL RAW, and that is the decision worth reading. The
 * obvious design sends the DERIVED scalars — the cadence tier, the recent
 * targets, the action shapes — because this client already computes them. But
 * `<recentEvents>` has to render the rows whatever else happens, so the rows
 * travel anyway; and once they do, every reduction over them is something the
 * server holds, and sending one as well would let a caller claim a streak its
 * own events contradict. That is batch 7's rule (2) applied to a much bigger
 * payload.
 *
 * ⚠ THE THREE EXCEPTIONS are values that reduce state this prompt never reads,
 * and each stays client-side because ENGINE code reads the same answer:
 * `canon` (`resolveCanon`, also read by `validateNodeResponse`),
 * `goalLadder.saga.daysLeft` (`daysLeft`, also read by the chrome) and
 * `goalLadder.blocked` (`exposureReason` over `worldFactsFor`, also read by the
 * option grid's clearing move).
 *
 * ⚠ `createdAtMs` REPLACES each event's Firestore `Timestamp`, which does not
 * survive JSON. Only `recentlyPracticedTargets` reads it, and only to drop
 * targets practised before this chapter began.
 */
export type LifeStepPromptSpec = {
  kind: 'life_step';
  practiceLanguage: string;
  nativeLanguage: string;
  /** LIFE-LANG-7, resolved at the call site. */
  systemLanguage: string;
  difficulty: number;
  characterName: string;
  worldSeedKey: string;
  worldSeedText?: string;
  /** LIFE-ONBOARD-6 — the stored `<bio>` block. SRV-PROMPT-14 normalises it. */
  bio?: string;
  universe?: LifeStepUniverse | null;
  story?: LifeStepStory;
  canon?: LifeStepCanon;
  npcs?: LifeStepNpc[];
  recurringNpcIds?: string[];
  chapterNumber?: number;
  /** `storyLog.turns ?? storyLog.entries.length`, resolved at the call site. */
  chapterTurns?: number;
  chapterStartedAtMs?: number | null;
  sceneTurns?: number;
  storyLogEntries?: string[];
  arc?: LifeStepArc | null;
  scene?: LifeStepScene | null;
  currentLocationLabel?: string;
  goalLadder?: LifeStepGoalLadder | null;
  timeOfDay?: string;
  turnIndex?: number;
  events?: LifeStepEvent[];
  requestKind?: 'live' | 'options';
  currentNodeKind?: 'branch' | 'continuation';
  isOpeningBeat: boolean;
  choice?: LifeStepChoice;
  freeText?: string;
  practiceOutcome?: LifeStepPracticeOutcome;
  /** SRV-PROMPT-12. Absent on attempt 1. */
  retry?: StepViolation[];
};

export type LifeStepUniverse = {
  setting: string;
  era: string;
  laws: string[];
  places: string[];
  figures: Array<{ name: string; what: string }>;
};

export type LifeStepStory = {
  situation?: string;
  fronts?: Array<{ driverId: string; agenda: string; resolved?: string | null }>;
  cast?: Array<{
    id: string;
    name: string;
    voice: string;
    standing: number;
    tier: 'principal' | 'regular';
    known: string;
    wants?: string;
    nextMove?: string;
    limit?: string;
    routine?: string;
    ties: Array<{ id: string; how: string }>;
  }>;
};

export type LifeStepCanonEntry = {
  id: string;
  name: string;
  kind?: string;
  note?: string;
  canSpeak?: boolean;
};

export type LifeStepCanon = {
  characters: LifeStepCanonEntry[];
  places: LifeStepCanonEntry[];
  objects: LifeStepCanonEntry[];
  facts: LifeStepCanonEntry[];
};

export type LifeStepNpc = {
  id: string;
  name: string;
  relationship?: string;
  oneLineMemory?: string;
  scope?: 'scene' | 'world' | 'transient';
  sceneId?: string;
};

export type LifeStepArc = {
  chapterNumber: number;
  premise: string;
  themes: string[];
  recurringNpcIds: string[];
  completedSceneMemories: Array<{ title: string; summary: string }>;
};

export type LifeStepScene = {
  id: string;
  currentPhase: string;
  turnsSinceReplan: number;
  leaning?: string;
  leaningStall?: number;
  outline: {
    title: string;
    subject?: string;
    where?: string;
    premise: string;
    tone: string;
    openQuestion?: string;
    practiceFocus: string[];
    keyNpcs: Array<{ npcId: string; name: string; role: string }>;
  };
};

export type LifeStepGoalLadder = {
  saga?: { text: string; when: string; daysLeft: number };
  objective?: { text: string; need?: { name: string } };
  done?: Array<{ how: string; text: string; because?: string }>;
  blocked?: string;
};

export type LifeStepEvent = {
  kind: string;
  payload?: Record<string, unknown>;
  createdAtMs?: number | null;
};

export type LifeStepChoice = {
  id: string;
  practiceText: string;
  speechAct?: 'say' | 'act';
  saysLine?: string;
};

export type LifeStepPracticeOutcome = {
  kind: 'generation' | 'comprehension';
  correct: boolean;
  picked: string;
  correctAnswer: string;
  promptSource: string;
  resolvedLine?: string;
  resolvedSpeaker?: 'user' | 'npc' | 'narrator';
};

export type PracticePromptSpec =
  | PracticeGeneratorPromptSpec
  | PracticeSelectorPromptSpec
  | PracticePlannerPromptSpec
  | TopicClassifyPromptSpec
  | ChatExtractPromptSpec
  | CardTranslatePromptSpec
  | ExplainPromptSpec
  | ExplainPracticePromptSpec
  | ExplainFollowUpPromptSpec
  | ExplainPhrasePromptSpec
  | LifeBackdropPromptSpec
  | LifeNpcProfilePromptSpec
  | LifeNpcAvatarPromptSpec
  | LifeAvatarParamsPromptSpec
  | LifeResumeRecapPromptSpec
  | LifeWorldArcPromptSpec
  | LifeSceneOpenPromptSpec
  | LifeSceneClosePromptSpec
  | LifeSagaOpenPromptSpec
  | LifeBioPromptSpec
  | LifeGradedQuestionPromptSpec
  | LifeStepPromptSpec;
