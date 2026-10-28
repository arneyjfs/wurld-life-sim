/**
 * LIFE-CTX-6/10/11 — the `life_step` RENDER helpers, SERVER-OWNED.
 *
 * SRV-PROMPT-8..13 batch 8. A byte-for-byte port of
 * `src/lib/life/prompts/stepRender.ts`'s RENDER half; that file is now the
 * ENGINE half alone (`SCENE_FLOOR`, which `sceneLifecycle` reads, and the two
 * escapes `sceneLeaning` still needs). The renderers crossed whole rather than
 * being duplicated, per SRV-PROMPT-3.
 *
 * ⚠ THE FOUR PACE CONSTANTS ARE DUPLICATED AND THE DUPLICATION DOES NOT
 * EXPIRE — this is the `DELTA_PER_FRONT` shape (batch 4) rather than the
 * story-stage one. `SCENE_FLOOR` is read by `sceneLifecycle.ts`, which REFUSES
 * a resolve below it; that is engine code judging the model's answer, and
 * engine code never migrates. `SCENE_OVERDUE` is read by the playthrough
 * harness. So the copies never re-converge, and a parity guard asserts them
 * against each other for good (`tests/playthrough/serverPromptParity.test.ts`).
 * Drift is invisible and wrong in the quiet direction: `<scenePace>` would tell
 * the model a floor of one number while the lifecycle enforced another, and
 * every early resolve would be refused for a reason the prompt never stated.
 *
 * Types are declared STRUCTURALLY here rather than imported: `functions/` holds
 * no copy of `@/types/firestore` and must not grow one, and every field below
 * is validated by `buildLifeStep` before it reaches a template.
 */

/**
 * One row of the append-only event log, narrowed to what the prompt reads.
 *
 * ⚠ `createdAtMs` REPLACES a Firestore `Timestamp`, and it is the only shape
 * change in the whole port. `recentlyPracticedTargets` called
 * `e.createdAt.toMillis()` to drop targets practised before this chapter began;
 * a `Timestamp` does not survive JSON, so the call site reads the number off it
 * and sends that. Absent is meaningful and means "undated" — such a row is
 * never filtered out, exactly as the client's `ts === null` branch had it.
 */
export type StepEvent = {
  kind: string;
  payload?: Record<string, unknown>;
  createdAtMs?: number | null;
};

/** The beat payload's fields, as `renderEvent` reads them. */
type LifeBeatPayload = {
  speaker?: string;
  speakerName?: string;
  npcId?: string;
  practiceText?: string;
  nativeText?: string;
};

/** The chapter, as the idle block renders it. */
export type StepArc = {
  chapterNumber: number;
  premise: string;
  themes: readonly string[];
  recurringNpcIds: readonly string[];
  completedSceneMemories: ReadonlyArray<{ title: string; summary: string }>;
};

export function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}

export function renderEvent(e: StepEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  switch (e.kind) {
    case 'beat': {
      const b = p as Partial<LifeBeatPayload>;
      const speaker = b.speaker ?? 'narrator';
      const name = b.speakerName ? ` name="${escapeAttr(b.speakerName)}"` : '';
      // LIFE-CTX-10: the npcId BINDS the line to its <npcRoster> row. Without
      // it the model re-matched speakers by display name alone and drifted
      // (lines attributed to the wrong character / a renamed character).
      const npcId = b.npcId ? ` npcId="${escapeAttr(b.npcId)}"` : '';
      // Narrator beats authored under the pre-2026-07 two-channel model carry
      // their narration in nativeText with practiceText empty. Rendering
      // practiceText alone made every one of them an EMPTY element — the model
      // literally could not see that narration had happened.
      const text = b.practiceText?.trim() ? b.practiceText : (b.nativeText ?? '');
      return `<event kind="beat" speaker="${speaker}"${name}${npcId}>${escapeText(text)}</event>`;
    }
    case 'decision': {
      const text = typeof p.text === 'string' ? p.text : '';
      // LIFE-CTX-10: explicit actor. The label is a system-language menu
      // string, so without `actor="player"` the model read these as narration.
      //
      // LIFE-CTX-16: the `choice` slug is GONE. It was an internal option id
      // ("examine-copper") that the SI never references anywhere — grep it — so
      // it was ~18 chars per row of pure scaffolding. The label text is what
      // tells the model what the player did.
      return `<event kind="decision" actor="player">${escapeText(text)}</event>`;
    }
    case 'flashcard_added':
      // LIFE-CTX-16: the saved word already reached the model as the beat it was
      // tapped in (with its own wordTranslations) and, when tested, via
      // <recentlyPracticed>. This row restated it a third time as a bare pair.
      // `vocabRecap` reads the RAW events, so the recap surface is untouched.
      return '';
    case 'npc_introduced':
      // LIFE-CTX-16: redundant with <canon> and <npcRoster>, which both carry
      // this NPC's id and name authoritatively on EVERY turn (LIFE-CANON-5
      // keeps id+name even for entities long out of play). This row said
      // nothing they don't. Same reasoning as LIFE-CTX-11's correction rows:
      // the raw event stays in Firestore and still drives the derivations —
      // this drops it from the PROMPT only.
      return '';
    case 'backdrop_visited': {
      const label = typeof p.locationLabel === 'string' ? p.locationLabel : '';
      return `<event kind="backdrop_visited">${escapeText(label)}</event>`;
    }
    case 'question_demoted':
      // LIFE-EX-CADENCE-1: bookkeeping for the cadence counter only. The player
      // saw a normal branch; telling the model "a question was planned here and
      // rejected" would invite it to explain or retry the failure in-narrative.
      return '';
    case 'correction':
      // LIFE-CTX-11: a graded exchange does NOT enter the narrative history.
      // What actually happened in-world — the player saying the completed line,
      // or the NPC's utterance being revealed — is already committed as a `beat`
      // with the correct speaker. The correction row echoed the same moment a
      // second time in a different shape (a bare token pair, no speaker), which
      // is exactly how a graded answer resurfaced later as the wrong text
      // attributed to the wrong person. The tested TARGETS still reach the model
      // via <recentlyPracticed>, and the raw events still drive anti-reuse
      // and card-match sourcing — this drops the row from the PROMPT only.
      return '';
    case 'npc_forgotten': {
      const npcId = typeof p.npcId === 'string' ? p.npcId : '';
      return `<event kind="npc_forgotten" npcId="${escapeAttr(npcId)}"/>`;
    }
    case 'scene_started': {
      const sceneId = typeof p.sceneId === 'string' ? p.sceneId : '';
      const title = typeof p.title === 'string' ? p.title : '';
      return `<event kind="scene_started" sceneId="${escapeAttr(sceneId)}">${escapeText(title)}</event>`;
    }
    case 'scene_completed': {
      const sceneId = typeof p.sceneId === 'string' ? p.sceneId : '';
      const title = typeof p.title === 'string' ? p.title : '';
      const endingKey = typeof p.endingKey === 'string' ? p.endingKey : '';
      return `<event kind="scene_completed" sceneId="${escapeAttr(sceneId)}" endingKey="${escapeAttr(endingKey)}">${escapeText(title)}</event>`;
    }
    default:
      return '';
  }
}

/**
 * LIFE-WORLD-ARC-4: the `<scene>` slot while NO scene is running.
 *
 * Specified since the worldArc landed, never implemented — the idle branch
 * emitted a bare `<scene status="idle"/>`. Measured consequence on a real
 * world (`w-1785453145426-8w0ffo`, 2026-07-31): **one** `scene_hook_offered`
 * across 110 events. `<hookPressure>` was correctly shouting OVERDUE into a
 * prompt that contained nothing to hook INTO — no premise, no themes, no
 * recurring cast. An instruction to "offer a hook that serves the chapter"
 * cannot bind when the chapter is absent from the prompt, which is the same
 * defect class as `LIFE-ARC-PACE-1` and `LIFE-EX-CADENCE-1`: a rule stated in
 * terms the model cannot observe.
 *
 * The idle block is where a scene is BORN, so it is the one place the arc
 * has to be legible. It stays `status="idle"` — the model must not read it as
 * an active scene and start emitting `scene.resolved` against it.
 *
 * Stable-prefix safe (LIFE-CTX-1): every field here changes only on chapter
 * boundaries, so this block is byte-identical across a whole chapter's turns.
 */
export function renderIdleChapter(arc: StepArc | null | undefined): string {
  if (!arc) return `<scene status="idle"/>`;
  const themes =
    arc.themes.length > 0
      ? `  <themes>\n${arc.themes.map((t) => `    <theme>${escapeText(t)}</theme>`).join('\n')}\n  </themes>`
      : '';
  const npcs =
    arc.recurringNpcIds.length > 0
      ? `  <recurringNpcIds>\n${arc.recurringNpcIds.map((id) => `    <npc id="${escapeAttr(id)}"/>`).join('\n')}\n  </recurringNpcIds>`
      : '';
  // `completedSceneMemories` is what the chapter has already SPENT. The last
  // two are enough to stop the next hook repeating a resolved thread, and
  // capping keeps the block bounded as a chapter runs long.
  const priors =
    arc.completedSceneMemories.length > 0
      ? `  <resolvedThisChapter>\n${arc.completedSceneMemories
          .slice(-2)
          .map((m) => `    <memory title="${escapeAttr(m.title)}">${escapeText(m.summary)}</memory>`)
          .join('\n')}\n  </resolvedThisChapter>`
      : '';
  return [
    `<scene status="idle" chapterNumber="${arc.chapterNumber}">`,
    `  <chapterPremise>${escapeText(arc.premise)}</chapterPremise>`,
    themes,
    npcs,
    priors,
    `  <note>No scene is running. This chapter's through-line is above: the NEXT hook you offer should serve it, and the chapter cannot end until a scene resolves with arcStage "concluding". Build the hook out of this premise, these themes and this cast — not something new.</note>`,
    `</scene>`,
  ]
    .filter(Boolean)
    .join('\n');
}

/** LIFE-ARC-PACE-1: chapter length in GENERATED TURNS (`storyLog.turns`,
 *
 *  RESTORED 2026-08-01 to 25/32/40, after being halved to 12/16/20 the night
 *  before on "chapters last far too long, I get bored and switch off".
 *  Halving the CHAPTER was the wrong lever and the owner corrected it: "I
 *  guess I meant the day needs to finish earlier... my misleading is causing
 *  them both to finish at the same time." At 12-16 turns a chapter resolved
 *  inside a single scene, so chapter 1 ended after day 1 and the two
 *  milestones collapsed into one — the day-complete and chapter-complete
 *  screens firing back to back, which is worse than a long chapter.
 *
 *  A chapter is meant to SPAN several days. The unit that was actually
 *  dragging is the SCENE (= a day, LIFE-DAY-1), and nothing bounds it: it
 *  resolves when a completionTrigger is satisfied, with no turn budget and no
 *  observable counter, which is the same "rule stated in terms the model
 *  cannot observe" defect `renderChapterPace` exists to fix one level up.
 *  Giving the scene its own pace block is the real fix and is NOT done
 *  here — see the note in docs/specs/life-sim.md (LIFE-ARC-PACE-4).
 *
 *  chapter-scoped — `applyTurnSignals` resets it when `chapterNumber` changes).
 *  These are the same numbers the step SI's pace rule quotes, which is only
 *  sound because `turns` excludes pre-authored resolution arrivals; counting
 *  `entries.length` instead ran 1.36x fast (measured: 34 entries / 25 turns). */
export const CHAPTER_IN_RANGE = 25;
export const CHAPTER_DUE = 32;
export const CHAPTER_OVERDUE = 40;


/** LIFE-ARC-PACE-4: scene (= DAY) length in generated turns. A chapter
 *  spans several of these — see the CHAPTER_* note above for why halving the
 *  chapter was the wrong lever for "the day drags".
 *
 *  A day is the unit the player feels most directly: they see a day-complete
 *  screen at the end of it. 6-9 turns is roughly a morning-to-evening arc at
 *  the pacing the step prompt already writes to, and it lands ~2-3 graded
 *  questions, so a day is a session rather than a sitting. */
/** LIFE-SCENE-26: a scene shorter than this has not been a scene. The model
 *  may resolve early when the subject genuinely lands, but `sceneLifecycle`
 *  REFUSES a resolve below the floor — "too small to be satisfying" is the
 *  failure the owner named alongside "too long", and only one of the two was
 *  ever guarded. */
export const SCENE_FLOOR = 4;
export const SCENE_IN_RANGE = 6;
export const SCENE_DUE = 9;
export const SCENE_OVERDUE = 12;

/**
 * LIFE-ARC-PACE-4 / LIFE-SCENE-25: tell the model how far into the SCENE it is.
 *
 * Exactly the shape of `renderChapterPace`, one level down, and for the same
 * reason: the SI asks the model to bring a scene to a close, but nothing ever
 * told it which turn of the scene it was on. A rule stated in a quantity the
 * model cannot observe is not a rule — so scenes ended wherever a
 * completionTrigger happened to fire.
 *
 * WHAT CHANGED IN 2026-08. This block used to talk about a DAY, because a
 * scene WAS a day (`LIFE-DAY-1`) — hence "move the narration into the evening".
 * A scene is now a SUBPLOT: one subject, 6-12 turns, several to a chapter, and
 * a player may run three of them in one sitting. Telling the model to reach for
 * evening at turn 9 of the first would break the clock rather than the scene.
 * The escalation now asks for the SUBJECT to land — which is what the player
 * actually feels as "something finished".
 *
 * The counter behind `sceneTurns` restarts when the scene id changes and at no
 * other time (`commitNode`), so a scene that overruns cannot spend the next
 * one's budget.
 */
export function renderScenePace(sceneTurns: number, subject?: string | null): string {
  if (sceneTurns < SCENE_IN_RANGE) return '';
  const stage =
    sceneTurns >= SCENE_OVERDUE
      ? 'overdue'
      : sceneTurns >= SCENE_DUE
        ? 'due'
        : 'in-range';
  const about = subject?.trim()
    ? ` Its subject is "${escapeText(subject.trim())}" — that is what has to land.`
    : '';
  const body =
    stage === 'overdue'
      ? `This SCENE has run ${sceneTurns} turns and is past its ~${SCENE_OVERDUE}-turn ceiling.${about} Land it: give the subject its resolution beat THIS turn or next and emit \`scene.resolved\`. Do not open anything new — a thread you start now belongs to the NEXT scene.`
      : stage === 'due'
        ? `This SCENE has run ${sceneTurns} turns and is DUE to end.${about} Bring the subject to its resolution beat and emit \`scene.resolved\` when it lands. Do not open a thread that needs several more turns to pay off.`
        : `This SCENE has run ${sceneTurns} turns, inside the ~${SCENE_IN_RANGE}-${SCENE_DUE} window.${about} Start shaping toward an ending: scope what you begin so it can resolve within the budget.`;
  return `<scenePace turns="${sceneTurns}" stage="${stage}" ceiling="${SCENE_OVERDUE}" floor="${SCENE_FLOOR}">${body}</scenePace>`;
}


/**
 * LIFE-ARC-PACE-4 — the DAY pace rule, REMOVED 2026-08-05.
 *
 * It said, live in the step SI: *"one scene IS one day (LIFE-DAY-1), and a day
 * should run roughly 6-9 player turns — plan the day's shape from the start, so
 * its beats read as morning → afternoon → evening … a day that resolves while
 * the narration is still describing mid-morning reads as broken."*
 *
 * Three things were wrong with it by the time it was found.
 *
 * 1. **A scene is no longer a day** (owner, 2026-08-05). So the rule was asking
 *    the model to fit a whole day's arc into a unit that is now much smaller —
 *    which is pressure to keep going and to fill the time with whatever comes
 *    to hand.
 * 2. **It forbade the thing we want.** "A day that resolves while the narration
 *    is still describing mid-morning reads as broken" tells a model three turns
 *    in that it may NOT resolve yet. Removing it should if anything tighten
 *    pacing rather than loosen it.
 * 3. **It pointed at a tag that does not exist.** "The <dayPace> block states
 *    the day's turn count" — the renderer emits `<scenePace>`. Nothing ever
 *    emitted `<dayPace>`.
 *
 * WHY DELETING IT DOES NOT COST THE PACING (the owner's question). The turn
 * window is stated independently by `WHAT A SCENE IS` (LIFE-SCENE-25) in the
 * step SI — "ONE subject, SCENE_IN_RANGE-SCENE_OVERDUE player turns" — and that
 * window (6-12) is the one `renderScenePace`'s stages are actually built on,
 * where this rule said 6-9. The two disagreed; the survivor is the correct one.
 * Pressure now comes from three places, all of them still here: that rule, the
 * `<scenePace>` block escalating from turn 6, and `sceneProgress` 0-100 emitted
 * every turn as a forcing function.
 *
 * NOT replaced with a scene-scoped "let time advance" clause. Considered and
 * declined: a scene is now a short unit and may well span twenty minutes of
 * story time, so instructing time to move across it invents the same problem at
 * a smaller scale. If scenes start reading as frozen in time, that is the thing
 * to add back — scoped to the scene, and without a resolution ban attached.
 */


/**
 * LIFE-ARC-PACE-1: tell the model where this chapter is against its budget.
 *
 * The step SI has always asked for "roughly 25-35 player turns … don't let one
 * drag past ~40" — but nothing ever told the model which turn it was on, so the
 * rule was stated in a quantity it could not observe and chapters ran
 * indefinitely. This is the observable half. Same shape as `<practiceCadence>`,
 * which works for the same reason: a number plus a stage, escalating.
 *
 * Returns '' below the window. A chapter concluded early is its own failure
 * (`LIFE-WORLD-ARC-*` wants a through-line, not a vignette), so the early game
 * is deliberately not nudged toward wrapping up.
 */
export function renderChapterPace(chapterTurns: number): string {
  if (chapterTurns < CHAPTER_IN_RANGE) return '';
  const stage =
    chapterTurns >= CHAPTER_OVERDUE
      ? 'overdue'
      : chapterTurns >= CHAPTER_DUE
        ? 'due'
        : 'in-range';
  const body =
    stage === 'overdue'
      ? `This chapter has run ${chapterTurns} turns and is PAST its ~${CHAPTER_OVERDUE}-turn ceiling. Bring the through-line home now: steer the active scene to its resolution beat, and when you emit \`scene.resolved\`, set arcStage "concluding" so the chapter closes. Do not open a new thread that needs another scene to pay off.`
      : stage === 'due'
        ? `This chapter has run ${chapterTurns} turns — inside the target window and approaching the ceiling. Start converging: the next scene that reaches its resolution beat should carry arcStage "concluding" unless the arc's through-line genuinely has one more scene in it.`
        : `This chapter has run ${chapterTurns} turns, in the ~${CHAPTER_IN_RANGE}-${CHAPTER_DUE} target window. Scope what you start from here so the through-line can resolve within the window — prefer deepening threads already open over opening new ones.`;
  return `<chapterPace turns="${chapterTurns}" stage="${stage}" ceiling="${CHAPTER_OVERDUE}">${body}</chapterPace>`;
}


/**
 * LIFE-SCENE-33 — the scene boundary, made STRUCTURAL.
 *
 * `<recentEvents>` is one flat, chronological list. When a scene changes, the
 * only thing marking it is one ordinary `<event kind="scene_started">` row
 * among nineteen others — the same visual weight as a beat. Nothing says the
 * events above it are OVER, and on the turn a scene opens they are the only
 * events in the window, so the strongest signal in the whole block is the last
 * thing that happened in a place the player has left.
 *
 * OBSERVED (`.playthroughs/2026-08-05T09-05-04-618Z-Ines`, scene 2): the scene
 * declares `where = "La Biblioteca de los Cien Pasos"` and its opening beat is
 * *"Sweat runs down your forehead while the stone vibrates under the weight of
 * the tide"* — scene 1's sea grotto, continued straight through the boundary.
 * Note what a lexical check makes of that: the wording is entirely fresh, so
 * n-gram overlap with the previous scene scored it 0. The carry-over is
 * semantic, which is exactly why the fix has to be structural rather than
 * another line of prose asking for freshness.
 *
 * So the boundary becomes a CONTAINER, not a row. Events before it are wrapped
 * and labelled OVER; events after it are wrapped and labelled as where the
 * player IS. The model can still read the prior scene (continuity depends on
 * it) but can no longer read the two as one continuous stream.
 *
 * SCOPE, deliberately narrow: this only fires while the `scene_started` for the
 * ACTIVE scene is still inside the render window AND something precedes it —
 * i.e. the handful of turns where the boundary is live. Once the new scene
 * fills the window the block reverts byte-for-byte to the flat list, so the
 * common mid-scene turn is unchanged and the prompt cache is untouched.
 */
export function renderRecentEvents(
  events: ReadonlyArray<StepEvent>,
  activeSceneId: string | null | undefined,
  where: string | null | undefined,
): string {
  const rows = events.map((e) => ({ e, xml: renderEvent(e) }));
  const flat = rows.map((r) => r.xml).filter(Boolean).join('\n');
  if (!flat) return '<recentEvents/>';
  const sceneId = activeSceneId?.trim();
  // The LAST boundary for the active scene — a scene can only start once, but
  // taking the last index is the safe read if the log ever repeats one.
  let at = -1;
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const r = rows[i]!;
    if (r.e.kind !== 'scene_started') continue;
    const id = (r.e.payload as { sceneId?: unknown } | undefined)?.sceneId;
    if (sceneId && typeof id === 'string' && id.trim() === sceneId) { at = i; break; }
  }
  const before = at > 0 ? rows.slice(0, at).map((r) => r.xml).filter(Boolean) : [];
  if (at < 0 || before.length === 0) return `<recentEvents>\n${flat}\n</recentEvents>`;

  const after = rows.slice(at + 1).map((r) => r.xml).filter(Boolean);
  const here = where?.trim() ? ` at="${escapeAttr(where.trim())}"` : '';
  const opening = after.length === 0
    ? ' The scene has not started yet: the beat you write now is its FIRST. OPEN it — establish this place and who is in it. Do not resume the exchange above.'
    : '';
  return [
    '<recentEvents>',
    '  <priorScene status="over">',
    '    <note>This scene is FINISHED. It is here for continuity — what was agreed, learned or broken in it still holds. It is NOT where the player is, NOT who they are with, and NOT the conversation they are in. Do not continue its exchange, its location, or its immediate situation.</note>',
    ...before.map((x) => `    ${x}`),
    '  </priorScene>',
    `  ${rows[at]!.xml}`,
    `  <currentScene${here}>`,
    `    <note>THE PLAYER IS HERE NOW.${opening}</note>`,
    ...after.map((x) => `    ${x}`),
    '  </currentScene>',
    '</recentEvents>',
  ].join('\n');
}