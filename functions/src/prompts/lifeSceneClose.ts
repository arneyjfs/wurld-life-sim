/**
 * LIFE-ARCH-4 — `sceneClose`. The single most important call in the design.
 *
 * Spec: docs/specs/story-architecture.md §3, §5.
 *
 * Replaces `sceneReplan` entirely and does FOUR jobs in ONE generation:
 *   1. compact the scene into one line of saga history,
 *   2. advance clocks (a delta + a reason per front),
 *   3. revise latent cast state,
 *   4. hand back the scene's new canon entities.
 *
 * Compaction is therefore FREE — this call already has the scene log in context
 * to judge the clocks, so folding the summary into the same response costs no
 * extra call. That was the owner's explicit requirement.
 *
 * WHY IT REPLACES REPLAN. The audit's #1 finding: `sceneReplan`'s prompt carried
 * only the outline and recent events — no saga, no chapter, no canon. The one
 * mechanism that adapted the plan to the player could not re-anchor to the
 * story, so it could only ERODE the outline it was handed. This call sees
 * everything.
 *
 * TWO RULES THAT ARE STRUCTURAL, NOT ASKED FOR:
 *
 *  - **Deltas only.** A model asked to re-emit the cast REWRITES the cast, and
 *    that is the telephone-game drift mutability buys us. Asked instead for
 *    "which fields changed, and to what", untouched things stay untouched by
 *    construction. It also cuts output tokens hard.
 *  - **Canon fields are not in the schema.** `known`, entity ids and names
 *    cannot be emitted here at all, so a revision cannot contradict witnessed
 *    truth (LIFE-ARCH-2.1). Impossible by construction beats checked-for — and
 *    a general semantic contradiction check is not implementable anyway.
 *
 * ── SRV-PROMPT-8..13 batch 4 ────────────────────────────────────────────────
 *
 * Moved here from `src/lib/life/prompts/sceneClose.ts`, which is DELETED
 * (SRV-PROMPT-3). The client sends `promptSpec: {kind:'life_scene', …}` and
 * `prompt: ''`.
 *
 * ⚠ THE KIND IS `life_scene` AND IT IS THE **CLOSE**. `life_scene_gen` is the
 * OPEN. Inverted-looking and NOT a typo — see `lifeSceneOpen.ts`'s header and
 * the same warning in `functions/src/observability/queries.ts`.
 *
 * ⚠ `life_scene` IS NOT THE EXPLICIT-SI-CACHE CATEGORY, WHATEVER
 * `LIFE-BACKDROP-14` SAYS. That invariant's prose names `life_scene` as the one
 * allowlisted category, and it is STALE by one rename: `LIFE-BACKDROP-22` moved
 * the backdrop generator's category from `life_scene` to `life_backdrop` and
 * explicitly removed *"`life_scene` aliases in the SI-cache set"*. Today
 * `explicitSiCache.ts`'s `SERVER_OWNED_SI` holds `life_backdrop` and nothing
 * else, and `LEGACY_DOC_PATHS` pins `system/backdropContextCache` to
 * `life_backdrop` — so the published cache record belongs to the backdrop, and
 * this kind has never had one. Adding one is dealt with below.
 *
 * ── WHAT THE SPEC CARRIES, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 *
 * Not a `LifeWorld`, not a `Front`, not a `CastMember`. A front sends id, kind,
 * driver, agenda and the three clock numbers this prompt renders — and NOT
 * `name`, `scope`, `peak`, `unattended`, `sinceAdvance` or `resolved`, which are
 * engine bookkeeping the model has never been shown. A cast member sends no
 * `known`: LIFE-ARCH-2.1 keeps witnessed truth out of the RESPONSE schema, and
 * there is no reason for the close to be reminded of it in the prompt either.
 *
 * THE CLOCKS DO TRAVEL HERE, which inverts LIFE-FRONT-1.1's rule for every
 * other prompt. That is deliberate and it is the whole job: this is the only
 * caller that decides deltas, and "how much closer did it get" cannot be judged
 * without knowing where it stands.
 */

/**
 * ⚠ DUPLICATED FROM `src/lib/life/fronts.ts`, AND THIS ONE DOES NOT EXPIRE.
 *
 * The SI states the budget in prose; `applyClockDeltas` ENFORCES it in the
 * client engine, which is not a prompt and never migrates. So this is the
 * `avatar/parts.ts` shape — two live copies of one number that must agree —
 * rather than batch 1's gloss tables or `lifeStoryStage.ts`'s ladder, which
 * re-converge when their last client consumer moves.
 *
 * Drift is invisible and expensive in the boring direction: the model is told
 * it may move a clock by 3, `applyClockDeltas` clamps it to 2, and every close
 * silently discards part of a judgement the model was invited to make. The
 * parity guard at `tests/playthrough/serverPromptParity.test.ts` asserts the two
 * copies against each other and carries NO expiry, deliberately.
 *
 * Sending them up in the spec was rejected for the reason batch 2 rejected
 * sending the avatar part names: they are interpolated verbatim into the SI, so
 * a client supplying them could write into a system instruction — this
 * migration's own hole, reached from the other direction.
 */
export const DELTA_PER_FRONT = 2;
export const DELTA_BUDGET = 2;

/** One cast member, narrowed to what the close RENDERS. No `known`: witnessed
 *  truth is absent from the response schema (LIFE-ARCH-2.1) and has no job in
 *  the prompt either. No `voice`/`ties`/`limit`/`wrongAbout`: the close may
 *  CHANGE them, but it does not need them read back to do so — it emits
 *  deltas, not a rewritten cast. */
export type SceneCloseCastMember = {
  id: string;
  name: string;
  tier: "principal" | "regular";
  standing: number;
  wants?: string;
  nextMove?: string;
  routine?: string;
};

/** One front, narrowed to what the close renders. `peak` / `unattended` /
 *  `sinceAdvance` / `scope` / `name` / `resolved` are engine bookkeeping and do
 *  not cross. */
export type SceneCloseFront = {
  id: string;
  kind: string;
  driverId: string;
  agenda: string;
  clock: { filled: number; size: number; consequence: string };
};

export type SceneClosePromptInput = {
  /** The scene's beats, oldest → newest, as plain lines. The 24-line slice
   *  runs here — it decides what the model sees. */
  sceneLog: readonly string[];
  subject: string;
  atStake: string;
  cast: readonly SceneCloseCastMember[];
  fronts: readonly SceneCloseFront[];
  /** LIFE-GOAL-11: the live near objective, so the close can rule on whether
   *  it survived the scene. Absent/null when there is none — the block is then
   *  omitted entirely rather than asking for a verdict on nothing, which would
   *  invite the model to invent an objective to have an opinion about. */
  objective?: { id: string; text: string } | null;
};

export function sceneCloseSystemInstruction(opts: { realistic: boolean }): string {
  return [
    `You are closing a scene in a life simulator and updating the world's state. Answer in English — this is bookkeeping, not storytelling.`,
    ``,
    `YOUR FOUR JOBS:`,
    ``,
    `1. HISTORY — one line, past tense, SECOND PERSON ("You agreed to…", "Sofia told you…"), describing what CHANGED in this scene.`,
    `   The person is fixed and not a stylistic choice: these lines are read back to the player as the story of their own life, in order. A run that says "I signed the petition", then "Marc learned that…", then "You discovered…" is three different narrators over three scenes. Never "I", never the player's name — always "you".`,
    `   Write what is now different: who decided something, who refused, what was learned, who turned out not to be what they seemed, what was finished or abandoned.`,
    `   Do NOT write that pressure mounted, that time is running short, or that things got worse. A history of escalations is not a story, it is a countdown — and read back over ten scenes it is the single clearest sign this world has gone wrong.`,
    `   Do NOT write the player SUCCEEDING every time either. "Successfully retrieved… successfully evaded… successfully infiltrated…" read back is not a story, it is a highlight reel, and it is the same defect facing the other way. Most scenes are partial: they got the thing and were seen doing it; they were let in but not told why; they won the argument and lost the room. Write the cost as well as the gain.`,
    `   If genuinely nothing changed, say so plainly: "An ordinary morning at the market; nothing moved." That is a legitimate and common answer.`,
    ``,
    `2. CLOCKS — how much closer did each pressure get, if any?`,
    `   **THE NORMAL ANSWER IS AN EMPTY LIST.** Most scenes move nothing. A pressure advances when the player LEFT IT ALONE and it had room to act, or retreats when the player did something about it.`,
    `   You may move a clock by at most ${DELTA_PER_FRONT}, and at most ${DELTA_BUDGET} across ALL fronts combined. If you find yourself moving every front, you are narrating a countdown rather than reading a scene — pick the one that actually moved and leave the rest.`,
    `   Negative deltas are free and encouraged when the player earned them.`,
    `   Give a one-clause reason for every delta. A delta you cannot justify from the scene log did not happen.`,
    ``,
    `3. CAST — what CHANGED about these people, and nothing else.`,
    `   Emit a row ONLY for someone this scene actually changed. Leaving a person out is the normal case and is not laziness — it is how the world stays consistent.`,
    `   You may change: standing (how they feel about the player, -3..3), wants, nextMove, limit, routine, voice, tier, ties, wrongAbout.`,
    `   You may NOT change who they are or what the player has already witnessed about them — those fields are not available to you here, deliberately.`,
    `   STANDING is a SLOW axis, and what the rails mean is fixed: 0 is neutral, ±1 is "warm / cool toward you", ±2 is "will go out of their way for you / avoids you", and ±3 is "would break a rule for you / will not speak to you again". ±3 should be reached a handful of times in a whole life, if ever — it is where a relationship ARRIVES, not where it passes through. One scene moves someone one step at most.`,
    `   STANDING SHOULD MOVE BOTH WAYS over a life. Someone who only ever warms to the player is not a person, and someone who only ever cools is a countdown wearing a face.`,
    `   PROMOTE a regular to principal when the story has turned to them (give them wants + nextMove), and DEMOTE a principal to regular when it has moved on (give them a routine). This is how a cast breathes; use it.`,
    ``,
    `4. SITUATION — the 2-3 sentence "where the player stands now", rewritten ONLY if this scene actually moved it. Otherwise return null.`,
    ``,
    `REVERSALS ARE ALLOWED AND WELCOME (this is the one place they can happen):`,
    `A front's driver may turn out to be someone else. A person's wants may turn out to be different from what everyone assumed. A tie may turn out to run the other way.`,
    `The ONLY constraint: it must be consistent with what the player has actually WITNESSED. Someone the player saw being kind may still have wanted the shop all along — the kindness happened, the motive was never stated. That is a fair reversal. Contradicting something the player saw with their own eyes is not.`,
    ``,
    opts.realistic
      ? `REGISTER — REALISTIC. Nothing you write may escalate beyond social, professional, financial or personal cost.`
      : `REGISTER — FANTASY. The world's own rules are the only ceiling.`,
    ``,
    `NEW CANON — anything introduced this scene that the player MET: people, places, objects, facts. Id + name + one line. If nothing new appeared, an empty list.`,
    ``,
    `THE OBJECTIVE (LIFE-GOAL-11) — when <objective> is present you MUST return objectiveVerdict. You have just read the whole scene, so you are the only caller that can tell:`,
    `  "achieved"  — the player actually did the thing. Not "made progress"; did it.`,
    `  "overtaken" — the scene left it behind: it is done FOR them, impossible now, or the story has plainly moved somewhere else. Give objectiveBecause, ONE clause, in fiction ("the bridge was shut before you could ask"). The player is SHOWN that sentence, so a reason like "no longer relevant" is not one.`,
    `  "stands"    — still live and still worth doing. THIS IS THE NORMAL ANSWER; most scenes end with the objective intact.`,
    `An "overtaken" with no objectiveBecause is discarded and read as "stands" — a goal that disappears with nothing to show the player is the thing this rule exists to prevent.`,
    ``,
    `OUTPUT — JSON only, no prose, no fences:`,
    `{`,
    `  "history": "one past-tense line about what CHANGED",`,
    `  "clockDeltas": [{ "frontId": "...", "delta": -2..2, "reason": "one clause" }],`,
    `  "castChanges": [{ "id": "...", "standing": 0, "wants": "...", "nextMove": "...", "limit": "...", "routine": "...", "voice": "...", "tier": "principal|regular", "wrongAbout": { "aboutId": "...", "believes": "..." } }],`,
    `  "situation": "rewritten only if it moved, else null",`,
    `  "newCanon": [{ "id": "kebab-slug", "name": "...", "kind": "person|place|object|fact", "note": "one line" }],`,
    `  "objectiveVerdict": "achieved|overtaken|stands",`,
    `  "objectiveBecause": "one clause, only when overtaken"`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSceneClosePrompt(input: SceneClosePromptInput): string {
  const rows: string[] = [
    `<scene subject="${esc(input.subject)}" atStake="${esc(input.atStake)}"/>`,
    `<whatHappened>\n${input.sceneLog
      .slice(-24)
      .map((l) => `  <beat>${escT(l)}</beat>`)
      .join("\n")}\n</whatHappened>`,
    `<cast>\n${input.cast
      .map(
        (c) =>
          `  <person id="${esc(c.id)}" name="${esc(c.name)}" tier="${c.tier}" standing="${c.standing}">` +
          (c.tier === "principal"
            ? `<wants>${escT(c.wants ?? "")}</wants><nextMove>${escT(c.nextMove ?? "")}</nextMove>`
            : `<routine>${escT(c.routine ?? "")}</routine>`) +
          `</person>`,
      )
      .join("\n")}\n</cast>`,
  ];

  // The close DOES see clocks — it is the only caller that decides deltas, and
  // it cannot judge "how much closer" without knowing where things stand.
  if (input.fronts.length) {
    rows.push(
      `<fronts>\n${input.fronts
        .map(
          (f) =>
            // SRV-PROMPT-14 — `kind` was the ONLY raw string at an XML render
            // site across all nineteen server-built kinds, and it sat between
            // `id` and `driver`, which both escape. `ZFrontKind` is a closed
            // seven-value enum client-side, so escaping changes nothing for any
            // honest value — but the server validates it with `nonEmptyStr`,
            // and an enum REJECT here would be worse than the hole: a rejected
            // scene close makes `nodeEngineSceneClose` discard the scene's
            // entire permanent-memory write (clock deltas, cast changes, new
            // canon, the history line) without a word.
            `  <front id="${esc(f.id)}" kind="${esc(f.kind)}" at="${f.clock.filled}/${f.clock.size}" driver="${esc(f.driverId)}">` +
            `<agenda>${escT(f.agenda)}</agenda><ifItFills>${escT(f.clock.consequence)}</ifItFills></front>`,
        )
        .join("\n")}\n</fronts>`,
    );
  }

  // LIFE-GOAL-11: state the objective so the verdict is about something. Only
  // when one is live — see the note on `SceneClosePromptInput.objective`.
  if (input.objective) {
    rows.push(
      `<objective id="${esc(input.objective.id)}">${escT(input.objective.text)}</objective>`,
    );
  }
  rows.push(
    `Close the scene. Remember: an empty clockDeltas list is the normal answer`
    + (input.objective ? `, and "stands" is the normal objectiveVerdict.` : `.`),
  );
  return rows.join("\n\n");
}

/** SRV-PROMPT-1 — the schema travels WITH the prompt it constrains. */
export const SCENE_CLOSE_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    history: { type: "STRING" },
    objectiveVerdict: { type: "STRING", enum: ["achieved", "overtaken", "stands"] },
    objectiveBecause: { type: "STRING" },
    clockDeltas: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          frontId: { type: "STRING" },
          delta: { type: "INTEGER" },
          reason: { type: "STRING" },
        },
        required: ["frontId", "delta", "reason"],
      },
    },
    castChanges: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        // NOTE the absence of `known` and `name` — LIFE-ARCH-2.1. Witnessed
        // truth is not emittable here, so it cannot be contradicted.
        properties: {
          id: { type: "STRING" },
          standing: { type: "INTEGER" },
          wants: { type: "STRING" },
          nextMove: { type: "STRING" },
          limit: { type: "STRING" },
          routine: { type: "STRING" },
          voice: { type: "STRING" },
          tier: { type: "STRING", enum: ["principal", "regular"] },
          wrongAbout: {
            type: "OBJECT",
            properties: { aboutId: { type: "STRING" }, believes: { type: "STRING" } },
            required: ["aboutId", "believes"],
          },
        },
        required: ["id"],
      },
    },
    situation: { type: "STRING" },
    newCanon: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          id: { type: "STRING" },
          name: { type: "STRING" },
          kind: { type: "STRING" },
          note: { type: "STRING" },
        },
        required: ["id", "name", "kind", "note"],
      },
    },
  },
  // LIFE-GOAL-11: `objectiveVerdict` is REQUIRED, and that is the entire
  // mechanism. The step-side `objectiveDone` / `objectiveClosed` are optional
  // and were therefore authored ~never — the same shape as `hear` (4 of 2,110)
  // and `addGoals` (0 of 95). A required field on a call that always runs is
  // not a request the model can forget; it is a question it has to answer.
  // `objectiveBecause` stays optional: it is meaningful only on `overtaken`,
  // and a required reason would be invented on every `stands`.
  required: ["history", "clockDeltas", "castChanges", "newCanon", "objectiveVerdict"],
};

function escT(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function esc(s: string): string {
  return escT(s).replace(/"/g, "&quot;");
}
