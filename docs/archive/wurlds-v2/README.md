# Wurlds v2 — implementation handover

This directory is the complete, self-contained implementation package for the approved
**Wurlds v2** plan ([00-approved-plan.md](00-approved-plan.md)): RPG gameplay × the app's
learning engine, for the life-sim feature behind the `lifeSimBeta` flag.

Each `phase-*.md` is an **exact-change document**: every edit carries the target file, a
verbatim anchor snippet from the current source, and the exact replacement/new code. New
files are given in full. Tests are written out with `<INVARIANT-ID> — <one-liner>`
descriptions. You (the implementing agent) have **no design authority** — if a doc and
reality disagree in a way the doc doesn't anticipate, STOP and surface it; do not invent
a resolution. (This mirrors the Contradict-then-STOP rule in CLAUDE.md.)

## Before you start

1. Read `/CLAUDE.md` — the spec-driven workflow and Reliability principles govern all of
   this work. The order inside every phase doc (spec → failing tests → implementation →
   green) is that workflow instantiated; follow it as written.
2. Read `docs/specs/life-sim.md` end to end once, plus the sections each phase doc lists
   under "Read first".
3. Anchors: every edit's `ANCHOR (verify unique)` snippet must match the file verbatim and
   uniquely before you apply the edit. Anchors marked `POST-PHASE-<x> ANCHOR` assume that
   earlier phase already landed — if it hasn't, you're executing out of order.

## Execution order

Phases land **strictly in order A → H**. Suggested session grouping (from the plan):

| Session | Phases | Character |
|---|---|---|
| 1 | [A](phase-a.md) + [B](phase-b.md) + [C](phase-c.md) | Mechanical: i18n values, thumbnail hook, resume recap screen |
| 2 | [D](phase-d.md) + [E](phase-e.md) | UI-heavy: language system, tappable vocab |
| 3 | [F](phase-f.md) alone | The engine change — biggest; has its own ordered sub-steps |
| 4 | [G](phase-g.md) + [H](phase-h.md) | Flashcard weaving + SRS credit; cheap wins + spec §19 backlog |

Commit per phase (or per session at most). **Run the full gate after each phase, not just
at the end**: `npm test`, `npm run typecheck`, `npx eslint src/`, plus the E2E specs the
phase's "Verify" section names. Every phase doc ships at least one E2E post-condition
assertion — the feature isn't done without it (CLAUDE.md Reliability principle 4).

## Shared contracts (pinned across all phases — do not re-decide)

- **Phase C**: `ZLifeWorld.resumeRecap?: { text; lastEventId; generatedAt? } | null`; new
  `src/lib/life/runResumeRecapGenerate.ts`, `src/lib/life/prompts/resumeRecap.ts`,
  `src/screens/LifeScreen/WurldResumeScreen.tsx`.
- **Phase B**: `src/screens/LifeScreen/useWorldThumbnail.ts` → `{ svg: string | null }`.
- **Phase D**: `ZLifeWorld.viewMode?: ZViewMode` (`'visible'` = both, `'native-only'` =
  nativeText only, `'hidden'` = practiceText only; default `'visible'`). ActionBar chip prop
  `chipDisplay: 'both' | 'practice' | 'native'` **replaces** `hideChipNative`. Graded turns:
  instruction always native, content always practice; comprehension chips native-only;
  fill-blank chips practice-only (`nativeText: ""`). The comprehension-source gloss gate
  outranks viewMode. New `src/screens/LifeScreen/buildLifeExplainQuestion.ts`.
- **Phase E**: `complexWords?: string[]` + `wordTranslations?: Record<string, string>` on
  `ZStepChoice`, Phase F's `ZStepOption`, and the DialogueArea `Bubble` type. Chips render
  plain; annotations activate in the user bubble after pick. `PracticePromptCard` excluded.
  New `src/screens/LifeScreen/useLifeWordSave.ts`.
- **Phase F**: `ZNodePreview` (`'branch' | 'continuation' | 'question'`), `ZStepOption`
  (`next` XOR `noPreview`), `ZRawNodeResponse`, `WRITE_YOUR_OWN_ID = '__write__'`,
  `src/lib/life/generateStepOptions.ts` (pure) + `src/lib/life/commitNode.ts` (writes),
  `TurnPhase` state machine; `runLifeStep.ts` deleted at the end of F.
- **Invariant ids**: LIFE-UI-8 (A), LIFE-WORLD-9 (B), LIFE-FLOW-5 (C — NOT 4; the spec
  already defines LIFE-FLOW-4), LIFE-LANG-1..5 (D), LIFE-BUBBLE-7 rewrite (E),
  LIFE-NODE-1..8 (F), LIFE-EX-SRS-1..4 (G), LIFE-VOCAB-RECAP-1..2 (H). Spec changes land in
  `docs/specs/life-sim.md` (+ `docs/specs/README.md` prefix table) in the same commit as
  the code.

## Deferred (explicitly NOT part of any phase)

- **80-locale i18n regen** — after Phase A lands, the user triggers `npm run i18n:regen`
  themselves (costs cents, touches 80 files). Only `en.ts` changes in these phases.
- **Prompt-suite runs** — Phases D/F/G touch prompt text under `src/lib/life/prompts/`.
  These are client-side Gemini prompts (not `functions/src/`), so the functions prompt
  gate doesn't apply, but the phase docs' Verify sections say what to run; ask the user
  before any real-Gemini spend beyond that (CLAUDE.md @prompts rule).
- Everything in the plan's **Backlog** section — Phase H appends it to
  `docs/specs/life-sim.md` §19; none of it is implemented now.

## Verification of this package

These docs were authored by per-phase agents reading the live source, then adversarially
fact-checked (paths, anchors, signatures, i18n keys, invariant-id numbering) and revised,
then cross-audited for contract adherence and same-file collisions in landing order. If
you still hit a stale anchor, the source wins — fix the doc in the same commit and note it.
