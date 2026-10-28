/**
 * The `life_step` USER-PROMPT BLOCKS, SERVER-OWNED (SRV-PROMPT-8..13 batch 8).
 *
 * Every block `buildLifeStepPrompt` renders below the system instruction, ported
 * byte-for-byte from the client modules that owned them. Seven of those modules
 * are SPLIT artefacts rather than whole moves, and the split is the same cut in
 * every case: **a renderer that writes what the model READS crosses; a reduction
 * the client ACTS ON stays.**
 *
 *   | client module        | crossed here                      | stayed client-side        |
 *   |----------------------|-----------------------------------|---------------------------|
 *   | `canon.ts`           | `renderCanon`, `canonWorkingSetIds`| `resolveCanon`, `canonViolations`, `canonIndex`, `applyIntroductions`, `capCanon`, `canonDormancy`, `muteEntityIds` |
 *   | `optionGrid.ts`      | `renderRequiredType`, `renderRecentActions`, `requiredTypeForTurn`, `actionShapesFromEvents`, `pushRecentActions` | `gradeOptionSet`, `offeredShapes`, `takenShapeCounts`, `DANGLE_TAKES` |
 *
 * ⚠ `shapeKey` / `goalKey` ARE THE ONE PAIR ON BOTH SIDES, and it is a genuine
 * split rather than an oversight: `renderRecentActions` keys the block the model
 * reads with them, and `gradeOptionSet` / `takenShapeCounts` key the REJECT it
 * makes of the answer. Two live readers on opposite sides of the wire — the
 * `DELTA_PER_FRONT` shape again, so no expiry. Drift is the failure `goalKey`'s
 * own comment records at length: the rule was MEASURED against one key and
 * IMPLEMENTED against another, and at 75.7% it was a tax rather than a backstop.
 *   | `prompts/storyStage` | `renderStoryStage`, `CAST_FLOOR`  | — (module DELETED; the ladder was already here, `lifeStoryStage.ts`) |
 *   | `prompts/stepStreaks`| the two cadence blocks + `recentlyPracticedTargets` | `cyoaStreak`, `cadenceTier` (LIFE-EX-CADENCE-3's debug row) |
 *   | `sceneLeaning.ts`    | `renderSceneQuestion`             | `nextLeaningState`, `isRestatedQuestion` |
 *   | `npcNames.ts`        | `renderNameRules`, `overusedNamesFor` | — (module DELETED)     |
 *   | `timeOfDay.ts`       | `renderTimeOfDay` + the six glosses| `advanceTimeOfDay`, `readTimeOfDay`, `readTimeAdvance` |
 *
 * ⚠ `cyoaStreak` / `cadenceTier` ARE DUPLICATED AND DO NOT EXPIRE. They are not
 * shared with another PROMPT — they are read by `generateStepOptions`'s
 * LIFE-EX-CADENCE-3 debug row, which records whether the model HONOURED the
 * cadence it was given, and that row is a judgement on the response. So this is
 * the `DELTA_PER_FRONT` shape (batch 4), not the gloss shape (batch 1): the two
 * copies never re-converge, and the parity guard on them says so at its head.
 *
 * ⚠ THE GOAL LADDER TRAVELS RESOLVED, and that is a deliberate narrowing.
 * `renderGoalState` called `daysLeft(...)` and `renderGoalDirective` called
 * `exposureReason(objective, facts)`, where `facts` is `worldFactsFor(world,
 * npcs)` — a reduction over the whole world and the whole roster. Shipping the
 * FACTS would have put reputations, inventory and the cast on the wire for two
 * derived values; shipping the derived values keeps `goalLadder.ts` whole and
 * client-side. Same call batch 7 made for `systemLanguage` / `difficulty`: the
 * call site applies the derivation, and the server never re-applies one the
 * client already applied.
 */
import { escapeAttr, escapeText, type StepEvent } from "./lifeStepRender";
import { STAGE_UNDERWAY_AT, type StoryStage } from "./lifeStoryStage";
// ⚠ The SIX TIME GLOSSES, imported rather than copied — see `GLOSS` below.
import { BACKDROP_TIME_OF_DAY_GLOSS } from "./lifeBackdrop";

/** One canon entry, narrowed to the five fields a `<canon>` row renders. */
export type CanonEntry = {
  id: string;
  name: string;
  kind?: string;
  note?: string;
  canSpeak?: boolean;
};

/** The ledger, in its four append-only buckets. */
export type WorldCanon = {
  characters: readonly CanonEntry[];
  places: readonly CanonEntry[];
  objects: readonly CanonEntry[];
  facts: readonly CanonEntry[];
};

/** LIFE-GOAL-* — the ladder as the two blocks read it, with `daysLeft` and the
 *  exposure reason already resolved at the call site. */
export type StepGoalLadder = {
  saga?: { text: string; when: string; daysLeft: number } | null;
  objective?: { text: string; need?: { name: string } | null } | null;
  done?: ReadonlyArray<{ how: string; text: string; because?: string | null }>;
  /** `exposureReason(...)`, resolved client-side. Null / absent = not blocked. */
  blocked?: string | null;
};

/** The six values the clock may hold (`ZTimeOfDay`'s enum, restated). */
export const TIMES_OF_DAY = [
  "dawn",
  "morning",
  "midday",
  "afternoon",
  "evening",
  "night",
] as const;
export type TimeOfDay = (typeof TIMES_OF_DAY)[number];

/** The same coercion `readTimeOfDay` applies client-side: anything that is not
 *  one of the six reads as `morning`. NEUTRALISE rather than reject — a legacy
 *  world holding a value this enum never had must still get a turn
 *  (SRV-PROMPT-10). */
export function readTimeOfDay(v: unknown): TimeOfDay {
  return typeof v === "string" && (TIMES_OF_DAY as readonly string[]).includes(v)
    ? (v as TimeOfDay)
    : "morning";
}

/** `ZOptionType`'s six values, restated (`functions/` holds no zod). */
export const OPTION_TYPE_VALUES = [
  "ask",
  "do",
  "move",
  "observe",
  "offer",
  "leave",
] as const;
export type OptionType = (typeof OPTION_TYPE_VALUES)[number];

/** The four that ACT on the world — `src/types/lifeState.ts`'s own list. */
export const ACTIVE_OPTION_TYPES: readonly OptionType[] = ["do", "move", "offer", "leave"];

// ── canon ────────────────────────────────────────────────────────────────

/** An absent ledger renders `<canon/>` — a brand-new world, or one predating
 *  the ledger. Mirrors `canon.ts`'s own `EMPTY_CANON`. */
export const EMPTY_CANON: WorldCanon = {
  characters: [],
  places: [],
  objects: [],
  facts: [],
};

/** Model-authored names/notes land inside an XML block, so they escape like
 *  every other untrusted string in the prompt (same rule as prompts/step.ts). */
const esc = (v: string): string =>
  v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const row = (e: CanonEntry, withNote: boolean): string => {
  const speak = e.canSpeak === false ? ' canSpeak="no"' : '';
  const kind = e.kind ? ` kind="${esc(e.kind)}"` : '';
  const head = `  <entity id="${esc(e.id)}" name="${esc(e.name)}"${kind}${speak}`;
  // LIFE-CANON-5: the note is the only bulky part of a row and the only part
  // that is dead weight for an entity nobody is currently interacting with.
  const note = withNote ? esc(e.note ?? '') : '';
  return note ? `${head}>${note}</entity>` : `${head}/>`;
};

/** Words that are far too common to identify an entity by name. Matching
 *  "Marc" against the events text is meaningful; matching "the" is not, and a
 *  one- or two-letter name would put every entity in the working set. */
const MIN_NAME_MATCH = 3;

/**
 * LIFE-CANON-5: which canon entities are currently IN PLAY.
 *
 * `<canon>` is append-only and uncapped, so by node 300 it is ~17,600 chars —
 * the single largest unbounded term in the prompt body, and (since the implicit
 * cache boundary stops inside the system instruction) every byte of it is billed
 * at the full uncached rate. Entities the story established 200 nodes ago and has
 * not mentioned since were paying full price for their descriptions on every
 * turn.
 *
 * An entity is in play when the model plausibly needs its DETAIL this turn:
 * it is named in the recent-events window, it is where the player currently is,
 * or it is a recurring (world-scope) NPC. Everything else still appears — with
 * its id, name, kind and affordance intact, so every rule the SI states about
 * canon still holds — just without its note.
 *
 * Matching is by id OR name substring against the volatile context text. Crude
 * on purpose: a false POSITIVE costs ~90 chars, a false negative costs the model
 * one entity's descriptive line, and neither can break a contract. `id` is
 * matched too because options reference entities by `targetId` without
 * necessarily naming them in prose.
 */
export function canonWorkingSetIds(
  canon: WorldCanon,
  context: {
    /** Volatile prompt text — recent events, current state, story spine. */
    text: string;
    /** Recurring NPC ids: always in play, they carry the chapter. */
    pinnedIds?: ReadonlyArray<string>;
  },
): Set<string> {
  const inPlay = new Set<string>(context.pinnedIds ?? []);
  const haystack = context.text.toLowerCase();
  const all = [
    ...canon.characters, ...canon.places, ...canon.objects, ...canon.facts,
  ];
  for (const e of all) {
    if (inPlay.has(e.id)) continue;
    if (e.id.length >= MIN_NAME_MATCH && haystack.includes(e.id.toLowerCase())) {
      inPlay.add(e.id);
      continue;
    }
    if (e.name.length >= MIN_NAME_MATCH && haystack.includes(e.name.toLowerCase())) {
      inPlay.add(e.id);
    }
  }
  return inPlay;
}

/** The `<canon>` block. Append-only ordering — characters, then places, then
 *  objects, then facts, each in insertion order — so a new entry only ever
 *  extends the block and never rewrites a byte before it.
 *
 *  `inPlay` (LIFE-CANON-5) selects which entities carry their `note`. Omit it and
 *  every entity gets one, which is the pre-2026-07 behaviour and the right
 *  default for any caller that has no volatile context to match against. */
export function renderCanon(canon: WorldCanon, inPlay?: ReadonlySet<string>): string {
  const all = [
    ...canon.characters, ...canon.places, ...canon.objects, ...canon.facts,
  ];
  if (all.length === 0) return '<canon/>';
  const rows = all.map((e) => row(e, !inPlay || inPlay.has(e.id)));
  return `<canon>\n${rows.join('\n')}\n</canon>`;
}


// ── story stage (render half) ────────────────────────────────────────────
/** How many NAMED people the world should have by each stage.
 *
 *  This is the observable half of *"characters are never introduced"* and
 *  *"relationships don't form"*. The gentle-introduction rule (now the `PEOPLE:`
 *  block in `stepLean.ts`; formerly `GENTLE_INTRODUCTION_RULES` in the deleted
 *  `stepVoice.ts`) already governs
 *  HOW someone is introduced; nothing governed how MANY exist, so a world could
 *  run twenty turns on one NPC in one room and break no rule. Compared against
 *  the live roster, so the block can say "you have one, you need two" instead
 *  of asking for variety in the abstract. */
export const CAST_FLOOR: Record<StoryStage, number> = {
  arrival: 1,
  settling: 2,
  stirring: 3,
  underway: 0,
};

const BODY: Record<Exclude<StoryStage, 'underway'>, (turns: number) => string> = {
  arrival: (t) =>
    // REWRITTEN 2026-08-03. The previous version was seven prohibitions and one
    // positive instruction, opening with "NOTHING HAS HAPPENED YET, and that is
    // correct — do not fix it". A model told at length what a scene may not
    // contain, and told outright that the scene is meant to be empty, writes a
    // POSTCARD. Measured: "The sun shines on the port. Fishing boats float
    // gently in the blue bay. The air smells of salt and hot coffee." — three
    // static sentences, no person in them, nothing underway, and options that
    // only let the player choose what to look at.
    //
    // The brief was right that a world must not open at maximum drama and wrong
    // that the alternative is stillness. An ordinary morning is not an empty
    // one: somebody is doing something, and the player has a part in it. So the
    // ratio is inverted — a positive brief with edges, and ONE line of what to
    // leave out instead of a checklist to avoid.
    `This world is ${t} ${t === 1 ? 'turn' : 'turns'} old. This is an ARRIVAL: the player is meeting a place and a person for the first time. ` +
    `Something ORDINARY IS ALREADY UNDERWAY and the player has walked into the middle of it — a delivery being unloaded, bread coming out, a queue, ` +
    `a repair somebody is losing patience with, an argument about nothing. Not a story starting. A Tuesday, in progress. ` +
    `PUT A PERSON IN IT AND HAVE THEM DO SOMETHING. A scene of weather and scenery with nobody in it is the failure this stage produces most often — ` +
    `describe the place THROUGH what someone in it is doing, and let them speak. Introduce ONE person properly (name, what they do, how they treat ` +
    `the player) rather than three in passing. ` +
    `Give the player something to DO, not only something to look at: a hand to lend, a thing to carry, a question somebody is waiting on. ` +
    `WHAT TO LEAVE OUT, once: the saga's conflict has not started, so nothing here is a secret, a warning, a summons, or a line whose job is to ` +
    `make the player uneasy. If a sentence would work as the opening of a thriller, rewrite it as what the room actually looks like.`,
  settling: (t) =>
    `This world is ${t} turns old and the player knows the place now. Ordinary life continues, and the first pressure may appear — as a WANT, never as a threat. ` +
    `A want is something someone is trying to GET or FINISH: a job, a rent, a repair, a favour, a recipe, an apology, a delivery that keeps not arriving. It has no villain and nobody is hiding it. ` +
    `STILL EMIT ZERO OF: the saga's opposing force, a secret being kept from the player, a revelation, a line that exists to unsettle. ` +
    `DEEPEN, DON'T ADD: someone the player has already met must show one NEW and SPECIFIC thing about themselves this stage — a habit, an opinion, something they are bad at, someone they miss. ` +
    `A cast the player cannot tell apart is the failure this stage exists to prevent.`,
  stirring: (t) =>
    `This world is ${t} turns old. The first genuine thread of the saga MAY surface now — as something small and CONCRETE the player NOTICES, never as a revelation and never explained to them. ` +
    `Concrete means a thing with edges: a name on a list, a date that does not match, a door locked that was not, someone who stopped coming in, a bill nobody will claim. ` +
    `Not a mood, not a warning, not a portentous line, and nobody says "there is something you should know". ` +
    `NO CHARACTER EXPLAINS WHAT IT MEANS. This is the failure this stage has actually produced, observed in a real playthrough: the player found a black sap under a walkway (good — a thing with edges), and two turns later an NPC was saying "it is the heart of the tree beginning to rot" and "the wood never cries this black ink without a mortal suffering". ` +
    `That NPC handed over the chapter's discovery, in one line, to someone who had done nothing to earn it — and did it in the portentous register that makes every character sound the same. ` +
    `An NPC who KNOWS may say so without saying WHAT: they can be uneasy, change the subject, refuse to look at it, say "ask me another time", or be plainly wrong about it. ` +
    `The player works out what any of it means by living, over the turns that follow. The opposing force may EXIST in the world without appearing in it.`,
};

/**
 * The `<storyStage>` block. Empty once the world is `underway` — after that
 * `<chapterPace>` is the clock and nothing here should still be constraining
 * what the story may contain.
 */
export function renderStoryStage(opts: {
  stage: StoryStage;
  chapterTurns: number;
  /** Named people the world has established (the `<npcRoster>` length). */
  castSize: number;
}): string {
  const { stage, chapterTurns, castSize } = opts;
  if (stage === 'underway') return '';
  const floor = CAST_FLOOR[stage];
  const cast =
    castSize < floor
      ? `\n  <cast known="${castSize}" wantedByNow="${floor}">Only ${castSize} named ${castSize === 1 ? 'person has' : 'people have'} been established. ` +
        `Bring in ${floor - castSize} more before this stage ends — a neighbour, a colleague, a regular, a relative — and introduce ${floor - castSize === 1 ? 'them' : 'each of them'} properly (GENTLE INTRODUCTIONS). ` +
        `A world with one face in it cannot form relationships, which is the thing the player is here for.</cast>`
      : '';
  return (
    `<storyStage stage="${escapeAttr(stage)}" turns="${chapterTurns}" fullStoryAt="${STAGE_UNDERWAY_AT}">` +
    `\n  <job>${escapeText(BODY[stage](chapterTurns))}</job>${cast}\n</storyStage>`
  );
}

// ── goal ladder blocks ───────────────────────────────────────────────────

/**
 * The ladder as STATE. Rendered into `<currentState>` beside the location.
 *
 * The day count is rendered because the player can see it, and a model that
 * cannot see what the player sees will contradict it. It is stated as a fact,
 * never as a countdown the model may narrate — `LIFE-GOAL-7` still forbids the
 * model saying a date out loud, and the SI carries that prohibition.
 */
export function renderGoalState(ladder: StepGoalLadder | null | undefined): string | null {
  if (!ladder) return null;
  const rows: string[] = [];
  if (ladder.saga) {
    // `daysLeft(...)` ran HERE client-side and now travels resolved — see the
    // file header. `?? 0` below is kept so the rendered attribute is
    // byte-identical for a ladder whose day count could not be computed.
    const left: number | null = ladder.saga.daysLeft;
    rows.push(
      `    <sagaGoal by="${escapeText(ladder.saga.when)}" daysLeft="${left ?? 0}">` +
      `${escapeText(ladder.saga.text)}</sagaGoal>`,
    );
  }
  if (ladder.objective) {
    const need = ladder.objective.need;
    rows.push(
      `    <objective${need ? ` needs="${escapeText(need.name)}"` : ''}>` +
      `${escapeText(ladder.objective.text)}</objective>`,
    );
  }
  // The last few, so the model can refer back to what the player achieved
  // rather than re-proposing it. Capped: this is a ledger, not a transcript.
  const done = (ladder.done ?? []).slice(-3);
  for (const d of done) {
    rows.push(
      `    <settled how="${d.how}">${escapeText(d.text)}` +
      `${d.because ? ` — ${escapeText(d.because)}` : ''}</settled>`,
    );
  }
  return rows.length > 0 ? `  <goal>\n${rows.join('\n')}\n  </goal>` : null;
}

/**
 * LIFE-GOAL-3/4 — the DIRECTIVE. This is the forcing function.
 *
 * Three states, and each asks for something different:
 *
 *   **no objective**  — mint one. Without this the ladder never starts, and an
 *                       empty slot is the only moment the model is allowed to
 *                       choose the direction.
 *   **live + blocked** — the block is REPORTED to the model so its prose agrees
 *                       with the chip the player is about to read. It is told
 *                       not to resolve the need by narration, which is the
 *                       obvious way for a model to make a block evaporate.
 *   **live**          — the strongest line in the file: the objective STANDS.
 *                       The model is told explicitly that not taking it is not
 *                       the same as it being over. That sentence is the direct
 *                       answer to *"the key never came back up again"*.
 *
 * `nextObjective` is described as ignorable-unless-asked ON PURPOSE. A field the
 * model can write at any time is a field it will write at any time, and the
 * reducer would silently drop it — a model whose output is discarded without
 * being told is a model that keeps doing it.
 */
export function renderGoalDirective(
  ladder: StepGoalLadder | null | undefined,
): string | null {
  if (!ladder?.saga) return null;
  const objective = ladder.objective ?? null;

  if (!objective) {
    return (
      `<goalDirective state="none">There is no near objective right now. ` +
      `Set ONE: a concrete thing the player can finish in the next scene or two that ` +
      `moves them toward "${escapeText(ladder.saga.text)}". Write it in \`nextObjective\` ` +
      `as a short second-person phrase ("get Hélène to look at your work"). ` +
      `If it depends on ONE person, thing or place, name that in \`nextObjectiveNeed\` ` +
      `— just the name, nothing else.</goalDirective>`
    );
  }

  // `exposureReason(objective, worldFactsFor(world, npcs))` ran HERE and now
  // travels resolved — see the file header.
  const blocked = ladder.blocked?.trim() ? ladder.blocked : null;

  const standing =
    `The player's current objective is "${escapeText(objective.text)}" and it STANDS. ` +
    `It is not over because they did something else this turn — leave \`objectiveDone\` and ` +
    `\`objectiveClosed\` unset and it simply stays live. ` +
    `Set \`objectiveDone: true\` ONLY when they have actually achieved it. ` +
    `If the world has genuinely put it out of reach, say why in \`objectiveClosed\` — in one clause, ` +
    `in fiction — and the player will be shown that reason. ` +
    `\`nextObjective\` is IGNORED while this one is live.`;

  if (blocked) {
    return (
      `<goalDirective state="blocked">${standing}\n` +
      // LIFE-NEED-3: "above the options", NOT "under the option that would
      // advance it", which is what this said before the UI existed and was
      // never true. Code cannot know which option advances the objective
      // (`objectiveBlockFor`), so the row sits over the whole grid. Worth
      // being exact about: the model is being told what the player can see,
      // and a wrong account of that is a wrong account of the shared world.
      `RIGHT NOW IT IS BLOCKED: ${escapeText(blocked)}. The player is being shown that, ` +
      `word for word, above their options, and is being offered a move that clears it — so do ` +
      `not write a beat in which the obstacle quietly resolves itself. If they push at it anyway, ` +
      `the turn still happens and they still learn something; it just does not land.</goalDirective>`
    );
  }
  return `<goalDirective state="live">${standing}</goalDirective>`;
}

// ── naming + clock ───────────────────────────────────────────────────────
/**
 * The names measured as over-reached-for, by practice language.
 *
 * Sourced from real generations rather than from name-frequency tables: the
 * point is not "common in France", it is "what this model writes when it is not
 * thinking about it".
 */
const OVERUSED: Record<string, readonly string[]> = {
  french: ['Marc', 'Élodie', 'Elodie', 'Sophie', 'Marie', 'Claire', 'Pierre', 'Camille', 'Luc'],
  spanish: ['Elena', 'Javier', 'Sofía', 'Sofia', 'Carlos', 'María', 'Maria', 'Miguel'],
  italian: ['Marco', 'Giulia', 'Luca', 'Sofia', 'Elena'],
  german: ['Anna', 'Lukas', 'Klaus', 'Greta', 'Hans'],
  portuguese: ['João', 'Joao', 'Maria', 'Ana', 'Pedro'],
  japanese: ['Yuki', 'Haruto', 'Sakura', 'Kenji'],
};

function languageKey(practiceLanguage: string): string {
  return practiceLanguage.toLowerCase().split(/[\s(]/)[0] ?? '';
}

export function overusedNamesFor(practiceLanguage: string): readonly string[] {
  return OVERUSED[languageKey(practiceLanguage)] ?? [];
}

/**
 * The `<namesInUse>` block: what this world has already used, plus what this
 * model reaches for by default.
 *
 * `inUse` is the load-bearing half — a world with two Marcs is worse than a
 * world with a predictable one — and it is also the half that keeps working
 * when the static list goes stale.
 */
export function renderNameRules(opts: {
  practiceLanguage: string;
  inUse: readonly string[];
}): string {
  const overused = overusedNamesFor(opts.practiceLanguage);
  const taken = [...new Set(opts.inUse.map((n) => n.trim()).filter(Boolean))];
  const lines = [
    `<naming>`,
    taken.length
      ? `  <alreadyInThisWorld>${taken.join(', ')}</alreadyInThisWorld>`
      : `  <alreadyInThisWorld/>`,
  ];
  lines.push(
    `  <rule>Never reuse a name in <alreadyInThisWorld> for a DIFFERENT person — one world, one Marc.</rule>`,
  );
  // Only reference <doNotReachFor> when it is actually rendered. A rule that
  // points at an absent block is noise at best, and at worst invites the model
  // to reason about what it thinks should have been in it.
  if (overused.length) {
    lines.push(
      `  <doNotReachFor>${overused.join(', ')}</doNotReachFor>`,
      `  <rule>Those are the names you default to when you are not thinking about it. Pick something else.</rule>`,
    );
  }
  lines.push(
    `  <rule>A name is the cheapest characterisation you get — a regional name, an older or younger generation's name, a name from somewhere this person moved FROM. "Sabine", "Ousmane", "Bartek", "Rosalie" each say something before the person opens their mouth.</rule>`,
    `</naming>`,
  );
  return lines.join('\n');
}

/**
 * ✅ THE SIX GLOSS STRINGS ARE NOW ONE COPY, and batch 8 is why.
 *
 * Batch 1 moved `renderTimeOfDayForBackdrop` server-side and had to LEAVE the
 * glosses behind, because `renderTimeOfDay` still needed them and its consumer
 * (`prompts/step.ts`) did not migrate until batch 8. The duplication's stated
 * expiry was "batch 8" — and it very nearly expired into a SECOND duplication
 * rather than none, because moving `renderTimeOfDay` here would simply have put
 * both copies on the server.
 *
 * ⚠ THAT IS THE BATCH-5 LESSON ARRIVING FROM THE OTHER SIDE: a guard retired on
 * schedule can leave the thing it guarded in place. The table is IMPORTED from
 * `lifeBackdrop.ts` instead, so there is one authoritative copy and nothing left
 * to drift. The two WRAPPERS still differ on purpose — `It is ${gloss}.` here
 * and `Time of day: ${gloss}` there — and the byte parity of both is pinned by
 * `stepGoldenParity.test.ts` and `lifeBackdrop.test.ts` respectively.
 */
const GLOSS = BACKDROP_TIME_OF_DAY_GLOSS;

export function renderTimeOfDay(t: TimeOfDay): string {
  return `<timeOfDay value="${t}">It is ${GLOSS[t]}. Everything you write happens at THIS time — the light, who is around, what is open, what people are doing. Do not move the clock in your prose; if time should pass, say so with the time field and it will be applied.</timeOfDay>`;
}


/**
 * The WORLD-STATE section of the live step prompt: who is already named here,
 * and what time it is.
 *
 * Extracted from `step.ts` for the 600-LOC cap, and the split earns itself the
 * same way the option-grid extraction did — both blocks answer "what is true of
 * this world right now", both sit in the same band of the prefix ladder
 * (changing every few turns rather than every turn), and neither has anything
 * to do with the turn-shaping rules that make up the rest of that file.
 *
 * Spec: docs/specs/story-architecture.md (LIFE-TIME-1, LIFE-NPC-10).
 */

export function renderWorldStateBlocks(input: {
  practiceLanguage: string;
  characterName: string;
  npcNames: readonly string[];
  timeOfDay: unknown;
}): string {
  return [
    renderNameRules({
      practiceLanguage: input.practiceLanguage,
      // The player counts: a world where the baker shares the player's name is
      // the LIFE-CAST-5 collision arriving through a different door.
      inUse: [input.characterName, ...input.npcNames],
    }),
    renderTimeOfDay(readTimeOfDay(input.timeOfDay)),
  ].join('\n\n');
}

// ── scene question ───────────────────────────────────────────────────────
/** Consecutive declared non-moves before the prompt stops accepting them.
 *
 *  TWO, not one: a single quiet turn is ordinary — a scene that never lets
 *  anything sit is as unplayable as one that never moves. Two in a row is the
 *  point at which "the picks aren't changing anything" stops being a rhythm and
 *  starts being the on-rails failure the benchmark measured. */
export const LEANING_STALL_LIMIT = 2;
/** Just enough of a `LifeScene` to render the block — kept structural so the
 *  harness and the prompt tests can pass a literal without a full doc. */
export type SceneQuestionSource = {
  outline?: { openQuestion?: string | null } | null;
  leaning?: string | null;
  leaningStall?: number | null;
};

/**
 * The `<sceneQuestion>` block, rendered into the step prompt's volatile tail.
 *
 * Takes the SCENE rather than three loose fields: which parts of the scene doc
 * this block reads is this module's business, and threading them by hand at the
 * call site is how a renderer and its state drift apart.
 *
 * Returns null when the scene carries no open question — scenes opened before
 * this shipped, and the thin fallback scene. The block must not invent one, and
 * an empty one would cost input tokens on every turn of a scene that cannot use
 * it (`life_step` runs at roughly 32:1 input:output, so a hot-path block is the
 * expensive kind of addition).
 */
export function renderSceneQuestion(scene: SceneQuestionSource | null | undefined): string | null {
  const question = scene?.outline?.openQuestion?.trim();
  if (!question) return null;
  const leaning = scene?.leaning?.trim();
  const stall = scene?.leaningStall ?? 0;

  const where = leaning
    ? `Position now: ${escapeText(leaning)}`
    : 'Nothing has moved it yet.';

  // LIFE-INTENT-4 — SLIMMED, and the reason is measured. The ablation showed
  // this block buying INTENT +0.25 and QUESTION-VALUE +0.25 while costing
  // INTRIGUE -0.34, SUBJECT-SPREAD -0.50 and four more dimensions -0.25 each.
  // Those are crowding-shaped costs, not mechanism-shaped: nothing here should
  // make a story LESS intriguing or its scenes LESS varied, but ~350 tokens of
  // bookkeeping on the hot path, every turn, plausibly does. So the rules that
  // earned their place stay and their justifications go — the model needs the
  // CONSTRAINT, not the argument for it.
  //
  // What is kept, and why each survived:
  //  - "FIXED, do not rewrite" — this is what took restated questions from 36%
  //    of leanings to zero. Load-bearing, one line.
  //  - one GOOD and one BAD — showing the shape is what worked where describing
  //    it did not; a second example of each taught nothing extra.
  //  - the honest-false permission — without it "did it move" collapses to
  //    always-yes, which is the failure LIFE-INTENT-3 was built to catch.
  //
  // What went: the explanations. That a quiet turn is part of a rhythm, that a
  // scene may end unresolved, that the question is not a completion trigger —
  // all true, all reasoning the prompt does not need to carry.
  //
  // RE-TUNED after measuring the cut. Slimming to 508 chars gave the crowding
  // tax back exactly as predicted — CAST-DEPTH +0.50, COHERENCE / BACKDROP-FIT
  // / BIO-FIT +0.25 each — and surrendered the gain with it: INTENT -0.22 and
  // movement 35% -> 28%. Composite moved -0.023, i.e. the block's cost and its
  // benefit are both proportional to its size.
  //
  // Two lines went back, chosen because they are the only ones that carried
  // WEIGHT rather than format:
  //  - THE EXPECTATION. The slim kept "say false honestly when they did not"
  //    and dropped "a scene where nothing the player does ever moves it is the
  //    failure" — permission with no counterweight. That asymmetry is the most
  //    likely reading of a movement rate that fell by exactly the amount the
  //    ablation said the block was buying.
  //  - A CONDITIONAL example. One GOOD example teaches one shape; "will agree
  //    if you pay first" teaches that a position may have terms, which is most
  //    of what a scene's answer actually looks like mid-scene.
  const body =
    stall >= LEANING_STALL_LIMIT
      ? `${where}\n${stall} turns without moving while the player kept acting — that is ON RAILS. Fix it THIS turn: either let what they just did shift the answer, or make at least one option a real lever on this question.`
      : `${where}\nGive the position AFTER what the player just did, and set \`leaningMoved\` to whether they changed it. Say false honestly on a quiet turn — but a scene where nothing the player does EVER moves it is the failure this block exists to prevent.`;

  const rule =
    'The question is FIXED — do not rewrite it or replace it. `leaning` is your POSITION on it: NOT a question, NOT a recap of this turn.\n'
    + 'GOOD "refusing, harder than when you came in" · "will agree if you pay first" · BAD "whether Bruno hands it over" (that is the question again)';

  return (
    `<sceneQuestion stall="${stall}">UNSETTLED: ${escapeText(question)}\n${rule}\n${body}</sceneQuestion>`
  );
}

// ── cadence streaks ──────────────────────────────────────────────────────
/**
 * Event-log counters that drive the step prompt's two CADENCE directives.
 *
 * Extracted from `step.ts` for the 600-LOC cap, and the split earns itself: both
 * are pure reductions over the events log with no prompt-rendering concerns, so
 * they are testable — and readable — without the 800-line prompt builder around
 * them. The DIRECTIVES they feed live in `stepRender.ts`; this module only
 * answers "how long has it been".
 */

/** LIFE-EX-CADENCE-1/2: narrative picks before a graded moment is DUE (a nudge
 *  the model may place naturally) and before it is OVERDUE (the window closes).
 *
 *  DUE stays at 2 — that is the tier that produces the target rate when taken.
 *  OVERDUE moved 4 → 3 on 2026-07-31 because the model was **taking the
 *  deferral almost every time**. Measured on a real world
 *  (`w-1785453145426-8w0ffo`): **8 corrections across 34 decisions = 23.5%**,
 *  i.e. ~1 question in 4.3 against the `LIFE-WORLD-ARC-7` target of ~1 in 3.
 *  Zero `question_demoted` events, so this is deferral, not rejection.
 *
 *  The arithmetic the window implies: taking DUE lands a question every 3rd
 *  turn (33%); deferring to OVERDUE=4 lands one every 5th (20%). 23.5% sits
 *  just above the deferral floor. Closing the window to 3 raises that floor to
 *  25% and narrows the band to 25-33%.
 *
 *  DIRECTIONAL, NOT MEASURED TO A CONCLUSION: this moves the floor, it does not
 *  make the model take DUE more often. Re-measure the correction/decision ratio
 *  on a real chapter before claiming the target is met. */
/*
 * RE-TUNED 2026-08-04, and the reason the earlier value can be undone.
 *
 * DUE went 2 → 1 on 2026-08-03 to raise the FLOOR, because the model was
 * deferring at `due` and a scene produced two questions. It worked, and it
 * overshot: measured across a full 8-scene world, 45 questions in 72 turns —
 * 62% of turns, with gaps [1,3,1,2,1,2,3,1,1,1,2,...] and only 51% inside the
 * 2-3 band the check scores. A question every other turn is a quiz with a story
 * around it.
 *
 * The floor no longer needs DUE=1 to hold it up. `forced` stopped offering an
 * alternative in the same 2026-08-03 change (LIFE-EX-CADENCE-3), so a deferral
 * at `due` can now only postpone by one turn before the window closes for real.
 * That is what protects the floor; DUE was doing it a second time, from the
 * other direction, and paying for it in density.
 *
 * Back to 2/3: the band is 1-in-3 to 1-in-4, against the LIFE-WORLD-ARC-7
 * target of ~1 in 3.
 */
export const CADENCE_DUE = 2;
export const CADENCE_OVERDUE = 3;

/**
 * LIFE-EX-CADENCE-3 — the tier the cadence directive should speak in.
 *
 * THE DEFECT, reported 2026-08-03 and visible in the note above a month before
 * anyone acted on it: a real scene ran TWELVE turns and produced ONE question.
 *
 * The 2026-07-31 change tuned OVERDUE 4 → 3 and its own comment predicted the
 * outcome — *"this moves the floor, it does not make the model take DUE more
 * often."* It didn't, because the threshold was never the problem. BOTH tiers
 * handed the model an out, and the OVERDUE one ended *"make the NEXT node the
 * question"* — a deferral it could take again on the next node, and the next,
 * with nothing anywhere counting how many times it already had.
 *
 * That is the recurring lesson for the seventh time in this codebase: **a rule
 * the model can satisfy by doing nothing is not a mechanism.** The fix is not a
 * fourth tier or another threshold; it is that OVERDUE stops offering an
 * alternative. `due` remains a genuine nudge where PLACEMENT is the model's
 * call — that judgement is worth keeping, and a question the story earned does
 * teach more than a pop quiz. `forced` is where the window actually closes.
 *
 * RE-TUNED 2026-08-03 after a full scene produced TWO questions. With DUE=2 /
 * OVERDUE=3 the band was 1-in-3 to 1-in-4, and a scene runs 6-12 turns, so the
 * ceiling was ~4 questions and the floor ~2. The floor is what a player
 * actually got. DUE=1 / OVERDUE=2 makes the band 1-in-2 to 1-in-3, which is the
 * requested target, and — because `forced` now genuinely forces — the FLOOR is
 * the thing that moved: a deferral at DUE can only postpone by one turn.
 */
export type CadenceTier = 'none' | 'due' | 'forced';

/**
 * LIFE-EX-CADENCE-4's kind ROTATION lived here and is DELETED (`LIFE-EX-18`).
 *
 * It forced production every other graded slot because, left free, the model
 * chose comprehension every time — "production never fired once, in a session
 * with twelve `say` picks". That was true, and it was true of a world where the
 * NODE was the only way to practise producing language.
 *
 * It is not true any more. `LIFE-SPEECH-3` moved production onto `gradeTarget`
 * on an option and `LIFE-EX-CADENCE-7` gave it its own clock, so the node route
 * now carries ~9% of production. The rotation had also started to FIGHT its
 * neighbours: it told the model to author a fill-blank NODE on slots where
 * `LIFE-SPEECH-3` tells it not to, which `LIFE-EX-CADENCE-6` had to referee.
 *
 * MEASURED before deleting, 4 runs each, kind instruction present vs absent:
 *
 *     fill-blank NODES      6  ->  2
 *     comprehension nodes  21  -> 21
 *     gradeTarget options  55  -> 61
 *     production per turn      0.64  ->  0.64
 *
 * The node route shrank and the option route absorbed it exactly. Comprehension
 * did NOT balloon, because this block still decides WHETHER a turn is graded —
 * only WHICH KIND is gone, and that is now derived from whose line the plan
 * holds (`deriveGradedKind`).
 */

export function cadenceTier(streak: number): CadenceTier {
  if (streak >= CADENCE_OVERDUE) return 'forced';
  if (streak >= CADENCE_DUE) return 'due';
  return 'none';
}

/** Count of `decision` events that appear AFTER the most recent
 *  `correction` event in the events log. Each completed graded
 *  practice writes a correction event (see commitNode); narrative picks
 *  write decision events. So this metric is "how many CYOA-style
 *  turns has the player taken since their last actual practice".
 *  Drives the `<practiceCadence>` directive built in `step.ts`. */
export function cyoaStreak(events: ReadonlyArray<StepEvent>): number {
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    // LIFE-EX-CADENCE-1: a graded slot is SPENT either by being answered
    // (`correction`) or by being planned and rejected (`question_demoted`).
    // Counting only the former meant a demoted question left the streak
    // elevated, so the directive fired again on the very next node — a demote
    // loop, three calls a turn (the question `life_step`, the failed
    // `life_graded_question`, and the replacement options fetch), and a run of
    // forced questions the player experiences as "too many questions".
    if (e.kind === 'correction' || e.kind === 'question_demoted') break;
    if (e.kind === 'decision') streak += 1;
  }
  return streak;
}

/**
 * LIFE-EX-CADENCE-7 — a SEPARATE clock for the one exercise that has no
 * substitute.
 *
 * Owner, 2026-08-10: *"I'm definitely finding the model is missing most
 * opportunities to test me saying something... Maybe gate only on if I've had
 * specifically a generate based question recently."* That is exactly right, and
 * the archives say why.
 *
 * `cyoaStreak` counts turns since ANY graded moment, so a COMPREHENSION question
 * resets the clock for PRODUCTION. The two are not interchangeable — one has the
 * player read, the other has them speak, and only the second is what most people
 * mean by learning a language. Worse, they do not even cost the same: a
 * comprehension needs a whole node, while production can ride a `gradeTarget` on
 * an option the player was going to pick anyway. Gating the cheap one on the
 * expensive one's clock is backwards.
 *
 * So production gets its own counter, reset ONLY by a `fill-blank` correction.
 * Both routes into that event count — the option's `gradeTarget` and the node
 * form both resolve as `payload.kind === 'generation'` — because what is being
 * measured is whether the PLAYER SPOKE, not which mechanism got them there.
 *
 * A demoted question deliberately does NOT reset it: `question_demoted` means the
 * exercise did not happen, and treating a failure as a spend is how
 * `LIFE-EX-CADENCE-1` lost questions in the first place, one direction over.
 */
export const PRODUCTION_DUE = 3;

export function productionStreak(events: ReadonlyArray<StepEvent>): number {
  let streak = 0;
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.kind === 'correction') {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      if (p.kind === 'generation') break;
    }
    if (e.kind === 'decision') streak += 1;
  }
  return streak;
}

/**
 * The nudge itself. Rendered INDEPENDENTLY of `<practiceCadence>` and at every
 * tier, including `none` — that independence is the whole point.
 *
 * It asks for an OPTION, never a node. The node route is governed by the
 * practice cadence and is the expensive one; this is the cheap one, and asking
 * for it here would put two blocks back in the business of contradicting each
 * other (`LIFE-EX-CADENCE-6`).
 */
export function renderProductionCadence(events: ReadonlyArray<StepEvent>): string | null {
  const streak = productionStreak(events);
  if (streak < PRODUCTION_DUE) return null;
  return (
    `<productionCadence streak="${streak}">The player has not been asked to SAY anything in ${streak} turns.` +
    ` If ANY option out of this node has the player speaking, mark \`gradeTarget\` on exactly ONE of them` +
    ` (a word appearing VERBATIM in that option's own \`saysLine.practiceText\`).` +
    ` If none of them do, write one that does — a reply, a question, an offer — and mark that.` +
    ` This is NOT a question node and does NOT need the practice cadence to be due: it costs no turn,` +
    ` it fires only if they pick it, and it is the ONLY route by which they ever produce the language.</productionCadence>`
  );
}

/**
 * The `<practiceCadence>` directive itself.
 *
 * Moved here from `step.ts` (which was at its 600-LOC cap) and it belongs here
 * anyway: this module's own header said "the DIRECTIVES they feed live in
 * stepRender.ts; this module only answers how long has it been" — but the
 * counters and the words that act on them drifting apart is precisely how
 * LIFE-EX-CADENCE-3 survived a month. A threshold and the sentence that spends
 * it should be readable in one screen.
 */
export function renderPracticeCadence(input: {
  events: ReadonlyArray<StepEvent>;
  isOpeningBeat: boolean;
  hasPracticeOutcome: boolean;
  /**
   * LIFE-EX-CADENCE-6 — the speechAct of the pick that led to THIS turn.
   *
   * This block used to be written without it, and that is what made it
   * contradict two rules that are conditional on the pick. It cannot decide
   * what a production slot should do without knowing whether the player has
   * already spoken.
   */
  pickedSpeechAct?: 'say' | 'act' | null;
}): string | null {
  const streak = cyoaStreak(input.events);
  const tier = cadenceTier(streak);
  if (input.isOpeningBeat || input.hasPracticeOutcome) return null;

  // LIFE-EX-CADENCE-5 — SAYING NOTHING IS NOT SAYING NO.
  //
  // `tier === 'none'` used to return null, so a turn that had just been graded
  // carried no cadence block at all and the model was free to ask again
  // immediately. It did: measured gaps of 1 accounted for most of the run's
  // 62% question rate, and a gap of 1 is a question the cadence machinery never
  // asked for — the streak was 0, so nothing rendered, so nothing objected.
  //
  // This is the same lesson as `forced` and the kind rotation, in its third
  // form: an absent instruction is not a prohibition. The block costs ~40
  // tokens on the turns immediately after a question, which is exactly the
  // window where it is needed and nowhere else.
  if (tier === 'none') {
    return (
      `<practiceCadence streak="${streak}" tier="none">A graded moment JUST happened (${streak} narrative ${streak === 1 ? 'pick' : 'picks'} since). This node is NARRATIVE — do not emit kind "question" and do not author a gradedPlan. Let the scene breathe and let the last answer land; the cadence block will tell you when the next one is due.` +
      // LIFE-EX-CADENCE-7 — the carve-out, and it is the single biggest lever on
      // production. This block governs question NODES. `gradeTarget` is a field
      // on an OPTION: it costs no turn, interrupts nothing, and fires only if
      // the player picks that option. Nothing about it needs the node cadence.
      //
      // The model did not read it that way. Measured over 78 turns: at
      // tier="none" — **54% of all turns** — it offered 22 `say` options and
      // marked `gradeTarget` on exactly ONE (4.5%), against 38% at `due` and 33%
      // at `forced`. "Do not author a gradedPlan" was being read as "no grading
      // this turn", and since a comprehension buys two turns at this tier, every
      // comprehension question was also switching production off for two turns.
      ` NOTE: \`gradeTarget\` on a "say" OPTION is NOT a gradedPlan and is NOT gated by this block — it costs no turn and rides the pick, so it is welcome on this node and every other one (see OUTBOUND GRADING).</practiceCadence>`
    );
  }

  // LIFE-EX-CADENCE-3. The `forced` body deliberately offers NO alternative.
  // Both bodies used to, and the overdue one ended "make the NEXT node the
  // question" — a deferral takeable again on the next node, and the next, with
  // nothing counting how many times it already had been. Measured result:
  // twelve turns, one question.
  const body =
    tier === 'forced'
      ? `${streak} narrative picks without practice. THE WINDOW HAS CLOSED: THIS node is the question. Emit kind "question" with a gradedPlan now — there is no narrative version of this node, and "the next node" is not available to you. ` +
        `You still choose WHICH: a fill-blank on a line the player is about to SAY, or a comprehension on a line an NPC is about to say or the player is about to READ. ` +
        // LIFE-EX-CADENCE-6: this sentence used to end "have someone say the
        // thing worth testing, then test it", and the preceding one used to
        // offer "the last NPC beat is a line that was heard". Both instruct the
        // LEAK: a tested line that is already on screen, glossed, is not a
        // question — the player reads the answer. Measured across both SI arms,
        // comprehension slots leaked at 23-32% against fill-blank's 8-18%, and
        // `LIFE-CONTRACT-EX-6` forbids exactly this from either side. The escape
        // hatch survives; what it may not do is pre-write the line.
        `If the moment genuinely feels thin, make it less thin in the same breath: put someone in position to say the thing worth testing — then let the QUESTION be that line. Do NOT write it as a beat first; it lands as their bubble when the player answers.`
      : `${streak} narrative picks without practice — a graded moment is DUE. Place it where it genuinely FITS, not necessarily on this node: the player about to SAY something, an NPC about to say something with real content, or something the player is about to READ. If this node is such a moment, use it now. If it is not — mid-action, a scene change, nothing being said — stay narrative and take the next node that is. Do NOT bolt a question onto a moment that has no line in it; a forced question reads as a pop quiz and teaches less than one the story earned.`;

  // LIFE-EX-CADENCE-6 — this line used to say "(no beats, no top-level
  // options)", unconditionally, and it is the reason the lead-in rule kept
  // failing: **25 of 25** act-pick question nodes that shipped with no lead-in
  // came from a turn carrying this instruction. Zero exceptions.
  //
  // Whether a question node may have beats is CONDITIONAL ON THE PICK
  // (`LIFE-CONTRACT-EX-10`): an action pick REQUIRES one lead-in beat and the
  // validator rejects its absence; a speech pick requires none. `leadInDirective`
  // already renders exactly that, per turn, in the `<turn>` tag, and agrees with
  // the validator. This block was a second, louder, unconditional answer to a
  // question that was already correctly answered — so it stops answering it.
  // "No top-level options" is unconditional and stays.
  const shape =
    `Emit kind "question" with a gradedPlan and NO top-level options (its chips are authored elsewhere; see <leadIn> for whether this node opens with a beat).`;

  // LIFE-EX-18 — the two rules below used to hang off the slot KIND, and when
  // the kind rotation was deleted they went with it. Both had measurements
  // behind them and NEITHER of them actually needed a slot kind, which is the
  // tell that they were attached to the wrong thing in the first place.
  //
  //   · **The tested line has not been said yet.** Was the comprehension slot's
  //     rule, against a 23-32% leak rate. It is true of a fill-blank too (the
  //     player's line is equally unsaid) and `LIFE-CONTRACT-EX-6` forbids the
  //     leak from either side — so it is unconditional, and now stated once.
  //   · **After a `say` pick, production rides the option.** Was the fill-blank
  //     slot's rule (**40 of 40** post-`say` fill-blank NODES came from a
  //     `kind="fill-blank"` slot). It is conditional on the PICK, not the kind:
  //     the player has already spoken, so a fill-blank node has nothing left to
  //     intercept (`LIFE-SPEECH-3`) — while a comprehension of the REPLY is the
  //     natural next move (`LIFE-SPEECH-4`).
  const unsaid =
    ` The tested line has NOT been said yet — never write it as a beat first; it lands as a bubble when the player answers.`;
  const afterSay =
    input.pickedSpeechAct === 'say'
      ? ` NOTE: the player has ALREADY spoken this turn, so a fill-blank node has nothing left to intercept. If this node is the question, make it a comprehension of the REPLY; to have them produce language again, mark \`gradeTarget\` on a "say" option out of this node instead (see OUTBOUND GRADING).`
      : '';

  return (
    `<practiceCadence streak="${streak}" tier="${tier}">${body}\n${shape}${unsaid} Pick a FRESH testTarget that is NOT in <recentlyPracticed>. EXCEPTION: if every viable target has been practiced, stay narrative — never recycle a recently-practiced target just to satisfy cadence.${afterSay}</practiceCadence>`
  );
}

/**
 * Moved here from `step.ts` (LIFE-EX-CADENCE-6), which was one line over the
 * 600-LOC cap after this module learned about the pick.
 *
 * It belongs here on its own merits, not just for the budget: this file's header
 * defines it as "pure reductions over the events log with no prompt-rendering
 * concerns", and that is exactly what this is. It also feeds `<recentlyPracticed>`,
 * which the cadence block above REFERS TO by name — the counter and the directive
 * that spends it are now readable together, which is the same argument that moved
 * `renderPracticeCadence` here in the first place.
 */
/** Pull every distinct fill-blank target practised since the current
 *  chapter started. Caps at 20 so the prompt block doesn't grow
 *  unbounded. Comprehension targets are full sentences and don't
 *  reuse the same way — only fill-blank tokens are tracked. */
export function recentlyPracticedTargets(
  events: ReadonlyArray<StepEvent>,
  chapterStartedAtMs: number | null,
): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'correction') continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (p.kind !== 'generation') continue;
    if (chapterStartedAtMs !== null) {
      // The client held a Firestore `Timestamp` and called `.toMillis()`; the
      // wire carries the millisecond number the call site reads off it. Same
      // comparison, same `null` meaning "undated, so never filtered out".
      const ts = typeof e.createdAtMs === 'number' ? e.createdAtMs : null;
      if (ts !== null && ts < chapterStartedAtMs) continue;
    }
    const target = typeof p.correctAnswer === 'string'
      ? p.correctAnswer.trim().toLowerCase()
      : '';
    if (target) seen.add(target);
  }
  return Array.from(seen).slice(-20);
}

// ── option grid (render half) ────────────────────────────────────────────
/** How many past option sets the model is shown, so it can avoid repeating a
 *  shape. Small on purpose — this rides in the volatile zone of the prompt
 *  (below the cache boundary), so every row costs on every turn. */
export const RECENT_ACTIONS_WINDOW = 8;

/** One offered option, reduced to the shape that matters for variety. */
export type ActionShape = { type: OptionType; targetId: string | null };

/**
 * LIFE-GRID-5 — the required type for this turn.
 *
 * Rotates deterministically so the spread is guaranteed rather than requested,
 * and so two adjacent turns cannot demand the same thing. `ask` is deliberately
 * absent from the rotation: asking is the model's default and needs no
 * encouragement — the rule exists to force the OTHER kinds.
 *
 * Keyed on the turn counter, so it is reproducible for a given world and shows
 * up identically in a replay.
 */
const ROTATION: readonly OptionType[] = ['do', 'move', 'observe', 'offer'];

export function requiredTypeForTurn(turnIndex: number): OptionType {
  const i = Math.abs(Math.trunc(turnIndex)) % ROTATION.length;
  return ROTATION[i]!;
}

export function renderRequiredType(t: OptionType): string {
  const gloss: Record<OptionType, string> = {
    ask: 'ASK a question',
    do: 'DO something physical — act on an object, a task, or a person',
    move: 'MOVE — go somewhere, follow someone, leave for another place',
    observe: 'OBSERVE — look closer, listen, wait, read',
    offer: 'OFFER or DECIDE — propose, agree, refuse, change the subject',
    leave: 'LEAVE the situation',
  };
  const lines = [
    `<requiredAction type="${t}">At least ONE option this turn MUST be a ${gloss[t]} option. ` +
      `Not a variation on the others — a genuinely different kind of move, grown from what is actually here.</requiredAction>`,
    // LIFE-INTENT-1 PRECEDENCE, stated HERE rather than only in the rules far
    // above. Measured 2026-08-04: the player grabbed someone by the collar and
    // the grid came back "Tighten the main pipe with the wrench | Ask him about
    // the lower pasture | Walk away from the pump" — a rotation-satisfying `do`
    // option grown from the SCENE while the moment had just changed underneath
    // it. The relevance rule existed and said exactly the right thing; it sits
    // ~500 lines up in the cached prefix, while this block rides in the
    // volatile tail beside the turn itself. Two rules at different distances
    // from the decision, and the nearer one won.
    //
    // So the precedence is written where the conflict is resolved. Costs one
    // line and no tokens anywhere else.
    `<requiredAction type="relevance">THE MOMENT OUTRANKS THE ROTATION. Every option must be a plausible next move from the LAST BEAT — from what just happened, not from what the scene is nominally about. If the required type above cannot be grown from this moment without reaching back past it, DROP IT and write three options that follow. A grid that answers the scene while ignoring what the player just did is the failure this pair of rules exists to prevent, and the rotation is the half that yields.</requiredAction>`,
  ];
  // LIFE-GRID-1.2, PREVENTED rather than rejected. `observe` and `ask` are both
  // passive, so on an `observe` turn nothing forced an option that acts on the
  // world — and the first playthrough produced three all-passive grids, each of
  // which `gradeOptionSet` could only catch after the call was already paid
  // for. Naming the requirement up front costs one line.
  if (!ACTIVE_OPTION_TYPES.includes(t)) {
    lines.push(
      `<requiredAction type="active">Separately, at least one option must let the player ACT on the world — do, move, offer or leave. ` +
        `A set that only asks and looks is an interrogation, and the player is just tapping for exposition.</requiredAction>`,
    );
  }
  return lines.join('\n');
}

/**
 * The `<recentActions>` block — the cross-turn memory the grid never had.
 * Mirrors `<recentlyPracticed>`, which works for exactly the same reason.
 *
 * Fed the OFFERED sets where they are available (the harness) and the TAKEN
 * ones where only the log survives (the app), so the copy says "already in
 * play" rather than claiming either.
 */
export function renderRecentActions(recent: readonly ActionShape[]): string {
  if (recent.length === 0) return '';
  const window = recent.slice(-RECENT_ACTIONS_WINDOW);
  // LIFE-GRID-6: the COUNT is the new half. The block already listed the
  // shapes and already said "do not offer them again", and 12.6% of picks were
  // re-offered anyway (measured over 2,016 grids). A flat list cannot
  // distinguish "the player asked about the letter once" from "the player has
  // gone for the letter three times and been refused three times", and it is
  // only the second that reads as the world dangling something it will not
  // give. Naming the number is what makes the rule below actionable.
  const counts = new Map<string, number>();
  for (const a of window) {
    const k = shapeKey(a);
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const rows = [...counts]
    .map(([k, n]) => (n > 1 ? `${k} ×${n}` : k))
    .join(' · ');
  // A GOAL, not a verb. `<dangledGoal shapes="ask">` is not a sentence about
  // anything, and the model asked to "let it happen or close it off" for the
  // act of asking has nothing it can do. Only shapes that name an entity are
  // eligible — same call `goalKey` makes for the machine check, so the block
  // the model reads and the rule that rejects it cannot describe different
  // things. (They DID, for one commit: see `goalKey`.)
  const repeated = [...counts]
    .filter(([k, n]) => n >= 2 && k.includes(':'))
    .map(([k]) => k);
  const lines = [
    `<recentActions>${rows}</recentActions>`,
    `<recentActionsRule>Those shapes are already in play. Do NOT offer them again — the situation has moved on, and a grid that repeats itself is the single thing players notice most. A different verb on the same target is still a repeat.</recentActionsRule>`,
  ];
  // LIFE-GRID-6 — the DANGLED GOAL rule, and it only appears when there IS one.
  // Owner, 2026-08-06: "the story kept pushing in the direction of taking the
  // letter, but every time I tried the NPC denied it. What was the point in
  // leading me down these roads only to shut my options down?"
  if (repeated.length > 0) {
    lines.push(
      `<dangledGoal shapes="${repeated.join(' · ')}">The player has ALREADY TRIED these, more than once, and is still here — so the world has been refusing them. Offering the same thing a third time is the story dangling something it will not give, which reads as the game wasting the player's time. Pick ONE: (a) LET IT HAPPEN this turn — they have earned it by trying; or (b) CLOSE IT — have someone say plainly why it will never work, and make this turn's options about something else entirely. What you may NOT do is offer it again unchanged. A refusal that costs nothing and changes nothing is not a story beat, it is a wall.</dangledGoal>`,
    );
  }
  return lines.join('\n');
}
/**
 * `DANGLE_TAKES` LIVED beside these two and did NOT cross: it is the REJECT
 * half's threshold (`gradeOptionSet` counts takes against it) and nothing here
 * reads it. Porting it would have put an unread constant server-side, which is
 * the `optionRules` shape one file over.
 */

/** The key `<recentActions>` DISPLAYS. A targetless option collapses to its
 *  bare verb here, which is fine for a list the model reads — but fatal as a
 *  dangle key, which is why `goalKey` exists below. */
export function shapeKey(a: ActionShape): string {
  return `${a.type}${a.targetId ? `:${a.targetId}` : ''}`;
}

/**
 * LIFE-GRID-6 — the DANGLE key. `null` for an option that acts on nothing
 * specific, and a null key is never counted and never checked.
 *
 * THE BUG THIS FIXES, because it is the whole lesson. The rule was chosen from
 * a measurement (2.2% of grids) and then implemented against a DIFFERENT key
 * from the one measured. The measurement keyed a targetless option by its
 * LABEL — near-unique, so targetless picks essentially never collided. The
 * implementation used `shapeKey`, which collapses a targetless option to its
 * bare verb: two targetless `ask` picks, which is nothing at all in a
 * conversation game, and every later grid containing any targetless `ask` was
 * rejected as a "dangled goal".
 *
 * Caught by a real playthrough on 2026-08-06 and then measured over all 2,026
 * archived grids:
 *
 *     bare-verb key (shipped, wrong)   75.7%   — five times the ~15% ceiling
 *     targeted-only key, taken >= 2     7.1%   — chosen
 *     targeted-only key, taken >= 3     2.5%
 *     targeted-only key, taken >= 1    19.5%   — over the ceiling
 *
 * At 75.7% it was not a backstop, it was a tax: three quarters of turns paying
 * a second generation to be told *"option 'ask' is a goal the player has
 * already taken 8 times"*, which is not a sentence about anything.
 *
 * A DANGLED GOAL IS A THING THE WORLD KEEPS REFUSING — the letter, the ledger,
 * the door. "Ask" is not a goal, and neither is "move". If an option names no
 * entity, it cannot be the thing the story is dangling.
 */
export function goalKey(a: ActionShape): string | null {
  return a.targetId ? `${a.type}:${a.targetId}` : null;
}
/**
 * LIFE-GRID-4 — recover the recent action shapes from the append-only log.
 *
 * The offered SETS are not persisted (only the pick is), so this reads the
 * `decision` events: what the player actually took, in order. That is the
 * weaker of the two possible histories and it is the honest one — it is what
 * the log contains. It is still the memory the grid never had, and it is what
 * stops the same shape being offered turn after turn.
 *
 * `actionType` is optional on the payload because worlds created before
 * LIFE-GRID-1.1 have decision events without it. Those rows are skipped rather
 * than guessed at: a wrong shape in this block is worse than a missing one,
 * because the model is told not to repeat it.
 */
/** Fold the accepted set into the rolling window the next turn will see. */
export function pushRecentActions(
  recent: readonly ActionShape[],
  offered: readonly ActionShape[],
): ActionShape[] {
  return [...recent, ...offered].slice(-RECENT_ACTIONS_WINDOW);
}

export function actionShapesFromEvents(
  events: readonly { kind: string; payload?: Record<string, unknown> }[],
): ActionShape[] {
  const out: ActionShape[] = [];
  for (const e of events) {
    if (e.kind !== 'decision') continue;
    const t = e.payload?.actionType;
    if (typeof t !== 'string' || !OPTION_TYPES.includes(t as OptionType)) continue;
    const target = e.payload?.targetId;
    out.push({ type: t as OptionType, targetId: typeof target === 'string' ? target : null });
  }
  return out.slice(-RECENT_ACTIONS_WINDOW);
}

const OPTION_TYPES: readonly string[] = OPTION_TYPE_VALUES;

// ── speech blocks ────────────────────────────────────────────────────────
/**
 * LIFE-SPEECH-2 / LIFE-SPEECH-6 — "that line is already on screen; do not say
 * it again".
 *
 * ONE builder for the two branches that need it. The `say`-PICK branch has had
 * this note since LIFE-SPEECH-2; the graded `practiceOutcome` branch needed the
 * identical thing and, having been written separately, simply did not have it —
 * which is how a fill-blank's completed sentence came back out of an NPC's
 * mouth. Two call sites that must say the same thing is exactly the shape that
 * drifts, so they now share the words.
 */
export function renderAlreadySpoken(
  line: string | null | undefined,
  by?: 'user' | 'npc' | 'narrator' | null,
): string {
  const said = line?.trim();
  if (!said) return '';
  // `by` is omitted for the player — that is the default reading, and the note
  // can then name the bubble as theirs, which is the sharper phrasing.
  const other = !!by && by !== 'user';
  const who = other ? ` by="${escapeAttr(by)}"` : '';
  const whose = other ? 'on screen' : "on screen as the player's own bubble";
  return (
    `\n  <alreadySpoken${who}>${escapeText(said)}</alreadySpoken>\n`
    + `  <note>That line is ALREADY ${whose}. Do NOT repeat it, paraphrase it, or put it in any character's mouth — least of all an NPC's. Start from the moment AFTER it was said: the reply, the reaction, what happens next.\n`
    // LIFE-CONTRACT-BUBBLE-5 — the ONE beat needs a SPEAKER, and this sentence
    // never said which. It offers "the reply, or one short reaction", and a
    // reaction is narration — but the model has one slot, an NPC who is
    // reacting, and the line test three sections away in the SI. So it writes
    // the narration into the NPC's bubble: "Padrig attrape la pièce avec un
    // sourire large" appears under Padrig's avatar as something Padrig SAID.
    //
    // MEASURED, and it is the one place the count climbs: 7% of npc beats in
    // the full arm, 14% in the lean arm, 22% after `LIFE-EX-CADENCE-7` raised
    // the number of `say` picks — of which **12 of 17 followed a `say` pick**.
    // The production fix amplified it; the cause is this sentence being silent
    // on the distinction at the exact point the choice is made.
    + '  IT ALSO COSTS A SLOT (LIFE-LANG-13.1 event budget): that bubble already occupies one of the two the player can see, so THIS node adds AT MOST ONE more beat. That beat is EITHER the reply — an "npc" beat carrying their words and nothing else — OR one short reaction, which is a "narrator" beat, ALWAYS. "Padrig grabs the coin and turns to the shelves" is narration ABOUT Padrig, not something Padrig says; it can never be an npc beat, however obviously it is his moment. Two fresh beats here make three bubbles competing for two slots, and the player\'s own words are what scrolls away.</note>'
  );
}

/**
 * LIFE-COST-4 — the lead-in rule, INJECTED per turn instead of stated in the SI.
 *
 * ── WHY THIS AND NOT ANOTHER REWORDING ──────────────────────────────────────
 *
 * Four attempts have now failed to move `question-omits-lead-in` by editing the
 * system instruction: removing a flat contradiction, adding the missing worked
 * example, adding an AGENDA + PRECEDENCE layer, and (partly) the lean rewrite.
 * The first three moved nothing measurable (`LIFE-CONTRACT-EX-9`,
 * `LIFE-PRECEDENCE-1`); the fourth cut the rate but did not clear it.
 *
 * The signature across all of them is the same: the model fails on attempt 0
 * and complies **100% of the time on attempt 1**, when the retry hint says the
 * same thing the SI already said. A rule that works when repeated at the point
 * of use and fails when stated once, far away, is not misunderstood — it is not
 * SALIENT. So the fix is placement, not wording.
 *
 * This rides in the VOLATILE tail, immediately inside the `<turn>` tag the
 * model is answering, and only on the turns where it applies. ~40 tokens, and
 * they are tokens the implicit cache never covers anyway (`LIFE-CTX-14`: the
 * last few thousand tokens of any prompt are never cached), so it is close to
 * free even by the old cost model.
 *
 * ── THE SECOND RULE IS STATED WITH THE FIRST, DELIBERATELY ──────────────────
 *
 * `LIFE-CONTRACT-EX-8` records the trap: telling the model to narrate "the
 * world reacting" makes it write the NPC's reply, which IS the line under test,
 * so the leak-repair strips the beat — leaving a question with no lead-in, which
 * `LIFE-CONTRACT-EX-7` then rejects. Measured again in the lean arm: 3 of 12
 * rejections were exactly that loop. Two rules that point at each other cannot
 * be satisfied one at a time, so this states both bounds in one breath: narrate
 * the ACTION and what physically answered it, never a spoken line.
 *
 * ── THE `say` BRANCH IS NOW BACKED BY THE VALIDATOR, WHICH IT WAS NOT ───────
 *
 * When this shipped, the `say` branch told the model to emit `"beats": []` and
 * `validateStep` rejected precisely that — it exempted only `hear` (a value
 * since retired, LIFE-SPEECH-8). Making the
 * model obey RAISED the retry rate: all nine new rejections in the first
 * measured arm were `say` picks. `LIFE-CONTRACT-EX-10` fixed the validator, so
 * the instruction and the check now agree. **This directive is only safe while
 * they do** — if either side changes, change both.
 */
export function leadInDirective(speechAct: string | null | undefined): string {
  if (speechAct === 'act') {
    return (
      `<leadIn>This pick was an ACTION. If you make this node a question, it MUST open with exactly ONE narrator beat` +
      ` landing what the player just did and what physically answered it — what moved, opened, spilled, went quiet.` +
      ` NEVER a spoken line, and never the line the question is about to test: the character being tested has not` +
      ` spoken yet, and writing their words here deletes the question.</leadIn>`
    );
  }
  if (speechAct === 'say') {
    return (
      `<leadIn>This pick was the player SPEAKING, and their line is already on screen. If you make this node a` +
      ` question, emit "beats": [] — the pick was the speaking, so there is nothing left to narrate first.</leadIn>`
    );
  }
  return '';
}