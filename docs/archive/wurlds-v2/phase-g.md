# Phase G — Flashcard weaving + SRS credit

**Goal.** Make the player's saved flashcard deck a first-class input to the wurld's teaching loop: (1) every `life_step` prompt carries a **chapter-frozen snapshot of the unarchived deck** (`<flashcards>` block, id + practice phrase, due-first, cap 100) in the stable-prefix position right after `<sceneIndex>`; (2) the planner SI **prefers testing a saved card** when the moment allows and tags `gradedPlan.flashcardId` (the field already exists in the schema — no schema change); (3) when the resolved graded question carried a `flashcardId`, the feedback-Continue path calls **`recordAttempt`** so the card's SM-2 state + auto-archive streak update exactly as they do in practice mode, and the `correction` event carries the card id; (4) one SI line nudges NPCs to **re-use recently-practiced words** a few nodes later (narrative re-exposure). Zero new Gemini calls; zero new UI copy (no i18n changes).

**Invariant ids covered:** `LIFE-EX-SRS-1` … `LIFE-EX-SRS-4` (all new — verified free: `git grep LIFE-EX-SRS -- docs/specs src tests` returns nothing today). One existing invariant amended: `LIFE-CTX-1` (the prompt-order row gains the deck-block position). No ids are superseded.

## Contradictions

Checked against the source + the Phase F planned post-state (source wins on detail; plan intent kept):

1. **The plan writes `recordAttempt({uid, cardId: flashcardId, correct})` — calling it that way silently breaks SM-2.** `recordAttempt` (src/lib/flashcards.ts:148) takes an optional `card` param carrying the card's CURRENT SM-2 state (`interval`/`ease`/`reps`/`lapses`/`consecutiveCorrectDays`/`lastReviewedAt`); when omitted, `computeNext` falls back to fresh defaults — every wurld answer would reset the card's schedule to interval 1 and the archive streak to day 1. **Resolution (intent-preserving): pass the card's live SM-2 state**, mirroring `PracticeScreen.tsx:571`'s pattern but including the two archive-streak fields PracticeScreen omits. The card comes from the deck LifeScreen already subscribes to (`useFlashcards`).
2. **The plan says the credit lives in "LifeScreen's practice-resolution path (where the `correction` event is written / `onFeedbackContinue`)" — post-F that code is not in LifeScreen.** Phase F moved the whole practice-resolution path into the node engine: the correction event is written by `commitNode` (called from `nodeEngineActions.feedbackContinue`), and `FeedbackState` lives in `nodeEngineTypes.ts`. **Resolution: the credit fires inside `feedbackContinue` in `src/screens/LifeScreen/nodeEngineActions.ts`** — the same code path, its post-F home. All threading below targets the F post-state files.
3. **The post-F planner SI points `flashcardId` at "flashcard_added events"; the plan's deck block makes that stale.** Phase F's SI line (F4-b) reads "(see flashcard_added events)" because no deck block existed yet. **Resolution: G rewrites that SI line to point at the `<flashcards>` block** (and the VOCABULARY RULES bullet to describe snapshot-vs-events), exactly as the plan intends.
4. **`LIFE-CTX-1`'s ordered list has drifted from the code** (the `<campaign>` block already renders between the scene index and the rolling summary; the invariant text never mentions it). G touches this exact assembly, so per the workflow the spec row is corrected in the same commit: the amended row names both the campaign block (existing code, position 4.5) and the new deck block (position 4.2). This is an **extend**, not a contradiction — the stable→volatile principle is unchanged.

Not a contradiction but **found while researching, out of G's scope — surface to the manager, do not fix here**: `PracticeScreen.tsx:579-586` passes only `{interval, ease, reps, lapses}` to `recordAttempt`, omitting `consecutiveCorrectDays`/`lastReviewedAt` — so practice mode's auto-archive streak (`CARDS-ARCHIVE-2`) re-computes from `prevStreak: 0` on every answer and the 5-day auto-archive can never trigger from practice sessions. Needs its own fix + test on the practice surface.

## Read first

- `docs/plans/wurlds-v2/00-approved-plan.md` — Context, Phase ordering, the **Phase G** section.
- `docs/specs/life-sim.md` — §4 (`LIFE-CTX-*` — cache-friendly prompt order), §10.45 (`LIFE-EX-PLAN-*`/`LIFE-EX-GEN-*` — the planner emits `gradedPlan`; G only enriches what the planner is told), §10.46 (`LIFE-NODE-*` — Phase F's node engine; G's threading rides its feedback flow), §19's final bullet (the explicit-cache backlog note whose "flashcard set is frozen for the chapter" stance G implements prompt-side).
- `docs/specs/README.md` — prefix table (you edit the `LIFE-*` row) + cross-spec interaction map (you add one row).
- `docs/plans/wurlds-v2/phase-f.md` — F2-a (`commitNode.ts`), F3-a (`mergeLocalEvents.ts`), F3-b (`generateStepOptions.ts`), F4-b (the post-F SI you edit), F6-b1/b2 (`nodeEngineTypes.ts` / `nodeEngineActions.ts`), F6-e E5 (the `useNodeEngine` call in LifeScreen), F7-b/F7-c (E2E harness + spec you extend). **Phases land in order — every anchor below marked POST-PHASE-F is quoted from phase-f.md's output; POST-PHASE-C/E likewise. If an anchor does not `grep -F -c` to exactly 1, the earlier phase did not land as pinned — STOP and report; do not guess.**
- Source you will modify: `src/types/firestore.ts`, `src/lib/life/prompts/step.ts`, `src/lib/life/generateStepOptions.ts`, `src/lib/life/commitNode.ts`, `src/lib/life/mergeLocalEvents.ts`, `src/screens/LifeScreen/nodeEngineTypes.ts`, `src/screens/LifeScreen/nodeEngineActions.ts`, `src/screens/LifeScreen/LifeScreen.tsx`, plus the test files listed under Tests.
- Source you will call but NOT modify: `src/lib/flashcards.ts` (`recordAttempt` at line 148 — read its doc comment + the `card` param), `src/lib/sessionBuilder/internal.ts` (`cardPriorityScore` at line 47), `src/hooks/useFlashcards.ts` + `src/hooks/firestore/useCollectionSnapshot.ts` (the `fromCache` field's doc comment — it is why the snapshot write gates on a server emit), `src/lib/life/world.ts` (`updateLifeWorld`), `src/types/firestore.ts` (`ZFlashCard`, `cardSides`, `ZWorldArc.chapterNumber`).

## Spec changes

Apply these FIRST (Ordered step 0). Verify every anchor with `grep -F -c '<snippet>' <file>` → must print `1`.

### S1 — `docs/specs/life-sim.md`: prefix-table row

ANCHOR (POST-PHASE-F — F's S1 inserted this row; verify unique):

```
| `LIFE-NODE-*` | Node/lookahead step engine | Node taxonomy (branch/continuation/question), single-call lookahead previews, commit-on-pick, ✏️ chip, nonce invalidation, cadence, failure ladder |
```

Insert **after** that row:

```
| `LIFE-EX-SRS-*` | Flashcard weaving + SRS credit | Chapter-frozen `<flashcards>` deck block in the prompt; `gradedPlan.flashcardId` → `recordAttempt` SM-2 credit; narrative re-exposure nudge |
```

### S2 — `docs/specs/life-sim.md`: LIFE-CTX-1 row amendment

ANCHOR (verify unique — start of the row):

```
| **LIFE-CTX-1** | The full LLM prompt for every `lifeStep` call is assembled in this exact order
```

Replace the entire `LIFE-CTX-1` table row (the single `| **LIFE-CTX-1** | … |` line) with:

```
| **LIFE-CTX-1** | The full LLM prompt for every `lifeStep` call is assembled in this exact order (most-stable to most-volatile): (1) system instruction, (2) world seed + character sheet, (3) NPC roster (sorted by id), (4) scene index (sorted by id), (4.2) flashcard-deck snapshot (`<flashcards>` — chapter-frozen, `LIFE-EX-SRS-1/3`), (4.5) active campaign outline (idle marker when none), (5) rolling summary, (6) recent events (oldest→newest, last 20), (7) the user's current input. Anything from (1)–(5) only changes on compaction, chapter transitions, campaign lifecycle changes, or character-sheet edits, so the prefix stays cached across most turns. |
```

### S3 — `docs/specs/life-sim.md`: new §10.47 section

ANCHOR (verify unique):

```
## 10.48 Story shape — `LIFE-STORY-SHAPE-*`
```

Insert **before** that heading (leave a blank line before and after the inserted block):

```
## 10.47 Flashcard weaving + SRS credit — `LIFE-EX-SRS-*`

The player's saved deck is the seed vocabulary the wurld weaves into its questions (Product requirements: "Vocabulary woven into narrative"). The planner LLM is the curator — it sees the deck, the story, and the recently-tested list in one context and picks the card; no extra selector call. When a card-backed question resolves, the SAME SM-2 write path practice mode uses credits the review, so a wurld session advances the deck exactly like a practice session.

| ID | Invariant |
|---|---|
| **LIFE-EX-SRS-1** | Every `life_step` prompt carries a `<flashcards>` block at LIFE-CTX-1 position (4.2) — after `<sceneIndex>`, before `<campaign>` — rendered from `world.deckSnapshot`: one `<card id="{cardId}">{practice phrase}</card>` row per card, id + practice phrase ONLY (no translations — the model needs the surface form; glosses would bloat the stable prefix and leak nothing useful to a planner). Order inside the block is the snapshot's stored order: due cards first (`nextReviewAt <= now`; a card with NO `nextReviewAt` counts as due), then not-yet-due, each group sorted by `cardPriorityScore` descending (ties keep the deck's `createdAt desc` query order — the sort is stable). Capped at 100 cards (`DECK_SNAPSHOT_CAP`). No snapshot / empty snapshot renders the self-closing `<flashcards/>` so the section count is stable. |
| **LIFE-EX-SRS-2** | `gradedPlan.flashcardId` threads unchanged through the client: plan (`activePlanRef`) → `FeedbackState.flashcardId` (set at graded-chip pick) → `PracticeOutcome.flashcardId` (both build sites: the feedback prefetch and feedback-Continue) → the `correction` event payload (`commitNode` and the `mergeLocalEvents` overlay mirror; key OMITTED when null). On feedback-Continue, when the id resolves against the LIVE loaded deck, `creditSrsAttempt` fires `recordAttempt({uid, cardId, correct, card})` with the card's current SM-2 state (`interval`/`ease`/`reps`/`lapses`/`consecutiveCorrectDays`/`lastReviewedAt`) — the identical write practice mode performs (SM-2 schedule + correct/incorrect counters + the CARDS-ARCHIVE-2 auto-archive streak). Fire-and-forget: a write failure logs a warn and never blocks the narrative; an id that does NOT resolve (model hallucination, deleted card) logs a warn and attempts NO write. `reviewMode`/`nearMiss` are practice-mode concepts and stay at their defaults. |
| **LIFE-EX-SRS-3** | The deck snapshot is CHAPTER-FROZEN. It is written at most once per chapter by the client (`useChapterDeck`): when `world.currentArc` is present AND (`world.deckSnapshot` is missing OR `deckSnapshot.chapterNumber !== currentArc.chapterNumber`), and ONLY from a server-confirmed deck read (`loading === false && fromCache === false` — a Firestore cache emit can be partial and must never be frozen). Mid-chapter deck changes (saves, archives, deletes) do NOT rewrite it — new cards enter the block at the next chapter, and still reach the model mid-chapter as `flashcard_added` events (LIFE-CTX-2/8). Between chapters (`currentArc: null`) the previous snapshot is kept as-is. The snapshot lives on the world doc so it syncs across devices, survives resume, and rides the existing `LifeStepInput.world` with zero new prompt plumbing. A world whose snapshot write hasn't landed yet (first turn of a fresh world) renders `<flashcards/>` — absence is always tolerated. |
| **LIFE-EX-SRS-4** | Narrative re-exposure is an SI-only nudge: a few nodes after a word/phrase was tested (it appears in `<recentlyPracticed>`), NPC dialogue is encouraged to RE-USE it naturally — the player meets the word again as comprehensible input, not a quiz. No client mechanics, no counter, no schema field. |

### Design decisions (Phase G)

- **Why the snapshot is materialised on the world doc, not recomputed per turn:** "frozen per chapter" requires an as-of-chapter-start capture — recomputing from the live deck would shift the block's bytes on every mid-chapter save and defeat the LIFE-CTX-1 prefix cache, which is the whole point of freezing. The world doc is already in every prompt input, syncs across devices, and survives resume. This also matches the §19 explicit-cache plan ("the flashcard set is frozen for the chapter; new cards added mid-chapter wait for the next chapter").
- **Why id + phrase only:** 100 cards ≈ 1–2k tokens. Adding translations roughly doubles that for zero planner value — the graded generator (LIFE-EX-GEN-*) authors its own glosses, and the planner only needs to recognise the surface form in a scene.
- **Why the credit resolves against the LIVE deck, not the snapshot:** the resolve-guard exists solely to prevent `updateDoc` on a missing doc. A card saved mid-chapter (present live, absent from the frozen block) can still be tagged by the model via its `flashcard_added` event exposure — that review should still credit.
- **Why the planner picks the card (no selector call):** the plan's cost stance — the LLM already holds story + deck + `<recentlyPracticed>` in one context; a separate selection call would add latency and spend for a worse decision.
- **Why duplicates aren't deduped in the block:** two cards can share a phrase (different translations); each is its own SRS row, and the model tagging either id credits a real card. Deduping would silently orphan one card's schedule.
```

### S4 — `docs/specs/life-sim.md`: §18 test-table rows

ANCHOR (POST-PHASE-F — F's S7 inserted this row; verify unique):

```
| `src/screens/LifeScreen/useNodeEngine.test.tsx` | LIFE-NODE-1/2/3/4/5/6/8 client machine |
```

Insert **immediately after** that row:

```
| `src/lib/life/deckSnapshot.test.ts` | LIFE-EX-SRS-1/3 snapshot builder: filtering, due-first ordering, cap, staleness predicate |
| `src/lib/life/srsCredit.test.ts` | LIFE-EX-SRS-2 recordAttempt guard + SM-2 card-state passthrough |
| `src/screens/LifeScreen/useChapterDeck.test.tsx` | LIFE-EX-SRS-3 once-per-chapter write gate (cache-emit + arc + staleness gates) |
| `src/screens/LifeScreen/useNodeEngine.test.tsx` (Phase G additions) | LIFE-EX-SRS-2 flashcardId threading plan → feedback → outcome → credit |
| `tests/e2e/specs/life-flow.spec.ts` (Phase G additions) | LIFE-EX-SRS-1/2/3 — frozen deckSnapshot post-condition, correction event carries the card id, SM-2 fields land on the card doc |
```

### S5 — `docs/specs/README.md`: prefix-table row

ANCHOR (POST-PHASE-F — F's S8 left the `LIFE-*` row ending with this fragment; verify unique):

```
WIP / FAIL / NODE) |
```

Replace `WIP / FAIL / NODE) |` with:

```
WIP / FAIL / NODE / EX-SRS) |
```

### S6 — `docs/specs/README.md`: cross-spec interaction map row

ANCHOR (POST-PHASE-E — E's edit 3 rewrote this row; verify unique):

```
| Save-concept writes a flashcard | PRACTICE-SAVE-3 + LIFE-BUBBLE-7 | Practice, chat-side word save, AND life-bubble word save all use `addFlashCard`; dedupe + topic-classify behaviour is shared. |
```

Insert **directly under** that row (other phases may have added rows further below; that's fine):

```
| Wurlds graded answer credits a saved card's SRS state | LIFE-EX-SRS-2 + PRACTICE-SRS-1/2 + CARDS-ARCHIVE-2 | Same `recordAttempt` write practice mode uses (SM-2 schedule + counters + auto-archive streak). Wurlds passes the card's live SM-2 state and omits `reviewMode`/`nearMiss` (practice-mode concepts). |
```

## Ordered steps

Follow the repo workflow inside every step: tests are written and RUN (failing) before the implementation they assert.

- **Step 0 — Spec edits.** Apply S1–S6. Commit-gate: `git grep LIFE-EX-SRS-1` lands on `docs/specs/life-sim.md`.
- **Step 1 — World-doc field.** Apply E1 (`deckSnapshot` on `ZLifeWorld`). Run `npm run typecheck` — clean (the field is optional; nothing reads it yet).
- **Step 2 — Pure libs + tests.** Write `src/lib/life/deckSnapshot.test.ts` (T1) and `src/lib/life/srsCredit.test.ts` (T2) — both FAIL (modules missing). Create `src/lib/life/deckSnapshot.ts` (E2) and `src/lib/life/srsCredit.ts` (E3). Run `npx vitest run src/lib/life/deckSnapshot.test.ts src/lib/life/srsCredit.test.ts` → green.
- **Step 3 — Prompt.** Apply T3's additions to `src/lib/life/prompts/step.test.ts` (new suites FAIL — no deck block, no re-exposure line yet). Apply E4-a…E4-d to `src/lib/life/prompts/step.ts`. Run `npx vitest run src/lib/life/prompts/step.test.ts` → green.
- **Step 4 — Outcome/event threading.** Apply T4 (commitNode test append) + T5 (mergeLocalEvents test append) — new tests FAIL (`flashcardId` not accepted / not mirrored). Apply E5 (`PracticeOutcome.flashcardId`), E6 (`commitNode` correction payload), E7 (`localCorrectionEvent`). Run `npx vitest run src/lib/life/commitNode.test.ts src/lib/life/mergeLocalEvents.test.ts src/lib/life/generateStepOptions.test.ts` → green (the generateStepOptions suite needs no edits — the new field is optional).
- **Step 5 — Engine threading + credit.** Apply T6's edits to `src/screens/LifeScreen/useNodeEngine.test.tsx` (the new test FAILS: `flashcards` prop unknown, `feedback.flashcardId` undefined, `creditSrsAttempt` never called). Apply E8 (`nodeEngineTypes.ts`) and E9 (`nodeEngineActions.ts`). Run `npx vitest run src/screens/LifeScreen/useNodeEngine.test.tsx` → green.
- **Step 6 — Screen wiring.** Write `src/screens/LifeScreen/useChapterDeck.test.tsx` (T7 — FAILS, module missing). Create `src/screens/LifeScreen/useChapterDeck.ts` (E10), apply E11 (LifeScreen: import + hook + engine prop). Run `npx vitest run src/screens/LifeScreen/useChapterDeck.test.tsx` then `npm test`, `npm run typecheck`, `npx eslint src/` → all clean.
- **Step 7 — E2E.** Apply T8 (fixtures + one new test appended to `tests/e2e/specs/life-flow.spec.ts`). Run the spec (see Verify), then read every captured screenshot.

## Edits

Conventions for every edit: anchors are verbatim; check uniqueness with `grep -F -c '<snippet>' <file>` (must print `1`) before applying. NEW files are complete — paste as-is.

### E1 — `src/types/firestore.ts`: `deckSnapshot` on `ZLifeWorld`

ANCHOR (POST-PHASE-C — this block is Phase C's E1 output inside `ZLifeWorld`; verify unique):

```ts
  resumeRecap: z
    .object({
      text: z.string(),
      lastEventId: z.string(),
      generatedAt: ZTimestamp.optional(),
    })
    .nullable()
    .optional(),
```

Insert IMMEDIATELY AFTER that block (before `createdAt: ZTimestamp.optional(),`):

```ts
  /** LIFE-EX-SRS-1/3 (wurlds-v2 Phase G): chapter-start snapshot of
   *  the unarchived, practice-language deck, rendered into every
   *  life_step prompt as the <flashcards> block. Written ONCE per
   *  chapter by useChapterDeck (client) from a server-confirmed deck
   *  read; FROZEN until currentArc.chapterNumber changes — cards
   *  saved mid-chapter wait for the next chapter (they still reach
   *  the model as flashcard_added events). Due-first order, capped
   *  at 100 (DECK_SNAPSHOT_CAP). Absent/null = never snapshotted
   *  (prompt renders <flashcards/>). */
  deckSnapshot: z
    .object({
      chapterNumber: z.number(),
      cards: z.array(z.object({ id: z.string(), phrase: z.string() })),
      takenAt: ZTimestamp.optional(),
    })
    .nullable()
    .optional(),
```

### E2 — NEW FILE `src/lib/life/deckSnapshot.ts` (complete)

```ts
/**
 * LIFE-EX-SRS-1/3: the chapter-frozen flashcard-deck snapshot.
 *
 * Pure module — no React, no Firestore. `useChapterDeck` (the
 * screen-side hook) decides WHEN to write; this module decides WHAT
 * the snapshot contains and WHETHER the stored one is stale.
 *
 * Contents rule (LIFE-EX-SRS-1):
 *   - unarchived cards only (cardStatus !== 'archived');
 *   - practice-language match (cards with no language pass — legacy
 *     stubs predate the field, same tolerance useFlashcardLookup has);
 *   - non-empty phrase (via cardSides, which absorbs legacy
 *     front/back keys);
 *   - DUE cards first (nextReviewAt <= now; a card with NO
 *     nextReviewAt has never been scheduled and counts as due),
 *     then not-yet-due;
 *   - within each group, cardPriorityScore DESCENDING (the same
 *     SRS-aware ordering the practice session builder uses). The
 *     sort is stable, so ties keep the deck's createdAt-desc query
 *     order;
 *   - capped at DECK_SNAPSHOT_CAP (100 cards ≈ 1-2k prompt tokens).
 *
 * Duplicate phrases are deliberately NOT deduped: two cards can
 * share a phrase, each is its own SRS row, and either id credits a
 * real card.
 *
 * Spec: docs/specs/life-sim.md §10.47.
 */
import { cardPriorityScore } from '@/lib/sessionBuilder/internal';
import { cardSides, type FlashCard, type LifeWorld } from '@/types/firestore';

export const DECK_SNAPSHOT_CAP = 100;

export type DeckSnapshotCard = { id: string; phrase: string };

/** LIFE-EX-SRS-3: a snapshot is (re)taken only when a chapter is
 *  active AND the stored snapshot is missing or belongs to a
 *  different chapter. Between chapters (currentArc null) the old
 *  snapshot is kept — never stale. */
export function deckSnapshotIsStale(world: LifeWorld): boolean {
  const arc = world.currentArc;
  if (!arc) return false;
  return (
    world.deckSnapshot == null ||
    world.deckSnapshot.chapterNumber !== arc.chapterNumber
  );
}

export function buildDeckSnapshotCards(
  cards: ReadonlyArray<FlashCard>,
  practiceLanguage: string,
  nowMs: number,
): DeckSnapshotCard[] {
  const eligible = cards.filter((c) => {
    if (c.cardStatus === 'archived') return false;
    const lang = c.practiceLanguage ?? c.language;
    if (lang && lang !== practiceLanguage) return false;
    return cardSides(c).phrase.trim().length > 0;
  });
  const isDue = (c: FlashCard): boolean => {
    const next = c.nextReviewAt?.toMillis();
    return next == null || next <= nowMs;
  };
  const score = new Map<string, number>();
  for (const c of eligible) score.set(c.id, cardPriorityScore(c, nowMs));
  const sorted = [...eligible].sort((a, b) => {
    const dueDelta = Number(isDue(b)) - Number(isDue(a));
    if (dueDelta !== 0) return dueDelta;
    return (score.get(b.id) ?? 0) - (score.get(a.id) ?? 0);
  });
  return sorted.slice(0, DECK_SNAPSHOT_CAP).map((c) => ({
    id: c.id,
    phrase: cardSides(c).phrase.trim(),
  }));
}
```

### E3 — NEW FILE `src/lib/life/srsCredit.ts` (complete)

```ts
/**
 * LIFE-EX-SRS-2: SM-2 credit for a card-backed wurld question.
 *
 * Called from the node engine's feedbackContinue path when the
 * resolved gradedPlan carried a flashcardId. Reuses the EXACT write
 * practice mode uses (recordAttempt: correct/incorrect counters +
 * SM-2 schedule + the CARDS-ARCHIVE-2 auto-archive streak), passing
 * the card's live SM-2 state so the schedule progresses instead of
 * resetting to fresh defaults.
 *
 * Guard: the id must resolve against the LIVE loaded deck — a model
 * hallucination or a just-deleted card must not reach updateDoc
 * (which throws on missing docs). Unresolved ids log a warn and
 * write nothing.
 *
 * Fire-and-forget by design: the narrative never waits on, nor
 * fails with, the SRS write.
 *
 * reviewMode / nearMiss are practice-mode concepts — deliberately
 * left at their defaults here.
 *
 * Spec: docs/specs/life-sim.md §10.47 (LIFE-EX-SRS-2).
 */
import { recordAttempt } from '@/lib/flashcards';
import * as log from '@/lib/log';
import type { FlashCard } from '@/types/firestore';

export function creditSrsAttempt(args: {
  uid: string;
  flashcardId: string | null | undefined;
  correct: boolean;
  cards: ReadonlyArray<FlashCard>;
}): void {
  const { uid, flashcardId, correct, cards } = args;
  if (!flashcardId) return;
  const card = cards.find((c) => c.id === flashcardId);
  if (!card) {
    log.warn('life.srs.unknown-card', { cardId: flashcardId });
    return;
  }
  void recordAttempt({
    uid,
    cardId: flashcardId,
    correct,
    card: {
      interval: card.interval,
      ease: card.ease,
      reps: card.reps,
      lapses: card.lapses,
      consecutiveCorrectDays: card.consecutiveCorrectDays,
      lastReviewedAt: card.lastReviewedAt,
    },
  }).catch((err: unknown) =>
    log.warn('life.srs.credit-failed', {
      cardId: flashcardId,
      err: String(err),
    }),
  );
}
```

### E4 — `src/lib/life/prompts/step.ts`: deck block + SI updates (four edits)

**E4-a — the `<flashcards>` block in the prompt body.** ANCHOR (verify unique — present in the current file; Phases A–F do not touch section (4)):

```ts
  // (4) Scene index — populated by scene cache in Phase C.
  sections.push(`<sceneIndex/>`);
```

Replace those two lines with:

```ts
  // (4) Scene index — populated by scene cache in Phase C.
  sections.push(`<sceneIndex/>`);

  // (4.2) LIFE-EX-SRS-1: the chapter-frozen flashcard deck. Rendered
  //       from world.deckSnapshot (written once per chapter by
  //       useChapterDeck) — NEVER from the live deck, so the block's
  //       bytes are stable across every turn of a chapter and the
  //       Gemini prefix cache keeps hitting (LIFE-CTX-1). Order is
  //       the snapshot's stored order: due cards first.
  const deck = input.world.deckSnapshot;
  if (deck && deck.cards.length > 0) {
    const rows = deck.cards
      .map(
        (c) => `  <card id="${escapeAttr(c.id)}">${escapeText(c.phrase)}</card>`,
      )
      .join('\n');
    sections.push(`<flashcards>\n${rows}\n</flashcards>`);
  } else {
    sections.push(`<flashcards/>`);
  }
```

**E4-b — SI: point `flashcardId` at the deck block.** ANCHOR (POST-PHASE-F — this is F4-b's FLASHCARDS line inside `lifeStepSystemInstruction`; verify unique):

```ts
    `  - FLASHCARDS: when testTarget matches a phrase the player has saved (see flashcard_added events), tag flashcardId so the SRS layer credits the review. PREFER testing saved cards when the moment naturally allows it.`,
```

Replace that single array element with:

```ts
    `  - FLASHCARDS (LIFE-EX-SRS-1/2): the <flashcards> block is the player's saved deck — a chapter-start snapshot; cards nearer the TOP are due for SRS review. When testTarget IS one of those cards' phrases, copy that card's id into flashcardId so the SRS layer credits the review. This applies to comprehension plans too, when the npcUtterance centres on a saved card's phrase. PREFER testing a due saved card when the moment naturally allows it. NEVER force a card that does not fit the scene — the story comes first.`,
```

**E4-c — SI: VOCABULARY RULES describe the snapshot + add the re-exposure nudge.** ANCHOR (POST-PHASE-F — F4-b's first VOCABULARY RULES bullet; verify unique):

```ts
    `- The player has a personal flashcard deck — recent flashcards appear in the events log as \`flashcard_added\` entries. WEAVE these words into beats + options naturally when the situation supports it. Do NOT contrive a scene just to use them; the story comes first.`,
```

Replace that single array element with these two elements:

```ts
    `- The player has a personal flashcard deck. The <flashcards> block is a chapter-start snapshot of it (card id + practice phrase, due-first); cards saved mid-chapter appear only as \`flashcard_added\` entries in the events log. WEAVE these words into beats + options naturally when the situation supports it. Do NOT contrive a scene just to use them; the story comes first.`,
    `- RE-EXPOSURE (LIFE-EX-SRS-4): a few nodes after a word or phrase was tested (it appears in <recentlyPracticed>), have an NPC naturally RE-USE it in dialogue — the player meets it again as comprehensible input, not a quiz. One organic reuse is enough; never make it feel like a drill.`,
```

**E4-d — SI: OUTPUT SCHEMA comment for `flashcardId`.** ANCHOR (POST-PHASE-F — F4-b's fill-blank schema line; verify unique — the comprehension `flashcardId` line has no trailing comment and is NOT this anchor):

```ts
    `      "flashcardId": "card-id" | null,       // optional, when target matches a saved card`,
```

Replace that single array element with:

```ts
    `      "flashcardId": "card-id" | null,       // id copied from the <flashcards> block when testTarget is a saved card`,
```

### E5 — `src/lib/life/generateStepOptions.ts`: `PracticeOutcome.flashcardId`

ANCHOR (POST-PHASE-F — F3-b created this file; verify unique):

```ts
export type PracticeOutcome = {
  kind: 'fill-blank' | 'comprehension';
  correct: boolean;
  picked: string;
  correctAnswer: string;
  promptSource: string;
};
```

Replace with:

```ts
export type PracticeOutcome = {
  kind: 'fill-blank' | 'comprehension';
  correct: boolean;
  picked: string;
  correctAnswer: string;
  promptSource: string;
  /** LIFE-EX-SRS-2: the saved card the resolved gradedPlan tested,
   *  when it carried one. Threads into the correction event payload;
   *  the SRS credit itself fires screen-side (creditSrsAttempt). */
  flashcardId?: string | null;
};
```

No other change in this file — the prompt renderer only reads `picked`/`correctAnswer`/`promptSource`, and `PracticeOutcomeForPrompt` (prompts/step.ts) accepts the extra optional field structurally.

### E6 — `src/lib/life/commitNode.ts`: correction payload carries the card id

ANCHOR (POST-PHASE-F — F2-a created this file; verify unique):

```ts
      payload: {
        kind: o.kind,
        correct: o.correct,
        picked: o.picked,
        correctAnswer: o.correctAnswer,
        promptSource: o.promptSource,
      },
```

Replace with:

```ts
      payload: {
        kind: o.kind,
        correct: o.correct,
        picked: o.picked,
        correctAnswer: o.correctAnswer,
        promptSource: o.promptSource,
        // LIFE-EX-SRS-2: key omitted entirely when there is no card —
        // event payloads stay clean for the wurld-mistakes backlog
        // consumer, and Firestore stores no null noise.
        ...(o.flashcardId ? { flashcardId: o.flashcardId } : {}),
      },
```

### E7 — `src/lib/life/mergeLocalEvents.ts`: overlay mirror carries the card id

ANCHOR (POST-PHASE-F — F3-a created this file; verify unique):

```ts
    payload: {
      kind: o.kind,
      correct: o.correct,
      picked: o.picked,
      correctAnswer: o.correctAnswer,
      promptSource: o.promptSource,
    },
```

Replace with:

```ts
    payload: {
      kind: o.kind,
      correct: o.correct,
      picked: o.picked,
      correctAnswer: o.correctAnswer,
      promptSource: o.promptSource,
      // LIFE-EX-SRS-2: mirror what commitNode writes so the overlay
      // fingerprint-matches the listener's delivered event.
      ...(o.flashcardId ? { flashcardId: o.flashcardId } : {}),
    },
```

### E8 — `src/screens/LifeScreen/nodeEngineTypes.ts`: FeedbackState + engine props (three edits)

**E8-a — import `FlashCard`.** ANCHOR (POST-PHASE-F — F6-b1's firestore type import; verify unique in THIS file):

```ts
import type {
  LifeCampaign,
  LifeEvent,
  LifeNpc,
  LifeWorld,
} from '@/types/firestore';
```

Replace with:

```ts
import type {
  FlashCard,
  LifeCampaign,
  LifeEvent,
  LifeNpc,
  LifeWorld,
} from '@/types/firestore';
```

**E8-b — `FeedbackState.flashcardId`.** ANCHOR (POST-PHASE-F — the tail of the `FeedbackState` type; verify unique):

```ts
  speakerName?: string | null;
  npcId?: string | null;
};
```

Replace with:

```ts
  speakerName?: string | null;
  npcId?: string | null;
  /** LIFE-EX-SRS-2: the saved card the resolved gradedPlan tested
   *  (copied from activePlanRef at graded-chip pick). Null when the
   *  question was not card-backed. */
  flashcardId?: string | null;
};
```

**E8-c — `UseNodeEngineProps.flashcards`.** ANCHOR (POST-PHASE-F; verify unique):

```ts
  /** Pre-scoped by LifeScreen (world ∪ active campaign, transients
   *  dropped — LIFE-CAMPAIGN-8 / LIFE-NPC-RECUR-4). */
  npcs: ReadonlyArray<LifeNpc>;
```

Replace with:

```ts
  /** Pre-scoped by LifeScreen (world ∪ active campaign, transients
   *  dropped — LIFE-CAMPAIGN-8 / LIFE-NPC-RECUR-4). */
  npcs: ReadonlyArray<LifeNpc>;
  /** LIFE-EX-SRS-2: the user's LIVE flashcard deck (useChapterDeck's
   *  cards). Read at feedback-Continue to resolve gradedPlan
   *  .flashcardId and pass the card's SM-2 state to recordAttempt. */
  flashcards: ReadonlyArray<FlashCard>;
```

### E9 — `src/screens/LifeScreen/nodeEngineActions.ts`: thread + credit (four edits)

**E9-a — import.** ANCHOR (POST-PHASE-F — F6-b2's mergeLocalEvents import block; verify unique):

```ts
import {
  localBeatEvent,
  localCorrectionEvent,
  localDecisionEvent,
  mergeLocalEvents,
} from '@/lib/life/mergeLocalEvents';
```

Replace with:

```ts
import {
  localBeatEvent,
  localCorrectionEvent,
  localDecisionEvent,
  mergeLocalEvents,
} from '@/lib/life/mergeLocalEvents';
import { creditSrsAttempt } from '@/lib/life/srsCredit';
```

**E9-b — `gradePick`: copy the plan's card id into FeedbackState.** ANCHOR (POST-PHASE-F — the tail of the `FeedbackState` literal in `gradePick`; verify unique):

```ts
      speakerName:
        plan?.kind === 'comprehension' ? plan.speakerName ?? null : null,
      npcId: plan?.kind === 'comprehension' ? plan.npcId ?? null : null,
    };
```

Replace with:

```ts
      speakerName:
        plan?.kind === 'comprehension' ? plan.speakerName ?? null : null,
      npcId: plan?.kind === 'comprehension' ? plan.npcId ?? null : null,
      // LIFE-EX-SRS-2: both plan kinds may carry a saved-card id.
      flashcardId: plan?.flashcardId ?? null,
    };
```

**E9-c — `gradePick`: the prefetch outcome carries the id.** ANCHOR (POST-PHASE-F — the `PracticeOutcome` literal inside `gradePick`; verify unique — the `feedbackContinue` version reads `fb.*`, not `feedback.*`):

```ts
      const outcome: PracticeOutcome = {
        kind: feedback.outcomeKind,
        correct: feedback.correct,
        picked: choice.practiceText,
        correctAnswer: correctChip.practiceText,
        promptSource,
      };
```

Replace with:

```ts
      const outcome: PracticeOutcome = {
        kind: feedback.outcomeKind,
        correct: feedback.correct,
        picked: choice.practiceText,
        correctAnswer: correctChip.practiceText,
        promptSource,
        flashcardId: feedback.flashcardId ?? null,
      };
```

**E9-d — `feedbackContinue`: outcome carries the id + the credit fires.** ANCHOR (POST-PHASE-F — the `PracticeOutcome` literal inside `feedbackContinue`; verify unique):

```ts
    const outcome: PracticeOutcome = {
      kind: fb.outcomeKind,
      correct: fb.correct,
      picked: fb.picked.practiceText,
      correctAnswer: fb.correctAnswer.practiceText,
      promptSource: fb.promptSource,
    };
```

Replace with:

```ts
    const outcome: PracticeOutcome = {
      kind: fb.outcomeKind,
      correct: fb.correct,
      picked: fb.picked.practiceText,
      correctAnswer: fb.correctAnswer.practiceText,
      promptSource: fb.promptSource,
      flashcardId: fb.flashcardId ?? null,
    };
    // LIFE-EX-SRS-2: SM-2 credit for a card-backed question. Fire-
    // and-forget with its own resolve-guard — never blocks the
    // narrative, never throws.
    creditSrsAttempt({
      uid: p.uid,
      flashcardId: fb.flashcardId ?? null,
      correct: fb.correct,
      cards: p.flashcards,
    });
```

### E10 — NEW FILE `src/screens/LifeScreen/useChapterDeck.ts` (complete)

```ts
/**
 * LIFE-EX-SRS-1/3: the chapter's flashcard deck — the LIVE cards
 * (fed to the node engine for SRS credit) plus the once-per-chapter
 * deckSnapshot write that freezes the <flashcards> prompt block.
 *
 * Write gates, in order (LIFE-EX-SRS-3):
 *   1. uid + world + an ACTIVE chapter (world.currentArc) present —
 *      between chapters the old snapshot is kept as-is;
 *   2. the deck listener is server-confirmed (loading === false AND
 *      fromCache === false) — a Firestore cache emit can be PARTIAL
 *      and must never be frozen into a chapter;
 *   3. the stored snapshot is stale (missing, or a different
 *      chapterNumber);
 *   4. this hook instance hasn't already written for this
 *      world+chapter (ref guard — the listener echo makes the
 *      staleness check false, but the guard also covers the write's
 *      in-flight window).
 *
 * Failure is tolerated: the write is retried on the next data change
 * (ref cleared), and the prompt renders <flashcards/> until a
 * snapshot exists.
 *
 * Spec: docs/specs/life-sim.md §10.47.
 */
import { useEffect, useRef } from 'react';
import { Timestamp } from 'firebase/firestore';
import { useFlashcards } from '@/hooks/useFlashcards';
import {
  buildDeckSnapshotCards,
  deckSnapshotIsStale,
} from '@/lib/life/deckSnapshot';
import { updateLifeWorld } from '@/lib/life/world';
import * as log from '@/lib/log';
import type { FlashCard, LifeWorld } from '@/types/firestore';

const EMPTY_CARDS: ReadonlyArray<FlashCard> = [];

export function useChapterDeck(
  uid: string | null,
  world: LifeWorld | null,
): { cards: ReadonlyArray<FlashCard> } {
  const flashcards = useFlashcards(uid);
  const cards = flashcards.data ?? EMPTY_CARDS;
  const unconfirmed = flashcards.loading || flashcards.fromCache;
  const writtenKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!uid || !world) return;
    const arc = world.currentArc;
    if (!arc) return;
    if (unconfirmed) return;
    if (!deckSnapshotIsStale(world)) return;
    const key = `${world.id}:${arc.chapterNumber}`;
    if (writtenKeyRef.current === key) return;
    writtenKeyRef.current = key;
    void updateLifeWorld(uid, world.id, {
      deckSnapshot: {
        chapterNumber: arc.chapterNumber,
        cards: buildDeckSnapshotCards(cards, world.practiceLanguage, Date.now()),
        takenAt: Timestamp.fromMillis(Date.now()),
      },
    }).catch((err: unknown) => {
      writtenKeyRef.current = null;
      log.warn('life.deck.snapshot-write-failed', { err: String(err) });
    });
  }, [uid, world, unconfirmed, cards]);

  return { cards };
}
```

### E11 — `src/screens/LifeScreen/LifeScreen.tsx`: wire the deck (three edits)

**E11-a — import.** ANCHOR (POST-PHASE-E — E11's replacement import pair; verify unique):

```ts
import { useFlashcardLookup } from './useFlashcardLookup';
import { useLifeWordSave } from './useLifeWordSave';
```

Replace with:

```ts
import { useChapterDeck } from './useChapterDeck';
import { useFlashcardLookup } from './useFlashcardLookup';
import { useLifeWordSave } from './useLifeWordSave';
```

**E11-b — mount the hook.** ANCHOR (POST-PHASE-E — E12's replacement pair; verify unique):

```ts
  // LIFE-EX-VOCAB-1 + LIFE-BUBBLE-7: deck lookup (extracted hook).
  const flashcardLookup = useFlashcardLookup(user?.uid ?? null, world.data ?? null);
```

Replace with:

```ts
  // LIFE-EX-VOCAB-1 + LIFE-BUBBLE-7: deck lookup (extracted hook).
  const flashcardLookup = useFlashcardLookup(user?.uid ?? null, world.data ?? null);
  // LIFE-EX-SRS-1/3: live deck for SRS credit + the once-per-chapter
  // deckSnapshot write that freezes the <flashcards> prompt block.
  const chapterDeck = useChapterDeck(user?.uid ?? null, world.data ?? null);
```

**E11-c — pass the deck to the engine.** ANCHOR (POST-PHASE-F — inside F6-e E5's `useNodeEngine` call; verify unique — the `useChapterCompletion` call also contains `campaign: campaign.data ?? null,` but is not followed by `npcs: scopedNpcs,`):

```ts
    campaign: campaign.data ?? null,
    npcs: scopedNpcs,
    appendBubbles,
```

Replace with:

```ts
    campaign: campaign.data ?? null,
    npcs: scopedNpcs,
    flashcards: chapterDeck.cards,
    appendBubbles,
```

(`useChapterDeck` internally calls `useFlashcards(uid)` — the same query `useFlashcardLookup` subscribes to; the Firestore SDK shares one underlying watch stream for identical queries, so this costs no extra reads. Do NOT try to "optimise" by merging the two hooks — they have different consumers and `useFlashcardLookup` is Phase E's pinned API.)

## Tests

Every new `it(...)` starts with its invariant id. Write each test file/edit BEFORE the implementation step it gates (see Ordered steps), run it, and confirm it FAILS for the expected reason.

### T1 — NEW FILE `src/lib/life/deckSnapshot.test.ts` (complete)

```ts
import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import {
  DECK_SNAPSHOT_CAP,
  buildDeckSnapshotCards,
  deckSnapshotIsStale,
} from './deckSnapshot';
import type { FlashCard, LifeWorld } from '@/types/firestore';

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);
const DAY = 24 * 60 * 60 * 1000;

function makeCard(overrides: Partial<FlashCard> & { id: string }): FlashCard {
  return {
    phrase: `phrase-${overrides.id}`,
    translation: `translation-${overrides.id}`,
    practiceLanguage: 'French',
    ...overrides,
  };
}

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const arc = {
  chapterNumber: 2,
  premise: 'Settle in.',
  themes: [],
  status: 'active' as const,
  recurringNpcIds: [],
  completedCampaignMemories: [],
};

describe('buildDeckSnapshotCards — LIFE-EX-SRS-1', () => {
  it('LIFE-EX-SRS-1 — excludes archived, other-language and empty-phrase cards; keeps language-less + legacy-front cards', () => {
    const out = buildDeckSnapshotCards(
      [
        makeCard({ id: 'keep' }),
        makeCard({ id: 'archived', cardStatus: 'archived' }),
        makeCard({ id: 'spanish', practiceLanguage: 'Spanish' }),
        makeCard({ id: 'blank', phrase: '   ' }),
        // Legacy stubs: language under `language`, phrase under `front`.
        makeCard({
          id: 'legacy',
          phrase: undefined,
          practiceLanguage: undefined,
          language: 'French',
          front: 'quand même',
        }),
        makeCard({ id: 'no-lang', practiceLanguage: undefined }),
      ],
      'French',
      NOW,
    );
    expect(out.map((c) => c.id).sort()).toEqual(['keep', 'legacy', 'no-lang']);
    expect(out.find((c) => c.id === 'legacy')?.phrase).toBe('quand même');
  });

  it('LIFE-EX-SRS-1 — due cards (past nextReviewAt OR never scheduled) come before not-yet-due cards', () => {
    const out = buildDeckSnapshotCards(
      [
        makeCard({
          id: 'later',
          nextReviewAt: Timestamp.fromMillis(NOW + 7 * DAY),
        }),
        makeCard({
          id: 'due',
          nextReviewAt: Timestamp.fromMillis(NOW - DAY),
        }),
        makeCard({ id: 'never-scheduled' }),
      ],
      'French',
      NOW,
    );
    const ids = out.map((c) => c.id);
    expect(ids.indexOf('due')).toBeLessThan(ids.indexOf('later'));
    expect(ids.indexOf('never-scheduled')).toBeLessThan(ids.indexOf('later'));
  });

  it('LIFE-EX-SRS-1 — within a due group, cardPriorityScore orders weak cards first', () => {
    // Same schedule + same lastReviewedAt; only accuracy differs.
    // cardPriorityScore weights (1 - accuracy) — the wrong-heavy card
    // must outrank the correct-heavy one.
    const common = {
      nextReviewAt: Timestamp.fromMillis(NOW - DAY),
      lastReviewedAt: Timestamp.fromMillis(NOW - 2 * DAY),
    };
    const out = buildDeckSnapshotCards(
      [
        makeCard({ id: 'strong', correctCount: 5, incorrectCount: 0, ...common }),
        makeCard({ id: 'weak', correctCount: 0, incorrectCount: 5, ...common }),
      ],
      'French',
      NOW,
    );
    expect(out.map((c) => c.id)).toEqual(['weak', 'strong']);
  });

  it('LIFE-EX-SRS-1 — caps at DECK_SNAPSHOT_CAP and emits id + trimmed phrase only', () => {
    const many = Array.from({ length: DECK_SNAPSHOT_CAP + 20 }, (_, i) =>
      makeCard({ id: `c${i}`, phrase: `  mot ${i}  ` }),
    );
    const out = buildDeckSnapshotCards(many, 'French', NOW);
    expect(out).toHaveLength(DECK_SNAPSHOT_CAP);
    expect(out[0]).toEqual({ id: expect.any(String), phrase: expect.any(String) });
    expect(out.every((c) => c.phrase === c.phrase.trim())).toBe(true);
  });
});

describe('deckSnapshotIsStale — LIFE-EX-SRS-3', () => {
  it('LIFE-EX-SRS-3 — never stale without an active chapter', () => {
    expect(deckSnapshotIsStale(baseWorld)).toBe(false);
    expect(
      deckSnapshotIsStale({ ...baseWorld, currentArc: null, deckSnapshot: null }),
    ).toBe(false);
  });

  it('LIFE-EX-SRS-3 — stale when the snapshot is missing or from another chapter; fresh when it matches', () => {
    const withArc: LifeWorld = { ...baseWorld, currentArc: arc };
    expect(deckSnapshotIsStale(withArc)).toBe(true);
    expect(
      deckSnapshotIsStale({
        ...withArc,
        deckSnapshot: { chapterNumber: 1, cards: [] },
      }),
    ).toBe(true);
    expect(
      deckSnapshotIsStale({
        ...withArc,
        deckSnapshot: { chapterNumber: 2, cards: [] },
      }),
    ).toBe(false);
  });
});
```

### T2 — NEW FILE `src/lib/life/srsCredit.test.ts` (complete)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/flashcards', () => ({
  recordAttempt: vi.fn(async () => undefined),
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { Timestamp } from 'firebase/firestore';
import { recordAttempt } from '@/lib/flashcards';
import * as log from '@/lib/log';
import { creditSrsAttempt } from './srsCredit';
import type { FlashCard } from '@/types/firestore';

const recordAttemptMock = vi.mocked(recordAttempt);
const warnMock = vi.mocked(log.warn);

const card: FlashCard = {
  id: 'card-1',
  phrase: 'quand même',
  translation: 'anyway',
  practiceLanguage: 'French',
  interval: 2,
  ease: 2.6,
  reps: 3,
  lapses: 1,
  consecutiveCorrectDays: 2,
  lastReviewedAt: Timestamp.fromMillis(1_700_000_000_000),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('creditSrsAttempt — LIFE-EX-SRS-2', () => {
  it('LIFE-EX-SRS-2 — resolves the card and passes its FULL SM-2 state through to recordAttempt', () => {
    creditSrsAttempt({
      uid: 'u1',
      flashcardId: 'card-1',
      correct: true,
      cards: [card],
    });
    expect(recordAttemptMock).toHaveBeenCalledTimes(1);
    expect(recordAttemptMock).toHaveBeenCalledWith({
      uid: 'u1',
      cardId: 'card-1',
      correct: true,
      card: {
        interval: 2,
        ease: 2.6,
        reps: 3,
        lapses: 1,
        consecutiveCorrectDays: 2,
        lastReviewedAt: card.lastReviewedAt,
      },
    });
  });

  it('LIFE-EX-SRS-2 — no card id → no write, no warn', () => {
    creditSrsAttempt({ uid: 'u1', flashcardId: null, correct: true, cards: [card] });
    creditSrsAttempt({ uid: 'u1', flashcardId: undefined, correct: false, cards: [card] });
    expect(recordAttemptMock).not.toHaveBeenCalled();
    expect(warnMock).not.toHaveBeenCalled();
  });

  it('LIFE-EX-SRS-2 — an id that does not resolve against the deck writes NOTHING and warns', () => {
    creditSrsAttempt({
      uid: 'u1',
      flashcardId: 'hallucinated',
      correct: true,
      cards: [card],
    });
    expect(recordAttemptMock).not.toHaveBeenCalled();
    expect(warnMock).toHaveBeenCalledWith('life.srs.unknown-card', {
      cardId: 'hallucinated',
    });
  });

  it('LIFE-EX-SRS-2 — a rejected write is swallowed and logged (never throws)', async () => {
    recordAttemptMock.mockRejectedValueOnce(new Error('offline'));
    expect(() =>
      creditSrsAttempt({
        uid: 'u1',
        flashcardId: 'card-1',
        correct: false,
        cards: [card],
      }),
    ).not.toThrow();
    await vi.waitFor(() =>
      expect(warnMock).toHaveBeenCalledWith('life.srs.credit-failed', {
        cardId: 'card-1',
        err: 'Error: offline',
      }),
    );
  });
});
```

### T3 — `src/lib/life/prompts/step.test.ts`: append two suites

ANCHOR (POST-PHASE-F — the closing of T6's final SI describe; verify unique):

```ts
  it('LIFE-NODE-7 — states the question + continuation cadences', () => {
    expect(si()).toContain('1 node in 5');
    expect(si()).toContain('1 node in 4');
  });
});
```

Replace with:

```ts
  it('LIFE-NODE-7 — states the question + continuation cadences', () => {
    expect(si()).toContain('1 node in 5');
    expect(si()).toContain('1 node in 4');
  });

  it('LIFE-EX-SRS-2 — planner SI points flashcardId at the <flashcards> block, due-first', () => {
    expect(si()).toContain('<flashcards>');
    expect(si()).toContain('due for SRS review');
    expect(si()).toContain('NEVER force a card that does not fit the scene');
  });

  it('LIFE-EX-SRS-4 — carries the narrative re-exposure nudge', () => {
    expect(si()).toContain('RE-EXPOSURE');
    expect(si()).toContain('comprehensible input, not a quiz');
  });
});

describe('buildLifeStepPrompt — flashcard deck block (LIFE-EX-SRS-1/3)', () => {
  const worldWithDeck: LifeWorld = {
    ...baseWorld,
    deckSnapshot: {
      chapterNumber: 1,
      cards: [
        { id: 'c-due', phrase: 'quand même' },
        { id: 'c-later', phrase: 'vers' },
      ],
    },
  };

  it('LIFE-EX-SRS-1 — renders <card id + phrase> rows between <sceneIndex> and <campaign>', () => {
    const out = buildLifeStepPrompt({
      world: worldWithDeck,
      events: [],
      isOpeningBeat: true,
    });
    expect(out).toContain('<card id="c-due">quand même</card>');
    expect(out).toContain('<card id="c-later">vers</card>');
    const sceneIdx = out.indexOf('<sceneIndex');
    const deckIdx = out.indexOf('<flashcards>');
    const campaignIdx = out.indexOf('<campaign');
    expect(sceneIdx).toBeGreaterThan(-1);
    expect(deckIdx).toBeGreaterThan(sceneIdx);
    expect(campaignIdx).toBeGreaterThan(deckIdx);
  });

  it('LIFE-EX-SRS-3 — renders the SNAPSHOT order verbatim (frozen; never re-sorted at prompt time)', () => {
    const out = buildLifeStepPrompt({
      world: worldWithDeck,
      events: [],
      isOpeningBeat: true,
    });
    expect(out.indexOf('c-due')).toBeLessThan(out.indexOf('c-later'));
  });

  it('LIFE-EX-SRS-1 — no snapshot (or empty) renders the self-closing <flashcards/>', () => {
    const none = buildLifeStepPrompt({
      world: baseWorld,
      events: [],
      isOpeningBeat: true,
    });
    expect(none).toContain('<flashcards/>');
    expect(none).not.toContain('<flashcards>\n');
    const empty = buildLifeStepPrompt({
      world: { ...baseWorld, deckSnapshot: { chapterNumber: 1, cards: [] } },
      events: [],
      isOpeningBeat: true,
    });
    expect(empty).toContain('<flashcards/>');
  });
});
```

(`baseWorld`, `fakeEvent`, `buildLifeStepPrompt`, `lifeStepSystemInstruction`, and the `LifeWorld` type import all already exist in this file — do not re-declare or re-import anything.)

### T4 — `src/lib/life/commitNode.test.ts`: append one test

ANCHOR (POST-PHASE-F — the closing of T3's practice-outcome test; verify unique):

```ts
        payload: expect.objectContaining({
          kind: 'fill-blank',
          correct: true,
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café.',
        }),
      }),
    );
  });
```

Replace with:

```ts
        payload: expect.objectContaining({
          kind: 'fill-blank',
          correct: true,
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café.',
        }),
      }),
    );
  });

  it('LIFE-EX-SRS-2 — the correction payload carries flashcardId when present and OMITS the key when null', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: {
        kind: 'practice-outcome',
        outcome: {
          kind: 'fill-blank',
          correct: false,
          picked: 'pourtant',
          correctAnswer: 'quand même',
          promptSource: 'Je viens ___ au marché.',
          flashcardId: 'card-1',
        },
      },
      beats: [],
      sceneIntent: null,
    });
    expect(appendLifeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'correction',
        payload: expect.objectContaining({ flashcardId: 'card-1', correct: false }),
      }),
    );
    appendLifeEventMock.mockClear();
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: {
        kind: 'practice-outcome',
        outcome: {
          kind: 'comprehension',
          correct: true,
          picked: 'x',
          correctAnswer: 'y',
          promptSource: 'z',
          flashcardId: null,
        },
      },
      beats: [],
      sceneIntent: null,
    });
    const lastCall = appendLifeEventMock.mock.calls.at(-1)![0] as {
      payload: Record<string, unknown>;
    };
    expect('flashcardId' in lastCall.payload).toBe(false);
  });
```

### T5 — `src/lib/life/mergeLocalEvents.test.ts`: append one test

ANCHOR (POST-PHASE-F — the closing of T4's "keeps local events" test; verify unique):

```ts
    const pruned = pruneDelivered(listener, local);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.kind).toBe('correction');
  });
```

Replace with:

```ts
    const pruned = pruneDelivered(listener, local);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.kind).toBe('correction');
  });

  it('LIFE-EX-SRS-2 — localCorrectionEvent mirrors flashcardId (present ⇒ copied; absent ⇒ key omitted)', () => {
    const withCard = localCorrectionEvent({
      kind: 'fill-blank',
      correct: true,
      picked: 'quand même',
      correctAnswer: 'quand même',
      promptSource: 'Je viens ___ au marché.',
      flashcardId: 'card-1',
    });
    expect((withCard.payload as Record<string, unknown>).flashcardId).toBe('card-1');
    const without = localCorrectionEvent({
      kind: 'comprehension',
      correct: false,
      picked: 'x',
      correctAnswer: 'y',
      promptSource: 'z',
    });
    expect('flashcardId' in (without.payload as Record<string, unknown>)).toBe(false);
  });
```

### T6 — `src/screens/LifeScreen/useNodeEngine.test.tsx`: four edits

**T6-a — mock the credit module.** The engine now imports `@/lib/life/srsCredit` → `@/lib/flashcards` → `@/lib/firebase`, which must never load in jsdom — this mock is REQUIRED or every existing test in the file breaks at import time. ANCHOR (POST-PHASE-F; verify unique):

```ts
vi.mock('@/lib/life/runGradedQuestionGenerate', () => ({
  runGradedQuestionGenerate: vi.fn(),
}));
```

Replace with:

```ts
vi.mock('@/lib/life/runGradedQuestionGenerate', () => ({
  runGradedQuestionGenerate: vi.fn(),
}));
vi.mock('@/lib/life/srsCredit', () => ({ creditSrsAttempt: vi.fn() }));
```

**T6-b — imports + mocked handle.** ANCHOR (POST-PHASE-F; verify unique):

```ts
import { commitNode } from '@/lib/life/commitNode';
```

Replace with:

```ts
import { commitNode } from '@/lib/life/commitNode';
import { creditSrsAttempt } from '@/lib/life/srsCredit';
```

Then ANCHOR (POST-PHASE-F; verify unique):

```ts
const runGradedQuestionGenerateMock = vi.mocked(runGradedQuestionGenerate);
```

Replace with:

```ts
const runGradedQuestionGenerateMock = vi.mocked(runGradedQuestionGenerate);
const creditSrsAttemptMock = vi.mocked(creditSrsAttempt);
```

And ANCHOR (POST-PHASE-F — the firestore type import; verify unique):

```ts
import type { LifeWorld } from '@/types/firestore';
```

Replace with:

```ts
import type { FlashCard, LifeWorld } from '@/types/firestore';
```

**T6-c — `makeProps` gains the new required prop.** ANCHOR (POST-PHASE-F; verify unique):

```ts
    campaign: null,
    npcs: [],
```

Replace with:

```ts
    campaign: null,
    npcs: [],
    flashcards: [],
```

**T6-d — the threading test.** ANCHOR (POST-PHASE-F — the tail of T7's final test + the describe close; verify unique):

```ts
    await waitFor(() => expect(result.current.phase).toBe('options-failed'));
    expect(result.current.question).toBeNull();
  });
});
```

Replace with:

```ts
    await waitFor(() => expect(result.current.phase).toBe('options-failed'));
    expect(result.current.question).toBeNull();
  });

  it('LIFE-EX-SRS-2 — flashcardId threads plan → feedback → outcome; feedbackContinue credits the card', async () => {
    const savedCard: FlashCard = {
      id: 'card-1',
      phrase: 'quand même',
      translation: 'anyway',
      practiceLanguage: 'French',
      interval: 2,
      ease: 2.6,
      reps: 3,
      lapses: 1,
      consecutiveCorrectDays: 2,
    };
    const cardBackedQuestionOption: StepOption = {
      id: 'ask-card',
      practiceText: 'Proposer de venir quand même',
      nativeText: 'Suggest coming anyway',
      next: {
        kind: 'question',
        gradedPlan: {
          kind: 'fill-blank',
          testTarget: 'quand même',
          sentenceContext: 'Je viens quand même au marché.',
          flashcardId: 'card-1',
        },
      },
    };
    const props = makeProps();
    props.flashcards = [savedCard];
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([cardBackedQuestionOption, noPreviewOption], input.nonce),
    );
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'ok',
      practicePrompt: {
        kind: 'fill-blank',
        practiceText: 'Je viens ___ au marché.',
        nativeText: 'I am ___ coming to the market.',
      },
      choices: [
        { id: 'quand-meme', practiceText: 'quand même', nativeText: '', correctness: 'correct' },
        { id: 'pourtant', practiceText: 'pourtant', nativeText: '', correctness: 'wrong' },
        { id: 'deja', practiceText: 'déjà', nativeText: '', correctness: 'wrong' },
      ],
    });
    await act(async () => {
      result.current.actions.pick('ask-card');
    });
    await waitFor(() => expect(result.current.phase).toBe('question-ready'));

    act(() => {
      result.current.actions.pick('quand-meme');
    });
    expect(result.current.phase).toBe('feedback');
    // Plan → FeedbackState.
    expect(result.current.feedback?.flashcardId).toBe('card-1');
    // FeedbackState → the prefetch outcome.
    const prefetchCall = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(prefetchCall.turn).toEqual(
      expect.objectContaining({
        kind: 'live',
        practiceOutcome: expect.objectContaining({ flashcardId: 'card-1' }),
      }),
    );

    act(() => {
      result.current.actions.feedbackContinue();
    });
    // FeedbackState → the credit call (with the live deck).
    expect(creditSrsAttemptMock).toHaveBeenCalledTimes(1);
    expect(creditSrsAttemptMock).toHaveBeenCalledWith({
      uid: 'u1',
      flashcardId: 'card-1',
      correct: true,
      cards: [savedCard],
    });
    // FeedbackState → the committed correction outcome.
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({
          kind: 'practice-outcome',
          outcome: expect.objectContaining({ flashcardId: 'card-1' }),
        }),
      }),
    );
  });
});
```

### T7 — NEW FILE `src/screens/LifeScreen/useChapterDeck.test.tsx` (complete)

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';

vi.mock('@/hooks/useFlashcards', () => ({ useFlashcards: vi.fn() }));
vi.mock('@/lib/life/world', () => ({
  updateLifeWorld: vi.fn(async () => undefined),
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { useFlashcards } from '@/hooks/useFlashcards';
import { updateLifeWorld } from '@/lib/life/world';
import { useChapterDeck } from './useChapterDeck';
import type { FlashCard, LifeWorld } from '@/types/firestore';

const useFlashcardsMock = vi.mocked(useFlashcards);
const updateLifeWorldMock = vi.mocked(updateLifeWorld);

const card: FlashCard = {
  id: 'card-1',
  phrase: 'quand même',
  translation: 'anyway',
  practiceLanguage: 'French',
};

const arc = {
  chapterNumber: 3,
  premise: 'Settle in.',
  themes: [],
  status: 'active' as const,
  recurringNpcIds: [],
  completedCampaignMemories: [],
};

const worldNoSnapshot: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
  currentArc: arc,
};

type DeckReturn = ReturnType<typeof useFlashcards>;
function deck(state: {
  data: FlashCard[];
  loading: boolean;
  fromCache: boolean;
}): DeckReturn {
  return {
    data: state.data,
    loading: state.loading,
    fromCache: state.fromCache,
    error: null,
    rawSize: state.data.length,
  } as DeckReturn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useChapterDeck — LIFE-EX-SRS-3 write gate', () => {
  it('LIFE-EX-SRS-3 — writes the chapter snapshot once from a server-confirmed deck (and returns the live cards)', () => {
    useFlashcardsMock.mockReturnValue(
      deck({ data: [card], loading: false, fromCache: false }),
    );
    const { result, rerender } = renderHook(() =>
      useChapterDeck('u1', worldNoSnapshot),
    );
    expect(result.current.cards).toEqual([card]);
    expect(updateLifeWorldMock).toHaveBeenCalledTimes(1);
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      deckSnapshot: {
        chapterNumber: 3,
        cards: [{ id: 'card-1', phrase: 'quand même' }],
        takenAt: expect.anything(),
      },
    });
    // Same world + chapter re-rendering (listener echo pending) —
    // the ref guard prevents a duplicate write.
    rerender();
    expect(updateLifeWorldMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-EX-SRS-3 — never freezes a cache emit (fromCache OR loading blocks the write)', () => {
    useFlashcardsMock.mockReturnValue(
      deck({ data: [card], loading: false, fromCache: true }),
    );
    const { rerender } = renderHook(
      ({ world }: { world: LifeWorld }) => useChapterDeck('u1', world),
      { initialProps: { world: worldNoSnapshot } },
    );
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
    useFlashcardsMock.mockReturnValue(
      deck({ data: [card], loading: true, fromCache: false }),
    );
    rerender({ world: worldNoSnapshot });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
    // Server emit lands → the write fires.
    useFlashcardsMock.mockReturnValue(
      deck({ data: [card], loading: false, fromCache: false }),
    );
    rerender({ world: worldNoSnapshot });
    expect(updateLifeWorldMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-EX-SRS-3 — no write when the stored snapshot matches the chapter, or when no chapter is active', () => {
    useFlashcardsMock.mockReturnValue(
      deck({ data: [card], loading: false, fromCache: false }),
    );
    renderHook(() =>
      useChapterDeck('u1', {
        ...worldNoSnapshot,
        deckSnapshot: { chapterNumber: 3, cards: [] },
      }),
    );
    renderHook(() => useChapterDeck('u1', { ...worldNoSnapshot, currentArc: null }));
    renderHook(() => useChapterDeck(null, worldNoSnapshot));
    renderHook(() => useChapterDeck('u1', null));
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-EX-SRS-3 — a different chapterNumber re-snapshots (next chapter picks up mid-chapter saves)', () => {
    useFlashcardsMock.mockReturnValue(
      deck({ data: [card], loading: false, fromCache: false }),
    );
    renderHook(() =>
      useChapterDeck('u1', {
        ...worldNoSnapshot,
        deckSnapshot: { chapterNumber: 2, cards: [] },
      }),
    );
    expect(updateLifeWorldMock).toHaveBeenCalledTimes(1);
    expect(updateLifeWorldMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({
        deckSnapshot: expect.objectContaining({ chapterNumber: 3 }),
      }),
    );
  });
});
```

### T8 — `tests/e2e/specs/life-flow.spec.ts`: Phase G additions (three edits)

Tier: **@standard** (the spec is untagged; it runs under `test:e2e:standard`, same as Phase F left it). Post-conditions are asserted against Firestore via the admin SDK.

**T8-a — header comment.** ANCHOR (POST-PHASE-F — the last numbered line of F7-c's header comment; verify unique):

```
 *   11. World exit fires the recap generator and persists
 *       resumeRecap (LIFE-FLOW-5, Phase C carry-over).
```

Replace with:

```
 *   11. World exit fires the recap generator and persists
 *       resumeRecap (LIFE-FLOW-5, Phase C carry-over).
 *   12. Phase G (LIFE-EX-SRS-1/2/3): card-backed question credits
 *       SM-2 on the flashcard doc; the correction event carries the
 *       card id; deckSnapshot stays chapter-frozen.
```

**T8-b — fixtures + card-seed helper.** ANCHOR (POST-PHASE-F — the tail of F7-c's `RESUME_LIVE` fixture; verify unique — `'Rester ici'` appears once in the file):

```ts
    {
      id: 'y',
      practiceText: 'Rester ici',
      nativeText: 'Stay here',
      noPreview: true,
    },
  ],
};
```

Replace with:

```ts
    {
      id: 'y',
      practiceText: 'Rester ici',
      nativeText: 'Stay here',
      noPreview: true,
    },
  ],
};

// --- Phase G fixtures (LIFE-EX-SRS) ---------------------------------------

/** Seed a saved card the graded plan will reference. Seeded AFTER the
 *  chapter-1 deckSnapshot was taken (first world mount, empty deck),
 *  so LIFE-EX-SRS-3 requires it to stay OUT of the frozen snapshot. */
async function seedFlashcard(uid: string): Promise<string> {
  const db = getAdminFirestore();
  const ref = await db.collection(`users/${uid}/flashcards`).add({
    phrase: 'quand même',
    translation: 'anyway',
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    topic: '',
    userId: uid,
    correctCount: 0,
    incorrectCount: 0,
    schemaVersion: 2,
    createdAt: new Date(),
  });
  return ref.id;
}

/** Live node after the resume pick — the 'test-card' option previews
 *  a fill-blank question tagged with the seeded card's id (a runtime
 *  value, hence a function fixture). */
function srsLive(cardId: string): RawNodeResponseInput {
  return {
    node: {
      kind: 'branch',
      beats: [
        {
          speaker: 'narrator',
          practiceText: 'Sophie t’attend devant le marché.',
          nativeText: 'Sophie is waiting for you outside the market.',
        },
      ],
    },
    options: [
      {
        id: 'test-card',
        practiceText: 'Dire que tu viens quand même',
        nativeText: "Say you're coming anyway",
        next: {
          kind: 'question',
          gradedPlan: {
            kind: 'fill-blank',
            testTarget: 'quand même',
            sentenceContext: 'Je viens quand même au marché.',
            flashcardId: cardId,
          },
        },
      },
      {
        id: 'skip-market',
        practiceText: 'Faire demi-tour',
        nativeText: 'Turn back',
        noPreview: true,
      },
    ],
  };
}

/** LIFE-LANG-1: fill-blank chips stay practice-only (nativeText: ''). */
const GRADED_SRS_CARD: GradedQuestionFixture = {
  practicePrompt: {
    kind: 'fill-blank',
    practiceText: 'Je viens ___ au marché.',
    nativeText: 'I am ___ coming to the market.',
  },
  choices: [
    { id: 'quand-meme', practiceText: 'quand même', nativeText: '', correctness: 'correct' },
    { id: 'pourtant', practiceText: 'pourtant', nativeText: '', correctness: 'wrong' },
    { id: 'deja', practiceText: 'déjà', nativeText: '', correctness: 'wrong' },
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
      next: { kind: 'branch', beats: [] },
    },
    {
      id: 'wait-here',
      practiceText: 'Attendre ici',
      nativeText: 'Wait here',
      noPreview: true,
    },
  ],
};
```

**T8-c — the test, appended as the LAST test of the serial describe.** ANCHOR (POST-PHASE-F — the tail of F7-c's final test plus the describe close; this is the end of the file; verify unique):

```ts
        { timeout: 15_000 },
      )
      .toBe(true);
  });
});
```

Replace with:

```ts
        { timeout: 15_000 },
      )
      .toBe(true);
  });

  test('LIFE-EX-SRS-1/2/3 — card-backed question credits SM-2 on the card doc; deckSnapshot stays chapter-frozen', async ({}, testInfo) => {
    // The card is seeded AFTER chapter 1's snapshot was taken (first
    // world mount, when the wiped deck was empty).
    const cardId = await seedFlashcard(userA.uid);

    await installLifeMock(page, {
      steps: [srsLive(cardId), SRS_AFTER],
      gradedQuestions: [GRADED_SRS_CARD],
      scenes: [minimalSceneSvg()],
    });
    await page.goto(`/life/${worldId}`);
    await page.waitForLoadState('domcontentloaded');
    // Re-entry shows the recap stored by the previous test.
    await page.getByTestId('LifeScreen-WurldResume-Continue').click({ timeout: 15_000 });

    // POST-CONDITION (LIFE-EX-SRS-1/3): the chapter-1 snapshot exists
    // on the world doc and the mid-chapter card did NOT enter it.
    const db = getAdminFirestore();
    await expect
      .poll(
        async () => {
          const data = (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data();
          const snap = data?.deckSnapshot as
            | { chapterNumber?: number; cards?: Array<{ id: string }> }
            | undefined;
          if (!snap || snap.chapterNumber !== 1 || !Array.isArray(snap.cards)) {
            return 'missing';
          }
          return snap.cards.some((c) => c.id === cardId) ? 'leaked' : 'frozen';
        },
        { timeout: 15_000 },
      )
      .toBe('frozen');

    await page.getByTestId('LifeScreen-Choice-__resume__').click();
    await page.getByTestId('LifeScreen-Choice-test-card').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeVisible({ timeout: 10_000 });
    await page.getByTestId('LifeScreen-Choice-quand-meme').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 5_000 });
    await captureBeat(page, testInfo, 'srs-feedback');
    await page.getByTestId('LifeScreen-PracticeFeedback-Continue').click();
    // Resolved bubble (template + correct chip), then the prefetched node.
    await expect(page.getByText('Je viens quand même au marché.')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Parfait, à tout à l’heure !')).toBeVisible({ timeout: 15_000 });

    // POST-CONDITION (LIFE-EX-SRS-2, half 1): the SM-2 write landed on
    // the card DOC — counters + schedule + archive streak, not just UI.
    await expect
      .poll(
        async () => {
          const d = (await db.doc(`users/${userA.uid}/flashcards/${cardId}`).get()).data();
          if (!d) return 'gone';
          return d.correctCount === 1 &&
            d.reps === 1 &&
            d.consecutiveCorrectDays === 1 &&
            d.nextReviewAt != null &&
            d.lastReviewedAt != null
            ? 'credited'
            : `partial:${JSON.stringify({ c: d.correctCount, r: d.reps })}`;
        },
        { timeout: 15_000 },
      )
      .toBe('credited');

    // POST-CONDITION (LIFE-EX-SRS-2, half 2): the correction event
    // carries the card id (feeds the wurld-mistakes backlog item).
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) =>
            e.kind === 'correction' &&
            e.payload.flashcardId === cardId &&
            e.payload.correct === true &&
            e.payload.correctAnswer === 'quand même',
        );
      }, { timeout: 10_000 })
      .toBe(true);
    await captureBeat(page, testInfo, 'srs-credited');
  });
});
```

Implementation notes for the executor:

- The apostrophes in `Sophie t’attend…` / `à tout à l’heure !` are the typographic U+2019 (matching the fixture text exactly is what makes `getByText` deterministic — copy-paste, don't retype with `'`).
- `seedFlashcard` writes with the admin SDK, so the app's Firestore listener picks the card up as a normal remote change; no app-side action is needed for it to enter the LIVE deck (which is what the credit resolves against).
- The `steps` queue is exactly consumed: `srsLive(cardId)` by the `__resume__` live turn, `SRS_AFTER` by the feedback prefetch. The graded chips come from the `gradedQuestions` queue. If the queue empties early, the mock 500s with a descriptive body — that means an unexpected extra `life_step` call, which is itself a regression to investigate, not to paper over.
- The world-exit recap generation may fire when the suite tears down the page (`life_resume_recap` has no fixture in this install) — the mock 500s and the app tolerates it by design (LIFE-FLOW-5). No assertion depends on it.

## Verify

Run after each Ordered step as indicated; ALL of the following must pass before the phase commit:

```bash
# Unit — scoped while iterating, full before commit:
npx vitest run src/lib/life/deckSnapshot.test.ts src/lib/life/srsCredit.test.ts \
  src/lib/life/prompts/step.test.ts src/lib/life/commitNode.test.ts \
  src/lib/life/mergeLocalEvents.test.ts src/lib/life/generateStepOptions.test.ts \
  src/screens/LifeScreen/useNodeEngine.test.tsx \
  src/screens/LifeScreen/useChapterDeck.test.tsx
npm test

# Types + lint (both must be clean; no new @ts-expect-error, no any):
npm run typecheck
npx eslint src/

# The spec edits landed:
git grep -l LIFE-EX-SRS-1 -- docs/specs   # → docs/specs/life-sim.md

# E2E (@standard tier — the extended spec, mocked Gemini):
cd tests/e2e && npx playwright test specs/life-flow.spec.ts
```

Then, per the Reliability principles: open every screenshot the E2E run captured (`captureBeat` outputs under `screenshots/<run-id>/`) with the Read tool and check the two new beats — `srs-feedback` (fill-blank feedback overlay over the market scene, correct-state styling) and `srs-credited` (resolved user bubble + Sophie's reply, chips restored) — alongside the existing beats for regressions (dark-mode, alignment, chip layout).

**Manual smoke (real Gemini, dev server — do NOT deploy):** in an existing wurld with ≥5 saved cards, play ~10 turns. Verify in the debug overlay's request log: the prompt carries `<flashcards>` with your cards, due-first, and the block's bytes are IDENTICAL across turns (chapter-frozen); save a new card mid-session and confirm the block does NOT change. Watch for a graded question on one of your saved phrases; answer it and confirm on /cards that the card's review state moved (and the correction event in Firestore carries `flashcardId`). Open the **Telemetry tab**: `life_step` cached input tokens must NOT drop after the first turn of a chapter (a per-turn cache invalidation means the block is being rebuilt from live data — a LIFE-EX-SRS-3 violation).

**Prompt-suite note:** this phase edits the client-side life SI (`src/lib/life/prompts/step.ts`), not `functions/src/` prompts, so the functions `@prompts` gate does not apply. The SI additions are asserted by the unit suite; if you want a real-model probe of card-tagging behaviour, ask the user before spending (~$0.05–0.15 via `tests/e2e/specs/life-flow-real.spec.ts`).

## Out of scope — do NOT touch

- **`src/lib/flashcards.ts` and `src/lib/sessionBuilder/internal.ts`** — consumed as-is. In particular do NOT "fix" `recordAttempt`'s defaults or `cardPriorityScore`'s weights.
- **The PracticeScreen `recordAttempt` bug** (Contradictions, last paragraph — practice mode omits `consecutiveCorrectDays`/`lastReviewedAt`, so its auto-archive streak never advances). Report it upward; it needs its own fix + test on the practice surface, not a drive-by edit here.
- **`src/lib/life/prompts/gradedQuestion.ts` / `runGradedQuestionGenerate.ts`** — the generator's tight scene context (LIFE-EX-GEN-7) does NOT gain the deck block; the planner already committed to the card.
- **`renderEvent`'s `correction` rendering** in `prompts/step.ts` — the model does not need `flashcardId` in the events block (it has `<flashcards>` + `<recentlyPracticed>`); leave the rendered attributes as they are.
- **No i18n changes** — G ships no user-visible copy; do not touch `src/i18n/`.
- **The §19 backlog** — formalizing the backlog into the spec (including the wurld-mistakes practice session that consumes `correction.flashcardId`) is Phase H's final step. Do not pre-implement any backlog item, and do not wire correction events into practice mode's session builder.
- **Explicit Gemini `cachedContent`** (§19) — the chapter-frozen snapshot is deliberately compatible with it, but building the cache lifecycle is backlog, not G.
- **Cloud Functions** — everything in G is client-side; nothing under `functions/` changes and no deploy happens.
- **`ZGradedPlan`** — `flashcardId` already exists on both plan kinds (`src/lib/life/stepSchema.ts:221/:233`); do not re-declare or tighten it.
- Files another phase owns: anything Phase F created that is not listed in an edit above (e.g. `useNodeEngine.ts`, `nodeEngineTypes.ts` beyond E8, `LifeScreenBottom.tsx`, `ActionBar.tsx`, `validateStep.ts`, `lifeMock.ts`).
