# Phase F — Node/lookahead step engine + write-your-own ✏️ chip

**Goal.** Replace the per-turn "generate everything on pick" loop with a node/lookahead engine: a node's beats render **instantly** on pick (they were pre-generated as a one-node-deep preview by the previous call), while ONE background Gemini call authors the next set of options + previews. Question nodes carry only a `gradedPlan`; their chips are authored by the existing two-stage graded generator when the node is shown. A client-injected "write your own ✏️" chip on branch nodes replaces the always-visible composer. `src/lib/life/runLifeStep.ts` is split into `generateStepOptions.ts` (pure generation) + `commitNode.ts` (all Firestore writes) and **deleted** at the end of this phase.

**Invariant ids covered:** `LIFE-NODE-1` … `LIFE-NODE-8` (all new — verified free in the current spec + README prefix table). Existing invariants amended (see Spec changes): `LIFE-UI-3`, `LIFE-EX-5`; superseded-with-banner: `LIFE-STEP-1/2/3/7/8`, `LIFE-EX-PLAN-4`'s merge mechanics.

**Cost stance (from the plan):** one narrative Gemini call per player action — the lookahead is bundled into the same `life_step` call (+450–650 output tokens/turn, ~2× output, ZERO new calls). Question previews are cheap (gradedPlan only). The `LIFE-CTX-1` prompt order is unchanged, so the Gemini prefix cache is unaffected.

## Contradictions

Checked against the current source (source wins on detail; plan intent kept):

1. **Plan F1 sketch says `branch beats ≤2` but the SI text elsewhere says "1–3 short beats".** Source: every current schema caps beats at 2 (`ZRawStepResponse`/`ZStepResponse` both `.max(2)`), and `LIFE-BUBBLE-1` requires ≤2. **Resolution: 2 is the cap everywhere.** Branch nodes allow 0–2 beats (0 is the legal post-comprehension case), continuation nodes 1–2.
2. **Plan F5 says "Graded generator failure keeps `synthesizeDemotedCyoa`".** That helper returns the now-deleted `StepResponse` type and hard-codes a **French** fallback beat ("Tu prends un instant pour réfléchir.") regardless of the world's practice language — a latent i18n bug. **Resolution (intent-preserving): the demotion path is kept but re-expressed as the `options-failed` Continue ladder** (LIFE-NODE-8): question-authoring failure → no wrong-language narrative beat, `options-failed` phase → i18n'd note + Continue chip → live gen. The player is never stuck; no hard-coded French ships.
3. **Free-text decision events change id.** Old composer submissions wrote `decision` events with `choiceId: '__free__'`; the ✏️ path writes `choiceId: '__write__'` (`WRITE_YOUR_OWN_ID`). Verified: nothing reads the `'__free__'` value (it only surfaces as an attribute in the prompt's event rendering). Cosmetic, safe.
4. **Plan line references drifted**: "LifeScreen.tsx ~443" → the opening effect starts at ~line 431; `runLifeStep.ts` is 672 lines as stated. `LifeScreen.tsx` is 803 raw lines ≈ **600 counted LOC** (the ESLint `max-lines` rule counts non-blank non-comment lines: `'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }]`) — it sits exactly AT the cap with **no exemption**, and Phases C/D/E each manage it with their own extractions. Hence ALL new state-machine code lands in new files — `nodeEngineTypes.ts` + `nodeEngineActions.ts` + `useNodeEngine.ts` (the engine, split in three because the combined logic counts ~675 LOC, over the cap as one file) and `mergeLocalEvents.ts` — and LifeScreen **shrinks** in this phase.
5. **`tests/e2e/specs/life-flow.spec.ts` currently never dismisses `WorldIntroScreen`**, yet the opening step is gated on `saga && currentArc && introDismissed` — the test's pass/fail depends on whether the real (un-mocked) saga generation lands mid-test. **Resolution:** the rewritten spec seeds the engine-test world via the admin SDK (saga + currentArc inline) and taps `LifeScreen-WorldIntro-Begin` explicitly. Onboarding keeps a slimmed test asserting the Firestore post-condition (world doc created) without depending on the opening beat.
6. **`salvageFillBlankChips` / `demoteGradedToCyoa` in `validateStep.ts` are dead code** (referenced only by their own tests — verified by grep). They are typed against the deleted `StepResponse` and are removed in the `validateStep.ts` rewrite.
7. **Not an F id, but flagged per the brief:** `LIFE-FLOW-4` already exists in the spec (in-flight step resume). Phase C's doc — not this one — owns resolving that collision. All of `LIFE-NODE-1..8` are free.

## Read first

Read these before editing anything:

- `docs/plans/wurlds-v2/00-approved-plan.md` — Context, Phase ordering, the whole **Phase F** section.
- `docs/specs/life-sim.md` — §5 (step engine), §9 (bubbles), §9.5 (interaction contract — the practice-intercept rules survive unchanged), §10 (exercises), §10.45 (two-stage graded generation — stays), §10.5 (campaigns — hook/replan/resolve signals stay), §17 (failure handling).
- `docs/specs/README.md` — naming convention + prefix table (you will edit the `LIFE-*` row).
- Source you will modify or split: `src/lib/life/stepSchema.ts`, `src/lib/life/runLifeStep.ts`, `src/lib/life/validateStep.ts`, `src/lib/life/prompts/step.ts`, `src/screens/LifeScreen/LifeScreen.tsx`, `src/screens/LifeScreen/lifeScreenState.ts` (Phase D's extraction — F slims it), `src/screens/LifeScreen/LifeScreenBottom.tsx` (+ its Phase-D test `LifeScreenBottom.test.tsx`), `src/screens/LifeScreen/ActionBar.tsx`, `tests/e2e/helpers/lifeMock.ts`, `tests/e2e/specs/life-flow.spec.ts`, `src/i18n/locales/en.ts`.
- Source you will call but NOT modify: `src/lib/life/runGradedQuestionGenerate.ts` (question chips), `src/lib/life/world.ts` (event/world writes), `src/lib/life/npcs.ts` (`promoteOrTouchNpc`), `src/lib/life/campaignLifecycle.ts` (hook accept / replan plan / completion snapshot), `src/lib/life/resolvedBubble.ts`, `src/lib/life/runCompaction.ts`, `src/lib/life/debugLog.ts`, `src/lib/life/modelConfig.ts`, `src/lib/gemini.ts` (`generateGemini`).

**Phase C/D/E integration notes (pinned post-states this phase builds on — phases land in order, so these are already merged when you start; every anchor marked POST-PHASE-C/D/E below is quoted from THESE docs' output, not from the pre-v2 tree):**

- **Phase C** (`docs/plans/wurlds-v2/phase-c.md`) rewrote LifeScreen's opening effect: the resume branch is gated on `recapDismissed`, seeds via `buildResumeSeed(eventsData, t)` (from `@/lib/life/resumeBubbles`, returns `{ bubbles, choices }`), and the effect deps include `recapDismissed`. C also added `WurldResumeScreen` (testids `LifeScreen-WurldResume`, `LifeScreen-WurldResume-Recap`, `LifeScreen-WurldResume-Moments`, `LifeScreen-WurldResume-Continue`), the `useResumeRecapOnExit` hook, a `resumeRecaps` fixture queue in `tests/e2e/helpers/lifeMock.ts` (category `life_resume_recap`), and two `LIFE-FLOW-5` E2E tests. F7-b/F7-c preserve ALL of that.
- **Phase D** (`docs/plans/wurlds-v2/phase-d.md`) replaced ActionBar's `hideChipNative: boolean` with `chipDisplay: 'both' | 'practice' | 'native'` (type export `ChipDisplay`), gave `ZLifeWorld` `viewMode?: ZViewMode`, and — critically for this phase's anchors — **restructured LifeScreen**: Edit 11 extracted `FeedbackState`/`LocalState`/`INITIAL_STATE` into a NEW file `src/screens/LifeScreen/lifeScreenState.ts`; Edit 12 rewired imports (`import type { StepChoice, StepResponse } from '@/lib/life/stepSchema';`, campaignLifecycle import without the type, `updateLifeWorld` added to the world import), added `explainOpen` state, an `onSetViewMode` handler directly above `onWorldDeleted`, `viewMode`+`onExplain` props on `<LifeScreenBottom`, and a lazy `ExplainModal` mount reading `state.feedback.prompt`/`state.feedback.allChoices`. D's Edit 10 fully replaced `LifeScreenBottom.tsx` (exports `chipDisplayFor`) and D's T7 created `src/screens/LifeScreen/LifeScreenBottom.test.tsx` — F6-c replaces the component again and T8 rewrites that test. D also reshaped the E2E fixtures (fill-blank chips carry `nativeText: ''`) and added the `LIFE-LANG-3` viewMode-cycle E2E test + Why?-modal assertions — F7-c carries them forward.
- **Phase E** (`docs/plans/wurlds-v2/phase-e.md`) added `complexWords?: string[]` + `wordTranslations?: Record<string, string>` to `ZStepChoice`, to the DialogueArea `Bubble` type, and threads them through `buildResolvedBubble` + `appendBeatEvent`. E extracted the flashcard lookup into `useFlashcardLookup.ts` (LifeScreen keeps a `flashcardLookup` binding) + added `useLifeWordSave`/`locationLabel`/`wordSave` bindings, extended `FlashcardMatch` with `id`, added `'flashcards'` to the E2E `wipeLifeData`, and added the `LIFE-BUBBLE-7` vocab-save E2E test — F7-c carries it forward. The engine code below carries the annotation fields through every beat→bubble and beat→event mapping. If any of those fields are missing from `ZStepChoice` / `Bubble` / `ResolvedBubble` when you typecheck, **STOP** — Phase E did not land as pinned; do not improvise.

---

## Spec changes

Apply these FIRST (Ordered step 0). All anchors verified unique in the current files with `grep -F -c`.

### S1 — `docs/specs/life-sim.md`: prefix-table row

ANCHOR (verify unique):

```
| `LIFE-EX-PLAN-*` / `LIFE-EX-GEN-*` | Two-stage graded-question generation | lifeStep emits a `gradedPlan`; a separate `gradedQuestionGenerator` call authors `practicePrompt` + chips |
```

Insert **after** that row:

```
| `LIFE-NODE-*` | Node/lookahead step engine | Node taxonomy (branch/continuation/question), single-call lookahead previews, commit-on-pick, ✏️ chip, nonce invalidation, cadence, failure ladder |
```

### S2 — `docs/specs/life-sim.md`: §5 supersession banner

ANCHOR (verify unique):

```
The orchestrator that drives every turn. One Cloud Function (`lifeStep`) per user action.
```

Replace that single line with:

```
The orchestrator that drives every turn. One Cloud Function (`lifeStep`) per user action.

> **Superseded 2026-07 by the node/lookahead engine (§10.46, `LIFE-NODE-*`).** `LIFE-STEP-1/2/3/7/8` described the pre-node response shape (`beats + choices + graded`) and its retry/fallback mechanics — those are replaced by `LIFE-NODE-1/2/5/8`. **Still binding:** `LIFE-STEP-4` (every beat carries the full bilingual payload — applies to node AND preview beats) and `LIFE-STEP-5`'s write ordering (events first, world deltas second — now enforced by `commitNode`, `LIFE-NODE-3`). `LIFE-STEP-6` (scene handoff) applies per-node via `node.sceneIntent`.
```

### S3 — `docs/specs/life-sim.md`: §10.45 note

ANCHOR (verify unique):

```
SPLIT the work. `lifeStep` decides WHAT to test; a focused second call AUTHORS the question.
```

Replace that line with:

```
SPLIT the work. `lifeStep` decides WHAT to test; a focused second call AUTHORS the question.

> **Phase F note (`LIFE-NODE-*`):** the planner's output now travels as a `question` node preview (`gradedPlan` on `ZNodePreview`), and the generator fires when the node is SHOWN (phase `question-authoring`), not merged into a `StepResponse` before the response returns. `LIFE-EX-PLAN-1/2/3` (plan shape + curator rules) and all of `LIFE-EX-GEN-*` are unchanged; only `LIFE-EX-PLAN-4`'s "the orchestrator immediately fires the generator, merges its result, and presents the combined response" mechanics are superseded by `LIFE-NODE-1`.
```

### S4 — `docs/specs/life-sim.md`: new §10.46 section

ANCHOR (verify unique):

```
## 10.48 Story shape — `LIFE-STORY-SHAPE-*`
```

Insert **before** that heading (leave a blank line before and after the inserted block):

```
## 10.46 Node/lookahead step engine — `LIFE-NODE-*`

The turn loop is a node graph the player walks. Every player-visible story moment is a NODE; every Gemini `life_step` call either renders a node + its outgoing options (live) or authors options for the node already on screen (options). Each option carries a one-node-deep PREVIEW so the picked node renders instantly; the visible latency of the old loop moves into the background options call, absorbed by the player's read time.

| ID | Invariant |
|---|---|
| **LIFE-NODE-1** | Node taxonomy: `branch` (a real decision — 0–2 beats, 2–3 model options, plus the client-injected ✏️ chip), `continuation` (connective pacing — 1–2 beats, exactly ONE option with id `continue`), `question` (graded teaching intercept — NO beats, a `gradedPlan` only; the chip set is authored by the `LIFE-EX-GEN-*` generator when the node is shown, phase `question-authoring`). A node is exactly one kind; the beat caps are schema-enforced. |
| **LIFE-NODE-2** | Single-call lookahead: ONE `life_step` Gemini call per player action. Every option carries `next` (a complete one-node-deep preview: beats + optional sceneIntent, or gradedPlan for question previews) XOR `noPreview: true` — never both, never neither. Previews never contain options (the options for a previewed node arrive via the next `<turn kind="options">` call). Max 3 model options per response. Turn-level signals (`worldDelta`, `campaign`) ride the response, never previews. |
| **LIFE-NODE-3** | Commit-on-pick; previews are never persisted. The lookahead cache is client-memory only. On arrival at a node (cached pick, or live landing), `commitNode` writes in order: (1) the action event (`decision` / `correction`; none for opening/continue), (2) each beat as a `beat` event with NPC promotion + avatar kickoff interleaved per NPC beat, (3) the `currentScene` patch from `node.sceneIntent`. `worldDelta` + campaign signals apply when the generating response lands (`applyTurnSignals` + the existing replan/hook/resolve paths). Kill mid-node is safe: the events log is the source of truth and the resume path is unchanged. Committed events are mirrored into an in-memory overlay so the immediately-following prompt sees them before the Firestore listener catches up. |
| **LIFE-NODE-4** | The ✏️ "write your own" chip (`WRITE_YOUR_OWN_ID = '__write__'`) is CLIENT-injected as the 4th chip on branch nodes only — the model never emits it. Tapping it swaps the chip grid for an inline composer (cancellable); submit routes as `<turn kind="free">` live generation. The always-visible composer is deleted. Continuation and question nodes have no ✏️. |
| **LIFE-NODE-5** | `noPreview` rules: the campaign hook-accept chip is ALWAYS `noPreview: true` (post-accept content depends on `campaignGenerate`). Any `noPreview` pick routes to live generation (existing hook-accept / resolution paths unchanged). Sanitize pass: an option whose `next` fails schema is individually demoted to `noPreview`; the response retries only when NO option's preview survives. |
| **LIFE-NODE-6** | Nonce invalidation: a monotonic client nonce guards the preview cache. It bumps ONLY on (a) ✏️ free-text submit and (b) a `hardPivot` replan trigger. Ordinary replans (soft tick, `replanRequested`) do NOT bump — one turn against the old outline is tolerated. Stale generation results (result nonce ≠ current) are dropped; picking an option cached under an old nonce routes to live generation. |
| **LIFE-NODE-7** | Cadence: ~1 node in 5 is a question — enforced by the client counter directive (`decision` events since the last `correction` ≥ 4 injects `<practiceCadence>`, which instructs the model to put question previews on at least two options, fresh targets only). Continuations are capped by SI guidance at ~1 in 4; real branches preferred. The live node after a `practiceOutcome` is NEVER a question (carried over from `LIFE-CONTRACT-EX-*`). |
| **LIFE-NODE-8** | Failure ladder: the options call retries once inside `generateStepOptions`, then the UI enters `options-failed` — an i18n'd note + a client-synthesized Continue chip; tapping it fires a live `<turn kind="continue">` generation. Question-chip authoring failure (after `LIFE-EX-GEN-6`'s internal retries) demotes to the same `options-failed` ladder. Live-turn failure lands on the same ladder. The player is never stuck and never sees a wrong-language fallback beat. |

**Turn phases (client state machine, `useNodeEngine`):** `live-loading` (thinking bar) · `options-loading` (node beats visible, 3 skeleton chips) · `options-ready` (chips + cached previews) · `question-authoring` (shimmer header, ~1.5s expected) · `question-ready` (prompt card + graded chips) · `feedback` (overlay; holds the prefetched post-feedback live turn) · `options-failed` (note + Continue chip).

### Design decisions (Phase F)

- **Why previews ride options instead of a second call:** a second "prefetch next node" call would double per-turn calls and re-send the full context. Bundling previews into the same structured output costs +450–650 output tokens/turn (~2× output, output is the cheap side at flash-lite pricing) and zero extra input/calls; the `LIFE-CTX-1` prompt order is untouched so the prefix cache keeps hitting. Revisit if the Telemetry tab shows output cost dominating.
- **Why the cache is memory-only:** persisting previews would create a second source of narrative truth to reconcile on resume. The events log stays authoritative; a killed session simply resumes per `LIFE-FLOW-2` and the next options call regenerates.
- **Why the nonce only bumps on free-text + hardPivot:** those are the two events that make cached previews *wrong* (the model never saw the typed text; the outline was declared unsalvageable). Soft replans merely refresh emphasis — dropping a whole cached turn for them would re-introduce the latency this engine removes.
- **Why the options call re-reads the events log as node context:** the picked node's beats + the pick decision are committed at pick time (and mirrored in-memory), so `<turn kind="options">` needs no bespoke payload — the "current node" is simply the newest events, which keeps the prompt assembly identical to every other turn (cache-friendly, one code path).
```

### S5 — `docs/specs/life-sim.md`: LIFE-UI-3 row replacement

ANCHOR (verify unique — start of the row):

```
| **LIFE-UI-3** | The ActionBar renders one of three states:
```

Replace the entire `LIFE-UI-3` table row (the single `| **LIFE-UI-3** | … |` line) with:

```
| **LIFE-UI-3** | The ActionBar area renders one state per turn phase (`LIFE-NODE-*`): (a) chip grid — 2–3 model options (+ the client ✏️ chip on branch nodes, `LIFE-NODE-4`); (b) inline composer — only after the ✏️ chip is tapped, with a cancel affordance back to the chips; (c) graded multi-choice — chips look identical to (a) but tap commits the answer with grading; (d) 3 skeleton chips while the options call is in flight; (e) a single Continue chip in the `options-failed` state. There is no always-visible composer. |
```

### S6 — `docs/specs/life-sim.md`: LIFE-EX-5 row replacement

ANCHOR (verify unique — start of the row):

```
| **LIFE-EX-5** | Free-text input is suppressed on graded turns
```

Replace the entire `LIFE-EX-5` table row with:

```
| **LIFE-EX-5** | Free-text input is impossible on graded turns by construction: the ✏️ "write your own" chip (`LIFE-NODE-4`) is injected on branch nodes only — question and continuation nodes never render it, and the composer only opens from that chip. |
```

### S7 — `docs/specs/life-sim.md`: §18 test-table rows

ANCHOR (verify unique):

```
| TBD: `tests/e2e/specs/life-flow.spec.ts` (Phase B+) | End-to-end onboarding → first beat → user response → next beat |
```

Insert **immediately after** that row (do NOT delete the TBD row — `docs/plans/wurlds-v2/phase-h.md` Edit S3 anchors on it; phases B and C/D/E also inserted rows after it, so the table already has several rows below it — insert directly under the TBD line itself):

```
| `tests/e2e/specs/life-flow.spec.ts` (node-engine rewrite, Phase F) | LIFE-NODE-1/2/3/4/8 — mocked-Gemini node engine: instant cached advance + skeletons, ✏️ composer, question authoring + feedback prefetch, options-failed ladder, Firestore commit post-conditions. Carries forward (re-expressed against node fixtures): LIFE-FLOW-5 recap screen + exit generation, LIFE-LANG-1/3/5 chip languages + viewMode cycle + Why? explain, LIFE-BUBBLE-7 vocab save |
| `src/lib/life/stepSchema.test.ts` | LIFE-NODE-1/2/4/5 superRefine matrix |
| `src/lib/life/generateStepOptions.test.ts` | LIFE-NODE-1/2/5/8 generation, sanitize, retry, nonce passthrough |
| `src/lib/life/prompts/step.test.ts` | LIFE-NODE-1/2/4/5/7 options turn + SI contract + cadence directive |
| `src/lib/life/commitNode.test.ts` | LIFE-NODE-3 write ordering |
| `src/screens/LifeScreen/useNodeEngine.test.tsx` | LIFE-NODE-1/2/3/4/5/6/8 client machine |
```

### S8 — `docs/specs/README.md`: prefix-table row

ANCHOR (verify unique — Phase D inserted `LANG` MID-row, after `BUBBLE`, so the row still ENDS with this fragment):

```
WIP / FAIL) |
```

Replace `WIP / FAIL) |` with:

```
WIP / FAIL / NODE) |
```

(Post-D the `LIFE-*` row reads `… BUBBLE / LANG / CONTRACT … WIP / FAIL) |`; this edit only appends `NODE` at the end. Known downstream note — do not fix here: `phase-h.md` Edit S6 anchors on the FULL pre-D row text and is already stale; the H executor re-anchors there, not you.)

---

## Ordered steps

Follow the repo workflow inside every step: tests are written and RUN (failing) before the implementation they assert.

- **Step 0 — Spec edits.** Apply S1–S8 above. Commit-gate: `git grep LIFE-NODE-1` lands on the spec.
- **Step 1 — Schema + tests.** Rewrite `src/lib/life/stepSchema.test.ts` (new node suites FAIL — `ZNodePreview` doesn't exist yet), then apply the `stepSchema.ts` edits (F1-a, F1-b). Run `npx vitest run src/lib/life/stepSchema.test.ts` → green. NOTE: `validateStep.ts`/`runLifeStep.ts`/`lifeMock` still reference `ZStepResponse` — the legacy shapes are deleted in Step 7 (F7-e); Step 1 only ADDS the node shapes.
- **Step 2 — Extract `commitNode` (behavior-preserving).** Write `src/lib/life/commitNode.test.ts` (fails — module missing), create `src/lib/life/commitNode.ts` (F2-a), then edit `runLifeStep.ts` to delegate its write section to it (F2-b). Run `npm test` — everything stays green; the app behaves identically (two `updateLifeWorld` patches instead of one merged write when both sceneIntent and worldDelta are present; the player-avatar kickoff moves from before the Gemini call to commit time — both are noted, deliberate, and invisible to the user).
- **Step 3 — `generateStepOptions`.** Write `src/lib/life/generateStepOptions.test.ts` + `src/lib/life/mergeLocalEvents.test.ts` (fail), create `src/lib/life/mergeLocalEvents.ts` (F3-a) and `src/lib/life/generateStepOptions.ts` (F3-b). Green.
- **Step 4 — SI rewrite.** Update `src/lib/life/prompts/step.test.ts` (F4-t — the cadence-threshold tests now FAIL against the old prompt), then apply the `prompts/step.ts` edits (F4-a input type, F4-b full SI replacement, F4-c turn-section replacement, F4-d cadence block replacement). Green.
- **Step 5 — `validateStep` adaptation.** Rewrite `src/lib/life/validateStep.test.ts` (fails), then replace `validateStep.ts` wholesale (F5-a). NOTE: this deletes `validateStepResponse` — `runLifeStep.ts` still imports it; apply F5-b (runLifeStep stops calling the validator; `generateStepOptions` is the only caller going forward). Green.
- **Step 6 — UI state machine + ✏️.** Write `src/screens/LifeScreen/useNodeEngine.test.tsx` (T7, fails) and the `LifeScreenBottom.test.tsx` rewrite (T8, fails — the new props don't exist yet), add i18n keys (F6-a), create the three engine files `src/screens/LifeScreen/nodeEngineTypes.ts` / `nodeEngineActions.ts` / `useNodeEngine.ts` (F6-b1/b2/b3 — split to respect the 600-LOC cap; LifeScreen + T7 import from `useNodeEngine`, pure-UI code + T8 from `nodeEngineTypes`), rewrite `src/screens/LifeScreen/lifeScreenState.ts` (F6-e E2), replace `LifeScreenBottom.tsx` (F6-c), edit `ActionBar.tsx` (F6-d), edit `LifeScreen.tsx` (F6-e series). Green + `npm run typecheck` + `npx eslint src/`.
- **Step 7 — Delete `runLifeStep.ts` + legacy shapes + E2E + full suite.** Delete `src/lib/life/runLifeStep.ts` (F7-a — nothing imports it after Step 6; verify with `git grep runLifeStep`), rewrite `tests/e2e/helpers/lifeMock.ts` (F7-b — KEEPS Phase C's `resumeRecaps` queue) and `tests/e2e/specs/life-flow.spec.ts` (F7-c — node-engine tests PLUS node-shape ports of Phase C's two LIFE-FLOW-5 tests, Phase D's LIFE-LANG-1/3/5 assertions, and Phase E's LIFE-BUBBLE-7 vocab test; earlier-phase E2E coverage must not regress), fix the stale-comment references (F7-d), delete the legacy `ZRawStepResponse`/`ZStepResponse` block from `stepSchema.ts` (F7-e). Run `npm test`, `npm run typecheck`, `npx eslint src/`, then the E2E spec (see Verify).

---

## Edits

Conventions for every edit below: anchors are verbatim snippets from the file as of Phase E landing; check uniqueness with `grep -F -c '<snippet>' <file>` (must print `1`) before applying. Where an edit says "replace the span from A through B", the span is inclusive of both anchor lines. New files are complete — paste as-is.

### F1-a — `src/lib/life/stepSchema.ts`: header comment

ANCHOR (verify unique):

```
 * LIFE-STEP-3: the structured response shape Gemini returns for
```

Replace the file's opening block comment (lines starting `/**` down to ` */` immediately above `import { z } from 'zod';`) with:

```ts
/**
 * LIFE-NODE-1/2: the structured shapes for the node/lookahead step
 * engine. Every life_step Gemini call returns a ZRawNodeResponse —
 * a node to render now (live turns) and/or the options leading out
 * of it, each option carrying a one-node-deep preview.
 *
 * Every narrator / NPC beat carries the FULL bilingual payload
 * (LIFE-STEP-4) so the bubble UI can flip view modes without a
 * follow-up call. Mirrors the dual-language single-call pattern
 * the tutor uses (TUTOR-INV-3).
 *
 * Spec: docs/specs/life-sim.md §10.46 (LIFE-NODE-*), §10.45
 * (LIFE-EX-PLAN-* — the gradedPlan shapes are unchanged).
 */
```

### F1-b — `src/lib/life/stepSchema.ts`: ADD the node shapes (legacy shapes deleted in Step 7, F7-e)

`ZRawStepResponse` / `ZStepResponse` are still imported by `runLifeStep.ts`, `validateStep.ts` (until Step 5) and the E2E helper (until Step 7) — they stay for now so every intermediate step is green. **Append** the following block at the END of the file (after the line `export type StepResponse = z.infer<typeof ZStepResponse>;`):

```ts
/** LIFE-NODE-4: id of the client-injected "write your own ✏️" chip.
 *  Rendered by the client on BRANCH nodes only — it replaces the
 *  always-visible composer. The model NEVER emits this id and it
 *  never carries a preview; picking it opens the inline composer. */
export const WRITE_YOUR_OWN_ID = '__write__';

/** LIFE-NODE-1: a node — one story moment. Also the shape of a
 *  one-node-deep lookahead preview (LIFE-NODE-2): previews ARE
 *  nodes, minus options.
 *
 *    branch       — a real decision point. 0-2 beats.
 *    continuation — connective pacing. 1-2 beats; its single option
 *                   is the "continue" chip.
 *    question     — a graded teaching intercept. NO beats (the
 *                   bubble for the tested line lands at practice
 *                   resolution, LIFE-CONTRACT-EX-1). Carries only
 *                   the gradedPlan; the chip set is authored by the
 *                   LIFE-EX-GEN-* generator when the node is shown.
 */
export const ZNodePreview = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('branch'),
    beats: z.array(ZStepBeat).max(2).optional().default([]),
    sceneIntent: ZSceneIntent.optional(),
  }),
  z.object({
    kind: z.literal('continuation'),
    beats: z.array(ZStepBeat).min(1).max(2),
    sceneIntent: ZSceneIntent.optional(),
  }),
  z.object({
    kind: z.literal('question'),
    gradedPlan: ZGradedPlan,
    sceneIntent: ZSceneIntent.optional(),
  }),
]);
export type NodePreview = z.infer<typeof ZNodePreview>;

/** LIFE-NODE-2: one selectable option on a branch/continuation node.
 *  Same face as a chip (id + bilingual label + emoji + the Phase E
 *  annotation fields inherited from ZStepChoice) minus `correctness`
 *  (options are never graded), plus the lookahead: `next` XOR
 *  `noPreview: true`. */
const ZStepOptionBase = ZStepChoice.omit({ correctness: true });
export const ZStepOption = ZStepOptionBase.extend({
  next: ZNodePreview.optional(),
  noPreview: z.boolean().optional(),
});
export type StepOption = z.infer<typeof ZStepOption>;

/** Lenient option variant for the sanitize pass (LIFE-NODE-5):
 *  `next` is unvalidated so ONE broken preview can't fail the whole
 *  response. generateStepOptions demotes broken nexts to noPreview
 *  and re-parses strictly. */
export const ZStepOptionLenient = ZStepOptionBase.extend({
  next: z.unknown().optional(),
  noPreview: z.boolean().optional(),
});

/** Per-option rules that don't depend on the node kind: the
 *  next-XOR-noPreview law (LIFE-NODE-2) and the hook-accept chip's
 *  mandatory noPreview (LIFE-NODE-5 — post-accept content is
 *  campaignGenerate's job; a preview of it would be fiction). */
export function perOptionIssues(
  options: ReadonlyArray<{ id: string; next?: unknown; noPreview?: boolean }>,
  acceptChipId: string | null,
): string[] {
  const issues: string[] = [];
  options.forEach((o, i) => {
    const hasNext = o.next !== undefined;
    const hasNoPreview = o.noPreview === true;
    if (hasNext === hasNoPreview) {
      issues.push(
        `option ${i} ("${o.id}") must carry EITHER a next preview OR noPreview: true — never both, never neither`,
      );
    }
    if (acceptChipId !== null && o.id === acceptChipId && !hasNoPreview) {
      issues.push(
        `option ${i} ("${o.id}") is the campaign hook accept chip — it MUST be noPreview: true (accepting triggers campaignGenerate; its outcome cannot be previewed)`,
      );
    }
  });
  return issues;
}

/** Node-kind-dependent option-count rules (LIFE-NODE-1). Called from
 *  the superRefine when the response carries the node inline (live
 *  turns), and from generateStepOptions with the client-known kind
 *  on <turn kind="options"> responses (no node to read it from). */
export function optionCountIssues(
  options: ReadonlyArray<{ id: string }>,
  nodeKind: 'branch' | 'continuation' | 'question',
): string[] {
  if (nodeKind === 'question') {
    return options.length === 0
      ? []
      : [
          `question nodes carry NO options (got ${options.length}) — the graded generator authors the chips`,
        ];
  }
  if (nodeKind === 'continuation') {
    if (options.length !== 1) {
      return [
        `continuation nodes carry exactly ONE option (got ${options.length})`,
      ];
    }
    return options[0]!.id === 'continue'
      ? []
      : [`the continuation option's id must be "continue" (got "${options[0]!.id}")`];
  }
  return options.length >= 2 && options.length <= 3
    ? []
    : [`branch nodes carry 2-3 options (got ${options.length})`];
}

const ZRawNodeResponseBase = z.object({
  /** Present on LIVE turns only — the node to render NOW. Omitted on
   *  <turn kind="options"> responses (that node already rendered
   *  from the picked option's preview). */
  node: ZNodePreview.optional(),
  /** The options leading out of the node. Max 3 — the 4th "write
   *  your own" chip is client-injected (LIFE-NODE-4). */
  options: z.array(ZStepOption).max(3).optional().default([]),
  /** Turn-level world-state changes; applied when the response
   *  lands (LIFE-NODE-3). */
  worldDelta: ZWorldDelta.optional(),
  /** LIFE-CAMPAIGN-3/4/10 signals; applied when the response lands. */
  campaign: ZStepCampaignSignal.optional(),
});

/** LIFE-NODE-2: the raw shape every life_step Gemini call returns. */
export const ZRawNodeResponse = ZRawNodeResponseBase.superRefine((val, ctx) => {
  const acceptChipId = val.campaign?.hook?.acceptChipId ?? null;
  const issues = [
    ...perOptionIssues(val.options, acceptChipId),
    ...(val.node ? optionCountIssues(val.options, val.node.kind) : []),
  ];
  for (const message of issues) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ['options'] });
  }
});
export type RawNodeResponse = z.infer<typeof ZRawNodeResponse>;
/** Authoring-side (pre-parse) shape — optionals not yet defaulted.
 *  Used by the E2E mock fixtures (tests/e2e/helpers/lifeMock.ts). */
export type RawNodeResponseInput = z.input<typeof ZRawNodeResponse>;

/** Lenient mirror for the sanitize pass — see ZStepOptionLenient. */
export const ZRawNodeResponseLenient = z.object({
  node: z.unknown().optional(),
  options: z.array(ZStepOptionLenient).max(3).optional().default([]),
  worldDelta: ZWorldDelta.optional(),
  campaign: ZStepCampaignSignal.optional(),
});
```

Everything already in the file (`ZStepBeat`, `ZStepChoice` with Phase E fields, `ZSceneIntent`, `ZWorldDelta`, `ZPracticePrompt`, `ZStepCampaignSignal`, `ZGradedPlan`, and — until Step 7 — the legacy `ZRawStepResponse`/`ZStepResponse`) is kept unchanged at this step.

### F2-a — NEW FILE `src/lib/life/commitNode.ts` (complete)

The write section of `runLifeStep.ts` (its lines 311–453: action event → per-beat NPC promote + beat events → scene patch; plus the two avatar-kickoff helpers, `pickWorldVibe`, and `SEED_VIBE_LABEL` at lines 509–607) moves here. `applyTurnSignals` carries the `worldDelta` goals/label merge (old lines 428–453 minus the scene fields, which belong to `commitNode`).

```ts
/**
 * LIFE-NODE-3: ALL Firestore writes for a node land here, at
 * arrival time (cached pick or live landing). Previews are never
 * persisted — nothing from a lookahead touches Firestore until the
 * player picks it.
 *
 * Write order (carries LIFE-STEP-5 forward):
 *   1. The action event — decision (chip / ✏️ free text) or
 *      correction (practice outcome). 'none' writes nothing.
 *   2. Per beat: NPC promotion (+ npc_introduced event + avatar
 *      kickoff on first sighting) then the beat event.
 *   3. currentScene patch from node.sceneIntent.
 *
 * Turn-level signals (worldDelta, campaign) are NOT committed here —
 * they apply when the generating response lands (applyTurnSignals +
 * the campaign lifecycle paths in useNodeEngine).
 *
 * Spec: docs/specs/life-sim.md §10.46 (LIFE-NODE-3).
 */
import * as log from '../log';
import {
  appendBeatEvent,
  appendDecisionEvent,
  appendLifeEvent,
  updateLifeWorld,
} from './world';
import { promoteOrTouchNpc, setNpcAvatar, setNpcAvatarFailed } from './npcs';
import { generateNpcAvatar, svgToDataUri } from './generateNpcAvatar';
import { lifeDebug } from './debugLog';
import { WRITE_YOUR_OWN_ID, type SceneIntent, type WorldDelta } from './stepSchema';
import type { PracticeOutcome } from './generateStepOptions';
import type { LifeBeatPayload, LifeWorld } from '@/types/firestore';

/** What the player did to arrive at the node being committed. */
export type CommitAction =
  | { kind: 'choice'; choiceId: string; text: string }
  | { kind: 'free-text'; text: string }
  | { kind: 'practice-outcome'; outcome: PracticeOutcome }
  | { kind: 'none' };

export type CommitNodeInput = {
  uid: string;
  world: LifeWorld;
  /** Active campaign id — scopes newly-introduced NPCs
   *  (LIFE-CAMPAIGN-8). Null in idle mode. */
  campaignId: string | null;
  action: CommitAction;
  /** The node's beats (empty for question nodes — their bubble
   *  lands at practice resolution). `user`-speaker beats are legal
   *  here: the resolved practice bubble commits through this path. */
  beats: ReadonlyArray<LifeBeatPayload>;
  sceneIntent?: SceneIntent | null;
};

export async function commitNode(input: CommitNodeInput): Promise<void> {
  const worldId = input.world.id;

  // 1. Action event FIRST (LIFE-STEP-5 ordering).
  if (input.action.kind === 'practice-outcome') {
    const o = input.action.outcome;
    await appendLifeEvent({
      uid: input.uid,
      worldId,
      kind: 'correction',
      payload: {
        kind: o.kind,
        correct: o.correct,
        picked: o.picked,
        correctAnswer: o.correctAnswer,
        promptSource: o.promptSource,
      },
    });
  } else if (input.action.kind === 'choice') {
    await appendDecisionEvent(input.uid, worldId, {
      choiceId: input.action.choiceId,
      text: input.action.text,
    });
  } else if (input.action.kind === 'free-text') {
    await appendDecisionEvent(input.uid, worldId, {
      choiceId: WRITE_YOUR_OWN_ID,
      text: input.action.text,
    });
  }

  // LIFE-NPC-2 (player-side): lazily generate the player's own
  // avatar. Fire-and-forget; never blocks the commit.
  if (
    input.world.characterAvatarUrl == null &&
    input.world.characterAvatarStatus !== 'pending' &&
    input.world.characterAvatarStatus !== 'failed'
  ) {
    void kickoffPlayerAvatarGen({
      uid: input.uid,
      worldId,
      characterName: input.world.characterName,
      worldVibe: pickWorldVibe(input.world),
    });
  }

  // 2. LIFE-NPC-1: NPC promotion + beat events, interleaved so the
  // promotion precedes the beat that introduces the NPC. The Set
  // dedups an NPC appearing in both beats of one node.
  const seenNpcs = new Set<string>();
  for (const beat of input.beats) {
    if (beat.speaker === 'npc' && beat.npcId && beat.speakerName) {
      if (!seenNpcs.has(beat.npcId)) {
        seenNpcs.add(beat.npcId);
        try {
          const { isNew } = await promoteOrTouchNpc({
            uid: input.uid,
            worldId,
            npcId: beat.npcId,
            name: beat.speakerName,
            campaignId: input.campaignId,
          });
          if (isNew) {
            await appendLifeEvent({
              uid: input.uid,
              worldId,
              kind: 'npc_introduced',
              payload: { npcId: beat.npcId, name: beat.speakerName },
            });
            void kickoffNpcAvatarGen({
              uid: input.uid,
              worldId,
              npcId: beat.npcId,
              name: beat.speakerName,
              worldVibe: pickWorldVibe(input.world),
            });
          }
        } catch (err) {
          log.warn('life.commit.npc-promote-failed', {
            npcId: beat.npcId,
            err: String(err),
          });
        }
      }
    }
    await appendBeatEvent(input.uid, worldId, { ...beat });
  }

  // 3. Scene patch — persist the full descriptor so resume
  // rehydrates the right scene (same rule the old runLifeStep had).
  const sceneIntent = input.sceneIntent ?? null;
  const sceneChanged =
    sceneIntent !== null &&
    sceneIntent.locationLabel !== input.world.currentLocationLabel;
  if (sceneIntent && sceneChanged) {
    await updateLifeWorld(input.uid, worldId, {
      currentLocationLabel: sceneIntent.locationLabel,
      currentScene: {
        locationType: sceneIntent.locationType,
        vibe: sceneIntent.vibe,
        persistent: sceneIntent.persistent,
        label: sceneIntent.locationLabel,
        ...(sceneIntent.flavour ? { flavour: sceneIntent.flavour } : {}),
      },
    });
  }
}

/** LIFE-NODE-3: turn-level world deltas (goals, location label).
 *  Applied when the generating response lands — separate from the
 *  per-node commit because deltas belong to the TURN, not the node. */
export async function applyTurnSignals(input: {
  uid: string;
  world: LifeWorld;
  worldDelta: WorldDelta;
}): Promise<void> {
  const delta = input.worldDelta;
  const patch: Record<string, unknown> = {};
  if (delta.currentLocationLabel) {
    patch.currentLocationLabel = delta.currentLocationLabel;
  }
  if (delta.addGoals || delta.removeGoals) {
    const existing = input.world.currentGoals ?? [];
    const filtered = delta.removeGoals
      ? existing.filter((g) => !delta.removeGoals!.includes(g))
      : existing;
    const next = delta.addGoals
      ? [...filtered, ...delta.addGoals.filter((g) => !filtered.includes(g))]
      : filtered;
    patch.currentGoals = next;
  }
  if (Object.keys(patch).length > 0) {
    await updateLifeWorld(input.uid, input.world.id, patch);
  }
}

/** LIFE-NPC-2 (player-side): generate the player's own character
 *  avatar. Moved verbatim from runLifeStep.ts. */
async function kickoffPlayerAvatarGen(opts: {
  uid: string;
  worldId: string;
  characterName: string;
  worldVibe: string;
}): Promise<void> {
  await updateLifeWorld(opts.uid, opts.worldId, {
    characterAvatarStatus: 'pending',
  }).catch(() => undefined);
  try {
    const result = await generateNpcAvatar({
      name: opts.characterName,
      role: "the player's own character — protagonist of the saga",
      worldVibe: opts.worldVibe,
    });
    if (result.kind === 'ok') {
      const dataUri = svgToDataUri(result.svg);
      await updateLifeWorld(opts.uid, opts.worldId, {
        characterAvatarUrl: dataUri,
        characterAvatarStatus: 'ready',
      });
      lifeDebug('NPC-AVATAR', `player avatar ready for "${opts.characterName}"`, {
        bytes: dataUri.length,
      });
    } else {
      await updateLifeWorld(opts.uid, opts.worldId, {
        characterAvatarStatus: 'failed',
      }).catch(() => undefined);
    }
  } catch (err) {
    log.warn('life.player-avatar.kickoff-failed', { err: String(err) });
    await updateLifeWorld(opts.uid, opts.worldId, {
      characterAvatarStatus: 'failed',
    }).catch(() => undefined);
  }
}

/** LIFE-NPC-2: avatar gen for a freshly-promoted NPC. Moved verbatim
 *  from runLifeStep.ts. */
async function kickoffNpcAvatarGen(opts: {
  uid: string;
  worldId: string;
  npcId: string;
  name: string;
  worldVibe: string;
}): Promise<void> {
  try {
    const result = await generateNpcAvatar({
      name: opts.name,
      worldVibe: opts.worldVibe,
    });
    if (result.kind === 'ok') {
      const dataUri = svgToDataUri(result.svg);
      await setNpcAvatar(opts.uid, opts.worldId, opts.npcId, dataUri);
      lifeDebug('NPC-AVATAR', `avatar ready for "${opts.name}"`, {
        npcId: opts.npcId,
        bytes: dataUri.length,
      });
    } else {
      await setNpcAvatarFailed(opts.uid, opts.worldId, opts.npcId).catch(() => undefined);
    }
  } catch (err) {
    log.warn('life.npc-avatar.kickoff-failed', {
      npcId: opts.npcId,
      err: String(err),
    });
    await setNpcAvatarFailed(opts.uid, opts.worldId, opts.npcId).catch(() => undefined);
  }
}

/** Saga tone beats worldSeedKey for the avatar prompt's visual
 *  register. Moved verbatim from runLifeStep.ts. */
function pickWorldVibe(world: LifeWorld): string {
  if (world.saga?.tone) return world.saga.tone.trim();
  return SEED_VIBE_LABEL[world.worldSeedKey] ?? 'modern city';
}

const SEED_VIBE_LABEL: Record<string, string> = {
  city_life: 'modern city, contemporary clothing',
  studying_abroad: 'student quarter, contemporary clothing',
  country_life: 'rural countryside, contemporary clothing',
  just_moved_here: 'unfamiliar city, contemporary clothing',
  magic_apprentice: 'fantasy magical academy, robes and academic attire',
  wandering_bard: 'medieval kingdom, period clothing',
  frontier_colony: 'frontier colony, sci-fi or western',
  noir_detective: 'noir city, 1940s collars and smoky tones',
  surprise: 'modern city, contemporary clothing',
  manual: 'modern city, contemporary clothing',
};
```

NOTE for Step 2 (dependency): `commitNode.ts` imports `PracticeOutcome` from `./generateStepOptions`, which doesn't exist until Step 3. For the behavior-preserving intermediate state, temporarily import it from `./runLifeStep` instead (`import type { PracticeOutcome } from './runLifeStep';`) and switch the import to `./generateStepOptions` in Step 3. Both edits are one line; the doc calls this out again in F3-b.

### F2-b — `src/lib/life/runLifeStep.ts`: delegate writes (intermediate, deleted in Step 7)

Two edits keep the suite green while `commitNode` takes over the writes.

**Edit 1 — imports.** ANCHOR (verify unique):

```
import {
  appendBeatEvent,
  appendDecisionEvent,
  appendLifeEvent,
  updateLifeWorld,
} from './world';
import { promoteOrTouchNpc, setNpcAvatar, setNpcAvatarFailed } from './npcs';
import { generateNpcAvatar, svgToDataUri } from './generateNpcAvatar';
```

Replace with:

```ts
import { applyTurnSignals, commitNode, type CommitAction } from './commitNode';
```

**Edit 2 — the write section.** ANCHOR (start, verify unique):

```
  // LIFE-STEP-5: write events FIRST, world deltas SECOND. If a
```

ANCHOR (end, verify unique):

```
  lifeDebug('STEP', `turn ${response.graded ? '(graded)' : '(cyoa)'} — ${response.beats.length} beats, ${response.choices.length} chips`, {
```

Replace the span from the start anchor down to (but EXCLUDING) the end anchor with:

```ts
  // LIFE-NODE-3 (intermediate): delegate all writes to commitNode +
  // applyTurnSignals. Deleted with this whole file in Step 7.
  const action: CommitAction = input.practiceOutcome
    ? { kind: 'practice-outcome', outcome: input.practiceOutcome }
    : input.choice
      ? { kind: 'choice', choiceId: input.choice.id, text: input.choice.practiceText }
      : input.freeText
        ? { kind: 'free-text', text: input.freeText }
        : { kind: 'none' };
  await commitNode({
    uid: input.uid,
    world: input.world,
    campaignId: input.campaign?.id ?? null,
    action,
    beats: response.beats.map((b) => ({
      speaker: b.speaker,
      speakerName: b.speakerName ?? null,
      npcId: b.npcId ?? null,
      practiceText: b.practiceText,
      nativeText: b.nativeText,
      complexWords: b.complexWords,
      wordTranslations: b.wordTranslations,
    })),
    sceneIntent: response.sceneIntent ?? null,
  });
  if (response.worldDelta) {
    await applyTurnSignals({
      uid: input.uid,
      world: input.world,
      worldDelta: response.worldDelta,
    });
  }

```

Then delete the now-dead code below in the same file: the `kickoffPlayerAvatarGen` call block (ANCHOR start `  // LIFE-NPC-2 (player-side): if the player's own character avatar` through the closing `  }` before `  // LIFE-CONTRACT-EX-4: when the previous turn was a practice, the`), and the four moved definitions at the bottom (`kickoffPlayerAvatarGen`, `kickoffNpcAvatarGen`, `pickWorldVibe`, `SEED_VIBE_LABEL` — from the ANCHOR `/** LIFE-NPC-2 (player-side): generate the player's own character` through the closing `};` of `SEED_VIBE_LABEL`). Also delete the unused `const worldId = input.world.id;` line (ANCHOR: `  const worldId = input.world.id;`). Run `npm run typecheck` — remaining unused imports (`log` stays: still used) must be pruned until clean; the only imports this file needs afterwards are: `generateGemini`, `log`, `commitNode`/`applyTurnSignals`/`CommitAction`, `buildLifeStepPrompt`/`lifeStepSystemInstruction`, `LIFE_PRIMARY_MODEL`/`LIFE_TEMPERATURE`, `lifeDebug`, `runCompaction`, `estimateTokens`, the stepSchema imports, `renderRetryHint`/`validateStepResponse`, `runGradedQuestionGenerate`, and the firestore types.

### F3-a — NEW FILE `src/lib/life/mergeLocalEvents.ts` (complete)

```ts
/**
 * LIFE-NODE-3: in-memory event overlay. commitNode's writes are
 * fire-and-forget, so the Firestore listener may not have delivered
 * the just-committed decision/beat events when the NEXT prompt is
 * assembled. The engine mirrors each commit as a local LifeEvent and
 * merges it after the listener's list; a local entry is dropped as
 * soon as a listener event with the same fingerprint (kind + primary
 * text) shows up.
 *
 * The fingerprint is deliberately coarse — a duplicated text would
 * at worst drop an overlay entry one turn early, costing the model
 * one duplicate-looking event. Cheap and deterministic.
 */
import type { LifeBeatPayload, LifeEvent } from '@/types/firestore';
import type { PracticeOutcome } from './generateStepOptions';

/** Overlay never grows past this — the listener catches up within a
 *  turn or two, and a runaway overlay would double-feed the prompt. */
const MAX_LOCAL = 12;

function localEventId(): string {
  return `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function localBeatEvent(beat: LifeBeatPayload): LifeEvent {
  return { id: localEventId(), kind: 'beat', payload: { ...beat } };
}

export function localDecisionEvent(d: { choiceId: string; text: string }): LifeEvent {
  return { id: localEventId(), kind: 'decision', payload: { ...d } };
}

export function localCorrectionEvent(o: PracticeOutcome): LifeEvent {
  return {
    id: localEventId(),
    kind: 'correction',
    payload: {
      kind: o.kind,
      correct: o.correct,
      picked: o.picked,
      correctAnswer: o.correctAnswer,
      promptSource: o.promptSource,
    },
  };
}

function fingerprint(e: LifeEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  const text =
    typeof p.practiceText === 'string'
      ? p.practiceText
      : typeof p.text === 'string'
        ? p.text
        : typeof p.correctAnswer === 'string'
          ? p.correctAnswer
          : '';
  return `${e.kind}:${text}`;
}

/** Local entries not yet visible in the listener's tail. */
export function pruneDelivered(
  listener: ReadonlyArray<LifeEvent>,
  local: ReadonlyArray<LifeEvent>,
): LifeEvent[] {
  if (local.length === 0) return [];
  const tail = listener.slice(-(local.length + 8));
  const seen = new Set(tail.map(fingerprint));
  return local.filter((e) => !seen.has(fingerprint(e))).slice(-MAX_LOCAL);
}

/** The event list a prompt should see: listener + undelivered local
 *  tail, chronological. */
export function mergeLocalEvents(
  listener: ReadonlyArray<LifeEvent>,
  local: ReadonlyArray<LifeEvent>,
): LifeEvent[] {
  const pending = pruneDelivered(listener, local);
  return pending.length === 0 ? [...listener] : [...listener, ...pending];
}
```

### F3-b — NEW FILE `src/lib/life/generateStepOptions.ts` (complete)

The generation half of the old `runLifeStep.ts`: compaction probe (its `rollingSummary` write via `runCompaction` is the ONE tolerated side effect), 2-attempt retry loop, sanitize pass, request-shape checks, warn-only cross-turn validator. No Firestore writes, no UI. Also home of `PracticeOutcome` (moved from `runLifeStep.ts` — after this step, flip `commitNode.ts`'s temporary `import type { PracticeOutcome } from './runLifeStep'` to `from './generateStepOptions'`).

```ts
/**
 * LIFE-NODE-2: the generation half of the node engine. ONE Gemini
 * call per player action:
 *
 *   turn {kind:'live'}    → node to render now + its options.
 *   turn {kind:'options'} → options for the node already on screen
 *                           (committed as the newest events).
 *
 * Pure apart from the compaction probe (LIFE-COMPACT-1 — its
 * rollingSummary write happens inside runCompaction and is the one
 * tolerated side effect, same as the old runLifeStep). All node /
 * turn writes live in commitNode.ts (LIFE-NODE-3).
 *
 * Failure ladder (LIFE-NODE-8): schema failure → one retry with the
 * issues attached → 'schema-failed'. Individually-broken previews
 * are demoted to noPreview instead of failing the response
 * (LIFE-NODE-5); retry only when nothing survives.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import { generateGemini } from '../gemini';
import * as log from '../log';
import { buildLifeStepPrompt, lifeStepSystemInstruction } from './prompts/step';
import { LIFE_PRIMARY_MODEL, LIFE_TEMPERATURE } from './modelConfig';
import { lifeDebug } from './debugLog';
import { runCompaction } from './runCompaction';
import { estimateTokens } from './tokenEstimate';
import {
  ZNodePreview,
  ZRawNodeResponse,
  ZRawNodeResponseLenient,
  optionCountIssues,
  type GradedPlan,
  type NodePreview,
  type RawNodeResponse,
  type StepCampaignSignal,
  type StepOption,
  type WorldDelta,
} from './stepSchema';
import { renderRetryHint, validateNodeResponse } from './validateStep';
import type { GradedQuestionSceneContext } from './prompts/gradedQuestion';
import type {
  LifeCampaign,
  LifeEvent,
  LifeNpc,
  LifeWorld,
} from '@/types/firestore';

/** Target prompt budget — exceeding it triggers compaction before
 *  the call (LIFE-COMPACT-1). Same values the old runLifeStep used. */
const COMPACTION_TRIGGER_TOKENS = 8_000;
const KEEP_RECENT_EVENTS = 16;

/** The outcome of the just-answered graded question. Passed forward
 *  on the post-feedback live turn so the model reacts in-narrative
 *  (LIFE-CONTRACT-EX-3/4). Moved from runLifeStep.ts. */
export type PracticeOutcome = {
  kind: 'fill-blank' | 'comprehension';
  correct: boolean;
  picked: string;
  correctAnswer: string;
  promptSource: string;
};

export type TurnRequest =
  | { kind: 'options'; currentNodeKind: 'branch' | 'continuation' }
  | {
      kind: 'live';
      choice?: { id: string; practiceText: string } | null;
      freeText?: string | null;
      practiceOutcome?: PracticeOutcome | null;
    };

export type GenerateStepOptionsInput = {
  uid: string;
  world: LifeWorld;
  /** Oldest → newest, including the engine's local overlay
   *  (mergeLocalEvents) so just-committed events are visible. */
  events: LifeEvent[];
  campaign?: LifeCampaign | null;
  npcs?: ReadonlyArray<LifeNpc>;
  turn: TurnRequest;
  /** LIFE-NODE-6: echoed back on the result so the caller can drop
   *  stale responses after a nonce bump. */
  nonce: number;
};

export type GenerateStepOptionsResult =
  | {
      kind: 'ok';
      /** Null on options turns (the node already rendered). */
      node: NodePreview | null;
      options: StepOption[];
      worldDelta?: WorldDelta;
      campaign?: StepCampaignSignal;
      nonce: number;
    }
  | { kind: 'schema-failed'; rawAttempts: string[]; nonce: number }
  | { kind: 'error'; error: unknown; nonce: number };

export async function generateStepOptions(
  input: GenerateStepOptionsInput,
): Promise<GenerateStepOptionsResult> {
  const turn = input.turn;
  const live = turn.kind === 'live' ? turn : null;
  // Opening = first-ever live turn (same derivation the old
  // runLifeStep used: the events log is empty).
  const isOpeningBeat = live !== null && input.events.length === 0;

  const promptInputBase = {
    choice: live?.choice ?? null,
    freeText: live?.freeText ?? null,
    practiceOutcome: live?.practiceOutcome ?? null,
    isOpeningBeat,
    campaign: input.campaign ?? null,
    npcs: input.npcs,
    requestKind: turn.kind,
    currentNodeKind: turn.kind === 'options' ? turn.currentNodeKind : null,
  } as const;

  // LIFE-COMPACT-1: budget-triggered compaction before assembly.
  let workingWorld = input.world;
  let workingEvents = input.events;
  if (input.events.length > KEEP_RECENT_EVENTS) {
    const probePrompt = buildLifeStepPrompt({
      ...promptInputBase,
      world: workingWorld,
      events: workingEvents,
    });
    if (estimateTokens(probePrompt) > COMPACTION_TRIGGER_TOKENS) {
      const recent = workingEvents.slice(-KEEP_RECENT_EVENTS);
      const toFold = workingEvents.slice(0, -KEEP_RECENT_EVENTS);
      const result = await runCompaction({
        uid: input.uid,
        world: workingWorld,
        eventsToCompact: toFold,
      });
      if (result.kind === 'ok') {
        workingWorld = { ...workingWorld, rollingSummary: result.rollingSummary };
        workingEvents = recent;
      } else {
        // LIFE-FAIL-7: non-fatal; retry compaction next turn.
        log.warn('life.compaction-failed', { kind: result.kind });
      }
    }
  }

  const prompt = buildLifeStepPrompt({
    ...promptInputBase,
    world: workingWorld,
    events: workingEvents,
  });
  const systemInstruction = lifeStepSystemInstruction({
    practiceLanguage: input.world.practiceLanguage,
    nativeLanguage: input.world.nativeLanguage,
    difficulty: input.world.difficulty,
  });

  // LIFE-CONTRACT-EX-4: the practiced line for the never-repeat
  // validator (live post-feedback turns only).
  const practicedLine =
    live?.practiceOutcome?.kind === 'fill-blank'
      ? live.practiceOutcome.promptSource.replace(
          /_{2,}/,
          live.practiceOutcome.correctAnswer,
        )
      : live?.practiceOutcome?.kind === 'comprehension'
        ? live.practiceOutcome.promptSource
        : null;

  const attempts: string[] = [];
  let retryHint: string | null = null;

  for (let i = 0; i < 2; i++) {
    let raw: string;
    try {
      raw = await generateGemini({
        prompt: i === 0 || !retryHint ? prompt : `${prompt}\n\n${retryHint}`,
        systemInstruction,
        model: LIFE_PRIMARY_MODEL,
        thinkingLevel: 'medium',
        responseMimeType: 'application/json',
        category: 'life_step',
        temperature: LIFE_TEMPERATURE,
      });
    } catch (err) {
      log.warn('life.node.gen-failed', { attempt: i, err: String(err) });
      return { kind: 'error', error: err, nonce: input.nonce };
    }
    attempts.push(raw);
    const parsed = safeParseJson(raw);
    if (!parsed) {
      retryHint = `<retryHint>The previous response was not valid JSON. Re-emit valid JSON matching the schema exactly. No prose, no fences.</retryHint>`;
      continue;
    }
    const strict = ZRawNodeResponse.safeParse(parsed);
    let response: RawNodeResponse | null = strict.success ? strict.data : null;
    if (!response) {
      // LIFE-NODE-5: demote individually-broken previews before
      // burning the retry.
      response = sanitizeOptions(parsed);
      if (response) {
        log.warn('life.node.previews-sanitized', {
          attempt: i,
          issueCount: strict.success ? 0 : strict.error.issues.length,
        });
      }
    }
    if (!response) {
      const issueDetail = strict.success
        ? []
        : strict.error.issues.slice(0, 6).map((iss) => ({
            path: iss.path.join('.'),
            message: iss.message,
          }));
      log.warn('life.node.schema-failed', {
        attempt: i,
        issues: issueDetail,
        responseSample:
          typeof parsed === 'object'
            ? JSON.stringify(parsed).slice(0, 600)
            : String(parsed).slice(0, 600),
      });
      const issuesSummary = issueDetail
        .map((iss) => `  - ${iss.path}: ${iss.message}`)
        .join('\n');
      retryHint = `<retryHint>The previous response failed schema validation:\n${issuesSummary}\nRemember: every option carries next XOR noPreview; question previews carry ONLY a gradedPlan; live turns emit a node, options turns do NOT. Re-emit a valid JSON object matching the schema exactly. No prose, no fences.</retryHint>`;
      continue;
    }

    // Request-shape rules the schema can't know.
    const shaped = applyRequestShape(response, turn);
    if (shaped.issues.length > 0) {
      retryHint = `<retryHint>The previous response had the wrong shape for this turn:\n${shaped.issues.map((m) => `  - ${m}`).join('\n')}\nRe-emit a valid JSON object. No prose, no fences.</retryHint>`;
      continue;
    }
    const final = shaped.response;

    // Cross-turn validator — warn-only, retry budget already spent
    // upstream (same policy the old runLifeStep had).
    const crossTurnIssues = validateNodeResponse(
      { node: final.node ?? null, options: final.options },
      { practicedLine },
    );
    if (crossTurnIssues.length > 0) {
      log.warn('life.node.validator-issues', {
        issues: crossTurnIssues.map((iss) => iss.code),
        hint: renderRetryHint(crossTurnIssues),
      });
    }

    lifeDebug(
      'STEP',
      `${turn.kind} turn — node=${final.node?.kind ?? 'none'}, ${final.options.length} options, ${final.options.filter((o) => o.next).length} previews`,
      {
        requestKind: turn.kind,
        nodeKind: final.node?.kind,
        beats:
          final.node && final.node.kind !== 'question'
            ? final.node.beats.map((b) => ({
                speaker: b.speaker,
                speakerName: b.speakerName ?? undefined,
                practiceText: b.practiceText,
              }))
            : [],
        options: final.options.map((o) => ({
          id: o.id,
          practiceText: o.practiceText,
          preview: o.next?.kind ?? 'noPreview',
        })),
        sceneIntent: final.node?.sceneIntent ?? undefined,
      },
    );
    return {
      kind: 'ok',
      node: final.node ?? null,
      options: final.options,
      worldDelta: final.worldDelta,
      campaign: final.campaign,
      nonce: input.nonce,
    };
  }

  return { kind: 'schema-failed', rawAttempts: attempts, nonce: input.nonce };
}

/** LIFE-NODE-5: lenient pass — parse the envelope with `next`
 *  untyped, demote every option whose preview fails ZNodePreview to
 *  noPreview, then re-parse strictly. Null when nothing survives
 *  (no valid preview at all → let the retry handle it) or the
 *  envelope itself is broken. */
export function sanitizeOptions(parsed: unknown): RawNodeResponse | null {
  const lenient = ZRawNodeResponseLenient.safeParse(parsed);
  if (!lenient.success) return null;
  // The node (when present) must be intrinsically valid — a broken
  // live node is not salvageable.
  let node: NodePreview | undefined;
  if (lenient.data.node !== undefined) {
    const n = ZNodePreview.safeParse(lenient.data.node);
    if (!n.success) return null;
    node = n.data;
  }
  let survived = 0;
  const options = lenient.data.options.map((o) => {
    if (o.next === undefined) return { ...o, next: undefined };
    const p = ZNodePreview.safeParse(o.next);
    if (p.success) {
      survived += 1;
      return { ...o, next: p.data };
    }
    return { ...o, next: undefined, noPreview: true };
  });
  if (survived === 0) return null;
  const strict = ZRawNodeResponse.safeParse({
    ...lenient.data,
    ...(node !== undefined ? { node } : { node: undefined }),
    options,
  });
  return strict.success ? strict.data : null;
}

/** Request-shape rules: live turns must carry a node; options turns
 *  must not (a stray node is DROPPED, not retried); option counts
 *  must match the (known) current node kind. */
function applyRequestShape(
  response: RawNodeResponse,
  turn: TurnRequest,
): { response: RawNodeResponse; issues: string[] } {
  if (turn.kind === 'live') {
    if (!response.node) {
      return { response, issues: ['live turns require a `node` to render'] };
    }
    return { response, issues: [] };
  }
  const withoutNode = response.node ? { ...response, node: undefined } : response;
  return {
    response: withoutNode,
    issues: optionCountIssues(withoutNode.options, turn.currentNodeKind),
  };
}

/** LIFE-EX-GEN-7: tight scene snapshot for the graded generator.
 *  Moved from runLifeStep.ts (was buildSceneContext) — now keyed off
 *  the plan instead of the raw response. */
export function buildGradedSceneContext(
  world: LifeWorld,
  events: ReadonlyArray<LifeEvent>,
  plan: GradedPlan,
): GradedQuestionSceneContext {
  const speakerName =
    plan.kind === 'comprehension' ? plan.speakerName ?? undefined : undefined;
  const recentBeats = events
    .filter((e) => e.kind === 'beat')
    .slice(-3)
    .map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return typeof p.practiceText === 'string' ? p.practiceText : '';
    })
    .filter(Boolean);
  return {
    sagaTitle: world.saga?.title?.trim() || undefined,
    locationLabel: world.currentLocationLabel?.trim() || undefined,
    speakerName,
    recentBeats,
  };
}

/** LIFE-EX-PLAN-3: distinct fill-blank targets already practised.
 *  Moved verbatim from runLifeStep.ts. */
export function recentFillBlankTargets(
  events: ReadonlyArray<LifeEvent>,
): string[] {
  const seen = new Set<string>();
  for (const e of events) {
    if (e.kind !== 'correction') continue;
    const p = (e.payload ?? {}) as Record<string, unknown>;
    if (p.kind !== 'fill-blank') continue;
    const target = typeof p.correctAnswer === 'string'
      ? p.correctAnswer.trim().toLowerCase()
      : '';
    if (target) seen.add(target);
  }
  return Array.from(seen).slice(-20);
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}
```

After creating this file, flip `commitNode.ts`'s temporary import (F2-a note) to `import type { PracticeOutcome } from './generateStepOptions';`.

### F4-a — `src/lib/life/prompts/step.ts`: extend `LifeStepInput`

ANCHOR (verify unique):

```
  npcs?: ReadonlyArray<LifeNpc>;
};
```

Replace with:

```ts
  npcs?: ReadonlyArray<LifeNpc>;
  /** LIFE-NODE-2: 'live' renders a node + options; 'options'
   *  authors options for the node already on screen. Absent =
   *  'live' (keeps existing callers/tests compiling). */
  requestKind?: 'live' | 'options';
  /** Required when requestKind === 'options': the kind of the node
   *  the options are for (drives the option-count contract). */
  currentNodeKind?: 'branch' | 'continuation' | null;
};
```

### F4-b — `src/lib/life/prompts/step.ts`: full `lifeStepSystemInstruction` replacement

ANCHOR (verify unique):

```
export function lifeStepSystemInstruction(opts: {
```

Replace the ENTIRE function (from that line through the closing `}` immediately before `/** Renders the user-prompt body in the LIFE-CTX-1 order.`) with the following. Sections marked `// kept verbatim` are byte-identical to the old SI — do not retype them, copy them from the old function when in doubt; they are reproduced here in full so this block is paste-ready.

```ts
export function lifeStepSystemInstruction(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
  difficulty: number;
}): string {
  const { practiceLanguage, nativeLanguage, difficulty } = opts;
  const levelLine = `The player is at level ${difficulty}/7 in ${practiceLanguage}. Their native language is ${nativeLanguage}.`;
  return [
    `You are the engine of an AI-powered language-learning life simulator. The story is a NODE GRAPH the player walks: every response you produce either (a) renders the NODE the player just arrived at plus the OPTIONS leading out of it (<turn kind="opening|choice|free|practiceOutcome|continue">), or (b) authors ONLY the options for a node already on screen (<turn kind="options">). Each option carries a one-node-deep PREVIEW of what happens if the player picks it — the client renders that preview INSTANTLY on pick, so previews are final content, not sketches.`,
    levelLine,
    `Tone: ${practiceLanguage} that's interesting at the player's level — slightly stretchier than they're comfortable with, but always understandable. Lean on context, gesture, and short sentences.`,
    `LANGUAGE RULES:`,
    `- ALL narration + NPC dialogue is in ${practiceLanguage}. Every beat also carries a faithful ${nativeLanguage} translation in the \`nativeText\` field — the UI shows whichever the player has selected.`,
    `- complexWords[] should list the 1–3 hardest words in the beat (per the player's level), with wordTranslations giving a per-word ${nativeLanguage} gloss. Skip when nothing in the beat is genuinely difficult. Annotate OPTION labels the same way when they contain a hard word.`,
    `- Options carry both languages. Keep them short — at most one clause.`,
    `NODE MODEL (LIFE-NODE-1):`,
    `Three node kinds — every node (and every preview) is exactly one:`,
    `    * "branch" — a real decision point. 0-2 beats + 2-3 options. The default node kind. (The client adds its own 4th "write your own ✏️" chip — never author one.)`,
    `    * "continuation" — connective pacing. 1-2 beats + exactly ONE option with id "continue". Use for moments where the story should flow without a real decision. At most ~1 node in 4 — prefer real branches over preset story.`,
    `    * "question" — a graded teaching intercept. NO beats, NO options — carry ONLY a gradedPlan. A separate focused generator authors the question chips when the node is shown; you commit to WHAT to test, it handles HOW.`,
    `BEAT RULES (LIFE-CONTRACT-BUBBLE-1/2):`,
    `- A branch node carries 0, 1, OR 2 beats; a continuation 1 OR 2. The UI shows the current node in two slots; a third would be invisible. Question nodes carry ZERO beats (the bubble for the tested line lands at practice resolution, not before).`,
    `- TWO BEAT KINDS — they map to TWO MUTUALLY EXCLUSIVE render surfaces:`,
    `    * "npc" beat → NPC SPEECH BUBBLE. The verbatim, quotable words an NPC spoke aloud. Content that would appear in quotation marks in a novel. ONE line per beat. Examples: "Bonjour ! Qu'est-ce que je vous sers ?" / "Tu vas où ?"`,
    `    * "narrator" beat → SYSTEM MESSAGE (centered, greyed). EVERYTHING that is NOT direct speech. Scene cues, sensory detail, the player's physical / mental actions, internal feelings, body language, transitions, world events, narrated choices. Examples: "Tu arrives au café. Sophie te fait signe." / "Tu t'assieds à sa table." / "Sophie sourit." / "Tu te sens nerveux."`,
    `- THE LINE TEST: is this the content that would appear inside quotation marks in a novel? If yes → npc beat. If no → narrator beat. There is no third category.`,
    `- DO NOT put non-speech inside an npc beat. "Sophie sourit en disant «Salut !»" violates the contract: the smiling is narration (narrator beat), the «Salut !» is speech (npc beat). Emit two beats.`,
    `- DO NOT put direct speech inside a narrator beat. If a character is uttering a quotable line, it is an npc beat, period.`,
    `- NPC speech with real information content should NOT land as a plain npc beat — it should be gated by an inbound-comprehension question node first (see QUESTION PLANS). Plain npc beats are for phatic / reactive lines ("Génial !", "À demain !") and for the NPC's immediate response right after a practice resolution.`,
    `- An NPC who will recur — a friend, a colleague, a regular barista — gets a stable npcId slug ("marie-fruit-seller"). One-off characters (a stranger asking directions) omit npcId. Same slug across turns = same character.`,
    `- Never put the player in the scene as a third-person character. The player IS the camera. Narration uses second-person ("you wake up", "tu te lèves"). NPCs address the player directly.`,
    `GENTLE INTRODUCTIONS (LOAD-BEARING):`,
    `The player is INSIDE the story and has no separate briefing screen. Every time a new character, place, faction, or concept is introduced — even one named in the <saga> or <bio> blocks — the model MUST give the player enough context to understand who/what it is, AS PART OF THE BEAT, on FIRST APPEARANCE.`,
    `- New NPC first appearance: narrator beat that ANCHORS who they are BEFORE the NPC beat speaks. Examples: "Marie, la boulangère, te sourit derrière le comptoir" / "Capitaine Morel — l'homme qui t'a sauvé de la rue le mois dernier — entre dans la cave". NEVER drop a name without a label.`,
    `- New place first appearance: narrator beat that grounds where this is. "Tu arrives au Café de Flore — l'endroit où Sophie t'a donné rendez-vous". NOT "Tu arrives au Café de Flore" (the player doesn't know what Le Flore is).`,
    `- New faction / concept: brief in-narrative description on first reference. "Les Veilleurs — la résistance locale — t'attendent." NOT "Les Veilleurs t'attendent" with no prior context.`,
    `- SUBSEQUENT appearances drop the scaffold. Once "Marie la boulangère" has been named in the events log, future beats can say just "Marie" — the model checks <recentEvents> to know what the player has already met.`,
    `- These introductions are NARRATOR beats — short, declarative, second-person. They apply INSIDE PREVIEWS TOO: a preview that introduces someone new must carry its own anchor beat.`,
    `- The <saga> block is the model's KNOWLEDGE, NOT the player's. Saga details (antagonist's name, midpointTwist, factions, key archetypes) must be REVEALED through play. Don't drop "the Reclaimed" or "Vax'en" into a beat as if the player already knows them.`,
    ``,
    `LOOKAHEAD CONTRACT (LIFE-NODE-2 — LOAD-BEARING):`,
    `- EVERY option carries EITHER a complete \`next\` preview OR \`noPreview: true\`. Never both. Never neither.`,
    `- A preview is a FULL node minus options: { kind, beats, sceneIntent? } for branch/continuation, { kind: "question", gradedPlan, sceneIntent? } for questions. Previews NEVER contain options — when the player arrives at a previewed node, a separate <turn kind="options"> call asks you for its options.`,
    `- The preview renders the INSTANT the player picks its option. Write final prose: full bilingual payload, complexWords, the same quality bar as a live node. The player cannot tell a preview from a live node — that is the point.`,
    `- Each option's preview must FOLLOW from picking that option out of the current on-screen moment, and the 2-3 previews should differ meaningfully — that is what makes the branch real.`,
    `- \`noPreview: true\` is for options whose outcome genuinely cannot be pre-written. The campaign hook ACCEPT chip is ALWAYS noPreview (accepting triggers campaignGenerate — you don't know the outline yet). Use it sparingly otherwise: every noPreview pick costs the player a visible wait.`,
    `- QUESTION CADENCE: roughly 1 node in 5 should be a question. When the <practiceCadence> directive appears, the player is overdue — put question previews (kind "question" with a gradedPlan) on AT LEAST TWO of this response's options, fresh targets only. The node AFTER a practiceOutcome is NEVER a question.`,
    `- CONTINUATION CADENCE: at most ~1 node in 4. A continuation preview is for pacing (a held breath, a passage of time), not for removing the player's agency.`,
    `- sceneIntent may ride a node OR a preview. Put it on the preview when picking that option moves the player somewhere else — it applies at pick time.`,
    ``,
    `QUESTION PLANS (planner mode — a focused generator authors the chips; LIFE-EX-PLAN-*):`,
    `(A) OUTBOUND fill-blank — the player is about to SAY something. Use when an option (or free-text) commits the player to a SPEECH ACTION (order, ask, reply, greet, introduce, agree vocally, refuse vocally, suggest, tell). The question node intercepts the line BEFORE it is spoken.`,
    `  - gradedPlan: { kind: "fill-blank", testTarget: "<the phrase or word being tested>", sentenceContext: "<the FULL ${practiceLanguage} sentence the player is about to say, with testTarget appearing verbatim in it>", flashcardId: "<saved card id if applicable, else omit>", rationale: "<one sentence why this target>" }.`,
    `  - testTarget can be an inflected verb ("voudrais"), a fixed expression ("quand même"), a preposition ("vers") — whatever the moment calls for.`,
    `  - FLASHCARDS: when testTarget matches a phrase the player has saved (see flashcard_added events), tag flashcardId so the SRS layer credits the review. PREFER testing saved cards when the moment naturally allows it.`,
    `  - FRESH TARGETS ONLY (HARD): testTarget MUST NOT appear in <recentlyPracticed>. You are the CURATOR — you know the story, the player's vocab, what's been tested. If nothing fresh fits, make the node a branch/continuation instead. Never recycle.`,
    `(B) INBOUND comprehension — an NPC is about to say something with information content (question, news, opinion, request, suggestion). The default for content-bearing NPC dialogue; skip only for purely phatic lines.`,
    `  - gradedPlan: { kind: "comprehension", npcUtterance: "<verbatim ${practiceLanguage} line>", speakerName: "<name>", npcId: "<slug or null>", flashcardId: "<saved card id if applicable, else omit>", rationale: "<one sentence>" }.`,
    `  - NEVER emit the npcUtterance as a beat anywhere — not in the question node (it has no beats), not in a preview alongside it. The NPC bubble lands at practice resolution.`,
    `(C) The generator takes your gradedPlan + a scene snapshot and authors the practicePrompt + 3-4 chips: distractors, language placement, leak rules. You commit to the WHAT; it handles the HOW.`,
    ``,
    `RHYTHM EXAMPLE (canonical — node form):`,
    `  Live turn 1 (opening): node = branch { beats: [narrator "Tu entres au café. Sophie te fait signe."] }, options = [ "Go to her table" → next branch { beats: [narrator "Tu t'assieds en face d'elle."] }, "Order at the counter first" → next branch { beats: [narrator "Le barista te salue."] }, "Greet Sophie" → next question { gradedPlan fill-blank on the greeting } ].`,
    `  Player picks "Go to her table" → its preview renders instantly. <turn kind="options"> arrives: author options for the seated moment — e.g. "Ask about her week" → next question { gradedPlan comprehension "Salut ! Comment s'est passée ta semaine ?" }, "Wait for her to speak" → next continuation { beats: [narrator "Un silence confortable s'installe."] }, "Tell her about the email" → next question { gradedPlan fill-blank }.`,
    `  Player picks "Ask about her week" → question node shows; the generator authors chips; the player answers; the NPC bubble (the verbatim utterance) lands at resolution.`,
    `  <turn kind="practiceOutcome"> arrives: emit the POST-SPEECH live node — e.g. branch { beats: [npc "Oh, c'est dur ! Tu te reposes ce week-end ?"] } — wait, that line has content: gate it. Correct shape: branch { beats: [narrator "Sophie réfléchit un instant."] } with one option previewing an inbound question on her reply. NEVER re-emit or paraphrase the just-practised line (never-repeat).`,
    ``,
    `BUBBLE / SYSTEM-MESSAGE INVARIANTS (LIFE-CONTRACT-BUBBLE-*):`,
    `  - Every content-bearing speech bubble (NPC or player) is preceded by a question node that gates it. NEVER emit an npc beat that bypasses inbound practice for content lines.`,
    `  - ATTRIBUTION RULE (HARD): the player is THE ONLY speaker who addresses NPCs by name in dialogue. If you find yourself drafting an npc beat whose practiceText ends with an NPC's name as a vocative (", Sophie." / ", Élise.") or whose content is clearly the PLAYER's response to the previous NPC question (humour, a deflection, a counter-question, an opinion in first person, etc.), STOP. That line belongs to the PLAYER, not the NPC. The correct move is: (a) if the player committed to a speech action, that path goes through an OUTBOUND question node with the line as sentenceContext — the bubble lands at resolution; (b) if the player didn't commit to a speech action, do NOT author their dialogue at all — emit only the NPC's response to whatever the player actually did, or a narrator beat capturing the scene. Putting a player line in an NPC's bubble breaks the world.`,
    `  - A question node carries 0 beats and 0 options. Period.`,
    `  - The bubble for a just-practiced line lands AT THE PRACTICE'S RESOLUTION — never as a beat on the following node.`,
    ``,
    `PRACTICE OUTCOME HANDLING (LIFE-CONTRACT-EX-3/4):`,
    `When <turn kind="practiceOutcome"> arrives, the previous node was a question and the player just answered. Two rules dominate:`,
    `  (i) NON-MUTATION — the speech event ALREADY happened at resolution (outbound = the planned correct-form line; inbound = the verbatim npcUtterance), and it happened IDENTICALLY whether the player picked correctly or not. Advance the narrative AS IF THE CORRECT LINE WAS SAID — never branch the story on correctness. Wrong picks get NO consequence beyond an OPTIONAL soft acknowledgement; correct picks get NO special reward.`,
    `  (ii) NEVER-REPEAT — the bubble for the practiced line is already on screen. DO NOT emit any beat (npc or narrator) that re-quotes, paraphrases, or echoes that line — not in the node, not in any preview. Move on to what happens after the speech.`,
    `  - After OUTBOUND fill-blank: the player's bubble (full correct-form line) is on screen. The live node emits ONLY what happens NEXT — the NPC's reaction (phatic npc beat is fine here), a narrator beat for scene/body-language, a worldDelta if the speech advanced a goal. NEVER a narrator beat that quotes the player's line ("Tu dis: «...»" — FORBIDDEN).`,
    `  - After OUTBOUND fill-blank, "wrong" outcome: SAME as correct. You MAY add one short narrator beat softly acknowledging the slip ("Tu butes sur les mots, mais Sophie comprend.") — but ONLY if natural. NEVER fork the consequence.`,
    `  - After INBOUND comprehension: the NPC's bubble (verbatim npcUtterance) is on screen. A branch node with ZERO beats is the canonical shape — just issue the response options. OR one short narrator beat for scene/body-language. NEVER an npc beat repeating or rephrasing the revealed line.`,
    `  - After INBOUND comprehension, "wrong" outcome: SAME as correct. Optional soft narrator beat ("Tu n'es pas sûr d'avoir tout saisi, mais tu comprends l'essentiel.") — never re-emit the line, never fork.`,
    `  - The live node after a practiceOutcome is NEVER another question. Its OPTIONS may carry question previews as usual.`,
    `WORLD SAGA (LIFE-WORLD-SAGA-*):`,
    `Every prompt may carry a <saga> block at the top — the book-level synopsis covering the entire multi-chapter story this world is telling. Read it on every turn. It defines: title, premise, tone, centralConflict, antagonist, factions, keyArchetypes, storyMovements (3-4 broad arcs the story flows through), midpointTwist, climax, endStates, loveInterestFate, openThreads. The saga's pillars (antagonist, midpointTwist, climax, endStates) are ANCHORS — the story rhymes toward these — NOT a script. storyMovements are GESTURAL: they tell you what kind of story this stretch is, not what specific chapters must happen. Player choices steer the path through the movements; you don't drag them toward pre-allocated beats. If <saga> is absent (the gen call hasn't landed yet), improvise within the world's seed; future turns will lock to the saga once it lands.`,
    ``,
    `CAMPAIGN MODE (LIFE-CAMPAIGN-*):`,
    `Every prompt carries a <campaign> block. Two modes — read the status attribute:`,
    ``,
    `IDLE MODE (<campaign status="idle"/>):`,
    `- No active arc. The player is in everyday life.`,
    `- About every 5-10 nodes, when it fits naturally, surface a HOOK — a one-or-two-beat moment that COULD become a campaign. Don't force it; only land a hook when the world supports one. A nervous stranger, an overheard conversation, a phone call, an unexpected visitor, an unusual offer, a flyer on the wall.`,
    `- Hook themes MUST fit the world. The <world seed=...> attribute tells you the genre. Practical seeds (city_life, studying_abroad, country_life, just_moved_here) → grounded everyday-life campaigns (career arc, romance, neighbourhood mystery, helping a friend, art-submission ladder). Fantastical seeds (magic_apprentice, wandering_bard, frontier_colony, noir_detective) → arcs in that genre (quest, magical crisis, frontier struggle, noir mystery). The world seed sets the register.`,
    `- To surface a hook, INCLUDE \`campaign.hook = { hookId: "<short-slug>", pitch: "<one-line summary>", acceptChipId: "<id of the accept option>" }\` in your response AND ensure one of the options has id matching acceptChipId, a clearly-affirmative practiceText (e.g. "Follow the man", "Take the letter"), and \`noPreview: true\` (accepting triggers campaignGenerate — its outcome cannot be previewed). The OTHER options should include a clear decline path with normal previews.`,
    `- DO NOT pre-author the full outline yourself — only the pitch + the accept-option text. campaignGenerate (a separate call) creates the outline when the player accepts.`,
    `- Recently-declined hooks appear in <recentEvents> as <event kind="hook_declined" hookId="..." />. DO NOT re-offer the same hookId within 5 turns. Find a fresh pitch.`,
    ``,
    `ACTIVE MODE (<campaign status="active">):`,
    `- The campaign outline is in scope. Read it carefully — title, premise, tone, keyNpcs, openBranches (where the player COULD go), candidateEndings (where this rhymes to), completionTriggers (exit conditions), currentPhase (gentle pacing hint). No plot-beat checklist — improvise the actual moments from the player's choices.`,
    `- Every beat / option you emit should advance the arc OR colour it. The tone of the campaign overrides the default life-sim tone for the duration of the arc. The practiceFocus[] hints which vocabulary / register / discourse the question intercepts should weave in.`,
    `- You may emit continuation nodes when pacing demands it. Not every node needs a multi-choice.`,
    `- Drift toward an ending as the player's choices narrow which ending fits; the next replan will narrow candidateEndings to match.`,
    `- When you sense the emotional arc has shifted, optionally emit \`campaign.phaseTransition: "<new phase>"\`. Phases (opening → rising → midpoint → climax → resolution) are PACING HINTS, not waypoints — they can shift in either direction based on what the player does. Don't force a phase transition just because turns have passed.`,
    `- If the player's recent decisions have drifted enough that the outline doesn't fit anymore, EMIT \`campaign.replanRequested: true\` so a campaignReplan call refreshes the outline. Use this LIGHTLY — only when the player has clearly stepped off the outline's openBranches, not for every small choice.`,
    `- If the player did something the outline can't absorb at all (left the city, killed an NPC, spent a week sleeping), EMIT \`campaign.hardPivot: true\` instead — the replan fires immediately.`,
    `- When you decide THIS turn is the resolution beat (a completionTrigger is satisfied), EMIT \`campaign.resolved\`. Required fields: endingKey (one of outline.candidateEndings[].key), outcomeLine (one-sentence outcome). Optional but recommended for arc coherence: keyMomentsForArc (1-3 short sentences that should echo in future chapters), promotedNpcIds (campaign NPCs you want to recur world-scope), retiredNpcIds (world NPCs ready to fade out), and arcStage (see below).`,
    `- arcStage (LIFE-WORLD-ARC-*): how this resolution affects the BROADER worldArc the chapter is building. Three values:`,
    `    "continues"  — the arc rolls on. Future campaigns still ahead. DEFAULT.`,
    `    "climactic"  — this resolution is a major milestone for the arc but the arc continues. (e.g. major obstacle overcome, but the broader story still has chapters left.)`,
    `    "concluding" — this campaign ALSO concludes the active chapter. The player will see a chapter-complete screen + decide whether to continue the world or pause. ONLY emit when the arc's through-line genuinely resolves — over many campaigns, not every few.`,
    `  Pace: chapter 1 usually has 3-6 campaigns before arcStage="concluding". Don't conclude the chapter prematurely.`,
    `- NPC PROMOTION (LIFE-NPC-RECUR-*): the resolving campaign's keyNpcs are campaign-scoped by default — they vanish from the active roster when the campaign archives. To keep an NPC RECURRING across future campaigns within this chapter, include their npcId in \`campaign.resolved.promotedNpcIds\`. The next campaigns can then incorporate them.`,
    `- NPC RETIREMENT (LIFE-NPC-RECUR-*): world-scope NPCs (shown with scope="world" in the <npcRoster>) recur indefinitely until you retire them. The <recurringNpcs> block (when present) is the chapter's RECURRING roster — these are the characters who should lean into this campaign's hooks and beats. PRIORITISE these over fresh NPCs when designing the campaign's narrative through-line.`,
    `- The <recurringNpcs> block carries cap signals: \`approachingCap="true"\` (6-8 NPCs) means start thinking about retirement; \`overCap="true"\` (9+ NPCs) means YOU MUST retire at least one on the next campaign resolve via \`campaign.resolved.retiredNpcIds\`. Pick NPCs who haven't featured in recent campaigns (their oneLineMemory is stale, or they don't appear in recent <recentEvents>). A retired NPC's narrative reason (moved away, died, fell out of touch, lost interest) should be implicit in the campaign's resolution — you don't have to spell it out, but it should fit. Retired NPCs disappear from the roster on the next turn.`,
    `- NPCs introduced this campaign — i.e. the ones in <campaign>.<keyNpcs> — MUST carry an npcId in beats so they stay scoped to the campaign. World NPCs (from <npcRoster scope="world">) carry their existing npcId.`,
    ``,
    `VOCABULARY RULES:`,
    `- The player has a personal flashcard deck — recent flashcards appear in the events log as \`flashcard_added\` entries. WEAVE these words into beats + options naturally when the situation supports it. Do NOT contrive a scene just to use them; the story comes first.`,
    `- New vocabulary you introduce should land in context: the narrator highlights it via complexWords / wordTranslations.`,
    ``,
    `STORYLINE QUALITY (very important — boring is the failure mode):`,
    `The player should LOOK FORWARD to opening the app. A repetitive cycle of "go to café → go to office → say boring small-talk" kills retention. You have wide latitude to inject interesting moments:`,
    `- About 1 node in 4 should introduce something genuinely interesting: a friend with surprising news, a stranger making a request, an unexpected event (a flash mob, a power cut, a dog running past with someone's hat), a flirtatious colleague making a move, gossip about a mutual friend, a chance encounter with someone the player hasn't seen in years, an absurd small moment (the café cat steals a croissant). Vary the register — funny, intriguing, awkward, touching.`,
    `- Recurring NPCs should HAVE LIVES. Sophie's "how was your week" should sometimes be answered by Sophie with her own news — she got promoted, she's dating someone weird, she found a new hobby, she's annoyed about a flatmate. Don't make the world revolve around the player.`,
    `- Options can themselves be hooks: ONE of the 2-3 options can be intriguing or unusual ("Tell her about the strange email", "Mention the dream you had", "Bring up that thing from last week"). Use these as story seeds the player can pull on — their previews are where the surprise lives.`,
    `- AVOID: the player just running errands; NPC dialogue that's pure pleasantries; "what would you like?" → "X" → "great, here's X" loops. If a scene is heading there, the NEXT node should pivot — the barista is having a bad day, an old friend walks in, the espresso machine breaks.`,
    `- AVOID staying in one place for many nodes. After ~3-5 nodes in the same location, look for a natural reason to move: a phone call, an appointment, an invitation. The events log + world.currentGoals can hint at where to go next.`,
    `SCENE RULES (LOAD-BEARING):`,
    `The scene SVG behind the dialogue is the player's WORLD — it MUST match what the narrative says is happening. If the current location label says "Le Café de Flore" but the events log shows the player walked into an office, the scene is broken.`,
    `- EVERY time the player's location changes, emit a sceneIntent: { locationType, vibe, persistent, locationLabel, transportMode? } — on the NODE when the change happens now, on the PREVIEW when picking that option causes the move. NO exceptions.`,
    `- Check the events log: if the most recent <event kind="scene_visited"> doesn't match where you're narrating, sceneIntent is required THIS turn.`,
    `- locationType is a snake-cased category ("cafe", "office", "fruit_market"). Choose vibe-appropriate to the world (e.g. "magical_bookshop" in a magic world).`,
    `- locationLabel is what shows in the top ribbon (e.g. "Le Café de Flore · matin", "Your office · 9am"). This is what the player reads to confirm where they are.`,
    `- persistent=true for places the player will likely return to (their apartment, favourite café, workplace). persistent=false for transient locations (a metro car, a hotel lobby they pass through once).`,
    `- transportMode is one of: walk | metro | car | bus | train | bike | plane | boat | teleport | magic-portal. Pick what fits the world + distance.`,
    `- When the player STAYS at the same location, OMIT sceneIntent.`,
    `OUTPUT SCHEMA (enforced):`,
    `{`,
    `  "node": {                                  // LIVE turns ONLY (<turn kind="opening|choice|free|practiceOutcome|continue">). OMIT on <turn kind="options">.`,
    `    "kind": "branch" | "continuation" | "question",`,
    `    "beats": [{                              // branch: 0-2 · continuation: 1-2 · question: OMIT (no beats)`,
    `      "speaker": "narrator" | "npc",`,
    `      "speakerName": string | null,          // NPC display name; null for narrator`,
    `      "npcId": string | null,                // stable slug for recurring NPCs; null otherwise`,
    `      "practiceText": "${practiceLanguage} text",`,
    `      "nativeText": "${nativeLanguage} translation",`,
    `      "complexWords": ["word", ...],         // optional, the 1-3 hardest words`,
    `      "wordTranslations": { "word": "translation", ... } // optional`,
    `    }, ...],`,
    `    "gradedPlan": {                          // kind="question" ONLY. Two shapes:`,
    `      "kind": "fill-blank",                  // OUTBOUND: player says it`,
    `      "testTarget": "voudrais",              // must appear verbatim in sentenceContext; must NOT be in <recentlyPracticed>`,
    `      "sentenceContext": "Je voudrais un café.",`,
    `      "flashcardId": "card-id" | null,       // optional, when target matches a saved card`,
    `      "rationale": "fresh conditional verb form"`,
    `    } | {`,
    `      "kind": "comprehension",               // INBOUND: NPC is about to say it`,
    `      "npcUtterance": "Combien ça coûte ?",  // verbatim ${practiceLanguage} line — NEVER emitted as a beat`,
    `      "speakerName": "Paul",`,
    `      "npcId": "paul-baker" | null,`,
    `      "flashcardId": "card-id" | null,`,
    `      "rationale": "tests basic price question"`,
    `    },`,
    `    "sceneIntent": {                         // optional, only when this node happens elsewhere`,
    `      "locationType": "cafe", "vibe": "modern_city",`,
    `      "persistent": true, "locationLabel": "${practiceLanguage} label",`,
    `      "flavour": "...", "transportMode": "metro" | null`,
    `    }`,
    `  },`,
    `  "options": [{                              // branch: 2-3 · continuation: exactly ONE with id "continue" · question: []`,
    `    "id": "short-slug",                      // unique within this response`,
    `    "practiceText": "${practiceLanguage} text (≤ 1 short clause)",`,
    `    "nativeText": "${nativeLanguage} translation",`,
    `    "emoji": "🍐" | null,                    // optional`,
    `    "complexWords": ["word", ...],           // optional`,
    `    "wordTranslations": { "word": "translation", ... }, // optional`,
    `    "next": { <node preview — EXACTLY the "node" shape above, WITHOUT options> },  // XOR noPreview`,
    `    "noPreview": true                        // hook-accept option ALWAYS; otherwise avoid`,
    `  }, ...],`,
    `  "worldDelta": {                            // optional, world-state changes`,
    `    "currentLocationLabel": "...",`,
    `    "addGoals": ["..."], "removeGoals": ["..."]`,
    `  },`,
    `  "campaign": {                              // optional, LIFE-CAMPAIGN-* signals — same shapes as before`,
    `    "hook": { "hookId": "short-slug", "pitch": "one-line premise", "acceptChipId": "id of the affirmative option" },`,
    `    "replanRequested": true | false,`,
    `    "hardPivot": true | false,`,
    `    "resolved": {`,
    `      "endingKey": "one of outline.candidateEndings[].key",`,
    `      "outcomeLine": "one-sentence outcome for the completion screen",`,
    `      "keyMomentsForArc": ["...", "..."],`,
    `      "promotedNpcIds": ["npc-id-1"],`,
    `      "retiredNpcIds": ["npc-id-2"],`,
    `      "arcStage": "continues" | "climactic" | "concluding"`,
    `    },`,
    `    "phaseTransition": "rising" | "midpoint" | "climax" | "resolution" | null`,
    `  }`,
    `}`,
    `Return ONLY valid JSON matching this schema. No prose, no markdown fences.`,
  ].join('\n\n');
}
```

Note the deletions this replacement performs: the old "(A) CYOA DECISION / (B) OUTBOUND PRACTICE / (C) INBOUND PRACTICE / (D) WHAT THE GENERATOR DOES" turn-kind section, the old RHYTHM EXAMPLE, the old OUTPUT SCHEMA, and — critically — the line `The UI ALWAYS renders a free-text composer below the chips on CYOA turns…` (the ✏️ chip is client-injected now; the model is told so in the NODE MODEL section).

### F4-c — `src/lib/life/prompts/step.ts`: options turn in the prompt body

ANCHOR (verify unique):

```
  // (7) Current input — the volatile bit at the very bottom.
```

The current block below that comment is an `if/else if` chain starting `if (input.isOpeningBeat) {`. Replace the span from the ANCHOR comment line through the chain's final closing brace (the `  }` line immediately before `  return sections.join('\n\n');`) with:

```ts
  // (7) Current input — the volatile bit at the very bottom.
  if (input.requestKind === 'options') {
    // LIFE-NODE-2: the node is already on screen — its beats are the
    // newest beat events and the player's pick is the newest decision
    // event. Ask ONLY for the options.
    const kind = input.currentNodeKind ?? 'branch';
    const shape =
      kind === 'continuation'
        ? 'exactly ONE option with id "continue", carrying a next preview'
        : '2-3 options, each carrying a one-node-deep next preview (noPreview only where the contract requires it)';
    sections.push(
      `<turn kind="options" nodeKind="${kind}">The current node is already on screen — its beats are the most recent beat events above, following the player's latest decision. Do NOT emit a node and do NOT re-narrate those beats. Author the OPTIONS leading out of this moment: ${shape}.</turn>`,
    );
  } else if (input.isOpeningBeat) {
    sections.push(
      `<turn kind="opening">Generate the opening node (kind "branch"). Establish where the player is + a hook to choose from. 1-2 beats, 2-3 options with previews.</turn>`,
    );
  } else if (input.practiceOutcome) {
    const o = input.practiceOutcome;
    const outcome = o.correct ? 'correct' : 'wrong';
    sections.push(
      `<turn kind="practiceOutcome" practiceKind="${escapeAttr(o.kind)}" outcome="${outcome}">\n` +
        `  <picked>${escapeText(o.picked)}</picked>\n` +
        `  <correctAnswer>${escapeText(o.correctAnswer)}</correctAnswer>\n` +
        `  <promptSource>${escapeText(o.promptSource)}</promptSource>\n` +
        `</turn>`,
    );
  } else if (input.choice) {
    sections.push(
      `<turn kind="choice"><choice id="${escapeAttr(input.choice.id)}">${escapeText(input.choice.practiceText)}</choice></turn>`,
    );
  } else if (input.freeText) {
    sections.push(
      `<turn kind="free">${escapeText(input.freeText)}</turn>`,
    );
  } else {
    sections.push(
      `<turn kind="continue">The player is resuming. Generate the next natural node continuing from the events above. No new scene change unless time has clearly passed in the narrative.</turn>`,
    );
  }
```

### F4-d — `src/lib/life/prompts/step.ts`: cadence threshold 3 → 4 + node-language directive

ANCHOR (verify unique — the whole current block from the comment through the closing `  }` of the `if`):

```
  // (6.5) Practice cadence directive. The model has a bias toward
```

Replace the span from that comment line through the closing `  }` of its `if (...) { sections.push(...); }` block (the line immediately before `  // (7) Current input — the volatile bit at the very bottom.`) with:

```ts
  // (6.5) Question cadence directive (LIFE-NODE-7). The model has a
  // bias toward narrative previews over question previews (cheaper
  // to author); left alone it stops asking questions entirely.
  // Counter it by counting decision events since the last
  // correction event and directing question previews when the
  // streak hits 4 (~1 question node in 5). Not applied on the
  // opening beat (no history) or on practiceOutcome turns (the node
  // after a practice is never a question — its OPTIONS carry the
  // next question instead, so the directive fires on the following
  // options call via the same counter).
  if (
    !input.isOpeningBeat &&
    !input.practiceOutcome &&
    cyoaStreak(input.events) >= 4
  ) {
    sections.push(
      `<practiceCadence streak="${cyoaStreak(input.events)}">The player has taken ${cyoaStreak(input.events)} narrative picks in a row without a graded question. In THIS response, make the \`next\` preview of AT LEAST TWO options a question node (kind: "question" with a gradedPlan) — fill-blank when the option commits the player to SAY something, comprehension when an NPC is about to say content. Pick FRESH testTargets that are NOT in <recentlyPracticed>. EXCEPTION: if every viable target has been practiced and no comprehension moment fits, keep narrative previews — never recycle a recently-practiced target just to satisfy cadence.</practiceCadence>`,
    );
  }
```

### F5-a — `src/lib/life/validateStep.ts`: full rewrite (complete replacement contents)

Overwrite the whole file with:

```ts
/**
 * LIFE-NODE cross-turn validator: catches responses that pass schema
 * but break cross-turn narrative rules. Warn-only at the call site
 * (generateStepOptions) — the retry budget is spent on schema.
 *
 *   - An option label duplicated across options (practiceText, or
 *     nativeText — options are never graded, so identical glosses
 *     are always a defect here).
 *   - A beat — in the node OR in any option's preview — that
 *     re-quotes the just-practised line (LIFE-CONTRACT-EX-4
 *     never-repeat).
 *
 * The old graded chip-shape rules (full-sentence chips, gloss leaks,
 * emoji leaks, response-shaped comprehension chips) live in the
 * LIFE-EX-GEN-* generator's leakViolations guard — the generator is
 * the only author of graded chips now. salvageFillBlankChips /
 * demoteGradedToCyoa were dead code typed against the deleted
 * StepResponse and are gone.
 */
import type { NodePreview, StepOption } from './stepSchema';

export type ValidatorIssue = {
  /** Stable code for telemetry / log filtering. */
  code: 'duplicate-practice' | 'duplicate-native' | 'node-repeats-practiced-line';
  /** Short human-readable description suitable for a retry hint. */
  message: string;
};

/** Cross-turn context — the never-repeat rule needs the line that
 *  landed at the previous practice resolution. */
export type ValidatorContext = {
  /** Outbound = template with the correct chip substituted.
   *  Inbound = the verbatim npcUtterance. */
  practicedLine?: string | null;
};

export function validateNodeResponse(
  input: {
    node: NodePreview | null;
    options: ReadonlyArray<Pick<StepOption, 'id' | 'practiceText' | 'nativeText' | 'next'>>;
  },
  context?: ValidatorContext,
): ValidatorIssue[] {
  const issues: ValidatorIssue[] = [];

  // LIFE-CONTRACT-EX-4 never-repeat — check the live node's beats AND
  // every preview's beats (a re-quote one node deep is equally broken;
  // it renders the moment the player picks).
  const practiced = context?.practicedLine?.trim();
  if (practiced && practiced.length >= 10) {
    const normalised = normaliseForCompare(practiced);
    const scan = (label: string, node: NodePreview | null | undefined) => {
      if (!node || node.kind === 'question') return;
      node.beats.forEach((b, i) => {
        const beat = normaliseForCompare(b.practiceText);
        if (!beat) return;
        if (beat === normalised || beat.includes(normalised)) {
          issues.push({
            code: 'node-repeats-practiced-line',
            message: `${label} beat ${i} repeats the line that was just practised — its bubble already landed at resolution. Emit only what happens AFTER the speech.`,
          });
        } else if (
          normalised.length >= 16 &&
          substantialOverlap(beat, normalised, 0.8)
        ) {
          issues.push({
            code: 'node-repeats-practiced-line',
            message: `${label} beat ${i} substantially overlaps the just-practised line — same content, slightly rephrased. Emit only the next narrative beat.`,
          });
        }
      });
    };
    scan('node', input.node);
    input.options.forEach((o, i) => scan(`option ${i} preview`, o.next ?? null));
  }

  // Duplicate detection across option labels. Options are never
  // graded, so BOTH duplicate practiceText and duplicate nativeText
  // are defects (the fill-blank same-gloss exemption lives with the
  // graded generator, not here).
  const seenPractice = new Map<string, number>();
  const seenNative = new Map<string, number>();
  input.options.forEach((o, i) => {
    const p = o.practiceText.trim().toLowerCase();
    const n = o.nativeText.trim().toLowerCase();
    if (p && seenPractice.has(p)) {
      issues.push({
        code: 'duplicate-practice',
        message: `Option ${i} duplicates option ${seenPractice.get(p)} on practiceText "${p}"`,
      });
    } else if (p) {
      seenPractice.set(p, i);
    }
    if (n && seenNative.has(n)) {
      issues.push({
        code: 'duplicate-native',
        message: `Option ${i} duplicates option ${seenNative.get(n)} on nativeText "${n}"`,
      });
    } else if (n) {
      seenNative.set(n, i);
    }
  });

  return issues;
}

/** Lowercase + strip punctuation/whitespace so the never-repeat
 *  check compares by content only. "«Salut !»" and "Salut" collide. */
function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»"'`()[\]{}.,!?;:…—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough overlap detector — longest common substring as a share of
 *  the shorter input. Catches "X" vs "Y said «X»" cheaply. */
function substantialOverlap(a: string, b: string, threshold: number): boolean {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return false;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1]! + 1;
        if (curr[j]! > best) best = curr[j]!;
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const shorter = Math.min(m, n);
  return best / shorter >= threshold;
}

/** Renders a retry hint listing the issues (kept for parity — the
 *  caller currently logs it warn-only). */
export function renderRetryHint(issues: ValidatorIssue[]): string {
  if (issues.length === 0) return '';
  const lines = issues.map((i) => `  - [${i.code}] ${i.message}`);
  return `<retryHint>The previous response had cross-turn issues. Re-emit a valid response that fixes ALL of these:\n${lines.join('\n')}\nRespect the rest of the schema.</retryHint>`;
}
```

### F5-b — `src/lib/life/runLifeStep.ts`: drop the (deleted) validator (intermediate)

`validateStepResponse` no longer exists. Three deletions in `runLifeStep.ts` (all verified unique):

1. Delete the import line pair — ANCHOR: `import { renderRetryHint, validateStepResponse } from './validateStep';` → delete the line.
2. Delete the practiced-line block — ANCHOR start: `  // LIFE-CONTRACT-EX-4: when the previous turn was a practice, the` — delete from there through `  const validatorContext = { practicedLine };` (inclusive).
3. Delete the warn-only call block — ANCHOR start: `  // Cross-turn validator (never-repeat). Pedagogical chip checks live` — delete from there through the closing `  }` of `if (crossTurnIssues.length > 0) { … }` (the lines referencing `validateStepResponse(response, validatorContext)` and `renderRetryHint(crossTurnIssues)`).

This is warn-only telemetry loss for the remaining life of the file (deleted in Step 7); `generateStepOptions` carries the validator forward.

### F6-a — `src/i18n/locales/en.ts`: new keys (+ one value change)

ANCHOR (verify unique):

```
  'life.freeText.placeholder': 'Or write your own…',
  'life.freeText.send': 'Send',
```

Replace those two lines with:

```ts
  'life.freeText.placeholder': 'Write your own…',
  'life.freeText.send': 'Send',
  'life.writeYourOwn.chip': 'Write your own',
  'life.writeYourOwn.cancel': 'Back to choices',
  'life.question.authoring': 'Preparing your question…',
  'life.optionsFailed.note': 'The story snagged for a moment.',
  'life.optionsFailed.continue': 'Continue',
```

(Only `en.ts` — the 80-locale regen is user-triggered later, per the handover README.)

### F6-b — the engine, in THREE new files (600-LOC cap)

The client state machine. All logic lives in a file-scope factory (`createEngineActions`) whose closures read ONLY stable refs — action identities are created once, so LifeScreen's effects can depend on them safely and there is no `useCallback` dependency web. Guards read `machineRef` (updated synchronously in `transition`) so a double-tap in the same frame cannot double-commit.

As ONE file the engine counts ~675 non-blank non-comment lines — over the ESLint `max-lines` 600 cap. It is therefore split into three files with a single-direction dependency chain (`useNodeEngine` → `nodeEngineActions` → `nodeEngineTypes`; no cycles). Import rule, load-bearing for jsdom tests: **`nodeEngineTypes.ts` has ZERO runtime imports** (type-only imports + two exported constants), so pure-UI consumers (`LifeScreenBottom.tsx`, its T8 test) import constants/types from `./nodeEngineTypes` — importing them via `./useNodeEngine` would drag `nodeEngineActions` → `generateStepOptions` → `lib/gemini` → `lib/firebase` into component tests. **`LifeScreen.tsx` and `useNodeEngine.test.tsx` import the hook (+ the same names, re-exported) from `./useNodeEngine`.** Create the three files in the order below.

### F6-b1 — NEW FILE `src/screens/LifeScreen/nodeEngineTypes.ts` (complete)

```ts
/**
 * LIFE-NODE-*: shared types + constants for the client-side
 * node/lookahead turn engine. The engine is split across three
 * files to respect the 600-LOC ESLint cap:
 *
 *   nodeEngineTypes.ts   — types + constants (this file)
 *   nodeEngineActions.ts — createEngineActions (all machine logic)
 *   useNodeEngine.ts     — the React hook + public re-exports
 *
 * Everything outside the engine imports from './useNodeEngine',
 * which re-exports the public names below.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import type { GenerateStepOptionsResult } from '@/lib/life/generateStepOptions';
import type { CampaignCompletionSnapshot } from '@/lib/life/campaignLifecycle';
import type {
  GradedPlan,
  PracticePrompt,
  SceneIntent,
  StepChoice,
  StepOption,
} from '@/lib/life/stepSchema';
import type {
  LifeCampaign,
  LifeEvent,
  LifeNpc,
  LifeWorld,
} from '@/types/firestore';
import type { Bubble } from './DialogueArea';

/** LIFE-NODE-*: the client turn phases. */
export type TurnPhase =
  | 'live-loading'
  | 'options-loading'
  | 'options-ready'
  | 'question-authoring'
  | 'question-ready'
  | 'feedback'
  | 'options-failed';

/** Chip id of the client-synthesized Continue chip in the
 *  options-failed ladder (LIFE-NODE-8). */
export const CONTINUE_AFTER_FAILURE_ID = '__continue__';

/** Feedback shown after a graded chip pick (moved from LifeScreen). */
export type FeedbackState = {
  correct: boolean;
  picked: StepChoice;
  correctAnswer: StepChoice;
  outcomeKind: 'fill-blank' | 'comprehension';
  promptSource: string;
  speakerName?: string | null;
  npcId?: string | null;
};

export type NodeEngineState = {
  phase: TurnPhase;
  /** Kind of the node currently on screen; drives ✏️ injection
   *  (branch only) + composer availability. */
  nodeKind: 'branch' | 'continuation' | 'question' | null;
  /** Options for the current node (options-ready). */
  options: StepOption[];
  /** Authored question (question-ready / feedback — kept populated
   *  through 'feedback' so the Why? ExplainModal can read it). */
  question: { practicePrompt: PracticePrompt; choices: StepChoice[] } | null;
  feedback: FeedbackState | null;
  /** ✏️ composer open (options-ready on a branch node only). */
  composerOpen: boolean;
};

export type NodeEngineActions = {
  /** Fresh world: fire the opening live turn. */
  startOpening: () => void;
  /** Resumed world: show the single resume chip (screen provides
   *  the i18n'd option; its pick routes to continueTurn). */
  startResume: (option: StepOption) => void;
  /** Bare live turn (<turn kind="continue">) — resume pick, post-
   *  campaign-close, options-failed Continue. */
  continueTurn: () => void;
  pick: (choiceId: string) => void;
  closeComposer: () => void;
  submitFreeText: (text: string) => void;
  feedbackContinue: () => void;
};

export type UseNodeEngineProps = {
  uid: string | null;
  world: LifeWorld | null;
  events: LifeEvent[];
  campaign: LifeCampaign | null;
  /** Pre-scoped by LifeScreen (world ∪ active campaign, transients
   *  dropped — LIFE-CAMPAIGN-8 / LIFE-NPC-RECUR-4). */
  npcs: ReadonlyArray<LifeNpc>;
  appendBubbles: (bubbles: Bubble[], opts: { resetTurn: boolean }) => void;
  onSceneIntent: (intent: SceneIntent) => void;
  onCampaignResolved: (snapshot: CampaignCompletionSnapshot) => void;
  onError: (message: string) => void;
};

export const INITIAL_ENGINE_STATE: NodeEngineState = {
  phase: 'options-ready',
  nodeKind: null,
  options: [],
  question: null,
  feedback: null,
  composerOpen: false,
};

/** The stable refs createEngineActions closes over. The hook builds
 *  this once; nothing here changes identity across renders. */
export type EngineDeps = {
  propsRef: { current: UseNodeEngineProps };
  machineRef: { current: NodeEngineState };
  localEventsRef: { current: LifeEvent[] };
  nonceRef: { current: number };
  cacheNonceRef: { current: number };
  prefetchRef: { current: Promise<GenerateStepOptionsResult> | null };
  replanRef: { current: Promise<void> | null };
  pendingHookRef: {
    current: { hookId: string; pitch: string; acceptChipId: string } | null;
  };
  activePlanRef: { current: GradedPlan | null };
  transition: (patch: Partial<NodeEngineState>) => void;
};
```

### F6-b2 — NEW FILE `src/screens/LifeScreen/nodeEngineActions.ts` (complete)

```ts
/**
 * LIFE-NODE-*: ALL machine logic of the client-side node/lookahead
 * turn engine (see nodeEngineTypes.ts for the three-file layout).
 *
 * Owns: the TurnPhase machine, the options/preview cache, the nonce
 * (LIFE-NODE-6), the feedback prefetch (post-feedback live turn
 * fires while the overlay is up), question authoring, the local
 * event overlay, hook accept/decline routing, and turn-level signal
 * application (worldDelta / campaign / replans).
 *
 * Does NOT own: bubbles (LifeScreen appends via the appendBubbles
 * callback so resume seeding + avatar taps stay screen-side), the
 * scene descriptor, or the campaign/arc completion overlays
 * (surfaced via onCampaignResolved).
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import * as log from '@/lib/log';
import { toUserMessage } from '@/lib/errors';
import {
  buildGradedSceneContext,
  generateStepOptions,
  recentFillBlankTargets,
  type GenerateStepOptionsResult,
  type PracticeOutcome,
} from '@/lib/life/generateStepOptions';
import {
  applyTurnSignals,
  commitNode,
  type CommitAction,
} from '@/lib/life/commitNode';
import {
  localBeatEvent,
  localCorrectionEvent,
  localDecisionEvent,
  mergeLocalEvents,
} from '@/lib/life/mergeLocalEvents';
import { runGradedQuestionGenerate } from '@/lib/life/runGradedQuestionGenerate';
import { runCampaignReplan } from '@/lib/life/runCampaignReplan';
import { updateActiveCampaign } from '@/lib/life/campaign';
import {
  acceptCampaignHook,
  computeReplanPlan,
  fireBackgroundCampaignPatch,
  snapshotCampaignCompletion,
} from '@/lib/life/campaignLifecycle';
import { appendLifeEvent } from '@/lib/life/world';
import { buildResolvedBubble } from '@/lib/life/resolvedBubble';
import {
  WRITE_YOUR_OWN_ID,
  type GradedPlan,
  type NodePreview,
  type StepBeat,
  type StepOption,
} from '@/lib/life/stepSchema';
import type { LifeBeatPayload, LifeEvent } from '@/types/firestore';
import type { Bubble } from './DialogueArea';
import {
  CONTINUE_AFTER_FAILURE_ID,
  type EngineDeps,
  type FeedbackState,
  type NodeEngineActions,
} from './nodeEngineTypes';

/** All machine logic. Closures read ONLY the stable refs in `deps`,
 *  so the actions object created on first render never goes stale. */
export function createEngineActions(deps: EngineDeps): NodeEngineActions {
  const {
    propsRef,
    machineRef,
    localEventsRef,
    nonceRef,
    cacheNonceRef,
    prefetchRef,
    replanRef,
    pendingHookRef,
    activePlanRef,
    transition,
  } = deps;

  function currentEvents(): LifeEvent[] {
    return mergeLocalEvents(propsRef.current.events, localEventsRef.current);
  }

  function pushLocal(evts: LifeEvent[]): void {
    localEventsRef.current = [...localEventsRef.current, ...evts].slice(-12);
  }

  async function awaitReplan(): Promise<void> {
    // LIFE-CAMPAIGN-5: a replan kicked by the previous response may
    // still be in flight — the next prompt must read the refreshed
    // outline. Usually zero wait (absorbed by read time).
    if (replanRef.current) {
      try {
        await replanRef.current;
      } catch {
        // runCampaignReplan never throws — defensive.
      }
      replanRef.current = null;
    }
  }

  /** Turn-level signals from a landed response: worldDelta, hook
   *  offer, campaign resolution, replan plan (LIFE-NODE-3/6). */
  function handleSignals(
    result: Extract<GenerateStepOptionsResult, { kind: 'ok' }>,
  ): void {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    if (result.worldDelta) {
      void applyTurnSignals({
        uid: p.uid,
        world: p.world,
        worldDelta: result.worldDelta,
      }).catch((err) =>
        log.warn('life.node.world-delta-failed', { err: String(err) }),
      );
    }
    const signal = result.campaign;
    const hook = signal?.hook ?? null;
    pendingHookRef.current = hook;
    if (hook) {
      void appendLifeEvent({
        uid: p.uid,
        worldId: p.world.id,
        kind: 'campaign_hook_offered',
        payload: { hookId: hook.hookId, pitch: hook.pitch },
      }).catch(() => undefined);
    }
    if (signal?.resolved && p.campaign) {
      p.onCampaignResolved(
        snapshotCampaignCompletion(p.campaign, signal.resolved, p.events),
      );
    }
    if (p.campaign) {
      const plan = computeReplanPlan(p.campaign, signal);
      fireBackgroundCampaignPatch(p.uid, p.world.id, plan.patch);
      if (plan.reason === 'hardPivot') {
        // LIFE-NODE-6: a hard pivot invalidates every cached preview.
        nonceRef.current += 1;
      }
      if (plan.shouldReplan) {
        const uid = p.uid;
        const world = p.world;
        const phase = signal?.phaseTransition ?? p.campaign.currentPhase;
        const recent = p.events.slice(-12);
        const outline = plan.outlineForReplan;
        const reason = plan.reason === 'none' ? 'tick' : plan.reason;
        replanRef.current = (async () => {
          const replan = await runCampaignReplan({
            world,
            outline,
            currentPhase: phase,
            recentEvents: recent,
            reason,
          });
          if (replan.kind === 'ok') {
            await updateActiveCampaign(uid, world.id, {
              outline: replan.outline,
              turnsSinceReplan: 0,
            });
          }
        })();
      }
    }
  }

  /** Render + commit + route for a node the player just arrived at.
   *  `liveResult` present = live landing (options came bundled);
   *  absent = cached arrival (fetch options in the background). */
  function arriveAtNode(
    node: NodePreview,
    opts: {
      action: CommitAction;
      appendMode: 'reset' | 'append';
      liveResult: Extract<GenerateStepOptionsResult, { kind: 'ok' }> | null;
    },
  ): void {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    const beats: StepBeat[] = node.kind === 'question' ? [] : node.beats;
    p.appendBubbles(beatsToBubbles(beats), {
      resetTurn: opts.appendMode === 'reset',
    });
    if (node.sceneIntent) p.onSceneIntent(node.sceneIntent);
    const payloads = beats.map(beatToPayload);
    // LIFE-NODE-3: all Firestore writes; don't block the render.
    void commitNode({
      uid: p.uid,
      world: p.world,
      campaignId: p.campaign?.id ?? null,
      action: opts.action,
      beats: payloads,
      sceneIntent: node.sceneIntent ?? null,
    }).catch((err) => log.warn('life.node.commit-failed', { err: String(err) }));
    pushLocal([
      ...actionToLocalEvents(opts.action),
      ...payloads.map((b) => localBeatEvent(b)),
    ]);
    if (opts.liveResult) handleSignals(opts.liveResult);
    if (node.kind === 'question') {
      activePlanRef.current = node.gradedPlan;
      transition({
        phase: 'question-authoring',
        nodeKind: 'question',
        options: [],
        question: null,
      });
      void authorQuestion(node.gradedPlan);
      return;
    }
    if (opts.liveResult) {
      cacheNonceRef.current = nonceRef.current;
      transition({
        phase: 'options-ready',
        nodeKind: node.kind,
        options: opts.liveResult.options,
        question: null,
      });
    } else {
      transition({
        phase: 'options-loading',
        nodeKind: node.kind,
        options: [],
        question: null,
      });
      void fetchOptions(node.kind);
    }
  }

  /** Background options call for the node on screen (LIFE-NODE-2). */
  async function fetchOptions(
    currentNodeKind: 'branch' | 'continuation',
  ): Promise<void> {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    await awaitReplan();
    const result = await generateStepOptions({
      uid: p.uid,
      world: p.world,
      events: currentEvents(),
      campaign: p.campaign,
      npcs: p.npcs,
      turn: { kind: 'options', currentNodeKind },
      nonce: nonceRef.current,
    });
    if (result.nonce !== nonceRef.current) return; // LIFE-NODE-6: stale, drop.
    if (result.kind !== 'ok') {
      log.warn('life.node.options-failed', { kind: result.kind });
      transition({ phase: 'options-failed', options: [], question: null });
      return;
    }
    handleSignals(result);
    cacheNonceRef.current = nonceRef.current;
    transition({ phase: 'options-ready', options: result.options });
  }

  /** Live turn: generate the node to render now + its options. */
  async function runLiveTurn(opts: {
    action: CommitAction;
    choice?: { id: string; practiceText: string } | null;
    freeText?: string | null;
    practiceOutcome?: PracticeOutcome | null;
    resetTurn: boolean;
    prefetched?: Promise<GenerateStepOptionsResult> | null;
  }): Promise<void> {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    transition({
      phase: 'live-loading',
      options: [],
      question: null,
      feedback: null,
      composerOpen: false,
    });
    if (opts.resetTurn) p.appendBubbles([], { resetTurn: true });
    await awaitReplan();
    const result = await (opts.prefetched ??
      generateStepOptions({
        uid: p.uid,
        world: p.world,
        events: currentEvents(),
        campaign: p.campaign,
        npcs: p.npcs,
        turn: {
          kind: 'live',
          choice: opts.choice ?? null,
          freeText: opts.freeText ?? null,
          practiceOutcome: opts.practiceOutcome ?? null,
        },
        nonce: nonceRef.current,
      }));
    if (result.nonce !== nonceRef.current) {
      // LIFE-NODE-6: hard pivot landed mid-flight. Never hang —
      // fall to the Continue ladder.
      transition({ phase: 'options-failed', options: [], question: null });
      return;
    }
    if (result.kind !== 'ok' || !result.node) {
      log.warn('life.node.live-failed', {
        kind: result.kind,
      });
      propsRef.current.onError(
        toUserMessage(
          result.kind === 'error' ? result.error : new Error('Life step failed'),
        ),
      );
      transition({ phase: 'options-failed', options: [], question: null });
      return;
    }
    arriveAtNode(result.node, {
      action: opts.action,
      appendMode: 'append',
      liveResult: result,
    });
  }

  /** LIFE-NODE-1: author the question node's chips at show time. */
  async function authorQuestion(plan: GradedPlan): Promise<void> {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    const evts = currentEvents();
    const result = await runGradedQuestionGenerate({
      plan,
      practiceLanguage: p.world.practiceLanguage,
      nativeLanguage: p.world.nativeLanguage,
      recentTargets: recentFillBlankTargets(evts),
      scene: buildGradedSceneContext(p.world, evts, plan),
    });
    if (machineRef.current.phase !== 'question-authoring') return; // superseded
    if (result.kind !== 'ok') {
      // LIFE-NODE-8: demote to the Continue ladder (no wrong-language
      // fallback beat — see phase doc Contradictions #2).
      log.warn('life.node.question-author-failed', { reason: result.reason });
      activePlanRef.current = null;
      transition({ phase: 'options-failed', question: null });
      return;
    }
    transition({
      phase: 'question-ready',
      question: {
        practicePrompt: result.practicePrompt,
        choices: result.choices,
      },
    });
  }

  /** Graded chip pick → feedback + prefetch (LIFE-NODE flow). */
  function gradePick(chipId: string): void {
    const q = machineRef.current.question;
    if (!q) return;
    const choice = q.choices.find((c) => c.id === chipId);
    if (!choice) return;
    const correctChip =
      q.choices.find((c) => c.correctness === 'correct') ?? choice;
    const prompt = q.practicePrompt;
    const plan = activePlanRef.current;
    const promptSource =
      prompt.kind === 'fill-blank' ? prompt.practiceText : prompt.npcUtterance;
    const feedback: FeedbackState = {
      correct: choice.correctness === 'correct',
      picked: choice,
      correctAnswer: correctChip,
      outcomeKind: prompt.kind,
      promptSource,
      speakerName:
        plan?.kind === 'comprehension' ? plan.speakerName ?? null : null,
      npcId: plan?.kind === 'comprehension' ? plan.npcId ?? null : null,
    };
    transition({ phase: 'feedback', feedback });
    // Prefetch the post-feedback live turn while the overlay is up.
    const p = propsRef.current;
    if (p.uid && p.world) {
      const outcome: PracticeOutcome = {
        kind: feedback.outcomeKind,
        correct: feedback.correct,
        picked: choice.practiceText,
        correctAnswer: correctChip.practiceText,
        promptSource,
      };
      prefetchRef.current = generateStepOptions({
        uid: p.uid,
        world: p.world,
        events: currentEvents(),
        campaign: p.campaign,
        npcs: p.npcs,
        turn: { kind: 'live', practiceOutcome: outcome },
        nonce: nonceRef.current,
      });
    }
  }

  async function acceptHookPick(
    hook: { hookId: string; pitch: string; acceptChipId: string },
    option: StepOption,
  ): Promise<void> {
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    pendingHookRef.current = null;
    transition({
      phase: 'live-loading',
      options: [],
      question: null,
      composerOpen: false,
    });
    p.appendBubbles([], { resetTurn: true });
    try {
      await acceptCampaignHook({
        uid: p.uid,
        world: p.world,
        hookPitch: hook.pitch,
        hookId: hook.hookId,
        recentEvents: p.events,
      });
    } catch (err) {
      log.warn('life.campaign.accept-failed', { err: String(err) });
      p.onError(toUserMessage(err));
    }
    await runLiveTurn({
      action: { kind: 'choice', choiceId: option.id, text: option.practiceText },
      choice: { id: option.id, practiceText: option.practiceText },
      resetTurn: false,
    });
  }

  function pick(choiceId: string): void {
    const s = machineRef.current;
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    if (s.phase === 'question-ready') {
      gradePick(choiceId);
      return;
    }
    if (s.phase === 'options-failed') {
      // LIFE-NODE-8: the only chip is the client Continue.
      if (choiceId === CONTINUE_AFTER_FAILURE_ID) {
        void runLiveTurn({ action: { kind: 'none' }, resetTurn: true });
      }
      return;
    }
    if (s.phase !== 'options-ready') return;
    if (choiceId === '__resume__') {
      void runLiveTurn({ action: { kind: 'none' }, resetTurn: true });
      return;
    }
    if (choiceId === WRITE_YOUR_OWN_ID) {
      // LIFE-NODE-4: swap chips for the composer.
      transition({ composerOpen: true });
      return;
    }
    const option = s.options.find((o) => o.id === choiceId);
    if (!option) return;
    const hook = pendingHookRef.current;
    if (hook && option.id === hook.acceptChipId) {
      void acceptHookPick(hook, option);
      return;
    }
    if (hook && option.id !== hook.acceptChipId) {
      // LIFE-CAMPAIGN-3: any other pick declines the hook.
      pendingHookRef.current = null;
      void appendLifeEvent({
        uid: p.uid,
        worldId: p.world.id,
        kind: 'campaign_hook_declined',
        payload: { hookId: hook.hookId, pitch: hook.pitch },
      }).catch(() => undefined);
    }
    const action: CommitAction = {
      kind: 'choice',
      choiceId: option.id,
      text: option.practiceText,
    };
    const cacheFresh = cacheNonceRef.current === nonceRef.current;
    if (option.next && cacheFresh) {
      // LIFE-NODE-2/3: instant cached advance.
      arriveAtNode(option.next, { action, appendMode: 'reset', liveResult: null });
      return;
    }
    // noPreview OR stale cache (LIFE-NODE-5/6) → live generation.
    void runLiveTurn({
      action,
      choice: { id: option.id, practiceText: option.practiceText },
      resetTurn: true,
    });
  }

  function feedbackContinue(): void {
    const fb = machineRef.current.feedback;
    if (!fb) return;
    const p = propsRef.current;
    if (!p.uid || !p.world) return;
    // LIFE-CONTRACT-EX-3: the bubble for the practised line lands NOW.
    const resolved = buildResolvedBubble({
      outcomeKind: fb.outcomeKind,
      promptSource: fb.promptSource,
      correctAnswer: fb.correctAnswer,
      speakerName: fb.speakerName,
      npcId: fb.npcId,
    });
    const beat: LifeBeatPayload = {
      speaker: resolved.speaker,
      speakerName: resolved.speakerName ?? null,
      npcId: resolved.npcId ?? null,
      practiceText: resolved.practiceText,
      nativeText: resolved.nativeText ?? null,
      // POST-PHASE-E: annotations ride the resolved line (outbound =
      // the correct chip's annotations). If ResolvedBubble lacks
      // these fields, Phase E did not land as pinned — STOP.
      complexWords: resolved.complexWords,
      wordTranslations: resolved.wordTranslations,
    };
    p.appendBubbles(
      [
        {
          id: resolved.id,
          speaker: resolved.speaker,
          speakerName: resolved.speakerName ?? null,
          npcId: resolved.npcId ?? null,
          practiceText: resolved.practiceText,
          nativeText: resolved.nativeText,
          complexWords: resolved.complexWords,
          wordTranslations: resolved.wordTranslations,
        },
      ],
      { resetTurn: true },
    );
    const outcome: PracticeOutcome = {
      kind: fb.outcomeKind,
      correct: fb.correct,
      picked: fb.picked.practiceText,
      correctAnswer: fb.correctAnswer.practiceText,
      promptSource: fb.promptSource,
    };
    // Correction event + resolved-line beat (+ NPC promotion via the
    // beat loop) — LIFE-NODE-3.
    void commitNode({
      uid: p.uid,
      world: p.world,
      campaignId: p.campaign?.id ?? null,
      action: { kind: 'practice-outcome', outcome },
      beats: [beat],
      sceneIntent: null,
    }).catch((err) => log.warn('life.node.commit-failed', { err: String(err) }));
    pushLocal([localCorrectionEvent(outcome), localBeatEvent(beat)]);
    const prefetched = prefetchRef.current;
    prefetchRef.current = null;
    activePlanRef.current = null;
    // The post-feedback node's cause (the correction) is already
    // committed above — the live landing commits with action 'none'.
    void runLiveTurn({
      action: { kind: 'none' },
      practiceOutcome: outcome,
      resetTurn: false,
      prefetched,
    });
  }

  return {
    startOpening: () => {
      void runLiveTurn({ action: { kind: 'none' }, resetTurn: false });
    },
    startResume: (option: StepOption) => {
      transition({
        phase: 'options-ready',
        nodeKind: 'continuation',
        options: [option],
      });
    },
    continueTurn: () => {
      void runLiveTurn({ action: { kind: 'none' }, resetTurn: true });
    },
    pick,
    closeComposer: () => {
      transition({ composerOpen: false });
    },
    submitFreeText: (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // LIFE-NODE-6: free text invalidates every cached preview.
      nonceRef.current += 1;
      void runLiveTurn({
        action: { kind: 'free-text', text: trimmed },
        freeText: trimmed,
        resetTurn: true,
      });
    },
    feedbackContinue,
  };
}

function beatsToBubbles(beats: ReadonlyArray<StepBeat>): Bubble[] {
  const now = Date.now();
  return beats.map((b, i) => ({
    id: `beat-${now}-${i}`,
    speaker: b.speaker,
    speakerName: b.speakerName ?? null,
    npcId: b.npcId ?? null,
    practiceText: b.practiceText,
    nativeText: b.nativeText,
    // Phase E: vocab annotations flow into the rendered bubble.
    complexWords: b.complexWords,
    wordTranslations: b.wordTranslations,
  }));
}

function beatToPayload(b: StepBeat): LifeBeatPayload {
  return {
    speaker: b.speaker,
    speakerName: b.speakerName ?? null,
    npcId: b.npcId ?? null,
    practiceText: b.practiceText,
    nativeText: b.nativeText,
    complexWords: b.complexWords,
    wordTranslations: b.wordTranslations,
  };
}

function actionToLocalEvents(action: CommitAction): LifeEvent[] {
  if (action.kind === 'choice') {
    return [localDecisionEvent({ choiceId: action.choiceId, text: action.text })];
  }
  if (action.kind === 'free-text') {
    return [localDecisionEvent({ choiceId: WRITE_YOUR_OWN_ID, text: action.text })];
  }
  if (action.kind === 'practice-outcome') {
    return [localCorrectionEvent(action.outcome)];
  }
  return [];
}
```

### F6-b3 — NEW FILE `src/screens/LifeScreen/useNodeEngine.ts` (complete)

```ts
/**
 * LIFE-NODE-*: the client-side node/lookahead turn engine — the
 * React hook. All machine logic lives in nodeEngineActions.ts;
 * shared types + constants in nodeEngineTypes.ts (see that file's
 * header for the layout).
 *
 * Import rule: LifeScreen (and any code that RUNS the engine)
 * imports from here. Pure-UI code (LifeScreenBottom) imports
 * types/constants from ./nodeEngineTypes instead — this module's
 * import chain reaches lib/gemini → lib/firebase, which must not
 * load in jsdom component tests.
 *
 * Spec: docs/specs/life-sim.md §10.46.
 */
import { useEffect, useRef, useState } from 'react';
import type { GenerateStepOptionsResult } from '@/lib/life/generateStepOptions';
import { pruneDelivered } from '@/lib/life/mergeLocalEvents';
import type { GradedPlan } from '@/lib/life/stepSchema';
import type { LifeEvent } from '@/types/firestore';
import { createEngineActions } from './nodeEngineActions';
import {
  INITIAL_ENGINE_STATE,
  type NodeEngineActions,
  type NodeEngineState,
  type UseNodeEngineProps,
} from './nodeEngineTypes';

// Re-exported for engine consumers (LifeScreen, useNodeEngine.test).
export {
  CONTINUE_AFTER_FAILURE_ID,
  type FeedbackState,
  type NodeEngineActions,
  type NodeEngineState,
  type TurnPhase,
  type UseNodeEngineProps,
} from './nodeEngineTypes';

export function useNodeEngine(
  props: UseNodeEngineProps,
): NodeEngineState & { actions: NodeEngineActions } {
  const [state, setState] = useState<NodeEngineState>(INITIAL_ENGINE_STATE);
  const propsRef = useRef(props);
  const machineRef = useRef<NodeEngineState>(INITIAL_ENGINE_STATE);
  const localEventsRef = useRef<LifeEvent[]>([]);
  const nonceRef = useRef(0);
  const cacheNonceRef = useRef(0);
  const prefetchRef = useRef<Promise<GenerateStepOptionsResult> | null>(null);
  const replanRef = useRef<Promise<void> | null>(null);
  const pendingHookRef = useRef<{
    hookId: string;
    pitch: string;
    acceptChipId: string;
  } | null>(null);
  const activePlanRef = useRef<GradedPlan | null>(null);

  useEffect(() => {
    propsRef.current = props;
  }, [props]);
  const events = props.events;
  useEffect(() => {
    // LIFE-NODE-3: drop overlay entries the listener has delivered.
    localEventsRef.current = pruneDelivered(events, localEventsRef.current);
  }, [events]);

  const [actions] = useState<NodeEngineActions>(() =>
    createEngineActions({
      propsRef,
      machineRef,
      localEventsRef,
      nonceRef,
      cacheNonceRef,
      prefetchRef,
      replanRef,
      pendingHookRef,
      activePlanRef,
      transition: (patch) => {
        machineRef.current = { ...machineRef.current, ...patch };
        setState((prev) => ({ ...prev, ...patch }));
      },
    }),
  );

  return { ...state, actions };
}
```

### F6-c — `src/screens/LifeScreen/LifeScreenBottom.tsx`: full rewrite (complete replacement contents)

Overwrite the whole file with the following. POST-PHASE-D notes: the file you are overwriting is Phase D's Edit-10 version — it exports `chipDisplayFor(graded, practicePrompt, viewMode)` and takes `busy`/`graded`/`practicePrompt`/`choices`/`viewMode` props. This rewrite deletes `chipDisplayFor` deliberately: the graded pins move inline into the `question-ready` branch below (comprehension → `'native'`, fill-blank → `'practice'` — same LIFE-LANG-1/2 contract) and the viewMode mapping moves to LifeScreen (`optionChipDisplay`, F6-e E8). Phase D's component test `LifeScreenBottom.test.tsx` imports `chipDisplayFor` and the old props — it is REWRITTEN in T8 (same Step 6 commit; write the T8 test file BEFORE this edit so it fails first). The `onExplain` prop is Phase D's — it stays wired to `PracticeFeedback`; `chipDisplay` is Phase D's ActionBar prop.

```tsx
/**
 * LifeScreen's bottom render area — one branch per TurnPhase
 * (LIFE-NODE-*): feedback overlay, thinking bar (live-loading),
 * question-authoring shimmer, skeleton chips (options-loading),
 * options-failed Continue ladder, question chips, option chips +
 * client ✏️ chip (LIFE-NODE-4).
 */
import { useT } from '@/i18n';
import { cn } from '@/lib/cn';
import { ActionBar, type Choice, type FlashcardMatch } from './ActionBar';
import { PracticePromptCard } from './PracticePromptCard';
import { PracticeFeedback } from './PracticeFeedback';
// nodeEngineTypes, NOT useNodeEngine: this component must stay free
// of the engine's runtime import chain (jsdom component tests).
import {
  CONTINUE_AFTER_FAILURE_ID,
  type FeedbackState,
  type TurnPhase,
} from './nodeEngineTypes';
import {
  WRITE_YOUR_OWN_ID,
  type PracticePrompt,
  type StepChoice,
  type StepOption,
} from '@/lib/life/stepSchema';

export type LifeScreenBottomProps = {
  phase: TurnPhase;
  feedback: FeedbackState | null;
  question: { practicePrompt: PracticePrompt; choices: StepChoice[] } | null;
  options: StepOption[];
  nodeKind: 'branch' | 'continuation' | 'question' | null;
  composerOpen: boolean;
  /** Phase D viewMode-derived display for narrative option chips.
   *  Graded chips override it per question kind (LIFE-LANG-*):
   *  comprehension → 'native', fill-blank → 'practice'. */
  optionChipDisplay: 'both' | 'practice' | 'native';
  flashcardLookup: ReadonlyMap<string, FlashcardMatch>;
  onPick: (choiceId: string) => void;
  onComposerCancel: () => void;
  onFreeText: (text: string) => void;
  onFeedbackContinue: () => void;
  /** Phase D: opens the ExplainModal from the feedback overlay. */
  onExplain?: () => void;
};

export function LifeScreenBottom({
  phase,
  feedback,
  question,
  options,
  nodeKind,
  composerOpen,
  optionChipDisplay,
  flashcardLookup,
  onPick,
  onComposerCancel,
  onFreeText,
  onFeedbackContinue,
  onExplain,
}: LifeScreenBottomProps) {
  const t = useT();
  if (feedback && phase === 'feedback') {
    return (
      <PracticeFeedback
        correct={feedback.correct}
        picked={feedback.picked}
        correctAnswer={feedback.correctAnswer}
        onContinue={onFeedbackContinue}
        onExplain={onExplain}
      />
    );
  }
  if (phase === 'live-loading') {
    return (
      <div
        data-testid="LifeScreen-ThinkingBar"
        className="px-4 pt-3 pb-[max(env(safe-area-inset-bottom,0px),1rem)] bg-(--color-bg) flex items-center justify-center gap-2 text-xs text-(--color-fg-muted)"
      >
        <span className="flex items-center gap-1" aria-label="thinking">
          <span className="w-1.5 h-1.5 rounded-full bg-(--color-fg-muted) animate-pulse [animation-delay:0ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-(--color-fg-muted) animate-pulse [animation-delay:150ms]" />
          <span className="w-1.5 h-1.5 rounded-full bg-(--color-fg-muted) animate-pulse [animation-delay:300ms]" />
        </span>
        <span>{t('life.thinking')}</span>
      </div>
    );
  }
  if (phase === 'question-authoring') {
    return (
      <div
        data-testid="LifeScreen-QuestionAuthoring"
        className="px-3 pt-2 pb-[max(env(safe-area-inset-bottom,0px),1rem)] bg-(--color-bg)"
      >
        <div className="mx-auto max-w-md w-full px-4 py-3 rounded-2xl bg-(--color-bg-elevated) border border-(--color-accent)/30 animate-pulse">
          <div className="text-[10px] font-bold uppercase tracking-wider text-(--color-accent)">
            {t('life.question.authoring')}
          </div>
          <div className="mt-2 h-4 rounded bg-(--color-bg-hover)" />
          <div className="mt-1.5 h-4 w-2/3 rounded bg-(--color-bg-hover)" />
        </div>
      </div>
    );
  }
  if (phase === 'options-loading') {
    // LIFE-NODE beats are already on screen — 3 pulsing chip slots.
    return (
      <div
        data-testid="LifeScreen-SkeletonChips"
        className="px-3 pt-2 pb-[max(env(safe-area-inset-bottom,0px),1rem)] bg-(--color-bg)"
      >
        <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={cn(
                'h-[3.25rem] rounded-2xl border border-(--color-border) bg-(--color-bg-elevated) animate-pulse',
                i === 2 && 'col-span-2',
              )}
            />
          ))}
        </div>
      </div>
    );
  }
  if (phase === 'options-failed') {
    // LIFE-NODE-8: the Continue ladder.
    return (
      <div className="bg-(--color-bg)">
        <div
          data-testid="LifeScreen-OptionsFailed"
          className="px-4 pt-3 text-center text-xs text-(--color-fg-muted)"
        >
          {t('life.optionsFailed.note')}
        </div>
        <ActionBar
          choices={[
            {
              id: CONTINUE_AFTER_FAILURE_ID,
              practiceText: t('life.optionsFailed.continue'),
            },
          ]}
          onPick={onPick}
          chipDisplay="both"
        />
      </div>
    );
  }
  if (phase === 'question-ready' && question) {
    return (
      <>
        <div className="px-3 pt-2 bg-(--color-bg)">
          <PracticePromptCard prompt={question.practicePrompt} />
        </div>
        <ActionBar
          choices={question.choices}
          onPick={onPick}
          chipDisplay={
            question.practicePrompt.kind === 'comprehension'
              ? 'native'
              : 'practice'
          }
          flashcardLookup={flashcardLookup}
        />
      </>
    );
  }
  // options-ready (also the pre-start idle shell: no options, no ✏️).
  const writeChip: Choice = {
    id: WRITE_YOUR_OWN_ID,
    practiceText: t('life.writeYourOwn.chip'),
    nativeText: null,
    emoji: '✏️',
  };
  const chips: Choice[] =
    nodeKind === 'branch' ? [...options, writeChip] : [...options];
  return (
    <ActionBar
      choices={chips}
      onPick={onPick}
      onFreeText={onFreeText}
      composerOpen={composerOpen}
      onComposerCancel={onComposerCancel}
      disabled={chips.length === 0}
      chipDisplay={optionChipDisplay}
      flashcardLookup={flashcardLookup}
    />
  );
}
```

### F6-d — `src/screens/LifeScreen/ActionBar.tsx`: composer becomes ✏️-gated

Four surgical edits (chip-render internals are Phase D/E territory — untouched).

**Edit 1 — props.** ANCHOR (verify unique):

```
  /** When set, the player can also type a free-text response in
   *  the language(s) of their choice. Fired with the trimmed
   *  string. Only CYOA turns allow this — the model gates by
   *  including a __free__ marker chip in `choices`. */
  onFreeText?: (text: string) => void;
```

Replace with:

```ts
  /** LIFE-NODE-4: submit handler for the ✏️ "write your own"
   *  composer. The composer renders ONLY while `composerOpen` —
   *  there is no always-visible composer. */
  onFreeText?: (text: string) => void;
  /** LIFE-NODE-4: when true, the chip grid is replaced by the
   *  inline composer. Opened by the client ✏️ chip. */
  composerOpen?: boolean;
  /** Dismiss the composer without submitting (back to chips). */
  onComposerCancel?: () => void;
```

**Edit 2 — destructure.** ANCHOR (verify unique):

```
export function ActionBar({
  choices,
  onPick,
  onFreeText,
  freeTextPlaceholder,
```

Replace with:

```ts
export function ActionBar({
  choices,
  onPick,
  onFreeText,
  composerOpen = false,
  onComposerCancel,
  freeTextPlaceholder,
```

**Edit 3 — drop `freeAllowed`.** ANCHOR (verify unique):

```
  const freeAllowed = !!onFreeText;
  const [freeText, setFreeText] = useState('');
  const canSubmit = freeAllowed && freeText.trim().length > 0 && !disabled;
```

Replace with:

```ts
  const [freeText, setFreeText] = useState('');
  const canSubmit = !!onFreeText && freeText.trim().length > 0 && !disabled;
```

**Edit 4 — render gating.** Three sub-edits:

4a. ANCHOR (verify unique): `      <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">` — replace with:

```tsx
      {!composerOpen && (
      <div className="grid grid-cols-2 gap-2 max-w-md mx-auto">
```

4b. ANCHOR (verify unique — the grid close followed by the popover):

```
      </div>
      {popover && (
```

Replace with:

```tsx
      </div>
      )}
      {popover && (
```

4c. ANCHOR (verify unique): `      {freeAllowed && (` — replace with:

```tsx
      {composerOpen && onFreeText && (
```

4d. Autofocus + cancel affordance. ANCHOR (verify unique):

```
          <input
            type="text"
            value={freeText}
```

Replace with:

```tsx
          <input
            type="text"
            autoFocus
            value={freeText}
```

Then ANCHOR (verify unique — the send button's close):

```
            <Send size={16} />
          </button>
        </form>
```

Replace with:

```tsx
            <Send size={16} />
          </button>
          <button
            type="button"
            onClick={onComposerCancel}
            aria-label={t('life.writeYourOwn.cancel')}
            data-testid="LifeScreen-FreeText-Cancel"
            className="p-2 rounded-full flex-shrink-0 bg-(--color-bg-hover) text-(--color-fg-muted)"
          >
            <X size={16} />
          </button>
        </form>
```

(`X` is already imported at the top of the file.) The `__free__` legacy chip filter (`const FREE_ID = '__free__';` + `chipChoices`) stays — harmless belt-and-braces if an old preview ever carries one.

### F6-e — `src/screens/LifeScreen/LifeScreen.tsx` (+ `lifeScreenState.ts`): wire the engine

Ten edits. **ALL anchors in this section are POST-PHASE-C/D/E ANCHORS** — quoted from the file as Phases C (opening effect + recap gate), D (Edit 11/12 series: `lifeScreenState.ts` extraction, import rewires, `explainOpen`, `onSetViewMode`, ExplainModal mount) and E (Step 11: `useFlashcardLookup`, `wordSave`, `locationLabel`) leave it. Verify each with `grep -F -c` before editing; if one does not grep, the earlier phase did not land as its doc specified — STOP and report, do not guess. If `npm run typecheck` reports a type name that D/E still use after an import edit, re-add exactly that name to the import — nothing else.

**E1 — imports (five deletions, three replacements).**

- Delete line: `import { runLifeStep, type PracticeOutcome } from '@/lib/life/runLifeStep';`
- Delete line: `import { runCampaignReplan } from '@/lib/life/runCampaignReplan';`
- Delete line: `import { updateActiveCampaign } from '@/lib/life/campaign';`
- Delete line: `import { promoteOrTouchNpc } from '@/lib/life/npcs';`
- Delete line: `import { buildResolvedBubble } from '@/lib/life/resolvedBubble';`
- Replace (POST-PHASE-D ANCHOR — D's 12b added `updateLifeWorld`; the engine owns the event appends now but `onSetViewMode` still needs `updateLifeWorld`):

```
import { appendBeatEvent, appendLifeEvent, updateLifeWorld } from '@/lib/life/world';
```

  with:

```ts
import { updateLifeWorld } from '@/lib/life/world';
```

- Replace (POST-PHASE-D ANCHOR — D's 12d removed the type import; F re-adds it for the `onCampaignResolved` callback annotation):

```
import {
  acceptCampaignHook,
  computeReplanPlan,
  fireBackgroundCampaignPatch,
  resolveRecurringNames,
  snapshotCampaignCompletion,
} from '@/lib/life/campaignLifecycle';
```

  with:

```ts
import {
  resolveRecurringNames,
  type CampaignCompletionSnapshot,
} from '@/lib/life/campaignLifecycle';
import { useNodeEngine } from './useNodeEngine';
```

- Replace (POST-PHASE-D ANCHOR — D's 12c slimmed this import; `SceneIntent` comes back for the `onSceneIntent` callback annotation, `StepOption` for `startResume`):

```
import type { StepChoice, StepResponse } from '@/lib/life/stepSchema';
```

  with:

```ts
import type { SceneIntent, StepOption } from '@/lib/life/stepSchema';
```

**E2 — `src/screens/LifeScreen/lifeScreenState.ts`: full rewrite (complete replacement contents).** Phase D's Edit 11 created this file holding `FeedbackState` + `LocalState` + `INITIAL_STATE`. The engine now owns feedback and all turn-flow state; the screen keeps only bubbles/scene/overlay state. Overwrite the whole file with:

```ts
/**
 * LifeScreen's local screen-state types + initial value. Extracted
 * from LifeScreen.tsx in Wurlds-v2 Phase D (600-LOC cap); slimmed in
 * Phase F — turn-flow state (choices, graded, practicePrompt,
 * feedback, busy, pendingHook) moved into the node engine
 * (useNodeEngine, LIFE-NODE-*). No behaviour lives here.
 */
import type { Bubble } from './DialogueArea';
import type { SceneIntent } from '@/lib/life/stepSchema';
import type { CampaignCompletionSnapshot } from '@/lib/life/campaignLifecycle';
import type { WorldArc } from '@/types/firestore';

export type LocalState = {
  /** What the user sees as bubbles. Capped at 2 by DialogueArea. */
  bubbles: Bubble[];
  /** Most recent sceneIntent — drives the SceneStage descriptor.
   *  Fed by the engine's onSceneIntent callback. */
  sceneIntent: SceneIntent | null;
  /** Bubble ids of the current turn (gradient border). */
  currentTurnIds: ReadonlySet<string>;
  /** LIFE-CAMPAIGN-10: campaign-complete overlay snapshot. */
  completedCampaign: CampaignCompletionSnapshot | null;
  /** LIFE-WORLD-ARC-*: chapter-complete overlay payload. */
  arcComplete: {
    arc: WorldArc;
    snapshot: CampaignCompletionSnapshot;
  } | null;
};

export const INITIAL_STATE: LocalState = {
  bubbles: [],
  sceneIntent: null,
  currentTurnIds: new Set(),
  completedCampaign: null,
  arcComplete: null,
};
```

(LifeScreen's Phase-D import `import { INITIAL_STATE, type LocalState } from './lifeScreenState';` keeps working unchanged. The deleted `FeedbackState` type has exactly one replacement: the engine's `FeedbackState` re-exported from `./useNodeEngine` — but LifeScreen never needs to import it by name; `engine.feedback` is already typed.)

**E3 — overlay busy flag.** ANCHOR (verify unique): `  const [state, setState] = useState<LocalState>(INITIAL_STATE);` — replace with:

```ts
  const [state, setState] = useState<LocalState>(INITIAL_STATE);
  /** Chapter/campaign overlay transitions (closeCampaign /
   *  continueToNextChapter) — separate from the engine's phases. */
  const [overlayBusy, setOverlayBusy] = useState(false);
```

(Phase D's `explainOpen` state — added by D's 12h next to `avatarModal` — is elsewhere in the file and stays untouched.)

**E4 — delete the replan ref.** Delete the span from the ANCHOR `  /** LIFE-CAMPAIGN-5: a campaignReplan promise kicked off after a` through `  const replanInFlightRef = useRef<Promise<void> | null>(null);` (inclusive) — the engine owns replans now.

**E5 — replace `runStep` with the engine.** Replace the span from the ANCHOR `  // Run a lifeStep call, optimistically rendering the user's` (the comment above `const runStep = useCallback(`) through the useCallback's closing `  );` (the line after `    [user, worldData, eventsData, pushToast, campaign.data, npcs.npcs],` — both verified unique) with:

```ts
  // LIFE-CAMPAIGN-8 + LIFE-NPC-RECUR-4: scope the roster to
  // (world ∪ active campaign), dropping retiring transients.
  const scopedNpcs = useMemo<LifeNpc[]>(() => {
    const activeCampaignId = campaign.data?.id ?? null;
    return Array.from(npcs.npcs.values()).filter(
      (n) =>
        n.scope !== 'transient' &&
        (!n.campaignId || n.campaignId === activeCampaignId),
    );
  }, [npcs.npcs, campaign.data?.id]);

  const appendBubbles = useCallback(
    (incoming: Bubble[], opts: { resetTurn: boolean }) => {
      setState((prev) => ({
        ...prev,
        bubbles:
          incoming.length > 0 ? [...prev.bubbles, ...incoming] : prev.bubbles,
        currentTurnIds: opts.resetTurn
          ? new Set(incoming.map((b) => b.id))
          : incoming.length > 0
            ? new Set([
                ...prev.currentTurnIds,
                ...incoming.map((b) => b.id),
              ])
            : prev.currentTurnIds,
      }));
    },
    [],
  );
  const onSceneIntent = useCallback((intent: SceneIntent) => {
    setState((prev) => ({ ...prev, sceneIntent: intent }));
  }, []);
  const onCampaignResolved = useCallback(
    (snapshot: CampaignCompletionSnapshot) => {
      setState((prev) => ({ ...prev, completedCampaign: snapshot }));
    },
    [],
  );
  const onEngineError = useCallback(
    (message: string) => pushToast({ kind: 'error', message }),
    [pushToast],
  );

  const engine = useNodeEngine({
    uid: user?.uid ?? null,
    world: worldData ?? null,
    events: eventsData,
    campaign: campaign.data ?? null,
    npcs: scopedNpcs,
    appendBubbles,
    onSceneIntent,
    onCampaignResolved,
    onError: onEngineError,
  });
```

**E6 — opening effect (POST-PHASE-C body).** Phase C's E8/E9a rewrote the resume branch: it is gated on `recapDismissed` and seeds via `buildResumeSeed(eventsData, t)` (returns `{ bubbles, choices }`); the deps line carries `recapDismissed`. Two sub-edits:

E6-1. ANCHOR (POST-PHASE-C, verify unique — the whole block is C's E8 output):

```
      if (!recapDismissed) return;
      // LIFE-FLOW-2: resume replays the last beat events into the
      // dialogue window so the player lands on context, not a
      // generic continue prompt. Helper extracted to resumeBubbles.ts.
      openingFiredRef.current = true;
      void recordSessionOpen(user.uid, worldData).catch(() => undefined);
      setState((prev) => ({ ...prev, ...buildResumeSeed(eventsData, t) }));
      return;
```

Replace with (the seed's `bubbles` half still lands in screen state; the `choices` half becomes the engine's resume chip — post-F `LocalState` has no `choices` field, so the spread MUST go):

```ts
      if (!recapDismissed) return;
      // LIFE-FLOW-2: resume replays the last beat events into the
      // dialogue window so the player lands on context, not a
      // generic continue prompt. Helper extracted to resumeBubbles.ts.
      openingFiredRef.current = true;
      void recordSessionOpen(user.uid, worldData).catch(() => undefined);
      const seed = buildResumeSeed(eventsData, t);
      setState((prev) => ({ ...prev, bubbles: seed.bubbles }));
      // LIFE-NODE-*: the single '__resume__' chip routes through the
      // engine (its pick fires a <turn kind="continue"> live turn).
      engine.actions.startResume(seed.choices[0]!);
      return;
```

E6-2. The opening-fire line + deps. ANCHOR (verify unique):

```
    openingFiredRef.current = true;
    void recordSessionOpen(user.uid, worldData).catch(() => undefined);
    void runStep({ isOpening: true });
```

Replace with:

```ts
    openingFiredRef.current = true;
    void recordSessionOpen(user.uid, worldData).catch(() => undefined);
    engine.actions.startOpening();
```

Then the deps line. ANCHOR (POST-PHASE-C, verify unique):

```
  }, [user, worldData, worldData?.saga, worldData?.currentArc, eventsLoaded, eventsData.length, introDismissed, recapDismissed, runStep, t]);
```

Replace with:

```ts
  }, [user, worldData, worldData?.saga, worldData?.currentArc, eventsLoaded, eventsData.length, introDismissed, recapDismissed, engine.actions, t]);
```

(`engine.actions` is identity-stable — created once — so this effect cannot loop. `seed.choices[0]!` is a `StepChoice`; it is structurally assignable to `startResume`'s `StepOption` parameter — `StepOption` omits `correctness` and adds only optional fields.)

**E7 — delete `onPick` + `acceptHook`.** Delete the span from the ANCHOR `  function onPick(choiceId: string) {` through the closing `  }` of `acceptHook` (the line after `    await runStep({ choice });` — i.e. up to but EXCLUDING the ANCHOR `  async function closeCampaign() {`). The engine's `pick` replaces both. (Phase D's 12i feedback-capture edit and its `setExplainOpen(false)` reset live INSIDE this span — they die with it; the explain reset is re-established by E9's `onFeedbackContinue` wrapper.)

**E8 — overlay flows (POST-PHASE-D span).** Replace the span from the ANCHOR `  async function closeCampaign() {` through (up to but EXCLUDING) the ANCHOR `  const onWorldDeleted = () => navigate('/life/overview', { replace: true });`. Post-D that span contains `closeCampaign`, `handleContinueChapter`, `handlePauseChapter`, `onFeedbackContinue` (with Phase E's E15 annotation lines inside it), AND Phase D's 12j `onSetViewMode` handler + its comment directly above `onWorldDeleted` — the whole span goes; `onSetViewMode` is re-emitted verbatim below because F still needs it. Replacement:

```ts
  async function closeCampaign() {
    const snapshot = state.completedCampaign;
    if (!snapshot) return;
    setOverlayBusy(true);
    const r = await chapter.closeCampaign(snapshot);
    setState((prev) => ({
      ...prev,
      completedCampaign: null,
      arcComplete: r.kind === 'chapter-complete' ? { arc: r.arc, snapshot } : null,
    }));
    setOverlayBusy(false);
    if (r.kind === 'continue') engine.actions.continueTurn();
  }

  async function handleContinueChapter() {
    const ending = state.arcComplete;
    if (!ending) return;
    setOverlayBusy(true);
    await chapter.continueToNextChapter(ending.arc);
    setState((prev) => ({ ...prev, arcComplete: null }));
    setOverlayBusy(false);
    engine.actions.continueTurn();
  }

  function handlePauseChapter() {
    setState((prev) => ({ ...prev, arcComplete: null }));
    chapter.pauseToOverview();
  }

  // Phase D viewMode → narrative-chip display (graded chips derive
  // their own display from the question kind in LifeScreenBottom).
  const viewMode = worldData.viewMode ?? 'visible';
  const optionChipDisplay =
    viewMode === 'visible'
      ? ('both' as const)
      : viewMode === 'native-only'
        ? ('native' as const)
        : ('practice' as const);

  // LIFE-LANG-3: persist the cycled mode on the world doc. Firestore
  // latency compensation echoes the write into useLifeWorld
  // immediately, so no local mirror state is needed.
  const onSetViewMode = (mode: ZViewModeT) => {
    if (!user || !worldData) return;
    void updateLifeWorld(user.uid, worldData.id, { viewMode: mode }).catch((err: unknown) => {
      log.warn('life.viewMode.update-failed', { err: String(err) });
      pushToast({ kind: 'error', message: toUserMessage(err) });
    });
  };
```

(`onSetViewMode` is byte-identical to Phase D's 12j version. The `viewMode` const feeds BOTH `optionChipDisplay` here and D's `LifeScreenHeader`/`DialogueArea` props — D's 12j/12k JSX reads `worldData.viewMode ?? 'visible'` inline; leave those inline reads alone.)

**E9 — render wiring.** Four JSX edits:

- ANCHOR `closing={state.busy}` → replace with `closing={overlayBusy}`.
- ANCHOR `generatingNext={state.busy}` → replace with `generatingNext={overlayBusy}`.
- Replace the span from the ANCHOR `          hideNativeForUtterance={` through its closing `          }` (the whole prop expression — currently reads `state.practicePrompt`) with:

```tsx
          hideNativeForUtterance={
            engine.question?.practicePrompt.kind === 'comprehension'
              ? engine.question.practicePrompt.npcUtterance
              : null
          }
```

- Replace the span from the ANCHOR `      <LifeScreenBottom` through its closing `      />` (POST-PHASE-D the props include `viewMode` and `onExplain`; the whole element is replaced — `viewMode` is dropped in favour of `optionChipDisplay`, `onExplain` is kept) with:

```tsx
      <LifeScreenBottom
        phase={engine.phase}
        feedback={engine.feedback}
        question={engine.question}
        options={engine.options}
        nodeKind={engine.nodeKind}
        composerOpen={engine.composerOpen}
        optionChipDisplay={optionChipDisplay}
        flashcardLookup={flashcardLookup}
        onPick={engine.actions.pick}
        onComposerCancel={engine.actions.closeComposer}
        onFreeText={engine.actions.submitFreeText}
        onFeedbackContinue={() => {
          // LIFE-LANG-5: a stale open ExplainModal must not survive
          // into the next question's feedback.
          setExplainOpen(false);
          engine.actions.feedbackContinue();
        }}
        onExplain={() => setExplainOpen(true)}
      />
```

**E10 — ExplainModal mount reads the engine (POST-PHASE-D ANCHOR — the block is D's 12l output, directly below the `<LifeScreenBottom … />` element).** ANCHOR (verify unique — the whole block):

```
      {explainOpen && state.feedback && (
        <Suspense fallback={null}>
          <ExplainModal
            open
            onClose={() => setExplainOpen(false)}
            message={null}
            chatId=""
            practiceLanguage={worldData.practiceLanguage}
            nativeLanguage={worldData.nativeLanguage}
            translatedText=""
            wordDifficulty={worldData.difficulty}
            practiceQuestion={buildLifeExplainQuestion(
              state.feedback.prompt,
              state.feedback.allChoices,
              state.feedback.outcomeKind === 'comprehension' ? 'native' : 'practice',
            )}
            userAnswer={lifeChoiceLabel(
              state.feedback.picked,
              state.feedback.outcomeKind === 'comprehension' ? 'native' : 'practice',
            )}
            wasCorrect={state.feedback.correct}
          />
        </Suspense>
      )}
```

Replace with (D's `FeedbackState.prompt`/`allChoices` capture is gone — the engine keeps `question` populated through the `feedback` phase precisely so this payload stays available):

```tsx
      {explainOpen && engine.feedback && engine.question && (
        <Suspense fallback={null}>
          <ExplainModal
            open
            onClose={() => setExplainOpen(false)}
            message={null}
            chatId=""
            practiceLanguage={worldData.practiceLanguage}
            nativeLanguage={worldData.nativeLanguage}
            translatedText=""
            wordDifficulty={worldData.difficulty}
            practiceQuestion={buildLifeExplainQuestion(
              engine.question.practicePrompt,
              engine.question.choices,
              engine.feedback.outcomeKind === 'comprehension' ? 'native' : 'practice',
            )}
            userAnswer={lifeChoiceLabel(
              engine.feedback.picked,
              engine.feedback.outcomeKind === 'comprehension' ? 'native' : 'practice',
            )}
            wasCorrect={engine.feedback.correct}
          />
        </Suspense>
      )}
```

After E1–E10, run `npm run typecheck`: the file must no longer reference `runLifeStep`, `PracticeOutcome`, `StepResponse`, `StepChoice`, `buildResolvedBubble`, `appendBeatEvent`, `appendLifeEvent`, `promoteOrTouchNpc`, `acceptCampaignHook`, `computeReplanPlan`, `fireBackgroundCampaignPatch`, `snapshotCampaignCompletion`, `runCampaignReplan`, or `updateActiveCampaign`. Still referenced (do NOT remove their imports): `updateLifeWorld` (onSetViewMode), `buildResumeSeed` (E6-1), `buildLifeExplainQuestion` + `lifeChoiceLabel` + `ExplainModal`/`Suspense` (E10), `useFlashcardLookup`/`useLifeWordSave` (Phase E), `resolveRecurringNames`, `CampaignCompletionSnapshot` (type), `SceneIntent` + `StepOption` (types), `ZViewModeT` (onSetViewMode), `LocalState`/`INITIAL_STATE` (from `./lifeScreenState`).

### F7-a — DELETE `src/lib/life/runLifeStep.ts`

`git rm src/lib/life/runLifeStep.ts`. Then `git grep -n runLifeStep -- src tests` must return only the two stale comments fixed in F7-d.

### F7-d — stale comment fixes (same commit as F7-a)

1. `src/lib/life/prompts/step.ts` — ANCHOR (verify unique): ` *  practice writes a correction event (see runLifeStep); CYOA picks` → replace with ` *  practice writes a correction event (see commitNode); narrative picks`.
2. `src/lib/life/prompts/step.ts` — ANCHOR (verify unique): `      // Payload (written in runLifeStep.ts): { kind, correct, picked,` → replace with `      // Payload (written in commitNode.ts): { kind, correct, picked,`.
3. `src/lib/life/runGradedQuestionGenerate.ts` — ANCHOR (verify unique): ` * The caller (\`runLifeStep\`) translates 'failed' into a degraded CYOA` → replace with ` * The caller (useNodeEngine) translates 'failed' into the`.  The following line ` * turn so the player never sees a broken graded turn.` → replace with ` * options-failed Continue ladder (LIFE-NODE-8) so the player never sees a broken graded turn.`
4. `src/screens/LifeScreen/sceneDescriptorForLife.ts` — ANCHOR (verify unique): ` * Resume path: prefer \`world.currentScene\` (persisted by runLifeStep` → replace with ` * Resume path: prefer \`world.currentScene\` (persisted by commitNode`.

### F7-b — `tests/e2e/helpers/lifeMock.ts`: full rewrite (complete replacement contents)

Overwrite the whole file with:

```ts
/**
 * Gemini-mock helper for /life E2E tests (node-engine era).
 *
 * Intercepts the geminiGenerate Cloud Function endpoint and matches
 * on the request body's `category`:
 *   - life_step            → next fixture from `steps` (JSON,
 *                            ZRawNodeResponse shape: node + options
 *                            with lookahead previews). An entry may
 *                            carry `delayMs` to hold the response —
 *                            used to assert the instant-cached-
 *                            advance + skeleton phases.
 *   - life_graded_question → next fixture from `gradedQuestions`
 *                            ({ practicePrompt, choices }).
 *   - life_scene           → next fixture from `scenes` (SVG text).
 *   - life_resume_recap    → next fixture from `resumeRecaps`
 *                            (LIFE-FLOW-5, Phase C — kept verbatim).
 *   - any other life_*     → 500 (deterministic: background bio /
 *                            saga / arc gen fail fast — the app
 *                            tolerates those failures — instead of
 *                            burning real Gemini in a mocked spec).
 *   - anything else        → falls through to the real network.
 *
 * Queues run out → 500 with a descriptive body (used deliberately by
 * the options-failed ladder test).
 */
import type { Page, Route } from '@playwright/test';
import type {
  PracticePrompt,
  RawNodeResponseInput,
  StepChoice,
} from '../../../src/lib/life/stepSchema';

export type GradedQuestionFixture = {
  practicePrompt: PracticePrompt;
  choices: StepChoice[];
};

/** LIFE-FLOW-5 (Phase C): fixture for `life_resume_recap` calls
 *  (fired on world exit). Omit when the spec never exits a world. */
export type LifeResumeRecapFixture = {
  practiceText: string;
  nativeText: string;
};

export type StepFixture =
  | RawNodeResponseInput
  | { response: RawNodeResponseInput; delayMs: number };

export type LifeMockFixtures = {
  steps: StepFixture[];
  scenes: string[];
  gradedQuestions?: GradedQuestionFixture[];
  resumeRecaps?: LifeResumeRecapFixture[];
};

const MINIMAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="800" fill="#bde0fe"/><rect y="500" width="1200" height="300" fill="#c8b896"/><circle cx="600" cy="400" r="80" fill="#fff2c9"/></svg>`;

export function minimalSceneSvg(): string {
  return MINIMAL_SVG;
}

function envelope(text: string): { status: number; contentType: string; body: string } {
  // The geminiGenerate Cloud Function wraps every response as
  // { text: "..." }; lib/gemini.ts reads .text. Mirror that.
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text }),
  };
}

export async function installLifeMock(
  page: Page,
  fixtures: LifeMockFixtures,
): Promise<void> {
  const stepQueue = [...fixtures.steps];
  const gradedQueue = [...(fixtures.gradedQuestions ?? [])];
  const sceneQueue = [...fixtures.scenes];
  const recapQueue = [...(fixtures.resumeRecaps ?? [])];

  await page.route('**/geminiGenerate', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      category?: string;
    };
    if (body.category === 'life_step') {
      const next = stepQueue.shift();
      if (!next) {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'lifeMock: step fixture queue empty',
        });
        return;
      }
      const entry =
        'response' in next && 'delayMs' in next
          ? next
          : { response: next as RawNodeResponseInput, delayMs: 0 };
      if (entry.delayMs > 0) {
        await new Promise((r) => setTimeout(r, entry.delayMs));
      }
      await route.fulfill(envelope(JSON.stringify(entry.response)));
      return;
    }
    if (body.category === 'life_graded_question') {
      const next = gradedQueue.shift();
      if (!next) {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'lifeMock: graded-question fixture queue empty',
        });
        return;
      }
      await route.fulfill(envelope(JSON.stringify(next)));
      return;
    }
    if (body.category === 'life_scene') {
      const next = sceneQueue.shift() ?? MINIMAL_SVG;
      await route.fulfill(envelope(next));
      return;
    }
    if (body.category === 'life_resume_recap') {
      const next = recapQueue.shift();
      if (!next) {
        await route.fulfill({
          status: 500,
          contentType: 'text/plain',
          body: 'lifeMock: resumeRecap fixture queue empty',
        });
        return;
      }
      await route.fulfill(envelope(JSON.stringify(next)));
      return;
    }
    if (typeof body.category === 'string' && body.category.startsWith('life_')) {
      // bio / saga / arc / compact / avatar / campaign gen — fail
      // fast and deterministically in mocked specs.
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: `lifeMock: no handler for ${body.category}`,
      });
      return;
    }
    await route.fallback();
  });
}
```

TypeScript note: `'response' in next && 'delayMs' in next` narrows the union because plain `RawNodeResponseInput` has neither key.

### F7-c — `tests/e2e/specs/life-flow.spec.ts`: full rewrite (complete replacement contents)

Tier: **@standard** (untagged specs run under `test:e2e:standard`'s `--grep-invert @full`; matches the plan's tier call). Post-conditions are asserted against Firestore via the admin SDK, not just the UI.

**This rewrite REPLACES the post-A/C/D/E accumulated spec file. Earlier-phase coverage does not regress — it is carried forward re-expressed against node fixtures:** Phase C's two `LIFE-FLOW-5` tests (recap screen; exit-generation), Phase D's `LIFE-LANG-1` chip-language assertions + `LIFE-LANG-5` Why?-modal test + `LIFE-LANG-3` viewMode-cycle test, and Phase E's `LIFE-BUBBLE-7` vocab-save test (including E's `'flashcards'` deck wipe). Phase A's `LIFE-UI-8` rebrand-copy test ports over UNCHANGED (an engine-agnostic overview-copy assertion — nothing to re-express against node fixtures), kept as the FINAL test in the serial block (its `LifeOverview-Create` copy / `Wurlds`-tab / `Your Other Wurlds` assertions are independent of the CYOA→node engine swap), so A's spec §18 `life-flow` reference stays live.

```ts
/**
 * E2E: /life node/lookahead engine (LIFE-NODE-*), mocked Gemini.
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
 *   8.  viewMode cycle flips bubble + chip languages and persists
 *       (LIFE-LANG-3, Phase D carry-over).
 *   9.  options-failed Continue ladder (mock 500) — pick's commit
 *       still landed (LIFE-NODE-8).
 *   10. Resume recap screen from stored data; Continue releases the
 *       resume chip (LIFE-FLOW-5, Phase C carry-over).
 *   11. World exit fires the recap generator and persists
 *       resumeRecap (LIFE-FLOW-5, Phase C carry-over).
 *   12. LIFE-UI-8 (Phase A carry-over): rebrand copy renders on the
 *       Wurlds tab + overview — ported unchanged (engine-agnostic).
 *
 * Phone prefix: +1000060_A (stable pool — HARNESS-ACCOUNTS-1).
 */
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import {
  provisionTestUser,
  signInBrowser,
  type AuthenticatedUser,
} from '../helpers/auth';
import { cleanupTestUsers, getAdminFirestore } from '../helpers/firebase-admin';
import { captureBeat } from '../helpers/screenshots';
import {
  installLifeMock,
  minimalSceneSvg,
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
  for (const col of ['lifeWorld', 'lifeEvents', 'lifeNpcs', 'lifeScenes', 'flashcards']) {
    const snap = await db.collection(`users/${uid}/${col}`).get();
    if (snap.empty) continue;
    const batch = db.batch();
    snap.forEach((d) => batch.delete(d.ref));
    await batch.commit();
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
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    completedArcs: [],
    saga: {
      title: 'Une vie à Lyon',
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
      completedCampaignMemories: [],
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
        practiceText: 'Tu te réveilles dans ton appartement à Lyon.',
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
      next: {
        kind: 'branch',
        beats: [
          {
            speaker: 'narrator',
            practiceText: 'Sophie te fait signe depuis la terrasse.',
            nativeText: 'Sophie waves at you from the terrace.',
          },
        ],
      },
    },
    {
      id: 'coffee',
      practiceText: 'Préparer un café',
      nativeText: 'Make a coffee',
      next: {
        kind: 'continuation',
        beats: [
          {
            speaker: 'narrator',
            practiceText: 'La machine ronronne doucement.',
            nativeText: 'The machine hums softly.',
          },
        ],
      },
    },
    {
      id: 'window',
      practiceText: 'Regarder par la fenêtre',
      nativeText: 'Look out the window',
      noPreview: true,
    },
  ],
};

/** <turn kind="options"> response for the terrace node — no `node`. */
const OPTIONS_AT_TERRACE: RawNodeResponseInput = {
  options: [
    {
      id: 'sit',
      practiceText: "S'asseoir en face d'elle",
      nativeText: 'Sit down opposite her',
      next: {
        kind: 'branch',
        beats: [
          {
            speaker: 'narrator',
            practiceText: "Tu t'assieds en face d'elle.",
            nativeText: 'You sit down opposite her.',
          },
        ],
      },
    },
    {
      id: 'wave',
      practiceText: 'Lui faire signe',
      nativeText: 'Wave back',
      next: {
        kind: 'continuation',
        beats: [
          {
            speaker: 'narrator',
            practiceText: 'Elle sourit.',
            nativeText: 'She smiles.',
          },
        ],
      },
    },
  ],
};

/** Live response to the ✏️ free text — its options carry the
 *  fill-blank question preview the next test picks. */
const WRITE_RESPONSE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: 'Tu proposes une promenade au parc.',
        nativeText: 'You suggest a walk in the park.',
      },
    ],
  },
  options: [
    {
      id: 'ask-week',
      practiceText: 'Proposer un déjeuner',
      nativeText: 'Suggest lunch',
      next: {
        kind: 'question',
        gradedPlan: {
          kind: 'fill-blank',
          testTarget: 'voudrais',
          sentenceContext: 'Je voudrais déjeuner avec toi.',
        },
      },
    },
    {
      id: 'walk',
      practiceText: 'Marcher en silence',
      nativeText: 'Walk in silence',
      next: {
        kind: 'branch',
        beats: [
          {
            speaker: 'narrator',
            practiceText: 'Vous marchez côte à côte.',
            nativeText: 'You walk side by side.',
          },
        ],
      },
    },
  ],
};

/** LIFE-LANG-1: fill-blank chips are practice-language only — the
 *  empty nativeText is the generator contract (Phase D), not an
 *  omission. */
const GRADED_FILL_BLANK: GradedQuestionFixture = {
  practicePrompt: {
    kind: 'fill-blank',
    practiceText: 'Je ___ déjeuner avec toi.',
    nativeText: 'I ___ to have lunch with you.',
  },
  choices: [
    { id: 'voudrais', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
    { id: 'veux', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
    { id: 'ai', practiceText: 'ai', nativeText: '', correctness: 'wrong' },
  ],
};

/** Prefetched post-fill-blank live node (LIFE-CONTRACT-EX-3: the NPC
 *  reacts; never re-quotes the practised line). One option previews a
 *  COMPREHENSION question node for the LIFE-LANG-1/5 test. */
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
      next: {
        kind: 'question',
        gradedPlan: {
          kind: 'comprehension',
          npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
          speakerName: 'Sophie',
          npcId: 'sophie',
        },
      },
    },
    {
      id: 'leave',
      practiceText: 'Partir travailler',
      nativeText: 'Head to work',
      noPreview: true,
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
    },
    {
      id: 'break',
      practiceText: 'Elle propose une pause',
      nativeText: "She's suggesting a break",
      correctness: 'wrong',
    },
  ],
};

/** Prefetched post-comprehension live node — its bubble + chips are
 *  the surface the LIFE-LANG-3 viewMode test flips, and the
 *  'breakfast' option's cached preview feeds the LIFE-NODE-8 test. */
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
      next: {
        kind: 'branch',
        beats: [
          {
            speaker: 'narrator',
            practiceText: 'Tu hoches la tête.',
            nativeText: 'You nod.',
          },
        ],
      },
    },
    {
      id: 'leave-now',
      practiceText: 'Partir tout de suite',
      nativeText: 'Leave right away',
      noPreview: true,
    },
  ],
};

const RECOVERY_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: 'La matinée reprend son cours.',
        nativeText: 'The morning carries on.',
      },
    ],
  },
  options: [
    {
      id: 'a',
      practiceText: 'Continuer vers le marché',
      nativeText: 'Carry on to the market',
      next: { kind: 'branch', beats: [] },
    },
    {
      id: 'b',
      practiceText: 'Rentrer',
      nativeText: 'Go home',
      noPreview: true,
    },
  ],
};

const RESUME_LIVE: RawNodeResponseInput = {
  node: {
    kind: 'branch',
    beats: [
      {
        speaker: 'narrator',
        practiceText: 'Tu reprends le fil de ta journée.',
        nativeText: 'You pick up the thread of your day.',
      },
    ],
  },
  options: [
    {
      id: 'x',
      practiceText: 'Aller au marché',
      nativeText: 'Go to the market',
      next: { kind: 'branch', beats: [] },
    },
    {
      id: 'y',
      practiceText: 'Rester ici',
      nativeText: 'Stay here',
      noPreview: true,
    },
  ],
};

test.describe.serial('life-sim node engine (mocked Gemini)', () => {
  test.beforeAll(async ({ browser }) => {
    userA = await provisionTestUser(USER_A);
    await wipeLifeData(userA.uid);
    worldId = await seedWorld(userA.uid);
    context = await browser.newContext({
      viewport: { width: 414, height: 896 },
    });
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    await cleanupTestUsers(userA?.uid);
  });

  test('LIFE-ONBOARD — seed chip creates the world doc', async ({}, testInfo) => {
    await installLifeMock(page, { steps: [], scenes: [minimalSceneSvg()] });
    await signInBrowser(page, userA);
    await page.goto('/life');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForURL((url) => url.pathname === '/life/overview', {
      timeout: 10_000,
    });
    await page.getByTestId('LifeOverview-Create').click();
    await page.waitForURL((url) => url.pathname === '/life/start', {
      timeout: 10_000,
    });
    await page.getByTestId('LifeStart-Seed-city_life').click();
    await page.waitForURL((url) => /^\/life\/w-/.test(url.pathname), {
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
    await captureBeat(page, testInfo, 'onboard-created');
  });

  test('LIFE-NODE-1/4 — opening branch: beats + 3 options + client ✏️; no always-visible composer', async ({}, testInfo) => {
    // The options response for the NEXT node is HELD for 4s — the
    // cached-advance test below consumes it.
    await installLifeMock(page, {
      steps: [OPENING, { response: OPTIONS_AT_TERRACE, delayMs: 4_000 }],
      scenes: [minimalSceneSvg(), minimalSceneSvg()],
    });
    await page.goto(`/life/${worldId}`);
    await page.waitForLoadState('domcontentloaded');
    // Fresh seeded world (saga present, 0 events) → intro screen.
    await page.getByTestId('LifeScreen-WorldIntro-Begin').click({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Bubble-narrator').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Bubble-npc')).toBeVisible();
    // LIFE-NODE-4: 3 model options + client ✏️ chip; NO always-visible composer.
    await expect(page.getByTestId('LifeScreen-Choice-sophie')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-coffee')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-window')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-Choice-__write__')).toBeVisible();
    await expect(page.getByTestId('LifeScreen-FreeText')).toHaveCount(0);
    await captureBeat(page, testInfo, 'opening-node');
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

  test('LIFE-NODE-2/3 — cached pick renders instantly + skeletons; commit-on-pick lands events', async ({}, testInfo) => {
    await page.getByTestId('LifeScreen-Choice-sophie').click();
    // INSTANT cached render — the delayed options response (installed
    // in the opening test) can't have arrived yet; the beat below
    // came from option.next.
    await expect(page.getByText('Sophie te fait signe depuis la terrasse.')).toBeVisible({ timeout: 2_000 });
    await expect(page.getByTestId('LifeScreen-SkeletonChips')).toBeVisible({ timeout: 2_000 });
    await captureBeat(page, testInfo, 'instant-advance-skeletons');
    // Options land → chips.
    await expect(page.getByTestId('LifeScreen-Choice-sit')).toBeVisible({ timeout: 10_000 });
    // POST-CONDITION (LIFE-NODE-3): pick decision + preview beat are
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
            e.payload.practiceText === 'Sophie te fait signe depuis la terrasse.',
        );
        return decision && beat;
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('LIFE-NODE-4 — ✏️ chip opens the composer; submit lands a __write__ decision', async ({}, testInfo) => {
    await installLifeMock(page, {
      steps: [WRITE_RESPONSE],
      scenes: [minimalSceneSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-__write__').click();
    await expect(page.getByTestId('LifeScreen-FreeText')).toBeVisible();
    // Chips are hidden while the composer is open.
    await expect(page.getByTestId('LifeScreen-Choice-sit')).toHaveCount(0);
    await captureBeat(page, testInfo, 'composer-open');
    await page.getByTestId('LifeScreen-FreeText').locator('input').fill('On va au parc ?');
    await page.getByTestId('LifeScreen-FreeText-Send').click();
    await expect(page.getByText('Tu proposes une promenade au parc.')).toBeVisible({ timeout: 15_000 });
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
      steps: [POST_FEEDBACK_LIVE],
      gradedQuestions: [GRADED_FILL_BLANK],
      scenes: [minimalSceneSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-ask-week').click();
    // Question preview has NO chips of its own — authoring shimmer
    // first, then the generator's chips.
    await expect(page.getByTestId('LifeScreen-QuestionAuthoring')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Je ___ déjeuner avec toi.')).toBeVisible();
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
            e.payload.kind === 'fill-blank' &&
            e.payload.correct === true &&
            e.payload.correctAnswer === 'voudrais',
        );
      }, { timeout: 10_000 })
      .toBe(true);
  });

  test('LIFE-LANG-1/5 — comprehension chips render native-only; Why? opens the ExplainModal with streamed content', async ({}, testInfo) => {
    // Phase D carry-over, node-shaped: the question rides a preview,
    // the chips come from the graded generator queue.
    await installLifeMock(page, {
      steps: [AFTER_COMPREHENSION],
      gradedQuestions: [GRADED_COMPREHENSION],
      scenes: [minimalSceneSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-ask-cafe').click();
    await expect(page.getByTestId('LifeScreen-QuestionAuthoring')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toContainText(
      'Est-ce que tu connais un bon café près du bureau ?',
    );
    // LIFE-LANG-1 — comprehension chips render ONLY the native
    // interpretation; the practice-language paraphrase never shows.
    const cafeChip = page.getByTestId('LifeScreen-Choice-cafe');
    await expect(cafeChip).toContainText("She's asking about a café near the office");
    await expect(cafeChip).not.toContainText('Elle demande un café');
    await captureBeat(page, testInfo, 'comprehension-ready');

    await page.getByTestId('LifeScreen-Choice-cafe').click();
    await expect(page.getByTestId('LifeScreen-PracticeFeedback')).toBeVisible({ timeout: 5_000 });

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
    await expect(page.getByText('Le Petit Zinc', { exact: false })).toBeVisible({ timeout: 15_000 });
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

  test('LIFE-LANG-3 — viewMode cycle flips bubble + chip languages and persists to the world doc', async ({}, testInfo) => {
    // Phase D carry-over. State from the previous test: Sophie's
    // reply bubble + the AFTER_COMPREHENSION chips are on screen.
    // No Gemini calls fire in this test.
    const toggle = page.getByTestId('LifeScreen-ViewMode');
    await expect(toggle).toHaveAttribute('data-mode', 'visible');
    await expect(page.getByText('Super ! Il y a Le Petit Zinc juste à côté.')).toBeVisible();
    await expect(page.getByText("Great! There's Le Petit Zinc right next door.")).toBeVisible();

    // visible → native-only: practice text hides, native text stays.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'native-only', { timeout: 10_000 });
    await expect(page.getByText("Great! There's Le Petit Zinc right next door.")).toBeVisible();
    await expect(page.getByText('Super ! Il y a Le Petit Zinc juste à côté.')).not.toBeVisible();
    // Chips follow: main label becomes the native text (LIFE-LANG-3).
    const chip = page.getByTestId('LifeScreen-Choice-breakfast');
    await expect(chip).toContainText('Make breakfast');
    await expect(chip).not.toContainText('Préparer le petit-déjeuner');
    await captureBeat(page, testInfo, 'viewmode-native-only');

    // POST-CONDITION: the mode persisted to the world doc (it syncs
    // across devices) — not just a local render flip.
    const db = getAdminFirestore();
    await expect
      .poll(
        async () =>
          (await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).get()).data()?.viewMode,
        { timeout: 10_000 },
      )
      .toBe('native-only');

    // native-only → hidden: practice-only immersion.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'hidden', { timeout: 10_000 });
    await expect(page.getByText('Super ! Il y a Le Petit Zinc juste à côté.')).toBeVisible();
    await expect(page.getByText("Great! There's Le Petit Zinc right next door.")).not.toBeVisible();
    await expect(chip).toContainText('Préparer le petit-déjeuner');
    await expect(chip).not.toContainText('Make breakfast');
    await captureBeat(page, testInfo, 'viewmode-hidden');

    // hidden → visible: both languages back. Leaves the world doc in
    // the default state for the tests below.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'visible', { timeout: 10_000 });
    await expect(page.getByText('Super ! Il y a Le Petit Zinc juste à côté.')).toBeVisible();
    await expect(page.getByText("Great! There's Le Petit Zinc right next door.")).toBeVisible();
    await captureBeat(page, testInfo, 'viewmode-visible');
  });

  test('LIFE-NODE-8 — options-failed Continue ladder recovers; the pick still committed', async ({}, testInfo) => {
    // Empty step queue → the options call 500s → options-failed.
    await installLifeMock(page, { steps: [], scenes: [minimalSceneSvg()] });
    await page.getByTestId('LifeScreen-Choice-breakfast').click();
    // Cached beats still rendered (commit-on-pick is independent of
    // the failed options call).
    await expect(page.getByText('Tu hoches la tête.')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByTestId('LifeScreen-OptionsFailed')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId('LifeScreen-Choice-__continue__')).toBeVisible();
    await captureBeat(page, testInfo, 'options-failed');
    // POST-CONDITION: the pick committed even though options failed.
    await expect
      .poll(async () => {
        const events = await readEvents(userA.uid, worldId);
        return events.some(
          (e) => e.kind === 'decision' && e.payload.choiceId === 'breakfast',
        );
      }, { timeout: 10_000 })
      .toBe(true);
    // Recovery: fresh fixture → Continue fires a live turn.
    await installLifeMock(page, {
      steps: [RECOVERY_LIVE],
      scenes: [minimalSceneSvg()],
    });
    await page.getByTestId('LifeScreen-Choice-__continue__').click();
    await expect(page.getByText('La matinée reprend son cours.')).toBeVisible({ timeout: 15_000 });
    await captureBeat(page, testInfo, 'options-failed-recovered');
  });

  test('LIFE-FLOW-5 — resumed world shows the recap screen from stored data; Continue releases the resume chip', async ({}, testInfo) => {
    // Phase C carry-over. Seed a stored recap via the admin SDK so
    // every assertion is deterministic — this path makes zero LLM
    // calls before the resume pick. The nonexistent lastEventId also
    // arms the exit-generation test that follows (an out-of-window
    // anchor id counts as stale ⇒ ≥5 new events).
    const db = getAdminFirestore();
    await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).update({
      resumeRecap: {
        text: "Sophie t'a invité à déjeuner.\n\nSophie invited you to lunch.",
        lastEventId: 'seeded-nonexistent-event',
      },
    });

    await installLifeMock(page, {
      steps: [RESUME_LIVE],
      scenes: [minimalSceneSvg()],
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
      'La matinée reprend son cours.',
    );
    // The LIFE-FLOW-2 seeding is GATED until Continue.
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toHaveCount(0);
    await captureBeat(page, testInfo, 'resume-recap');

    await page.getByTestId('LifeScreen-WurldResume-Continue').click();
    await expect(page.getByTestId('LifeScreen-WurldResume')).toHaveCount(0);
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toBeVisible({ timeout: 10_000 });
    await captureBeat(page, testInfo, 'resume-prompt');
    // The resume chip routes through the engine → live turn.
    await page.getByTestId('LifeScreen-Choice-__resume__').click();
    await expect(page.getByText('Tu reprends le fil de ta journée.')).toBeVisible({ timeout: 15_000 });
  });

  test('LIFE-FLOW-5 — world exit fires the recap generator and persists resumeRecap', async () => {
    // Phase C carry-over. ≥5 events landed since the seeded
    // nonexistent lastEventId, so exiting the world must fire exactly
    // one life_resume_recap call.
    await installLifeMock(page, {
      steps: [],
      scenes: [],
      resumeRecaps: [
        {
          practiceText: 'Précédemment : un déjeuner et un café sont prévus.',
          nativeText: 'Previously: a lunch and a café are planned.',
        },
      ],
    });

    // In-app exit → LifeScreen unmount → fire-and-forget generation.
    await page.getByTestId('LifeScreen-MenuButton').click();
    await page.getByTestId('LifeScreen-Menu-Exit').click();
    await page.waitForURL((url) => url.pathname === '/life/overview', { timeout: 10_000 });

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

  test('@standard LIFE-UI-8 — rebrand copy renders: Wurlds tab + overview', async ({}, testInfo) => {
    // POST-PHASE-A carry-forward (phase-a.md T3), ported UNCHANGED — a
    // rebrand copy-assertion on the overview surface, independent of the
    // CYOA→node engine swap (no installLifeMock / node fixtures needed).
    // Enable the lifeSimBeta flag so the Wurlds tab renders. Seed the
    // zustand-persist record BEFORE the app boots (addInitScript runs
    // before every subsequent navigation's scripts). This is the same
    // JSON shape the app's own ?betaFlag URL hook writes
    // (src/lib/testHooks.ts) — seeding directly avoids that hook's
    // mid-boot location.reload(), which can abort page.goto with an
    // interrupted-navigation error (installTestHooks() runs at module
    // top of src/main.tsx, i.e. before the load event).
    await page.addInitScript(() => {
      localStorage.setItem(
        'wurld-beta-flags',
        JSON.stringify({ state: { flags: { lifeSimBeta: true } }, version: 0 }),
      );
    });
    await page.goto('/life/overview');
    await page.waitForURL((url) => url.pathname === '/life/overview', {
      timeout: 10_000,
    });

    // POST-CONDITION (LIFE-UI-8): the rebranded copy is in the DOM.
    await expect(page.getByText('Your Other Wurlds')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('link', { name: 'Wurlds', exact: true }),
    ).toBeVisible();
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
});
```

Implementation notes for the executor:

- `page.getByTestId('LifeScreen-FreeText').locator('input')` — the testid sits on the `<form>`; the input is its only `input` child.
- `installLifeMock` is called multiple times across the serial suite — Playwright routes stack LIFO, so each later install shadows the earlier one for `**/geminiGenerate`. That is the established pattern from the pre-F spec; do not add unroutes.
- The `'Previously, in this wurld'` string is the `life.resume.eyebrow` i18n value (Phase C); the `'The story snagged for a moment.'` / vocab-popover button names are `en.ts` values from F6-a / Phase E. If a landed `en.ts` value differs, the i18n file is the source of truth — update the assertion string, not the locale.
- If `db.recursiveDelete` is unavailable in the pinned `firebase-admin` version, replace with a manual two-level delete (list `events` docs → batch delete → delete world doc); do not skip cleanup — the stable pool account must never hit `MAX_WORLDS`.

### F7-e — `src/lib/life/stepSchema.ts`: delete the legacy shapes

After F7-a/b/c nothing references `ZRawStepResponse` / `RawStepResponse` / `ZStepResponse` / `StepResponse` (verify FIRST: `git grep -nE 'ZRawStepResponse|RawStepResponse|ZStepResponse|StepResponse' -- src tests | grep -v stepSchema.ts | grep -v RawNodeResponse` → no hits; if it prints anything, an earlier step was applied incompletely — fix that before deleting).

Delete the contiguous span from the ANCHOR (start, verify unique):

```
/** LIFE-EX-PLAN-*: the raw shape the `lifeStep` Gemini call emits.
```

through the ANCHOR (end, verify unique — the same line F1-b appended the node block after):

```
export type StepResponse = z.infer<typeof ZStepResponse>;
```

INCLUSIVE of both anchor lines. That span is exactly: the legacy doc comment, `ZRawStepResponse` (+ its superRefine), `export type RawStepResponse`, `ZStepResponse` (+ its superRefine), and `export type StepResponse`. Everything ABOVE it (`ZStepBeat` … `ZGradedPlan` exports) and everything BELOW it (the F1-b node block: `WRITE_YOUR_OWN_ID` … `ZRawNodeResponseLenient`) stays byte-identical. `ZPracticePrompt` remains exported and used (graded generator + the engine's question state) even though the deleted block was its only in-file consumer. After the deletion run `npx vitest run src/lib/life/stepSchema.test.ts` (still green — T1 never referenced the legacy shapes) and `npm run typecheck`.

---

## Tests

Every `it(...)` that asserts an invariant starts with the invariant id (repo convention). Write each file at the step indicated in Ordered steps, run it, and see it FAIL before implementing.

### T1 — `src/lib/life/stepSchema.test.ts` (Step 1 — full rewrite, complete contents)

```ts
import { describe, it, expect } from 'vitest';
import {
  WRITE_YOUR_OWN_ID,
  ZGradedPlan,
  ZNodePreview,
  ZRawNodeResponse,
  ZStepChoice,
  ZStepOption,
  optionCountIssues,
} from './stepSchema';

const narratorBeat = {
  speaker: 'narrator',
  practiceText: 'Tu te réveilles.',
  nativeText: 'You wake up.',
};

const branchPreview = {
  kind: 'branch' as const,
  beats: [narratorBeat],
};

const opt = (id: string, extra: Record<string, unknown>) => ({
  id,
  practiceText: `option ${id}`,
  nativeText: `option ${id} gloss`,
  ...extra,
});

const liveBranchResponse = {
  node: { kind: 'branch', beats: [narratorBeat] },
  options: [
    opt('a', { next: branchPreview }),
    opt('b', { noPreview: true }),
  ],
};

describe('ZNodePreview — LIFE-NODE-1', () => {
  it('LIFE-NODE-1 — accepts a branch node with 0 beats (post-comprehension case)', () => {
    expect(ZNodePreview.safeParse({ kind: 'branch', beats: [] }).success).toBe(true);
    expect(ZNodePreview.safeParse({ kind: 'branch' }).success).toBe(true);
  });

  it('LIFE-NODE-1 — rejects a branch node with 3 beats', () => {
    const r = ZNodePreview.safeParse({
      kind: 'branch',
      beats: [narratorBeat, narratorBeat, narratorBeat],
    });
    expect(r.success).toBe(false);
  });

  it('LIFE-NODE-1 — continuation requires 1-2 beats', () => {
    expect(ZNodePreview.safeParse({ kind: 'continuation', beats: [] }).success).toBe(false);
    expect(
      ZNodePreview.safeParse({ kind: 'continuation', beats: [narratorBeat] }).success,
    ).toBe(true);
  });

  it('LIFE-NODE-1 — question carries a gradedPlan and never beats', () => {
    const r = ZNodePreview.safeParse({
      kind: 'question',
      gradedPlan: {
        kind: 'fill-blank',
        testTarget: 'voudrais',
        sentenceContext: 'Je voudrais un café.',
      },
      beats: [narratorBeat], // stray key — stripped, never surfaces
    });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('beats');
    expect(ZNodePreview.safeParse({ kind: 'question' }).success).toBe(false);
  });

  it('LIFE-NODE-2 — preview may carry a sceneIntent', () => {
    const r = ZNodePreview.safeParse({
      kind: 'branch',
      beats: [narratorBeat],
      sceneIntent: {
        locationType: 'cafe',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Le café · matin',
      },
    });
    expect(r.success).toBe(true);
  });
});

describe('ZRawNodeResponse — LIFE-NODE-2/5 superRefine matrix', () => {
  it('LIFE-NODE-2 — accepts a live branch response (next XOR noPreview per option)', () => {
    expect(ZRawNodeResponse.safeParse(liveBranchResponse).success).toBe(true);
  });

  it('LIFE-NODE-2 — rejects an option with BOTH next and noPreview', () => {
    const bad = {
      ...liveBranchResponse,
      options: [
        opt('a', { next: branchPreview, noPreview: true }),
        opt('b', { noPreview: true }),
      ],
    };
    expect(ZRawNodeResponse.safeParse(bad).success).toBe(false);
  });

  it('LIFE-NODE-2 — rejects an option with NEITHER next nor noPreview', () => {
    const bad = {
      ...liveBranchResponse,
      options: [opt('a', {}), opt('b', { noPreview: true })],
    };
    expect(ZRawNodeResponse.safeParse(bad).success).toBe(false);
  });

  it('LIFE-NODE-2 — rejects more than 3 options', () => {
    const bad = {
      ...liveBranchResponse,
      options: [
        opt('a', { next: branchPreview }),
        opt('b', { next: branchPreview }),
        opt('c', { next: branchPreview }),
        opt('d', { noPreview: true }),
      ],
    };
    expect(ZRawNodeResponse.safeParse(bad).success).toBe(false);
  });

  it('LIFE-NODE-1 — live branch node requires 2-3 options', () => {
    const one = {
      ...liveBranchResponse,
      options: [opt('a', { next: branchPreview })],
    };
    expect(ZRawNodeResponse.safeParse(one).success).toBe(false);
  });

  it('LIFE-NODE-1 — live continuation node requires exactly one option with id "continue"', () => {
    const good = {
      node: { kind: 'continuation', beats: [narratorBeat] },
      options: [opt('continue', { next: branchPreview })],
    };
    expect(ZRawNodeResponse.safeParse(good).success).toBe(true);
    const wrongId = {
      node: { kind: 'continuation', beats: [narratorBeat] },
      options: [opt('go', { next: branchPreview })],
    };
    expect(ZRawNodeResponse.safeParse(wrongId).success).toBe(false);
  });

  it('LIFE-NODE-1 — live question node requires EMPTY options (generator authors chips)', () => {
    const questionNode = {
      kind: 'question',
      gradedPlan: {
        kind: 'comprehension',
        npcUtterance: 'Combien ça coûte ?',
      },
    };
    expect(
      ZRawNodeResponse.safeParse({ node: questionNode, options: [] }).success,
    ).toBe(true);
    expect(
      ZRawNodeResponse.safeParse({
        node: questionNode,
        options: [opt('a', { noPreview: true }), opt('b', { noPreview: true })],
      }).success,
    ).toBe(false);
  });

  it('LIFE-NODE-5 — the hook-accept chip must be noPreview', () => {
    const base = {
      node: { kind: 'branch', beats: [narratorBeat] },
      campaign: {
        hook: { hookId: 'h1', pitch: 'A stranger beckons', acceptChipId: 'accept' },
      },
    };
    const withPreview = {
      ...base,
      options: [opt('accept', { next: branchPreview }), opt('decline', { noPreview: true })],
    };
    expect(ZRawNodeResponse.safeParse(withPreview).success).toBe(false);
    const withNoPreview = {
      ...base,
      options: [opt('accept', { noPreview: true }), opt('decline', { next: branchPreview })],
    };
    expect(ZRawNodeResponse.safeParse(withNoPreview).success).toBe(true);
  });

  it('LIFE-NODE-2 — options-mode responses (no node) skip the count rule at schema level', () => {
    // The client supplies currentNodeKind — generateStepOptions
    // enforces counts via optionCountIssues there.
    const r = ZRawNodeResponse.safeParse({
      options: [opt('continue', { next: branchPreview })],
    });
    expect(r.success).toBe(true);
  });
});

describe('optionCountIssues — LIFE-NODE-1 (options-mode counts)', () => {
  const o = (id: string) => ({ id });
  it('LIFE-NODE-1 — branch wants 2-3', () => {
    expect(optionCountIssues([o('a')], 'branch')).toHaveLength(1);
    expect(optionCountIssues([o('a'), o('b')], 'branch')).toHaveLength(0);
  });
  it('LIFE-NODE-1 — continuation wants exactly one "continue"', () => {
    expect(optionCountIssues([o('continue')], 'continuation')).toHaveLength(0);
    expect(optionCountIssues([o('go')], 'continuation')).toHaveLength(1);
    expect(optionCountIssues([o('continue'), o('x')], 'continuation')).toHaveLength(1);
  });
  it('LIFE-NODE-1 — question wants zero', () => {
    expect(optionCountIssues([], 'question')).toHaveLength(0);
    expect(optionCountIssues([o('a')], 'question')).toHaveLength(1);
  });
});

describe('WRITE_YOUR_OWN_ID — LIFE-NODE-4', () => {
  it('LIFE-NODE-4 — is the pinned "__write__" id', () => {
    expect(WRITE_YOUR_OWN_ID).toBe('__write__');
  });
});

describe('ZGradedPlan — LIFE-EX-PLAN-2 (unchanged shapes)', () => {
  it('accepts a fill-blank plan with testTarget + sentenceContext', () => {
    const plan = {
      kind: 'fill-blank' as const,
      testTarget: 'quand même',
      sentenceContext: 'Ils vont tous abattre les humains quand même.',
      rationale: 'fixed expression worth testing in context',
    };
    expect(ZGradedPlan.safeParse(plan).success).toBe(true);
  });

  it('accepts a comprehension plan', () => {
    const plan = {
      kind: 'comprehension' as const,
      npcUtterance: 'Comment ça va ?',
      speakerName: 'Sophie',
      npcId: 'sophie-cafe',
    };
    expect(ZGradedPlan.safeParse(plan).success).toBe(true);
  });

  it('rejects a fill-blank plan missing sentenceContext', () => {
    expect(
      ZGradedPlan.safeParse({ kind: 'fill-blank' as const, testTarget: 'voudrais' }).success,
    ).toBe(false);
  });
});

// Re-add note: Phase E (phase-e.md Test section F) unit-covered the
// ZStepChoice annotation fields against the CYOA-era ZStepResponse, which
// F7-e deletes — this describe re-expresses that coverage against F's
// surviving exports so E's LIFE-BUBBLE-7 schema assurance is not dropped
// by this file's full rewrite. ZStepChoice keeps the fields for graded
// inline chips; ZStepOption (the node-engine successor to the chip)
// inherits them via ZStepChoice.omit({ correctness }).extend(...).
describe('ZStepChoice / ZStepOption annotations — LIFE-BUBBLE-7 (Phase E carry-forward)', () => {
  it('LIFE-BUBBLE-7 — ZStepChoice accepts + round-trips complexWords/wordTranslations', () => {
    const parsed = ZStepChoice.safeParse({
      id: 'c1',
      practiceText: 'voudrais',
      nativeText: 'would like',
      correctness: 'correct',
      complexWords: ['voudrais'],
      wordTranslations: { voudrais: 'would like' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.complexWords).toEqual(['voudrais']);
    expect(parsed.data.wordTranslations).toEqual({ voudrais: 'would like' });
  });

  it('LIFE-BUBBLE-7 — ZStepOption inherits + round-trips the annotation fields', () => {
    const parsed = ZStepOption.safeParse({
      id: 'greet',
      practiceText: 'Saluer Sophie',
      nativeText: 'Greet Sophie',
      noPreview: true,
      complexWords: ['Saluer'],
      wordTranslations: { Saluer: 'to greet' },
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.complexWords).toEqual(['Saluer']);
    expect(parsed.data.wordTranslations).toEqual({ Saluer: 'to greet' });
  });
});
```

### T2 — `src/lib/life/validateStep.test.ts` (Step 5 — full rewrite, complete contents)

```ts
import { describe, it, expect } from 'vitest';
import { renderRetryHint, validateNodeResponse } from './validateStep';
import type { NodePreview, StepOption } from './stepSchema';

const beat = (text: string, speaker: 'narrator' | 'npc' = 'narrator') => ({
  speaker,
  speakerName: speaker === 'npc' ? 'Sophie' : null,
  practiceText: text,
  nativeText: 'gloss',
});

const branchNode = (texts: string[]): NodePreview => ({
  kind: 'branch',
  beats: texts.map((t) => beat(t)),
});

const option = (
  id: string,
  practiceText: string,
  nativeText: string,
  next?: NodePreview,
): Pick<StepOption, 'id' | 'practiceText' | 'nativeText' | 'next'> => ({
  id,
  practiceText,
  nativeText,
  next,
});

describe('validateNodeResponse', () => {
  it('passes a clean node + options', () => {
    const issues = validateNodeResponse({
      node: branchNode(["Sophie t'attend."]),
      options: [
        option('a', 'Aller au café', 'Go to the café'),
        option('b', 'Rester', 'Stay'),
      ],
    });
    expect(issues).toEqual([]);
  });

  it('flags duplicate practiceText across options', () => {
    const issues = validateNodeResponse({
      node: null,
      options: [
        option('a', 'Aller au café', 'Go to the café'),
        option('b', 'Aller au café', 'Head to the café'),
      ],
    });
    expect(issues.some((i) => i.code === 'duplicate-practice')).toBe(true);
  });

  it('flags duplicate nativeText across options', () => {
    const issues = validateNodeResponse({
      node: null,
      options: [
        option('a', 'Aller au café', 'Go'),
        option('b', 'Rester', 'Go'),
      ],
    });
    expect(issues.some((i) => i.code === 'duplicate-native')).toBe(true);
  });

  describe('node-repeats-practiced-line (LIFE-CONTRACT-EX-4)', () => {
    const practicedLine = "Je voudrais un café, s'il vous plaît.";

    it('does NOT flag when no practicedLine context is supplied', () => {
      const issues = validateNodeResponse({
        node: branchNode(['Tu dis: «Je voudrais un café, s\'il vous plaît.»']),
        options: [],
      });
      expect(issues).toEqual([]);
    });

    it('flags a node beat that verbatim quotes the just-practised line', () => {
      const issues = validateNodeResponse(
        {
          node: branchNode(['Tu dis: «Je voudrais un café, s\'il vous plaît.»']),
          options: [],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(true);
    });

    it('flags a PREVIEW beat that re-emits the practised line', () => {
      const issues = validateNodeResponse(
        {
          node: branchNode(['Sophie hoche la tête.']),
          options: [
            option('a', 'Répéter', 'Repeat', branchNode([practicedLine])),
            option('b', 'Continuer', 'Continue'),
          ],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(true);
    });

    it('flags a substantially-overlapping rephrase', () => {
      const issues = validateNodeResponse(
        { node: branchNode(["Je voudrais un café s'il vous plaît !"]), options: [] },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(true);
    });

    it("does NOT flag the NPC's natural response to the practised line", () => {
      const issues = validateNodeResponse(
        {
          node: { kind: 'branch', beats: [beat('Très bien ! Et avec ça ?', 'npc')] },
          options: [],
        },
        { practicedLine },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(false);
    });

    it('does NOT flag short practised lines (false-positive guard)', () => {
      const issues = validateNodeResponse(
        { node: branchNode(['Tu vas où ?']), options: [] },
        { practicedLine: 'Salut !' },
      );
      expect(issues.some((i) => i.code === 'node-repeats-practiced-line')).toBe(false);
    });

    it('skips question previews (they carry no beats)', () => {
      const issues = validateNodeResponse(
        {
          node: null,
          options: [
            option('a', 'Demander', 'Ask', {
              kind: 'question',
              gradedPlan: {
                kind: 'fill-blank',
                testTarget: 'voudrais',
                sentenceContext: practicedLine,
              },
            }),
            option('b', 'Partir', 'Leave'),
          ],
        },
        { practicedLine },
      );
      expect(issues).toEqual([]);
    });
  });

  it('renderRetryHint is empty for no issues and lists codes otherwise', () => {
    expect(renderRetryHint([])).toBe('');
    const hint = renderRetryHint([
      { code: 'duplicate-practice', message: 'a' },
      { code: 'node-repeats-practiced-line', message: 'b' },
    ]);
    expect(hint).toContain('duplicate-practice');
    expect(hint).toContain('node-repeats-practiced-line');
  });
});
```

### T3 — `src/lib/life/commitNode.test.ts` (Step 2 — new, complete contents)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./world', () => ({
  appendBeatEvent: vi.fn(),
  appendDecisionEvent: vi.fn(),
  appendLifeEvent: vi.fn(),
  updateLifeWorld: vi.fn(),
}));
vi.mock('./npcs', () => ({
  promoteOrTouchNpc: vi.fn(),
  setNpcAvatar: vi.fn(),
  setNpcAvatarFailed: vi.fn(),
}));
vi.mock('./generateNpcAvatar', () => ({
  generateNpcAvatar: vi.fn(),
  svgToDataUri: vi.fn(() => 'data:image/svg+xml;base64,x'),
}));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import {
  appendBeatEvent,
  appendDecisionEvent,
  appendLifeEvent,
  updateLifeWorld,
} from './world';
import { promoteOrTouchNpc } from './npcs';
import { generateNpcAvatar } from './generateNpcAvatar';
import { applyTurnSignals, commitNode } from './commitNode';
import type { LifeWorld } from '@/types/firestore';

const appendBeatEventMock = vi.mocked(appendBeatEvent);
const appendDecisionEventMock = vi.mocked(appendDecisionEvent);
const appendLifeEventMock = vi.mocked(appendLifeEvent);
const updateLifeWorldMock = vi.mocked(updateLifeWorld);
const promoteOrTouchNpcMock = vi.mocked(promoteOrTouchNpc);
const generateNpcAvatarMock = vi.mocked(generateNpcAvatar);

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
  // Avatar already generated → no player-avatar kickoff noise.
  characterAvatarUrl: 'data:image/svg+xml;base64,y',
  characterAvatarStatus: 'ready',
  currentLocationLabel: 'Ton appartement · matin',
};

const npcBeat = {
  speaker: 'npc' as const,
  speakerName: 'Sophie',
  npcId: 'sophie',
  practiceText: 'Salut !',
  nativeText: 'Hi!',
};
const narratorBeat = {
  speaker: 'narrator' as const,
  speakerName: null,
  npcId: null,
  practiceText: 'Le soleil se lève.',
  nativeText: 'The sun rises.',
};

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  appendDecisionEventMock.mockImplementation(async () => {
    calls.push('decision');
    return 'e-d';
  });
  appendLifeEventMock.mockImplementation(async (input) => {
    calls.push(`event:${(input as { kind: string }).kind}`);
    return 'e-l';
  });
  appendBeatEventMock.mockImplementation(async (_u, _w, beat) => {
    calls.push(`beat:${(beat as { practiceText: string }).practiceText}`);
    return 'e-b';
  });
  updateLifeWorldMock.mockImplementation(async () => {
    calls.push('world');
  });
  promoteOrTouchNpcMock.mockImplementation(async () => {
    calls.push('promote');
    return { isNew: false };
  });
  generateNpcAvatarMock.mockResolvedValue({ kind: 'error', error: 'off' } as never);
});

describe('commitNode — LIFE-NODE-3 write ordering', () => {
  it('LIFE-NODE-3 — decision event first, then promote→introduced→beat per NPC beat, then scene patch', async () => {
    promoteOrTouchNpcMock.mockImplementationOnce(async () => {
      calls.push('promote');
      return { isNew: true };
    });
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: { kind: 'choice', choiceId: 'sophie', text: 'Rejoindre Sophie' },
      beats: [narratorBeat, npcBeat],
      sceneIntent: {
        locationType: 'cafe',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Le café · matin',
      },
    });
    expect(calls).toEqual([
      'decision',
      'beat:Le soleil se lève.',
      'promote',
      'event:npc_introduced',
      'beat:Salut !',
      'world',
    ]);
    expect(updateLifeWorldMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({
        currentLocationLabel: 'Le café · matin',
        currentScene: expect.objectContaining({ locationType: 'cafe' }),
      }),
    );
  });

  it('LIFE-NODE-3 — practice-outcome commits a correction event with the full payload', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: {
        kind: 'practice-outcome',
        outcome: {
          kind: 'fill-blank',
          correct: true,
          picked: 'voudrais',
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café.',
        },
      },
      beats: [],
      sceneIntent: null,
    });
    expect(appendLifeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'correction',
        payload: expect.objectContaining({
          kind: 'fill-blank',
          correct: true,
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café.',
        }),
      }),
    );
  });

  it('LIFE-NODE-4 — free-text commits a decision with the __write__ id', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: { kind: 'free-text', text: 'On va au parc ?' },
      beats: [],
      sceneIntent: null,
    });
    expect(appendDecisionEventMock).toHaveBeenCalledWith('u1', 'w1', {
      choiceId: '__write__',
      text: 'On va au parc ?',
    });
  });

  it("LIFE-NODE-3 — action 'none' writes no action event", async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: { kind: 'none' },
      beats: [narratorBeat],
      sceneIntent: null,
    });
    expect(appendDecisionEventMock).not.toHaveBeenCalled();
    expect(appendLifeEventMock).not.toHaveBeenCalled();
    expect(appendBeatEventMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-3 — the same NPC in two beats promotes once; avatar kickoff only when new', async () => {
    promoteOrTouchNpcMock.mockImplementation(async () => {
      calls.push('promote');
      return { isNew: true };
    });
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: 'c1',
      action: { kind: 'none' },
      beats: [npcBeat, { ...npcBeat, practiceText: 'Ça va ?' }],
      sceneIntent: null,
    });
    expect(promoteOrTouchNpcMock).toHaveBeenCalledTimes(1);
    expect(promoteOrTouchNpcMock).toHaveBeenCalledWith(
      expect.objectContaining({ npcId: 'sophie', campaignId: 'c1' }),
    );
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalled());
  });

  it('LIFE-NODE-3 — no scene patch when the location label is unchanged', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      campaignId: null,
      action: { kind: 'none' },
      beats: [],
      sceneIntent: {
        locationType: 'apartment',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Ton appartement · matin',
      },
    });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-NPC-2 — player avatar kickoff fires when the world has no avatar', async () => {
    // url null + status 'ready' (≠ pending/failed) → kickoff fires.
    const bare: LifeWorld = { ...baseWorld, characterAvatarUrl: null };
    await commitNode({
      uid: 'u1',
      world: bare,
      campaignId: null,
      action: { kind: 'none' },
      beats: [],
      sceneIntent: null,
    });
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalled());
  });
});

describe('applyTurnSignals — LIFE-NODE-3 turn-level deltas', () => {
  it('merges addGoals/removeGoals against the world and patches the label', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: { ...baseWorld, currentGoals: ['rentrer chez moi', 'voir Sophie'] },
      worldDelta: {
        currentLocationLabel: 'Le marché',
        addGoals: ['acheter des oranges'],
        removeGoals: ['rentrer chez moi'],
      },
    });
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      currentLocationLabel: 'Le marché',
      currentGoals: ['voir Sophie', 'acheter des oranges'],
    });
  });

  it('writes nothing for an empty delta', async () => {
    await applyTurnSignals({ uid: 'u1', world: baseWorld, worldDelta: {} });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });
});
```

### T4 — `src/lib/life/mergeLocalEvents.test.ts` (Step 3 — new, complete contents)

```ts
import { describe, expect, it } from 'vitest';
import {
  localBeatEvent,
  localCorrectionEvent,
  localDecisionEvent,
  mergeLocalEvents,
  pruneDelivered,
} from './mergeLocalEvents';
import type { LifeEvent } from '@/types/firestore';

const listenerEvent = (kind: LifeEvent['kind'], payload: Record<string, unknown>): LifeEvent => ({
  id: `srv-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  payload,
});

describe('mergeLocalEvents — LIFE-NODE-3 overlay', () => {
  it('appends undelivered local events after the listener list', () => {
    const listener = [listenerEvent('beat', { practiceText: 'A' })];
    const local = [localDecisionEvent({ choiceId: 'x', text: 'Pick X' })];
    const merged = mergeLocalEvents(listener, local);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.kind).toBe('decision');
  });

  it('drops a local event once the listener delivers a matching fingerprint', () => {
    const local = [
      localDecisionEvent({ choiceId: 'x', text: 'Pick X' }),
      localBeatEvent({
        speaker: 'narrator',
        speakerName: null,
        npcId: null,
        practiceText: 'Le soleil se lève.',
        nativeText: 'The sun rises.',
      }),
    ];
    const listener = [
      listenerEvent('decision', { choiceId: 'x', text: 'Pick X' }),
      listenerEvent('beat', { practiceText: 'Le soleil se lève.' }),
    ];
    expect(pruneDelivered(listener, local)).toHaveLength(0);
    expect(mergeLocalEvents(listener, local)).toHaveLength(2);
  });

  it('keeps local events whose text has not appeared', () => {
    const local = [localCorrectionEvent({
      kind: 'fill-blank',
      correct: false,
      picked: 'veux',
      correctAnswer: 'voudrais',
      promptSource: 'Je ___ un café.',
    })];
    const listener = [listenerEvent('beat', { practiceText: 'Autre chose.' })];
    const pruned = pruneDelivered(listener, local);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.kind).toBe('correction');
  });

  it('caps the overlay at 12 entries', () => {
    const local = Array.from({ length: 20 }, (_, i) =>
      localDecisionEvent({ choiceId: `c${i}`, text: `Pick ${i}` }),
    );
    expect(pruneDelivered([], local)).toHaveLength(12);
  });
});
```

### T5 — `src/lib/life/generateStepOptions.test.ts` (Step 3 — new, complete contents)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({ generateGemini: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock('./runCompaction', () => ({ runCompaction: vi.fn() }));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));

import { generateGemini } from '../gemini';
import {
  buildGradedSceneContext,
  generateStepOptions,
  recentFillBlankTargets,
  sanitizeOptions,
} from './generateStepOptions';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const generateGeminiMock = vi.mocked(generateGemini);

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const event = (kind: LifeEvent['kind'], payload: Record<string, unknown>): LifeEvent => ({
  id: 'e' + Math.random().toString(36).slice(2, 8),
  kind,
  payload,
});

const narratorBeat = {
  speaker: 'narrator',
  practiceText: 'Tu entres au café.',
  nativeText: 'You enter the café.',
};
const branchPreview = { kind: 'branch', beats: [narratorBeat] };
const validLive = {
  node: { kind: 'branch', beats: [narratorBeat] },
  options: [
    { id: 'a', practiceText: 'Avancer', nativeText: 'Move forward', next: branchPreview },
    { id: 'b', practiceText: 'Attendre', nativeText: 'Wait', noPreview: true },
  ],
};
const validOptionsOnly = {
  options: [
    { id: 'a', practiceText: 'Avancer', nativeText: 'Move forward', next: branchPreview },
    { id: 'b', practiceText: 'Attendre', nativeText: 'Wait', noPreview: true },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('generateStepOptions — LIFE-NODE-2', () => {
  it('LIFE-NODE-2 — live turn: parses node + options, echoes the nonce', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 7,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.node?.kind).toBe('branch');
    expect(result.options).toHaveLength(2);
    expect(result.nonce).toBe(7);
    // Opening derivation: empty events + live → <turn kind="opening">.
    const prompt = (generateGeminiMock.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('<turn kind="opening">');
  });

  it('LIFE-NODE-2 — options turn: prompt carries <turn kind="options">, node omitted in result', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validOptionsOnly));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('beat', { speaker: 'narrator', practiceText: 'X' })],
      turn: { kind: 'options', currentNodeKind: 'branch' },
      nonce: 0,
    });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.node).toBeNull();
    const prompt = (generateGeminiMock.mock.calls[0]![0] as { prompt: string }).prompt;
    expect(prompt).toContain('<turn kind="options" nodeKind="branch">');
  });

  it('LIFE-NODE-2 — a stray node on an options turn is DROPPED, not retried', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('beat', { speaker: 'narrator', practiceText: 'X' })],
      turn: { kind: 'options', currentNodeKind: 'branch' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.node).toBeNull();
  });

  it('LIFE-NODE-8 — live turn without a node retries once with a hint, then ok', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly)) // no node → bad for live
      .mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('decision', { choiceId: 'a', text: 'X' })],
      turn: { kind: 'live', choice: { id: 'a', practiceText: 'X' } },
      nonce: 0,
    });
    expect(result.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    const second = (generateGeminiMock.mock.calls[1]![0] as { prompt: string }).prompt;
    expect(second).toContain('<retryHint>');
  });

  it('LIFE-NODE-8 — two schema failures → schema-failed with both raw attempts', async () => {
    generateGeminiMock
      .mockResolvedValueOnce('not json at all')
      .mockResolvedValueOnce(JSON.stringify({ options: [{ id: 'a' }] }));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 3,
    });
    expect(result.kind).toBe('schema-failed');
    if (result.kind === 'schema-failed') {
      expect(result.rawAttempts).toHaveLength(2);
      expect(result.nonce).toBe(3);
    }
  });

  it('LIFE-NODE-8 — a thrown Gemini call returns kind error immediately', async () => {
    generateGeminiMock.mockRejectedValueOnce(new Error('network'));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 0,
    });
    expect(result.kind).toBe('error');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-5 — one broken preview is demoted to noPreview without a retry', async () => {
    const broken = {
      node: { kind: 'branch', beats: [narratorBeat] },
      options: [
        { id: 'a', practiceText: 'Avancer', nativeText: 'Move', next: { kind: 'bogus' } },
        { id: 'b', practiceText: 'Attendre', nativeText: 'Wait', next: branchPreview },
      ],
    };
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(broken));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    const demoted = result.options.find((o) => o.id === 'a');
    expect(demoted?.next).toBeUndefined();
    expect(demoted?.noPreview).toBe(true);
    expect(result.options.find((o) => o.id === 'b')?.next).toBeDefined();
  });

  it('LIFE-NODE-5 — when NO preview survives, the sanitize pass yields nothing and the call retries', async () => {
    const allBroken = {
      node: { kind: 'branch', beats: [narratorBeat] },
      options: [
        { id: 'a', practiceText: 'Avancer', nativeText: 'Move', next: { kind: 'bogus' } },
        { id: 'b', practiceText: 'Attendre', nativeText: 'Wait', next: { nope: true } },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(allBroken))
      .mockResolvedValueOnce(JSON.stringify(validLive));
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [],
      turn: { kind: 'live' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('ok');
  });

  it('LIFE-NODE-1 — options turn for a continuation enforces the single continue option', async () => {
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(validOptionsOnly)) // 2 options → wrong for continuation
      .mockResolvedValueOnce(
        JSON.stringify({
          options: [
            { id: 'continue', practiceText: 'Continuer', nativeText: 'Continue', next: branchPreview },
          ],
        }),
      );
    const result = await generateStepOptions({
      uid: 'u1',
      world: baseWorld,
      events: [event('beat', { speaker: 'narrator', practiceText: 'X' })],
      turn: { kind: 'options', currentNodeKind: 'continuation' },
      nonce: 0,
    });
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    expect(result.kind).toBe('ok');
    if (result.kind === 'ok') expect(result.options[0]!.id).toBe('continue');
  });
});

describe('sanitizeOptions — LIFE-NODE-5', () => {
  it('returns null for a broken envelope or a broken live node', () => {
    expect(sanitizeOptions('nope')).toBeNull();
    expect(
      sanitizeOptions({ node: { kind: 'bogus' }, options: validLive.options }),
    ).toBeNull();
  });
});

describe('moved helpers', () => {
  it('recentFillBlankTargets dedups + lowercases correction targets', () => {
    const events = [
      event('correction', { kind: 'fill-blank', correctAnswer: 'Voudrais' }),
      event('correction', { kind: 'fill-blank', correctAnswer: 'voudrais' }),
      event('correction', { kind: 'comprehension', correctAnswer: 'ignored' }),
    ];
    expect(recentFillBlankTargets(events)).toEqual(['voudrais']);
  });

  it('buildGradedSceneContext carries saga title, location, speaker + last beats', () => {
    const ctx = buildGradedSceneContext(
      {
        ...baseWorld,
        currentLocationLabel: 'Le café · matin',
        saga: undefined,
      },
      [
        event('beat', { practiceText: 'Un.' }),
        event('beat', { practiceText: 'Deux.' }),
        event('beat', { practiceText: 'Trois.' }),
        event('beat', { practiceText: 'Quatre.' }),
      ],
      { kind: 'comprehension', npcUtterance: 'Salut ?', speakerName: 'Sophie' },
    );
    expect(ctx.locationLabel).toBe('Le café · matin');
    expect(ctx.speakerName).toBe('Sophie');
    expect(ctx.recentBeats).toEqual(['Deux.', 'Trois.', 'Quatre.']);
  });
});
```

### T6 — `src/lib/life/prompts/step.test.ts` (Step 4 — edits)

**Edit 1.** ANCHOR (verify unique): `    it('does NOT inject the directive when the streak is below 3', () => {` — replace the whole test (through its closing `    });`) with:

```ts
    it('LIFE-NODE-7 — does NOT inject the directive when the streak is below 4', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          fakeEvent('decision', { choiceId: 'a', text: 'X' }),
          fakeEvent('decision', { choiceId: 'b', text: 'Y' }),
          fakeEvent('decision', { choiceId: 'c', text: 'Z' }),
        ],
        choice: { id: 'next', practiceText: 'Continuer' },
        isOpeningBeat: false,
      });
      expect(out).not.toContain('<practiceCadence');
    });
```

**Edit 2.** ANCHOR (verify unique): `    it('injects the directive when 3+ decisions have passed since the last correction', () => {` — replace the whole test (through its closing `    });`) with:

```ts
    it('LIFE-NODE-7 — injects the question-preview directive at a streak of 4', () => {
      const out = buildLifeStepPrompt({
        world: baseWorld,
        events: [
          fakeEvent('decision', { choiceId: 'a', text: 'X' }),
          fakeEvent('decision', { choiceId: 'b', text: 'Y' }),
          fakeEvent('decision', { choiceId: 'c', text: 'Z' }),
          fakeEvent('decision', { choiceId: 'd', text: 'W' }),
        ],
        choice: { id: 'next', practiceText: 'Continuer' },
        isOpeningBeat: false,
      });
      expect(out).toContain('<practiceCadence');
      expect(out).toContain('streak="4"');
      expect(out).toContain('question node');
    });
```

**Edit 3.** ANCHOR (verify unique): `    it('resets the streak after a correction event', () => {` — inside that test, the events array carries 3 decisions before the correction; it still passes unchanged (streak after correction = 1 < 4). No edit — just re-run it.

**Edit 4 — new suites.** ANCHOR (verify unique — the closing of the file's last describe):

```
      expect(out).not.toContain('<practiceCadence');
    });
  });
});
```

Replace with:

```ts
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

describe('lifeStepSystemInstruction — LIFE-NODE lookahead contract', () => {
  const si = () =>
    lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      difficulty: 3,
    });

  it('LIFE-NODE-2 — carries the LOOKAHEAD CONTRACT + next/noPreview law', () => {
    expect(si()).toContain('LOOKAHEAD CONTRACT');
    expect(si()).toContain('noPreview');
    expect(si()).toContain('"kind": "branch" | "continuation" | "question"');
  });

  it('LIFE-NODE-4 — the always-visible composer line is gone', () => {
    expect(si()).not.toContain('free-text composer below the chips');
  });

  it('LIFE-NODE-5 — the hook-accept option is pinned to noPreview', () => {
    expect(si()).toContain('noPreview: true');
    expect(si()).toContain('acceptChipId');
  });

  it('LIFE-NODE-7 — states the question + continuation cadences', () => {
    expect(si()).toContain('1 node in 5');
    expect(si()).toContain('1 node in 4');
  });
});
```

**Edit 5 — POST-PHASE-E (re-point E's `LIFE-BUBBLE-7` SI assertion).** Phase E (`phase-e.md` Test section G) appended a `LIFE-BUBBLE-7` SI test to THIS file asserting the pre-node chip-annotation instruction. F4-b's SI rewrite re-expresses that instruction against OPTION labels (`Annotate OPTION labels the same way when they contain a hard word.` — see F4-b), so E's asserted substring no longer exists in the SI and E's test goes RED after F4-b lands (which would block Step 4's + Step 7's `npm test` gate). Re-point the assertion at F4-b's wording. Keep E's test name intact — options ARE the node engine's chips, so "annotate chip text like beats" still holds. ANCHOR (verify unique — E's asserted substring appears exactly once in the file, in the test E appended):

```ts
    expect(si).toContain(
      'Choice chips MAY also carry complexWords[] + wordTranslations{}',
    );
```

Replace with:

```ts
    expect(si).toContain('Annotate OPTION labels the same way');
```

### T7 — `src/screens/LifeScreen/useNodeEngine.test.tsx` (Step 6 — new, complete contents)

```tsx
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('@/lib/life/generateStepOptions', () => ({
  // Full module mock — the real module pulls lib/gemini → firebase.
  generateStepOptions: vi.fn(),
  recentFillBlankTargets: vi.fn(() => []),
  buildGradedSceneContext: vi.fn(() => ({ recentBeats: [] })),
}));
vi.mock('@/lib/life/commitNode', () => ({
  commitNode: vi.fn(async () => undefined),
  applyTurnSignals: vi.fn(async () => undefined),
}));
vi.mock('@/lib/life/runGradedQuestionGenerate', () => ({
  runGradedQuestionGenerate: vi.fn(),
}));
vi.mock('@/lib/life/world', () => ({ appendLifeEvent: vi.fn(async () => 'e1') }));
vi.mock('@/lib/life/campaign', () => ({ updateActiveCampaign: vi.fn() }));
vi.mock('@/lib/life/runCampaignReplan', () => ({ runCampaignReplan: vi.fn() }));
vi.mock('@/lib/life/campaignLifecycle', () => ({
  acceptCampaignHook: vi.fn(),
  computeReplanPlan: vi.fn(),
  fireBackgroundCampaignPatch: vi.fn(),
  snapshotCampaignCompletion: vi.fn(),
}));
vi.mock('@/lib/errors', () => ({ toUserMessage: (e: unknown) => String(e) }));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import {
  generateStepOptions,
  type GenerateStepOptionsResult,
} from '@/lib/life/generateStepOptions';
import { commitNode } from '@/lib/life/commitNode';
import { runGradedQuestionGenerate } from '@/lib/life/runGradedQuestionGenerate';
import {
  CONTINUE_AFTER_FAILURE_ID,
  useNodeEngine,
  type UseNodeEngineProps,
} from './useNodeEngine';
import { WRITE_YOUR_OWN_ID, type StepOption } from '@/lib/life/stepSchema';
import type { LifeWorld } from '@/types/firestore';

const generateStepOptionsMock = vi.mocked(generateStepOptions);
const commitNodeMock = vi.mocked(commitNode);
const runGradedQuestionGenerateMock = vi.mocked(runGradedQuestionGenerate);

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
  characterAvatarUrl: 'data:x',
  characterAvatarStatus: 'ready',
};

const narratorBeat = {
  speaker: 'narrator' as const,
  practiceText: 'Tu entres au café.',
  nativeText: 'You enter the café.',
};

const previewBeat = {
  speaker: 'narrator' as const,
  practiceText: 'Sophie te fait signe.',
  nativeText: 'Sophie waves at you.',
};

const optionWithPreview: StepOption = {
  id: 'go',
  practiceText: 'Rejoindre Sophie',
  nativeText: 'Join Sophie',
  next: { kind: 'branch', beats: [previewBeat] },
};

const questionOption: StepOption = {
  id: 'ask',
  practiceText: 'Proposer un déjeuner',
  nativeText: 'Suggest lunch',
  next: {
    kind: 'question',
    gradedPlan: {
      kind: 'fill-blank',
      testTarget: 'voudrais',
      sentenceContext: 'Je voudrais déjeuner avec toi.',
    },
  },
};

const noPreviewOption: StepOption = {
  id: 'wait',
  practiceText: 'Attendre',
  nativeText: 'Wait',
  noPreview: true,
};

function okLive(
  options: StepOption[],
  nonce: number,
): Extract<GenerateStepOptionsResult, { kind: 'ok' }> {
  return {
    kind: 'ok',
    node: { kind: 'branch', beats: [narratorBeat] },
    options,
    nonce,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function makeProps(): UseNodeEngineProps & {
  appendBubbles: ReturnType<typeof vi.fn>;
  onSceneIntent: ReturnType<typeof vi.fn>;
  onCampaignResolved: ReturnType<typeof vi.fn>;
  onError: ReturnType<typeof vi.fn>;
} {
  return {
    uid: 'u1',
    world: baseWorld,
    events: [],
    campaign: null,
    npcs: [],
    appendBubbles: vi.fn(),
    onSceneIntent: vi.fn(),
    onCampaignResolved: vi.fn(),
    onError: vi.fn(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: echo the passed nonce (matches the real contract).
  generateStepOptionsMock.mockImplementation(async (input) => okLive([optionWithPreview, noPreviewOption], input.nonce));
});

describe('useNodeEngine', () => {
  it('LIFE-NODE-2 — startOpening lands node + options and reaches options-ready', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(result.current.nodeKind).toBe('branch');
    expect(result.current.options.map((o) => o.id)).toEqual(['go', 'wait']);
    expect(props.appendBubbles).toHaveBeenCalledWith(
      [expect.objectContaining({ practiceText: 'Tu entres au café.' })],
      { resetTurn: false },
    );
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: { kind: 'none' } }),
    );
  });

  it('LIFE-NODE-3 — cached pick renders the preview INSTANTLY, commits, then fetches options', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    const d = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(d.promise);
    await act(async () => {
      result.current.actions.pick('go');
    });
    // BEFORE the options response resolves: preview rendered, commit
    // fired, skeleton phase.
    expect(props.appendBubbles).toHaveBeenCalledWith(
      [expect.objectContaining({ practiceText: 'Sophie te fait signe.' })],
      { resetTurn: true },
    );
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { kind: 'choice', choiceId: 'go', text: 'Rejoindre Sophie' },
      }),
    );
    expect(result.current.phase).toBe('options-loading');
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual({ kind: 'options', currentNodeKind: 'branch' });
    // Overlay: the prompt-facing events include the just-committed
    // decision + beat before the listener delivers them.
    expect(call.events.some((e) => e.kind === 'decision')).toBe(true);
    expect(
      call.events.some(
        (e) => (e.payload as { practiceText?: string }).practiceText === 'Sophie te fait signe.',
      ),
    ).toBe(true);
    await act(async () => {
      d.resolve({ kind: 'ok', node: null, options: [noPreviewOption, optionWithPreview], nonce: 0 });
      await d.promise;
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
  });

  it('LIFE-NODE-5 — a noPreview pick routes to live generation', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    await act(async () => {
      result.current.actions.pick('wait');
    });
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual(
      expect.objectContaining({
        kind: 'live',
        choice: { id: 'wait', practiceText: 'Attendre' },
      }),
    );
  });

  it('LIFE-NODE-1 — question preview: authoring → ready → feedback prefetch → continue applies the prefetched live node', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([questionOption, noPreviewOption], input.nonce),
    );
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));

    const gen = deferred<Awaited<ReturnType<typeof runGradedQuestionGenerate>>>();
    runGradedQuestionGenerateMock.mockReturnValueOnce(gen.promise);
    act(() => {
      result.current.actions.pick('ask');
    });
    expect(result.current.phase).toBe('question-authoring');
    // Question nodes commit the decision with NO beats.
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ choiceId: 'ask' }),
        beats: [],
      }),
    );
    await act(async () => {
      gen.resolve({
        kind: 'ok',
        practicePrompt: {
          kind: 'fill-blank',
          practiceText: 'Je ___ déjeuner avec toi.',
          nativeText: 'I ___ to have lunch with you.',
        },
        choices: [
          // LIFE-LANG-1: fill-blank chips carry nativeText: '' (D contract).
          { id: 'voudrais', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
          { id: 'veux', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
          { id: 'ai', practiceText: 'ai', nativeText: '', correctness: 'wrong' },
        ],
      });
      await gen.promise;
    });
    await waitFor(() => expect(result.current.phase).toBe('question-ready'));

    // Chip pick → feedback + the PREFETCH fires immediately.
    const prefetch = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(prefetch.promise);
    act(() => {
      result.current.actions.pick('voudrais');
    });
    expect(result.current.phase).toBe('feedback');
    expect(result.current.feedback?.correct).toBe(true);
    const prefetchCall = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(prefetchCall.turn).toEqual(
      expect.objectContaining({
        kind: 'live',
        practiceOutcome: expect.objectContaining({
          kind: 'fill-blank',
          correct: true,
          correctAnswer: 'voudrais',
        }),
      }),
    );

    // Continue: resolved bubble (template + correct chip) + correction
    // commit, then the prefetched result applies WITHOUT a new call.
    const callsBefore = generateStepOptionsMock.mock.calls.length;
    act(() => {
      result.current.actions.feedbackContinue();
    });
    expect(props.appendBubbles).toHaveBeenCalledWith(
      [
        expect.objectContaining({
          speaker: 'user',
          practiceText: 'Je voudrais déjeuner avec toi.',
        }),
      ],
      { resetTurn: true },
    );
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: expect.objectContaining({ kind: 'practice-outcome' }),
      }),
    );
    await act(async () => {
      prefetch.resolve(okLive([optionWithPreview, noPreviewOption], 0));
      await prefetch.promise;
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    expect(generateStepOptionsMock.mock.calls.length).toBe(callsBefore);
  });

  it('LIFE-NODE-4 — ✏️ opens the composer; submit bumps the nonce and fires a free-text live turn', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    const callsBefore = generateStepOptionsMock.mock.calls.length;
    act(() => {
      result.current.actions.pick(WRITE_YOUR_OWN_ID);
    });
    expect(result.current.composerOpen).toBe(true);
    expect(generateStepOptionsMock.mock.calls.length).toBe(callsBefore);
    await act(async () => {
      result.current.actions.submitFreeText('On va au parc ?');
    });
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual(
      expect.objectContaining({ kind: 'live', freeText: 'On va au parc ?' }),
    );
    expect(call.nonce).toBe(1); // LIFE-NODE-6 bump
    expect(commitNodeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: { kind: 'free-text', text: 'On va au parc ?' },
      }),
    );
  });

  it('LIFE-NODE-6 — a result generated under an old nonce is dropped, never rendered', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    const stale = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(stale.promise);
    act(() => {
      result.current.actions.startOpening(); // in flight under nonce 0
    });
    const fresh = deferred<GenerateStepOptionsResult>();
    generateStepOptionsMock.mockReturnValueOnce(fresh.promise);
    act(() => {
      result.current.actions.submitFreeText('salut'); // bumps nonce → 1
    });
    await act(async () => {
      // Stale result carries nonce 0 ≠ current 1 → dropped.
      stale.resolve({
        kind: 'ok',
        node: { kind: 'branch', beats: [{ ...narratorBeat, practiceText: 'STALE' }] },
        options: [optionWithPreview, noPreviewOption],
        nonce: 0,
      });
      await stale.promise;
    });
    expect(
      (props.appendBubbles as ReturnType<typeof vi.fn>).mock.calls.some(
        (c) => (c[0] as Array<{ practiceText: string }>).some((b) => b.practiceText === 'STALE'),
      ),
    ).toBe(false);
    await act(async () => {
      fresh.resolve(okLive([optionWithPreview, noPreviewOption], 1));
      await fresh.promise;
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
  });

  it('LIFE-NODE-8 — options failure lands on options-failed; Continue fires a live turn', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    generateStepOptionsMock.mockImplementationOnce(async (input) => ({
      kind: 'schema-failed',
      rawAttempts: ['x', 'y'],
      nonce: input.nonce,
    }));
    await act(async () => {
      result.current.actions.pick('go');
    });
    await waitFor(() => expect(result.current.phase).toBe('options-failed'));
    await act(async () => {
      result.current.actions.pick(CONTINUE_AFTER_FAILURE_ID);
    });
    const call = generateStepOptionsMock.mock.calls.at(-1)![0];
    expect(call.turn).toEqual(
      expect.objectContaining({ kind: 'live', choice: null, freeText: null, practiceOutcome: null }),
    );
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
  });

  it('LIFE-NODE-8 — question authoring failure demotes to the options-failed ladder', async () => {
    const props = makeProps();
    const { result } = renderHook(() => useNodeEngine(props));
    generateStepOptionsMock.mockImplementationOnce(async (input) =>
      okLive([questionOption, noPreviewOption], input.nonce),
    );
    await act(async () => {
      result.current.actions.startOpening();
    });
    await waitFor(() => expect(result.current.phase).toBe('options-ready'));
    runGradedQuestionGenerateMock.mockResolvedValueOnce({
      kind: 'failed',
      reason: 'exhausted-retries',
    });
    await act(async () => {
      result.current.actions.pick('ask');
    });
    await waitFor(() => expect(result.current.phase).toBe('options-failed'));
    expect(result.current.question).toBeNull();
  });
});
```

Note on T7 mocking: `@/lib/life/generateStepOptions` is FULLY mocked (the real module imports `lib/gemini` → `lib/firebase`, which must never load in jsdom). `PracticeOutcome` / `GenerateStepOptionsResult` are type-only imports — TypeScript reads them from the source module even when the runtime module is mocked. `mergeLocalEvents`, `resolvedBubble`, and `stepSchema` are pure and stay unmocked, so the engine's real overlay/bubble logic is what the test exercises.

### T8 — `src/screens/LifeScreen/LifeScreenBottom.test.tsx` (Step 6 — full rewrite, complete contents)

Phase D's T7 created this file against the D-era props (`busy`/`graded`/`practicePrompt`/`choices`/`viewMode`) and the now-deleted `chipDisplayFor` export. Overwrite the whole file with the following — it re-asserts D's LIFE-LANG pins against the phase-based props and adds the LIFE-NODE render branches. No module mocks needed: `LifeScreenBottom` imports only presentational components + `nodeEngineTypes` (zero runtime deps).

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LifeScreenBottom } from './LifeScreenBottom';
import { CONTINUE_AFTER_FAILURE_ID } from './nodeEngineTypes';
import type { FlashcardMatch } from './ActionBar';
import type { PracticePrompt, StepChoice, StepOption } from '@/lib/life/stepSchema';

const comprehensionPrompt: PracticePrompt = {
  kind: 'comprehension',
  npcUtterance: 'Est-ce que tu connais un bon café ?',
  question: 'What is Sophie asking?',
  speakerName: 'Sophie',
  npcId: 'sophie',
};

const fillBlankPrompt: PracticePrompt = {
  kind: 'fill-blank',
  practiceText: 'Je ___ un café',
  nativeText: 'I ___ a coffee',
};

const comprehensionChoices: StepChoice[] = [
  { id: 'a', practiceText: 'Elle cherche un café', nativeText: "She's asking about a café", correctness: 'correct' },
  { id: 'b', practiceText: 'Elle cherche le bureau', nativeText: "She's asking about the office", correctness: 'wrong' },
  { id: 'c', practiceText: 'Elle propose une pause', nativeText: "She's offering a break", correctness: 'wrong' },
];

const fillBlankChoices: StepChoice[] = [
  { id: 'a', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
  { id: 'b', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
  { id: 'c', practiceText: 'voulais', nativeText: '', correctness: 'wrong' },
];

const branchOptions: StepOption[] = [
  { id: 'go', practiceText: 'Rejoindre Sophie', nativeText: 'Join Sophie', noPreview: true },
  { id: 'wait', practiceText: 'Attendre', nativeText: 'Wait', noPreview: true },
];

function renderBottom(overrides: Partial<Parameters<typeof LifeScreenBottom>[0]>) {
  const props = {
    phase: 'options-ready' as const,
    feedback: null,
    question: null,
    options: [] as StepOption[],
    nodeKind: 'branch' as const,
    composerOpen: false,
    optionChipDisplay: 'both' as const,
    flashcardLookup: new Map<string, FlashcardMatch>(),
    onPick: vi.fn(),
    onComposerCancel: vi.fn(),
    onFreeText: vi.fn(),
    onFeedbackContinue: vi.fn(),
    onExplain: vi.fn(),
    ...overrides,
  };
  render(<LifeScreenBottom {...props} />);
  return props;
}

describe('LifeScreenBottom — phase branches + language pins', () => {
  it('LIFE-LANG-2 — question-ready comprehension renders the utterance card + native-only chips', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: comprehensionPrompt, choices: comprehensionChoices },
    });
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toHaveTextContent(
      'Est-ce que tu connais un bon café ?',
    );
    const chip = screen.getByTestId('LifeScreen-Choice-a');
    expect(chip).toHaveTextContent("She's asking about a café");
    expect(chip).not.toHaveTextContent('Elle cherche un café');
  });

  it('LIFE-LANG-2 — question-ready fill-blank renders the template card + gloss-free practice chips', () => {
    renderBottom({
      phase: 'question-ready',
      nodeKind: 'question',
      question: { practicePrompt: fillBlankPrompt, choices: fillBlankChoices },
    });
    expect(screen.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Choice-a').textContent).toBe('voudrais');
  });

  it('LIFE-NODE-4 — branch nodes get the client ✏️ chip; continuation nodes do not', () => {
    renderBottom({ options: branchOptions, nodeKind: 'branch' });
    expect(screen.getByTestId('LifeScreen-Choice-__write__')).toBeInTheDocument();
  });

  it('LIFE-NODE-4 — no ✏️ chip on a continuation node', () => {
    renderBottom({
      options: [{ id: 'continue', practiceText: 'Continuer', nativeText: 'Continue', noPreview: true }],
      nodeKind: 'continuation',
    });
    expect(screen.queryByTestId('LifeScreen-Choice-__write__')).toBeNull();
  });

  it('LIFE-NODE-4 — composerOpen swaps the chip grid for the composer; cancel fires onComposerCancel', () => {
    const props = renderBottom({ options: branchOptions, composerOpen: true });
    expect(screen.getByTestId('LifeScreen-FreeText')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-Choice-go')).toBeNull();
    fireEvent.click(screen.getByTestId('LifeScreen-FreeText-Cancel'));
    expect(props.onComposerCancel).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-2 — options-loading renders the skeleton chips', () => {
    renderBottom({ phase: 'options-loading' });
    expect(screen.getByTestId('LifeScreen-SkeletonChips')).toBeInTheDocument();
  });

  it('LIFE-NODE-8 — options-failed renders the note + the single Continue chip wired to onPick', () => {
    const props = renderBottom({ phase: 'options-failed' });
    expect(screen.getByTestId('LifeScreen-OptionsFailed')).toHaveTextContent(
      'The story snagged for a moment.',
    );
    fireEvent.click(screen.getByTestId(`LifeScreen-Choice-${CONTINUE_AFTER_FAILURE_ID}`));
    expect(props.onPick).toHaveBeenCalledWith(CONTINUE_AFTER_FAILURE_ID);
  });

  it('LIFE-LANG-5 — the feedback Why? button fires onExplain', () => {
    const props = renderBottom({
      phase: 'feedback',
      feedback: {
        correct: false,
        picked: { id: 'b', practiceText: 'veux', nativeText: '' },
        correctAnswer: { id: 'a', practiceText: 'voudrais', nativeText: '' },
        outcomeKind: 'fill-blank',
        promptSource: 'Je ___ un café',
      },
    });
    fireEvent.click(screen.getByTestId('LifeScreen-PracticeFeedback-Why'));
    expect(props.onExplain).toHaveBeenCalledTimes(1);
  });
});
```

---

## Verify

Run after each Ordered step as indicated; ALL of the following must pass before the phase commit:

```bash
# Unit — scoped while iterating, full before commit:
npx vitest run src/lib/life/stepSchema.test.ts src/lib/life/validateStep.test.ts \
  src/lib/life/commitNode.test.ts src/lib/life/mergeLocalEvents.test.ts \
  src/lib/life/generateStepOptions.test.ts src/lib/life/prompts/step.test.ts \
  src/screens/LifeScreen/useNodeEngine.test.tsx \
  src/screens/LifeScreen/LifeScreenBottom.test.tsx
npm test

# Types + lint (both must be clean; no new @ts-expect-error, no any):
npm run typecheck
npx eslint src/

# Nothing references the deleted module:
git grep -n runLifeStep -- src tests   # → no hits

# E2E (@standard tier — the rewritten spec, mocked Gemini):
cd tests/e2e && npx playwright test specs/life-flow.spec.ts
```

Then, per the Reliability principles: open every screenshot the E2E run captured (`captureBeat` outputs under `screenshots/<run-id>/`) with the Read tool and check: opening node bubbles, the 4-chip branch grid (3 options + ✏️), vocab popover open/saved, skeleton chips, composer open/cancel, fill-blank shimmer → prompt card → feedback, comprehension chips (native-only) + the ExplainModal, the three viewMode states, options-failed note + Continue chip, recap screen, resume prompt. Dark-mode or alignment regressions = not done.

**Manual smoke (real Gemini, dev server — do NOT deploy):** play 10+ turns in an existing wurld. Verify: picks advance instantly on previewed options; the options call is invisible (absorbed by read time); ~1-in-5 question cadence; ✏️ chip present on branch nodes only and the composer round-trips; question chips author with a visible shimmer; feedback Continue is instant (prefetch); no re-quote of practised lines. Open the debug overlay's **Telemetry tab**: `life_step` output tokens should be ~2× the pre-F baseline with NO increase in call count and no drop in cached input tokens (LIFE-CTX-1 prefix cache intact). Expect ≤ ~+30% total tokens/turn.

**Prompt-suite note:** this phase rewrites the client-side life SI (`src/lib/life/prompts/step.ts`), not `functions/src/` prompts, so the functions `@prompts` gate does not apply. The real-Gemini schema check is `tests/e2e/specs/life-flow-real.spec.ts` — run it once manually after the manual smoke if you want an automated real-model schema probe (~$0.05–0.15); ask the user before any broader real-Gemini spend.

## Out of scope — do NOT touch

- `src/lib/life/runGradedQuestionGenerate.ts` + `prompts/gradedQuestion.ts` — Phase D owns their language-placement rules; F only CALLS them from the engine.
- `runCampaignGenerate` / `runCampaignReplan` / `campaign.ts` / `campaignLifecycle.ts` / `useChapterCompletion.ts` — hook/replan/resolve logic is reused as-is; only its CALL SITE moves into `useNodeEngine`.
- `runCompaction.ts`, `tokenEstimate.ts`, `world.ts`, `npcs.ts`, `resolvedBubble.ts`, `resumeBubbles.ts`, `DialogueArea.tsx`, `PracticePromptCard.tsx`, `PracticeFeedback.tsx`, `SceneStage.tsx`, `LifeScreenHeader.tsx`, scene gen/cache, `debugLog.ts`, `telemetry.ts`, `modelConfig.ts` — unchanged (F7-d's one-line comment fixes excepted where listed).
- The flashcard-deck prompt block, `gradedPlan.flashcardId` → `recordAttempt` SRS credit, and narrative re-exposure — **Phase G** (it builds on this phase's prompt shape; do not pre-implement).
- `WorldArcCompleteScreen` / `CampaignCompleteScreen` vocab recap — **Phase H**.
- `tests/e2e/specs/life-flow-real.spec.ts` — no code change needed (its assertions are shape-agnostic testid probes). Its stale `/life` URL wait is a pre-existing issue; note it in your report, don't fix it here.
- The 80-locale i18n regen (`npm run i18n:regen`) — user-triggered later; only `en.ts` changes in this phase.
- Firestore rules/indexes, Cloud Functions, deploys of any kind (user tests via dev server — no `firebase deploy`).
- Phase D/E code inside `LifeScreen.tsx` / `ActionBar.tsx` beyond the exact edits listed (viewMode toggle, ExplainModal, word-save hook, vocab popovers stay as D/E left them).

## Report back

When done, report: per-step test results (including the failing-first runs), the final `npm test` / `typecheck` / `eslint` output, the E2E result + screenshot review notes, any anchor that had drifted and how you re-anchored (source wins — and fix this doc in the same commit), and anything you could NOT verify.

