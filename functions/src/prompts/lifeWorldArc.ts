/**
 * LIFE-WORLD-ARC-* — SI + prompt assembler for `worldArcGenerate`.
 *
 * Fires once per chapter:
 *  - At world creation → chapter 1.
 *  - On "Continue your life" after a previous chapter resolved → chapter N+1,
 *    with full prior-chapter context.
 *
 * The output is an arc through-line that ties together the scenes that will
 * land within it. The arc isn't a script — it's a SHAPE the scene generator
 * pulls toward, with the scenes still owning the moment-to-moment.
 *
 * Spec: docs/specs/life-sim.md §10.7 (LIFE-WORLD-ARC-*).
 *
 * ── SRV-PROMPT-8..13 batch 3, SECOND HALF ───────────────────────────────────
 *
 * Moved here from `src/lib/life/prompts/worldArc.ts`, which is DELETED
 * (SRV-PROMPT-3): a retired client prompt module does not stay importable. The
 * client now sends `promptSpec: {kind:'life_world_arc', …}` and `prompt: ''`;
 * `resolveServerPrompt` validates the spec and builds both halves from here.
 *
 * ⚠ THIS PROMPT FAILED SRV-PROMPT-9's SIZE GATE THE FIRST TIME, and the batch
 * stopped rather than forcing it. `life_resume_recap` shipped; this did not.
 * `readCompletedArcs` returned the entire `completedArcs` subcollection and
 * `renderArc` rendered all of it, so a long-played world's assembled pair went
 * over `MAX_PROMPT_BYTES` — 148.8% of cap at twenty chapters. The built path
 * answers that with `too-large`, and `runWorldArcGenerate` catches and falls
 * back to `trivialArc`, so the failure would have been SILENT: a world simply
 * stops getting authored chapters, and the worlds that break first are the ones
 * someone cared enough about to keep playing.
 *
 * `LIFE-WORLD-ARC-7` bounded the input (`capCompletedArcs`, cap 5, head 2) and
 * re-measurement put the realistic worst case at 73.7% of cap. Only then did
 * this move.
 *
 * ⚠ THAT MARGIN IS NOT A CEILING, and the distinction is why this took two
 * attempts. `life_resume_recap` was safe because every one of its inputs is
 * bounded IN CODE — `capStoryLog` at 60, a 10-row render cap, one chapter. Here
 * the COUNTS are bounded (`MAX_PRINCIPALS`, `REGULARS_RENDER_CEILING`,
 * `MAX_BIO_SCENE_MEMORIES`, the six-memory slice below, `COMPLETED_ARCS_CAP`)
 * but the LENGTHS are not: `known`, `wants`, `nextMove`, `routine`, `agenda`,
 * `situation`, every law and every scene summary is model-authored prose with
 * no bound anywhere. If it ever bites, the fix is a BYTE budget on the rendered
 * arc block rather than a smaller count — see `LIFE-WORLD-ARC-7`.
 *
 * ── WHAT THE SPEC CARRIES, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 *
 * The client does NOT send a `LifeWorld`. It sends the fields this prompt
 * reads, flat, and the server rebuilds them field-by-field — and row by row for
 * the four arrays — so an extra key on the wire cannot reach a template.
 * `canon`, `goalLadder`, `storyLog`, `saga`, `currentArc` and `sagaHistory` are
 * on the world doc and have never been read here; a field that reaches nothing
 * is a field someone later wires INTO something.
 *
 * THREE RENDERING RULES STAY HERE, because each decides what the model SEES
 * rather than what the caller has:
 *   - the LIVE-front filter (`resolved == null`) and the withheld clock;
 *   - the regulars ceiling (`REGULARS_RENDER_CEILING`), principals uncapped;
 *   - the six-memory slice per prior chapter.
 *
 * THE REGISTER PICK IS THE INVERSE OF THE RECAP'S (LIFE-WORLD-ARC-REGISTER).
 * `buildResumeRecapUserPrompt` renders `playerTeaser || premise`, because a
 * recap is PLAYER-facing and must be spoiler-safe. This prompt is read by the
 * MODEL — the scene generator and the next chapter's planner — so it renders
 * the PLANNER `premise`, which may name tensions the player has not discovered.
 * `playerTeaser` is therefore not on this spec at all, rather than being sent
 * and ignored: the safest way to guarantee the player-facing string cannot
 * leak into a planner prompt is for it never to cross the wire.
 */
import { LEXICON_RULES } from "./lifeLexiconRules";
import {
  renderUniverse,
  renderWorldStory,
  type WorldStoryCastMember,
  type WorldStoryFront,
  type WorldStoryUniverse,
} from "./lifeWorldState";

/** How many of a prior chapter's scene memories reach the prompt. */
export const ARC_SCENE_MEMORY_RENDER_CAP = 6;

/** One archived chapter, narrowed to what `renderArc` reads. `playerTeaser` and
 *  `status` are deliberately absent (see the register note in the header). */
export type WorldArcPriorChapter = {
  chapterNumber: number;
  premise: string;
  themes: readonly string[];
  outcomeLine?: string | null;
  completedSceneMemories: ReadonlyArray<{
    title: string;
    endingKey: string;
    summary: string;
  }>;
};

export type WorldArcPromptInput = {
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  worldSeedKey: string;
  /** Only when `worldSeedKey === 'manual'`: the user's verbatim text. */
  worldSeedText?: string;
  universe?: WorldStoryUniverse;
  situation?: string;
  /** ALL fronts; the live filter runs here (LIFE-FRONT-1.1). */
  fronts: readonly WorldStoryFront[];
  /** ALL cast; the regulars ceiling runs here (LIFE-CAST-3). */
  cast: readonly WorldStoryCastMember[];
  /** LIFE-ONBOARD-17: the pre-rendered `<bio>` block, emitted verbatim. */
  bio?: string;
  currentLocationLabel?: string;
  /** Chapter number being generated. Chapter 1 is the world's first arc. */
  chapterNumber: number;
  /**
   * LIFE-WORLD-ARC-1 / LIFE-WORLD-ARC-7: the world's completed chapters, read
   * from the `completedArcs/{arcId}` subcollection by the caller and CAPPED by
   * `capCompletedArcs` before they are sent. Empty for chapter 1.
   *
   * The cap stays at the CALL SITE rather than moving here with the prompt, and
   * that is a deliberate split from the recap's precedent. The recap's caller
   * sends its whole event window because the window is bounded at 40; a world's
   * arc history is not bounded at all, so sending everything and trimming here
   * would put an unbounded array on the wire for a prompt that renders five.
   * `resolveServerPrompt`'s `too-large` check is the backstop if a client ever
   * stops capping — asserted in `serverPromptSpec.test.ts`.
   */
  previousArcs: readonly WorldArcPriorChapter[];
};

export function worldArcSystemInstruction(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
}): string {
  const { practiceLanguage, nativeLanguage } = opts;
  return [
    `You are designing a multi-scene STORY ARC for an AI-powered language-learning life simulator. The player has a character with a persistent life; their world unfolds across CHAPTERS, and each chapter is one of your arcs. A chapter typically spans 3-6 scenes and 30-60 turns — a multi-session through-line that gives the player something to come back for.`,
    `Practice language: ${practiceLanguage}. Native language: ${nativeLanguage}.`,
    ``,
    `THE BIO IS FACT, NOT SUGGESTION (LIFE-ONBOARD-17, load-bearing):`,
    // ⚠ `<bio>`, NOT `<life>`. This clause named a block that HAS NEVER BEEN
    // EMITTED. `renderBioForPrompt` has produced `<bio>` since it was written,
    // so the antecedent of "when a <life> block is present" was always false and
    // every prohibition below it hung off a condition nothing satisfied. It is
    // inherited — the deleted client builder carried the same two lines — so the
    // batch-3 migration ported it faithfully rather than introducing it.
    //
    // MEASURED before changing it, and the measurement is why this is a
    // CORRECTNESS fix rather than a behaviour one: A/B against real Gemini on
    // the shipped prompt, 48 trials per arm on a realistic chapter-3 payload,
    // found NO significant difference. The bio's job was honoured 48/48 in both
    // arms and nothing contradicted it in either (0/48). The block is in the
    // user prompt, so the model reads it whether or not the SI names it. The one
    // persistent direction — the bio's named people appearing in the arc, 33% →
    // 46% — did not reach significance (p≈0.11) and is recorded as unproven, not
    // claimed. Do not cite this change as a fix for LIFE-ONBOARD-17.
    `When a <bio> block is present it is the player's OWN biography — their job, their home, their neighbourhood, the people around them. It was written first, and the player has read it. You may not contradict it.`,
    `Specifically: do NOT give them a different job, do NOT move them to a different town, do NOT replace the people in it. If the bio says they are a radio technician living in cellars under the ramparts, chapter 1 is about a radio technician living in cellars under the ramparts — not about finding a different trade in the next village.`,
    `The bio is where the chapter GROWS FROM. Its job is what the days are made of, its people are who the player already knows, and its hooks are the loose threads you may pull.`,
    ``,
    `THEME FITS WORLD (LOAD-BEARING):`,
    `Read the <world seed="..."> attribute. Practical seeds (city_life, studying_abroad, work_abroad, family_country, farm_life, retired_village, restaurant, local_team, hostel) get GROUNDED chapters — a career trajectory, a romance, a neighbourhood mystery, a season that has to be got through. Fantastical seeds (magic_university, noir_detective, alien_invasion, frontier_colony, outlaw_trail, sea_voyage, pilgrim_town, heist, haunted_house) get genre-appropriate chapters in that world.`,
    ``,
    // LIFE-STORY-STAGE-3 — chapter 1 is where the reported "always drops you
    // into a high drama situation" is decided. Placed ABOVE the saga block so
    // it is read before "this chapter MUST advance the saga", which is the
    // instruction it carves an exception out of.
    `CHAPTER 1 IS AN ESTABLISHING CHAPTER (LIFE-STORY-STAGE-3, load-bearing):`,
    `Read <chapterNumber>. When it is 1, the ordinary rule below — "this chapter MUST advance the saga" — does NOT apply, and following it anyway is the single most common way this world is ruined before it starts. Chapter 1's job is to make the player believe in a PLACE and a few PEOPLE. Everything else is chapter 2 onward.`,
    `  - The chapter's dramatic question is PERSONAL and ORDINARY, and it is answerable by living: can they hold down this job, find a room, get the neighbour to talk to them, learn to do the thing everyone here can already do, be forgiven for the first mistake they made.`,
    `  - Nothing in <inMotion> appears in chapter 1 as a plot the player is IN. Its world may exist around them — a rule everyone obeys, a name people lower their voice for, a queue that is longer than it should be — but as texture they walk past.`,
    // LIFE-STORY-STAGE-6. Reported 2026-08-07 against a `heist` world whose
    // front was an Observatory job with a deadline, and whose bio hooks were
    // iron keys, canal-lock timings and a crew: *"why does this first scene
    // have nothing to do with a heist? It doesn't feel like a buildup, it feels
    // entirely irrelevant, wrong atmosphere, wrong characters."* Chapter 1 came
    // back about rent and a coffee downstairs, with `recurringNpcIds: []`, and
    // a premise that said in its own words *"rather than initiating the heist
    // itself... not immediate criminal action."*
    //
    // The bullet above is why, and it is RIGHT about plot and WRONG about
    // everything else. "Texture they walk past" is the correct instruction for
    // <inMotion>'s EVENTS; read as a description of the whole chapter it
    // produces an establishing chapter for a DIFFERENT STORY. Establishing is
    // not the same as unrelated: the crew, the canal and the keys can all be
    // present at zero stakes, and that IS the build-up the player was promised.
    // So the restraint stays on the PLOT and is lifted off the PEOPLE and the
    // PLACE, which is where "wrong atmosphere, wrong characters" was coming
    // from.
    `  - BUT CHAPTER 1 IS STILL THIS STORY, at rest. Establishing does not mean unrelated, and this is the more common failure of the two: a first chapter that could be swapped into any other world is not a slow start, it is a different story the player did not pick. Concretely — <cast> PRINCIPALS appear in chapter 1 and "recurringNpcIds" NAMES THEM; the player's own <bio> hooks are what the chapter's ordinary question is about; and the world's own materials (their job, their tools, their route, the thing they are already good at) are what the days are made of. A player who chose a heist should spend chapter 1 among the crew, on the ground the job will happen on, doing none of it.`,
    `  - The dividing line, and it is not subtle: the FRONT'S CLOCK does not move in chapter 1 and nobody proposes the job. Everything else about that world is allowed to be on the page. The player should finish chapter 1 knowing the place, the people and what they can do — and NOT knowing what is going to be asked of them.`,
    `  - No twist, no secret revealed, no summons, no "nothing here is what it seems". The player is NEW. A revelation costs nothing to someone with nothing invested yet, which is exactly why opening with one makes the whole world feel weightless.`,
    `  - "premise" for chapter 1 should read like the first chapter of a novel, not its blurb: where the player has landed, what their days look like, who is nearby, and the one ordinary thing they are trying to get right.`,
    `  - CHAPTER 2 is where the pressures in <inMotion> start to touch the player. Write chapter 1 so that arriving there feels earned.`,
    ``,
    `READS THE WORLD AS IT STANDS (LOAD-BEARING):`,
    `There is no synopsis of this story anywhere, and there is not supposed to be — nobody has decided how it ends. You are given the world's STATE instead, and you plan the chapter from it (LIFE-ARCH-3):`,
    `  - <situation> — what is TRUE right now. The chapter starts from here, not from wherever the last chapter's plan expected the player to be.`,
    `  - <inMotion> — the pressures already running, each with an agenda and a driver. The chapter's dramatic question should sit NEAR one of them without being a summary of it: the player's stake in it, what it costs THEM, what they can actually do about it.`,
    `  - <cast> — who exists, what they want, and what they do next. A chapter is usually about somebody, and these are the somebodies.`,
    `  - The chapter's premise is OPEN — a LOOSE PULL, not a rail (LIFE-STORY-SHAPE-1). Sketch what this chapter LEANS toward and what it is NOT about, given where the player ACTUALLY is. NEVER a pre-written synopsis of what WILL happen: a good premise survives the player going off-script, because it describes a pressure rather than a plan.`,
    `  - Do NOT invent a twist, a climax or an ending to build toward. If you find yourself writing what the chapter BUILDS TO, you have written a plan, and the player has not agreed to it.`,
    `  - Themes should connect to what <inMotion> is actually about and to what the cast wants.`,
    ``,
    `BUILDS ON PRIOR CHAPTERS:`,
    `When <previousChapters> is present, the new chapter is the NEXT CHAPTER of this character's life. It should:`,
    `  - Pick up where the most recent chapter ended (read the <chapter>'s outcomeLine + keyMomentsForArc).`,
    `  - Echo recurring NPCs (use the <cast> list) as part of the through-line.`,
    `  - Re-use accumulated state (job, friends, achievements) — don't reset the character.`,
    ``,
    // LIFE-STORY-LEXICON-1 — chapter names came out of the same dozen words as
    // the saga title did; the rule is shared so the two cannot disagree.
    ...LEXICON_RULES,
    ``,
    `TWO REGISTERS — PLANNER vs PLAYER (LIFE-WORLD-ARC-REGISTER, load-bearing):`,
    `You write the chapter TWICE, for two different readers — do not conflate them:`,
    `  - "premise" is for the MODEL (the scene generator + you next chapter). To-the-point about what this chapter is INTENDED to explore and what it is NOT — the loose pull. It MAY name a tension, a direction, or a card still face-down that the player hasn't discovered. It is NEVER shown to the player.`,
    `  - "playerTeaser" is for the PLAYER, shown on the world overview + the "this chapter" resume screen. SPOILER-SAFE and evocative: where they are right now + a tease of the trials and tribulations that may come. Reveal NO midpoint twist, NO ending, NO antagonist name the player hasn't met. It should make them WANT to play, without telling them what happens. (Mirrors the saga's premise vs playerFacingTeaser split.)`,
    ``,
    `OUTPUT SHAPE:`,
    `{`,
    `  "premise": "PLANNER register — 2-4 sentences: what this chapter leans toward + what it is NOT. Spoilers allowed (model's eyes only)",`,
    `  "playerTeaser": "PLAYER register — 2-3 spoiler-safe evocative sentences the player reads on the overview + resume screen",`,
    `  "themes": ["theme 1", "theme 2", ...],   // 2-4 short tags (e.g. 'ambition', 'loyalty', 'identity', 'home')`,
    `  "recurringNpcIds": ["npc-id-1", ...]      // pull from <cast> when relevant; new chapters may add npcs but only via scenes that promote them`,
    `}`,
    `Return ONLY valid JSON matching this shape. No prose, no markdown fences.`,
    ``,
    `TONE GUIDELINES:`,
    `- The premise is 2-4 sentences MAX — the dramatic shape, not a synopsis. The playerTeaser is 2-3 sentences, spoiler-safe.`,
    `- Themes are short tags, not sentences. Lowercase, 1-3 words each.`,
    `- recurringNpcIds at chapter-1 are usually empty (no prior NPCs to recur). Later chapters pull from the <cast> list.`,
  ].join("\n\n");
}

export function buildWorldArcUserPrompt(input: WorldArcPromptInput): string {
  const previous = input.previousArcs;
  const sections: string[] = [
    `<character name="${escapeAttr(input.characterName)}" practiceLanguage="${escapeAttr(input.practiceLanguage)}" nativeLanguage="${escapeAttr(input.nativeLanguage)}"/>`,
    `<world seed="${escapeAttr(input.worldSeedKey)}"${input.worldSeedText ? ` description="${escapeAttr(input.worldSeedText)}"` : ""}/>`,
    renderUniverse(input.universe),
    // LIFE-ARCH-3: the chapter is planned from what is TRUE, WANTED and IN
    // MOTION. It used to read the saga synopsis — centralConflict, antagonist,
    // storyMovements, midpointTwist, climax, endStates — none of which is
    // generated any more, so this block was rendering a shell of empty tags
    // while the instructions above it still told the model to obey them.
    renderWorldStory({
      situation: input.situation,
      fronts: input.fronts,
      cast: input.cast,
    }),
    input.bio ?? "",
    input.currentLocationLabel
      ? `<currentLocation>${escapeText(input.currentLocationLabel)}</currentLocation>`
      : "",
    `<chapterNumber>${input.chapterNumber}</chapterNumber>`,
  ].filter(Boolean);

  if (previous.length > 0) {
    sections.push(
      `<previousChapters>\n${previous.map((arc) => renderArc(arc)).join("\n")}\n</previousChapters>`,
    );
  }

  sections.push(`Design the chapter outline.`);
  return sections.join("\n\n");
}

function renderArc(arc: WorldArcPriorChapter): string {
  const memories = arc.completedSceneMemories
    .slice(0, ARC_SCENE_MEMORY_RENDER_CAP)
    .map(
      (m) =>
        `    <memory scene="${escapeAttr(m.title)}" ending="${escapeAttr(m.endingKey)}">${escapeText(m.summary)}</memory>`,
    )
    .join("\n");
  const themes = arc.themes.map((t) => `    <theme>${escapeText(t)}</theme>`).join("\n");
  return [
    `  <chapter number="${arc.chapterNumber}">`,
    // LIFE-WORLD-ARC-REGISTER: the PLANNER register, because this output is
    // read by the model. The inverse of the recap's pick.
    `    <premise>${escapeText(arc.premise)}</premise>`,
    themes ? `    <themes>\n${themes}\n    </themes>` : "",
    arc.outcomeLine ? `    <outcomeLine>${escapeText(arc.outcomeLine)}</outcomeLine>` : "",
    memories ? `    <memories>\n${memories}\n    </memories>` : "",
    `  </chapter>`,
  ]
    .filter(Boolean)
    .join("\n");
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
