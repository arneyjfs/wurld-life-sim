/**
 * LIFE-ARCH — `sceneOpen`. Puts the player somewhere specific, with someone
 * specific, with something at stake RIGHT NOW.
 *
 * Spec: docs/specs/story-architecture.md §3.
 *
 * Replaces `sceneGenerate.ts`, and is far thinner on purpose. Gone:
 * `candidateEndings` (a monotonic funnel — replan could only ever narrow it),
 * `completionTriggers` (authored before the player had acted once),
 * `openBranches` ("safe detours", i.e. detours that did not count) and
 * `estimatedPhaseCount`. Each was a stored future.
 *
 * TWO THINGS IT MUST EMIT THAT THE OLD ONE DID NOT:
 *
 *  - `drawsOn` (LIFE-CANON-6) — canon this scene picks BACK UP. Nothing here
 *    plans a payoff; it makes reuse cheaper than invention, and a thing
 *    returning after five scenes carries new meaning automatically because the
 *    player has changed in between.
 *  - `signOf` (LIFE-FRONT-8) — when a clock is past half, the scene must make
 *    that pressure PERCEIVABLE. Hidden pressure the player cannot see is
 *    indistinguishable from things going wrong for no reason, which turns an
 *    agency design into an on-rails one. This is the field that keeps the game
 *    playable.
 *
 * ── SRV-PROMPT-8..13 batch 4 ────────────────────────────────────────────────
 *
 * Moved here from `src/lib/life/prompts/sceneOpen.ts`, which is DELETED
 * (SRV-PROMPT-3). The client now sends `promptSpec: {kind:'life_scene_gen', …}`
 * and `prompt: ''`; `resolveServerPrompt` validates the spec and builds both
 * halves from here.
 *
 * ⚠ THE KIND IS `life_scene_gen` AND IT IS THE **OPEN**. `life_scene` is the
 * CLOSE. The pair reads inverted and is NOT a typo: these are the wire values
 * `runSceneOpen.ts` / `runSceneClose.ts` have always sent, and renaming either
 * one moves a telemetry bucket and orphans every historical usage doc
 * (SRV-PROMPT-4). `functions/src/observability/queries.ts` carries the same
 * warning beside the same two strings.
 *
 * ── WHAT THE SPEC CARRIES, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 *
 * The client does NOT send a `LifeWorld`, a `Front` or a `CastMember`. It sends
 * the fields this prompt reads, narrowed, and the server rebuilds them
 * field-by-field — and row by row for the five arrays — so an extra key on the
 * wire cannot reach a template.
 *
 * `universe` is narrowed to setting/laws/places: this prompt has never read
 * `era` or `figures`, so they do not cross at all. A front sends id, driver and
 * agenda and NOTHING else (LIFE-FRONT-1.1 — the planner never sees a clock, and
 * the surest way to guarantee that is for the clock not to exist on the wire).
 * A cast member sends no `voice`, `gender`, `voiceRegister`, `limit`, `ties` or
 * `wrongAbout`: the first three are TTS fields, and `wrongAbout` is the raw
 * material for `ironyAvailable`, which is computed at the call site against
 * canon and sent already decided.
 *
 * FOUR THINGS ARE DECIDED IN CODE AT THE CALL SITE and travel already made, not
 * because they are cheap to compute but because each is a rule a model can
 * satisfy by doing nothing:
 *   - `focus` (LIFE-SCENE-2) — whose scene this is, ROTATED;
 *   - `needSign` (LIFE-FRONT-8) — read off clocks that never cross the wire;
 *   - `ironyAvailable` (LIFE-CAST-2) — `wrongAbout` × canon;
 *   - the canon DORMANCY ORDER (LIFE-CANON-6) — longest-away first.
 *
 * FIVE RENDERING RULES STAY HERE, because each decides what the model SEES
 * rather than what the caller has: the six-line history slice, the
 * `RECENT_SUBJECTS_WINDOW`, the whole of `renderSceneFocus`'s wording, the
 * scene-3 canon demand, and the story-stage ladder (`lifeStoryStage.ts`).
 */
import { renderSceneStage, storyStage } from "./lifeStoryStage";

/**
 * How many recent scene subjects the planner is SHOWN. Six is two full
 * rotations at three principals — enough to see a loop forming.
 *
 * ⚠ DUPLICATED from `src/lib/life/sceneFocus.ts`, AND IT DOES NOT EXPIRE. The
 * number does two jobs: here it is a RENDER window, and client-side it is a
 * STORAGE cap — `startScene` slices `world.recentSubjects` to it before
 * writing. A Firestore write cap never migrates, so unlike `lifeStoryStage.ts`
 * these two copies never re-converge; this is the `avatar/parts.ts` shape.
 *
 * It was nearly moved whole, on the reading that it was prompt text alone. The
 * typechecker caught the second consumer, which is the argument for running one
 * before believing a consumer list.
 * `tests/playthrough/serverPromptParity.test.ts` guards the pair, with no
 * stated expiry.
 *
 * `renderSceneFocus` and `renderRecentSubjects` DID move whole: this prompt was
 * their only non-test consumer. `focusForScene` stayed client-side, because the
 * ROTATION is engine bookkeeping over `sceneCount` rather than prompt text.
 */
export const RECENT_SUBJECTS_WINDOW = 6;

/** LIFE-SCENE-2: whose scene this is, decided by `focusForScene` at the call
 *  site. `null` = an ordinary day belonging to nobody's ambition. */
export type SceneOpenFocus = { castId: string; name: string } | null;

/** One cast member, narrowed to what THIS prompt renders. Deliberately not the
 *  app's `CastMember`. */
export type SceneOpenCastMember = {
  id: string;
  name: string;
  tier: "principal" | "regular";
  standing: number;
  known: string;
  /** principals */
  wants?: string;
  nextMove?: string;
  /** regulars */
  routine?: string;
};

/** LIFE-FRONT-1.1 — three fields and no clock. The planner needs to know WHAT
 *  is in motion, not how close it is to landing. */
export type SceneOpenFront = { id: string; driverId: string; agenda: string };

/** The SETTING as this prompt reads it. `era` and `figures` are on the world's
 *  `Universe` and have never been rendered here, so they do not travel. */
export type SceneOpenUniverse = {
  setting: string;
  laws: readonly string[];
  places: readonly string[];
};

export type SceneOpenPromptInput = {
  characterName: string;
  practiceLanguage: string;
  universe?: SceneOpenUniverse;
  situation: string;
  cast: readonly SceneOpenCastMember[];
  /** LIVE fronts only — the filter runs at the call site, which is also the
   *  only place that still holds the clocks. */
  fronts: readonly SceneOpenFront[];
  /** Canon ids + names + how many scenes since each was last in play, ALREADY
   *  ordered longest-dormant-first and capped by `canonDormancy`. */
  canon: readonly { id: string; name: string; note: string; scenesSince: number }[];
  /** Scene-history lines, oldest → newest. The six-line slice runs here. */
  history: readonly string[];
  sceneIndex: number;
  /** LIFE-FRONT-8: ids whose clock is past half. Computed in code — the model
   *  never sees the numbers (LIFE-FRONT-1.1) and never decides the threshold. */
  needSign: readonly string[];
  /** LIFE-CAST-2: principals whose belief the player can now see through. */
  ironyAvailable: readonly { castId: string; believes: string }[];
  focus: SceneOpenFocus;
  /** The subjects of recent scenes — what this one may NOT be about again. */
  recentSubjects: readonly string[];
  /** LIFE-STORY-STAGE-3: how far into its FIRST chapter this world is. */
  chapterNumber?: number;
  chapterTurns?: number;
};

export function sceneOpenSystemInstruction(opts: { practiceLanguage: string }): string {
  return [
    `You are opening the next SCENE of a life simulator. A scene is one situation, about one subject, over roughly 6-12 turns.`,
    `The player reads everything in ${opts.practiceLanguage}, but YOU answer in English — this call plans the scene, it does not write it.`,
    ``,
    `WHAT A SCENE IS: a place, some people, and something at stake right now. That is all.`,
    `WHAT A SCENE IS NOT: a plot. Do NOT decide how it ends, do NOT list possible endings, do NOT write conditions for when it is over. The player decides what happens; you decide where they are standing when they start deciding.`,
    ``,
    `THE SUBJECT is the ONE thing this scene is about, in a handful of words. It is the test a beat has to pass to belong here — a beat serving a different subject IS the next scene.`,
    ``,
    // LIFE-INTENT-2. The subject alone is a DESTINATION, and a destination is
    // why 19 measured scenes all read as "acknowledged, but on a fixed path":
    // a pick can colour the journey and never change where it goes, because
    // there is nowhere else to go. The open question is somewhere else to go.
    `THE OPEN QUESTION is what this scene is UNSETTLED on — the thing that could come out more than one way. "Will Bruno give up the machinery?" "Does she believe you?" "Do they get the harvest in before the rain?"`,
    `Write it as a QUESTION, in the present tense, and name NO answer. Do not list candidate outcomes, do not decide which one is likely, do not write "and probably X". You are not allowed to know how it comes out — that is the player's to move, and it is the whole reason this field exists.`,
    `It is NOT a condition for the scene being over. A scene can end with its question unanswered, and often should: an attempt met with silence is a real ending.`,
    ``,
    `PICK IT UP, DON'T MAKE IT UP (load-bearing):`,
    `You are given <canon> — everything the player has already met — with how many scenes since each was last in play. Your scene MUST draw on at least one of them, and you should prefer the ones that have been away a while. A person or a place returning after several scenes carries meaning that a brand-new one cannot, because the player has changed in between.`,
    `List what you pick up in "drawsOn". Do not invent a stranger with an errand when someone the player already knows has a reason to be there.`,
    ``,
    `WHAT IS IN MOTION:`,
    `<fronts> are the pressures already running in this world — each has an agenda (what it is trying to achieve) and a driver. They are not your plot; they are weather. A scene may lean into one, ignore all of them, or be about something entirely ordinary.`,
    `IF a front id appears in <makePerceivable>, this scene MUST contain a concrete, physical SIGN of it — something the player can SEE or be TOLD, with edges. "Bébert has been to the landlord twice this week." "There is a surveyor's tape across the shopfront." NOT a warning, NOT a portent, NOT anyone saying "there is something you should know". Put that front's id in "signOf".`,
    `The player cannot steer a pressure they cannot perceive, and a world where things quietly get worse for invisible reasons is not a game. This is the most important instruction on this page.`,
    ``,
    `IRONY, WHEN OFFERED:`,
    `<ironyAvailable> lists people who believe something the player now knows is false. That gap is the best material you have — a scene where the player knows more than the person in front of them writes itself. Use it when it fits; never explain it.`,
    ``,
    `WHOSE SCENE THIS IS:`,
    `<focus> names the person this scene turns on, or says it belongs to nobody. That choice is already made — do not re-decide it. It rotates deliberately so the world does not become about one person, which is the failure this field exists to prevent.`,
    `<alreadyBeenAbout> lists what recent scenes were about. Read it before you choose a subject, not after.`,
    ``,
    `TONE: most scenes are ordinary. Someone wants something small, someone else is in the way, and the day goes on. Do NOT reach for drama; the fronts supply all the pressure this world needs, and they supply it slowly.`,
    ``,
    `OUTPUT — JSON only, no prose, no fences:`,
    `{`,
    `  "title": "short label for the scene-complete screen",`,
    `  "where": "the specific place, from <canon> or <universe>.places when possible",`,
    `  "who": ["cast ids present — usually 1-3"],`,
    `  "subject": "the ONE thing this scene is about, a handful of words",`,
    `  "openQuestion": "what this scene is unsettled on, as a question, naming no answer",`,
    `  "atStake": "what could be gained or lost in THIS scene — small, immediate, personal",`,
    `  "drawsOn": ["canon ids this scene picks back up — at least one"],`,
    `  "signOf": "front id if <makePerceivable> named one, else null"`,
    `}`,
  ].join("\n");
}

export function buildSceneOpenPrompt(input: SceneOpenPromptInput): string {
  const rows: string[] = [`<character name="${esc(input.characterName)}"/>`];

  if (input.universe) {
    rows.push(
      [
        `<universe>`,
        `  <setting>${escT(input.universe.setting)}</setting>`,
        ...input.universe.laws.map((l: string) => `  <law>${escT(l)}</law>`),
        ...input.universe.places.map((p: string) => `  <place>${escT(p)}</place>`),
        `</universe>`,
      ].join("\n"),
    );
  }

  rows.push(`<situation>${escT(input.situation)}</situation>`);

  if (input.history.length) {
    rows.push(
      `<whatHasHappened>\n${input.history
        .slice(-6)
        .map((h) => `  <line>${escT(h)}</line>`)
        .join("\n")}\n</whatHasHappened>`,
    );
  }

  rows.push(
    `<cast>\n${input.cast
      .map((c) =>
        c.tier === "principal"
          ? `  <person id="${esc(c.id)}" name="${esc(c.name)}" tier="principal" standing="${c.standing}">` +
            `<known>${escT(c.known)}</known><wants>${escT(c.wants ?? "")}</wants><nextMove>${escT(c.nextMove ?? "")}</nextMove></person>`
          : `  <person id="${esc(c.id)}" name="${esc(c.name)}" tier="regular" standing="${c.standing}">` +
            `<known>${escT(c.known)}</known><routine>${escT(c.routine ?? "")}</routine></person>`,
      )
      .join("\n")}\n</cast>`,
  );

  // LIFE-FRONT-1.1: agenda + driver only. No clock, no consequence — this
  // planner needs to know WHAT is in motion, not how close it is to landing,
  // and `consequence` is the field most likely to produce foreshadowed doom.
  if (input.fronts.length) {
    rows.push(
      `<fronts>\n${input.fronts
        .map((f) => `  <front id="${esc(f.id)}" driver="${esc(f.driverId)}">${escT(f.agenda)}</front>`)
        .join("\n")}\n</fronts>`,
    );
  }

  if (input.needSign.length) {
    rows.push(
      `<makePerceivable>${input.needSign.map((id) => esc(id)).join(" ")}</makePerceivable>`,
    );
  }

  rows.push(renderSceneFocus(input.focus));

  // LIFE-STORY-STAGE-3: what an EARLY scene may be about. Empty once the world
  // is underway, so it costs nothing for the rest of the world's life.
  const stage = renderSceneStage(
    storyStage({
      chapterNumber: input.chapterNumber ?? 1,
      chapterTurns: input.chapterTurns ?? 0,
    }),
  );
  if (stage) rows.push(stage);

  const recentSubjects = renderRecentSubjects(input.recentSubjects);
  if (recentSubjects) rows.push(recentSubjects);

  if (input.ironyAvailable.length) {
    rows.push(
      `<ironyAvailable>\n${input.ironyAvailable
        .map((i) => `  <person id="${esc(i.castId)}" stillBelieves="${esc(i.believes)}"/>`)
        .join("\n")}\n</ironyAvailable>`,
    );
  }

  if (input.canon.length) {
    rows.push(
      `<canon>\n${input.canon
        .map(
          (c) =>
            `  <entity id="${esc(c.id)}" name="${esc(c.name)}" scenesSince="${c.scenesSince}">${escT(c.note)}</entity>`,
        )
        .join("\n")}\n</canon>`,
    );
  }

  rows.push(
    input.sceneIndex >= 2
      ? `Open scene ${input.sceneIndex + 1}. It MUST draw on something already in <canon> — prefer what has been away longest.`
      : `Open scene ${input.sceneIndex + 1}.`,
  );
  return rows.join("\n\n");
}

/**
 * LIFE-SCENE-2 — whose scene this is. MOVED from `src/lib/life/sceneFocus.ts`
 * (SRV-PROMPT-3): this prompt was its last non-test consumer, so unlike the
 * story-stage ladder it is not a duplication and has no expiry.
 *
 * `focusForScene`, the ROTATION, stayed client-side: it is arithmetic over
 * `sceneCount` and the live cast, it is what makes a replay reproducible, and
 * the call site logs its result. What crossed is the WORDING — the part a
 * `deploy:prod:functions` should be able to correct.
 */
export function renderSceneFocus(focus: SceneOpenFocus): string {
  if (!focus) {
    return (
      `<focus kind="ordinary">This scene belongs to NOBODY'S AMBITION. Nothing anyone wants moves forward in it. ` +
      `Someone needs a hand with something small, or a routine goes wrong, or two people the player knows disagree about nothing much. ` +
      `A life is mostly these, and they are what make the other scenes land — do not smuggle the story in through the back of one.</focus>`
    );
  }
  return (
    `<focus castId="${esc(focus.castId)}">This scene turns on ${esc(focus.name)} and what THEY are trying to do. ` +
    `They do not have to be the only person present, but the situation should be theirs.</focus>`
  );
}

/**
 * The subjects of recent scenes, and the rule against repeating one.
 *
 * Mirrors `<recentActions>` in the option grid, which works for exactly the same
 * reason: nothing in the planner's context showed it what it had already done.
 */
export function renderRecentSubjects(subjects: readonly string[]): string {
  const recent = subjects.slice(-RECENT_SUBJECTS_WINDOW).filter(Boolean);
  if (recent.length === 0) return "";
  return (
    `<alreadyBeenAbout>\n${recent.map((s) => `  <subject>${escT(s)}</subject>`).join("\n")}\n</alreadyBeenAbout>\n` +
    `<alreadyBeenAboutRule>Those scenes have happened. This one must be about something ELSE. ` +
    `Learning the same fact again, confirming it, or watching someone restate it is NOT a new subject — if the player already knows it, the scene has nothing to land. ` +
    `A story where every scene is about the same thing reads back as one scene told ten times.</alreadyBeenAboutRule>`
  );
}

/** SRV-PROMPT-1 — the schema travels WITH the prompt it constrains. It is the
 *  half of the artefact that decides what the model may SAY, so leaving it at
 *  the call site would have kept half the tuning surface frozen in the bundle.
 *  `signOf` is deliberately NOT required: a scene with no requested sign has
 *  nothing to name, and `acceptedSignOf` discards an unrequested one anyway
 *  (LIFE-FRONT-8.1). */
export const SCENE_OPEN_SCHEMA: Record<string, unknown> = {
  type: "OBJECT",
  properties: {
    title: { type: "STRING" },
    where: { type: "STRING" },
    who: { type: "ARRAY", items: { type: "STRING" } },
    subject: { type: "STRING" },
    openQuestion: { type: "STRING" },
    atStake: { type: "STRING" },
    drawsOn: { type: "ARRAY", items: { type: "STRING" } },
    signOf: { type: "STRING" },
  },
  required: ["title", "where", "who", "subject", "openQuestion", "atStake", "drawsOn"],
};

function escT(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function esc(s: string): string {
  return escT(s).replace(/"/g, "&quot;");
}
