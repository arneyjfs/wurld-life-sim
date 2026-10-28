/**
 * MOVED from `src/lib/life/prompts/` by SRV-PROMPT-8..13 batch 8 (SRV-PROMPT-3:
 * a retired client prompt module is deleted and its tests MOVE rather than die).
 * The assertions are unchanged; only the imports point at the server modules.
 */
import { describe, it, expect } from 'vitest';
import { lifeStepSystemInstruction } from '../../prompts/lifeStep';
import { buildStepPromptFromWorld as buildLifeStepPrompt } from '../helpers/stepFixture';
import type { LifeEvent, LifeWorld } from '../helpers/stepTypes';

/** The client-shaped fixture these tests were written against. */
type LifeStepInput = Record<string, unknown>;

const baseWorld: LifeWorld = {
  id: 'main',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const fakeEvent = (kind: LifeEvent['kind'], payload: Record<string, unknown>): LifeEvent => ({
  id: 'e' + Math.random().toString(36).slice(2, 8),
  kind,
  payload,
});

describe('lifeStepSystemInstruction — LIFE-CTX-3', () => {
  it('embeds practice + native + level into the SI', () => {
    const si = lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 4,
    });
    expect(si).toContain('French');
    expect(si).toContain('English');
    expect(si).toContain('level 4/7');
    // LIFE-CTX-3: concrete per-level calibration, biased toward SIMPLE at the
    // low end, with a floor so simple never means dull.
    expect(si).toContain('ERR TOWARD TOO SIMPLE');
    // LIFE-LANG-9.1: the ladder renders ONLY the band the player is on, so a
    // level-4 SI carries the 3-4 row and not the 1-2 row it used to ship
    // alongside it. Asserting the player's OWN band is the point of the change.
    expect(si).toContain('Level 3-4');
    expect(si).not.toContain('Level 1-2');
    expect(si).toMatch(/LEVEL GOVERNS LANGUAGE/i);
  });

  it('mentions the JSON-only output rule', () => {
    const si = lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 1,
    });
    expect(si).toMatch(/JSON/i);
    expect(si).toMatch(/No prose, no markdown fences/);
  });

  it('LIFE-BUBBLE-7 — instructs the model to annotate chip text like beats', () => {
    const si = lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 3,
    });
    expect(si).toContain('Annotate OPTION labels the same way');
  });

});

describe('LIFE-ARC-PACE-1 — the chapter budget reaches the prompt', () => {
  const withLog = (n: number) =>
    buildLifeStepPrompt({
      world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: Array.from({ length: n }, (_, i) => `line ${i}`) } } as never,
      events: [],
      isOpeningBeat: false,
    });

  it('is absent early — the early game is not nudged toward wrapping up', () => {
    expect(withLog(5)).not.toContain('<chapterPace');
  });

  it('appears with the turn count once the chapter is in range', () => {
    const out = withLog(28);
    expect(out).toContain('<chapterPace');
    expect(out).toContain('turns="28"');
  });

  it('reaches OVERDUE and demands arcStage concluding', () => {
    const out = withLog(45);
    expect(out).toContain('stage="overdue"');
    expect(out).toContain('concluding');
  });

});

describe('LIFE-CANON-5 — working-set canon + npcMemory', () => {
  const npc = (id: string, name: string, memory: string, scope: 'world' | 'scene') => ({
    id, name, avatarStatus: 'ready' as const, scope, oneLineMemory: memory,
  });
  const beat = (speakerName: string, npcId: string) =>
    fakeEvent('beat', { speaker: 'npc', speakerName, npcId, practiceText: 'Bonjour.', nativeText: 'Hello.' });

  const build = (events: LifeEvent[]) =>
    buildLifeStepPrompt({
      world: baseWorld,
      events,
      isOpeningBeat: false,
      npcs: [
        npc('n-marie', 'Marie', 'Your neighbour; you fixed her stall.', 'scene'),
        npc('n-forgotten', 'Gaspard', 'A courier you met in chapter one.', 'scene'),
        npc('n-etienne', 'Étienne', 'Your chef; brusque but fair.', 'world'),
      ] as never,
    });

  it('drops the memory line of an NPC nobody has mentioned', () => {
    const out = build([beat('Marie', 'n-marie')]);
    expect(out).toContain('Your neighbour; you fixed her stall.');
    expect(out).not.toContain('A courier you met in chapter one.');
  });

  it('KEEPS a world-scope NPC’s memory even when unmentioned — they carry the chapter', () => {
    const out = build([beat('Marie', 'n-marie')]);
    expect(out).toContain('Your chef; brusque but fair.');
  });

  it('brings an NPC back into play as soon as they are mentioned again', () => {
    const out = build([beat('Gaspard', 'n-forgotten')]);
    expect(out).toContain('A courier you met in chapter one.');
  });

  it('a cold entity keeps its id and name in <canon> — only the note goes', () => {
    const out = build([beat('Marie', 'n-marie')]);
    // Existence, nameability and targetId validity all survive; LIFE-CANON-2 and
    // LIFE-INTRO-OPT still have everything they need for every entity.
    expect(out).toContain('id="n-forgotten"');
    expect(out).toContain('name="Gaspard"');
  });

});

describe('buildLifeStepPrompt — LIFE-CTX-1', () => {
  it('emits sections in the static→volatile order', () => {
    const input: LifeStepInput = {
      world: baseWorld,
      events: [],
      isOpeningBeat: true,
    };
    const out = buildLifeStepPrompt(input);
    const characterIdx = out.indexOf('<character');
    const rosterIdx = out.indexOf('<npcRoster');
    const backdropIdx = out.indexOf('<backdropIndex');
    const eventsIdx = out.indexOf('<recentEvents');
    const turnIdx = out.indexOf('<turn');
    // strict prefix→volatile ordering — anything else breaks the Gemini prompt
    // cache hit rate. (The old <summary> anchor was deleted in WS1-C; it is now
    // only a conditional legacy <priorSummary> shim — LIFE-MEM-2.)
    expect(characterIdx).toBeGreaterThan(-1);
    expect(rosterIdx).toBeGreaterThan(characterIdx);
    expect(backdropIdx).toBeGreaterThan(rosterIdx);
    expect(eventsIdx).toBeGreaterThan(backdropIdx);
    expect(turnIdx).toBeGreaterThan(eventsIdx);
  });

  it('marks the opening beat in the <turn> tag when no prior events exist', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      isOpeningBeat: true,
    });
    expect(out).toContain('<turn kind="opening">');
  });

  it('renders a chip choice as <turn kind="choice">', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      choice: { id: 'breakfast', practiceText: 'Préparer le petit-déjeuner' },
      isOpeningBeat: false,
    });
    expect(out).toContain('<turn kind="choice">');
    expect(out).toContain('id="breakfast"');
    expect(out).toContain('Préparer le petit-déjeuner');
  });

  it('renders free text as <turn kind="free">', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      freeText: 'je veux manger une pomme',
      isOpeningBeat: false,
    });
    expect(out).toContain('<turn kind="free">');
    expect(out).toContain('je veux manger une pomme');
  });

  it('renders recent events as structured XML rows', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [
        fakeEvent('beat', {
          speaker: 'narrator',
          practiceText: 'Le soleil se lève.',
        }),
        fakeEvent('decision', { choiceId: 'breakfast', text: 'Préparer le petit-déjeuner' }),
        fakeEvent('flashcard_added', {
          practice: 'pomme',
          native: 'apple',
          context: 'saved during a chat about lunch',
        }),
      ],
      choice: { id: 'next', practiceText: 'Continuer' },
      isOpeningBeat: false,
    });
    expect(out).toContain('<event kind="beat"');
    expect(out).toContain('<event kind="decision"');
    // LIFE-CTX-16: flashcard_added no longer renders. The saved word already
    // reached the model as the beat it was tapped in, and via
    // <recentlyPracticed> once tested — this row was a third restatement as a
    // bare pair. The raw event is untouched in Firestore and `vocabRecap` still
    // reads it, so the recap surface is unaffected.
    expect(out).not.toContain('<event kind="flashcard_added"');
    expect(out).not.toContain('practice="pomme"');
    // LIFE-CTX-16: the internal option slug is gone too — the SI never
    // referenced it. The label text is what says what the player did.
    expect(out).toContain('Préparer le petit-déjeuner');
    expect(out).not.toContain('choice="breakfast"');
  });

  it('LIFE-CTX-16 — npc_introduced does not render (redundant with canon + roster)', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [
        fakeEvent('npc_introduced', { npcId: 'n-marie', name: 'Marie' }),
        fakeEvent('beat', { speaker: 'narrator', practiceText: 'Le soleil se lève.' }),
      ],
      isOpeningBeat: false,
    });
    expect(out).not.toContain('kind="npc_introduced"');
    // The beat still renders — only the redundant row went.
    expect(out).toContain('Le soleil se lève.');
  });

  it('escapes XML-sensitive characters in event text', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [
        fakeEvent('beat', {
          speaker: 'narrator',
          practiceText: 'Sophie dit "Salut" & sourit < tu réponds.',
        }),
      ],
      isOpeningBeat: false,
    });
    expect(out).toContain('&amp;');
    expect(out).toContain('&lt;');
    expect(out).not.toContain('< tu');
  });

  it('LIFE-MEM-2 — renders the legacy rollingSummary as a <priorSummary> shim on a short-log world', () => {
    const legacy: LifeWorld = {
      ...baseWorld,
      rollingSummary: 'Marc met Sophie last week; they had coffee.',
      storyLog: { chapterNumber: 1, entries: ['They had coffee.'] },
    } as LifeWorld;
    const out = buildLifeStepPrompt({ world: legacy, events: [], isOpeningBeat: false });
    // Compaction is gone; the legacy summary surfaces read-only, NOT as <summary>.
    expect(out).toContain('<priorSummary>');
    expect(out).toContain('Marc met Sophie last week');
    expect(out).not.toContain('<summary>');
  });

  it('LIFE-MEM-2 — the legacy shim retires once <storySoFar> fills past the threshold', () => {
    const filled: LifeWorld = {
      ...baseWorld,
      rollingSummary: 'Legacy prose that should now be dropped.',
      storyLog: { chapterNumber: 1, entries: Array.from({ length: 8 }, (_, i) => `happened ${i}`) },
    } as LifeWorld;
    const out = buildLifeStepPrompt({ world: filled, events: [], isOpeningBeat: false });
    expect(out).not.toContain('<priorSummary>');
    expect(out).not.toContain('Legacy prose');
  });

  it('LIFE-MEM-2 — a fresh world (rollingSummary empty) never renders a summary block', () => {
    const out = buildLifeStepPrompt({ world: baseWorld, events: [], isOpeningBeat: false });
    expect(out).not.toContain('<priorSummary>');
    expect(out).not.toContain('<summary');
  });

  describe('scene block (LIFE-SCENE-2)', () => {
    it('emits <scene status="idle"/> when no active scene', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [],
        isOpeningBeat: false,
      });
      expect(out).toContain('<scene status="idle"/>');
    });

    it('emits the full scene block when active', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [],
        isOpeningBeat: false,
        scene: {
          id: 'c-1',
          status: 'active',
          outline: {
            title: 'The Letter',
            premise: 'A stranger gave you a letter.',
            tone: 'noir-tinged',
            practiceFocus: ['clandestine speech'],
            keyNpcs: [
              { npcId: 'marc', name: 'Marc', role: 'hook giver' },
            ],
            openBranches: ['Investigate Marc first'],
            candidateEndings: [
              { key: 'heroic', summary: 'You help.' },
            ],
            completionTriggers: ['resolution-beat-landed'],
            estimatedPhaseCount: 5,
          },
          currentPhase: 'rising',
          turnsSinceReplan: 3,
        },
      });
      // LIFE-CTX-9: the tag carries IDENTITY only. `phase` +
      // `turnsSinceReplan` change every turn and now render in the volatile
      // <currentState> block, so this outline stays in the cached prefix.
      expect(out).toContain('<scene id="c-1" status="active">');
      expect(out).not.toContain('turnsSinceReplan="3"><');
      expect(out).toContain('<scenePhase phase="rising" turnsSinceReplan="3"/>');
      expect(out.indexOf('<scene id=')).toBeLessThan(out.indexOf('<scenePhase'));
      expect(out).toContain('<title>The Letter</title>');
      expect(out).not.toContain('<plotBeats>');
      // LIFE-ARCH-3 — the three stored futures cannot reach the turn.
      //
      // The fixture above is a LEGACY scene doc: it still carries
      // openBranches / candidateEndings / completionTriggers, because scenes
      // written before `sceneOpen` do. `runSceneOpen` stops WRITING them, and
      // this asserts the second half — that a doc which still HAS them cannot
      // put them in front of the model. Structural, not a request: a model
      // shown three candidate endings writes toward one of them, on every turn
      // of the scene, which is what made these expensive in the first place.
      expect(out).not.toContain('<openBranches>');
      expect(out).not.toContain('<branch>Investigate Marc first</branch>');
      expect(out).not.toContain('<candidateEndings>');
      expect(out).not.toContain('<ending key="heroic">');
      expect(out).not.toContain('<completionTriggers>');
      expect(out).not.toContain('<trigger>resolution-beat-landed</trigger>');
      // ...and the scene still says what it IS.
      expect(out).toContain('<atStake>A stranger gave you a letter.</atStake>');
    });

    it('LIFE-ARCH §3 — a scene renders its subject and its place', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [],
        isOpeningBeat: false,
        scene: {
          id: 'c-2',
          status: 'active',
          outline: {
            title: 'The delivery',
            premise: 'Marc loses the contract if the crate stays missing.',
            subject: 'the missing crate',
            where: 'the bakery yard',
            tone: '',
            practiceFocus: [],
            keyNpcs: [],
            openBranches: [],
            candidateEndings: [],
            completionTriggers: [],
          },
          currentPhase: 'rising',
          turnsSinceReplan: 0,
        },
      });
      expect(out).toContain('<subject>the missing crate</subject>');
      expect(out).toContain('<where>the bakery yard</where>');
      // An empty tone must not render as an empty tag — it reads to the model
      // as "this scene has no tone", which is not the same as "unspecified".
      expect(out).not.toContain('<tone></tone>');
    });

    it('renders NPC roster with scope attribute when npcs are supplied', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [],
        isOpeningBeat: false,
        npcs: [
          {
            id: 'world-friend',
            name: 'Sophie',
            avatarStatus: 'ready',
            sceneId: null,
          },
          {
            id: 'scene-stranger',
            name: 'Marc',
            avatarStatus: 'pending',
            sceneId: 'c-1',
          },
        ],
      });
      expect(out).toContain('<npc id="world-friend"');
      expect(out).toContain('scope="world"');
      expect(out).toContain('<npc id="scene-stranger"');
      expect(out).toContain('scope="scene"');
    });
  });

  describe('LIFE-SCENE-24 — hooks are GONE from the prompt', () => {
    const decisions = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        fakeEvent('decision', { choiceId: `c${i}`, text: `X${i}` }),
      );

    it('never renders <hookPressure>, however long the world has idled', () => {
      // It existed to nag the model into offering a hook, because a chapter
      // ends only when a scene resolves and the model offered ZERO across 37
      // measured turns. The engine now starts the scene itself, so there is
      // nothing to nag about — and leaving the block in would ask for a field
      // the schema no longer accepts.
      for (const n of [0, 6, 10, 30]) {
        expect(
          buildLifeStepPrompt({
            world: baseWorld,
            events: decisions(n),
            isOpeningBeat: false,
          }),
          `after ${n} idle turns`,
        ).not.toContain('<hookPressure');
      }
    });

  });

  describe('practiceCadence directive', () => {
    it('does NOT inject the directive on the opening beat (no history)', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [],
        isOpeningBeat: true,
      });
      // The opening beat still says NOTHING — it has its own reason not to
      // carry a cadence line, and LIFE-EX-CADENCE-5 short-circuits before the
      // tier is consulted.
      expect(out).not.toContain('<practiceCadence');
    });

    it('LIFE-EX-CADENCE-5 — says "not yet" before the first narrative pick', () => {
      // RE-TARGETED TWICE. 2026-08-03: DUE moved 2 → 1 after a 12-turn scene
      // produced TWO questions. 2026-08-04: back to 2 after an 8-scene world
      // produced 45 questions in 72 turns — and, more to the point, this test
      // used to assert the block was ABSENT here. Absence is what let the model
      // ask again on the turn straight after a question; most of that 62% rate
      // was gaps of 1, which the cadence machinery never requested.
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [],
        choice: { id: 'next', practiceText: 'Continuer' },
        isOpeningBeat: false,
      });
      expect(out).toContain('tier="none"');
      expect(out).toContain('do not emit kind "question"');
    });

    it('LIFE-NODE-7 — is DUE at a streak of 2 (~1 in 3)', () => {
      // TWO decisions: CADENCE_DUE is 2 as of 2026-08-04, so one pick is the
      // "not yet" turn and the second is where the nudge lands.
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          fakeEvent('decision', { choiceId: 'a', text: 'X' }),
          fakeEvent('decision', { choiceId: 'b', text: 'Y' }),
        ],
        choice: { id: 'next', practiceText: 'Continuer' },
        isOpeningBeat: false,
      });
      expect(out).toContain('<practiceCadence');
      expect(out).toContain('streak="2"');
      expect(out).toContain('tier="due"');
      // LIFE-EX-CADENCE-1: PRESSURE, not position. The old directive said
      // "Make THIS node a question", which forced the graded moment onto
      // whatever node happened to be Nth — a question with no line to test
      // reads as a pop quiz. At the DUE tier the model may defer to the next
      // node that genuinely fits.
      expect(out).not.toContain('Make THIS node a question');
      expect(out).toContain('a graded moment is DUE');
      expect(out).toContain('not necessarily on this node');
      expect(out).not.toContain('tier="forced"');
      expect(out).not.toMatch(/preview/i);
    });

    it('LIFE-EX-CADENCE-1 — escalates to OVERDUE so the streak cannot run away', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          fakeEvent('decision', { choiceId: 'a', text: 'A' }),
          fakeEvent('decision', { choiceId: 'b', text: 'B' }),
          fakeEvent('decision', { choiceId: 'c', text: 'C' }),
          fakeEvent('decision', { choiceId: 'd', text: 'D' }),
        ],
        isOpeningBeat: false,
      });
      expect(out).toContain('streak="4"');
      expect(out).toContain('tier="forced"');
      expect(out).toContain('THE WINDOW HAS CLOSED');
      expect(out).not.toContain('not necessarily on this node');
      // LIFE-EX-CADENCE-3 — THE ASSERTION THIS TEST WAS MISSING. Its comment
      // already claimed "the window closes: deferring further is no longer
      // offered", and the line above passed under the OLD prompt too, because
      // that phrase only ever appeared in the DUE body. The actual out lived in
      // the overdue body — "make the NEXT node the question" — takeable again
      // on the next node, and the next. Measured result: twelve turns, one
      // question. A test that checks the wrong phrase is how a guarantee stays
      // unenforced for a month while its own comment asserts it.
      expect(out).not.toContain('the NEXT node');
      expect(out).toContain('"the next node" is not available to you');
    });

    it('LIFE-EX-CADENCE-1 — a DEMOTED question spends the slot, so the streak resets', () => {
      // The bug this fixes: a question whose generator rejected the plan wrote
      // NO event, so the streak stayed elevated and the directive re-fired on
      // the very next node — a demote loop costing three calls a turn (the
      // question life_step, the failed life_graded_question, and the
      // replacement options fetch) and a run of forced questions.
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          fakeEvent('decision', { choiceId: 'a', text: 'A' }),
          fakeEvent('decision', { choiceId: 'b', text: 'B' }),
          fakeEvent('question_demoted', { reason: 'answer-leak' }),
        ],
        isOpeningBeat: false,
      });
      // One decision since the demote — below the DUE threshold, so the block
      // says "not yet" rather than saying nothing (LIFE-EX-CADENCE-5). What
      // this test is really asserting is that the demote SPENT the slot: the
      // streak restarted from it, so the tier is none rather than forced.
      expect(out).toContain('tier="none"');
      // And it never reaches the model.
      expect(out).not.toContain('question_demoted');
      expect(out).not.toContain('answer-leak');
    });

    it('resets the streak after a correction event', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          // Old decisions BEFORE the last correction don't count.
          fakeEvent('decision', { choiceId: 'a', text: 'X' }),
          fakeEvent('decision', { choiceId: 'b', text: 'Y' }),
          fakeEvent('decision', { choiceId: 'c', text: 'Z' }),
          fakeEvent('correction', { kind: 'generation', correct: true }),
        ],
        choice: { id: 'next', practiceText: 'Continuer' },
        isOpeningBeat: false,
      });
      // The three decisions BEFORE the correction do not count, so the streak
      // is 0 and the tier is none. Asserted on the tier rather than on the
      // block's absence: LIFE-EX-CADENCE-5 renders a "not yet" line at none,
      // because saying nothing let the model ask again immediately.
      expect(out).toContain('streak="0"');
      expect(out).toContain('tier="none"');
    });

    it('does NOT inject the directive on a practiceOutcome turn (already post-graded)', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          fakeEvent('decision', { choiceId: 'a', text: 'X' }),
          fakeEvent('decision', { choiceId: 'b', text: 'Y' }),
          fakeEvent('decision', { choiceId: 'c', text: 'Z' }),
        ],
        practiceOutcome: {
          kind: 'generation',
          correct: true,
          picked: 'voudrais',
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café',
        },
        isOpeningBeat: false,
      });
      expect(out).not.toContain('<practiceCadence');
    });
  });

  describe('options turn (LIFE-NODE-2)', () => {
    it('LIFE-NODE-2 — renders <turn kind="options"> with the node kind', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [fakeEvent('beat', { speaker: 'narrator', practiceText: 'X' })],
        isOpeningBeat: false,
        requestKind: 'options',
        currentNodeKind: 'branch',
      });
      expect(out).toContain('<turn kind="options" nodeKind="branch">');
      expect(out).not.toContain('<turn kind="continue">');
    });

    it('LIFE-CTX-1 — currentLocation + goals render in the volatile tail (after <summary>, before <recentEvents>), not the stable prefix', () => {
      const out = buildLifeStepPrompt({
        world: {
          ...baseWorld,
          currentLocationLabel: 'Le café · matin',
          goalLadder: {
            saga: { text: 'reach the coast', when: 'Friday', days: 12 },
            objective: { id: 'o1', text: 'Find the letter' },
            done: [],
            dayIndex: 0,
          },
        },
        events: [fakeEvent('beat', { speaker: 'narrator', practiceText: 'X' })],
        isOpeningBeat: false,
        choice: { id: 'x', practiceText: 'Y' },
      });
      expect(out).toContain('<location>Le café · matin</location>');
      expect(out).toContain('<objective>Find the letter</objective>');
      // Cache health: below the stable roster block, and between summary and
      // recent events — so a scene/goal change doesn't evict the prefix cache.
      expect(out.indexOf('<currentState>')).toBeGreaterThan(out.indexOf('<npcRoster'));
      expect(out.indexOf('<currentState>')).toBeGreaterThan(out.indexOf('<summary'));
      expect(out.indexOf('<currentState>')).toBeLessThan(out.indexOf('<recentEvents'));
    });

    it('LIFE-NODE-1 — continuation options turn demands the single continue option', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [fakeEvent('beat', { speaker: 'narrator', practiceText: 'X' })],
        isOpeningBeat: false,
        requestKind: 'options',
        currentNodeKind: 'continuation',
      });
      expect(out).toContain('nodeKind="continuation"');
      expect(out).toContain('exactly ONE option with id "continue"');
    });
  });
});

describe('lifeStepSystemInstruction — LIFE-NODE turn contract', () => {
  const si = () =>
    lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 3,
    });

  it('LIFE-NODE-4 — the always-visible composer line is gone', () => {
    expect(si()).not.toContain('free-text composer below the chips');
  });

  it('LIFE-NODE-5 + LIFE-SCENE-24 (both retired) — no noPreview pin, no accept chip', () => {
    // The pin existed to force the hook-accept chip to route live; every pick
    // routes live now. And with LIFE-SCENE-24 there is no accept chip at all,
    // because there is no hook to accept.
    expect(si()).not.toContain('acceptChipId');
    expect(si()).not.toContain('noPreview');
  });

});

describe('lifeStepSystemInstruction — two-channel language model (LIFE-LANG-8/9/10/11)', () => {
  const si = (systemLanguage = 'English') =>
    lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage,
      difficulty: 2,
    });

  it('LIFE-LANG-8 — dialogue is the practice language with a system-language gloss', () => {
    const out = si('English');
    expect(out).toMatch(/DIALOGUE[\s\S]*French/);
    expect(out).toContain('faithful English gloss');
  });

  it('LIFE-LANG-15 — options are the system language only, in ONE field', () => {
    // Options are the player's meta-choices, shown in the system language.
    // v2 authored the same label into BOTH practiceText and nativeText; the
    // duplicate is pure output-token waste, so the model is now asked for
    // `nativeText` alone and `fillOptionLabel` derives practiceText at the
    // parse seam (stepSchema). The prose rule said this already while the JSON
    // schema block below it still asked for both fields — and the schema block
    // is what the model copies, so the saving never landed. These assert the
    // SCHEMA BLOCK, not just the prose.
    const out = si('English');
    expect(out).toContain('English ONLY');
    expect(out).not.toContain('IDENTICAL English label');
    expect(out).toContain('The ONLY label field on an option');
    // The option entry asks for nativeText and NOT practiceText. (`saysLine`
    // legitimately still carries a practiceText — that one is a real practice-
    // language line, so scope the assertion to the option's own label line.)
    const optionLabelLine = out
      .split('\n')
      .find((l) => l.includes('player-ACTION label'));
    expect(optionLabelLine).toContain('"nativeText"');
    expect(optionLabelLine).not.toContain('"practiceText":');
  });

  it('LIFE-LANG-9 (v2) — the level scopes to ALL practice text: narration AND dialogue', () => {
    const out = si('English');
    expect(out).toContain('LANGUAGE LEVEL (LIFE-LANG-9)');
    expect(out).toContain('NARRATION and DIALOGUE');
    expect(out).toContain('level 2/7');
    // Narration is no longer exempt from leveling.
    expect(out).not.toContain('does NOT touch the NARRATION');
  });

  it('LIFE-LANG-9 (v2) — age-reader framing levels the LANGUAGE only, never the content (noir stays noir)', () => {
    const out = si('English');
    // LIFE-LANG-9.1 renamed the heading and dropped the numeric age mapping
    // ("~ages 4-6"), keeping the actionable analogy on each band row
    // ("beginner ≈ early reader"). Asserted on the RULE, which is unchanged:
    // level fixes the language and never the content.
    expect(out).toMatch(/LEVEL GOVERNS LANGUAGE, NEVER STORY/i);
    expect(out).toMatch(/sanitise/i);
    expect(out).toContain('full-strength story');
    // The dark illustration proves content is untouched. It rides with the
    // BEGINNER band now, so at this fixture's level the guarantee is carried by
    // the rule's own example instead.
    expect(out).toMatch(/noir|sang|tombe/i);
  });

  it('LIFE-LANG-10 — richer vocab: full-line SEGMENTATION governs the practice channel (no 1-3 cap)', () => {
    const out = si('English');
    expect(out).toContain('VOCABULARY ANNOTATION');
    expect(out).toContain('SEGMENTATION, NOT SELECTION');
    expect(out).not.toContain('1–3 hardest words');
    expect(out).not.toContain('1-3 hardest words');
  });

  it('LIFE-STORY-RHYTHM — the opening leads with establishing prose, not an NPC line', () => {
    const out = buildLifeStepPrompt({ world: baseWorld, events: [], isOpeningBeat: true });
    expect(out).toContain('ESTABLISHING narrator beat');
    expect(out).toContain('Do NOT open on an NPC line');
  });

});
/**
 * LIFE-CTX-9..12 — the history the model reads is the one machinery guarantees,
 * not the one a prompt asks for. Each case here is a shipped inconsistency:
 * lines attributed to the wrong character, narration the model could not see,
 * a graded answer echoing back in the wrong shape, and a cache that dropped on
 * every turn.
 */
describe('buildLifeStepPrompt — history fidelity + cache stability (LIFE-CTX-9..12)', () => {
  const build = (over: Partial<LifeStepInput> = {}): string =>
    buildLifeStepPrompt({ world: baseWorld, events: [], isOpeningBeat: false, ...over });

  it('LIFE-CTX-10 — a beat carries its npcId, binding the line to the roster row', () => {
    const out = build({
      events: [fakeEvent('beat', {
        speaker: 'npc', speakerName: 'Sophie', npcId: 'n-sophie', practiceText: 'Salut !',
      })],
    });
    expect(out).toContain('npcId="n-sophie"');
    expect(out).toContain('name="Sophie"');
  });

  it('LIFE-CTX-10 — a narrator beat with empty practiceText renders its narration, not an empty row', () => {
    const out = build({
      events: [fakeEvent('beat', {
        speaker: 'narrator', practiceText: '', nativeText: 'The door swings open.',
      })],
    });
    expect(out).toContain('The door swings open.');
    expect(out).not.toContain('<event kind="beat" speaker="narrator"></event>');
  });

  it('LIFE-CTX-10 — the player’s own choice is marked as the player’s', () => {
    const out = build({
      events: [fakeEvent('decision', { choiceId: 'go-in', text: 'Step inside' })],
    });
    expect(out).toContain('actor="player"');
  });

  it('LIFE-CTX-11 — a graded exchange never enters the narrative history', () => {
    const out = build({
      events: [
        fakeEvent('correction', {
          kind: 'generation', correct: true, picked: 'veux',
          correctAnswer: 'veux', promptSource: 'Je ___ un café.',
        }),
        fakeEvent('beat', { speaker: 'user', practiceText: 'Je veux un café.' }),
      ],
    });
    // The in-world line the player SAID is history; the quiz mechanics are not.
    expect(out).toContain('Je veux un café.');
    expect(out).not.toContain('kind="correction"');
    expect(out).not.toContain('picked=');
  });

  it('LIFE-CTX-5 — the NPC roster renders id-sorted, so a new NPC appends deterministically', () => {
    const npc = (id: string, name: string) => ({
      id, name, avatarStatus: 'ready' as const, scope: 'world' as const,
    });
    const out = build({
      // Deliberately unsorted, as Firestore doc order delivers them.
      npcs: [npc('n-zoe', 'Zoe'), npc('n-alice', 'Alice'), npc('n-marc', 'Marc')],
    });
    // Both the roster AND the derived canon entries must be id-ordered — the
    // canon is append-only, so a reshuffling tail would evict the prefix too.
    for (const block of ['<canon>', '<npcRoster>']) {
      const seg = out.slice(out.indexOf(block));
      expect(seg.indexOf('n-alice'), block).toBeLessThan(seg.indexOf('n-marc'));
      expect(seg.indexOf('n-marc'), block).toBeLessThan(seg.indexOf('n-zoe'));
    }
  });

  it('LIFE-CTX-9 — no per-turn counter renders above <summary>', () => {
    const out = build({
      scene: {
        id: 'c-1', status: 'active', currentPhase: 'rising', turnsSinceReplan: 7,
        outline: {
          title: 'T', premise: 'P', tone: 'warm', practiceFocus: [], keyNpcs: [],
          openBranches: [], candidateEndings: [], completionTriggers: [],
        },
      } as unknown as LifeStepInput['scene'],
    });
    const head = out.slice(0, out.indexOf('<currentState'));
    expect(head).not.toContain('turnsSinceReplan');
  });
});

/**
 * LIFE-UNIVERSE-1 / LIFE-STORY-LOG-1 — the two layers the hierarchy was
 * missing. The universe is the SETTING (fixed for the world's life, so it
 * anchors the cache prefix); the story log is what has actually happened (
 * append-only, so it outlives the 40-event read window that `rollingSummary`
 * lossily rewrites).
 */
describe('buildLifeStepPrompt — universe + story log', () => {
  const sagaWith = (universe: unknown) => ({
    title: 'T', titleNative: 'T', premise: 'p', playerFacingTeaser: '', tone: 'noir',
    estimatedChapters: 5, centralConflict: 'c', antagonist: 'a', factions: [],
    keyArchetypes: [], storyMovements: [], midpointTwist: 'm', climax: 'x',
    endStates: [], loveInterestFate: 'open' as const, openThreads: [],
    universe,
  });

  it('LIFE-UNIVERSE-1 — the laws render, from the TOP-LEVEL universe field', () => {
    // The universe used to hang off `saga.universe`. `sagaOpen` writes
    // `world.universe` instead, and `renderUniverse` still read the old path —
    // so the laws would have silently vanished from every prompt in every new
    // world without one test failing. This is why the assertion names the
    // field, not just the output.
    const out = buildLifeStepPrompt({
      world: {
        ...baseWorld,
        universe: {
          setting: 'A drowned river-town',
          era: 'thirty years after the flood',
          laws: ['The hush-spirits cannot speak aloud; they answer by moving objects.'],
          places: ['The Ferry House'],
          figures: [{ name: 'The Warden', what: 'keeps the tide-gate' }],
        },
      } as unknown as LifeWorld,
      events: [], isOpeningBeat: false,
    });
    expect(out).toContain('<law>The hush-spirits cannot speak aloud');
    // The universe never changes, so it belongs at the very top of the prefix —
    // above everything that changes at scene or turn cadence.
    expect(out.indexOf('<universe>')).toBeLessThan(out.indexOf('<canon'));
    expect(out.indexOf('<universe>')).toBeLessThan(out.indexOf('<naming'));
  });

  it('LIFE-UNIVERSE-1 — a legacy saga with no universe renders no block', () => {
    const out = buildLifeStepPrompt({
      world: { ...baseWorld, saga: sagaWith(undefined) } as unknown as LifeWorld,
      events: [], isOpeningBeat: false,
    });
    expect(out).not.toContain('<universe>');
  });

  it('LIFE-STORY-LOG-1 — entries render in order, in the volatile tail just above <recentEvents>', () => {
    const out = buildLifeStepPrompt({
      world: {
        ...baseWorld,
        storyLog: { chapterNumber: 1, entries: ['Marc refused the key.', 'Sophie left angry.'] },
      } as unknown as LifeWorld,
      events: [], isOpeningBeat: false,
    });
    expect(out).toContain('<happened>Marc refused the key.</happened>');
    expect(out.indexOf('Marc refused')).toBeLessThan(out.indexOf('Sophie left'));
    expect(out.indexOf('<storySoFar>')).toBeLessThan(out.indexOf('<recentEvents'));
  });
});

/**
 * LIFE-CTX-13 — every-turn-mutating blocks render BELOW the semi-stable prefix,
 * and NPC identity is decoupled from NPC memory. This is the WS1 cache-placement
 * fix: <storySoFar> grew every turn while sitting above the roster/scene, and
 * each per-NPC memory change rewrote the whole roster row — both evicted the
 * Gemini prefix cache on nearly every call.
 */
describe('buildLifeStepPrompt — LIFE-CTX-13 (cache placement)', () => {
  const npc = (id: string, name: string, oneLineMemory?: string) => ({
    id, name, avatarStatus: 'ready' as const, scope: 'world' as const,
    ...(oneLineMemory ? { oneLineMemory } : {}),
  });

  it('<storySoFar> renders AFTER <npcRoster> — it moved out of the stable prefix into the tail', () => {
    const out = buildLifeStepPrompt({
      world: {
        ...baseWorld,
        storyLog: { chapterNumber: 1, entries: ['The tide came in.'] },
      } as unknown as LifeWorld,
      npcs: [npc('n-sophie', 'Sophie')],
      events: [], isOpeningBeat: false,
    });
    // The KEY fix: storySoFar no longer sits above the roster/scene prefix.
    expect(out.indexOf('<npcRoster')).toBeLessThan(out.indexOf('<storySoFar>'));
    expect(out.indexOf('<storySoFar>')).toBeLessThan(out.indexOf('<recentEvents'));
  });

  it('npcRoster rows are identity-only (self-closing) — the memory is NOT embedded in the row', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      npcs: [npc('n-sophie', 'Sophie', 'Owes Marc a favour after the ferry.')],
      events: [], isOpeningBeat: false,
    });
    const rosterSeg = out.slice(out.indexOf('<npcRoster'), out.indexOf('</npcRoster>'));
    expect(rosterSeg).toContain('name="Sophie"');
    expect(rosterSeg).toContain('/>'); // self-closing row
    // The memory must NOT bloat the (otherwise byte-stable) roster row.
    expect(rosterSeg).not.toContain('Owes Marc a favour');
  });

  it('per-NPC memory renders in its own <npcMemory npcId="…"> block, in the tail below the roster', () => {
    const out = buildLifeStepPrompt({
      world: { ...baseWorld, currentLocationLabel: 'The Ferry House' } as LifeWorld,
      npcs: [npc('n-sophie', 'Sophie', 'Owes Marc a favour after the ferry.')],
      events: [], isOpeningBeat: false,
    });
    expect(out).toContain('<npcMemory npcId="n-sophie">Owes Marc a favour after the ferry.</npcMemory>');
    // Rare-volatile: below the stable roster prefix, above the every-turn state.
    expect(out.indexOf('<npcRoster')).toBeLessThan(out.indexOf('<npcMemory'));
    expect(out.indexOf('<npcMemory')).toBeLessThan(out.indexOf('<currentState'));
  });

  it('an NPC with no memory contributes no <npcMemory> row (block omitted when all empty)', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      npcs: [npc('n-sophie', 'Sophie')],
      events: [], isOpeningBeat: false,
    });
    expect(out).not.toContain('<npcMemory');
  });

  it('<recentEvents> render is capped at the last 20 events; older history lives in <storySoFar>', () => {
    // 25 verbatim beats loaded; only the last 20 should render.
    const events: LifeEvent[] = Array.from({ length: 25 }, (_, i) =>
      fakeEvent('beat', {
        speaker: 'narrator', practiceText: '', nativeText: `MOMENT_${i}.`,
      }),
    );
    const out = buildLifeStepPrompt({ world: baseWorld, events, isOpeningBeat: false });
    const eventsSeg = out.slice(out.indexOf('<recentEvents>'), out.indexOf('</recentEvents>'));
    // First 5 (MOMENT_0..4) fall outside the last-20 window.
    expect(eventsSeg).not.toContain('MOMENT_0.');
    expect(eventsSeg).not.toContain('MOMENT_4.');
    // The last 20 (MOMENT_5..24) are present.
    expect(eventsSeg).toContain('MOMENT_5.');
    expect(eventsSeg).toContain('MOMENT_24.');
  });
});

/**
 * LIFE-STORY-VOICE-1 — most lines are plain.
 *
 * Reported 2026-08-01: "the text in storylines is so overly written. Every line
 * is delivered like a haunting finisher." The session behind it had four
 * consecutive NPC lines on the same antithesis-reveal frame.
 *
 * The rules are asserted as REACHING THE MODEL — the SI is the only thing this
 * layer controls, and a rule extracted into another module is exactly the sort
 * of change that can silently stop being spread into the array.
 */

// ---------------------------------------------------------------------------
// LIFE-STORY-STAGE-1/2 — the world clock reaches the PROMPT, and gates the saga
// ---------------------------------------------------------------------------
//
// The unit-level contract lives in `storyStage.test.ts`. What these assert is
// the WIRING, which is where the equivalent pacing features kept failing
// before (`LIFE-ARC-PACE-1`: the rule existed, the block never reached the
// prompt, and chapters ran forever). A stage the model never sees is not a
// stage.
describe('LIFE-STORY-STAGE-1/2 — the story stage reaches the step prompt', () => {
  const sagaWorld = (turns: number, chapterNumber = 1): LifeWorld =>
    ({
      ...baseWorld,
      storyLog: { chapterNumber, entries: ['They arrived.'], turns },
      ...(chapterNumber > 1
        ? {
            currentArc: {
              chapterNumber,
              premise: 'The second chapter.',
              playerTeaser: '',
              themes: [],
              recurringNpcIds: [],
              completedSceneMemories: [],
            },
          }
        : {}),
      saga: {
        title: 'Les Marées',
        titleNative: 'The Tides',
        premise: 'SPOILER PREMISE about the whole book.',
        playerFacingTeaser: 'A harbour town and a room above the chandlery.',
        tone: 'warm',
        estimatedChapters: 5,
        centralConflict: 'CONFLICT-MARKER',
        antagonist: 'ANTAGONIST-MARKER',
        factions: [],
        keyArchetypes: [],
        storyMovements: [],
        midpointTwist: 'TWIST-MARKER',
        climax: 'CLIMAX-MARKER',
        endStates: [],
        loveInterestFate: 'open',
        openThreads: [],
      },
    }) as never;

  it('emits <storyStage> on a young first chapter', () => {
    const out = buildLifeStepPrompt({ world: sagaWorld(2), events: [], isOpeningBeat: false });
    expect(out).toContain('<storyStage stage="arrival"');
  });

  it('LIFE-ARCH-3 — the saga pillars are GONE, not withheld', () => {
    // These three tests used to assert the WITHHOLDING mitigation: pillars
    // hidden while a world was young, restored once underway. That was the
    // right fix while `worldSaga` still generated a midpointTwist and a climax
    // — LIFE-STORY-STAGE-2 measured that a model handed the twist writes toward
    // it, so the twist was kept out of the prompt for the first turns.
    //
    // The migration removes the need for the mitigation by removing what it
    // mitigated. `sagaOpen` never generates a twist, a climax, an antagonist or
    // a premise, so there is nothing to withhold at turn 2 and nothing to
    // restore at turn 30. A pillar the prompt can never contain cannot leak.
    for (const turns of [2, 30]) {
      const out = buildLifeStepPrompt({
        world: sagaWorld(turns),
        events: [],
        isOpeningBeat: false,
      });
      expect(out, `turns=${turns}`).not.toContain('TWIST-MARKER');
      expect(out, `turns=${turns}`).not.toContain('CLIMAX-MARKER');
      expect(out, `turns=${turns}`).not.toContain('ANTAGONIST-MARKER');
      expect(out, `turns=${turns}`).not.toContain('SPOILER PREMISE');
    }
  });

  it('LIFE-FRONT-1.1 — fronts render agenda + driver, NEVER a clock', () => {
    // A model handed "3/6 → the bakery is sold" writes a countdown whatever the
    // prose rules say. A model handed "Bébert is trying to buy the lease"
    // writes a person with an intention.
    const world = {
      ...sagaWorld(4),
      situation: 'You are three weeks into the season.',
      fronts: [
        {
          id: 'lease',
          name: 'The Lease',
          driverId: 'bebert',
          agenda: 'AGENDA-MARKER',
          kind: 'opportunity',
          scope: 'saga',
          resolved: null,
          clock: {
            filled: 3,
            size: 6,
            consequence: 'CONSEQUENCE-MARKER',
            peak: 3,
            unattended: 0,
            sinceAdvance: 9,
          },
        },
      ],
    } as never;
    const out = buildLifeStepPrompt({ world, events: [], isOpeningBeat: false });
    expect(out).toContain('AGENDA-MARKER');
    expect(out).toContain('driver="bebert"');
    expect(out).toContain('You are three weeks into the season.');
    // The two fields that would turn weather into a countdown.
    expect(out).not.toContain('CONSEQUENCE-MARKER');
    expect(out).not.toContain('3/6');
  });

  it('LIFE-CAST-1 — principals carry drive, regulars carry a routine', () => {
    const world = {
      ...sagaWorld(4),
      cast: [
        {
          id: 'rey', name: 'Rey', known: 'runs the bakery', tier: 'principal',
          voice: 'stern', standing: 0, ties: [],
          wants: 'WANTS-MARKER', nextMove: 'NEXTMOVE-MARKER',
        },
        {
          id: 'pierre', name: 'Pierre', known: 'buys a baguette', tier: 'regular',
          voice: 'loud', standing: 0, ties: [], routine: 'ROUTINE-MARKER',
        },
      ],
    } as never;
    const out = buildLifeStepPrompt({ world, events: [], isOpeningBeat: false });
    expect(out).toContain('WANTS-MARKER');
    expect(out).toContain('NEXTMOVE-MARKER');
    expect(out).toContain('ROUTINE-MARKER');
    // The anti-drama half: a regular has no ambition to render.
    expect(out).not.toContain('<wants></wants>');
  });

  it('names the cast shortfall from the live roster', () => {
    const out = buildLifeStepPrompt({
      world: sagaWorld(8),
      events: [],
      isOpeningBeat: false,
      npcs: [{ id: 'n1', name: 'Mireille', scope: 'world' }] as never,
    });
    expect(out).toContain('<cast known="1"');
  });

});

describe('LIFE-INTENT-2 — the open question reaches the step prompt', () => {
  const sceneWith = ({ outline: outlineExtra, ...extra }: Record<string, unknown>) => ({
    id: 'c-9',
    status: 'active' as const,
    outline: {
      title: 'The machinery',
      premise: 'Bruno has not answered about the equipment.',
      subject: 'the rusted equipment in the orchard',
      where: 'the orchard',
      tone: '',
      practiceFocus: [],
      keyNpcs: [],
      openBranches: [],
      candidateEndings: [],
      completionTriggers: [],
      ...((outlineExtra as object | undefined) ?? {}),
    },
    currentPhase: 'rising' as const,
    turnsSinceReplan: 1,
    ...extra,
  });

  it('LIFE-INTENT-2b — renders the question and the current leaning', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      isOpeningBeat: false,
      scene: sceneWith({
        outline: { openQuestion: 'will Bruno give up the machinery?' },
        leaning: 'he has not been asked yet',
        leaningStall: 0,
      }),
    } as unknown as Parameters<typeof buildLifeStepPrompt>[0]);
    expect(out).toContain('will Bruno give up the machinery?');
    expect(out).toContain('he has not been asked yet');
  });

  it('LIFE-INTENT-2a — a scene with no question costs no tokens', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      isOpeningBeat: false,
      scene: sceneWith({}),
    } as unknown as Parameters<typeof buildLifeStepPrompt>[0]);
    expect(out).not.toContain('<sceneQuestion');
  });

  it('LIFE-INTENT-2e — a stalled scene gets the escalation, not the calm body', () => {
    const out = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      isOpeningBeat: false,
      scene: sceneWith({
        outline: { openQuestion: 'will Bruno give up the machinery?' },
        leaning: 'he has not been asked yet',
        leaningStall: 2,
      }),
    } as unknown as Parameters<typeof buildLifeStepPrompt>[0]);
    expect(out).toMatch(/on rails/i);
  });
});

/**
 * LIFE-DATA-DRIFT-2 — "every scene signal the schema accepts is one the prompt
 * ASKS for" — MOVED to `tests/playthrough/serverPromptParity.test.ts` by
 * SRV-PROMPT-8..13 batch 8.
 *
 * It is a CROSS-SIDE agreement: the schema (`ZStepSceneSignal`,
 * `ZBackdropIntentFields`) is client-side Zod that parses the model's answer
 * and never migrates, while the output contract it must agree with is now the
 * server's system instruction. `functions/` cannot import `src/`, so the only
 * file in the repo that can reach both halves is the playthrough parity suite —
 * which is where the lexicon containment guard already lives, for exactly this
 * reason. It kept its assertions; only its home changed.
 */

/**
 * LIFE-CONTRACT-EX-6 — the prompt must OFFER the lead-in slot and FORBID the
 * leak, because the schema alone cannot ask for something.
 *
 * The old contract said `question: OMIT (no beats)` in the very line that
 * describes the beats array. A model reading that had no way to narrate the
 * action that triggered the question even if it wanted to.
 */
describe('LIFE-CONTRACT-EX-6 — the question node advertises its lead-in', () => {
  const si = () =>
    lifeStepSystemInstruction({
      practiceLanguage: 'French',
      systemLanguage: 'English',
      difficulty: 2,
    } as unknown as Parameters<typeof lifeStepSystemInstruction>[0]);

  it('no longer tells the model a question node has no beats', () => {
    expect(si()).not.toContain('question: OMIT (no beats)');
  });

  it('exempts a pure speech pick, so the model does not invent a lead-in for one', () => {
    expect(si()).toContain('"beats": []');
  });
});

/**
 * LIFE-BACKDROP-26 / LIFE-CANON-8 — the locationLabel EXAMPLE must obey the
 * locationLabel RULE.
 *
 * `WHAT_THE_PLAYER_KNOWS_RULES` says, in the same system instruction: *"Do NOT
 * append the hour to it ('Ton appartement · matin'): <timeOfDay> is tracked
 * separately and moves on its own, so a label with a time baked in goes stale."*
 * The SCENE RULES block then illustrated the field with "Le Café de Flore ·
 * matin" and "Your office · 9am" — both of the things the rule forbids, and an
 * example beats a prohibition every time.
 */
describe('LIFE-BACKDROP-26 — no worked example contradicts the no-hour rule', () => {
  it('the locationLabel examples carry no time of day', () => {
    const si = lifeStepSystemInstruction({
      practiceLanguage: 'French',
      systemLanguage: 'English',
      difficulty: 2,
    } as unknown as Parameters<typeof lifeStepSystemInstruction>[0]);
    const lines = si.split('\n').filter((l) => l.includes('locationLabel'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      // The rule line itself quotes the forbidden form in order to forbid it.
      if (line.includes('Do NOT append the hour')) continue;
      expect(line, `time baked into a locationLabel example: ${line}`).not.toMatch(
        /· ?(matin|soir|midi|nuit|morning|evening|night)|\d{1,2}\s?(am|pm)/i,
      );
    }
  });
});

/**
 * LIFE-CONTRACT-EX-9 — the NODE MODEL may not state a rule that LIFE-CONTRACT-EX-7
 * overrides 130 lines later.
 *
 * MEASURED, 2026-08-09, over the 95 `life_step` calls of the 2026-08-07
 * three-world archive. 18 of them (18.9%) were REGENERATIONS, and only ONE of
 * the 95 responses failed the Zod schema — so the retries were almost all
 * cross-turn validator rejections. Attributing them:
 *
 *     question-omits-lead-in   15
 *     unknown-entity-ref        2
 *     unexplained               1
 *
 * Fifteen of eighteen retries — 15.8% of the app's single biggest cost line,
 * and a doubled wait on roughly one turn in five — were the model emitting a
 * question node with ZERO beats. Which is exactly what the system instruction
 * told it to do, twice, in absolute terms, in the two DEFINITIONAL sections:
 *
 *     NODE MODEL: '"question" … NO beats and NO top-level options'
 *     BEAT RULES: 'Question nodes carry ZERO beats'
 *
 * while LIFE-CONTRACT-EX-7's conditional exception ("when the player's pick was
 * an ACTION it MUST land what they did") sits ~130 lines below both. The model
 * was complying and being charged a full 22k-token regeneration for it.
 *
 * The same shape as LIFE-EX-13.4 and LIFE-CONTRACT-EX-8: a rule stated
 * absolutely and EARLY silently pre-empts the conditional case stated later,
 * and no retry ladder can fix a pair of rules that point at each other — the
 * hint argues with the model while the SI still says ZERO.
 *
 * The fix is output-NEUTRAL, which is why it needed no story re-validation: in
 * all 15 cases the retry produced a question WITH a lead-in beat (15/15, none
 * still empty, none demoted to another node kind). The player already sees the
 * lead-in version every time. Only the wasted first call goes away.
 */
describe('LIFE-CONTRACT-EX-9 — the beat rules do not contradict the lead-in rule', () => {
  const si = () =>
    lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      systemLanguage: 'English',
      difficulty: 3,
    });

  it('never states that a question node carries ZERO / NO beats as an absolute', () => {
    const text = si();
    // The two exact phrasings that cost 15 regenerations. Asserted as phrases
    // rather than a regex over "question.*beats", because the SI legitimately
    // says a great deal about question beats — what it may not do is state a
    // flat prohibition.
    expect(text).not.toContain('NO beats and NO top-level options');
    expect(text).not.toContain('Question nodes carry ZERO beats');
  });

  it('still forbids top-level OPTIONS on a question node', () => {
    // The beats half of that sentence was wrong; the options half was right —
    // the graded generator authors the chips (LIFE-EX-GEN-1). Deleting the
    // whole clause would have lost a rule that IS load-bearing.
    expect(si()).toMatch(/question[\s\S]{0,400}no top-level options/i);
  });
});
