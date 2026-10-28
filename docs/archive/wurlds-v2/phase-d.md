# Phase D — Language display system (per-wurld viewMode + one-language graded turns + Why? wiring)

**Goal.** Two sub-parts, one phase. **D1**: a per-wurld 3-way language view mode (`visible` = both languages, `native-only` = nativeText only, `hidden` = practiceText only) stored on the world doc, cycled by a header button, obeyed by DialogueArea bubbles and CYOA ActionBar chips. **D2**: graded turns show exactly ONE language per surface (the practice-mode `PRACTICE-Q-PROMPT-1` contract lifted into the sim) — comprehension = native instruction + practice utterance + native-only chips; fill-blank = practice template + practice-token chips with mandatory empty `nativeText` — enforced by new hard `leakViolations` checks; the `PracticeFeedback` overlay is KEPT; its Why? button is wired through a new `buildLifeExplainQuestion` into the lazy `ExplainModal` (this folds in Phase H1).

**Invariant ids covered:** `LIFE-LANG-1` `LIFE-LANG-2` `LIFE-LANG-3` `LIFE-LANG-4` `LIFE-LANG-5` (all new — verified free: `git grep LIFE-LANG` hits nothing outside `docs/plans/wurlds-v2/`; no spec, source, or test uses the prefix). Also rewrites the bodies of `LIFE-EX-GEN-2` and `LIFE-EX-GEN-3(c)` and three cells of the §10.1 rhythm table (see Contradictions).

## Contradictions

1. **`LIFE-EX-GEN-2` / `LIFE-EX-GEN-3(c)` vs the one-language contract.** The current spec grants the generator language-placement freedom ("provide a native scaffold, … mix languages within a chip, omit the native gloss entirely" / gloss-leak handling "is judgment, not a hard programmatic rule"). The approved plan explicitly deletes that freedom (plan §D2: delete the "LANGUAGE PLACEMENT (pedagogical judgment)" SI block, add hard leak checks). Resolution: the plan is the owner-approved spec change — this doc rewrites both invariant bodies in the same commit (Spec change blocks 4 and 5 below). Do not implement D2 without landing those spec edits first.
2. **§10.1 rhythm-table cells** say CYOA chips show "Both languages" and inbound chips carry "a near-paraphrase (practice text) + the meaning (native text)". Superseded by LIFE-LANG-1/3; the three cells are rewritten in Spec change block 3.
3. **`LIFE-BUBBLE-4`** ("The item's view mode is INDEPENDENT of the global default — tapping flips just that item. (Phase D wires the long-press handlers.)") refers to the ORIGINAL vertical-slice phase lettering, not this plan's Phase D. Per-bubble tap-to-flip and long-press ExplainModal on bubbles remain unimplemented and are NOT in this phase's scope. `LIFE-LANG-3` is written as the per-wurld default that a future per-bubble override would sit on top of. No spec edit to LIFE-BUBBLE-4.
4. **600-LOC cap**: `src/screens/LifeScreen/LifeScreen.tsx` sits at exactly 600 effective LOC today (the ESLint `max-lines` limit with `skipBlankLines`+`skipComments`); Phase C lands first and leaves it at ≈590 (its own extractions net −10). This phase's additions (~48 effective lines across Edits 12f–12l) only fit because a designed extraction is mandatory: the `FeedbackState`/`LocalState`/`INITIAL_STATE` block (42 effective lines) moves to a new `src/screens/LifeScreen/lifeScreenState.ts` (Edits 11 + 12g). Net LifeScreen delta for this phase ≈ +6 effective lines (≈596 post-D). This is part of the phase, not optional.
5. **`src/lib/life/prompts/step.ts:115`** ("The generator decides language placement (native scaffold yes/no, chip subtext yes/no, etc.)…") becomes stale wording after D2, but its actual instruction to the planner ("you don't need to specify placement") stays functionally correct, and Phase F4 rewrites that SI wholesale. **Do NOT edit step.ts in this phase** — flagged so you don't "fix" it and break Phase F's anchors.

## Read first

- `docs/specs/life-sim.md` — §8 (LIFE-UI-3), §9 (LIFE-BUBBLE-*), §9.5 (LIFE-CONTRACT-*), §10 (LIFE-EX-*, LIFE-EX-VOCAB-1), §10.45 (LIFE-EX-PLAN-* / LIFE-EX-GEN-*).
- `docs/specs/practice-mode.md` — §7.6.5 `PRACTICE-Q-PROMPT-1` (the contract being lifted: instruction = native task cue, practiceText = practice-language content, never collapsed).
- `docs/specs/README.md` — prefix table + test naming convention.
- Source (read before editing): `src/screens/LifeScreen/LifeScreen.tsx`, `LifeScreenHeader.tsx`, `LifeScreenBottom.tsx`, `ActionBar.tsx`, `DialogueArea.tsx`, `PracticePromptCard.tsx`, `PracticeFeedback.tsx`; `src/lib/life/stepSchema.ts` (ZStepChoice / ZPracticePrompt / ZGradedPlan), `src/lib/life/prompts/gradedQuestion.ts`, `src/lib/life/runGradedQuestionGenerate.ts`, `src/lib/life/world.ts` (updateLifeWorld), `src/lib/life/resolvedBubble.ts`; `src/types/firestore.ts` (ZViewMode at ~line 88, ZLifeWorld at ~line 886); `src/screens/Practice/buildExplainQuestion.ts` + `src/lib/explain.ts` (`ExplainPracticeQuestion`) + `src/components/ExplainModal/ExplainModal.tsx` (props) + `src/screens/PracticeScreen.tsx` lines 39-42 and 859-876 (the lazy-mount pattern being mirrored); `tests/e2e/specs/life-flow.spec.ts` + `tests/e2e/helpers/lifeMock.ts`.

Facts pinned by this doc (do not re-derive): icon library is **lucide-react** (`Eye`, `EyeOff`, `Languages` all exist in the installed version); `ZViewMode = z.enum(['visible','hidden','native-only'])` already exists at `src/types/firestore.ts:88`; `test:e2e:standard` runs every spec not tagged `@full` (grep-invert), so `life-flow.spec.ts` is already in the @standard tier without a tag; `buildResolvedBubble` outbound bubbles carry `nativeText: null`, so empty fill-blank chip glosses never corrupt the resolved user bubble.

---

## Spec changes

### Block 1 — life-sim.md domain prefix table row

ANCHOR (verify unique): the line below in `docs/specs/life-sim.md`

```
| `LIFE-BUBBLE-*` | Two-bubble window | Sliding-2 dialogue model, translation modes, user avatar slot |
```

INSERT AFTER that line:

```markdown
| `LIFE-LANG-*` | Language display | Per-wurld 3-way viewMode; one-language graded turns; comprehension-gate precedence; Why?-explain wiring |
```

### Block 2 — new §9.6 section

ANCHOR (verify unique): the line below in `docs/specs/life-sim.md`

```
## 10. Embedded exercises — `LIFE-EX-*`
```

INSERT BEFORE that line (i.e. between the `---` that closes §9.5 and this heading):

```markdown
## 9.6 Language display system — `LIFE-LANG-*`

Two branches. Normal gameplay shows languages per a **per-wurld 3-way view mode**; graded turns show exactly **ONE language per surface** — the practice-mode `PRACTICE-Q-PROMPT-1` contract (native instruction / practice content, never collapsed) lifted into the sim.

| ID | Invariant |
|---|---|
| **LIFE-LANG-1** | One-language graded chips. Graded chips render exactly ONE language, pinned per kind: **comprehension** chips render ONLY `nativeText` (a third-person native interpretation — REQUIRED non-empty and distinct on every chip; `practiceText` is retained on the record but never rendered); **fill-blank** chips render ONLY `practiceText` (the bare missing token(s)); their `nativeText` MUST be the empty string on every chip — any gloss telegraphs the answer. Enforced by hard `leakViolations` checks in `runGradedQuestionGenerate` (one retry with hint, then demote per LIFE-EX-GEN-6). |
| **LIFE-LANG-2** | Per-kind graded layout. Comprehension: native eyebrow ("What did they just say?") + native `practicePrompt.question` (REQUIRED non-empty, names the speaker) + the verbatim practice-language `npcUtterance` card + native-only chips (`chipDisplay='native'`). Fill-blank: native eyebrow ("Complete the sentence") + practice-language template card with `___` (no native scaffold rendered pre-answer; `practicePrompt.nativeText` still carries the full native translation with `___` preserved — schema-required and retained on the record, but not rendered or consumed anywhere pre- or post-answer today) + practice-token chips (`chipDisplay='practice'`). The post-answer `PracticeFeedback` overlay is exempt — it may show both languages where present (the answer is already committed; feedback is the teaching moment). |
| **LIFE-LANG-3** | Per-wurld view mode. `ZLifeWorld.viewMode?: ZViewMode` (`'visible'` = both languages, `'native-only'` = nativeText only, `'hidden'` = practiceText only; absent ⇒ `'visible'`). Cycled by a header button (Eye → EyeOff → Languages; order visible → native-only → hidden → visible) that persists via `updateLifeWorld` — it syncs across devices through the existing `useLifeWorld` listener. Obeying surfaces: DialogueArea narrator/NPC/user bubbles (resume bubbles inherit automatically) and CYOA ActionBar chips via `chipDisplay: 'both'\|'practice'\|'native'` (in `'native-only'` the chip's MAIN label is its nativeText, falling back to practiceText when empty — no bubble or chip ever renders empty, LIFE-WIP-2). Excluded: the location ribbon, TTS buttons (always speak practiceText), graded turns (LIFE-LANG-1/2 pin their display), the PracticeFeedback overlay. |
| **LIFE-LANG-4** | Gate precedence. The comprehension-source gloss gate (`hideNativeForUtterance`) OUTRANKS viewMode: while a comprehension question is active, the source NPC bubble renders practiceText with the native line behind the explicit tap-to-reveal — in `'native-only'` mode showing the gloss as the main label would BE the answer. The explicit reveal works in every mode (a deliberate user action outranks the passive mode). |
| **LIFE-LANG-5** | Why? explain wiring. The `PracticeFeedback` Why? button opens the lazy `ExplainModal` in practice mode, fed by `buildLifeExplainQuestion(prompt, allChoices, displayLang)` (`src/screens/LifeScreen/buildLifeExplainQuestion.ts`, `questionType: 'multiple-choice'`, mirrors `src/screens/Practice/buildExplainQuestion.ts`). `displayLang` is the language the chips were RENDERED in (comprehension → `'native'`, fill-blank → `'practice'`); `options`, `correctAnswer` and `userAnswer` are all expressed in that language. The modal receives the world's `practiceLanguage`/`nativeLanguage`/`difficulty`. The graded prompt + full chip set are captured into the feedback state at pick time (the live chip list is cleared when feedback shows). |
```

### Block 3 — §10.1 rhythm-table cells (three single-line row replacements)

Each of these rows is ONE markdown line in `docs/specs/life-sim.md` §10.1. Replace the full line.

3a. ANCHOR (verify unique): the substring `Both languages shown on each chip.`
Replace the full CYOA row line:

```markdown
| **CYOA decision** | Default after narrative beats. Or after an inbound practice. | CONCRETE options — items, places, people, navigational actions, OR what to say next ("baguette", "leave"). EVERY option is a valid story branch. Both languages shown on each chip. | None. `graded: false`. |
```

with:

```markdown
| **CYOA decision** | Default after narrative beats. Or after an inbound practice. | CONCRETE options — items, places, people, navigational actions, OR what to say next ("baguette", "leave"). EVERY option is a valid story branch. Chip display follows the wurld's view mode (LIFE-LANG-3). | None. `graded: false`. |
```

3b. ANCHOR (verify unique): the substring `Each chip carries both languages.`
Replace the full Outbound row line:

```markdown
| **Outbound practice** | IMMEDIATELY after a CYOA pick that committed the player to a LINGUISTIC action (order, ask, reply, greet). | Same intent in N=3–4 language forms. Each chip carries both languages. Exactly one correct; wrong options are plausibly-wrong (wrong verb form, wrong article, wrong register). `practicePrompt.kind = "fill-blank"` with the sentence + `___` blank. | `graded: true`. |
```

with:

```markdown
| **Outbound practice** | IMMEDIATELY after a CYOA pick that committed the player to a LINGUISTIC action (order, ask, reply, greet). | Same intent in N=3–4 language forms. Each chip carries ONLY the practice-language token(s) — `nativeText: ""` (LIFE-LANG-1). Exactly one correct; wrong options are plausibly-wrong (wrong verb form, wrong article, wrong register). `practicePrompt.kind = "fill-blank"` with the sentence + `___` blank. | `graded: true`. |
```

3c. ANCHOR (verify unique): the substring `a near-paraphrase (practice text) + the meaning (native text)`
Replace the full Inbound row line:

```markdown
| **Inbound practice** | IMMEDIATELY after an NPC beat that materially advances the dialogue (a question to the player, a key revelation, a request) and the model decides comprehension is worth testing. | Same NPC utterance in N=3–4 interpretation chips. Each chip carries a near-paraphrase (practice text) + the meaning (native text). One correct; wrong options are plausibly-wrong (similar words but wrong meaning, wrong tense, wrong subject). `practicePrompt.kind = "comprehension"` with the NPC's verbatim utterance + "What did they say?" prompt. | `graded: true`. |
```

with:

```markdown
| **Inbound practice** | IMMEDIATELY after an NPC beat that materially advances the dialogue (a question to the player, a key revelation, a request) and the model decides comprehension is worth testing. | Same NPC utterance in N=3–4 interpretation chips. Each chip RENDERS only the native-language interpretation; the practice-language near-paraphrase is retained on the record but never rendered (LIFE-LANG-1). One correct; wrong options are plausibly-wrong (similar words but wrong meaning, wrong tense, wrong subject). `practicePrompt.kind = "comprehension"` with the NPC's verbatim utterance + "What did they say?" prompt. | `graded: true`. |
```

### Block 4 — LIFE-EX-GEN-2 body rewrite (one line)

ANCHOR (verify unique): the substring `mix languages within a chip`
Replace the full row line:

```markdown
| **LIFE-EX-GEN-2** | The disambiguation principle: every graded question MUST have exactly ONE clearly-correct chip. HOW the generator achieves that is its own pedagogical judgment — provide a native scaffold, lean on the surrounding practice-language context, mix languages within a chip, omit the native gloss entirely, etc. No structured disambiguation hint; the generator chooses the strategy that fits the moment. |
```

with:

```markdown
| **LIFE-EX-GEN-2** | The disambiguation principle: every graded question MUST have exactly ONE clearly-correct chip. The generator achieves this through distractor choice and the surrounding practice-language context, WITHIN the fixed one-language chip rule (LIFE-LANG-1) — language placement is pinned per kind and is NOT a disambiguation lever. No structured disambiguation hint; the generator chooses the distractors that fit the moment. (Rewritten in the Wurlds-v2 Phase D commit; the pre-2026-07 body allowed per-chip language mixing.) |
```

### Block 5 — LIFE-EX-GEN-3 body rewrite (one line)

ANCHOR (verify unique): the substring `SI guides the model toward identical glosses`
Replace the full row line (starts `| **LIFE-EX-GEN-3** | ANSWER-LEAK RULES (strict, enforced by a pre-render guard): (a) …`) with:

```markdown
| **LIFE-EX-GEN-3** | ANSWER-LEAK RULES (strict, enforced by a pre-render guard): (a) For comprehension, no chip's `practiceText` or `nativeText` may equal or be a substring of the `npcUtterance` (verbatim echoes give the answer away); additionally every chip's `nativeText` is REQUIRED non-empty and distinct, and `practicePrompt.question` is REQUIRED non-empty (LIFE-LANG-1/2). (b) For fill-blank, each chip's `practiceText` MUST be the bare missing token(s) only — never include template words. (c) Fill-blank chips carry NO native gloss at all: `nativeText` MUST be the empty string on every chip (LIFE-LANG-1) — this is a hard programmatic check, superseding the pre-2026-07 judgment-based gloss handling. Violations retry once with the hint attached; second failure → demote to CYOA. |
```

### Block 6 — docs/specs/README.md prefix-table row

ANCHOR (verify unique): the substring `UI / BUBBLE / CONTRACT / WORLD` in `docs/specs/README.md`
Replace the full line:

```markdown
| `LIFE-*` | life-sim (DATA / FLOW / ONBOARD / CTX / STEP / SCENE / NPC / UI / BUBBLE / CONTRACT / WORLD / WORLD-ARC / NPC-RECUR / EX / TRANS / COMPACT / EVENT / SETTINGS / DEV / WIP / FAIL) |
```

with:

```markdown
| `LIFE-*` | life-sim (DATA / FLOW / ONBOARD / CTX / STEP / SCENE / NPC / UI / BUBBLE / LANG / CONTRACT / WORLD / WORLD-ARC / NPC-RECUR / EX / TRANS / COMPACT / EVENT / SETTINGS / DEV / WIP / FAIL) |
```

### Block 7 — life-sim.md §18 test-table row

ANCHOR (verify unique): the substring `End-to-end onboarding → first beat → user response → next beat`
Insert IMMEDIATELY AFTER that full table row (post-Phase-B the LIFE-WORLD-9 row sits after the same anchor; this row landing before or after it is immaterial — §18 is an index, not a sequence):

```markdown
| `src/lib/life/prompts/gradedQuestion.test.ts`, `src/lib/life/runGradedQuestionGenerate.test.ts`, `src/screens/LifeScreen/buildLifeExplainQuestion.test.ts`, `src/screens/LifeScreen/{ActionBar,DialogueArea,LifeScreenHeader,LifeScreenBottom}.test.tsx`, `tests/e2e/specs/life-flow.spec.ts` (Wurlds-v2 Phase D) | LIFE-LANG-1..5 — one-language graded turns, per-wurld viewMode cycle + persistence, gate precedence, Why?-explain wiring |
```

---

## Ordered steps

1. **Spec edits** — apply Spec change Blocks 1–7 above.
2. **Write ALL tests** (section *Tests* below): 7 new unit/component test files + the E2E edits to `tests/e2e/specs/life-flow.spec.ts`. Run `npm test` — the new unit files MUST fail (missing modules/props/asserted strings). Do not proceed while they pass.
3. **Implementation edits, in this order** (details in *Edits* below):
   1. Edit 1 — `src/types/firestore.ts` (viewMode on ZLifeWorld)
   2. Edit 2 — `src/i18n/locales/en.ts` (4 new keys)
   3. Edit 3 — `src/lib/life/prompts/gradedQuestion.ts` (SI full-function replacement)
   4. Edit 4 — `src/lib/life/runGradedQuestionGenerate.ts` (3 leak-check insertions)
   5. Edit 5 — NEW `src/screens/LifeScreen/buildLifeExplainQuestion.ts`
   6. Edit 6 — `src/screens/LifeScreen/ActionBar.tsx` (chipDisplay replaces hideChipNative)
   7. Edit 7 — `src/screens/LifeScreen/DialogueArea.tsx` (viewMode + gate precedence)
   8. Edit 8 — `src/screens/LifeScreen/LifeScreenHeader.tsx` (FULL replacement: cycle button)
   9. Edit 9 — `src/screens/LifeScreen/PracticeFeedback.tsx` (Why testid + dangling-separator guard)
   10. Edit 10 — `src/screens/LifeScreen/LifeScreenBottom.tsx` (FULL replacement: chipDisplay derivation + onExplain)
   11. Edit 11 — NEW `src/screens/LifeScreen/lifeScreenState.ts` (extracted state types)
   12. Edit 12 — `src/screens/LifeScreen/LifeScreen.tsx` (12 targeted sub-edits, 12a–12l; 12j has two anchors)
4. **Run to green**: `npm test`, `npm run typecheck`, `npx eslint src/`, then the E2E spec (see *Verify*). Read every screenshot the E2E run captures.

---

## Edits

> Anchors: verify each `ANCHOR (verify unique)` with `grep -F -c '<snippet>' <file>` — expected count 1 — before editing; widen the snippet if not. All anchors below were verified count=1 against the current tree. Phase C also edits `LifeScreen.tsx` (opening-effect resume gating + intro-overlay region), `src/types/firestore.ts` (adds `resumeRecap` to ZLifeWorld), `tests/e2e/helpers/lifeMock.ts` (recap fixture queue) and `tests/e2e/specs/life-flow.spec.ts` (Begin-click insert in the onboarding test + replaces the LIFE-FLOW-2 resume test with two LIFE-FLOW-5 tests); the anchors here were chosen outside those regions and are marked POST-PHASE-C where they share a file with C. In the E2E spec file, T8a–T8d anchors sit outside C's edit regions; T8e is POST-PHASE-C (its anchor only exists after C lands).

### Edit 1 — `src/types/firestore.ts` (POST-PHASE-C ANCHOR — C adds `resumeRecap` elsewhere in ZLifeWorld; this anchor is untouched by it)

ANCHOR (verify unique):

```ts
  /** Open goals the LLM can reference. */
  currentGoals: z.array(z.string()).optional(),
```

Replace with:

```ts
  /** Open goals the LLM can reference. */
  currentGoals: z.array(z.string()).optional(),
  /** LIFE-LANG-3: per-wurld language display mode. 'visible' = both
   *  languages, 'native-only' = nativeText only, 'hidden' =
   *  practiceText only. Absent ⇒ 'visible'. Written by the header
   *  cycle button via updateLifeWorld; `.catch(undefined)` degrades
   *  an invalid stored value to the default instead of failing the
   *  whole world parse (same pattern as the settings viewMode). */
  viewMode: ZViewMode.optional().catch(undefined),
```

(`ZViewMode` is declared earlier in the same file at ~line 88 — no import needed.)

### Edit 2 — `src/i18n/locales/en.ts`

ANCHOR (verify unique):

```ts
  'life.feedback.continue': 'Continue',
```

Replace with:

```ts
  'life.feedback.continue': 'Continue',
  'life.viewMode.label': 'Language display',
  'life.viewMode.both': 'Both languages',
  'life.viewMode.nativeOnly': 'Your language only',
  'life.viewMode.practiceOnly': 'Practice language only',
```

Do NOT touch any other locale file (80-locale regen is user-triggered, out of scope).

### Edit 3 — `src/lib/life/prompts/gradedQuestion.ts` — replace the ENTIRE `gradedQuestionSystemInstruction` function

ANCHOR (verify unique): `export function gradedQuestionSystemInstruction(opts: {`

Replace the whole function (from that line through its closing `}` — it ends with `  ].join('\n\n');\n}` immediately before `export function buildGradedQuestionPrompt(`) with:

```ts
export function gradedQuestionSystemInstruction(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
}): string {
  const { practiceLanguage, nativeLanguage } = opts;
  return [
    `You are the QUESTION GENERATOR for a language-learning life simulator. The lifeStep planner gives you: WHAT to test (a phrase or saved flashcard) + the SENTENCE CONTEXT where it appears (for fill-blank) or the verbatim NPC line (for comprehension), plus a tight scene snapshot. You author the practice-prompt header + 3-4 chips. You DO NOT write narrative.`,
    `Practice language: ${practiceLanguage}. Native language: ${nativeLanguage}.`,
    ``,
    `READ THE SCENE FIRST. The <sceneContext> block tells you what world this is and where the player is. Distractors MUST fit that world. If the saga is "The Whispering Resistance" and the location is "Underground bunker", do NOT author "not enough money in the cash register" distractors. Match the register, the tone, the stakes. Generic templates feel broken to the player — they're halfway through battling alien drones, not buying baguettes.`,
    ``,
    `USER VIEW — what the learner sees on a graded turn:`,
    `  • A header card with a ${nativeLanguage} task cue ("Complete the sentence" for fill-blank, "What did they just say?" for comprehension).`,
    `  • For fill-blank: the ${practiceLanguage} sentence with the blank ("___"). NO ${nativeLanguage} scaffold is shown before they answer.`,
    `  • For comprehension: the NPC's verbatim ${practiceLanguage} line in quotes, plus your short ${nativeLanguage} question.`,
    `  • A grid of 3-4 chips, each showing exactly ONE language: fill-blank chips show only the ${practiceLanguage} token(s); comprehension chips show only the ${nativeLanguage} interpretation.`,
    `  • The learner taps one chip. The system marks it correct or wrong.`,
    ``,
    `LANGUAGE RULES (strict — no judgment calls; a runtime guard rejects violations and retries you once with the hint stapled here):`,
    `  • The instruction/question is ALWAYS ${nativeLanguage}; the tested content is ALWAYS ${practiceLanguage}. Never mix languages inside one field.`,
    `  • FILL-BLANK: practicePrompt.practiceText = the ${practiceLanguage} sentence with EXACTLY ONE "___". practicePrompt.nativeText = its full ${nativeLanguage} translation with "___" kept in place (never shown to the learner; kept on the record). Chips: practiceText = the bare missing ${practiceLanguage} token(s) ONLY; nativeText = "" on EVERY chip. The empty string is MANDATORY — any gloss telegraphs the answer.`,
    `  • COMPREHENSION: practicePrompt.npcUtterance = the verbatim ${practiceLanguage} line (copy from plan, do not paraphrase). practicePrompt.question = a short ${nativeLanguage} question naming the speaker ("What is Sophie saying?") — REQUIRED, never empty. Chips: nativeText = a third-person ${nativeLanguage} interpretation, REQUIRED non-empty on EVERY chip and distinct across chips (it is the ONLY text the learner sees); practiceText = the matching ${practiceLanguage} near-paraphrase (kept for the record, never rendered — still required non-empty and distinct).`,
    ``,
    `UNIVERSAL RULES:`,
    `  1. Emit EXACTLY 3 or 4 chips. EXACTLY ONE chip has correctness: "correct". The rest have correctness: "wrong".`,
    `  2. Every chip has a non-empty practiceText. nativeText follows the LANGUAGE RULES above: "" on every fill-blank chip; non-empty on every comprehension chip.`,
    `  3. No two chips share the same practiceText (case-insensitive). Comprehension chips also never share the same nativeText.`,
    `  4. No chip has an emoji on fill-blank turns — emojis telegraph meaning.`,
    `  5. EXACTLY ONE correct answer. If you find yourself thinking "either of these could be right", reshape the chips so only one fits.`,
    ``,
    `ANSWER-LEAK RULES (strict — same runtime guard):`,
    `  • Comprehension: no chip's practiceText OR nativeText may equal or be a substring of the npcUtterance. Verbatim echoes destroy the test.`,
    `  • Fill-blank: each chip's practiceText is JUST the missing word(s) — never the full sentence, never the template, never include words from the surrounding template.`,
    `      GOOD: "voudrais" / "veux" / "ai"  (1-2 tokens each)`,
    `      BAD:  "Je voudrais un café" / "Je continue vers le dépôt"  (full sentences — this is CYOA, not fill-blank)`,
    `      BAD:  "voudrais un café" / "Je voudrais"                   (includes template words)`,
    `  • Fill-blank: NO native gloss anywhere on the chips — nativeText: "" on every chip, no exceptions. The learner sees only the ${practiceLanguage} tokens, so the distractors themselves must carry the difficulty.`,
    ``,
    `CHIP-SHAPE RULES:`,
    `  • FILL-BLANK chips are inflectional variants of the SAME LEMMA. Target "voudrais" (vouloir) → distractors "veux" / "voulais" / "voudrai". NEVER unrelated lemmas (no "regarde" mixed in — that's CYOA disguised as fill-blank).`,
    `  • COMPREHENSION chips are third-person INTERPRETATIONS in ${nativeLanguage}. "She's asking how your week was", "He's offering a coffee", "Sophie is suggesting we meet later." NEVER first-person responses ("Yes, I'm fine") — those are RESPONSES, not interpretations. AND they must fit the scene: a comprehension chip in a sci-fi resistance saga shouldn't read like a café small-talk option.`,
    ``,
    `OUTPUT SHAPE — emit ONLY this JSON object (no prose, no markdown fences):`,
    `{`,
    `  "practicePrompt": {`,
    `    "kind": "fill-blank" | "comprehension",`,
    `    // For fill-blank:`,
    `    "practiceText": "Je ___ un café",                        // sentence with EXACTLY ONE "___"`,
    `    "nativeText":   "I ___ a coffee",                        // full native translation, "___" kept in place`,
    `    // For comprehension:`,
    `    "npcUtterance": "<verbatim from plan>",                  // copy from plan, do not paraphrase`,
    `    "question":     "What is Sophie saying?",                // short native question — REQUIRED`,
    `    "speakerName":  "<from plan>",`,
    `    "npcId":        "<from plan or null>"`,
    `  },`,
    `  "choices": [`,
    `    // fill-blank example — nativeText is ALWAYS "":`,
    `    { "id": "c1", "practiceText": "voudrais", "nativeText": "", "correctness": "correct" },`,
    `    { "id": "c2", "practiceText": "veux",     "nativeText": "", "correctness": "wrong" },`,
    `    { "id": "c3", "practiceText": "ai",       "nativeText": "", "correctness": "wrong" }`,
    `    // comprehension example — nativeText carries the interpretation, practiceText the hidden near-paraphrase:`,
    `    // { "id": "c1", "practiceText": "Elle propose un café", "nativeText": "She's offering a coffee", "correctness": "correct" }`,
    `  ]`,
    `}`,
  ].join('\n\n');
}
```

`buildGradedQuestionPrompt`, `escapeText`, `escapeAttr` are NOT changed.

### Edit 4 — `src/lib/life/runGradedQuestionGenerate.ts` (3 insertions in `leakViolations`)

**4a — comprehension: native question required.** ANCHOR (verify unique):

```ts
      const utteranceLower = plan.npcUtterance.trim().toLowerCase();
```

Replace with:

```ts
      const utteranceLower = plan.npcUtterance.trim().toLowerCase();
      // LIFE-LANG-2: the instruction is ALWAYS native — a comprehension
      // turn without a native question has no instruction surface.
      if (!q.practicePrompt.question.trim()) {
        out.push(
          'practicePrompt.question is empty — comprehension requires a short native-language question ("What is Sophie saying?").',
        );
      }
```

**4b — comprehension: nativeText required + distinct.** ANCHOR (verify unique — the closing of the existing per-chip loop; the inner string `nativeText is a substring of the NPC utterance` occurs once):

```ts
        if (n && utteranceLower.includes(n) && n.length >= 4) {
          out.push(
            `Chip ${i} nativeText is a substring of the NPC utterance — leaks the answer.`,
          );
        }
      });
```

Replace with:

```ts
        if (n && utteranceLower.includes(n) && n.length >= 4) {
          out.push(
            `Chip ${i} nativeText is a substring of the NPC utterance — leaks the answer.`,
          );
        }
      });
      // LIFE-LANG-1: comprehension chips render ONLY the native
      // interpretation — nativeText is the visible label, so it must be
      // present and distinct on every chip.
      const seenNative = new Map<string, number>();
      q.choices.forEach((c, i) => {
        const n = c.nativeText.trim().toLowerCase();
        if (!n) {
          out.push(
            `Chip ${i} has empty nativeText — comprehension chips show ONLY the native interpretation; nativeText is REQUIRED on every chip.`,
          );
          return;
        }
        const prev = seenNative.get(n);
        if (prev !== undefined) {
          out.push(
            `Chips ${prev} and ${i} share the same nativeText ("${c.nativeText}") — every comprehension chip needs a distinct interpretation.`,
          );
        } else {
          seenNative.set(n, i);
        }
      });
```

**4c — fill-blank: gloss forbidden.** ANCHOR (verify unique — the whole superseded comment block):

```ts
      // NB: the "all chip natives must match" check was REMOVED on
      // 2026-06-01 (LIFE-EX-GEN-3 revised). The SI now treats native
      // gloss handling as model judgment — identical glosses for pure
      // conjugation tests, varied glosses for meaning/register tests.
      // The runtime can't safely tell those apart without the plan's
      // intent, so we trust the LLM.
```

Replace with:

```ts
      // LIFE-LANG-1 (2026-07 revision — supersedes the 2026-06-01
      // judgment-based gloss handling): fill-blank chips are practice-
      // language ONLY. Any native gloss telegraphs the inflectional
      // answer, so nativeText must be the empty string on every chip.
      q.choices.forEach((c, i) => {
        if (c.nativeText.trim() !== '') {
          out.push(
            `Chip ${i} carries a native gloss ("${c.nativeText}") — fill-blank chips must set nativeText: "" (one language per kind; a gloss telegraphs the answer).`,
          );
        }
      });
```

### Edit 5 — NEW FILE `src/screens/LifeScreen/buildLifeExplainQuestion.ts` (complete contents)

```ts
/**
 * LIFE-LANG-5: map a graded life-sim turn into the shape the
 * ExplainModal's practice mode consumes (`ExplainPracticeQuestion`).
 * Mirrors `src/screens/Practice/buildExplainQuestion.ts` —
 * everything maps onto `questionType: 'multiple-choice'`.
 *
 * `displayLang` is the language the chips were RENDERED in
 * (LIFE-LANG-1: comprehension → 'native', fill-blank → 'practice');
 * `options`, `correctAnswer` and the caller's `userAnswer` must all
 * be expressed in that language so the explanation reasons about
 * what the learner actually saw.
 *
 * Pure function — no React, no state — unit-tested in isolation.
 *
 * Spec: docs/specs/life-sim.md §9.6 (LIFE-LANG-5).
 */
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';
import type { ExplainPracticeQuestion } from '@/lib/explain';

export type LifeExplainDisplayLang = 'practice' | 'native';

/** The label a chip showed on-screen for the given display language.
 *  Falls back to practiceText when the native label is empty so the
 *  explain prompt never carries a blank option. */
export function lifeChoiceLabel(
  choice: Pick<StepChoice, 'practiceText' | 'nativeText'>,
  displayLang: LifeExplainDisplayLang,
): string {
  if (displayLang === 'native' && choice.nativeText.trim()) {
    return choice.nativeText;
  }
  return choice.practiceText;
}

export function buildLifeExplainQuestion(
  prompt: PracticePrompt,
  choices: ReadonlyArray<StepChoice>,
  displayLang: LifeExplainDisplayLang,
): ExplainPracticeQuestion {
  const options = choices.map((c) => lifeChoiceLabel(c, displayLang));
  const correct = choices.find((c) => c.correctness === 'correct');
  const correctAnswer = correct ? lifeChoiceLabel(correct, displayLang) : '';
  if (prompt.kind === 'comprehension') {
    return {
      questionType: 'multiple-choice',
      // The generator's native question is the task cue (LIFE-LANG-2).
      // English fallbacks mirror buildExplainQuestion's own fallbacks —
      // the instruction is LLM input, not rendered UI.
      instruction:
        prompt.question.trim() ||
        (prompt.speakerName
          ? `What is ${prompt.speakerName} saying?`
          : 'What did they just say?'),
      practiceText: prompt.npcUtterance,
      options,
      correctAnswer,
    };
  }
  return {
    questionType: 'multiple-choice',
    instruction: 'Complete the sentence.',
    practiceText: prompt.practiceText,
    options,
    correctAnswer,
  };
}
```

### Edit 6 — `src/screens/LifeScreen/ActionBar.tsx` (4 sub-edits)

**6a — export the ChipDisplay type.** ANCHOR (verify unique):

```ts
/** Matched flashcard for a chip — drives the vocab-card render. */
```

Replace with:

```ts
/** LIFE-LANG-1/3: which single language (or both) a chip's face
 *  shows. 'both' = practice main + native sub; 'practice' = practice
 *  main only; 'native' = native main only (falls back to practiceText
 *  when nativeText is empty — a chip never renders blank). */
export type ChipDisplay = 'both' | 'practice' | 'native';

/** Matched flashcard for a chip — drives the vocab-card render. */
```

**6b — props type.** ANCHOR (verify unique):

```ts
  /** When true, the chip's native subtext is suppressed. Set on
   *  graded turns so a fill-blank's chips don't telegraph the
   *  answer's meaning (e.g. "think / think / think" under three
   *  conjugations of `penser`). */
  hideChipNative?: boolean;
```

Replace with:

```ts
  /** LIFE-LANG-1/3: chip display language. Graded turns pin it per
   *  kind (comprehension → 'native', fill-blank → 'practice');
   *  CYOA turns follow the wurld's viewMode. Defaults to 'both'.
   *  REPLACES the old boolean `hideChipNative`. */
  chipDisplay?: ChipDisplay;
```

**6c — destructure default.** ANCHOR (verify unique):

```ts
  hideChipNative = false,
```

Replace with:

```ts
  chipDisplay = 'both',
```

**6d — chip face render.** ANCHOR (verify unique — single line):

```ts
          const isVocab = !!match;
```

Replace with:

```ts
          const isVocab = !!match;
          // LIFE-LANG-1/3: one language per chip face. 'native' falls
          // back to practiceText when the native label is empty so no
          // chip ever renders blank (LIFE-WIP-2).
          const mainText =
            chipDisplay === 'native' && c.nativeText && c.nativeText.trim()
              ? c.nativeText
              : c.practiceText;
          const subText =
            chipDisplay === 'both' && c.nativeText && c.nativeText.trim()
              ? c.nativeText
              : null;
```

Then, ANCHOR (verify unique — the whole block; the line `{c.nativeText && !hideChipNative && (` occurs once):

```tsx
              <div dir={dirOf(c.practiceText)} className="flex items-center gap-1.5 text-sm font-medium text-(--color-fg) leading-snug">
                {c.emoji && <span className="text-base leading-none">{c.emoji}</span>}
                <span>{c.practiceText}</span>
              </div>
              {c.nativeText && !hideChipNative && (
                <div dir={dirOf(c.nativeText)} className="text-[11px] text-(--color-fg-muted) leading-snug">
                  {c.nativeText}
                </div>
              )}
```

Replace with:

```tsx
              <div dir={dirOf(mainText)} className="flex items-center gap-1.5 text-sm font-medium text-(--color-fg) leading-snug">
                {c.emoji && <span className="text-base leading-none">{c.emoji}</span>}
                <span>{mainText}</span>
              </div>
              {subText && (
                <div dir={dirOf(subText)} className="text-[11px] text-(--color-fg-muted) leading-snug">
                  {subText}
                </div>
              )}
```

### Edit 7 — `src/screens/LifeScreen/DialogueArea.tsx` (5 sub-edits)

**7a — type import.** ANCHOR (verify unique):

```ts
import { TTSButton } from '@/components/TTSButton';
```

Replace with:

```ts
import { TTSButton } from '@/components/TTSButton';
import type { ZViewModeT } from '@/types/firestore';
```

**7b — Props field.** ANCHOR (verify unique):

```ts
  /** Optional user avatar URL (Phase C). */
  userAvatarUrl?: string | null;
```

Replace with:

```ts
  /** Optional user avatar URL (Phase C). */
  userAvatarUrl?: string | null;
  /** LIFE-LANG-3: the wurld's language display mode. 'visible' =
   *  practice + native, 'native-only' = nativeText only, 'hidden' =
   *  practiceText only. Defaults to 'visible'. The comprehension-
   *  source gate (hideNativeForUtterance) OUTRANKS this
   *  (LIFE-LANG-4). */
  viewMode?: ZViewModeT;
```

**7c — destructure.** ANCHOR (verify unique):

```ts
  hideNativeForUtterance,
```

Replace with:

```ts
  hideNativeForUtterance,
  viewMode = 'visible',
```

**7d — BubbleView callsite.** ANCHOR (verify unique):

```tsx
          bubble={b}
```

Replace with:

```tsx
          bubble={b}
          viewMode={viewMode}
```

**7e — BubbleView + the three view functions.** Delete everything from the line `function BubbleView({` (ANCHOR — verify `grep -F -c 'function BubbleView({' src/screens/LifeScreen/DialogueArea.tsx` prints 1) **to the end of the file**, and append this complete replacement block:

```tsx
function BubbleView({
  bubble,
  viewMode,
  characterName,
  practiceLanguage,
  userAvatarUrl,
  hideNative,
  npcAvatarUrl,
  isCurrent,
  onAvatarTap,
}: {
  bubble: Bubble;
  viewMode: ZViewModeT;
  characterName: string;
  practiceLanguage?: string;
  userAvatarUrl: string | null;
  hideNative: boolean;
  npcAvatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: Props['onAvatarTap'];
}) {
  if (bubble.speaker === 'narrator')
    return <SystemCueView bubble={bubble} viewMode={viewMode} isCurrent={isCurrent} />;
  if (bubble.speaker === 'user')
    return (
      <UserBubbleView
        bubble={bubble}
        viewMode={viewMode}
        characterName={characterName}
        practiceLanguage={practiceLanguage}
        avatarUrl={userAvatarUrl}
        isCurrent={isCurrent}
        onAvatarTap={
          onAvatarTap
            ? () => onAvatarTap({ kind: 'user', npcId: null, name: characterName })
            : undefined
        }
      />
    );
  return (
    <NpcBubbleView
      bubble={bubble}
      viewMode={viewMode}
      practiceLanguage={practiceLanguage}
      hideNative={hideNative}
      avatarUrl={npcAvatarUrl}
      isCurrent={isCurrent}
      onAvatarTap={
        onAvatarTap
          ? () =>
              onAvatarTap({
                kind: 'npc',
                npcId: bubble.npcId ?? null,
                name: bubble.speakerName ?? '?',
              })
          : undefined
      }
    />
  );
}

/** LIFE-LANG-3/4: resolve which lines a bubble shows for the active
 *  view mode. `gated` = this bubble is the source of the active
 *  comprehension question (LIFE-LANG-4: the gate OUTRANKS viewMode —
 *  showing the gloss would BE the answer, so the bubble renders
 *  practiceText with the native line behind an explicit reveal).
 *  Bubbles with no nativeText fall back to practiceText in
 *  native-only mode so no bubble ever renders empty (LIFE-WIP-2). */
function bubbleTexts(
  bubble: Bubble,
  viewMode: ZViewModeT,
  gated: boolean,
  revealed: boolean,
): { primary: string; secondary: string | null } {
  const native =
    bubble.nativeText && bubble.nativeText.trim() ? bubble.nativeText : null;
  if (gated) {
    return { primary: bubble.practiceText, secondary: revealed ? native : null };
  }
  if (viewMode === 'native-only') {
    return { primary: native ?? bubble.practiceText, secondary: null };
  }
  if (viewMode === 'hidden') {
    return { primary: bubble.practiceText, secondary: null };
  }
  return { primary: bubble.practiceText, secondary: native };
}

/** Narrator beats — centered, greyed, no avatar. Scene context,
 *  arrival cues, mood-setting. */
function SystemCueView({
  bubble,
  viewMode,
  isCurrent,
}: {
  bubble: Bubble;
  viewMode: ZViewModeT;
  isCurrent: boolean;
}) {
  const { primary, secondary } = bubbleTexts(bubble, viewMode, false, false);
  return (
    <div
      className="pointer-events-auto max-w-md mx-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-300"
      data-testid="LifeScreen-Bubble-narrator"
      data-current={isCurrent ? 'true' : undefined}
    >
      <div
        className={cn(
          'mx-auto px-4 py-2 rounded-xl text-center',
          'text-[13px] leading-snug text-(--color-fg-muted) italic',
          isCurrent
            ? 'life-bubble-current-narrator'
            : 'bg-(--color-bg-hover)/70 border border-(--color-border)/40',
        )}
      >
        <div dir={dirOf(primary)}>{primary}</div>
        {secondary && (
          <div dir={dirOf(secondary)} className="text-[12px] text-(--color-fg-muted)/80 mt-0.5 not-italic">
            {secondary}
          </div>
        )}
      </div>
    </div>
  );
}

/** NPC beats — left-aligned bubble with avatar + name. The native
 *  gloss is force-hidden (tap-to-reveal) when this bubble is the
 *  source of an active comprehension question — that gate outranks
 *  the view mode (LIFE-LANG-4). */
function NpcBubbleView({
  bubble,
  viewMode,
  practiceLanguage,
  hideNative,
  avatarUrl,
  isCurrent,
  onAvatarTap,
}: {
  bubble: Bubble;
  viewMode: ZViewModeT;
  practiceLanguage?: string;
  hideNative: boolean;
  avatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: () => void;
}) {
  const t = useT();
  const name = bubble.speakerName ?? '?';
  const [revealed, setRevealed] = useState(false);
  const { primary, secondary } = bubbleTexts(bubble, viewMode, hideNative, revealed);
  const showReveal = hideNative && !revealed && !!bubble.nativeText;
  return (
    <div
      className="pointer-events-auto max-w-md mx-auto w-full flex items-end gap-2 animate-in fade-in slide-in-from-bottom-2 duration-300"
      data-testid="LifeScreen-Bubble-npc"
      data-current={isCurrent ? 'true' : undefined}
    >
      <Avatar name={name} svgUrl={avatarUrl} onTap={onAvatarTap} />
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 px-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-(--color-fg-muted)">
            {name}
          </div>
          {/* TTS-SURFACE-4: hear the NPC speak the practice language.
              Always speaks practiceText regardless of viewMode
              (LIFE-LANG-3 exclusion). */}
          <TTSButton
            text={bubble.practiceText}
            language={practiceLanguage}
            playbackKey={`life-npc-${bubble.id}`}
            size={22}
          />
        </div>
        <div
          className={cn(
            'px-4 py-3 rounded-2xl rounded-bl-md shadow-sm text-(--color-fg) max-w-full',
            isCurrent
              ? 'life-bubble-current-npc'
              : 'bg-(--color-bg-elevated) border border-(--color-border)',
          )}
        >
          <div dir={dirOf(primary)} className="text-[15px] leading-snug">{primary}</div>
          {secondary && (
            <div dir={dirOf(secondary)} className="text-[13px] leading-snug mt-1 text-(--color-fg-muted)">
              {secondary}
            </div>
          )}
          {showReveal && (
            <button
              type="button"
              data-testid="LifeScreen-RevealTranslation"
              onClick={() => setRevealed(true)}
              className="mt-2 inline-flex items-center gap-1 text-[12px] text-(--color-fg-muted) underline underline-offset-2 hover:text-(--color-fg)"
            >
              {t('life.reveal.translation')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** User beats — right-aligned bubble with user avatar on the
 *  right. */
function UserBubbleView({
  bubble,
  viewMode,
  characterName,
  practiceLanguage,
  avatarUrl,
  isCurrent,
  onAvatarTap,
}: {
  bubble: Bubble;
  viewMode: ZViewModeT;
  characterName: string;
  practiceLanguage?: string;
  avatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: () => void;
}) {
  const { primary, secondary } = bubbleTexts(bubble, viewMode, false, false);
  return (
    <div
      className="pointer-events-auto max-w-md mx-auto w-full flex items-end gap-2 justify-end animate-in fade-in slide-in-from-bottom-2 duration-300"
      data-testid="LifeScreen-Bubble-user"
      data-current={isCurrent ? 'true' : undefined}
    >
      <div className="flex flex-col gap-1 min-w-0 items-end">
        {/* TTS-SURFACE-4: hear your own line read back, not while it's
            still the optimistic pending bubble. Always speaks
            practiceText regardless of viewMode (LIFE-LANG-3). */}
        {!bubble.pending && (
          <TTSButton
            text={bubble.practiceText}
            language={practiceLanguage}
            playbackKey={`life-user-${bubble.id}`}
            size={22}
          />
        )}
        <div
          className={cn(
            'px-4 py-3 rounded-2xl rounded-br-md shadow-sm bg-gradient-accent text-white max-w-full',
            isCurrent && 'life-bubble-current-user',
          )}
        >
          <div dir={dirOf(primary)} className="text-[15px] leading-snug">{primary}</div>
          {secondary && (
            <div dir={dirOf(secondary)} className="text-[13px] leading-snug mt-1 text-white/80">
              {secondary}
            </div>
          )}
          {bubble.pending && (
            <div className="mt-2 flex items-center gap-1" aria-label="thinking">
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse [animation-delay:0ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-white/70 animate-pulse [animation-delay:300ms]" />
            </div>
          )}
        </div>
      </div>
      <Avatar name={characterName} svgUrl={avatarUrl} onTap={onAvatarTap} />
    </div>
  );
}
```

### Edit 8 — `src/screens/LifeScreen/LifeScreenHeader.tsx` — FULL FILE REPLACEMENT

Replace the entire file with:

```tsx
/**
 * LIFE-UI-* / LIFE-LANG-3: the top header bar on /life.
 *
 * Back button, world title (the saga title — falls back to character
 * name until saga lands), optional streak badge, the 3-way language
 * view-mode cycle button, and the 3-dot menu. Pulled out of
 * LifeScreen.tsx so that file stays under the 600-LOC cap.
 */
import { useAppBack } from '@/hooks/useAppBack';
import { ArrowLeft, Eye, EyeOff, Flame, Languages } from 'lucide-react';
import { useT } from '@/i18n';
import type { ZViewModeT } from '@/types/firestore';
import { LifeScreenMenu } from './LifeScreenMenu';

/** LIFE-LANG-3: cycle order — visible → native-only → hidden → visible. */
const NEXT_VIEW_MODE: Record<ZViewModeT, ZViewModeT> = {
  visible: 'native-only',
  'native-only': 'hidden',
  hidden: 'visible',
};

/** Icon shows the CURRENT mode (plan-pinned mapping):
 *  visible = Eye, native-only = EyeOff, hidden = Languages. */
const VIEW_MODE_ICON: Record<ZViewModeT, typeof Eye> = {
  visible: Eye,
  'native-only': EyeOff,
  hidden: Languages,
};

const VIEW_MODE_LABEL_KEY = {
  visible: 'life.viewMode.both',
  'native-only': 'life.viewMode.nativeOnly',
  hidden: 'life.viewMode.practiceOnly',
} as const;

export type LifeScreenHeaderProps = {
  uid: string;
  worldId: string;
  title: string;
  sessionDayCount: number | null | undefined;
  /** LIFE-LANG-3: the wurld's current language display mode. */
  viewMode: ZViewModeT;
  /** LIFE-LANG-3: fired with the NEXT mode when the cycle button is
   *  tapped. LifeScreen persists it via updateLifeWorld. */
  onSetViewMode: (mode: ZViewModeT) => void;
  onExit: () => void;
  onDeleted: () => void;
  onError: (msg: string) => void;
};

export function LifeScreenHeader({
  uid,
  worldId,
  title,
  sessionDayCount,
  viewMode,
  onSetViewMode,
  onExit,
  onDeleted,
  onError,
}: LifeScreenHeaderProps) {
  const t = useT();
  const back = useAppBack();
  const ViewModeIcon = VIEW_MODE_ICON[viewMode];
  const modeTitle = `${t('life.viewMode.label')}: ${t(VIEW_MODE_LABEL_KEY[viewMode])}`;
  return (
    <header className="flex items-center justify-between px-3 pt-safe-top pb-2 bg-(--color-bg)">
      <button
        type="button"
        onClick={back}
        aria-label={t('common.back')}
        className="p-1.5 -ml-1 text-(--color-fg)"
      >
        <ArrowLeft size={20} />
      </button>
      <div className="flex items-center gap-2">
        <h1 className="text-sm font-semibold truncate max-w-[60vw]">{title}</h1>
      </div>
      <div className="flex items-center gap-1">
        {sessionDayCount && sessionDayCount > 0 ? (
          <span
            data-testid="LifeScreen-StreakBadge"
            title={t('life.streak.title', { count: sessionDayCount })}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold text-amber-600 bg-amber-100"
          >
            <Flame size={14} />
            {sessionDayCount}
          </span>
        ) : null}
        {/* LIFE-LANG-3: 3-way language display cycle, left of the
            3-dot menu. */}
        <button
          type="button"
          onClick={() => onSetViewMode(NEXT_VIEW_MODE[viewMode])}
          data-testid="LifeScreen-ViewMode"
          data-mode={viewMode}
          aria-label={modeTitle}
          title={modeTitle}
          className="p-1.5 text-(--color-fg-muted) hover:text-(--color-fg)"
        >
          <ViewModeIcon size={18} />
        </button>
        <LifeScreenMenu
          uid={uid}
          worldId={worldId}
          onExit={onExit}
          onDeleted={onDeleted}
          onError={onError}
        />
      </div>
    </header>
  );
}
```

### Edit 9 — `src/screens/LifeScreen/PracticeFeedback.tsx` (2 sub-edits)

**9a — Why button testid.** ANCHOR (verify unique):

```tsx
              onClick={onExplain}
```

Replace with:

```tsx
              onClick={onExplain}
              data-testid="LifeScreen-PracticeFeedback-Why"
```

**9b — dangling separator on gloss-free picks.** Fill-blank picks now always carry `nativeText: ''` (LIFE-LANG-1), which the current markup renders as a dangling `· `. ANCHOR (verify unique — the whole block; `{t('life.feedback.youPicked')}` occurs once):

```tsx
            <span dir={dirOf(picked.practiceText)} className="font-medium text-(--color-fg)">
              {picked.practiceText}
            </span>
            <span dir={dirOf(picked.nativeText)} className="text-(--color-fg-muted)"> · {picked.nativeText}</span>
```

Replace with:

```tsx
            <span dir={dirOf(picked.practiceText)} className="font-medium text-(--color-fg)">
              {picked.practiceText}
            </span>
            {picked.nativeText.trim() && (
              <span dir={dirOf(picked.nativeText)} className="text-(--color-fg-muted)"> · {picked.nativeText}</span>
            )}
```

### Edit 10 — `src/screens/LifeScreen/LifeScreenBottom.tsx` — FULL FILE REPLACEMENT

Replace the entire file with:

```tsx
/**
 * LifeScreen's bottom render area — the conditional that toggles
 * between the feedback overlay, the thinking-bar, and the chip grid
 * + free-text composer. Extracted so the LifeScreen container stays
 * focused on state orchestration.
 *
 * LIFE-LANG-1/2/3: this component derives the single chip display
 * language — graded turns pin it per kind (comprehension → 'native',
 * fill-blank → 'practice'); CYOA turns follow the wurld's viewMode.
 * LIFE-LANG-5: forwards onExplain to the feedback overlay's Why?.
 */
import { useT } from '@/i18n';
import type { ZViewModeT } from '@/types/firestore';
import { ActionBar, type ChipDisplay, type FlashcardMatch } from './ActionBar';
import { PracticePromptCard } from './PracticePromptCard';
import { PracticeFeedback } from './PracticeFeedback';
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';

type FeedbackState = {
  correct: boolean;
  picked: { practiceText: string; nativeText: string };
  correctAnswer: { practiceText: string; nativeText: string };
};

export type LifeScreenBottomProps = {
  feedback: FeedbackState | null;
  busy: boolean;
  graded: boolean;
  practicePrompt: PracticePrompt | null;
  choices: StepChoice[];
  flashcardLookup: ReadonlyMap<string, FlashcardMatch>;
  /** LIFE-LANG-3: the wurld's language display mode — CYOA chips
   *  obey it; graded turns override it per kind (LIFE-LANG-1). */
  viewMode: ZViewModeT;
  onPick: (choiceId: string) => void;
  onFreeText: (text: string) => void;
  onFeedbackContinue: () => void;
  /** LIFE-LANG-5: opens the ExplainModal for the current feedback. */
  onExplain: () => void;
};

/** LIFE-LANG-1/3: exactly one display rule per turn. Exported for
 *  unit tests. */
export function chipDisplayFor(
  graded: boolean,
  practicePrompt: PracticePrompt | null,
  viewMode: ZViewModeT,
): ChipDisplay {
  if (graded) {
    return practicePrompt?.kind === 'comprehension' ? 'native' : 'practice';
  }
  if (viewMode === 'native-only') return 'native';
  if (viewMode === 'hidden') return 'practice';
  return 'both';
}

export function LifeScreenBottom({
  feedback,
  busy,
  graded,
  practicePrompt,
  choices,
  flashcardLookup,
  viewMode,
  onPick,
  onFreeText,
  onFeedbackContinue,
  onExplain,
}: LifeScreenBottomProps) {
  const t = useT();
  if (feedback) {
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
  if (busy) {
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
  return (
    <>
      {practicePrompt && (
        <div className="px-3 pt-2 bg-(--color-bg)">
          <PracticePromptCard prompt={practicePrompt} />
        </div>
      )}
      <ActionBar
        choices={choices}
        onPick={onPick}
        onFreeText={!graded ? onFreeText : undefined}
        disabled={busy || choices.length === 0}
        flashcardLookup={flashcardLookup}
        chipDisplay={chipDisplayFor(graded, practicePrompt, viewMode)}
      />
    </>
  );
}
```

### Edit 11 — NEW FILE `src/screens/LifeScreen/lifeScreenState.ts` (complete contents)

This is the designed extraction that keeps `LifeScreen.tsx` under the 600-LOC cap (Contradiction 4). The `FeedbackState` here is the ORIGINAL type from LifeScreen.tsx plus the two new LIFE-LANG-5 fields.

```ts
/**
 * LifeScreen's local turn-state types + initial value. Extracted
 * verbatim from LifeScreen.tsx (Wurlds-v2 Phase D) so the container
 * stays under the 600-LOC cap; no behaviour lives here.
 */
import type { Bubble } from './DialogueArea';
import type {
  PracticePrompt,
  SceneIntent,
  StepChoice,
} from '@/lib/life/stepSchema';
import type { CampaignCompletionSnapshot } from '@/lib/life/campaignLifecycle';
import type { WorldArc } from '@/types/firestore';

/** Feedback state shown after a graded chip pick, before the player
 *  taps Continue to advance. */
export type FeedbackState = {
  correct: boolean;
  picked: StepChoice;
  correctAnswer: StepChoice;
  /** Captured so the next lifeStep call gets it in practiceOutcome
   *  — the practicePrompt itself is cleared once feedback is shown
   *  so the prompt card doesn't double-render. */
  outcomeKind: 'fill-blank' | 'comprehension';
  promptSource: string;
  /** Only set on comprehension. The NPC whose verbatim line becomes
   *  a bubble once the player taps Continue. */
  speakerName?: string | null;
  npcId?: string | null;
  /** LIFE-LANG-5: the full graded prompt + chip set captured at pick
   *  time — the live chip list clears when feedback shows, but the
   *  Why? ExplainModal needs both to rebuild the question. */
  prompt: PracticePrompt;
  allChoices: StepChoice[];
};

export type LocalState = {
  /** What the user sees as bubbles. Capped at 2 by DialogueArea. */
  bubbles: Bubble[];
  /** Chips below. Empty while a step is in-flight OR while feedback
   *  is showing. */
  choices: StepChoice[];
  /** Most recent sceneIntent the model emitted; drives the
   *  SceneStage descriptor. */
  sceneIntent: SceneIntent | null;
  /** Last response's `graded` flag. */
  graded: boolean;
  /** Set when graded === true; cleared once feedback is shown. */
  practicePrompt: PracticePrompt | null;
  /** When set, replaces the chip grid + practice prompt with the
   *  feedback overlay until the player taps Continue. */
  feedback: FeedbackState | null;
  /** lifeStep is currently fetching the next turn. */
  busy: boolean;
  /** IDs of bubbles that belong to the current turn — bubbles
   *  accumulated since the player's most recent action. Used by
   *  DialogueArea to paint a gradient border on the live exchange
   *  while previous turns render flat. Cleared at the START of any
   *  player action (chip pick, free-text submit, Continue) and
   *  re-populated as the response + post-Continue bubbles land. */
  currentTurnIds: ReadonlySet<string>;
  /** LIFE-CAMPAIGN-3: when the latest lifeStep response carried a
   *  campaignHook, this stores the hook details — picking the matching
   *  chip routes to runCampaignGenerate instead of the normal next
   *  lifeStep. Cleared on any chip pick or next response. */
  pendingHook: {
    hookId: string;
    pitch: string;
    acceptChipId: string;
  } | null;
  /** LIFE-CAMPAIGN-10: when the latest lifeStep response signalled
   *  resolution, this stores the snapshot the CampaignCompleteScreen
   *  reads. Setting this overlays the screen + blocks further
   *  lifeStep calls until the player taps "Return home". */
  completedCampaign: CampaignCompletionSnapshot | null;
  /** LIFE-WORLD-ARC-*: when the just-resolved campaign also concluded
   *  the active worldArc (snapshot.arcStage === 'concluding'), this
   *  holds the archived arc + the campaign snapshot so the
   *  WorldArcCompleteScreen can render after the
   *  CampaignCompleteScreen dismisses. */
  arcComplete: {
    arc: WorldArc;
    snapshot: CampaignCompletionSnapshot;
  } | null;
};

export const INITIAL_STATE: LocalState = {
  bubbles: [],
  choices: [],
  sceneIntent: null,
  graded: false,
  practicePrompt: null,
  feedback: null,
  busy: false,
  currentTurnIds: new Set(),
  pendingHook: null,
  completedCampaign: null,
  arcComplete: null,
};
```

### Edit 12 — `src/screens/LifeScreen/LifeScreen.tsx` (12 sub-edits, 12a–12l — 12j has two anchors; POST-PHASE-C ANCHORS — Phase C touches this file's opening-effect + intro-overlay regions; every anchor below sits outside them)

**12a — react import.** ANCHOR (verify unique):

```ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

Replace with:

```ts
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
```

**12b — world helpers import.** ANCHOR (verify unique):

```ts
import { appendBeatEvent, appendLifeEvent } from '@/lib/life/world';
```

Replace with:

```ts
import { appendBeatEvent, appendLifeEvent, updateLifeWorld } from '@/lib/life/world';
```

**12c — stepSchema type import** (SceneIntent + PracticePrompt move into lifeScreenState.ts and become unused here). ANCHOR (verify unique — the whole import statement):

```ts
import type {
  PracticePrompt,
  SceneIntent,
  StepChoice,
  StepResponse,
} from '@/lib/life/stepSchema';
```

Replace with:

```ts
import type { StepChoice, StepResponse } from '@/lib/life/stepSchema';
```

**12d — campaignLifecycle import** (the type moves to lifeScreenState.ts). ANCHOR (verify unique — the whole import statement):

```ts
import {
  acceptCampaignHook,
  computeReplanPlan,
  fireBackgroundCampaignPatch,
  resolveRecurringNames,
  snapshotCampaignCompletion,
  type CampaignCompletionSnapshot,
} from '@/lib/life/campaignLifecycle';
```

Replace with:

```ts
import {
  acceptCampaignHook,
  computeReplanPlan,
  fireBackgroundCampaignPatch,
  resolveRecurringNames,
  snapshotCampaignCompletion,
} from '@/lib/life/campaignLifecycle';
```

**12e — firestore types import** (WorldArc moves to lifeScreenState.ts; ZViewModeT is new). ANCHOR (verify unique):

```ts
import type { LifeNpc, WorldArc } from '@/types/firestore';
```

Replace with:

```ts
import type { LifeNpc, ZViewModeT } from '@/types/firestore';
```

**12f — new imports + lazy modal.** ANCHOR (verify unique):

```ts
import { LifeScreenHeader } from './LifeScreenHeader';
```

Replace with:

```ts
import { LifeScreenHeader } from './LifeScreenHeader';
import { buildLifeExplainQuestion, lifeChoiceLabel } from './buildLifeExplainQuestion';
import { INITIAL_STATE, type LocalState } from './lifeScreenState';

// LIFE-LANG-5: route-level code-split so /life doesn't pull the
// ExplainModal bundle on cold boot. Same pattern PracticeScreen uses.
const ExplainModal = lazy(() =>
  import('@/components/ExplainModal/ExplainModal').then((m) => ({ default: m.ExplainModal })),
);
```

**12g — delete the extracted state block.** Delete everything between the line

```ts
/** Feedback state shown after a graded chip pick, before the player
```

and the line

```ts
export function LifeScreen() {
```

(exclusive of the `export function LifeScreen() {` line itself — i.e. remove the `FeedbackState` type, the `LocalState` type, and the `INITIAL_STATE` const, all of which now live in `lifeScreenState.ts`). Verify before deleting: `grep -F -c '/** Feedback state shown after a graded chip pick, before the player' src/screens/LifeScreen/LifeScreen.tsx` prints 1, and the deleted region must contain `const INITIAL_STATE: LocalState = {` (grep count 1). Leave exactly one blank line between the `ExplainModal` lazy const block and `export function LifeScreen() {`.

**12h — explainOpen state.** ANCHOR (verify unique):

```ts
  const [avatarModal, setAvatarModal] = useState<AvatarModalSubject | null>(null);
```

Replace with:

```ts
  const [avatarModal, setAvatarModal] = useState<AvatarModalSubject | null>(null);
  /** LIFE-LANG-5: whether the Why? ExplainModal is open for the
   *  current feedback. Reset on every new graded pick. */
  const [explainOpen, setExplainOpen] = useState(false);
```

**12i — graded pick captures prompt + chips.** ANCHOR (verify unique — the whole block; the line `outcomeKind: prompt.kind,` occurs once):

```ts
      const npcId =
        prompt.kind === 'comprehension' ? prompt.npcId ?? null : null;
      setState((prev) => ({
        ...prev,
        feedback: {
          correct,
          picked: choice,
          correctAnswer: correctChip,
          outcomeKind: prompt.kind,
          promptSource,
          speakerName,
          npcId,
        },
        // Clear chips during feedback so user can't double-tap.
        choices: [],
      }));
```

Replace with:

```ts
      const npcId =
        prompt.kind === 'comprehension' ? prompt.npcId ?? null : null;
      setExplainOpen(false);
      setState((prev) => ({
        ...prev,
        feedback: {
          correct,
          picked: choice,
          correctAnswer: correctChip,
          outcomeKind: prompt.kind,
          promptSource,
          speakerName,
          npcId,
          // LIFE-LANG-5: full prompt + chip set captured at pick time —
          // the chips clear below, but the Why? ExplainModal needs them.
          prompt,
          allChoices: prev.choices,
        },
        // Clear chips during feedback so user can't double-tap.
        choices: [],
      }));
```

**12j — viewMode write handler + header props.** ANCHOR (verify unique):

```ts
  const onWorldDeleted = () => navigate('/life/overview', { replace: true });
```

Replace with:

```ts
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
  const onWorldDeleted = () => navigate('/life/overview', { replace: true });
```

Then, ANCHOR (verify unique):

```tsx
        sessionDayCount={worldData.sessionDayCount}
```

Replace with:

```tsx
        sessionDayCount={worldData.sessionDayCount}
        viewMode={worldData.viewMode ?? 'visible'}
        onSetViewMode={onSetViewMode}
```

**12k — DialogueArea viewMode.** ANCHOR (verify unique):

```tsx
          bubbles={state.bubbles}
```

Replace with:

```tsx
          bubbles={state.bubbles}
          viewMode={worldData.viewMode ?? 'visible'}
```

**12l — LifeScreenBottom props + ExplainModal mount.** ANCHOR (verify unique — the whole closing block; the line `flashcardLookup={flashcardLookup}` occurs once):

```tsx
        flashcardLookup={flashcardLookup}
        onPick={onPick}
        onFreeText={(text) => void runStep({ freeText: text })}
        onFeedbackContinue={onFeedbackContinue}
      />
    </div>
  );
}
```

Replace with:

```tsx
        flashcardLookup={flashcardLookup}
        viewMode={worldData.viewMode ?? 'visible'}
        onPick={onPick}
        onFreeText={(text) => void runStep({ freeText: text })}
        onFeedbackContinue={onFeedbackContinue}
        onExplain={() => setExplainOpen(true)}
      />

      {/* LIFE-LANG-5: Why? explain — practice-mode ExplainModal fed by
          the captured graded prompt + chips. Options + answers are in
          the language the chips were RENDERED in (comprehension →
          native, fill-blank → practice). */}
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
    </div>
  );
}
```

---

## Tests

All descriptions follow `<INVARIANT-ID> — <one-liner>`. Write these BEFORE the implementation edits; they must fail (missing module / missing prop / missing SI string) first.

### T1 — NEW `src/lib/life/prompts/gradedQuestion.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { gradedQuestionSystemInstruction } from './gradedQuestion';

const si = gradedQuestionSystemInstruction({
  practiceLanguage: 'French',
  nativeLanguage: 'English',
});

describe('gradedQuestion SI — one-language contract (LIFE-LANG-1/2)', () => {
  it('LIFE-LANG-1 — the liberal LANGUAGE PLACEMENT block is gone', () => {
    expect(si).not.toContain('LANGUAGE PLACEMENT');
    expect(si).not.toContain('pedagogical judgment');
    expect(si).not.toContain('YOU decide');
  });

  it('LIFE-LANG-1 — strict LANGUAGE RULES block is present and parameterised', () => {
    expect(si).toContain('LANGUAGE RULES (strict');
    expect(si).toContain('Practice language: French. Native language: English.');
    expect(si).toContain('nativeText = "" on EVERY chip');
    expect(si).toContain('REQUIRED non-empty on EVERY chip');
  });

  it('LIFE-LANG-1 — OUTPUT SHAPE example shows empty fill-blank glosses', () => {
    expect(si).toContain('{ "id": "c1", "practiceText": "voudrais", "nativeText": "", "correctness": "correct" }');
  });

  it('LIFE-LANG-2 — comprehension question is stated as REQUIRED and native-language', () => {
    expect(si).toContain('practicePrompt.question = a short English question');
    expect(si).toContain('REQUIRED, never empty');
  });
});
```

### T2 — NEW `src/lib/life/runGradedQuestionGenerate.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({
  generateGemini: vi.fn(),
}));

vi.mock('./debugLog', () => ({
  lifeDebug: vi.fn(),
  lifeFailed: vi.fn(),
}));

import { generateGemini } from '../gemini';
import { runGradedQuestionGenerate } from './runGradedQuestionGenerate';
import type { GradedPlan } from './stepSchema';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;

const fillBlankPlan: GradedPlan = {
  kind: 'fill-blank',
  testTarget: 'voudrais',
  sentenceContext: 'Je voudrais un café',
};

const comprehensionPlan: GradedPlan = {
  kind: 'comprehension',
  npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
  speakerName: 'Sophie',
};

const cleanFillBlank = {
  practicePrompt: {
    kind: 'fill-blank',
    practiceText: 'Je ___ un café',
    nativeText: 'I ___ a coffee',
  },
  choices: [
    { id: 'c1', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
    { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
    { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong' },
  ],
};

const cleanComprehension = {
  practicePrompt: {
    kind: 'comprehension',
    npcUtterance: 'Est-ce que tu connais un bon café près du bureau ?',
    question: 'What is Sophie asking?',
    speakerName: 'Sophie',
    npcId: null,
  },
  choices: [
    { id: 'c1', practiceText: 'Elle cherche un endroit sympa', nativeText: "She's asking about a nice café nearby", correctness: 'correct' },
    { id: 'c2', practiceText: 'Elle cherche le chemin', nativeText: "She's asking for directions to the office", correctness: 'wrong' },
    { id: 'c3', practiceText: 'Elle propose une pause', nativeText: "She's offering to grab a coffee for you", correctness: 'wrong' },
  ],
};

function baseInput(plan: GradedPlan) {
  return {
    plan,
    practiceLanguage: 'French',
    nativeLanguage: 'English',
    recentTargets: [] as string[],
  };
}

beforeEach(() => {
  generateGeminiMock.mockReset();
});

describe('leakViolations hard language checks (LIFE-LANG-1/2)', () => {
  it('LIFE-LANG-1 — clean fill-blank passes on the first attempt', async () => {
    generateGeminiMock.mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(fillBlankPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-LANG-1 — fill-blank chip with a native gloss is rejected and retried with the hint', async () => {
    const dirty = {
      ...cleanFillBlank,
      choices: [
        { id: 'c1', practiceText: 'voudrais', nativeText: 'would like', correctness: 'correct' },
        { id: 'c2', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
        { id: 'c3', practiceText: 'voulais', nativeText: '', correctness: 'wrong' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanFillBlank));
    const r = await runGradedQuestionGenerate(baseInput(fillBlankPlan));
    expect(r.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(2);
    const secondPrompt = (generateGeminiMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('nativeText: ""');
  });

  it('LIFE-LANG-1 — comprehension chip with empty nativeText fails after two attempts', async () => {
    const dirty = {
      ...cleanComprehension,
      choices: [
        { id: 'c1', practiceText: 'Elle cherche un endroit sympa', nativeText: '', correctness: 'correct' },
        { id: 'c2', practiceText: 'Elle cherche le chemin', nativeText: "She's asking for directions to the office", correctness: 'wrong' },
        { id: 'c3', practiceText: 'Elle propose une pause', nativeText: "She's offering to grab a coffee for you", correctness: 'wrong' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(dirty));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r).toEqual({ kind: 'failed', reason: 'exhausted-retries' });
    const secondPrompt = (generateGeminiMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('empty nativeText');
  });

  it('LIFE-LANG-1 — duplicate comprehension nativeText is a violation', async () => {
    const dirty = {
      ...cleanComprehension,
      choices: [
        { id: 'c1', practiceText: 'Elle cherche un endroit sympa', nativeText: "She's asking about a café", correctness: 'correct' },
        { id: 'c2', practiceText: 'Elle cherche le chemin', nativeText: "she's asking about a café", correctness: 'wrong' },
        { id: 'c3', practiceText: 'Elle propose une pause', nativeText: "She's offering coffee", correctness: 'wrong' },
      ],
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r.kind).toBe('ok');
    const secondPrompt = (generateGeminiMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('share the same nativeText');
  });

  it('LIFE-LANG-2 — comprehension with an empty question is a violation', async () => {
    const dirty = {
      ...cleanComprehension,
      practicePrompt: { ...cleanComprehension.practicePrompt, question: '' },
    };
    generateGeminiMock
      .mockResolvedValueOnce(JSON.stringify(dirty))
      .mockResolvedValueOnce(JSON.stringify(cleanComprehension));
    const r = await runGradedQuestionGenerate(baseInput(comprehensionPlan));
    expect(r.kind).toBe('ok');
    const secondPrompt = (generateGeminiMock.mock.calls[1][0] as { prompt: string }).prompt;
    expect(secondPrompt).toContain('practicePrompt.question is empty');
  });
});
```

### T3 — NEW `src/screens/LifeScreen/buildLifeExplainQuestion.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { buildLifeExplainQuestion, lifeChoiceLabel } from './buildLifeExplainQuestion';
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';

const comprehensionPrompt: PracticePrompt = {
  kind: 'comprehension',
  npcUtterance: 'Est-ce que tu connais un bon café ?',
  question: 'What is Sophie asking?',
  speakerName: 'Sophie',
  npcId: 'sophie',
};

const comprehensionChoices: StepChoice[] = [
  { id: 'a', practiceText: 'Elle cherche un café', nativeText: "She's asking about a café", correctness: 'correct' },
  { id: 'b', practiceText: 'Elle cherche le bureau', nativeText: "She's asking about the office", correctness: 'wrong' },
];

const fillBlankPrompt: PracticePrompt = {
  kind: 'fill-blank',
  practiceText: 'Je ___ un café',
  nativeText: 'I ___ a coffee',
};

const fillBlankChoices: StepChoice[] = [
  { id: 'a', practiceText: 'voudrais', nativeText: '', correctness: 'correct' },
  { id: 'b', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
];

describe('buildLifeExplainQuestion (LIFE-LANG-5)', () => {
  it('LIFE-LANG-5 — comprehension maps to multiple-choice with native options', () => {
    const q = buildLifeExplainQuestion(comprehensionPrompt, comprehensionChoices, 'native');
    expect(q.questionType).toBe('multiple-choice');
    expect(q.instruction).toBe('What is Sophie asking?');
    expect(q.practiceText).toBe('Est-ce que tu connais un bon café ?');
    expect(q.options).toEqual(["She's asking about a café", "She's asking about the office"]);
    expect(q.correctAnswer).toBe("She's asking about a café");
  });

  it('LIFE-LANG-5 — fill-blank maps to multiple-choice with practice options', () => {
    const q = buildLifeExplainQuestion(fillBlankPrompt, fillBlankChoices, 'practice');
    expect(q.instruction).toBe('Complete the sentence.');
    expect(q.practiceText).toBe('Je ___ un café');
    expect(q.options).toEqual(['voudrais', 'veux']);
    expect(q.correctAnswer).toBe('voudrais');
  });

  it('LIFE-LANG-5 — empty comprehension question falls back to a speaker-named cue', () => {
    const q = buildLifeExplainQuestion(
      { ...comprehensionPrompt, question: '' },
      comprehensionChoices,
      'native',
    );
    expect(q.instruction).toBe('What is Sophie saying?');
    const q2 = buildLifeExplainQuestion(
      { ...comprehensionPrompt, question: '', speakerName: null },
      comprehensionChoices,
      'native',
    );
    expect(q2.instruction).toBe('What did they just say?');
  });

  it('LIFE-LANG-5 — lifeChoiceLabel falls back to practiceText when the native label is empty', () => {
    expect(lifeChoiceLabel({ practiceText: 'voudrais', nativeText: '' }, 'native')).toBe('voudrais');
    expect(lifeChoiceLabel({ practiceText: 'voudrais', nativeText: 'would like' }, 'native')).toBe('would like');
    expect(lifeChoiceLabel({ practiceText: 'voudrais', nativeText: 'would like' }, 'practice')).toBe('voudrais');
  });
});
```

### T4 — NEW `src/screens/LifeScreen/ActionBar.test.tsx`

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActionBar, type ChipDisplay } from './ActionBar';

const choices = [
  { id: 'c1', practiceText: 'Elle cherche un café', nativeText: "She's asking about a café" },
  { id: 'c2', practiceText: 'voudrais', nativeText: '' },
];

function renderBar(chipDisplay?: ChipDisplay) {
  return render(
    <ActionBar choices={choices} onPick={vi.fn()} chipDisplay={chipDisplay} />,
  );
}

describe('ActionBar chipDisplay (LIFE-LANG-1/3)', () => {
  it('LIFE-LANG-3 — default/both shows practice main + native sub', () => {
    renderBar();
    const chip = screen.getByTestId('LifeScreen-Choice-c1');
    expect(chip).toHaveTextContent('Elle cherche un café');
    expect(chip).toHaveTextContent("She's asking about a café");
  });

  it("LIFE-LANG-1 — 'native' renders ONLY the native label", () => {
    renderBar('native');
    const chip = screen.getByTestId('LifeScreen-Choice-c1');
    expect(chip).toHaveTextContent("She's asking about a café");
    expect(chip).not.toHaveTextContent('Elle cherche un café');
  });

  it("LIFE-LANG-3 — 'native' falls back to practiceText when nativeText is empty", () => {
    renderBar('native');
    expect(screen.getByTestId('LifeScreen-Choice-c2')).toHaveTextContent('voudrais');
  });

  it("LIFE-LANG-1 — 'practice' renders ONLY the practice label (no gloss even when present)", () => {
    renderBar('practice');
    const chip = screen.getByTestId('LifeScreen-Choice-c1');
    expect(chip).toHaveTextContent('Elle cherche un café');
    expect(chip).not.toHaveTextContent("She's asking about a café");
  });
});
```

### T5 — NEW `src/screens/LifeScreen/DialogueArea.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ZViewModeT } from '@/types/firestore';

// TTSButton transitively imports the Firebase-backed tts lib — stub it
// so this component test stays hermetic.
vi.mock('@/components/TTSButton', () => ({
  TTSButton: () => null,
}));

import { DialogueArea, type Bubble } from './DialogueArea';

const npcBubble: Bubble = {
  id: 'b1',
  speaker: 'npc',
  speakerName: 'Sophie',
  practiceText: 'Bonjour !',
  nativeText: 'Hello!',
};
const userBubble: Bubble = {
  id: 'b2',
  speaker: 'user',
  practiceText: 'Salut Sophie',
  nativeText: 'Hi Sophie',
};
const narratorBubble: Bubble = {
  id: 'b3',
  speaker: 'narrator',
  practiceText: 'Le soleil se lève.',
  nativeText: 'The sun rises.',
};

function renderArea(
  bubbles: Bubble[],
  viewMode: ZViewModeT,
  hideNativeForUtterance: string | null = null,
) {
  return render(
    <DialogueArea
      bubbles={bubbles}
      characterName="Marc"
      viewMode={viewMode}
      hideNativeForUtterance={hideNativeForUtterance}
    />,
  );
}

describe('DialogueArea viewMode (LIFE-LANG-3/4)', () => {
  it('LIFE-LANG-3 — visible shows practice + native on npc/user bubbles', () => {
    renderArea([npcBubble, userBubble], 'visible');
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Bonjour !');
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Hello!');
    expect(screen.getByTestId('LifeScreen-Bubble-user')).toHaveTextContent('Salut Sophie');
    expect(screen.getByTestId('LifeScreen-Bubble-user')).toHaveTextContent('Hi Sophie');
  });

  it('LIFE-LANG-3 — native-only shows ONLY nativeText', () => {
    renderArea([npcBubble, userBubble], 'native-only');
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Hello!');
    expect(npc).not.toHaveTextContent('Bonjour !');
    const user = screen.getByTestId('LifeScreen-Bubble-user');
    expect(user).toHaveTextContent('Hi Sophie');
    expect(user).not.toHaveTextContent('Salut Sophie');
  });

  it('LIFE-LANG-3 — hidden shows ONLY practiceText (narrator too)', () => {
    renderArea([narratorBubble, npcBubble], 'hidden');
    const narrator = screen.getByTestId('LifeScreen-Bubble-narrator');
    expect(narrator).toHaveTextContent('Le soleil se lève.');
    expect(narrator).not.toHaveTextContent('The sun rises.');
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Bonjour !');
    expect(npc).not.toHaveTextContent('Hello!');
  });

  it('LIFE-LANG-3 — native-only falls back to practiceText when nativeText is missing', () => {
    renderArea([{ ...npcBubble, nativeText: null }], 'native-only');
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Bonjour !');
  });

  it('LIFE-LANG-4 — the comprehension gate outranks native-only: source bubble shows practiceText + reveal', () => {
    renderArea([npcBubble], 'native-only', 'Bonjour !');
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Bonjour !');
    expect(npc).not.toHaveTextContent('Hello!');
    const reveal = screen.getByTestId('LifeScreen-RevealTranslation');
    fireEvent.click(reveal);
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Hello!');
  });
});
```

### T6 — NEW `src/screens/LifeScreen/LifeScreenHeader.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// LifeScreenMenu transitively imports the Firebase-backed world lib;
// useAppBack needs a router. Stub both — this test targets the cycle
// button only.
vi.mock('./LifeScreenMenu', () => ({
  LifeScreenMenu: () => null,
}));
vi.mock('@/hooks/useAppBack', () => ({
  useAppBack: () => () => undefined,
}));

import { LifeScreenHeader } from './LifeScreenHeader';
import type { ZViewModeT } from '@/types/firestore';

function renderHeader(viewMode: ZViewModeT, onSetViewMode = vi.fn()) {
  render(
    <LifeScreenHeader
      uid="u1"
      worldId="w1"
      title="Test wurld"
      sessionDayCount={null}
      viewMode={viewMode}
      onSetViewMode={onSetViewMode}
      onExit={() => undefined}
      onDeleted={() => undefined}
      onError={() => undefined}
    />,
  );
  return onSetViewMode;
}

describe('LifeScreenHeader view-mode cycle (LIFE-LANG-3)', () => {
  it('LIFE-LANG-3 — button carries the current mode as data-mode', () => {
    renderHeader('native-only');
    expect(screen.getByTestId('LifeScreen-ViewMode')).toHaveAttribute('data-mode', 'native-only');
  });

  it('LIFE-LANG-3 — click cycles visible → native-only → hidden → visible', () => {
    const spy1 = renderHeader('visible');
    fireEvent.click(screen.getByTestId('LifeScreen-ViewMode'));
    expect(spy1).toHaveBeenCalledWith('native-only');
  });

  it('LIFE-LANG-3 — native-only advances to hidden', () => {
    const spy = renderHeader('native-only');
    fireEvent.click(screen.getByTestId('LifeScreen-ViewMode'));
    expect(spy).toHaveBeenCalledWith('hidden');
  });

  it('LIFE-LANG-3 — hidden wraps back to visible', () => {
    const spy = renderHeader('hidden');
    fireEvent.click(screen.getByTestId('LifeScreen-ViewMode'));
    expect(spy).toHaveBeenCalledWith('visible');
  });
});
```

### T7 — NEW `src/screens/LifeScreen/LifeScreenBottom.test.tsx`

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { chipDisplayFor, LifeScreenBottom } from './LifeScreenBottom';
import type { FlashcardMatch } from './ActionBar';
import type { PracticePrompt, StepChoice } from '@/lib/life/stepSchema';

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

function renderBottom(overrides: Partial<Parameters<typeof LifeScreenBottom>[0]>) {
  const props = {
    feedback: null,
    busy: false,
    graded: false,
    practicePrompt: null,
    choices: [] as StepChoice[],
    flashcardLookup: new Map<string, FlashcardMatch>(),
    viewMode: 'visible' as const,
    onPick: vi.fn(),
    onFreeText: vi.fn(),
    onFeedbackContinue: vi.fn(),
    onExplain: vi.fn(),
    ...overrides,
  };
  render(<LifeScreenBottom {...props} />);
  return props;
}

describe('LifeScreenBottom language wiring (LIFE-LANG-1/2/3/5)', () => {
  it('LIFE-LANG-2 — graded comprehension renders the utterance card + native-only chips', () => {
    renderBottom({
      graded: true,
      practicePrompt: comprehensionPrompt,
      choices: comprehensionChoices,
    });
    expect(screen.getByTestId('LifeScreen-PracticePrompt-Comprehension')).toHaveTextContent(
      'Est-ce que tu connais un bon café ?',
    );
    const chip = screen.getByTestId('LifeScreen-Choice-a');
    expect(chip).toHaveTextContent("She's asking about a café");
    expect(chip).not.toHaveTextContent('Elle cherche un café');
  });

  it('LIFE-LANG-2 — graded fill-blank renders the template card + gloss-free practice chips', () => {
    renderBottom({
      graded: true,
      practicePrompt: fillBlankPrompt,
      choices: fillBlankChoices,
    });
    expect(screen.getByTestId('LifeScreen-PracticePrompt-FillBlank')).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Choice-a')).toHaveTextContent('voudrais');
    expect(screen.getByTestId('LifeScreen-Choice-a').textContent).toBe('voudrais');
  });

  it('LIFE-LANG-3 — chipDisplayFor maps CYOA turns from viewMode and pins graded kinds', () => {
    expect(chipDisplayFor(false, null, 'visible')).toBe('both');
    expect(chipDisplayFor(false, null, 'native-only')).toBe('native');
    expect(chipDisplayFor(false, null, 'hidden')).toBe('practice');
    expect(chipDisplayFor(true, comprehensionPrompt, 'hidden')).toBe('native');
    expect(chipDisplayFor(true, fillBlankPrompt, 'native-only')).toBe('practice');
  });

  it('LIFE-LANG-5 — the feedback Why? button fires onExplain', () => {
    const props = renderBottom({
      feedback: {
        correct: false,
        picked: { practiceText: 'veux', nativeText: '' },
        correctAnswer: { practiceText: 'voudrais', nativeText: '' },
      },
    });
    fireEvent.click(screen.getByTestId('LifeScreen-PracticeFeedback-Why'));
    expect(props.onExplain).toHaveBeenCalledTimes(1);
  });
});
```

### T8 — E2E edits to `tests/e2e/specs/life-flow.spec.ts`

This spec runs in the @standard tier already (`test:e2e:standard` is `--grep-invert @full`; the file carries no `@full` tag). Five edits (T8a–T8e; T8c has two sub-edits).

**T8a — sseBody helper + explain XML fixture.** ANCHOR (verify unique):

```ts
import { installLifeMock, minimalSceneSvg } from '../helpers/lifeMock';
```

Replace with:

```ts
import { installLifeMock, minimalSceneSvg } from '../helpers/lifeMock';

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
```

**T8b — fill-blank fixture goes gloss-free (LIFE-LANG-1).** ANCHOR (verify unique — the whole block; the line `// Bare lexeme gloss across all chips` occurs once):

```ts
  choices: [
    // Bare lexeme gloss across all chips — tests grammar, not
    // meaning (LIFE-EX chip-native-leak rule).
    {
      id: 'voudrais',
      practiceText: 'voudrais',
      nativeText: 'like',
      correctness: 'correct',
    },
    { id: 'veux', practiceText: 'veux', nativeText: 'like', correctness: 'wrong' },
    { id: 'ai', practiceText: 'ai', nativeText: 'like', correctness: 'wrong' },
  ],
```

Replace with:

```ts
  choices: [
    // LIFE-LANG-1: fill-blank chips are practice-language only — the
    // empty nativeText is the contract, not an omission.
    {
      id: 'voudrais',
      practiceText: 'voudrais',
      nativeText: '',
      correctness: 'correct',
    },
    { id: 'veux', practiceText: 'veux', nativeText: '', correctness: 'wrong' },
    { id: 'ai', practiceText: 'ai', nativeText: '', correctness: 'wrong' },
  ],
```

**T8c — comprehension test: chip-language assertions + Why? modal.** Two sub-edits inside the existing `LIFE-EX-COMPREHENSION` test.

First, ANCHOR (verify unique):

```ts
    await captureBeat(page, testInfo, 'comprehension-active');
```

Replace with:

```ts
    await captureBeat(page, testInfo, 'comprehension-active');

    // LIFE-LANG-1 — comprehension chips render ONLY the native
    // interpretation; the practice-language paraphrase never shows.
    const cafeChip = page.getByTestId('LifeScreen-Choice-cafe');
    await expect(cafeChip).toContainText("She's asking about a café near the office");
    await expect(cafeChip).not.toContainText('Elle demande un café');
```

Second, ANCHOR (verify unique):

```ts
    await captureBeat(page, testInfo, 'comprehension-feedback');
```

Replace with:

```ts
    await captureBeat(page, testInfo, 'comprehension-feedback');

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
```

**T8d — fill-blank test: gloss-free chip assertion.** ANCHOR (verify unique):

```ts
    await captureBeat(page, testInfo, 'fill-blank-active');
```

Replace with:

```ts
    await captureBeat(page, testInfo, 'fill-blank-active');

    // LIFE-LANG-1 — fill-blank chips are bare practice tokens with no
    // native gloss anywhere on the face.
    await expect(page.getByTestId('LifeScreen-Choice-voudrais')).toHaveText('voudrais');
```

**T8e — new viewMode-cycle test (POST-PHASE-C ANCHOR — Phase C's E13b replaces the entire old LIFE-FLOW-2 resume test with two LIFE-FLOW-5 tests; the anchor below is the first line E13b produces, so verify it against the post-C tree — it does not exist in the current tree).** ANCHOR (verify unique):

```ts
  test('LIFE-FLOW-5 — resumed world shows the recap screen from stored data; Continue releases the LIFE-FLOW-2 seeding', async ({}, testInfo) => {
```

Replace with (the new test is INSERTED BEFORE the first LIFE-FLOW-5 recap test; the preceding fill-blank test still leaves Sophie's reply + the follow-up CYOA chips on screen post-C, so the state assumption is unchanged, and the new test leaves the world doc back on `visible` so the recap test is unaffected):

```ts
  test('LIFE-LANG-3 — viewMode cycle flips bubble + chip languages and persists to the world doc', async ({}, testInfo) => {
    // State from the previous test: Sophie's reply bubble ("Génial !
    // À midi alors." / "Great! At noon then.") + the follow-up CYOA
    // chips are on screen. No new Gemini calls fire in this test.
    const toggle = page.getByTestId('LifeScreen-ViewMode');
    await expect(toggle).toHaveAttribute('data-mode', 'visible');
    await expect(page.getByText('Génial ! À midi alors.')).toBeVisible();
    await expect(page.getByText('Great! At noon then.')).toBeVisible();

    // visible → native-only: practice text hides, native text stays.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'native-only', { timeout: 10_000 });
    await expect(page.getByText('Great! At noon then.')).toBeVisible();
    await expect(page.getByText('Génial ! À midi alors.')).not.toBeVisible();
    // Chips follow: main label becomes the native text (LIFE-LANG-3).
    const chip = page.getByTestId('LifeScreen-Choice-breakfast');
    await expect(chip).toContainText('Make breakfast');
    await expect(chip).not.toContainText('Préparer le petit-déjeuner');
    await captureBeat(page, testInfo, 'viewmode-native-only');

    // POST-CONDITION: the mode persisted to the world doc (it syncs
    // across devices) — not just a local render flip.
    const worldId = new URL(page.url()).pathname.split('/').pop() as string;
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
    await expect(page.getByText('Génial ! À midi alors.')).toBeVisible();
    await expect(page.getByText('Great! At noon then.')).not.toBeVisible();
    await expect(chip).toContainText('Préparer le petit-déjeuner');
    await expect(chip).not.toContainText('Make breakfast');
    await captureBeat(page, testInfo, 'viewmode-hidden');

    // hidden → visible: both languages back. Leaves the world doc in
    // the default state for the recap test below.
    await toggle.click();
    await expect(toggle).toHaveAttribute('data-mode', 'visible', { timeout: 10_000 });
    await expect(page.getByText('Génial ! À midi alors.')).toBeVisible();
    await expect(page.getByText('Great! At noon then.')).toBeVisible();
    await captureBeat(page, testInfo, 'viewmode-visible');
  });

  test('LIFE-FLOW-5 — resumed world shows the recap screen from stored data; Continue releases the LIFE-FLOW-2 seeding', async ({}, testInfo) => {
```

---

## Verify

Run from the repo root, in this order; every command must exit 0.

```bash
# 1. Unit + component (scoped first for fast iteration, then the full suite)
npx vitest run src/lib/life/prompts/gradedQuestion.test.ts src/lib/life/runGradedQuestionGenerate.test.ts src/screens/LifeScreen/buildLifeExplainQuestion.test.ts src/screens/LifeScreen/ActionBar.test.tsx src/screens/LifeScreen/DialogueArea.test.tsx src/screens/LifeScreen/LifeScreenHeader.test.tsx src/screens/LifeScreen/LifeScreenBottom.test.tsx
npm test

# 2. Types + lint (max-lines must pass on LifeScreen.tsx post-extraction)
npm run typecheck
npx eslint src/

# 3. E2E — the life-flow spec (mocked Gemini, real Firebase; @standard tier)
cd tests/e2e && npx playwright test specs/life-flow.spec.ts
```

Then READ every screenshot the run produced under `screenshots/<run-id>/` (Read tool, each PNG): check `comprehension-active` (native-only chips, no French on chip faces), `fill-blank-active` (bare tokens), `comprehension-why-explain` (modal open with content), `viewmode-native-only` / `viewmode-hidden` / `viewmode-visible` (bubble + chip languages match the mode; no empty bubbles; no dangling `·` in feedback shots). Do not report the phase done until the screenshots are visually clean.

Prompt-suite note: `src/lib/life/prompts/gradedQuestion.ts` is a client-side prompt (not `functions/src/`), so the functions `@prompts` gate does not apply. The unit SI tests + the emulator-tier real-Gemini smoke cover it. Do NOT run `npm run test:prompts` for this phase without asking the user first.

## Out of scope

- **`src/lib/life/prompts/step.ts`** — line ~115 mentions generator language-placement freedom; leave it (Phase F4 rewrites that SI; editing it now breaks Phase F's anchors).
- **Per-bubble tap-to-flip + bubble long-press ExplainModal** (`LIFE-UI-4` / `LIFE-BUBBLE-4`) — still unimplemented; LIFE-LANG-3 is the per-wurld default only.
- **Tappable vocab / save-word on bubbles or chips** — Phase E. Do not add `complexWords`/`wordTranslations` plumbing here.
- **`ExplainModal.onOverrideCorrect`** — practice-mode's verdict-overturn flip is NOT wired for life graded turns (no result row to flip; the correction event is already written by the step flow). Deliberately omitted.
- **`runLifeStep.ts`, `stepSchema.ts`, `commitNode`/lookahead anything** — Phase F.
- **Location ribbon, TTS voice/language behaviour** — explicitly excluded from viewMode (LIFE-LANG-3).
- **80-locale i18n regen** — `en.ts` only; regen is user-triggered later.
- **`life.feedback.meaning` copy** ("It means: voudrais" reads slightly odd for gloss-free fill-blank corrects) — observed, tolerable, product-judgment call; surface to the owner rather than changing copy here.
- Other worktree files: `WorldCard.tsx`/`useWorldThumbnail` (B), `WurldResumeScreen`/`resumeRecap` (C), `useLifeWordSave` (E). Do not touch.
