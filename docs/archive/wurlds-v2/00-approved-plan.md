# Wurlds v2 — RPG gameplay × the app's learning engine

## Context

The life-sim ("Wurlds") shipped behind the `lifeSimBeta` flag. Playtesting shows it works end-to-end but hasn't yet absorbed the app's best learning UX: practice mode's one-language-at-a-time questions, message bubbles' tappable vocab + save-as-flashcard, and the SRS loop that focuses practice on weak cards. Meanwhile the turn loop has visible latency (~2-4s per pick) and the overview page doesn't help you recognise or re-enter a wurld.

This plan turns the feature into what it was designed to be (life-sim.md §Product requirements): *an RPG-feel practice surface that weaves the user's saved flashcards into an open, branching story — extending the learning engine, not replacing it.* Cost stance: one narrative Gemini call per turn (lookahead bundled in, NOT extra calls), flash-lite tier everywhere except saga, all reads of existing SVGs/data are free.

**Owner directives captured verbatim-in-spirit:**
- Rebrand all "world/life" copy → **"wurlds"** (tab label becomes "Wurlds"; title "Your Other Wurlds").
- Wurld card shows the world's most-recent **scene SVG thumbnail** (no new gen).
- Re-launch shows **card description + story-so-far + most-recent events** recap.
- **Two-branch language display**: graded questions = ONE language at a time (lift practice-mode's PRACTICE-Q-PROMPT-1 contract); normal gameplay = both languages behind a **3-way toggle** (both / native / practice).
- **Tappable vocab** words on all non-chip text, save-as-flashcard — lift from message bubbles.
- **Single-call lookahead**: each step's generation also produces the NEXT node for each of 3 options; 4th option is always "write your own ✏️" (replaces always-visible composer). Node kinds: branch / question / continuation. Questions ~1 in 5 turns. Question chips author only when the node is shown.

## Phase ordering (dependency-driven)

| Phase | What | Depends on |
|---|---|---|
| A | Wurlds rebrand (i18n values only) | — |
| B | Scene thumbnail on WurldCard | — |
| C | Resume recap screen | — |
| D | Language system: 3-way toggle + practice-style graded turns | — |
| E | Tappable vocab + save-as-flashcard | — |
| F | Node/lookahead step engine + ✏️ chip | D (graded contract) |
| G | Flashcard weaving + SRS credit | F (planner prompt block) |
| H | Cheap wins: Why? explain wiring; chapter vocab recap | D |

A/B/C/E are independent and can be built in any order. D before F (F's lookahead nodes carry gradedPlans that must follow D's language contract). G last (needs F's prompt shape).

---

## Phase A — Wurlds rebrand

Pure i18n-value changes in `src/i18n/locales/en.ts` (keys unchanged → zero code churn):
- `tabBar.life`: "Life" → "Wurlds"
- `life.overview.title`: "Your other lives" → "Your Other Wurlds"
- Every `life.*` value containing "world(s)" → "wurld(s)". Known list (explorer-verified): `life.buildingWorld` ("Building your wurld…"), `life.menu.label`, `life.menu.deleteRestart`, `life.menu.deleteConfirm.title/.confirm`, `life.overview.create/createFirst/maxReached/cardMenu/cardDelete`, `life.overview.deleteConfirm.title/body`, `life.overview.empty.title/samplesHint`, `life.overview.explainer.title/chapters/parallel`, `life.overview.setting.surprise/manual`, `life.onboard.subtitle/seed.label/seed.realism/seed.chip.frontier_colony.hint/creating`.
- "life/lives"-flavoured values: `life.title` → "Wurlds", `life.overview.empty.eyebrow` + `life.onboard.title` ("A second life" → "A second wurld"), `life.arcComplete.continue` ("Continue your life" → "Continue your wurld").
- `settings.beta.lifeSimBeta.label` → "Wurlds (beta)".
- Do NOT rename i18n keys, routes (/life), invariant ids, or code identifiers.
- 80-locale regen deferred: run `npm run i18n:regen` separately when the user chooses (costs cents but touches 80 files).

## Phase B — Scene thumbnail on WurldCard

Free (no LLM): reuse the world's already-persisted scene SVG.

- New hook `src/screens/LifeScreen/useWorldThumbnail.ts`:
  `useWorldThumbnail(world: LifeWorld): { svg: string | null }`
  1. `descriptorFromWorld(world)` (exists, `src/screens/LifeScreen/sceneDescriptorForLife.ts:35`) → null for fresh worlds.
  2. Sync hit: `readSceneCache(descriptor, world.id)` (`src/lib/life/sceneCache.ts:77`).
  3. Async fallback: `readPersistentScene(uid, world.id, descriptor)` (`src/lib/life/scenes.ts:47` — reads `svgInline` from `users/{uid}/lifeWorlds/{worldId}/scenes/{docId}`).
  4. Miss → `getFallbackScene(pickFallback(descriptor))` silhouette (`src/lib/life/fallbackScenes.ts`), or null for no-descriptor worlds.
- `WorldCard.tsx`: render a `h-24 overflow-hidden rounded-t-2xl` banner div at the top of the tap-target button, `dangerouslySetInnerHTML={{__html: svg}}` with `[&>svg]:w-full [&>svg]:h-full [&>svg]:object-cover` (same pattern as `SceneStage.tsx:40-41`; all life SVGs already pass `sanitiseSvg`). Slight dark gradient overlay at the bottom of the banner so the title row below reads cleanly. No banner when svg is null (fresh world) — keeps the card compact.
- Spec: add **LIFE-WORLD-9** (card thumbnail = most-recent persisted scene, never triggers gen).

## Phase C — Resume recap ("Previously, in <wurld>…")

Assembled from STORED data — zero LLM on the resume path; one optional fire-and-forget polish call at session end.

- New `src/screens/LifeScreen/WurldResumeScreen.tsx` (mirrors `WorldIntroScreen.tsx` overlay pattern):
  - Header: saga title + tone (same as intro).
  - "The story" — `saga.playerFacingTeaser` (the card description, per owner ask).
  - "This chapter" — `currentArc.premise` + chapter number.
  - "Previously" — `world.resumeRecap.text` when present, else `world.rollingSummary` when non-empty.
  - "Moments ago" — last 2-3 `beat` events rendered verbatim as mini-bubbles (reuse `resumeBubblesFromEvents`, `src/lib/life/resumeBubbles.ts:20`).
  - CTA "Continue".
- New world-doc field (`ZLifeWorld`): `resumeRecap: z.object({ text: z.string(), lastEventId: z.string(), generatedAt: ZTimestamp.optional() }).nullable().optional()`.
- New `src/lib/life/runResumeRecapGenerate.ts`: flash-lite call, input = rollingSummary + currentArc.premise + last ~10 beat/decision events, output = 2-3 spoiler-free sentences in BOTH languages ("Previously on…" register). Fired **fire-and-forget on world exit** (LifeScreen unmount / back-nav) only when ≥5 new events since `resumeRecap.lastEventId`. Failure tolerated — screen falls back to rollingSummary/premise.
- LifeScreen wiring: in the opening useEffect resume branch (`LifeScreen.tsx` ~443), gate the resume-bubble seeding behind `recapDismissed` state (exact same pattern as `introDismissed` for WorldIntroScreen). Fresh worlds (0 events) keep the intro screen; resumed worlds get the recap screen.
- i18n: `life.resume.eyebrow` ("Previously, in this wurld"), `life.resume.chapter`, `life.resume.momentsAgo`, `life.resume.continue`.
- Spec: **LIFE-FLOW-4** (recap screen contract + recap-generation trigger).

## Phase D — Language display system

### D1 — Per-wurld 3-way view mode (normal gameplay)

- **Setting lives per-world on the world doc**: add `viewMode?: ZViewMode` (`'visible'|'hidden'|'native-only'`, reuse the type — `src/store/uiStore.ts:72` / `ZViewMode` in `types/firestore.ts:88`) to `ZLifeWorld`. Rationale: scaffold needs differ per world (difficulty is frozen per world, LIFE-DATA-5); syncs across devices via the existing `useLifeWorld` listener; `updateLifeWorld` already writes arbitrary patches. Default `'visible'` (both).
- **Toggle UI**: cycle button in `LifeScreenHeader.tsx` left of the 3-dot menu (Eye → EyeOff → Languages icons), cycles visible → native-only → hidden, writes via `updateLifeWorld`.
- **Semantics**: `visible`=both languages, `native-only`=nativeText only, `hidden`=practiceText only.
- **Obeying surfaces**: DialogueArea narrator/NPC/user bubbles; ActionBar CYOA chips — replace the boolean `hideChipNative` with `chipDisplay: 'both'|'practice'|'native'` (in `native-only` the chip's MAIN label is nativeText). Resume bubbles inherit automatically.
- **Excluded**: location ribbon, TTS buttons (always speak practice), graded turns (D2 supersedes).
- **Precedence**: the comprehension-source gloss gate (`hideNativeForUtterance`) OUTRANKS viewMode — in `native-only` mode the source bubble falls back to practiceText + tap-to-reveal (showing only the gloss would BE the answer).

### D2 — Graded turns: one language at a time (lift PRACTICE-Q-PROMPT-1)

- **Comprehension layout**: native instruction ("What is Mathieu saying?") + practice-language utterance card (unchanged) + **native-only chips** (`chipDisplay='native'`). Generator SI: every chip's `nativeText` REQUIRED (third-person native interpretation); `practiceText` retained for outcome records but never rendered.
- **Fill-blank layout**: practice template with `___` (card already native-free) + **practice-token chips** with mandatory `nativeText: ""` (`chipDisplay='practice'`).
- **`src/lib/life/prompts/gradedQuestion.ts`**: DELETE the "LANGUAGE PLACEMENT (pedagogical judgment)" block (lines ~65-70) + liberal USER VIEW sentences; replace with the strict practice-mode rule: instruction ALWAYS native, content ALWAYS practice, chips exactly ONE language per kind, never leak. Update OUTPUT SHAPE examples (`"nativeText": ""` for fill-blank).
- **`src/lib/life/runGradedQuestionGenerate.ts` `leakViolations`**: add hard checks — fill-blank chip with non-empty nativeText → violation; comprehension chip with empty nativeText → violation (existing retry-with-hint loop enforces).
- **Feedback**: KEEP the `PracticeFeedback` overlay (no OptionList inline flash — chips already clear on pick, overlay carries Continue + Why).
- **"Why?" wiring** (fold of Phase H1): new `src/screens/LifeScreen/buildLifeExplainQuestion.ts` — `buildLifeExplainQuestion(prompt, choices, displayLang) → ExplainPracticeQuestion` (mirrors `src/screens/Practice/buildExplainQuestion.ts:14`, `questionType:'multiple-choice'`). LifeScreen renders the lazy `ExplainModal` (`src/components/ExplainModal/ExplainModal.tsx:153`) with `practiceQuestion`, `userAnswer`, `wasCorrect`, world languages; `LifeScreenBottom` forwards `onExplain` to the existing `PracticeFeedback.tsx:90-97` stub.
- i18n: `life.viewMode.label/.both/.nativeOnly/.practiceOnly`.
- Spec: **LIFE-LANG-1..5** (one-language graded contract; per-kind layout table; per-world viewMode + surface list; comprehension-gate precedence; Why?-explain wiring). 
- Tests: gradedQuestion SI assertions; new leakViolations cases; buildLifeExplainQuestion unit; ActionBar/DialogueArea render tests per mode; E2E — comprehension chips native-only, fill-blank chips gloss-free, viewMode cycle hides/shows glosses.

## Phase E — Tappable vocab + save-as-flashcard

- **Surfaces**: NPC + narrator + USER bubble practiceText. Chips (option cards) render PLAIN — no vocab underlines/taps there, because tapping a chip already means "pick this option" (two competing tap actions). Once a chip's line lands as a user bubble, its words render annotated + tappable like any other bubble. Excluded: `PracticePromptCard` (tap-to-translate would leak the graded answer — record as invariant), feedback overlay.
- **Chip → user-bubble annotations**: extend `ZStepChoice` (and F's `ZStepOption`) with optional `complexWords?/wordTranslations?`; SI asks the model to annotate chip text the same way it annotates beats. On pick, `buildResolvedBubble` / the decision-to-bubble path carries the annotations into the user bubble. Free-text user bubbles have no annotations (the player wrote it) — they render plain, which is fine.
- **Data plumbing** (beats already carry the fields — they're just dropped): add `complexWords?/wordTranslations?` to the `Bubble` type (`DialogueArea.tsx:25`); stop dropping them in LifeScreen's beat→Bubble map (~line 368); persist them through `appendBeatEvent` (`src/lib/life/world.ts:220`) + `ZLifeBeatPayload` + rehydrate in `resumeBubblesFromEvents` so resumed bubbles stay tappable.
- **Render**: NpcBubbleView/SystemCueView render practiceText via `AnnotatedText` (`src/components/Message/AnnotatedText.tsx` — presentational, reusable) with `onWordTap`; active word via the existing `vocabStore` (`useActiveWordFor(bubble.id)` — string keys, bubble ids work); `WordPopover` (`src/components/Message/WordPopover.tsx` — presentational) below the text with `translation = bubble.wordTranslations?.[word]`.
- **Save path**: new `src/screens/LifeScreen/useLifeWordSave.ts` — `{ isSaved(word), isSaving(word), toggleSave(bubble, word) }`. Do NOT use chat's `useMessageActions.saveFlashcardWord` (chat-coupled). Calls `addFlashCard(uid, { phrase, translation, practiceLanguage, nativeLanguage, context })` (`src/lib/flashcards.ts:389`) with story context stamped: `` `"${bubble.practiceText}" — ${speakerName ?? 'Narrator'}, ${locationLabel}` `` (evocative card reviews). Saved-detection reuses the already-loaded `flashcardLookup` in LifeScreen; extend `FlashcardMatch` with `id` so unsave can `deleteFlashcard`.
- Spec: rewrite **LIFE-BUBBLE-7** (currently "Phase D wires the save-word UI") to the implemented contract + PracticePromptCard exclusion.
- Tests: resumeBubbles round-trip; DialogueArea annotated render; E2E — tap word → popover → save → card exists.

## Phase F — Node/lookahead step engine (single-call, zero extra API calls)

The core loop change: a node's beats render INSTANTLY (pre-generated by the previous call); ONE background call generates 3 options + a one-node-deep preview per option; question chips author only on arrival (existing two-stage flow). ✏️ "write your own" is a client-injected 4th chip replacing the always-visible composer.

### F1 — Schema (`src/lib/life/stepSchema.ts`)

Replace `ZRawStepResponse` with:
```ts
ZNodePreview = z.discriminatedUnion('kind', [
  { kind: 'branch',       beats: ZStepBeat[]≤2,          sceneIntent? },
  { kind: 'continuation', beats: ZStepBeat[] 1-2,        sceneIntent? },
  { kind: 'question',     gradedPlan: ZGradedPlan,       sceneIntent? },  // NO beats/chips
]);
ZStepOption = ZStepChoice.omit({correctness}).extend({ next: ZNodePreview.optional(), noPreview: z.boolean().optional() });
ZRawNodeResponse = { node: ZNodePreview.optional() /* live mode only */, options: ZStepOption[]≤3, worldDelta?, campaign? }
```
superRefine: option has `next` XOR `noPreview`; hook-accept chip (matching `campaign.hook.acceptChipId`) must be `noPreview`; branch → 2-3 options; continuation → exactly one option `id:'continue'`; live question node → `options: []` (generator authors chips). Drop the unused inline-practicePrompt path. `WRITE_YOUR_OWN_ID = '__write__'` constant — client-injected on branch nodes only, opens an inline composer via existing `onFreeText` plumbing; delete the always-visible composer.

### F2 — generate/commit split (the enabling refactor; `runLifeStep.ts` is deleted)

- **`src/lib/life/generateStepOptions.ts`** (pure): `generateStepOptions({uid, world, events, campaign, npcs, turn: {kind:'options'} | {kind:'live', choice?/freeText?/practiceOutcome?/isOpening?}}) → {kind:'ok', node, options, worldDelta?, campaign?, nonce} | schema-failed | error`. Keeps compaction probe (its rollingSummary write is the one tolerated side effect), 2-attempt retry, cross-turn validator. Adds `sanitizeOptions()` — drop individually-invalid `next`s, retry only if none survive.
- **`src/lib/life/commitNode.ts`** (all writes, fired on pick): decision/correction event → `appendBeatEvent` per node beat → `promoteOrTouchNpc` + avatar kickoffs → `updateLifeWorld` from node.sceneIntent (currentScene patch). Player-avatar kickoff moves here. Turn-level signals (worldDelta, campaign hook/replan/resolved) commit when the options response lands (existing `maybeKickReplan` reused).

### F3 — LifeScreen state machine

```
TurnPhase = live-loading | options-loading (beats visible, 3 skeleton chips)
          | options-ready (cache = options[i].next) | question-authoring (~1.5s shimmer header)
          | question-ready | feedback (holds prefetch promise) | options-failed (client Continue chip → live gen)
```
- **Pick (branch/continuation)**: append `option.next.beats` instantly → fire `commitNode` (don't block render; append events in-memory so the next prompt sees them) → question next? fire `runGradedQuestionGenerate` : fire `generateStepOptions({turn:{kind:'options'}})`.
- **✏️ path**: composer submit → `nonce++` (invalidates all cached nexts) → live gen (existing flow).
- **Practice-outcome path**: prefetch `generateStepOptions({kind:'live', practiceOutcome})` when feedback SHOWS; `onFeedbackContinue` awaits the prefetch → commit + render. Post-feedback turn is a live node whose options arrive with it.
- **Hooks/resolution**: `noPreview` chips → existing live paths unchanged (`acceptHook`, `campaign.resolved` handling).
- **Staleness**: nonce bumps on free-text + hardPivot replan only (ordinary replans tolerate one turn of old outline). Stale results dropped; stale cached pick → live gen. Cache is memory-only; kill mid-node is safe (events log is source of truth; existing resume path unchanged).

### F4 — Prompt/SI (`prompts/step.ts`)

- Replace OUTPUT SCHEMA with node/options shape + a LOOKAHEAD CONTRACT section (branch ≤2 beats / continuation 1-2 beats / question = gradedPlan only). New `<turn kind="options">`. Delete the always-visible-composer line.
- Cadence: "~1 in 5 nodes a question" (threshold 3→4 on the counter directive), "~1 in 4 may be a continuation; prefer real branches over preset story".
- Cost: +450-650 output tokens/turn (~2x output, NO new calls; question previews are cheap). Prefix cache unaffected (LIFE-CTX-1 order unchanged). Verify via the Telemetry tab post-implementation.

### F5 — Failure ladder

Options call: retry once → `options-failed` phase → client-synthesized Continue chip → live gen on tap. Graded generator failure keeps `synthesizeDemotedCyoa`.

- Spec: **LIFE-NODE-1..8** (taxonomy; single-call lookahead; commit-on-pick / previews never persisted; ✏️ client-injected; noPreview; nonce invalidation; cadence; fallback ladder).
- Tests: schema superRefine matrix; generateStepOptions purity + retry + sanitize (mock generateGemini); commitNode write ordering (mock world/npcs); LifeScreen machine (instant cached render, skeletons, ✏️ composer, question-arrival authoring, feedback prefetch, stale-nonce drop). Rewrites: stepSchema.test, prompts/step.test, validateStep.test.
- Ordered sub-steps for the implementer: (1) schema+tests → (2) extract commitNode (behavior-preserving) → (3) generateStepOptions → (4) SI rewrite → (5) validateStep adaptation → (6) LifeScreen/LifeScreenBottom/ActionBar machine + ✏️ → (7) delete runLifeStep.ts, spec section, full suite.

## Phase G — Flashcard weaving + SRS credit

Builds on the earlier deferred design (spec §19 note) + F's prompt shape. The planner (lifeStep) is the curator; SRS state updates ride the existing practice-resolution path.

- **Deck block in the prompt** (stable-prefix position, after `<sceneIndex>`): at chapter start, snapshot the unarchived deck — `id` + practice `phrase` only, due-first ordering (`nextReviewAt <= now` first, then by `cardPriorityScore` from `src/lib/sessionBuilder/internal.ts:47`), cap 100 cards (~1-2k tokens). Rendered as `<flashcards><card id="..">quand même</card>…</flashcards>`. Frozen per chapter (LIFE-STORY cache-friendliness); new cards enter at next chapter (consistent with the §19 note).
- **Planner SI**: "PREFER testing a saved card when the moment allows (tag `flashcardId`); cards near the top of `<flashcards>` are due for review. Never force a card that doesn't fit the scene." `gradedPlan.flashcardId` already exists in the schema.
- **SRS credit**: in LifeScreen's practice-resolution path (where the `correction` event is written / `onFeedbackContinue`), when the resolved gradedPlan carried `flashcardId`, call `recordAttempt({uid, cardId: flashcardId, correct})` (`src/lib/flashcards.ts:148`) — existing SM-2 writes + auto-archive at 5 distinct correct days. Requires threading `flashcardId` from the gradedPlan through the client feedback state (LifeScreen `FeedbackState` + `PracticeOutcome`).
- **Fresh-target interplay**: `<recentlyPracticed>` (exists) already prevents same-chapter repeats; the deck block's due-ordering biases toward weak cards. No extra selector call — the planner LLM does the picking (cheap, in-context).
- **Narrative re-exposure** (free, one SI line): NPC dialogue is nudged to RE-USE words from `<recentlyPracticed>` a few turns after they were tested — spaced repetition woven into the story itself. The player meets the word again as comprehensible input rather than a quiz.
- Spec: **LIFE-EX-SRS-1..4** (deck block shape; flashcardId → recordAttempt credit; chapter-frozen snapshot; narrative re-exposure nudge).

## Phase H — Cheap wins

1. **"Why?" explain wiring** — folded into Phase D2 (buildLifeExplainQuestion + ExplainModal).
2. **Chapter vocab recap**: `WorldArcCompleteScreen` + `CampaignCompleteScreen` gain a "Words you practised" list — derived client-side from `correction` events between arc/campaign start and now (payloads carry `correctAnswer`/`promptSource`) + `flashcard_added` events. No LLM.

## Backlog — FORMALIZED into the spec (explicit plan step)

The final implementation step of this plan appends every item below to `docs/specs/life-sim.md` §19 "Future / out of scope" (the repo's formal backlog home), each with a one-line trigger for revisiting. Nothing lives only in this plan file.

- **Wurld-mistakes practice session**: a practice-mode session seeded from questions the player got WRONG in wurlds — `correction` events with `correct: false` carry `testTarget`/`flashcardId`/`promptSource`; feed them into `buildSession` as a "Review your wurld mistakes" intent (practice mode's session builder + card selector already support intents). The full loop: story exposes → wurld tests → practice mode drills the misses.
- **Listening question node** (listen-and-pick lift): TTS plays the NPC line with text hidden; native options. New node kind slots into F's taxonomy cleanly; uses existing `TTSButton`/`synthesizeSpeech`. Do after F settles.
- **Recap quiz**: the resume-recap screen ends with one comprehension question about last session ("What did Mathieu ask you to do?") — memory + language reinforcement in one. Needs a small gen call at recap time; design after C ships.
- **Wurld sessions feed practice mode**: pipe wurld `correction`-event topics into practice mode's `recentSessionTopics` recency signal (the spec's coordinates-with note anticipates this; not yet wired).
- **Chapter transcript view**: reread a chapter's full dialogue (events log already has everything, zero LLM) with vocab taps live — re-reading comprehensible input is one of the cheapest high-value learning modes.
- **Difficulty auto-tune per wurld**: client computes rolling graded-question accuracy; prompt carries a one-line nudge ("player is at 92% — stretch them" / "at 45% — simplify structures"). One SI line + one derived stat.
- **Per-wurld fluency stat** (RPG progression derived from correction-event accuracy — "your French Charisma is growing").
- **80-locale i18n regen** (user-triggered, costs cents).
- **Explicit Gemini context caching** (spec §19 — revisit when telemetry shows implicit cache degrading).

## Verification (all phases)

- Unit: `npm test` green; new tests listed per phase (D/E/F fill in).
- Typecheck both packages; `npx eslint src/` clean; 600-LOC cap respected (extract components as needed).
- E2E: extend `tests/e2e/specs/life-flow.spec.ts` (mocked-Gemini harness, `tests/e2e/helpers/lifeMock.ts`) — recap screen appears on resume; toggle cycles bubble languages; vocab popover opens + saves; lookahead advance is instant (mock returns lookahead shape). `@standard` tier.
- Manual smoke on dev server with real Gemini: play 10+ turns in an existing wurld; verify instant advance, 1-in-5 question cadence, one-language questions, vocab taps, card thumbnail, recap on re-entry. View telemetry tab for cost regression (expect ≤~+30% output tokens/turn from lookahead, no new calls).
- Spec: every new invariant lands in `docs/specs/life-sim.md` same commit.

## Implementation handover

Implementation is intended for a smaller/cheaper model. Each phase above is self-contained with named files, reuse targets, and invariant ids. Suggested execution: A+B+C in one session (mechanical), D+E next (UI-heavy), F alone (the engine change — biggest, has its own ordered sub-steps), then G+H. Run the full gate after each phase, not just at the end.
