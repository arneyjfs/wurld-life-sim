/**
 * E2E: /wurlds node/lookahead engine (LIFE-NODE-*), mocked Gemini.
 *
 *   1.  Onboarding chip → world DOC exists (Firestore post-condition).
 *   2.  Seeded world: opening branch node — 3 options + client ✏️,
 *       no always-visible composer.
 *   3.  LIFE-BUBBLE-7 (Phase E carry-over): vocab tap → popover →
 *       save → flashcard doc with story context.
 *   4.  Cached pick renders INSTANTLY (options response held back),
 *       skeleton chips, commit-on-pick events in Firestore.
 *   5.  ✏️ write-your-own: chip opens the composer; submit lands a
 *       '__write__' decision event.
 *   6.  Fill-blank question node: authoring shimmer → gloss-free
 *       chips (LIFE-LANG-1) → feedback → Continue → resolved bubble
 *       + correction event; post-feedback node was prefetched.
 *   7.  Comprehension question node: native-only chips (LIFE-LANG-1)
 *       + Why? ExplainModal with streamed content (LIFE-LANG-5).
 *   8.  view settings flip bubble languages (chips stay native) and persist
 *       (LIFE-LANG-3, Phase D carry-over).
 *   9.  options-failed Continue ladder (mock 500) — pick's commit
 *       still landed (LIFE-NODE-8).
 *   10. Resume recap screen from stored data; Continue releases the
 *       resume chip (LIFE-FLOW-5, Phase C carry-over).
 *   11. World exit fires the recap generator and persists
 *       resumeRecap (LIFE-FLOW-5, Phase C carry-over).
 *   12. LIFE-UI-8 (Phase A carry-over): rebrand copy renders on the
 *       Wurlds tab + overview — ported unchanged (engine-agnostic).
 *   13. LIFE-EX-9: listen-and-fill graded flow — resolved bubble + the
 *       correction event. (Flashcard threading / SM-2-from-story was
 *       removed 2026-07; SRS now lives only in the practice session.)
 *
 * Phone prefix: +1000060_A (stable pool — HARNESS-ACCOUNTS-1).
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as admin from 'firebase-admin';
import {
  provisionTestUser,
  signInBrowser,
  type AuthenticatedUser,
} from '../helpers/auth';
import { cleanupTestUsers, getAdminFirestore } from '../helpers/firebase-admin';
import { captureBeat } from '../helpers/screenshots';
import { enableWurlds } from '../helpers/betaFlags';
import {
  attachDiagnostics,
  captureConsole,
  watchMount,
  type ConsoleCapture,
} from '../helpers/diagnostics';
import {
  installLifeMock,
  minimalBackdropSvg,
  SAGA_OPEN_FIXTURE,
  type GradedQuestionFixture,
} from '../helpers/lifeMock';
import type { RawNodeResponseInput } from '../../../src/lib/life/stepSchema';

/** LIFE-LANG-5: single-frame SSE body for the ExplainModal stream —
 *  same shape practice-explain.spec.ts uses. */
function sseBody(text: string): string {
  return `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`;
}

const LIFE_EXPLAIN_XML = `<explanation>
<review verdict="correct" score="0">
Right — "près du bureau" means "near the office", so she is asking about a café near the office.
</review>
<section title="Key phrase">
"près du bureau" = near the office.
</section>
</explanation>`;

const USER_A = {
  phone: process.env.TEST_PHONE_LIFE_A || '+10000600001',
  displayName: 'Life Alice',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'French',
  difficulty: 3,
};

let userA: AuthenticatedUser;
let context: BrowserContext;
let page: Page;
let worldId: string;
/** LIFE-FLOW-7 — see `helpers/diagnostics.ts`. Attached only on failure. */
let consoleCapture: ConsoleCapture | null = null;

/** Stable pool account — wipe every lifeWorld (and legacy singleton
 *  collections) so reruns never hit the MAX_WORLDS cap. 'flashcards'
 *  rides along (Phase E): a card saved by a previous run would start
 *  the vocab popover in "saved" state. */
async function wipeLifeData(uid: string): Promise<void> {
  const db = getAdminFirestore();
  const worlds = await db.collection(`users/${uid}/lifeWorlds`).get();
  for (const doc of worlds.docs) {
    await db.recursiveDelete(doc.ref);
  }
  for (const col of ['lifeWorld', 'lifeEvents', 'lifeNpcs', 'lifeBackdrops', 'flashcards']) {
    const snap = await db.collection(`users/${uid}/${col}`).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

/**
 * LIFE-FLOW-7 — no ENTRY overlay may be up once the dialogue is live.
 *
 * `WorldIntroScreen` and `WurldResumeScreen` are both `fixed inset-0` with a
 * translucent backdrop, so one of them up mid-turn does not hide the option
 * grid — it *dims* it and eats the pointer. Playwright reports that as a click
 * that never lands, and the test dies on its 120-SECOND budget with no clue
 * which element intercepted: exactly how `LIFE-GRID-4/5` failed on 2026-09-19
 * under box load, where only the failure screenshot gave the cause away.
 *
 * So the cost of not having this assertion is a two-minute timeout and a
 * screenshot to squint at; the cost of having it is one DOM query. Call it
 * immediately before any mid-turn interaction on a world this test drove from
 * fresh — never after a deliberate `page.goto` back into a played world, where
 * the recap is the CORRECT screen (LIFE-FLOW-5).
 *
 * ⚠ This does not fix the underlying race, which has not been reproduced — see
 * the LIFE-FLOW-7 row in docs/specs/life-sim.md. It converts the next
 * occurrence from a mystery timeout into a named failure with the state
 * attached, which is what the last occurrence cost a whole gate to establish.
 */
async function expectNoEntryOverlay(page: Page, when: string): Promise<void> {
  for (const id of ['LifeScreen-WorldIntro', 'LifeScreen-WurldResume']) {
    await expect(
      page.getByTestId(id),
      `${id} is up ${when} — an entry overlay is covering a live dialogue ` +
        `(LIFE-FLOW-7). It is 'fixed inset-0', so every chip below it is ` +
        `unclickable; a chip-click timeout here means THIS, not a slow model.`,
    ).toHaveCount(0);
  }
}

/** Seed a ready-to-play world (saga + chapter inline) so the engine
 *  tests don't depend on real saga/arc generation latency. */
async function seedWorld(uid: string): Promise<string> {
  const db = getAdminFirestore();
  const id = `w-${Date.now()}-e2e`;
  await db.doc(`users/${uid}/lifeWorlds/${id}`).set({
    id,
    characterName: 'Alice',
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    // LIFE-LANG-7/8: system language = narration language. Narrator
    // beats carry their narration in `nativeText` (English) with an
    // empty `practiceText`; NPC dialogue stays French with an English
    // gloss. system != practice here, so narrator beats get NO vocab.
    systemLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    worldMode: 'realistic',
    saga: {
      title: 'Une vie à Lyon',
      titleNative: 'A Life in Lyon',
      premise: 'Alice builds a new life in Lyon.',
      playerFacingTeaser: 'A new life in Lyon begins.',
      tone: 'warm slice-of-life',
      estimatedChapters: 4,
      centralConflict: 'Belonging vs homesickness',
      antagonist: 'Self-doubt',
      factions: [],
      keyArchetypes: [],
      storyMovements: [],
      midpointTwist: 'A job offer from home',
      climax: 'Choosing where home is',
      endStates: [],
      loveInterestFate: 'open',
      openThreads: [],
    },
    currentArc: {
      chapterNumber: 1,
      premise: 'Settle into the neighbourhood.',
      themes: [],
      status: 'active',
      recurringNpcIds: [],
      completedSceneMemories: [],
    },
  });
  return id;
}

type EventRow = { kind: string; payload: Record<string, unknown> };
async function readEvents(uid: string, wid: string): Promise<EventRow[]> {
  const db = getAdminFirestore();
  const snap = await db
    .collection(`users/${uid}/lifeWorlds/${wid}/events`)
    .get();
  return snap.docs.map((d) => d.data() as EventRow);
}

// --- fixtures (ZRawNodeResponse shape) -----------------------------------

/** Opening live node. The Sophie NPC beat carries Phase E vocab
 *  annotations so the LIFE-BUBBLE-7 test can drive word→popover→save
 *  on it, and introduces the 'sophie' npcId (LIFE-NPC-1 promotion
 *  rides the commit). */
const OPENING: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'You wake up in your apartment in Lyon.',
      },
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Salut ! On déjeune ensemble à midi ?',
        nativeText: 'Hi! Lunch together at noon?',
        complexWords: ['déjeune'],
        wordTranslations: { déjeune: 'have lunch' },
      },
    ],
  },
  options: [
    {
      id: 'sophie',
      practiceText: 'Rejoindre Sophie à la terrasse',
      nativeText: 'Join Sophie on the terrace',
      emoji: '☕',
    },
    {
      id: 'coffee',
      practiceText: 'Préparer un café',
      nativeText: 'Make a coffee',
    },
    {
      id: 'window',
      practiceText: 'Regarder par la fenêtre',
      nativeText: 'Look out the window',
    },
  ],
};

/** <turn kind="options"> response for the terrace node — no `node`. */
const OPTIONS_AT_TERRACE: RawNodeResponseInput = {
  // LIFE-NODE-2: a pick is a LIVE turn now, so this response carries the node
  // the pick leads to. Pre-E1 the beat below rode on the 'sophie' option as a
  // `next` preview and this fixture was options-only (pre-E1).
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'Sophie waves at you from the terrace.',
      },
    ],
  },
  options: [
    {
      id: 'sit',
      practiceText: "S'asseoir en face d'elle",
      nativeText: 'Sit down opposite her',
    },
    {
      id: 'wave',
      practiceText: 'Lui faire signe',
      nativeText: 'Wave back',
    },
  ],
};

/** Live response to the ✏️ free text. Its 'ask-week' option is what the next
 *  test picks; the question it leads to is authored by that pick's live call
 *  (QUESTION_FILL_BLANK_LIVE), not carried here (LIFE-NODE-2). */
const WRITE_RESPONSE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'You suggest a walk in the park.',
      },
    ],
  },
  options: [
    {
      id: 'ask-week',
      practiceText: 'Proposer un déjeuner',
      nativeText: 'Suggest lunch',
    },
    {
      id: 'walk',
      practiceText: 'Marcher en silence',
      nativeText: 'Walk in silence',
    },
  ],
};

/** LIFE-NODE-2: a question arrives as the NODE of the live call a pick fires
 *  (pre-E1 it rode on the option as a `next` preview). No beats, no options —
 *  the chips come from the graded generator at show time. */
const QUESTION_FILL_BLANK_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'question',
    gradedPlan: {
      kind: 'fill-blank',
      testTarget: 'voudrais',
      sentenceContext: 'Je voudrais déjeuner avec toi.',
    },
  },
  options: [],
};

const QUESTION_COMPREHENSION_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'question',
    gradedPlan: {
      kind: 'comprehension',
      // TTS-VOICE-7, corrected 2026-08-11: this MUST match
      // `GRADED_COMPREHENSION.practicePrompt.npcUtterance`. `pinPlannedUtterance`
      // (nodeEngineVoice.ts) overwrites the generated line with the PLAN's, so
      // the engine can pre-warm audio a round-trip early and have playback ask
      // for the same cache key. The two fixtures disagreed — the plan said "Tu
      // veux un café ?" while the generator returned the café-near-the-office
      // line — so the card rendered the plan's sentence and the spec asserted
      // the generator's, which is a fixture pair the app cannot satisfy.
      //
      // The generator's contract says the same thing in prose ("copy from plan,
      // do not paraphrase"), so aligning the PLAN to the richer sentence keeps
      // the chips meaningful rather than flattening them to a yes/no line.
      npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
      speakerName: 'Sophie',
      npcId: 'sophie',
    },
  },
  options: [],
};

/** LIFE-LANG-1: fill-blank chips are practice-language only — the
 *  empty nativeText is the generator contract (Phase D), not an
 *  omission. */
const GRADED_FILL_BLANK: GradedQuestionFixture = {
  practicePrompt: {
    kind: 'fill-blank',
    practiceText: 'Je ___ déjeuner avec toi.',
    nativeText: 'I ___ to have lunch with you.',
    // LIFE-LANG-6: full native translation with the blank FILLED (shown
    // in the post-answer feedback overlay). Guard-required for fill-blank.
    completedNativeText: 'I would like to have lunch with you.',
    // LIFE-EX-GEN-9: [voudrais/veux/ai] all fit the slot, so the question must
    // say HOW one is right. 'translation-anchor' shows the meaning pre-answer
    // (LIFE-LANG-17) — without it this chip set is unanswerable.
    disambiguation: 'translation-anchor',
  },
  choices: [
    { id: 'voudrais', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
    { id: 'veux', practiceText: 'veux', nativeText: '', correctness: 'wrong', whyWrong: 'blunt "want", not a polite invitation' },
    { id: 'ai', practiceText: 'ai', nativeText: '', correctness: 'wrong', whyWrong: 'means "have", not "would like"' },
  ],
};

/** LIFE-CANON-1 / LIFE-STORY-LOG-1: a live-turn response that ESTABLISHES
 *  something. `introduces` records an entity whose nature constrains
 *  interaction (a spirit that cannot speak) and `logLine` records what
 *  happened; both are TURN-level, so they commit when this response lands.
 *  Carries a node: every pick is a live turn (LIFE-NODE-2). */
const LEDGER_OPTIONS: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'Something shifts in the kitchen doorway.',
      },
    ],
  },
  options: [
    { id: 'watch', practiceText: 'Watch the doorway', nativeText: 'Watch the doorway',
      targetId: 'char-mireille',},
    { id: 'leave', practiceText: 'Leave the kitchen', nativeText: 'Leave the kitchen' },
  ],
  introduces: [
    { kind: 'character', name: 'Mireille', subKind: 'spirit', canSpeak: false,
      note: 'answers only by moving objects' },
  ],
  logLine: 'A hush-spirit named Mireille appeared in the kitchen.',
};

/** Prefetched post-fill-blank live node (LIFE-CONTRACT-EX-3: the NPC
 *  reacts; never re-quotes the practised line). Its 'ask-coffee' option is
 *  what the LIFE-LANG-1/5 test picks; the comprehension question that pick
 *  leads to is queued separately (QUESTION_COMPREHENSION_LIVE). */
const POST_FEEDBACK_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Génial ! À midi alors.',
        nativeText: 'Great! At noon then.',
      },
    ],
  },
  options: [
    {
      id: 'ask-cafe',
      practiceText: 'Demander où déjeuner',
      nativeText: 'Ask where to have lunch',
    },
    {
      id: 'leave',
      practiceText: 'Partir travailler',
      nativeText: 'Head to work',
    },
  ],
};

/** LIFE-LANG-1: comprehension chips carry the REQUIRED native
 *  interpretation; practiceText is retained for records but never
 *  rendered (chipDisplay='native'). */
const GRADED_COMPREHENSION: GradedQuestionFixture = {
  practicePrompt: {
    kind: 'comprehension',
    npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
    question: 'What is Sophie asking?',
    // LIFE-LANG-12: faithful translation of the whole line — distinct from
    // the chips' third-person interpretations.
    utteranceNativeText: 'Do you know a good café near the office?',
    // LIFE-EX-VOCAB-3, added 2026-08-11: REQUIRED on a comprehension question,
    // and the generator REJECTS a prompt without it. The utterance lands as a
    // bubble the player must be able to tap, so it needs the same segment→gloss
    // map a beat's `wordTranslations` carries.
    //
    // The fixture was never updated when 1d7c40b made this mandatory, so this
    // spec had been failing on every run: the rejection burns the queued
    // fixture, the retry finds the queue empty, and the question node dies with
    // `question-author-failed` — visible only as a card that never appears.
    lineVocab: {
      'Est-ce que': 'do (question opener)',
      connais: 'know',
      'un bon café': 'a good café',
      'près du': 'near the',
      bureau: 'office',
    },
    speakerName: 'Sophie',
    npcId: 'sophie',
  },
  choices: [
    {
      id: 'cafe',
      practiceText: 'Elle demande un café près du bureau',
      nativeText: "She's asking about a café near the office",
      correctness: 'correct',
    },
    {
      id: 'office',
      practiceText: 'Elle demande où est le bureau',
      nativeText: "She's asking where the office is",
      correctness: 'wrong',
      // LIFE-EX-GEN-10: names what in the line rules this reading out.
      whyWrong: 'she asks about a café, not the office location',
    },
    {
      id: 'break',
      practiceText: 'Elle propose une pause',
      nativeText: "She's suggesting a break",
      correctness: 'wrong',
      whyWrong: 'she is asking a question, not proposing anything',
    },
  ],
};

/** Prefetched post-comprehension live node — its bubble + chips are
 *  the surface the LIFE-LANG-3 viewMode test flips, and its 'breakfast'
 *  option is the pick the LIFE-NODE-8 recovery test starts from. */
const AFTER_COMPREHENSION: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Super ! Il y a Le Petit Zinc juste à côté.',
        nativeText: "Great! There's Le Petit Zinc right next door.",
      },
    ],
  },
  options: [
    {
      id: 'breakfast',
      practiceText: 'Préparer le petit-déjeuner',
      nativeText: 'Make breakfast',
    },
    {
      id: 'leave-now',
      practiceText: 'Partir tout de suite',
      nativeText: 'Leave right away',
    },
  ],
};

const RECOVERY_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'The morning carries on.',
      },
    ],
  },
  options: [
    {
      id: 'a',
      practiceText: 'Continuer vers le marché',
      nativeText: 'Carry on to the market',
    },
    {
      id: 'b',
      practiceText: 'Rentrer',
      nativeText: 'Go home',
    },
  ],
};

const RESUME_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'You pick up the thread of your day.',
      },
    ],
  },
  options: [
    {
      id: 'x',
      practiceText: 'Aller au marché',
      nativeText: 'Go to the market',
    },
    {
      id: 'y',
      practiceText: 'Rester ici',
      nativeText: 'Stay here',
    },
  ],
};

// --- Phase G fixtures (LIFE-EX-SRS) ---------------------------------------

/** Live node after the resume pick — picking 'test-card' fires the live turn
 *  that lands the fill-blank question (LIFE-EX-9 listen-and-fill renders it). */
const SRS_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'Sophie is waiting for you outside the market.',
      },
    ],
  },
  options: [
    {
      id: 'test-card',
      practiceText: 'Dire que tu viens quand même',
      nativeText: "Say you're coming anyway",
    },
    {
      id: 'skip-market',
      practiceText: 'Faire demi-tour',
      nativeText: 'Turn back',
    },
  ],
};

/** LIFE-LANG-1: fill-blank chips stay practice-only (nativeText: ''). */
/** The question NODE the 'test-card' pick lands on (LIFE-NODE-2). Its plan
 *  must MATCH GRADED_SRS_CARD below: the generator's leak guard validates the
 *  authored question against the plan it was given, so a mismatched target
 *  gets rejected and the node graceful-demotes to plain options (LIFE-NODE-8)
 *  — which is exactly what a wrong fixture looks like from the outside. */
const QUESTION_SRS_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'question',
    gradedPlan: {
      kind: 'fill-blank',
      testTarget: 'quand même',
      sentenceContext: 'Je viens quand même au marché.',
    },
  },
  options: [],
};

const GRADED_SRS_CARD: GradedQuestionFixture = {
  practicePrompt: {
    kind: 'fill-blank',
    practiceText: 'Je viens ___ au marché.',
    nativeText: 'I am ___ coming to the market.',
    // LIFE-LANG-6: guard-required full native translation, blank filled.
    completedNativeText: 'I am coming to the market anyway.',
    // LIFE-EX-GEN-9: this fixture is itself an example of the defect the
    // contract exists to stop — 'quand même' / 'pourtant' / 'déjà' are all
    // real connectives that fit this slot, so without the meaning on screen
    // the question has no discoverable answer.
    disambiguation: 'translation-anchor',
  },
  choices: [
    { id: 'quand-meme', practiceText: 'quand même', nativeText: '', correctness: 'correct' },
    { id: 'pourtant', practiceText: 'pourtant', nativeText: '', correctness: 'wrong', whyWrong: 'means "however" — contrasts two clauses, and there is only one here' },
    { id: 'deja', practiceText: 'déjà', nativeText: '', correctness: 'wrong', whyWrong: 'means "already" — about timing, not concession' },
  ],
};

/** Prefetched post-feedback live node (consumed by the feedback
 *  prefetch — LIFE-CONTRACT-EX-3: reaction only, no re-quote). */
const SRS_AFTER: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Parfait, à tout à l’heure !',
        nativeText: 'Perfect, see you soon!',
      },
    ],
  },
  options: [
    {
      id: 'go-market',
      practiceText: 'Aller au marché',
      nativeText: 'Go to the market',
    },
    {
      id: 'wait-here',
      practiceText: 'Attendre ici',
      nativeText: 'Wait here',
    },
  ],
};

/** Phase H: a live resume turn that resolves the active scene with
 *  arcStage 'concluding'. Continuation node → exactly one option with
 *  id 'continue' (schema superRefine). The overlay blocks before the option is
 *  ever pickable, so no follow-up fixture is needed. */
const RESOLVING_TURN: RawNodeResponseInput = {
  node: {
    kind: 'continuation',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'The opening night winds down. Everyone applauds.',
      },
    ],
  },
  options: [
    {
      id: 'continue',
      practiceText: 'Continuer',
      nativeText: 'Continue',
    },
  ],
  scene: {
    // LIFE-SCENE-28: BOTH languages. The two strings are deliberately
    // different sentences here (not a plausible translation pair) so an
    // assertion cannot pass by finding the wrong one.
    resolved: {
      endingKey: 'gallery-success',
      outcomeLine: 'Tes photos ont trouvé le mur de la galerie.',
      outcomeLineNative: 'Your photos made the gallery wall.',
      arcStage: 'concluding',
    },
  },
};

/** LIFE-SCENE-29/30: the ORDINARY resolve — the scene ends, the chapter does
 *  NOT. This is the path that gets two CTAs; `RESOLVING_TURN` above is the
 *  chapter-ending path, which keeps one (`LIFE-DAY-4`). */
const SCENE_ONLY_RESOLVING_TURN: RawNodeResponseInput = {
  node: {
    kind: 'continuation',
    beats: [
      {
        speaker: 'narrator',
        practiceText: '',
        nativeText: 'RESOLUTION_BEAT_ON_SCREEN — the shutters come down for the night.',
      },
    ],
  },
  options: [
    { id: 'continue', practiceText: 'Continuer', nativeText: 'Continue' },
  ],
  scene: {
    resolved: {
      endingKey: 'market-closed',
      outcomeLine: 'Le marché a fermé sans toi.',
      outcomeLineNative: 'The market closed without you.',
      arcStage: 'continues',
    },
  },
};

/** LIFE-SPEECH-1: opening whose first option is a NON-graded `say` — it carries
 *  the player's spoken line in `saysLine`, so picking it must render the player's
 *  OWN bubble (the reported "player line vanished" bug). */
const SPEECH_OPENING: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [{ speaker: 'narrator', practiceText: '', nativeText: 'Sophie is waiting at the café.' }],
  },
  options: [
    {
      id: 'greet',
      practiceText: 'Greet Sophie warmly',
      nativeText: 'Greet Sophie warmly',
      speechAct: 'say',
      saysLine: {
        practiceText: 'Salut Sophie, ça fait longtemps !',
        nativeText: "Hi Sophie, it's been a while!",
      },
    },
    { id: 'sit', practiceText: 'Sit down quietly', nativeText: 'Sit down quietly' },
  ],
};

/** The live node the greeting pick lands on. The player's own line arrives
 *  from the option's `saysLine` (client-prepended), so this node carries only
 *  the reply — the LIFE-LANG-13c one-beat budget after a "say". */
const SPEECH_OPTIONS: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Ah, te voilà !',
        nativeText: 'Ah, there you are!',
      },
    ],
  },
  options: [
    { id: 'chat', practiceText: 'Chat about her week', nativeText: 'Chat about her week' },
    { id: 'leave', practiceText: 'Head out', nativeText: 'Head out' },
  ],
};

/** LIFE-SPEECH-3: the same opening, but the speech option declares a
 *  `gradeTarget`. The player has to PRODUCE "longtemps" to say the line —
 *  which is the only route to an outbound fill-blank that exists, because a
 *  `say` pick puts its line on screen the instant it is taken and leaves a
 *  later node nothing to intercept. */
const GRADED_SAY_OPENING: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [{ speaker: 'narrator', practiceText: '', nativeText: 'Sophie is waiting at the café.' }],
  },
  options: [
    {
      id: 'greet',
      practiceText: 'Greet Sophie warmly',
      nativeText: 'Greet Sophie warmly',
      speechAct: 'say',
      saysLine: {
        practiceText: 'Salut Sophie, ça fait longtemps !',
        nativeText: "Hi Sophie, it's been a while!",
      },
      gradeTarget: 'longtemps',
    },
    { id: 'sit', practiceText: 'Sit down quietly', nativeText: 'Sit down quietly' },
  ],
};

/** The chips the graded-say plan is authored into. `practiceText` is the
 *  option's own line with `gradeTarget` blanked — the client built the plan, so
 *  the generator only ever sees that one sentence. */
const GRADED_SAY_QUESTION: GradedQuestionFixture = {
  practicePrompt: {
    kind: 'fill-blank',
    practiceText: 'Salut Sophie, ça fait ___ !',
    nativeText: "Hi Sophie, it's been ___!",
    completedNativeText: "Hi Sophie, it's been a while!",
    disambiguation: 'translation-anchor',
  },
  choices: [
    { id: 'longtemps', practiceText: 'longtemps', nativeText: '', correctness: 'correct' },
    { id: 'bientot', practiceText: 'bientôt', nativeText: '', correctness: 'wrong', whyWrong: 'means "soon" — points forward, not back' },
    { id: 'toujours', practiceText: 'toujours', nativeText: '', correctness: 'wrong', whyWrong: 'means "always" — not a span of elapsed time' },
  ],
};

/** LIFE-SPEECH-6: the post-outcome turn the model gets WRONG. It has just been
 *  told a fill-blank resolved, and it stages the completed sentence itself —
 *  barred from `user` beats by the PLAYER-VOICE RULE, it hands the player's own
 *  words to Sophie. This is the reported bug in fixture form: the same line,
 *  twice, once from each of them. `normalizeBeats` must drop the echo. */
const SPEECH_ECHO_OUTCOME: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: '« Salut Sophie, ça fait longtemps ! »',
        nativeText: "Hi Sophie, it's been a while!",
      },
      {
        speaker: 'npc',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Ah, te voilà !',
        nativeText: 'Ah, there you are!',
      },
    ],
  },
  options: [
    { id: 'chat', practiceText: 'Chat about her week', nativeText: 'Chat about her week' },
    { id: 'leave', practiceText: 'Head out', nativeText: 'Head out' },
  ],
};

/** LIFE-SPEECH-5: a graded-say question the generator CANNOT author. Two chips
 *  marked `correct` fails `ZGeneratedQuestion`'s "exactly 1 correct" refine, so
 *  both of `runGradedQuestionGenerate`'s content attempts reject and it returns
 *  `kind: 'failed'` — deterministically, with no network faking. Two copies
 *  because the retry consumes one fixture each. */
const GRADED_SAY_UNAUTHORABLE: GradedQuestionFixture = {
  practicePrompt: GRADED_SAY_QUESTION.practicePrompt,
  choices: [
    { id: 'longtemps', practiceText: 'longtemps', nativeText: '', correctness: 'correct' },
    { id: 'bientot', practiceText: 'bientôt', nativeText: '', correctness: 'correct' },
    { id: 'toujours', practiceText: 'toujours', nativeText: '', correctness: 'wrong', whyWrong: 'x' },
  ],
};

/** Opening branch for the pace spec's own world (0 events → intro screen). */
const PACE_OPENING: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      { speaker: 'narrator', practiceText: '', nativeText: 'Sophie waves from the market gate.' },
    ],
  },
  options: [
    { id: 'ask', practiceText: 'Lui demander si elle vient', nativeText: 'Ask if she is coming' },
    { id: 'wave', practiceText: 'Faire un signe', nativeText: 'Wave back' },
  ],
  logLine: 'PACE-OPENING-LINE: Alice met Sophie at the market gate.',
};

/** LIFE-ARC-PACE-2 + LIFE-EX-PLAN-5: a question node that carries its OWN
 *  continuation, so answering it spends no second `life_step`. Two log lines
 *  come out of the one generated turn — the question's and the resolution's —
 *  which is exactly the shape that made `entries.length` unusable as a chapter
 *  pace counter. */
const PACE_QUESTION_WITH_RESOLUTION: RawNodeResponseInput = {
  node: {
    kind: 'question',
    gradedPlan: {
      kind: 'fill-blank',
      testTarget: 'quand même',
      sentenceContext: 'Je viens quand même au marché.',
    },
    resolution: {
      beats: [
        {
          speaker: 'npc',
          speakerName: 'Sophie',
          npcId: 'sophie',
          practiceText: 'Alors on y va !',
          nativeText: "Then let's go!",
        },
      ],
      options: [
        { id: 'walk', practiceText: 'Marcher avec elle', nativeText: 'Walk with her' },
        { id: 'linger', practiceText: 'Rester encore un peu', nativeText: 'Linger a moment' },
      ],
      logLine: 'PACE-RESOLUTION-LINE: Sophie and Alice set off together.',
    },
  },
  options: [],
  logLine: 'PACE-QUESTION-LINE: Alice hesitated before answering Sophie.',
};

test.describe.serial('life-sim node engine (mocked Gemini)', () => {
  // TRACKING — webkit-mobile harness gap (not a product bug): on webkit the
  // opening `life_step` request escapes the `page.route('**/geminiGenerate')`
  // mock, so real Gemini (via the emulated Functions) answers instead of the
  // fixture — the app renders a VALID opening (verified: the webkit DOM
  // snapshot shows beats, 3 chips, tappable vocab + the ✏️ chip all present),
  // but the fixture-specific testids (`Choice-sophie`, `Bubble-npc`) never
  // match. chromium runs the full 14-spec flow green and covers every
  // functional assertion here; webkit rendering is snapshot-verified. This
  // matches the repo's existing webkit-mobile E2E flake backlog. Follow-up:
  // make lifeMock's route intercept reliably on webkit (context.route /
  // request-path). The real-data thumbnail spec still runs on both browsers.
  test.skip(
    ({ browserName }) => browserName === 'webkit',
    'webkit-mobile: mocked node-step flow — see tracking note above',
  );
  test.beforeAll(async ({ browser }) => {
    userA = await provisionTestUser(USER_A);
    await wipeLifeData(userA.uid);
    worldId = await seedWorld(userA.uid);
    context = await browser.newContext({
      viewport: { width: 414, height: 896 },
    });
    // SETTINGS-BETA-4 — the Wurlds section went back behind `lifeSimBeta` on
    // 2026-09-22 and the gate is on the ROUTE too (NAV-BETA-1), so an
    // unseeded goto('/wurlds') now redirects to `/`. Seeded on the CONTEXT so
    // every page this suite opens inherits it.
    await enableWurlds(context);
    page = await context.newPage();
    // LIFE-FLOW-7 diagnostics. `addInitScript` must be installed before any
    // navigation, so it goes above `signInBrowser`, which navigates.
    consoleCapture = captureConsole(page);
    await watchMount(page, 'LifeScreen');
    // Sign in the shared serial page ONCE here so every serial test inherits
    // auth (browserLocalPersistence) + the welcome-gate dismissal. F's rewrite
    // had relocated this into the first test, which left later tests' fresh
    // gotos stranded on the signed-out welcome gate under the emulator harness.
    await signInBrowser(page, userA);
  });

  // Per-test, not per-file: this is a 27-test serial block sharing one page,
  // so without the reset the attachment would be every test's console.
  test.beforeEach(() => {
    consoleCapture?.reset();
  });

  // LIFE-FLOW-7: the two signals that would have named the cause on the first
  // run — the page console (where `[useDocSnapshot] schema drift` already
  // logs) and the LifeScreen mount/unmount log with the testids that were on
  // screen instead. Attached only on failure.
  test.afterEach(async ({}, testInfo) => {
    if (consoleCapture) await attachDiagnostics(testInfo, page, consoleCapture);
  });

  test.afterAll(async () => {
    await context?.close();
    await cleanupTestUsers(userA?.uid);
  });

  test('LIFE-ONBOARD — seed chip creates the world doc', async ({}, testInfo) => {
    await installLifeMock(page, { steps: [], scenes: [minimalBackdropSvg()] });
    await page.goto('/wurlds');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL((url) => url.pathname === '/wurlds', {
      timeout: 10_000,
    });
    await page.getByTestId('LifeOverview-Create').click();
    await page.waitForURL((url) => url.pathname === '/wurlds/start', {
      timeout: 10_000,
    });
    // LIFE-ONBOARD-15 made FANTASY the default mode, and `city_life` is a
    // REALISTIC seed — so it is not on screen at load and this waited out the
    // full 120s test timeout on a chip that was never going to appear. Switch
    // modes first, and assert the chip with a SHORT timeout so a future
    // filtering change fails in seconds with a readable message instead of
    // burning two minutes on "target page closed".
    await page.getByTestId('LifeStart-Mode-realistic').click();
    await expect(page.getByTestId('LifeStart-Seed-city_life')).toBeVisible({
      timeout: 5_000,
    });
    await page.getByTestId('LifeStart-Seed-city_life').click();
    await page.waitForURL((url) => /^\/wurlds\/w-/.test(url.pathname), {
      timeout: 15_000,
    });
    // POST-CONDITION: the world doc exists in Firestore with the
    // picked seed (not just "the route changed").
    await expect
      .poll(async () => {
        const db = getAdminFirestore();
        const snap = await db
          .collection(`users/${userA.uid}/lifeWorlds`)
          .where('worldSeedKey', '==', 'city_life')
          .get();
        return snap.size;
      }, { timeout: 15_000 })
      .toBeGreaterThanOrEqual(2); // the seeded world + the onboarded one
    // POST-CONDITION (LIFE-LANG-7): the onboarded world froze a
    // systemLanguage captured from the active app locale — not just the
    // seed key. The onboarded world is the one at the current URL.
    const onboardedId = new URL(page.url()).pathname.split('/').pop()!;
    await expect
      .poll(async () => {
        const db = getAdminFirestore();
        const doc = await db
          .doc(`users/${userA.uid}/lifeWorlds/${onboardedId}`)
          .get();
        const sl = doc.data()?.systemLanguage;
        return typeof sl === 'string' && sl.length > 0;
      }, { timeout: 15_000 })
      .toBe(true);
    // POST-CONDITION (LIFE-ARCH-8): the saga generator's teaser reached the
    // stored `saga` — the exact seam the defect lived in. `runSagaOpen`
    // returned a world and `LifeStartScreen` wrote three of its four display
    // fields, so every card since the LIFE-ARCH migration rendered "Your story
    // is being written…". Asserting the STRING, not merely that something is
    // there: a truthiness poll would pass on any stub.
    await expect
      .poll(async () => {
        const db = getAdminFirestore();
        const doc = await db
          .doc(`users/${userA.uid}/lifeWorlds/${onboardedId}`)
          .get();
        return (doc.data()?.saga as { playerFacingTeaser?: string } | undefined)
          ?.playerFacingTeaser;
      }, { timeout: 15_000 })
      .toBe(SAGA_OPEN_FIXTURE.playerFacingTeaser);
    await captureBeat(page, testInfo, 'onboard-created');
  });

  test('@standard LIFE-ONBOARD-3/4/5 — the mode toggle filters the examples AND reaches the world doc', async ({}, testInfo) => {
    await installLifeMock(page, { steps: [], scenes: [minimalBackdropSvg()] });
    await page.goto('/wurlds/start');
    await page.waitForURL((url) => url.pathname === '/wurlds/start', {
      timeout: 10_000,
    });

    // LIFE-ONBOARD-15 (supersedes -4): FANTASY leads the toggle and is the
    // default, so only its examples show at load. This spec still asserted
    // realistic-by-default and had been failing since that change; the
    // placeholder matchers are pinned to the DISTINGUISHING word of each
    // worked example rather than the shared "e.g." prefix, which matched both.
    await expect(page.getByTestId('LifeStart-Seed-magic_university')).toBeVisible();
    await expect(page.getByTestId('LifeStart-Seed-city_life')).toHaveCount(0);
    // LIFE-ONBOARD-5: the free-text seed is present WITHOUT opening a
    // disclosure, and its placeholder is the fantasy worked example.
    await expect(page.getByTestId('LifeStart-ManualText')).toBeVisible();
    await expect(page.getByTestId('LifeStart-ManualText')).toHaveAttribute(
      'placeholder',
      /astronaut/i,
    );
    // LIFE-ONBOARD-16: the alien-invasion seed ships alongside the rest of the
    // fantasy set — asserted here so the card cannot silently drop out.
    await expect(page.getByTestId('LifeStart-Seed-alien_invasion')).toBeVisible();

    // LIFE-ONBOARD-2: the language row opens the SHARED settings picker, so
    // the wurld is not confined to the profile's practice language. Seeded
    // FROM that profile though — the row reads French before it is touched.
    await expect(page.getByTestId('LifeStart-Language')).toContainText('French');
    await page.getByTestId('LifeStart-Language').click();
    const langSheet = page.getByRole('dialog');
    await langSheet.getByRole('searchbox').fill('German');
    await langSheet.getByRole('button', { name: /German/ }).first().click();
    await expect(page.getByTestId('LifeStart-Language')).toContainText('German');

    // The toggle FILTERS: switching to realistic swaps the whole example set
    // and the worked placeholder with it.
    await page.getByTestId('LifeStart-Mode-realistic').click();
    await expect(page.getByTestId('LifeStart-Seed-city_life')).toBeVisible();
    await expect(
      page.getByTestId('LifeStart-Seed-magic_university'),
    ).toHaveCount(0);
    await expect(page.getByTestId('LifeStart-ManualText')).toHaveAttribute(
      'placeholder',
      /researcher/i,
    );
    await captureBeat(page, testInfo, 'onboard-mode-realistic');

    // Back to fantasy — the free-text world below is submitted in that mode,
    // which is what the final `worldMode` post-condition reads.
    await page.getByTestId('LifeStart-Mode-fantasy').click();
    await expect(
      page.getByTestId('LifeStart-Seed-magic_university'),
    ).toBeVisible();
    await captureBeat(page, testInfo, 'onboard-mode-fantasy');

    const seedText = 'a lighthouse keeper who can hear the sea thinking';
    await page.getByTestId('LifeStart-ManualText').fill(seedText);
    await page.getByTestId('LifeStart-ManualSubmit').click();
    await page.waitForURL((url) => /^\/wurlds\/w-/.test(url.pathname), {
      timeout: 15_000,
    });

    // POST-CONDITION: the toggle is not decoration. The world doc
    // carries the chosen mode, and the player's own words survive
    // VERBATIM alongside it — the mode must never be mixed into the
    // seed text (LIFE-ONBOARD-5).
    const worldId = new URL(page.url()).pathname.split('/').pop()!;
    await expect
      .poll(
        async () => {
          const db = getAdminFirestore();
          const doc = await db
            .doc(`users/${userA.uid}/lifeWorlds/${worldId}`)
            .get();
          const d = doc.data();
          return d
            ? `${d.worldSeedKey}|${d.worldMode}|${d.practiceLanguage}|${d.worldSeedText}`
            : 'missing';
        },
        { timeout: 15_000 },
      )
      .toBe(`manual|fantasy|German|${seedText}`);
  });

  test('LIFE-NODE-1/4 — opening branch: beats + 3 options + client ✏️; no always-visible composer', async ({}, testInfo) => {
    // The response for the NEXT node is HELD for 4s so the pick test below
    // can observe the live-loading state before it lands.
    await installLifeMock(page, {
      steps: [OPENING, { response: OPTIONS_AT_TERRACE, delayMs: 4_000 }],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    // LIFE-LANG-16: reset the one-time flip coach-mark budget so its assertion
    // below is deterministic — localStorage persists across this serial file,
    // and the hint retires after 3 shows, which earlier tests in the file have
    // already spent.
    //
    // `addInitScript`, NOT `page.evaluate`. The evaluate version ran against
    // whatever page the PREVIOUS test left behind and swallowed its own
    // failures (`.catch(() => {})`), so if that page was mid-navigation the
    // reset silently did not happen, the budget was still exhausted, and this
    // test failed on a coach-mark that was never going to render. That is the
    // intermittent failure seen three times on 2026-08-02. An init script runs
    // before page scripts on EVERY navigation, so it cannot be raced and
    // cannot fail quietly.
    await page.addInitScript(() => {
      try {
        localStorage.removeItem('wurld:life-flip-hint-v1');
      } catch {
        /* private-mode / quota — the hint just re-arms; harmless. */
      }
    });
    await page.goto(`/wurlds/${worldId}`);
    await page.waitForLoadState('domcontentloaded');
    // Fresh seeded world (saga present, 0 events) → intro screen.
    // LIFE-LANG-14: the practice-language title shows its display-language
    // translation on the line below (scoped to the intro overlay — the
    // compact title also renders in the header).
    const intro = page.getByTestId('LifeScreen-WorldIntro');
    await expect(
      intro.getByRole('heading', { name: 'Une vie à Lyon' }),
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByTestId('LifeScreen-WorldIntro-TitleTranslation'),
    ).toHaveText('A Life in Lyon');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Bubble-narrator').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Bubble-npc')).toBeVisible();
    // LIFE-NODE-4: 3 model options + client ✏️ chip; NO always-visible composer.
    await expect(page.getByTestId('LifeScreen-Choice-sophie')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-coffee')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-window')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-__write__')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-FreeText')).toHaveCount(0);
    // LIFE-LANG-16: practice-only default (viewMode 'hidden') — Sophie's
    // English gloss is withheld, so the one-time swipe coach-mark points at
    // the newest withheld bubble to teach the flip. Portalled to <body>.
    await expect(page.getByTestId('LifeScreen-FlipHint')).toBeVisible({ timeout: 5_000 });
    await captureBeat(page, testInfo, 'opening-node');
  });

  test('@standard LIFE-LANG-16 / MSG-BUBBLE-12.8 — the flip animates the SPACE, not the bubble', async () => {
    // The wurld bubble used to open its gloss on a `grid-template-rows` glide,
    // which animated the card's OWN box — the thing the finger is on grew under
    // it. It now runs the chat schedule: the box steps at zero width, where it
    // cannot be seen, and a blank spacer beside it carries the movement.
    //
    // Deliberately NON-DESTRUCTIVE where it can be: the first half is measured
    // and released short of the midpoint, so this leaves the serial page's flip
    // state exactly as it found it. The one committed flip at the end is undone.
    const surface = page
      .getByTestId('LifeScreen-Bubble-npc')
      .locator('[data-flip-surface]')
      .first();
    await expect(surface).toBeVisible({ timeout: 15_000 });
    const spacer = page.locator('[data-testid="LifeBubbleFlipSpacer"]');
    const box = (await surface.boundingBox())!;
    const y = box.y + box.height / 2;
    const x0 = box.x + box.width - 12;

    const restH = box.height;
    const restY = box.y;

    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 - 12, y, { steps: 3 });

    // --- FIRST HALF: the space opens, the bubble holds ---
    const seen: Array<{ px: number; h: number; yy: number; sp: number }> = [];
    for (const px of [20, 40, 58]) {
      await page.mouse.move(x0 - px, y, { steps: 3 });
      // MSG-BUBBLE-12.12 — the card chases the finger at a capped rate.
      await page.waitForTimeout(200);
      const b = (await surface.boundingBox())!;
      seen.push({
        px,
        h: b.height,
        yy: b.y,
        sp: (await spacer.count())
          ? (await spacer.first().boundingBox())!.height
          : 0,
      });
    }

    // 12.8 — the bubble's OWN box never moves during the turn.
    for (const s2 of seen) {
      expect(s2.h, `the bubble's box grew to ${s2.h} at ${s2.px}px — it is ` +
        `animating itself instead of the space beside it. ${JSON.stringify(seen)}`)
        .toBeCloseTo(restH, 0);
    }
    // ...and the SPACE did open, progressively. A spacer that never appears is
    // the old height-glide behaviour; one that appears in a single step is a
    // jump wearing the right element.
    expect(seen[2]!.sp, `no spacer opened during the drag: ${JSON.stringify(seen)}`)
      .toBeGreaterThan(2);
    expect(seen[0]!.sp).toBeLessThan(seen[2]!.sp);

    // 12.9 — the dialogue column is pinned to the bottom of the screen, so the
    // room has to go ABOVE the bubble for the bubble itself to hold still.
    expect(await spacer.first().getAttribute('data-side')).toBe('before');
    expect(Math.abs(seen[2]!.yy - restY),
      `the bubble travelled ${seen[2]!.yy - restY}px under the finger`)
      .toBeLessThan(3);

    // Released short of the midpoint — 12.6, no trace.
    await page.mouse.up();
    await page.waitForTimeout(600);
    await expect(spacer).toHaveCount(0);
    expect((await surface.boundingBox())!.height).toBeCloseTo(restH, 0);

    // Record EVERY frame of the turn, measuring what the READER sees: the
    // distance between this beat and the one above it.
    //
    // An earlier version recorded the spacer's own height against the bubble's,
    // and those balance exactly even when the layout jumps — because the spacer
    // is a flex item in a column with a `gap`, so inserting it also inserts a
    // gap that belongs to the PARENT and appears in neither number. Measuring
    // the gap between beats is the only quantity that cannot hide that.
    await page.evaluate(() => {
      (window as unknown as { __measure: unknown[] }).__measure = [];
      const w = window as unknown as {
        __f: Array<{ h: number; above: number; top: number }>;
      };
      w.__f = [];
      const tick = () => {
        const twin = document.querySelector('[data-flip-twin]');
        const surf = twin?.closest('[data-flip-surface]');
        if (surf) {
          const all = Array.from(document.querySelectorAll('[data-flip-surface]'));
          const me = surf.getBoundingClientRect();
          // The nearest beat ABOVE, which is the side the room opens on here.
          const above = all
            .filter((e) => e !== surf)
            .map((e) => e.getBoundingClientRect())
            .filter((r) => r.bottom <= me.top + 1)
            .sort((a, b) => b.bottom - a.bottom)[0];
          if (above) w.__f.push({ h: me.height, above: above.bottom, top: me.top });
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });

    // --- THE SWAP ITSELF: one step, not a glide ---
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 - 12, y, { steps: 3 });
    await page.mouse.move(x0 - 130, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const justAfter = (await surface.boundingBox())!.height;
    await page.waitForTimeout(500);
    const wellAfter = (await surface.boundingBox())!.height;
    const frames = await page.evaluate(
      () => (window as unknown as {
        __f: Array<{ h: number; above: number; top: number }>;
      }).__f,
    );
    expect(frames.length, 'no frames were sampled — the turn never ran')
      .toBeGreaterThan(3);
    // The swap frame is where the bubble's own height steps. Across it the
    // distance to the beat above must not move: the spacer's room is handed to
    // the bubble in the same commit, so the exchange is net-zero for everything
    // around it. Any change is a jump the reader sees.
    // MSG-BUBBLE-12.10 — the twin's TARGET against the height the bubble
    // actually settles at. The frame assertions below check that the hand-over
    // is continuous; this checks that it hands over the RIGHT amount. A twin
    // that under-measures makes the spacer stop short, and the bubble jumps up
    // the remainder on the last frame — which reads as a jitter but is a
    // measurement fault, not a timing one.
    const measured = await page.evaluate(
      () => (window as unknown as { __measure: Array<{ toH: number }> }).__measure,
    );
    expect(measured.length, 'the twin never measured').toBeGreaterThan(0);
    expect(measured[0]!.toH,
      `the twin measured ${measured[0]!.toH} for a face that settles at ` +
      `${wellAfter} — the spacer opens to the wrong size. All: ${JSON.stringify(measured)}`)
      .toBeCloseTo(wellAfter, 0);
    const swapAt = frames.findIndex((f, i) => i > 0 && Math.abs(f.h - frames[i - 1]!.h) > 1);
    expect(swapAt, 'the bubble never changed height — no swap was sampled').toBeGreaterThan(0);
    // What must hold still is the CONTENT ABOVE. The flipped bubble's own top
    // edge legitimately moves by the growth — the column is bottom-anchored, so
    // a taller bubble extends upward into exactly the space the spacer was
    // holding — and that step lands at zero width where nothing is visible
    // (MSG-BUBBLE-12.9). The beat above is the thing that must not twitch.
    const jump = frames[swapAt]!.above - frames[swapAt - 1]!.above;
    expect(Math.abs(jump),
      `the beat above moved ${jump.toFixed(1)}px at the swap — the hand-over is ` +
      `not net-zero, so the reader sees a jump. Frames: ${JSON.stringify(frames)}`)
      .toBeLessThan(1.5);

    // Leave the serial page as we found it.
    await page.mouse.move(x0, y);
    await page.mouse.down();
    await page.mouse.move(x0 - 12, y, { steps: 3 });
    await page.mouse.move(x0 - 130, y, { steps: 6 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    expect((await surface.boundingBox())!.height).toBeCloseTo(restH, 0);
  });

  test('LIFE-BUBBLE-7 — tap vocab word → popover → save → flashcard doc exists with story context', async ({}, testInfo) => {
    // Phase E carry-over. No installLifeMock here: word taps + saves
    // fire ZERO lifeStep calls (addFlashCard's background
    // topic-classify falls through the route mock to the real
    // backend; nothing below depends on it).
    const npcBubble = page.getByTestId('LifeScreen-Bubble-npc');
    await npcBubble.getByRole('button', { name: 'déjeune' }).click();

    const popover = page.locator('[data-popover-card]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('déjeune');
    await expect(popover).toContainText('have lunch');
    await captureBeat(page, testInfo, 'vocab-popover');

    await popover.getByRole('button', { name: 'Save to flashcards' }).click();
    await expect(
      popover.getByRole('button', { name: 'Remove from flashcards' }),
    ).toBeVisible({ timeout: 10_000 });
    await captureBeat(page, testInfo, 'vocab-saved');

    // POST-CONDITION: the Firestore doc itself, with the story-context
    // stamp "<practiceText>" — <speaker>, <location>.
    const db = getAdminFirestore();
    await expect
      .poll(
        async () => {
          const snap = await db
            .collection(`users/${userA.uid}/flashcards`)
            .where('phrase', '==', 'déjeune')
            .get();
          return snap.empty ? null : snap.docs[0]!.data();
        },
        { timeout: 15_000 },
      )
      .toMatchObject({
        phrase: 'déjeune',
        translation: 'have lunch',
        practiceLanguage: 'French',
        context:
          '"Salut ! On déjeune ensemble à midi ?" — Sophie, Your apartment · morning',
      });

    // Close the popover so later tests interact with a clean surface.
    await npcBubble.getByRole('button', { name: 'déjeune' }).click();
    await expect(popover).not.toBeVisible();
  });

  test('LIFE-NODE-2/3 — a pick goes live, then lands node + options; commit lands events', async ({}, testInfo) => {
    await page.getByTestId('LifeScreen-Choice-sophie').click();
    // LIFE-NODE-2: no lookahead — the pick fires a live call and the player
    // waits on the thinking bar. (Pre-E1 this beat came from option.next and
    // rendered instantly, with skeleton chips while the options call ran.)
    await captureBeat(page, testInfo, 'pick-live-loading');
    // The node lands: beats + its options together, no second call.
    // LIFE-LANG-8: narrator beats render their SYSTEM-language narration
    // (nativeText); practiceText is empty.
    await expect(page.getByText('Sophie waves at you from the terrace.')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('LifeScreen-Choice-sit')).toBeVisible({ timeout: 10_000 });
    // LIFE-OPT-VOICE: every CYOA turn carries a person-frame eyebrow.
    await expect(page.getByTestId('LifeScreen-OptionsEyebrow')).toBeVisible();
    await captureBeat(page, testInfo, 'pick-landed');
    // POST-CONDITION (LIFE-NODE-3): pick decision + node beat are
    // REAL events in Firestore.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        const decision = events.some(
          (e) => e.kind === 'decision' && e.payload.choiceId === 'sophie',
        );
        const beat = events.some(
          (e) =>
            e.kind === 'beat' &&
            // LIFE-LANG-8: narration commits to nativeText (system lang).
            e.payload.nativeText === 'Sophie waves at you from the terrace.',
        );
        return decision && beat;
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('LIFE-NODE-4 — ✏️ chip opens the composer; submit lands a __write__ decision', async ({}, testInfo) => {
    await installLifeMock(page, {
      steps: [WRITE_RESPONSE],
      scenes: [minimalBackdropSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-__write__').click();
    await expect(page.getByTestId('LifeScreen-FreeText')).toBeVisible();
    // COMP-KB-14: the composer input autofocuses so the soft keyboard rises the
    // instant ✏️ opens it — the input then rides above the keyboard via
    // `.pb-keyboard` (focus is the same lever the app uses to drive the
    // keyboard; the geometry itself is device-confirmed, not headless-testable).
    await expect(page.getByTestId('LifeScreen-FreeText').locator('input')).toBeFocused();
    // Chips are hidden while the composer is open.
    await expect(page.getByTestId('LifeScreen-Choice-sit')).toHaveCount(0);
    await captureBeat(page, testInfo, 'composer-open');
    await page.getByTestId('LifeScreen-FreeText').locator('input').fill('On va au parc ?');
    await page.getByTestId('LifeScreen-FreeText-Send').click();
    await expect(page.getByText('You suggest a walk in the park.')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'write-your-own-landed');
    // POST-CONDITION: the free text committed as a __write__ decision.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) =>
            e.kind === 'decision' &&
            e.payload.choiceId === '__write__' &&
            e.payload.text === 'On va au parc ?',
        );
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('LIFE-NODE-1 + LIFE-LANG-1 — fill-blank question authors at show; gloss-free chips; feedback prefetch continues', async ({}, testInfo) => {
    await installLifeMock(page, {
      steps: [QUESTION_FILL_BLANK_LIVE, POST_FEEDBACK_LIVE],
      gradedQuestions: [GRADED_FILL_BLANK],
      scenes: [minimalBackdropSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-ask-week').click();
    // The question node carries NO chips of its own — the live call lands it,
    // then the authoring shimmer runs while the generator writes them.
    await expect(page.getByTestId('LifeScreen-QuestionAuthoring')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Je ___ déjeuner avec toi.')).toBeVisible();
    // LIFE-LANG-17 / LIFE-EX-GEN-9: this fixture declared 'translation-anchor'
    // because [voudrais/veux/ai] are interchangeable without the meaning, so
    // the completed sentence's translation is SHOWN pre-answer. It is what
    // makes the question answerable at all.
    await expect(page.getByTestId('LifeScreen-PracticePrompt-Anchor')).toContainText(
      'I would like to have lunch with you.',
    );
    // LIFE-LANG-1 (Phase D carry-over) — fill-blank chips are bare
    // practice tokens with no native gloss anywhere on the face.
    await expect(page.getByTestId('LifeScreen-Choice-voudrais')).toHaveText('voudrais');
    await captureBeat(page, testInfo, 'question-ready');
    await page.getByTestId('LifeScreen-Choice-voudrais').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 5_000 });
    await captureBeat(page, testInfo, 'question-feedback');
    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();
    // Resolved user bubble = template with the CORRECT chip
    // substituted (LIFE-CONTRACT-EX-3), then the prefetched live node.
    await expect(page.getByText('Je voudrais déjeuner avec toi.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('À midi alors.')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'question-resolved');
    // POST-CONDITION: the correction event landed.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) =>
            e.kind === 'correction' &&
            // LIFE-EX-19: the STORED kind is 'generation'. 'fill-blank' is the
            // wire value the model emits (see the gradedPlan fixtures above),
            // normalised at the parse seam before anything is written.
            e.payload.kind === 'generation' &&
            e.payload.correct === true &&
            e.payload.correctAnswer === 'voudrais',
        );
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('LIFE-LANG-1/5 — comprehension chips render native-only; Why? opens the ExplainModal with streamed content', async ({}, testInfo) => {
    // Phase D carry-over, node-shaped: the pick lands a question NODE, and
    // the chips come from the graded generator queue.
    await installLifeMock(page, {
      steps: [QUESTION_COMPREHENSION_LIVE, AFTER_COMPREHENSION],
      gradedQuestions: [GRADED_COMPREHENSION],
      scenes: [minimalBackdropSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-ask-cafe').click();
    await expect(page.getByTestId('LifeScreen-QuestionAuthoring')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toContainText(
      'Est-ce que tu connais un bon café près du bureau ?',
    );
    // LIFE-OPT-VOICE: the comprehension card names the speaker explicitly.
    await expect(page.getByTestId('LifeScreen-PracticePrompt-Speaker')).toContainText(
      'Sophie said:',
    );
    // LIFE-LANG-1 — comprehension chips render ONLY the native
    // interpretation; the practice-language paraphrase never shows.
    const cafeChip = page.getByTestId('LifeScreen-Choice-cafe');
    await expect(cafeChip).toContainText("She's asking about a café near the office");
    await expect(cafeChip).not.toContainText('Elle demande un café');
    await captureBeat(page, testInfo, 'comprehension-ready');

    await page.getByTestId('LifeScreen-Choice-cafe').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 5_000 });

    // LIFE-LANG-12: the "full sentence" row shows the FAITHFUL translation of
    // the utterance — NOT the third-person interpretation the player picked.
    const fullSentence = page.getByTestId('LifeScreen-PracticeFeedback-FullSentence');
    await expect(fullSentence).toContainText('Do you know a good café near the office?');
    await expect(fullSentence).not.toContainText("She's asking about a café near the office");

    // LIFE-LANG-5 — Why? opens the ExplainModal in practice mode with
    // the streamed explanation rendered (post-condition: streamed
    // content is in the DOM, not just "a modal exists").
    await page.route('**/geminiStreamV2', async (route) => {
      await route.fulfill({
        status: 200,
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        body: sseBody(LIFE_EXPLAIN_XML),
      });
    });
    await page.getByTestId('LifeScreen-PracticeFeedback-Why').click();
    const explainModal = page.getByTestId('explain-modal');
    await expect(explainModal).toBeVisible({ timeout: 10_000 });
    await expect(explainModal).toHaveAttribute('data-mode', 'practice');
    await expect(explainModal).toContainText('près du bureau', { timeout: 10_000 });
    await captureBeat(page, testInfo, 'comprehension-why-explain');
    await explainModal.getByRole('button', { name: 'Close' }).first().click();
    await expect(explainModal).not.toBeVisible();
    await page.unroute('**/geminiStreamV2');

    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();
    // Resolved NPC bubble = the verbatim utterance (LIFE-CONTRACT-EX-1),
    // then the prefetched live node's reply.
    await expect(page.getByText('Est-ce que tu connais un bon café près du bureau ?')).toBeVisible({ timeout: 15_000 });
    // 'Le Petit Zinc' is a proper noun that appears untranslated in BOTH the
    // practice bubble and its native gloss (viewMode 'visible') — scope to the
    // first match so strict mode doesn't trip on the 2 language rows.
    await expect(page.getByText('Le Petit Zinc', { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'comprehension-resolved');
    // POST-CONDITION: the comprehension correction event landed.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) => e.kind === 'correction' && e.payload.kind === 'comprehension',
        );
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('LIFE-LANG-3/15 — the view settings flip BUBBLE languages; options stay native-only; persists to the world doc', async ({}, testInfo) => {
    // Phase D carry-over. State from the previous test: Sophie's reply bubble
    // + the AFTER_COMPREHENSION chips are on screen. No Gemini calls fire.
    //
    // MSG-VIEW-7.7: the 3-way cycle button is retired. The eye owns the second
    // row; the main-row choice lives in the ⋯ menu's shared radio group — the
    // SAME control chat renders.
    const eye = page.getByTestId('LifeScreen-EyeButton');
    const openMenu = async () => {
      await page.getByTestId('LifeScreen-MenuButton').click();
      await expect(page.getByTestId('ViewSettings-primary-group')).toBeVisible({
        timeout: 10_000,
      });
    };
    const closeMenu = async () => {
      // The close affordance is a full-viewport backdrop, and the menu PANEL
      // sits on top of it — so a default click, which targets the element's
      // centre, lands on the panel and retries until the test times out. Aim
      // at the left gutter, which the panel (`right-3`, max 20rem wide) never
      // reaches. A real finger has the same strip plus everything above the
      // panel, so this is a test-geometry fix, not a product one.
      await page
        .getByTestId('LifeScreen-MenuOverlay')
        .locator('button')
        .first()
        .click({ position: { x: 6, y: 400 } });
      await expect(page.getByTestId('ViewSettings-primary-group')).toBeHidden({
        timeout: 10_000,
      });
    };
    const pickPrimary = async (v: 'practice' | 'native') => {
      await openMenu();
      // LIFE-LANG-3 (amended) / LIFE-LANG-18 (retired): the swap-words Mixed
      // main row was cut — the shared radio group offers practice / native only.
      await expect(page.getByTestId('ViewSettings-primary-mixed')).toHaveCount(0);
      await page.getByTestId(`ViewSettings-primary-${v}`).click();
      await expect(page.getByTestId(`ViewSettings-primary-${v}`)).toHaveAttribute(
        'aria-checked',
        'true',
        { timeout: 10_000 },
      );
      await closeMenu();
    };

    const french = page.getByText('Super ! Il y a Le Petit Zinc juste à côté.');
    const english = page.getByText("Great! There's Le Petit Zinc right next door.");

    // LIFE-LANG-3: the DEFAULT is practice-only — the native gloss withheld
    // behind the chat-style flip (LIFE-LANG-16). The French line shows; its
    // English gloss does not.
    await expect(eye).toHaveAttribute('aria-pressed', 'false');
    await expect(french).toBeVisible();
    await expect(english).not.toBeVisible();

    // Eye ON: both languages show. ONE tap, where the cycle needed a walk.
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(french).toBeVisible();
    await expect(english).toBeVisible();
    // LIFE-LANG-15: options are native-only — the chip shows its native label
    // (unchanged by the view settings; it never carries the practice form).
    const chip = page.getByTestId('LifeScreen-Choice-breakfast');
    await expect(chip).toContainText('Make breakfast');
    await expect(chip).not.toContainText('Préparer le petit-déjeuner');

    // Native main row + eye off = the old `native-only`: practice hides.
    await pickPrimary('native');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await expect(english).toBeVisible();
    await expect(french).not.toBeVisible();
    await expect(chip).toContainText('Make breakfast');
    await expect(chip).not.toContainText('Préparer le petit-déjeuner');
    await captureBeat(page, testInfo, 'viewmode-native-only');

    // POST-CONDITION: it persisted to the world doc (it syncs across devices)
    // — not just a local render flip. The `viewSettings` block is the ONLY
    // stored representation (LIFE-LANG-3; the legacy `viewMode` echo was
    // retired with MSG-VIEW-7.2 on 2026-09-29), so assert the block AND that
    // no legacy `viewMode` field is written back onto the doc.
    const db = getAdminFirestore();
    await expect
      .poll(
        async () => {
          const d = (
            await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()
          ).data();
          const legacy = d && 'viewMode' in d ? 'legacy-viewMode' : 'no-legacy';
          return `${d?.viewSettings?.primary}/${d?.viewSettings?.secondRow}/${legacy}`;
        },
        { timeout: 10_000 },
      )
      .toBe('native/false/no-legacy');

    // MSG-VIEW-7.1 — the state the old model could NOT express: native on top
    // WITH the practice line beneath it. There was no `viewMode` for this.
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true', { timeout: 10_000 });
    await expect(english).toBeVisible();
    await expect(french).toBeVisible();
    await captureBeat(page, testInfo, 'viewmode-native-plus-practice');

    // Back to the practice-only default, which the tests below assume.
    await pickPrimary('practice');
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'false', { timeout: 10_000 });
    await expect(french).toBeVisible();
    await expect(english).not.toBeVisible();
    // LIFE-LANG-15: options DON'T flip — the chip stays native (bubbles go
    // practice-only, but options remain the player's native meta-choices).
    await expect(chip).toContainText('Make breakfast');
    await expect(chip).not.toContainText('Préparer le petit-déjeuner');
    await captureBeat(page, testInfo, 'viewmode-hidden');
  });

  test('LIFE-NODE-8 — a failed live turn is ATOMIC and the Continue ladder recovers', async ({}, testInfo) => {
    // Empty step queue → the live call 500s → options-failed.
    await installLifeMock(page, { steps: [], scenes: [minimalBackdropSvg()] });
    await page.getByTestId('LifeScreen-Choice-breakfast').click();
    await expect(page.getByTestId('LifeScreen-OptionsFailed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-__continue__')).toBeVisible();
    await captureBeat(page, testInfo, 'options-failed');
    // POST-CONDITION (changed by LIFE-NODE-2): the turn commits NOTHING.
    // Pre-E1 the pick rendered its cached preview beats and committed the
    // decision immediately, so a failed options call left a half-turn on the
    // record. With no lookahead there is nothing to render until the live call
    // lands, so a failed turn leaves the world exactly as it was — the story
    // did not advance, and the log agrees.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) => e.kind === 'decision' && e.payload.choiceId === 'breakfast',
        );
      }, { timeout: 5_000 })
      .toBe(false);
    // Recovery: fresh fixture → Continue fires a live turn.
    await installLifeMock(page, {
      steps: [RECOVERY_LIVE],
      scenes: [minimalBackdropSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-__continue__').click();
    await expect(page.getByText('The morning carries on.')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'options-failed-recovered');
  });

  test('LIFE-CANON-1 + LIFE-STORY-LOG-1 — a turn extends both append-only ledgers', async ({}, testInfo) => {
    const db = getAdminFirestore();
    await installLifeMock(page, { steps: [LEDGER_OPTIONS], scenes: [minimalBackdropSvg()] });
    // Pick an option: the live call that follows carries both the node and
    // this turn's ledger contributions.
    await page.getByTestId('LifeScreen-Choice-a').click();
    await expect(page.getByTestId('LifeScreen-Choice-watch')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'ledger-turn');

    // POST-CONDITION 1 (LIFE-CANON-1): the declared entity is in the canon
    // WITH its affordance — the record that later makes "offer to talk to it"
    // a rejected option rather than a shipped one.
    await expect
      .poll(async () => {
        const d = (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data();
        const chars = (d?.canon?.characters ?? []) as Array<Record<string, unknown>>;
        return chars.find((c) => c.name === 'Mireille') ?? null;
      }, { timeout: 15_000 })
      .toMatchObject({ kind: 'spirit', canSpeak: false });

    // POST-CONDITION 2 (LIFE-STORY-LOG-1): the log line landed — the memory
    // that outlives both the 40-event window and the lossy rolling summary.
    await expect
      .poll(async () => {
        const d = (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data();
        return (d?.storyLog?.entries ?? []) as string[];
      }, { timeout: 15_000 })
      .toContain('A hush-spirit named Mireille appeared in the kitchen.');
  });

  test('LIFE-SETTINGS-7 — the ⋯ menu pins per-wurld difficulty (Firestore) and reverts to global', async ({}, testInfo) => {
    const db = getAdminFirestore();
    await page.getByTestId('LifeScreen-MenuButton').click();
    // Default: this wurld follows the global setting.
    await expect(page.getByTestId('LifeScreen-Menu-Difficulty-State')).toContainText(/global/i, {
      timeout: 5_000,
    });
    await captureBeat(page, testInfo, 'difficulty-menu-automatic');
    // Pin level 1 (absolute beginner) for THIS wurld.
    await page.getByTestId('LifeScreen-Menu-Difficulty').click();
    await page.getByTestId('LifeScreen-Menu-Difficulty-Level-1').click();
    // POST-CONDITION: the pin persists on the world doc.
    await expect
      .poll(
        async () => {
          const d = (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data();
          return d?.difficultyPinned ?? null;
        },
        { timeout: 10_000 },
      )
      .toBe(1);
    await captureBeat(page, testInfo, 'difficulty-menu-pinned');
    // Revert to global → the pin clears.
    await page.getByTestId('LifeScreen-Menu-Difficulty-UseGlobal').click();
    await expect
      .poll(
        async () => {
          const d = (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data();
          return d?.difficultyPinned ?? null;
        },
        { timeout: 10_000 },
      )
      .toBeNull();
    // The next test reloads the page, clearing the still-open menu.
  });

  test('LIFE-FLOW-5 — resumed world shows the recap screen from stored data; Continue auto-continues into the live turn', async ({}, testInfo) => {
    // Phase C carry-over. Seed a stored recap via the admin SDK so
    // every assertion is deterministic — this path makes zero LLM
    // calls before the resume pick. The nonexistent lastEventId also
    // arms the exit-generation test that follows (an out-of-window
    // anchor id counts as stale ⇒ ≥5 new events).
    const db = getAdminFirestore();
    await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).update({
      resumeRecap: {
        // LIFE-LANG-8: recap is a single system-language paragraph.
        text: 'Sophie invited you to lunch.',
        lastEventId: 'seeded-nonexistent-event',
      },
    });

    // ONE step fixture, deliberately (LIFE-FLOW-6). Entering a resumed world
    // must cost exactly ONE `life_step` — the `continue` turn. A second
    // fixture here would have hidden the defect this test now guards.
    const resumeMock = await installLifeMock(page, {
      steps: [RESUME_LIVE],
      scenes: [minimalBackdropSvg()],
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // The recap overlay renders BEFORE any dialogue seeding.
    await expect(page.getByTestId('LifeScreen-WurldResume')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Previously, in this wurld')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-WurldResume-Recap')).toContainText(
      'Sophie invited you to lunch.',
    );
    // "Moments ago" mini-bubbles rehydrate from stored beat events —
    // the newest beat is RECOVERY_LIVE's narrator line.
    await expect(page.getByTestId('LifeScreen-WurldResume-Moments')).toContainText(
      'The morning carries on.',
    );
    // The LIFE-FLOW-2 seeding is GATED until Continue.
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toHaveCount(0);
    await captureBeat(page, testInfo, 'resume-recap');

    await page.getByTestId('LifeScreen-WurldResume-Continue').click();
    await expect(page.getByTestId('LifeScreen-WurldResume')).toHaveCount(0);
    // v2.1: NO '__resume__' placeholder chip — the recap Continue auto-continues
    // straight into the live turn (buildResumeSeed still seeds the context
    // bubbles; the engine fires a continue turn without a manual tap).
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toHaveCount(0);
    await expect(page.getByText('You pick up the thread of your day.')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'resume-prompt');

    // POST-CONDITION (LIFE-FLOW-6): the resume cost exactly ONE `life_step`.
    //
    // THE BUG THIS EXISTS FOR. Measured 2026-08-03 on the emulator by logging
    // every `life_step`'s `<turn kind>`: entering this world fired TWO —
    // `kind="opening"` and then `kind="continue"`. `useCollectionSnapshot`
    // reports `loading:false` on an empty CACHE-ONLY snapshot, so on a cold
    // load a world with history briefly looked brand new, and the
    // LIFE-BACKDROP-21 opening prefetch acted on it. The resume path never
    // consumes that prefetch, so it was a full billed generation thrown away
    // on every resume that loaded this way — and it made the visible failure
    // "the story snagged for a moment", because the wasted call had eaten the
    // turn the player was waiting for.
    //
    // Counted, NOT inferred from the rendered text: the render above passes
    // just as well when two calls were made and the second one happened to
    // land. LIFE-EX-PLAN-5 counts for the same reason — the saving IS the call
    // that does not happen.
    expect(resumeMock.stepCalls()).toBe(1);
  });

  test('LIFE-FLOW-5 — world exit fires the recap generator and persists resumeRecap', async () => {
    // Phase C carry-over. ≥5 events landed since the seeded
    // nonexistent lastEventId, so exiting the world must fire exactly
    // one life_resume_recap call.
    await installLifeMock(page, {
      steps: [],
      scenes: [],
      resumeRecaps: [
        // LIFE-LANG-8: recap is a single system-language paragraph.
        { text: 'Previously: a lunch and a café are planned.' },
      ],
    });

    // In-app exit → LifeScreen unmount → fire-and-forget generation.
    await page.getByTestId('LifeScreen-MenuButton').click();
    await page.getByTestId('LifeScreen-Menu-Exit').click();
    await page.waitForURL((url) => url.pathname === '/wurlds', { timeout: 10_000 });

    // POST-CONDITION: the polished recap landed on the world doc with
    // lastEventId re-anchored to a REAL event id.
    const db = getAdminFirestore();
    await expect
      .poll(
        async () => {
          const data = (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data();
          const recap = data?.resumeRecap as
            | { text?: string; lastEventId?: string }
            | undefined;
          return (
            !!recap &&
            typeof recap.text === 'string' &&
            recap.text.includes('Previously: a lunch and a café are planned.') &&
            recap.lastEventId !== 'seeded-nonexistent-event'
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('@standard LIFE-UI-8 — rebrand copy renders on the overview', async ({}, testInfo) => {
    // POST-PHASE-A carry-forward (phase-a.md T3), ported UNCHANGED — a
    // rebrand copy-assertion on the overview surface, independent of the
    // CYOA→node engine swap (no installLifeMock / node fixtures needed).
    // The `lifeSimBeta` seed this test used to do inline is on the CONTEXT
    // now (beforeAll) — every Wurlds path needs it since SETTINGS-BETA-4, not
    // just this one. Its rationale moved to helpers/betaFlags.ts intact.
    // NAV-ANIM-8: entering by the OLD path asserts the legacy redirect still
    // resolves — `/wurlds` is the overview now, `/wurlds/overview` forwards.
    await page.goto('/wurlds/overview');
    await page.waitForURL((url) => url.pathname === '/wurlds', {
      timeout: 10_000,
    });

    // POST-CONDITION (LIFE-UI-8 / LIFE-WORLD-10): the rebranded copy is in the
    // DOM, as a tab-root header — brand in the <h1>, the old line as its
    // subtitle, and no back arrow (this is where the tab lands).
    await expect(
      page.getByRole('heading', { level: 1, name: 'Wurlds', exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Your other Wurlds')).toBeVisible();
    await expect(page.getByRole('button', { name: /back/i })).toHaveCount(0);
    // (Standalone: there is no app tab bar any more, so the Wurlds tab link
    // the Wurld app asserted here is gone; the overview IS the app.)
    // Populated overview (a world exists from the onboarding test):
    // the create CTA + explainer carry the rebranded copy too.
    await expect(page.getByTestId('LifeOverview-Create')).toContainText(
      'Start a new wurld',
    );
    await expect(page.getByText('How wurlds work')).toBeVisible();
    // The old brand never renders on this surface.
    await expect(page.getByText('Your other lives')).toHaveCount(0);
    await captureBeat(page, testInfo, 'rebrand-overview');
  });

  test('LIFE-EX-9 — listen-and-fill graded flow: resolved bubble + correction event (post flashcard-threading removal)', async ({}, testInfo) => {
    await installLifeMock(page, {
      // LIFE-NODE-2: picking 'test-card' fires a live turn, and the question
      // arrives as THAT call's node — hence the fixture between the two.
      steps: [SRS_LIVE, QUESTION_SRS_LIVE, SRS_AFTER],
      gradedQuestions: [GRADED_SRS_CARD],
      scenes: [minimalBackdropSvg()],
    });
    // LIFE-EX-9: this fill-blank lands on a listen-and-fill slot, whose autoPlay
    // would call the real synthesizeSpeech — stub it so the exercise renders
    // without a live TTS round-trip.
    await page.route('**/synthesizeSpeech**', (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'stubbed' }),
    );
    await page.goto(`/wurlds/${worldId}`);
    await page.waitForLoadState('domcontentloaded');
    // Re-entry shows the recap stored by the previous test.
    await page.getByTestId('LifeScreen-WurldResume-Continue').click({ timeout: 15_000 });
    // v2.1: recap Continue auto-continues → the live node's options appear
    // (no manual '__resume__' chip).
    await page.getByTestId('LifeScreen-Choice-test-card').click({ timeout: 15_000 });
    // LIFE-EX-9: the fill-blank VARIANT (listen-and-fill vs the plain card) is
    // chosen from a seed derived from the event log, which the LIFE-NODE-8
    // atomicity change above shifts (a failed turn no longer commits a
    // decision). The subject of this test is the graded flow's post-conditions
    // — resolved bubble + correction event — not which variant drew, so accept
    // either rather than pinning a seed the suite's own history perturbs.
    await expect(
      page
        .getByTestId('LifeScreen-ListenFill')
        .or(page.getByTestId('LifeScreen-PracticePrompt-FillBlank')),
    ).toBeVisible({ timeout: 10_000 });
    await captureBeat(page, testInfo, 'listen-fill');
    await page.getByTestId('LifeScreen-Choice-quand-meme').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 5_000 });
    await captureBeat(page, testInfo, 'graded-feedback');
    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();
    // Resolved bubble (template + correct chip), then the prefetched node.
    await expect(page.getByText('Je viens quand même au marché.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Parfait, à tout à l’heure !')).toBeVisible({ timeout: 15_000 });

    // POST-CONDITION: the correction event landed (feeds the wurld-mistakes
    // backlog). The story no longer credits SM-2 — that lives in the dedicated
    // practice session (flashcard threading removed, 2026-07).
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) =>
            e.kind === 'correction' &&
            e.payload.correct === true &&
            e.payload.correctAnswer === 'quand même',
        );
      }, { timeout: 10_000 })
      .toBe(true);
    await captureBeat(page, testInfo, 'graded-resolved');
  });

  test('@standard LIFE-EX-10 — the scene\'s LAST exercise is a 2-column card-match review; matching all hands back the summary', async ({}, testInfo) => {
    // Seed (admin) five vocab beats, timestamped into the near FUTURE so they
    // are unambiguously the NEWEST events — earlier tests' just-written events
    // would otherwise dominate the recent-vocab window. The beats are what the
    // review HARVESTS (capped at 5).
    //
    // The six corrections beside them are NOT a trigger any more, and the note
    // that used to sit here said they "clear REVIEW_EVERY". That counter was
    // deleted with the v2 mid-scene review (LIFE-EX-13) and nothing has counted
    // them since; they are kept only as realistic scene traffic. What actually
    // arms the review is the scene RESOLVING, which is why this world now needs
    // a scene old enough for the resolve to be accepted.
    // ITS OWN WORLD. Resolving a scene ARCHIVES it and writes the day into the
    // chapter's `completedSceneMemories`, so running this against the shared
    // serial world advanced state the following spec reads back — measured, as
    // LIFE-VOCAB-RECAP-2 failing on the chapter card's day list. The old
    // version of this test never resolved anything, so the coupling did not
    // exist until the trigger was corrected. A destructive test gets its own
    // world, the same way LIFE-SCENE-29/30 does.
    const db = getAdminFirestore();
    const reviewWorldId = await seedWorld(userA.uid);
    const eventsCol = db.collection(`users/${userA.uid}/lifeWorlds/${reviewWorldId}/events`);
    const inSecs = (s: number) =>
      admin.firestore.Timestamp.fromMillis(Date.now() + s * 1000);
    const vocab: Array<[string, string]> = [
      ['pain', 'bread'],
      ['lait', 'milk'],
      ['chien', 'dog'],
      ['livre', 'book'],
      ['sac', 'bag'],
    ];
    // Track the seeded docs so we can DELETE them after — they'd otherwise
    // pollute the following vocab-recap test's "words practised" window.
    const seeded: Array<Awaited<ReturnType<typeof eventsCol.add>>> = [];
    for (let i = 0; i < 6; i++) {
      seeded.push(
        await eventsCol.add({
          kind: 'correction',
          // LIFE-EX-19: 'generation' is the STORED kind (see the note in the
          // vocab-recap seeding below).
          payload: { kind: 'generation', correct: true, correctAnswer: `w${i}`, promptSource: 'x' },
          createdAt: inSecs(10 + i), // future, but older than the beats below
        }),
      );
    }
    for (let i = 0; i < vocab.length; i++) {
      const [practice, native] = vocab[i]!;
      seeded.push(
        await eventsCol.add({
          kind: 'beat',
          payload: {
            speaker: 'npc',
            practiceText: practice,
            complexWords: [practice],
            wordTranslations: { [practice]: native },
          },
          createdAt: inSecs(30 + i), // newest events → harvested first
        }),
      );
    }

    // Picking 'chat' fires a live turn that lands a QUESTION node — which the
    // engine converts into the review (deck-free, no gradedQuestion gen).
    const REVIEW_RESUME: RawNodeResponseInput = {
      node: { kind: 'branch', beats: [{ speaker: 'narrator', practiceText: '', nativeText: 'A quiet moment on the terrace.' }] },
      options: [
        { id: 'chat', practiceText: 'Bavarder', nativeText: 'Chat' },
        { id: 'leave', practiceText: 'Partir', nativeText: 'Leave' },
      ],
    };
    const REVIEW_AFTER: RawNodeResponseInput = {
      node: { kind: 'branch', beats: [{ speaker: 'narrator', practiceText: '', nativeText: 'You carry on with your day.' }] },
      options: [
        { id: 'go-a', practiceText: 'Aller au parc', nativeText: 'Go to the park' },
        { id: 'go-b', practiceText: 'Rentrer', nativeText: 'Head home' },
      ],
    };
    // LIFE-EX-13, corrected 2026-08-11: the review is the SCENE'S LAST
    // exercise, armed when the scene RESOLVES. It is no longer a graded slot
    // stolen at an arbitrary mid-scene point — that was the v2 `REVIEW_EVERY`
    // tick, and it was DELETED along with its counter. This fixture used to be
    // a plain question node with no `scene.resolved`, so under v3 it could
    // never arm the review and this spec had been failing on every run.
    const REVIEW_RESOLVING_TURN: RawNodeResponseInput = {
      node: {
        kind: 'continuation',
        beats: [
          {
            speaker: 'narrator',
            practiceText: '',
            nativeText: 'The terrace empties as the light goes.',
          },
        ],
      },
      options: [{ id: 'continue', practiceText: 'Continuer', nativeText: 'Continue' }],
      scene: {
        resolved: {
          endingKey: 'terrace-emptied',
          outcomeLine: 'La terrasse s’est vidée.',
          outcomeLineNative: 'The terrace emptied.',
          arcStage: 'continues',
        },
      },
    };
    // LIFE-SCENE-26 refuses a resolve below SCENE_FLOOR (4). Without this the
    // resolving turn is REJECTED, no review is ever armed, and the spec would
    // fail for a reason that has nothing to do with card matching.
    await db.doc(`users/${userA.uid}/lifeWorlds/${reviewWorldId}`).update({
      storyLog: { chapterNumber: 1, sceneId: 'active', sceneTurns: 8, entries: [] },
    });
    // …and the scene doc the counter is SCOPED TO must exist with that same id.
    // Seeding `storyLog` alone is not enough: with no `scenes/active`,
    // LIFE-SCENE-24 auto-starts a fresh scene, LIFE-ARC-PACE-4 re-scopes the
    // counter to the new id, and the seeded 8 is back to 1 by the time the
    // resolve lands — measured as `resolve-too-early {sceneTurns: 1}`.
    await db.doc(`users/${userA.uid}/lifeWorlds/${reviewWorldId}/scenes/active`).set({
      id: 'active',
      status: 'active',
      outline: {
        title: 'The Terrace',
        premise: 'Sit out the last of the light.',
        tone: 'quiet',
        practiceFocus: [],
        keyNpcs: [],
        openBranches: [],
        candidateEndings: [],
        completionTriggers: [],
      },
      currentPhase: 'resolution',
      turnsSinceReplan: 0,
      acceptedAt: admin.firestore.Timestamp.fromMillis(Date.now() - 600 * 1000),
    });
    await installLifeMock(page, {
      steps: [REVIEW_RESUME, REVIEW_RESOLVING_TURN, REVIEW_AFTER],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.goto(`/wurlds/${reviewWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    // SYNC GATE (de-flake): the card-match trigger + vocab harvest read the
    // client's event list in a ONE-SHOT decision at the 'chat' pick — it can't
    // retry, so the admin-seeded events MUST be loaded first. The seeded vocab
    // beats are future-timestamped (newest), so they surface in the resume
    // "Moments ago" block; waiting for the newest word ('sac') there confirms
    // the Firestore listener has delivered the whole seeded window (the older
    // seeded corrections arrive in the SAME atomic snapshot), so the pick below
    // sees all 5 beats + 6 corrections.
    await expect(
      page.getByTestId('LifeScreen-WurldResume-Moments'),
    ).toContainText('sac', { timeout: 15_000 });
    await page.getByTestId('LifeScreen-WurldResume-Continue').click({ timeout: 15_000 });
    // v2.1: recap Continue auto-continues (no manual '__resume__' chip).
    await page.getByTestId('LifeScreen-Choice-chat').click({ timeout: 15_000 });

    // POST-CONDITION 1 — the resolving turn hands the screen to the review
    // rather than to the options or straight to the summary. LIFE-EX-13.2:
    // arming happens on resolve, opening happens when the turn SETTLES.
    await expect(page.getByTestId('LifeScreen-CardMatch')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-CardMatch-Practice')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-CardMatch-Native')).toBeVisible();
    await captureBeat(page, testInfo, 'card-match');
    // Match every pair, reading the ids OFF THE GRID rather than assuming which
    // words it harvested.
    //
    // This used to click `w:pain`, `w:lait`… from the seeded list, and that was
    // a latent fixture dependency that finally bit: the deck harvests the
    // SCENE's recent vocab, so when LIFE-EX-VOCAB-3's `lineVocab` was added to
    // the comprehension fixture earlier in this file those glosses became the
    // newest vocab in the window and displaced the seeded words. The tiles the
    // loop asked for no longer existed and the spec hung to the 120s timeout.
    //
    // WHICH words the review picks is `buildSceneReviewPairs`' business and is
    // asserted there; what this spec is for is that every pair can be matched
    // and that clearing the grid hands the scene back. Reading the ids keeps it
    // pinned to that and immune to the next vocab change.
    const pairIds = await page
      .getByTestId(/^LifeScreen-CardMatch-Tile-.*:practice$/)
      .evaluateAll((els) =>
        els.map((el) =>
          (el.getAttribute('data-testid') ?? '')
            .replace(/^LifeScreen-CardMatch-Tile-/, '')
            .replace(/:practice$/, ''),
        ),
      );
    expect(pairIds.length).toBeGreaterThanOrEqual(2);
    for (const id of pairIds) {
      await page.getByTestId(`LifeScreen-CardMatch-Tile-${id}:practice`).click();
      await page.getByTestId(`LifeScreen-CardMatch-Tile-${id}:native`).click();
    }
    await captureBeat(page, testInfo, 'card-match-solved');
    // POST-CONDITION 2 — solving it hands the scene back. Under v3 the review
    // stands BETWEEN the resolve and the summary (LIFE-EX-13.3 holds the chip
    // back while a review is owed), so what the player gets next is the summary
    // chip, not another story turn. Asserting the chip rather than a beat is
    // the difference between "the grid closed" and "the scene ended properly".
    await expect(
      page.getByTestId('LifeScreen-Choice-__view-scene-summary__'),
    ).toBeVisible({ timeout: 15_000 });

    // No cleanup needed any more: the events live in this spec's OWN world, so
    // there is nothing for them to leak into. The `seeded` refs are kept
    // because the seeding loop reads more clearly with them collected.
    void seeded;
  });

  test('LIFE-VOCAB-RECAP-2 — completion screens list words practised in their window', async ({}, testInfo) => {
    // Seed (admin SDK, real Firestore): an active scene accepted
    // 60s ago, the seeded chapter re-stamped as started 120s ago, and
    // three practice-derived events at known offsets:
    //   - 'le marché'      correction  90s ago → chapter window ONLY
    //   - 'voudrais'       correction  30s ago → scene + chapter
    //   - 'la boulangerie' flashcard   20s ago → scene + chapter
    // ITS OWN WORLD, not the shared serial one. This comment used to say the
    // real 'voudrais' correction earlier tests write was "harmless: the
    // assertions below check presence, never the correct flag" — and then
    // LIFE-VOCAB-RECAP-7 added an assertion on exactly that flag. Nobody
    // noticed, because the block died at LIFE-FLOW-5 before ever reaching this
    // test. With that fixed (LIFE-FLOW-6) tests 15-18 now run, and the graded
    // listen-and-fill among them logs `voudrais` CORRECT with a live
    // timestamp — inside this scene's window and newer than the seeded miss,
    // so the row read `data-correct="true"`. A window containing only what
    // this test seeded is the fix: sharing one world across 24 serial tests
    // and then asserting on aggregates derived from its whole event log is not
    // something a comment can make safe.
    const db = getAdminFirestore();
    const secsAgo = (s: number) =>
      admin.firestore.Timestamp.fromMillis(Date.now() - s * 1000);
    const recapWorldId = await seedWorld(userA.uid);

    await db.doc(`users/${userA.uid}/lifeWorlds/${recapWorldId}`).update({
      currentArc: {
        chapterNumber: 1,
        premise: 'Settle into the neighbourhood.',
        themes: [],
        status: 'active',
        recurringNpcIds: [],
        completedSceneMemories: [],
        startedAt: secsAgo(120),
      },
      // LIFE-SCENE-26 refuses a resolve below SCENE_FLOOR (4 turns). This test
      // used to inherit a high enough count from the ~18 serial tests ahead of
      // it — an implicit precondition that made it fail bafflingly (no modal,
      // no chip, no error) whenever it was run on its own to debug something
      // else. Stated outright, the test now says what it needs.
      storyLog: { chapterNumber: 1, sceneId: 'active', sceneTurns: 8, entries: [] },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${recapWorldId}/scenes/active`)
      .set({
        id: 'active',
        status: 'active',
        outline: {
          title: 'The Gallery Show',
          premise: 'Get your photos into the local gallery.',
          tone: 'hopeful',
          practiceFocus: [],
          keyNpcs: [],
          openBranches: [],
          candidateEndings: [],
          completionTriggers: [],
        },
        currentPhase: 'resolution',
        turnsSinceReplan: 0,
        acceptedAt: secsAgo(60),
      });
    const eventsCol = db.collection(
      `users/${userA.uid}/lifeWorlds/${recapWorldId}/events`,
    );
    // LIFE-EX-19, corrected 2026-08-10: `payload.kind` is `'generation'`, not
    // `'fill-blank'`. The rename updated the unit fixtures and missed this one,
    // so these two events stopped matching `snapshotSceneCompletion`'s
    // `p.kind === 'generation'` and the day's stat grid silently read 0/0 where
    // the spec asserts 0/1. `'fill-blank'` survives ONLY as the wire value the
    // model emits (`WIRE_GENERATION_KIND`), normalised at the parse seam — it is
    // never what reaches Firestore, so seeding it here described a document the
    // app cannot produce.
    await eventsCol.add({
      kind: 'correction',
      payload: {
        kind: 'generation',
        correct: true,
        picked: 'le marché',
        correctAnswer: 'le marché',
        promptSource: 'Je vais au ___ ce matin.',
      },
      createdAt: secsAgo(90),
    });
    await eventsCol.add({
      kind: 'correction',
      payload: {
        kind: 'generation',
        correct: false,
        picked: 'veux',
        correctAnswer: 'voudrais',
        // LIFE-VOCAB-RECAP-7: the answer's gloss, as `commitNode` now writes
        // it. Without this field the row renders read-only, which is what the
        // owner reported: the word they got WRONG was the one they could not
        // keep.
        correctAnswerNative: 'would like',
        promptSource: 'Je ___ déjeuner avec toi.',
      },
      createdAt: secsAgo(30),
    });
    await eventsCol.add({
      kind: 'flashcard_added',
      payload: {
        id: 'card-boulangerie',
        practice: 'la boulangerie',
        native: 'the bakery',
      },
      createdAt: secsAgo(20),
    });
    // SYNC SENTINEL (de-flake): the seeded correction/flashcard events above do
    // NOT render as bubbles, so there is no way to observe when the client's
    // Firestore listener has actually delivered them — the scene recap could
    // resolve before they arrive and derive an empty list (the flake). Seed one
    // NEWEST beat that DOES render in the resume "Moments ago"; waiting for it
    // below proves the listener delivered the whole seeded window ATOMICALLY
    // (the older correction/flashcard events are in the same snapshot). A beat is
    // ignored by derivePractisedWords, so this never pollutes the vocab recap.
    await eventsCol.add({
      kind: 'beat',
      payload: {
        speaker: 'npc',
        speakerName: 'Sophie',
        practiceText: 'SYNC_BEACON_ONLINE',
        nativeText: 'sync beacon',
      },
      createdAt: admin.firestore.Timestamp.fromMillis(Date.now() + 5000),
    });

    await installLifeMock(page, {
      steps: [RESOLVING_TURN],
      scenes: [minimalBackdropSvg()],
    });
    // The preceding world-exit test ends with the page on
    // /wurlds, so navigate back into the world (a reload
    // would just reload the overview).
    await page.goto(`/wurlds/${recapWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    // SYNC GATE: wait for the sentinel beat in "Moments ago" before triggering
    // the scene resolution — this guarantees the seeded correction/flashcard
    // events are already in the client (same atomic listener snapshot), so the
    // vocab recap derives from them rather than racing an empty window.
    await expect(
      page.getByTestId('LifeScreen-WurldResume-Moments'),
    ).toContainText('SYNC_BEACON_ONLINE', { timeout: 15_000 });
    // Phase C: entering a world with events shows the WurldResumeScreen first;
    // its Continue AUTO-CONTINUES into the resume live turn (v2.1 — no manual
    // '__resume__' chip). Mirror the dismissal the landed resume test uses.
    await page
      .getByTestId('LifeScreen-WurldResume-Continue')
      .click({ timeout: 15_000 });

    // POST-CONDITION 0 — LIFE-SCENE-30: the modal does NOT mount itself. The
    // resolution beat plays out on screen and a chip takes the place of the
    // options; the player opens the summary when they have read it. Asserting
    // the modal is ABSENT first is the load-bearing half — without it the
    // click below would pass just as well against the old auto-mount.
    const sceneOverlay = page.getByTestId('LifeScreen-SceneComplete');
    const summaryChip = page.getByTestId('LifeScreen-Choice-__view-scene-summary__');
    await expect(summaryChip).toBeVisible({ timeout: 15_000 });
    await expect(sceneOverlay).toHaveCount(0);
    // …and the resolving turn's own options are gone — rendering them would
    // invite the player to walk on past an ending they have not been shown.
    await expect(page.getByTestId('LifeScreen-Choice-continue')).toHaveCount(0);
    await captureBeat(page, testInfo, 'scene-resolved-summary-pending');
    await summaryChip.click();

    // POST-CONDITION 1 — scene screen shows scene-window words
    // derived from the REAL Firestore events seeded above.
    await expect(sceneOverlay).toBeVisible({ timeout: 15_000 });

    // POST-CONDITION 1a — LIFE-SCENE-31 / LIFE-SCENE-31.1: THE CARD LEADS WITH
    // THE WORLD'S RECORD, and that slot reaches a terminal state.
    //
    // CORRECTED 2026-08-10. This used to assert `-Outcome` / `-OutcomeNative`
    // — the resolution BEAT, in both languages, per LIFE-SCENE-28. LIFE-SCENE-31
    // then deleted both elements: `LIFE-SCENE-30` parks the modal behind a chip
    // so the player reads that beat IN THE STORY first, which made repeating it
    // on the card a spend of the summary slot on a sentence they had finished
    // one screen earlier. The spec was never updated, so it has asserted two
    // testids that do not exist since `0a810a7` and nothing noticed.
    //
    // What the card shows instead is the line `runSceneClose` wrote — and in
    // this harness that close ALWAYS fails (`runSceneClose` posts
    // `category: 'life_scene'`, for which `installLifeMock` has no handler), so
    // this is also the LIFE-SCENE-31.1 path: the slot must fall back to the
    // resolution beat's native twin rather than shimmer for ever.
    await expect(
      sceneOverlay.getByTestId('LifeScreen-SceneComplete-SummaryPending'),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(
      sceneOverlay.getByTestId('LifeScreen-SceneComplete-Summary'),
    ).toHaveText('Your photos made the gallery wall.');
    const sceneRecap = sceneOverlay.getByTestId('LifeScreen-VocabRecap');
    await expect(sceneRecap).toBeVisible();
    await expect(sceneRecap).toContainText('voudrais');
    await expect(sceneRecap).toContainText('la boulangerie');
    await expect(sceneRecap).toContainText('the bakery');
    // 'le marché' pre-dates acceptedAt → excluded from the scene list.
    await expect(sceneRecap).not.toContainText('le marché');

    // POST-CONDITION 1a2 — LIFE-VOCAB-RECAP-7: the word the player got WRONG
    // is SAVEABLE. `correctAnswer` alone left every graded row glossless, and
    // LIFE-VOCAB-RECAP-4 withholds the save button from a glossless row — so
    // the one word worth keeping was the one that could not be kept. Asserting
    // the button, not just the text: the gloss rendering is not the point, the
    // ability to make a flashcard out of it is.
    const missedRow = sceneRecap
      .getByTestId('LifeScreen-VocabRecap-Row')
      .filter({ hasText: 'voudrais' });
    await expect(missedRow).toHaveAttribute('data-correct', 'false');
    await expect(missedRow).toContainText('would like');
    await expect(missedRow.getByRole('button')).toBeVisible();

    // POST-CONDITION 1b — LIFE-DAY-6: each exercise type renders its own
    // SCORE, not a tally. The window holds exactly one graded event (the
    // fill-blank the player got WRONG; the correct one at -90s pre-dates
    // acceptedAt), so the fill-blank cell must read 0/1 — a bare count would
    // read '1' and claim the opposite of what happened. Comprehension reads
    // 0/0 rather than vanishing: a day that asked none is a fact worth seeing,
    // and a grid whose cells come and go is harder to read than a fixed four.
    await expect(
      sceneOverlay.getByTestId('LifeScreen-SceneComplete-FillBlank'),
    ).toContainText('0/1');
    await expect(
      sceneOverlay.getByTestId('LifeScreen-SceneComplete-Comprehension'),
    ).toContainText('0/0');
    await captureBeat(page, testInfo, 'scene-complete-vocab');

    // POST-CONDITION 2 — Return home archives the scene and the CHAPTER
    // screen appears. LIFE-DAY-2: it deliberately does NOT restate the
    // practised-words list the day screen just showed with save buttons —
    // repeating it one modal later gave the player the same rows and a second
    // set of save buttons that knew nothing about the first. What it shows
    // instead is the chapter's own story vocabulary, and a look forward.
    // LIFE-SCENE-29: on the CHAPTER-ENDING path there is exactly ONE button.
    // The chapter screen follows immediately and owns the exit, so offering
    // "Return to Wurlds home" here would skip the larger milestone.
    await expect(
      sceneOverlay.getByTestId('LifeScreen-SceneComplete-ReturnToWurlds'),
    ).toHaveCount(0);
    await expect(
      sceneOverlay.getByTestId('LifeScreen-SceneComplete-Return'),
    ).toContainText(/chapter summary/i);
    await page.getByTestId('LifeScreen-SceneComplete-Return').click();
    const arcOverlay = page.getByTestId('LifeScreen-WorldArcComplete');
    await expect(arcOverlay).toBeVisible({ timeout: 15_000 });
    // LIFE-SCENE-31 / LIFE-DAY-2 / LIFE-SCENE-35: the chapter card leads with
    // its DAY LIST — one row per resolved scene, read from
    // `arc.completedSceneMemories` — and each row is bilingual.
    //
    // CORRECTED 2026-08-10, same cause as the scene card above: this asserted
    // `-Outcome` / `-OutcomeNative`, which LIFE-SCENE-31 deleted here too when
    // the day list moved up to lead. The sentences are unchanged because
    // `absorbSceneIntoArc` stores the resolution beat as the day's summary —
    // only the elements carrying them moved, which is exactly why a stale
    // testid assertion went unnoticed: the CONTENT still matched.
    // Assert the CONTAINER first, so a failure says which thing broke: no day
    // list at all (the arc never absorbed the scene) versus a row with the
    // wrong words in it. The previous version of this fix asserted the row
    // directly and reported only "element(s) not found", which is true of both.
    await expect(
      arcOverlay.getByTestId('LifeScreen-WorldArcComplete-Days'),
    ).toBeVisible({ timeout: 15_000 });
    const day = arcOverlay.getByTestId('LifeScreen-WorldArcComplete-Day').first();
    // `toContainText`, NOT `toHaveText`: the row is `<title> — <summary>` with
    // the native twin beneath it (LIFE-SCENE-35), so an exact match could only
    // ever pass against a row that rendered none of its own structure.
    await expect(day).toContainText('Tes photos ont trouvé le mur de la galerie.');
    await expect(
      arcOverlay.getByTestId('LifeScreen-WorldArcComplete-DayNative').first(),
    ).toContainText('Your photos made the gallery wall.');
    await expect(arcOverlay.getByTestId('LifeScreen-VocabRecap')).toHaveCount(0);
    await expect(
      arcOverlay.getByTestId('LifeScreen-WorldArcComplete-NextTeaser'),
    ).toBeVisible();
    await captureBeat(page, testInfo, 'arc-complete-recap');
  });

  test('@standard LIFE-SCENE-29/30 — the ordinary resolve: the player opens the summary, then picks one of TWO honest destinations', async ({}, testInfo) => {
    // THE TWO REPORTED BUGS, on the path that shows both. The test above
    // covers the CHAPTER-ending resolve; this is the far more common one —
    // the scene ends, the chapter carries on.
    //
    //   1. "the input button at the bottom is return home which actually
    //      return back to the story."  The single CTA said "Return home" and
    //      called continueTurn().
    //   2. "delay the modal so it plays out on screen and then shows in the
    //      modal."  The modal mounted the instant the resolve arrived, over
    //      the very line explaining how the scene ended.
    const db = getAdminFirestore();
    const secsAgo = (s: number) =>
      admin.firestore.Timestamp.fromMillis(Date.now() - s * 1000);
    const closeWorldId = await seedWorld(userA.uid);
    // LIFE-SCENE-26 refuses a resolve below SCENE_FLOOR (4). Seed the scene as
    // already well underway so the resolve is ACCEPTED — otherwise this test
    // would pass for the wrong reason (no modal because no resolve).
    await db.doc(`users/${userA.uid}/lifeWorlds/${closeWorldId}`).update({
      storyLog: { chapterNumber: 1, sceneId: 'active', sceneTurns: 8, entries: [] },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${closeWorldId}/scenes/active`)
      .set({
        id: 'active',
        status: 'active',
        outline: {
          title: 'The Late Market',
          premise: 'Get to the market before it shuts.',
          tone: 'wry',
          practiceFocus: [],
          keyNpcs: [],
          openBranches: [],
          candidateEndings: [],
          completionTriggers: [],
        },
        currentPhase: 'resolution',
        turnsSinceReplan: 0,
        acceptedAt: secsAgo(600),
      });

    await installLifeMock(page, {
      steps: [SCENE_ONLY_RESOLVING_TURN],
      scenes: [minimalBackdropSvg()],
    });
    await page.goto(`/wurlds/${closeWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });

    // POST-CONDITION 1 — LIFE-SCENE-30: the resolution beat is ON SCREEN and
    // the modal is NOT. Asserting the beat is readable is the actual point of
    // the delay; asserting the modal's absence is what makes the click below
    // mean something.
    await expect(page.getByTestId('LifeScreen-Bubble-narrator')).toContainText(
      'RESOLUTION_BEAT_ON_SCREEN',
      { timeout: 15_000 },
    );
    const summaryChip = page.getByTestId('LifeScreen-Choice-__view-scene-summary__');
    await expect(summaryChip).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-SceneComplete')).toHaveCount(0);
    await captureBeat(page, testInfo, 'scene-close-summary-pending');

    // POST-CONDITION 2 — LIFE-SCENE-31.1: the player opens it, and THE SUMMARY
    // SLOT REACHES A TERMINAL STATE.
    //
    // This harness reproduces the reported hang exactly, and always has:
    // `runSceneClose` posts `category: 'life_scene'`, for which `installLifeMock`
    // has no handler, so it 400s and the close returns `failed` on every run of
    // this spec. Before the fix that path `return`ed without telling the screen
    // and the slot pulsed its placeholder for ever — the owner's *"it just hangs
    // indefinitely"*. The FIRST assertion is on the slot, not on a string:
    // whatever lands, the shimmer must be gone.
    //
    // (This block also replaces stale assertions on `-Outcome` /
    // `-OutcomeNative`, deleted by LIFE-SCENE-31 — see the note in the
    // chapter-ending test above.)
    await summaryChip.click();
    const overlay = page.getByTestId('LifeScreen-SceneComplete');
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    await expect(
      overlay.getByTestId('LifeScreen-SceneComplete-SummaryPending'),
    ).toHaveCount(0, { timeout: 15_000 });
    // …and the slot is not left blank either. The close produced nothing, so
    // the fallback is the resolution beat's native twin — the one thing that is
    // still TRUE about how the scene ended.
    await expect(
      overlay.getByTestId('LifeScreen-SceneComplete-Summary'),
    ).toHaveText('The market closed without you.');

    // POST-CONDITION 3 — LIFE-SCENE-29: TWO buttons, and the primary one no
    // longer claims to be leaving. The `not` assertion is the regression
    // guard: "Return home" is the copy that was lying.
    const primary = overlay.getByTestId('LifeScreen-SceneComplete-Return');
    const exit = overlay.getByTestId('LifeScreen-SceneComplete-ReturnToWurlds');
    await expect(primary).toContainText('Continue the story');
    await expect(primary).not.toContainText(/return home/i);
    await expect(exit).toContainText('Return to Wurlds home');
    await captureBeat(page, testInfo, 'scene-close-two-ctas');

    // POST-CONDITION 4 — the exit button actually LEAVES, and the scene is
    // archived on the way out. Asserting the archive (not just the URL) is
    // the post-condition that matters: going home must still close the scene
    // down, or the player returns to a wurld stuck on an ended scene.
    await exit.click();
    await expect(page).toHaveURL(/\/wurlds$/, { timeout: 15_000 });
    // Poll for the ARCHIVED doc rather than for `active` disappearing:
    // `archiveScene` copies the scene to `scenes/{archivedId}` and DELETES
    // `scenes/active`, and LIFE-SCENE-24 then starts a fresh scene at
    // `scenes/active` — so "active is gone" is a transient the poll could
    // miss either way. The archived doc, once written, stays written.
    await expect
      .poll(
        async () => {
          const snap = await db
            .collection(`users/${userA.uid}/lifeWorlds/${closeWorldId}/scenes`)
            .get();
          return snap.docs.some(
            (d) => d.id !== 'active' && d.data()?.status === 'completed',
          );
        },
        { timeout: 15_000 },
      )
      .toBe(true);
    await captureBeat(page, testInfo, 'scene-close-returned-to-wurlds');
  });

  test('LIFE-SPEECH-1 — a non-graded "say" pick shows the player\'s OWN line as a user bubble', async ({}, testInfo) => {
    // Self-contained: its own fresh world (0 events → intro) + its own mock
    // steps, so it doesn't couple to the shared serial worldId.
    const speechWorldId = await seedWorld(userA.uid);
    await installLifeMock(page, {
      steps: [SPEECH_OPENING, SPEECH_OPTIONS],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.goto(`/wurlds/${speechWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-greet')).toBeVisible({ timeout: 15_000 });

    // Pick the non-graded speech option.
    await page.getByTestId('LifeScreen-Choice-greet').click();

    // POST-CONDITION (the reported bug's fix): the player's OWN spoken line
    // appears as a user bubble — NOT skipped, NOT inside the NPC bubble.
    const userBubble = page.getByTestId('LifeScreen-Bubble-user');
    await expect(userBubble).toBeVisible({ timeout: 15_000 });
    await expect(userBubble).toContainText('Salut Sophie');
    // And the NPC's reaction follows it (the world responds to what was said).
    await expect(page.getByTestId('LifeScreen-Bubble-npc')).toContainText('te voilà');

    // POST-CONDITION (persistence): it was written as a `user` beat event, so a
    // later turn/resume reads it back as the player's line, not the NPC's.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, speechWorldId);
        return events.some(
          (e) =>
            e.kind === 'beat' &&
            (e.payload as { speaker?: string }).speaker === 'user' &&
            String((e.payload as { practiceText?: string }).practiceText ?? '').includes('Salut Sophie'),
        );
      }, { timeout: 15_000 })
      .toBe(true);
    await captureBeat(page, testInfo, 'speech-say-user-bubble');
  });

  test('@standard LIFE-SPEECH-3 — a "say" option with a gradeTarget makes the player PRODUCE the line', async ({}, testInfo) => {
    // THE REPORTED BUG: "Questions seem to not be triggering for things I say,
    // ie they are all comprehension questions so far." Outbound fill-blanks
    // were structurally unreachable — `saysLine` is required on every `say`
    // option and the client renders it on pick, so by the time a node could
    // intercept the line it had already been spoken. Every graded moment came
    // out comprehension. The gate moved onto the option; this proves it fires.
    const sayWorldId = await seedWorld(userA.uid);
    const mock = await installLifeMock(page, {
      // ONE step fixture, deliberately: the pick must NOT spend a `life_step`.
      // A second one would drain the queue and 500 — which is the assertion.
      steps: [GRADED_SAY_OPENING, SPEECH_OPTIONS],
      gradedQuestions: [GRADED_SAY_QUESTION],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.route('**/synthesizeSpeech**', (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'stubbed' }),
    );
    await page.goto(`/wurlds/${sayWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-greet')).toBeVisible({ timeout: 15_000 });

    const stepCallsBefore = mock.stepCalls();
    await page.getByTestId('LifeScreen-Choice-greet').click();

    // POST-CONDITION 1: the pick became the QUESTION. Before the fix this same
    // click landed the line as a bubble and asked nothing.
    await expect(
      page
        .getByTestId('LifeScreen-PracticePrompt-FillBlank')
        .or(page.getByTestId('LifeScreen-ListenFill')),
    ).toBeVisible({ timeout: 15_000 });
    // The player's line is NOT on screen — it has not been said yet, and
    // showing it would hand them the answer.
    await expect(page.getByTestId('LifeScreen-Bubble-user')).toHaveCount(0);
    await captureBeat(page, testInfo, 'graded-say-question');

    // POST-CONDITION 2: it cost NO `life_step`. The node route spent one to
    // pose the question; the option already carried everything needed.
    expect(mock.stepCalls() - stepCallsBefore).toBe(0);

    await page.getByTestId('LifeScreen-Choice-longtemps').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();

    // POST-CONDITION 3 — the one that matters: the COMPLETED line lands in the
    // player's own voice. Production practice happened and resolved into their
    // bubble, not an NPC's.
    const userBubble = page.getByTestId('LifeScreen-Bubble-user');
    await expect(userBubble).toBeVisible({ timeout: 15_000 });
    await expect(userBubble).toContainText('ça fait longtemps');
    await captureBeat(page, testInfo, 'graded-say-resolved');

    // POST-CONDITION 4 (persistence): stored as a `user` beat, so resume and
    // every later prompt read it back as the player's line.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, sayWorldId);
        return events.some(
          (e) =>
            e.kind === 'beat' &&
            (e.payload as { speaker?: string }).speaker === 'user' &&
            String((e.payload as { practiceText?: string }).practiceText ?? '').includes('longtemps'),
        );
      }, { timeout: 15_000 })
      .toBe(true);
  });

  test('@standard LIFE-SPEECH-6 — the line the player produced is NOT said again by an NPC', async ({}, testInfo) => {
    // THE REPORTED BUG (2026-08-05): "occasionally when i get a question that's
    // directed from ME saying something (e.g. fill blank) it shows in the
    // events as both me and the NPC saying the line, one after the other."
    // The post-outcome step call carried only the graded metadata, so the model
    // never knew the completed sentence was already the player's bubble. It
    // staged the speech, PLAYER-VOICE barred a `user` beat, and the words came
    // out of Sophie. The fixture below IS that wrong response — quoted and
    // punctuated differently, as the model actually returns it.
    const echoWorldId = await seedWorld(userA.uid);
    const mock = await installLifeMock(page, {
      steps: [GRADED_SAY_OPENING, SPEECH_ECHO_OUTCOME],
      gradedQuestions: [GRADED_SAY_QUESTION],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.route('**/synthesizeSpeech**', (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'stubbed' }),
    );
    await page.goto(`/wurlds/${echoWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-greet')).toBeVisible({ timeout: 15_000 });

    await page.getByTestId('LifeScreen-Choice-greet').click();
    // LIFE-FLOW-7: THIS is the assertion that reproduced it (2026-09-20, under
    // CPU load). The recap dialog came up over a two-turns-in fresh world and
    // the fill-blank below timed out at 15s saying only "element(s) not found"
    // — the cause was visible solely in the accessibility snapshot. Checked
    // first so the failure names itself.
    await expectNoEntryOverlay(page, 'after picking the graded say option');
    await expect(
      page
        .getByTestId('LifeScreen-PracticePrompt-FillBlank')
        .or(page.getByTestId('LifeScreen-ListenFill')),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('LifeScreen-Choice-longtemps').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();

    // The player's own bubble lands, as LIFE-SPEECH-3 already guarantees.
    const userBubble = page.getByTestId('LifeScreen-Bubble-user');
    await expect(userBubble).toBeVisible({ timeout: 15_000 });
    await expect(userBubble).toContainText('ça fait longtemps');
    // And the turn continues — proving the echoing response was CONSUMED, not
    // rejected wholesale. The second beat is the real one and must survive.
    await expect(page.getByText('Ah, te voilà !')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'speech-echo-dropped');

    // THE POST-CONDITION — the data, not the screen: exactly ONE committed beat
    // carries that line, and it is the player's. Before the fix there were two.
    //
    // Poll for the LAST beat of the outcome node first. Polling the count
    // directly would pass on a transient read — the player's bubble commits
    // before the node's beats do, so `['user']` is momentarily true even when
    // the echo is on its way. Waiting for the tail of the same node makes the
    // read stable, and only then is the count asserted, once.
    const beatTexts = async () =>
      (await readEvents(userA.uid, echoWorldId))
        .filter((e) => e.kind === 'beat')
        .map((e) => ({
          speaker: (e.payload as { speaker?: string }).speaker,
          text: String((e.payload as { practiceText?: string }).practiceText ?? ''),
        }));
    await expect
      .poll(async () => (await beatTexts()).some((b) => b.text.includes('te voilà')), {
        timeout: 15_000,
      })
      .toBe(true);
    const said = (await beatTexts()).filter((b) => b.text.includes('ça fait longtemps'));
    expect(said.map((b) => b.speaker)).toEqual(['user']);
  });

  test('@standard LIFE-SPEECH-5 — a graded say whose GENERATOR fails still SPEAKS the line', async ({}, testInfo) => {
    // THE REPORTED BUG behind this: "I hit 'the story hit a snag' a lot... when
    // the system decides to make a practice question from my point of view."
    // LIFE-SPEECH-3 routes the pick into a synthesised question node, which
    // clears the board. If the generator then cannot author the question, the
    // shared LIFE-NODE-8 demote authored fresh options for a node that never
    // rendered — so the player picked "Greet Sophie warmly", the dialogue area
    // emptied, and new chips arrived as though they had said nothing, while
    // the committed decision told the model they had.
    const sayWorldId = await seedWorld(userA.uid);
    const mock = await installLifeMock(page, {
      steps: [GRADED_SAY_OPENING, SPEECH_OPTIONS],
      // Both attempts fail the "exactly 1 correct" refine → kind: 'failed'.
      gradedQuestions: [GRADED_SAY_UNAUTHORABLE, GRADED_SAY_UNAUTHORABLE],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.route('**/synthesizeSpeech**', (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'stubbed' }),
    );
    await page.goto(`/wurlds/${sayWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-greet')).toBeVisible({ timeout: 15_000 });

    const stepCallsBefore = mock.stepCalls();
    await page.getByTestId('LifeScreen-Choice-greet').click();

    // THE POST-CONDITION: the line the player chose to SAY is spoken, in their
    // own voice. Not "the options came back" — the line.
    const userBubble = page.getByTestId('LifeScreen-Bubble-user');
    await expect(userBubble).toBeVisible({ timeout: 20_000 });
    await expect(userBubble).toContainText('ça fait longtemps');
    await captureBeat(page, testInfo, 'graded-say-demote-spoke');

    // The generator was genuinely exercised and genuinely failed — otherwise
    // this spec would pass against the ordinary LIFE-SPEECH-3 route.
    expect(mock.gradedCalls()).toBe(2);
    // And the recovery is ONE live turn (the pick's reaction), not an options
    // call for a node that was never on screen.
    expect(mock.stepCalls() - stepCallsBefore).toBe(1);
    await expect(page.getByText('Ah, te voilà !')).toBeVisible({ timeout: 15_000 });

    // Persistence: stored as a `user` beat, so resume and every later prompt
    // read it back as the player's line.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, sayWorldId);
        return events.some(
          (e) =>
            e.kind === 'beat' &&
            (e.payload as { speaker?: string }).speaker === 'user' &&
            String((e.payload as { practiceText?: string }).practiceText ?? '').includes('longtemps'),
        );
      }, { timeout: 15_000 })
      .toBe(true);
  });

  test('@standard LIFE-ARC-PACE-2 + LIFE-EX-PLAN-5 — a graded turn logs TWO lines but advances the chapter pace counter by ONE', async ({}, testInfo) => {
    // Chapters never ended because the SI's "25-35 player turns" rule was
    // stated in a quantity nothing ever rendered. LIFE-ARC-PACE-1 renders it;
    // this asserts the counter it renders is actually the turn count.
    //
    // A graded turn appends the question's logLine AND its pre-authored
    // resolution's logLine. Counting entries would run 1.36x fast (measured:
    // 34 entries over a 25-turn harness run), which would have concluded
    // chapters around turn 23 — replacing "never ends" with "ends early".
    const db = getAdminFirestore();
    const paceWorldId = await seedWorld(userA.uid);
    const mock = await installLifeMock(page, {
      // ONE step fixture on purpose. LIFE-EX-PLAN-5's saving IS the call that
      // does not happen, so the queue is sized to the expected call count: a
      // second `life_step` would drain it and 500.
      steps: [PACE_OPENING, PACE_QUESTION_WITH_RESOLUTION],
      gradedQuestions: [GRADED_SRS_CARD],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg()],
    });
    await page.route('**/synthesizeSpeech**', (route) =>
      route.fulfill({ status: 503, contentType: 'text/plain', body: 'stubbed' }),
    );
    await page.goto(`/wurlds/${paceWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-ask')).toBeVisible({ timeout: 15_000 });

    const readLog = async () =>
      ((await db.doc(`users/${userA.uid}/lifeWorlds/${paceWorldId}`).get()).data()?.storyLog ?? {
        entries: [],
      }) as { entries: string[]; turns?: number };
    // Snapshot BEFORE the graded turn rather than asserting absolutes: the
    // opening turn has already committed its own line, and the invariant under
    // test is the DELTA across one graded turn.
    //
    // WAIT for the opening's line to land first. `applyTurnSignals` is fire-and
    // -forget from the arrival path, so the options can be on screen before the
    // write commits — reading the baseline too early folds the opening's own
    // line into the delta and the graded turn looks like it logged three.
    await expect
      .poll(async () => (await readLog()).entries, { timeout: 15_000 })
      .toEqual(expect.arrayContaining([expect.stringContaining('PACE-OPENING-LINE')]));
    const before = await readLog();
    const stepCallsBeforeTurn = mock.stepCalls();
    await page.getByTestId('LifeScreen-Choice-ask').click();
    await expect(
      page
        .getByTestId('LifeScreen-ListenFill')
        .or(page.getByTestId('LifeScreen-PracticePrompt-FillBlank')),
    ).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('LifeScreen-Choice-quand-meme').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();

    // The pre-authored continuation landed — its beat and its options are on
    // screen, which is what proves no live turn was needed to produce them.
    await expect(page.getByText('Alors on y va !')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-walk')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'pace-resolution-landed');

    // POST-CONDITION 1 (LIFE-EX-PLAN-5): the whole graded turn cost exactly ONE
    // `life_step`. Before the change it cost two — one to pose the question
    // (~93 output tokens) and one to narrate the aftermath.
    expect(mock.stepCalls() - stepCallsBeforeTurn).toBe(1);

    // POST-CONDITION 2 (LIFE-ARC-PACE-2): the log gained BOTH lines...
    await expect
      .poll(async () => (await readLog()).entries, { timeout: 15_000 })
      .toEqual(
        expect.arrayContaining([
          expect.stringContaining('PACE-QUESTION-LINE'),
          expect.stringContaining('PACE-RESOLUTION-LINE'),
        ]),
      );

    // ...but `turns` moved by ONE. Two lines, one generated turn. This is the
    // number <chapterPace> renders and the SI's 25/32/40 tiers read; pacing off
    // `entries.length` instead is what would have ended chapters early.
    const after = await readLog();
    expect(after.entries.length - before.entries.length).toBe(2);
    expect((after.turns ?? 0) - (before.turns ?? 0)).toBe(1);
  });
  test('LIFE-GRID-4/5 @standard — the required type rotates and the taken action reaches the next prompt', async () => {
    // THE REPORTED COMPLAINT this closes: *"always directing the user to the
    // same or very similar options in the grid."* The audit found the cause was
    // structural rather than stylistic — `LIFE-OPT-VARIETY` is a good rule, but
    // it governed ONE grid in isolation. Nothing showed the model what it had
    // already offered, and nothing required a different KIND of move this turn.
    //
    // Neither mechanism has any DOM: both are inputs to the model. A spec that
    // asserted the rendered chips would be asserting the FIXTURE. What the app
    // SENT is the only real post-condition, so that is what this reads.
    const gridWorld = await seedWorld(userA.uid);
    const opening: RawNodeResponseInput = {
      node: {
        kind: 'branch',
        beats: [
          { speaker: 'narrator', practiceText: '', nativeText: 'The market is loud this morning.' },
        ],
      },
      options: [
        { id: 'lift', practiceText: 'Porter les caisses', nativeText: 'Carry the crates', actionType: 'do' },
        { id: 'ask', practiceText: 'Demander le prix', nativeText: 'Ask the price', actionType: 'ask' },
      ],
    };
    const second: RawNodeResponseInput = {
      node: {
        kind: 'branch',
        beats: [{ speaker: 'narrator', practiceText: '', nativeText: 'You lift the first crate.' }],
      },
      options: [
        { id: 'go', practiceText: 'Aller au quai', nativeText: 'Walk to the dock', actionType: 'move' },
        { id: 'look', practiceText: 'Regarder la liste', nativeText: 'Read the list', actionType: 'observe' },
      ],
    };
    // A THIRD node, because the post-condition below reads the prompt built
    // after the first pick has COMMITTED — which takes one more turn.
    const third: RawNodeResponseInput = {
      node: {
        kind: 'branch',
        beats: [{ speaker: 'narrator', practiceText: '', nativeText: 'The dock is empty.' }],
      },
      options: [
        { id: 'wait', practiceText: 'Attendre', nativeText: 'Wait', actionType: 'observe' },
        { id: 'back', practiceText: 'Revenir', nativeText: 'Head back', actionType: 'move' },
      ],
    };
    const gridMock = await installLifeMock(page, {
      steps: [opening, second, third],
      scenes: [minimalBackdropSvg(), minimalBackdropSvg(), minimalBackdropSvg()],
    });

    await page.goto(`/wurlds/${gridWorld}`);
    await page.waitForLoadState('domcontentloaded');
    // A freshly-seeded world opens on the intro screen, and the opening turn
    // is gated behind dismissing it (`introDismissed` is component state, so a
    // fresh navigation always shows it). Without this the spec waits 20s for a
    // beat that cannot arrive, behind the "Your story begins" dialog.
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 20_000 });
    await expect(page.getByText('The market is loud this morning.')).toBeVisible({ timeout: 20_000 });

    // Turn 0 of the rotation is `do`, and `do` is already an ACTIVE type, so no
    // second requirement is added.
    const first = gridMock.prompts()[0] ?? '';
    expect(first).toContain('<requiredAction type="do"');
    expect(first).not.toContain('type="active"');
    // Nothing has been taken yet, so there is no memory block at all — an empty
    // one would be pure prompt weight on the turn that can least afford it.
    expect(first).not.toContain('<recentActions>');

    // LIFE-FLOW-7: the world was seeded fresh and Begin was tapped, so both
    // entry screens are spent. If one is up here it is the 2026-09-19 failure.
    await expectNoEntryOverlay(page, 'before the first chip pick');
    await page.getByTestId('LifeScreen-Choice-lift').click();
    await expect(page.getByText('You lift the first crate.')).toBeVisible({ timeout: 20_000 });

    // The LIVE turn is generated from the events the client holds when the pick
    // is made, and the decision event is written by `commitNode` once that node
    // lands — so the pick cannot be in `<recentActions>` yet. It is not missing
    // from the prompt: it is right there in `<turn kind="choice">`, which is
    // where the model reads it on this one turn.
    const live = gridMock.prompts()[1] ?? '';
    expect(live).toContain('<choice id="lift">');
    expect(live).not.toContain('<recentActions>');

    // THE POST-CONDITION, one turn later — the first prompt built AFTER the
    // decision was committed. The pick's `actionType` had to survive the whole
    // round trip to appear here: option → CommitAction → decision event → the
    // events log → `actionShapesFromEvents`. Asserting the rendered chips
    // instead would have passed with every one of those links broken.
    await expectNoEntryOverlay(page, 'mid-turn, before the second chip pick');
    await page.getByTestId('LifeScreen-Choice-go').click();
    await expect
      .poll(() => gridMock.prompts().length, { timeout: 20_000 })
      .toBeGreaterThan(2);
    const afterCommit = gridMock.prompts()[2] ?? '';
    // `do`, with no `:target` — the colon is only rendered for an option that
    // carried a `targetId`, and `lift` deliberately does not. Asserting the
    // targeted form here would be asserting a fixture detail rather than the
    // round trip.
    expect(afterCommit).toContain('<recentActions>do</recentActions>');
    expect(afterCommit).toContain('already in play');

    // ...and the required type MOVES between adjacent turns. That is the whole
    // mechanism, and it is what the rotation guarantees — the specific type is
    // a function of the event count, so pinning one value here would assert an
    // arithmetic detail rather than the invariant.
    const typeOf = (p: string) => /<requiredAction type="([a-z]+)"/.exec(p)?.[1] ?? '';
    expect(typeOf(first)).toBe('do');
    expect(typeOf(live)).not.toBe(typeOf(first));
    expect(typeOf(afterCommit)).not.toBe(typeOf(live));
  });
  test('@standard LIFE-NEED-3/5 — a blocked objective states its reason and puts the door on the same grid', async ({}, testInfo) => {
    // The gap this closes: `exposureReason` / `clearingMove` were computed and
    // rendered NOWHERE, so an objective could be blocked and the grid said
    // nothing — the same "I couldn't tell what I was supposed to do" the goal
    // ladder exists to answer. `goalPrompt` was meanwhile telling the model the
    // player was being shown the block "word for word", which made it a promise
    // the UI broke.
    const db = getAdminFirestore();
    const blockWorldId = await seedWorld(userA.uid);
    // A `who` need on a roster member whose standing is 0 — LIFE-REP-1's "you
    // are nobody to them yet", which is below REPUTATION_FLOOR and therefore
    // blocks. Seeded as data, never as a model judgement (LIFE-NEED-2).
    await db.doc(`users/${userA.uid}/lifeWorlds/${blockWorldId}`).update({
      goalLadder: {
        saga: { text: 'hang three canvases in the Friday show', when: 'Friday', days: 12 },
        objective: {
          id: 'obj-1',
          text: 'get Hélène to look at your work',
          need: { kind: 'who', name: 'Hélène' },
        },
        done: [],
        dayIndex: 0,
      },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${blockWorldId}/npcs/helene`)
      .set({ id: 'helene', name: 'Hélène', scope: 'world', standing: 0 });

    await installLifeMock(page, {
      steps: [AFTER_COMPREHENSION, AFTER_COMPREHENSION],
      scenes: [minimalBackdropSvg()],
    });
    await page.goto(`/wurlds/${blockWorldId}`);
    await page.waitForLoadState('domcontentloaded');
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });

    // POST-CONDITION 1 — LIFE-NEED-3: the block is on screen, in fiction,
    // attributed, BEFORE the choice. Asserting the sentence rather than the
    // element's presence: an empty row would satisfy `toBeVisible`.
    const blockRow = page.getByTestId('LifeScreen-ObjectiveBlock');
    await expect(blockRow).toContainText('Hélène', { timeout: 20_000 });
    // Never a number, never "risky" — mechanics showing through is the failure
    // mode this invariant names.
    await expect(blockRow).not.toContainText(/risky|\d+\s*%/i);

    // POST-CONDITION 2 — LIFE-NEED-5, the load-bearing one: the door is on the
    // SAME grid, beside the ordinary options rather than instead of them. A
    // block the player cannot act on is the wall v2 deleted its own blocker for.
    const door = page.getByTestId('LifeScreen-Choice-__clear-block__');
    await expect(door).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-breakfast')).toBeVisible();
    await captureBeat(page, testInfo, 'need-block-and-door');

    // POST-CONDITION 3 — taking the door actually SPENDS THE TURN. This is the
    // post-condition that matters: a chip that renders but routes nowhere would
    // pass every assertion above. The decision reaches the events log, which is
    // the same seam an ordinary pick uses.
    await door.click();
    await expect
      .poll(
        async () => {
          const events = await readEvents(userA.uid, blockWorldId);
          return events.some(
            (e) => e.kind === 'decision' && String(e.payload.text ?? '').includes('Hélène'),
          );
        },
        { timeout: 25_000 },
      )
      .toBe(true);
  });
});
