# Phase H — Chapter vocab recap + backlog formalization into spec §19

**Goal.** Two deliverables, zero LLM calls, zero new Firestore queries. (1) A "Words you practised" list on the two completion overlays — `CampaignCompleteScreen` (campaign window) and `WorldArcCompleteScreen` (chapter window) — derived client-side from `correction` + `flashcard_added` events already held by the `useLifeEvents` listener. (2) The Wurlds-v2 plan's Backlog section is appended verbatim-in-spirit to `docs/specs/life-sim.md` §19 so nothing lives only in the plan file.

**Prerequisites (repo state as of 2026-07-14).** Phases land strictly in order A → H, so this doc executes AFTER A–G are merged; every POST-PHASE-`<X>` anchor below is quoted verbatim from the corresponding phase doc's planned post-state. As of this writing NO Phase A–G output has landed in the repo yet (`en.ts` still reads "Continue your life"; `src/lib/life/runLifeStep.ts` still exists; there is no `commitNode.ts` / `useNodeEngine.ts`; `tests/e2e/helpers/lifeMock.ts` + `life-flow.spec.ts` are today's `StepResponse` beats/choices harness) — the post-F states are pinned by `phase-f.md` **F7-b** (lifeMock rewrite: `LifeMockFixtures.steps` elements are `StepFixture = RawNodeResponseInput | { response; delayMs }`) and **F7-c** (full `life-flow.spec.ts` rewrite: `test.describe.serial('life-sim node engine (mocked Gemini)')`, module-scope `worldId`, seeded world, `readEvents` helper), and by `phase-c.md` N3 (`WurldResumeScreen`, testid `LifeScreen-WurldResume-Continue`, which intercepts every resume reload once C lands). `docs/plans/wurlds-v2/phase-g.md` now exists and defines `LIFE-EX-SRS-1..4` (§10.47 — flashcard weaving + SRS credit); since Phases land strictly A → H and this doc executes last, the §19 backlog block's `LIFE-EX-SRS-*` reference resolves against Phase G's landed definitions rather than a forward reference. If an anchor's `grep -F` count is 0 at execution time, the landed code drifted from its phase doc: re-derive the anchor from the landed file (source wins), keep the operation and the props/assertion contracts identical, and note the drift in your report. The plan's dependency table allows H to be pulled forward (H depends only on D); the **pre-F variant** notes at the end of Edits C7 and T5 cover that ordering — ignore them on the normal A→H path.

**Invariant ids covered:** `LIFE-VOCAB-RECAP-1` (derivation contract), `LIFE-VOCAB-RECAP-2` (render contract on both screens). Verified free — `git grep LIFE-VOCAB-RECAP` returns nothing today. The Why?-explain wiring that the plan's Phase H item 1 mentions is assigned to Phase D2 (`buildLifeExplainQuestion` + `ExplainModal` — `phase-d.md` Edit 5; already merged by the time this phase executes on the A→H path) — it is **not** part of this phase and must not be duplicated here.

All paths are relative to the repo root `/Users/jamesarney/wurld` unless absolute.

## Contradictions / plan-drift corrections

Resolved here so the implementer never has to judge:

1. **Plan claims correction events carry `testTarget`/`flashcardId`.** The source disagrees: the `correction` event payload written today is `{ kind: 'fill-blank'|'comprehension', correct: boolean, picked: string, correctAnswer: string, promptSource: string }` (`src/lib/life/runLifeStep.ts` lines 323–335; post-Phase-F the same write moves into `src/lib/life/commitNode.ts` with the payload shape unchanged — the shape is load-bearing for `prompts/step.ts` + `compactionPrompts.ts` renderers). `testTarget` lives on the `gradedPlan`, not the event. The derivation below and the §19 backlog text use `correctAnswer`/`promptSource` (source wins, intent kept). Phase G threads `flashcardId` through the feedback path for SRS credit; the backlog bullet phrases that conditionally.
2. **Plan says "the Backlog section lists 9 items … appends every item to §19".** The 9th item (explicit Gemini `cachedContent` caching) ALREADY lives in §19 as its own detailed bullet (ending "…so the model can echo which card it used."), including its revisit trigger. The appended block therefore adds 8 new bullets plus a one-line pointer bullet for item 9 — no duplication of the existing design text.
3. **Dependency note, not a contradiction:** `appendFlashcardEvent` (`src/lib/life/world.ts:246`) has zero callers today — no code writes `flashcard_added` events yet, and Phase E deliberately does NOT add a per-save writer either (`phase-e.md` out-of-scope list: "that is the existing LIFE-FLOW-2 session-resume mechanism, not a per-save write; do not add one" — and the LIFE-FLOW-2 resume seeding itself is spec'd but unimplemented). So until that seeding lands, the recap list is corrections-only in practice; the derivation handles `flashcard_added` events so the list picks them up the day a producer ships. Do NOT add a `flashcard_added` writer in this phase.
4. **Window bound:** both screens can only see the events the client has loaded — `useLifeEvents(uid, worldId, 40)` (last 40, chronological). This is the exact same bound the existing completion **stats** already run under (`snapshotCampaignCompletion` receives the same `eventsData`). Phase H filters that window by time range; it does not load more history. Recorded as a design decision in §20 (block included below).
5. **Flagged, NOT fixed here — chapter-stats window mismatch (pre-existing).** `LIFE-WORLD-ARC-8` says the chapter screen shows "aggregated stats across the chapter", but the implementation passes the RESOLVING CAMPAIGN's snapshot numbers (`acceptedAt → now` window) as the arc screen's `gradedCount`/`correctCount` (`campaignsCompleted` IS chapter-wide). This phase's words list uses the chapter window (`arc.startedAt`), so the two sit side-by-side with different windows. Not silently fixed because the "fix" is a product judgment: chapter-window stats computed over the loaded 40-event window would still undercount long chapters, just differently. Recommendation for the manager: either extend the LIFE-VOCAB-RECAP derivation module with a chapter-stats variant in a follow-up, or soften the LIFE-WORLD-ARC-8 wording; do it as its own change, not inside this phase.

## Read first

- `docs/specs/life-sim.md` — §10.5 (`LIFE-CAMPAIGN-10`), §10.7 (`LIFE-WORLD-ARC-6/8`), §13 (`LIFE-EVENT-1/3`), §19, §20.
- `docs/specs/README.md` — invariant-id prefix table (the `LIFE-*` row) + test-description convention.
- `docs/plans/wurlds-v2/00-approved-plan.md` — "Phase H" + "Backlog" sections.
- `docs/plans/wurlds-v2/phase-f.md` — §F7-b (post-F `lifeMock.ts`: `StepFixture` / `RawNodeResponseInput`), §F7-c (post-F `life-flow.spec.ts` — the file Edit T5 appends to), §E1/E8/E9 (post-F LifeScreen import block, overlay handlers, `overlayBusy`).
- `docs/plans/wurlds-v2/phase-c.md` — §N3 (`WurldResumeScreen` + `LifeScreen-WurldResume-Continue`, the overlay T5's reload must dismiss).
- Source: `src/lib/life/campaignLifecycle.ts` (esp. `snapshotCampaignCompletion`, lines 27–103), `src/screens/LifeScreen/CampaignCompleteScreen.tsx`, `src/screens/LifeScreen/WorldArcCompleteScreen.tsx`, `src/screens/LifeScreen/useChapterCompletion.ts` (the overlay CTAs' handlers — Return home → `closeCampaignFlow` + `archiveActiveArc` (pure Firestore, no Gemini), Continue → `runWorldArcGenerate`, Pause → navigate to `/life/overview`; read-only in this phase, T5's determinism note leans on it), `src/screens/LifeScreen/LifeScreen.tsx` (overlay render block near the bottom; pre-F the resolve snapshot is computed in `applyResponse`, post-F it arrives via `useNodeEngine`'s `onCampaignResolved` — either way it is a `CampaignCompletionSnapshot` from `campaignLifecycle.ts`), `src/lib/life/world.ts` (event writers), `src/hooks/useLifeEvents.ts` (ordering + limit 40), `src/types/firestore.ts` (`ZLifeEvent`, `ZWorldArc`, `ZLifeCampaign`).
- Tests to mirror: `src/lib/life/campaignLifecycle.test.ts` (Timestamp-like fixture pattern), `src/screens/Practice/LessonIntro.test.tsx` (component tests need no i18n provider — `useT` falls back to `en`), `tests/e2e/specs/life-flow.spec.ts` + `tests/e2e/helpers/lifeMock.ts`.

## Spec changes

Apply these BEFORE any code. Every anchor in this document (spec + code edits alike) is an exact contiguous snippet copied from the current file — or, where marked POST-PHASE-`<X>`, from that phase doc's planned post-state — and is unique in that file as a block. Verify before editing: for single-line anchors run `grep -F -c '<line>' <file>` → must print `1`; for multi-line anchors grep the block's most distinctive line (e.g. `onClick={onClose}` in C5d, `{recurringNpcNames.length > 0 && (` in C6d, `onClose: () => void;` in C5b) → must print `1`, which pins the contiguous block. If a count is not 1, the file drifted — widen the snippet from the current file until unique; do not guess.

### Edit S1 — `docs/specs/life-sim.md`: new §10.9 section

ANCHOR (verify unique — insert the new block IMMEDIATELY BEFORE this line):

```
## 11. Transport loop — `LIFE-TRANS-*`
```

Insert this block (note it ends with a `---` separator so the document keeps its section-divider rhythm):

```markdown
## 10.9 Chapter vocab recap — `LIFE-VOCAB-RECAP-*`

The campaign / chapter completion screens end with a "Words you practised" list — a lightweight review of the vocabulary the player just met, derived entirely from the event log. No LLM call, no extra Firestore read: the list is a pure function of the already-loaded `useLifeEvents` window.

| ID | Invariant |
|---|---|
| **LIFE-VOCAB-RECAP-1** | The list is derived CLIENT-SIDE by `derivePractisedWords(events, sinceSeconds)` (`src/lib/life/vocabRecap.ts`) — zero LLM calls, zero additional Firestore reads. Input is the already-loaded `useLifeEvents` window (last 40 events, chronological oldest → newest). Rules: (a) `correction` events with `createdAt.seconds >= sinceSeconds` contribute `payload.correctAnswer` (trimmed; empty/missing → skipped) with `correct = payload.correct === true`; (b) `flashcard_added` events in the same window contribute `payload.practice` (trimmed; empty/missing → skipped) with `translation = payload.native` (trimmed, `null` when empty); (c) entries dedupe case-insensitively on the trimmed text — the first occurrence keeps its position and casing, a later `correction` overwrites `correct` (latest attempt wins), a later `flashcard_added` fills a missing `translation`; (d) every other event kind is ignored; (e) an event with no `createdAt` counts as seconds 0 (excluded by any positive window start). |
| **LIFE-VOCAB-RECAP-2** | Both completion screens render the list through the shared `VocabRecapList` (`src/screens/LifeScreen/VocabRecapList.tsx`) and only when it is non-empty (empty → the section renders nothing, not an empty header). `CampaignCompleteScreen` shows the campaign window: `campaign.acceptedAt → resolution`, computed into `CampaignCompletionSnapshot.words` by `snapshotCampaignCompletion` — the exact event window the stats already use. `WorldArcCompleteScreen` shows the chapter window: `arc.startedAt → now`, derived at render time in LifeScreen's completion-overlay layer (`LifeCompletionOverlays`) from the live events window. Display caps at 12 chips; overflow renders a single "+N more" chip. A missing window start (`acceptedAt` / `startedAt` absent) degrades to seconds 0 — i.e. "everything in the loaded window" — never a crash. Both windows are bounded by the loaded 40-event window, same as the completion stats (see §20 design decision). |

---

```

### Edit S2 — `docs/specs/life-sim.md`: domain prefix table row

ANCHOR (verify unique — insert the new row IMMEDIATELY AFTER this line):

```
| `LIFE-NPC-RECUR-*` | Recurring NPCs | scope: campaign / world / transient; model-driven promotion + retirement; soft 8-cap |
```

New row:

```markdown
| `LIFE-VOCAB-RECAP-*` | Chapter vocab recap | "Words you practised" list on the campaign + chapter completion screens; client-side derivation from `correction` / `flashcard_added` events |
```

### Edit S3 — `docs/specs/life-sim.md`: §18 tests table row

ANCHOR (verify unique — insert the new row IMMEDIATELY AFTER this line):

```
| TBD: `tests/e2e/specs/life-flow.spec.ts` (Phase B+) | End-to-end onboarding → first beat → user response → next beat |
```

New row:

```markdown
| `src/lib/life/vocabRecap.test.ts`, `src/screens/LifeScreen/CampaignCompleteScreen.test.tsx`, `src/screens/LifeScreen/WorldArcCompleteScreen.test.tsx`, `src/lib/life/campaignLifecycle.test.ts` (snapshot words), `tests/e2e/specs/life-flow.spec.ts` (vocab-recap test) | LIFE-VOCAB-RECAP-1..2 |
```

### Edit S4 — `docs/specs/life-sim.md`: §19 backlog block

POST-PHASE-G ANCHOR (Phase G "builds on the spec §19 note" and may have reworded the tail of the `cachedContent` bullet). Primary anchor — insert the block IMMEDIATELY AFTER the line ending:

```
needs a `flashcardId` field on `practicePrompt` so the model can echo which card it used.
```

FALLBACK if that sentence changed: insert the block at the very end of §19, immediately BEFORE the `---` line that precedes `## 20. Design decisions`.

Insert this exact block (blank line before and after):

```markdown
### Wurlds v2 backlog (formalized 2026-07)

Deferred from the Wurlds v2 plan (`docs/plans/wurlds-v2/00-approved-plan.md`). Each item carries its trigger for revisiting; none is scheduled. This section is the canonical home — the plan file is not.

- **Wurld-mistakes practice session.** A practice-mode session seeded from questions the player got WRONG in wurlds — `correction` events with `correct: false` carry the tested answer (`correctAnswer`) + the prompt context (`promptSource`), and card-backed questions additionally carry a `flashcardId` on their `gradedPlan` (threaded by the SRS-credit path, `LIFE-EX-SRS-*`); feed them into `buildSession` as a "Review your wurld mistakes" intent (practice mode's session builder + card selector already support intents). The full loop: story exposes → wurld tests → practice mode drills the misses. *Revisit when:* a user asks how to review their wurld mistakes, or telemetry shows sustained sub-70% graded accuracy in wurlds.
- **Listening question node** (listen-and-pick lift). TTS plays the NPC line with the text hidden; native options. A new node kind that slots into the `LIFE-NODE-*` taxonomy cleanly; uses the existing `TTSButton` / `synthesizeSpeech`. *Revisit when:* the Phase F node engine has settled in production (no schema churn for a few weeks) and per-session TTS cost is known.
- **Recap quiz.** The resume-recap screen ends with one comprehension question about last session ("What did Mathieu ask you to do?") — memory + language reinforcement in one. Needs a small gen call at recap time. *Revisit when:* the Phase C resume screen has shipped and resume telemetry shows players actually read it.
- **Wurld sessions feed practice mode.** Pipe wurld `correction`-event topics into practice mode's `recentSessionTopics` recency signal (the "Coordinates with" note at the top of this spec anticipates this; not yet wired). *Revisit when:* active wurld players report repetitive practice sessions, or the next change touches `PRACTICE-PLAN-*` recency inputs anyway.
- **Chapter transcript view.** Re-read a chapter's full dialogue (the events log already has everything, zero LLM) with vocab taps live — re-reading comprehensible input is one of the cheapest high-value learning modes. *Revisit when:* a user asks to re-read a chapter, or we want a "Re-read" CTA beside the chapter-complete stats.
- **Difficulty auto-tune per wurld.** Client computes rolling graded-question accuracy; the prompt carries a one-line nudge ("player is at 92% — stretch them" / "at 45% — simplify structures"). One SI line + one derived stat. *Revisit when:* playtests show worlds pinned too easy or too hard for more than a session.
- **Per-wurld fluency stat.** RPG progression derived from correction-event accuracy — "your French Charisma is growing". *Revisit when:* difficulty auto-tune lands (same derived-accuracy input) and the wurld card needs a visible progression hook.
- **80-locale i18n regen.** User-triggered `npm run i18n:regen`; costs cents but touches 80 files. *Revisit when:* the wurlds-v2 `en.ts` strings have stabilised (after Phase H lands).
- **Explicit Gemini `cachedContent` caching.** Already formalized above in this section (the `cachedContent` bullet) — not duplicated here. *Revisit when:* the debug Telemetry tab shows the implicit prefix cache degrading (hit-rate drop / cost-per-turn regression).
```

### Edit S5 — `docs/specs/life-sim.md`: §20 design decision

ANCHOR (verify unique — the final sentence of the file; insert the new block AFTER it, separated by one blank line):

```
without per-event language fields.
```

Insert:

```markdown

### Why the vocab recap derives from the loaded event window (not a fresh query)

The "Words you practised" list (LIFE-VOCAB-RECAP-*) filters the `useLifeEvents` window (last 40 events) by the campaign/chapter start timestamp instead of running a `where('createdAt','>', windowStart)` query for the full range. Alternatives weighed: a one-shot range query would make the chapter list complete for long chapters (100–300 event reads per chapter end), but the completion STATS already run on the same 40-event window (`snapshotCampaignCompletion` receives the listener's `eventsData`), so a fuller word list would sit next to knowingly-bounded stats — inconsistent, and the celebration overlay is a recap, not an audit. Zero extra reads wins for v1. Trigger for revisiting: if chapter recaps regularly look truncated in playtests (players practise far more than ~40 events per chapter and notice words missing), switch BOTH the stats and the words to a shared range query in one change.
```

### Edit S6 — `docs/specs/README.md`: `LIFE-*` prefix row

POST-PHASE-G ANCHOR (Phases D/F/G each add their own sub-prefix token to this row, so the full row text will have drifted; the operation below is drift-proof). In the domain-prefix table find the single row starting `| \`LIFE-*\` | life-sim (` and insert the token `VOCAB-RECAP / ` immediately before the `TRANS` token. Today the row reads:

```
| `LIFE-*` | life-sim (DATA / FLOW / ONBOARD / CTX / STEP / SCENE / NPC / UI / BUBBLE / CONTRACT / WORLD / WORLD-ARC / NPC-RECUR / EX / TRANS / COMPACT / EVENT / SETTINGS / DEV / WIP / FAIL) |
```

i.e. replace the substring `/ TRANS /` with `/ VOCAB-RECAP / TRANS /` in that row (exactly one occurrence in the file today; if earlier phases inserted tokens elsewhere in the row, this replacement still applies verbatim).

## Ordered steps

1. Apply spec edits S1–S6 above.
2. Add the two i18n keys to `src/i18n/locales/en.ts` (Edit C1 below — must precede component code: `MessageKey` is typed from `en.ts`, so `t('life.vocabRecap.title')` won't typecheck until the keys exist). en.ts ONLY — do not touch the other 80 locale files (regen is a separate user-triggered step, backlog item above).
3. Write the tests (Edits T1–T4 below): new `src/lib/life/vocabRecap.test.ts`, new `src/screens/LifeScreen/CampaignCompleteScreen.test.tsx`, new `src/screens/LifeScreen/WorldArcCompleteScreen.test.tsx`, the addition to `src/lib/life/campaignLifecycle.test.ts`, and the E2E addition to `tests/e2e/specs/life-flow.spec.ts`. Run `npx vitest run src/lib/life/vocabRecap.test.ts src/screens/LifeScreen/CampaignCompleteScreen.test.tsx src/screens/LifeScreen/WorldArcCompleteScreen.test.tsx src/lib/life/campaignLifecycle.test.ts` — the new tests MUST FAIL at this point (module `./vocabRecap` not found / `words` prop missing / `snap.words` undefined). If any new test passes here, the assertion is wrong — stop and fix the test.
4. Create `src/lib/life/vocabRecap.ts` (Edit C2 — complete file).
5. Create `src/screens/LifeScreen/VocabRecapList.tsx` (Edit C3 — complete file).
6. Edit `src/lib/life/campaignLifecycle.ts` (Edits C4a–C4c).
7. Edit `src/screens/LifeScreen/CampaignCompleteScreen.tsx` (Edits C5a–C5d).
8. Edit `src/screens/LifeScreen/WorldArcCompleteScreen.tsx` (Edits C6a–C6d).
9. Extract the completion overlays + wire the words props (Edits C7a–C7d: new `src/screens/LifeScreen/LifeCompletionOverlays.tsx`, then three mechanical `LifeScreen.tsx` edits). Pre-F, `LifeScreen.tsx` sits at EXACTLY the 600-counted-line ESLint cap (verified 2026-07-14), so the extraction is the only legal shape; post-F the file has headroom but the extraction stays — it is the design, not just a cap workaround (see the Edit C7 preamble; re-run its line-count check after).
10. Run to green: everything under "## Verify".

## Code edits

### Edit C1 — `src/i18n/locales/en.ts`: two new keys

ANCHOR (verify unique):

```
  'life.arcComplete.pause': 'Pause for now',
```

Replace with:

```ts
  'life.arcComplete.pause': 'Pause for now',
  'life.vocabRecap.title': 'Words you practised',
  'life.vocabRecap.more': '+{count} more',
```

(`{count}` is the repo's standard `{name}` interpolation — see `'life.debug.count': '{n} entries'`.)

### Edit C2 — NEW FILE `src/lib/life/vocabRecap.ts` (complete contents)

```ts
/**
 * LIFE-VOCAB-RECAP-1: pure derivation of the "Words you practised"
 * recap list shown on the campaign / chapter completion screens.
 *
 * Zero LLM, zero extra Firestore reads — the input is the already-
 * loaded `useLifeEvents` window (chronological, oldest → newest).
 * `correction` events contribute the tested answer; `flashcard_added`
 * events contribute the saved phrase + its native gloss.
 *
 * Spec: docs/specs/life-sim.md §10.9 (LIFE-VOCAB-RECAP-*).
 */
import type { LifeEvent } from '@/types/firestore';

export type PractisedWord = {
  /** Practice-language word/phrase, as shown on the recap chip.
   *  Keeps the casing of its first occurrence in the window. */
  text: string;
  /** Native gloss when known (`flashcard_added` carries one;
   *  `correction` events don't). */
  translation: string | null;
  /** Latest graded outcome for this word inside the window; null when
   *  the word only appeared as a saved flashcard. */
  correct: boolean | null;
};

/** Seconds of a Firestore Timestamp-like value; 0 when absent. The 0
 *  fallback mirrors `snapshotCampaignCompletion` — an event with no
 *  `createdAt` sorts before any positive window start. */
export function timestampSeconds(
  ts: { seconds: number } | null | undefined,
): number {
  return ts && typeof ts.seconds === 'number' ? ts.seconds : 0;
}

/**
 * Derive the practised-words list from the loaded event window.
 *
 * @param events chronological (oldest → newest) events — pass the
 *   `useLifeEvents` data array as-is.
 * @param sinceSeconds window start (e.g. `campaign.acceptedAt.seconds`
 *   or `arc.startedAt.seconds`); events strictly before it are ignored.
 */
export function derivePractisedWords(
  events: ReadonlyArray<LifeEvent>,
  sinceSeconds: number,
): PractisedWord[] {
  const byKey = new Map<string, PractisedWord>();
  const out: PractisedWord[] = [];
  for (const e of events) {
    if (e.kind !== 'correction' && e.kind !== 'flashcard_added') continue;
    if (timestampSeconds(e.createdAt) < sinceSeconds) continue;
    const p = (e.payload ?? {}) as {
      correct?: boolean;
      correctAnswer?: string;
      practice?: string;
      native?: string;
    };
    const raw = e.kind === 'correction' ? p.correctAnswer : p.practice;
    const text = typeof raw === 'string' ? raw.trim() : '';
    if (!text) continue;
    const key = text.toLowerCase();
    const existing = byKey.get(key);
    if (e.kind === 'correction') {
      if (existing) {
        // Latest attempt wins.
        existing.correct = p.correct === true;
      } else {
        const entry: PractisedWord = {
          text,
          translation: null,
          correct: p.correct === true,
        };
        byKey.set(key, entry);
        out.push(entry);
      }
    } else {
      const native = typeof p.native === 'string' ? p.native.trim() : '';
      if (existing) {
        if (!existing.translation && native) existing.translation = native;
      } else {
        const entry: PractisedWord = {
          text,
          translation: native || null,
          correct: null,
        };
        byKey.set(key, entry);
        out.push(entry);
      }
    }
  }
  return out;
}
```

### Edit C3 — NEW FILE `src/screens/LifeScreen/VocabRecapList.tsx` (complete contents)

```tsx
/**
 * LIFE-VOCAB-RECAP-2: "Words you practised" chip list shared by
 * CampaignCompleteScreen + WorldArcCompleteScreen. Pure presentation —
 * the derivation lives in `src/lib/life/vocabRecap.ts`. Renders
 * nothing when the list is empty; caps at MAX_RECAP_WORDS chips with a
 * single "+N more" overflow chip.
 *
 * Spec: docs/specs/life-sim.md §10.9 (LIFE-VOCAB-RECAP-2).
 */
import { useT } from '@/i18n';
import type { PractisedWord } from '@/lib/life/vocabRecap';

const MAX_RECAP_WORDS = 12;

export function VocabRecapList({ words }: { words: PractisedWord[] }) {
  const t = useT();
  if (words.length === 0) return null;
  const shown = words.slice(0, MAX_RECAP_WORDS);
  const overflow = words.length - shown.length;
  return (
    <div data-testid="LifeScreen-VocabRecap">
      <div className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
        {t('life.vocabRecap.title')}
      </div>
      <ul className="mt-1.5 flex flex-wrap gap-1.5">
        {shown.map((w) => (
          <li
            key={w.text.toLowerCase()}
            data-testid="LifeScreen-VocabRecap-Word"
            className="px-2.5 py-1 rounded-full bg-(--color-bg-hover)/50 border border-(--color-border)/40 text-xs text-(--color-fg)"
          >
            <span className="font-medium">{w.text}</span>
            {w.translation && (
              <span className="text-(--color-fg-muted)"> · {w.translation}</span>
            )}
          </li>
        ))}
        {overflow > 0 && (
          <li
            data-testid="LifeScreen-VocabRecap-More"
            className="px-2.5 py-1 rounded-full text-xs text-(--color-fg-muted)"
          >
            {t('life.vocabRecap.more', { count: overflow })}
          </li>
        )}
      </ul>
    </div>
  );
}
```

Notes: `data-testid` follows this surface's established `LifeScreen-*` pattern (`LifeScreen-CampaignComplete`, `LifeScreen-WorldArcComplete`, …) rather than the generic kebab-case suggestion in `docs/conventions.md` — surface-internal consistency wins and every existing E2E selector on this screen uses the pattern. CSS uses only existing theme variables; no new colors.

### Edit C4 — `src/lib/life/campaignLifecycle.ts` (3 edits)

**C4a — import.** ANCHOR (verify unique):

```
} from './npcs';
```

Replace with (this file imports siblings relatively — keep that style):

```ts
} from './npcs';
import { derivePractisedWords, type PractisedWord } from './vocabRecap';
```

**C4b — snapshot type.** ANCHOR (verify unique — the full 7-line block):

```
  stats: {
    gradedCount: number;
    correctCount: number;
    fillBlankCount: number;
    comprehensionCount: number;
  };
};
```

Replace with:

```ts
  stats: {
    gradedCount: number;
    correctCount: number;
    fillBlankCount: number;
    comprehensionCount: number;
  };
  /** LIFE-VOCAB-RECAP-1/2: practised words in the campaign window
   *  (acceptedAt → resolution) — same event window the stats use. */
  words: PractisedWord[];
};
```

**C4c — snapshot computation.** ANCHOR (verify unique):

```
    stats: { gradedCount, correctCount, fillBlankCount, comprehensionCount },
```

Replace with:

```ts
    stats: { gradedCount, correctCount, fillBlankCount, comprehensionCount },
    words: derivePractisedWords(events, acceptedSec),
```

(`acceptedSec` already exists in `snapshotCampaignCompletion` — it is the variable the stats filter uses. Do not restructure the existing stats loop.)

### Edit C5 — `src/screens/LifeScreen/CampaignCompleteScreen.tsx` (4 edits)

**C5a — imports.** ANCHOR (verify unique):

```
import { cn } from '@/lib/cn';
```

Replace with:

```ts
import { cn } from '@/lib/cn';
import { VocabRecapList } from './VocabRecapList';
import type { PractisedWord } from '@/lib/life/vocabRecap';
```

**C5b — props type.** ANCHOR (verify unique — two lines):

```
  };
  onClose: () => void;
```

Replace with:

```ts
  };
  /** LIFE-VOCAB-RECAP-2: words practised during the campaign window,
   *  from `CampaignCompletionSnapshot.words`. */
  words: PractisedWord[];
  onClose: () => void;
```

**C5c — destructure.** ANCHOR (verify unique — three lines):

```
  stats,
  onClose,
  closing,
```

Replace with:

```ts
  stats,
  words,
  onClose,
  closing,
```

**C5d — render.** ANCHOR (verify unique — four lines; the stats grid's closing tag + the CTA button opening):

```
        </div>
        <button
          type="button"
          onClick={onClose}
```

Replace with:

```tsx
        </div>
        <VocabRecapList words={words} />
        <button
          type="button"
          onClick={onClose}
```

### Edit C6 — `src/screens/LifeScreen/WorldArcCompleteScreen.tsx` (4 edits)

**C6a — imports.** ANCHOR (verify unique):

```
import { cn } from '@/lib/cn';
```

Replace with:

```ts
import { cn } from '@/lib/cn';
import { VocabRecapList } from './VocabRecapList';
import type { PractisedWord } from '@/lib/life/vocabRecap';
```

**C6b — props type.** ANCHOR (verify unique):

```
  recurringNpcNames: string[];
```

Replace with:

```ts
  recurringNpcNames: string[];
  /** LIFE-VOCAB-RECAP-2: words practised across the chapter window
   *  (arc.startedAt → now), derived at render time in LifeScreen. */
  words: PractisedWord[];
```

**C6c — destructure.** ANCHOR (verify unique):

```
  recurringNpcNames,
```

Replace with:

```ts
  recurringNpcNames,
  words,
```

**C6d — render.** ANCHOR (verify unique — two lines; the stats grid's closing tag + the recurring-names conditional):

```
        </div>
        {recurringNpcNames.length > 0 && (
```

Replace with:

```tsx
        </div>
        <VocabRecapList words={words} />
        {recurringNpcNames.length > 0 && (
```

### Edit C7 — completion-overlay extraction + words wiring: NEW FILE `src/screens/LifeScreen/LifeCompletionOverlays.tsx` + `src/screens/LifeScreen/LifeScreen.tsx` (3 edits)

**Why an extraction instead of three in-place prop additions:** `LifeScreen.tsx` sits at EXACTLY the ESLint cap today — 600 counted lines against `max-lines: ['error', { max: 600, skipBlankLines: true, skipComments: true }]` (`eslint.config.js`; the only `max-lines` exemptions are test files and `src/i18n/locales/**` — this file has none). Verify before starting, and re-run AFTER C7d (headroom must be ≥ the lines added — the plain Verify-step-3 eslint run enforces the cap, this command shows the actual count):

```bash
npx eslint --rule '{"max-lines":["error",{"max":1,"skipBlankLines":true,"skipComments":true}]}' \
  src/screens/LifeScreen/LifeScreen.tsx
# Prints "File has too many lines (N)" — N is the file's counted size. Today N = 600.
```

Pre-F, adding even ONE counted line to `LifeScreen.tsx` in place fails Verify step 3 and the pre-commit lint hook, so the overlay render block MUST move out. Post-F the file has headroom (phase-f's E5/E7/E8 delete the whole `runStep`/`onPick`/`acceptHook` engine), but the extraction stays — it works under either execution order, keeps this phase's diff out of the file F just rewrote, and gives the overlay pair one presentational home. The requirement after C7d is only ≤ 600 counted lines (pre-F: 600 → ~579).

Phase F's LifeScreen treatment (verified against `phase-f.md` E1–E9): `state.completedCampaign` / `state.arcComplete` and the three handlers (`closeCampaign`, `handleContinueChapter`, `handlePauseChapter`) keep their names (E2/E8); the two overlay-screen imports survive (E1 deletes other imports); the campaignLifecycle import block shrinks to `{ resolveRecurringNames, type CampaignCompletionSnapshot }` (E1); `LocalState.busy` is DELETED and the overlay JSX's `closing=`/`generatingNext=` props are re-pointed at a new `overlayBusy` state (E2/E3/E9). The C7b–C7d anchors below therefore come in two verbatim variants — **POST-PHASE-F (primary)** quoted from phase-f.md's planned post-state, and **PRE-F** quoted from today's file (use only when H runs before F, per the plan's dependency table). If a `grep -F` returns 0 under BOTH variants, the landed code drifted: find the render site of `<CampaignCompleteScreen` / `<WorldArcCompleteScreen` and perform the identical extraction there — the operation and the props contract, not the line positions, are the edit.

**C7a — NEW FILE `src/screens/LifeScreen/LifeCompletionOverlays.tsx` (complete contents):**

```tsx
/**
 * LIFE-CAMPAIGN-10 / LIFE-WORLD-ARC-6/8 / LIFE-VOCAB-RECAP-2: the
 * campaign + chapter completion overlays, extracted from LifeScreen
 * so the vocab-recap wiring lands here instead of growing the host
 * file (at the 600-counted-line ESLint cap when this was authored).
 * Pure presentation — LifeScreen owns all state and handlers.
 *
 * The chapter words list derives HERE at render time from the live
 * events window (arc.startedAt → now); the campaign words arrive
 * precomputed on the snapshot (LIFE-VOCAB-RECAP-2). The derive call
 * is pure and runs over ≤40 items — an inline call in JSX, no
 * `useMemo`, no hooks, so no hook-ordering risk.
 */
import { CampaignCompleteScreen } from './CampaignCompleteScreen';
import { WorldArcCompleteScreen } from './WorldArcCompleteScreen';
import {
  resolveRecurringNames,
  type CampaignCompletionSnapshot,
} from '@/lib/life/campaignLifecycle';
import { derivePractisedWords, timestampSeconds } from '@/lib/life/vocabRecap';
import type { LifeEvent, LifeNpc, WorldArc } from '@/types/firestore';

export function LifeCompletionOverlays({
  completedCampaign,
  arcComplete,
  busy,
  eventsData,
  npcs,
  onCloseCampaign,
  onContinueChapter,
  onPauseChapter,
}: {
  completedCampaign: CampaignCompletionSnapshot | null;
  arcComplete: { arc: WorldArc; snapshot: CampaignCompletionSnapshot } | null;
  busy: boolean;
  /** Chronological `useLifeEvents` window (oldest → newest). */
  eventsData: LifeEvent[];
  npcs: ReadonlyMap<string, LifeNpc>;
  onCloseCampaign: () => void;
  onContinueChapter: () => void;
  onPauseChapter: () => void;
}) {
  return (
    <>
      {completedCampaign && (
        <CampaignCompleteScreen
          title={completedCampaign.title}
          outcomeLine={completedCampaign.outcomeLine}
          tone={completedCampaign.tone}
          stats={completedCampaign.stats}
          words={completedCampaign.words}
          closing={busy}
          onClose={onCloseCampaign}
        />
      )}
      {arcComplete && (
        <WorldArcCompleteScreen
          arc={arcComplete.arc}
          outcomeLine={arcComplete.snapshot.outcomeLine}
          stats={{
            campaignsCompleted:
              arcComplete.arc.completedCampaignMemories.length,
            gradedCount: arcComplete.snapshot.stats.gradedCount,
            correctCount: arcComplete.snapshot.stats.correctCount,
          }}
          recurringNpcNames={resolveRecurringNames(
            arcComplete.arc.recurringNpcIds,
            npcs,
          )}
          words={derivePractisedWords(
            eventsData,
            timestampSeconds(arcComplete.arc.startedAt),
          )}
          generatingNext={busy}
          onContinue={onContinueChapter}
          onPause={onPauseChapter}
        />
      )}
    </>
  );
}
```

(`arc.startedAt` is `Timestamp | undefined` and `timestampSeconds` accepts `undefined` → 0, i.e. "everything in the loaded window" — LIFE-VOCAB-RECAP-2's degrade rule.)

**C7b — LifeScreen imports: swap the two overlay-screen imports for the new component.** ANCHOR (identical pre-F and post-F — phase-f E1 does not touch these two consecutive lines; verify unique):

```
import { CampaignCompleteScreen } from './CampaignCompleteScreen';
import { WorldArcCompleteScreen } from './WorldArcCompleteScreen';
```

Replace with:

```ts
import { LifeCompletionOverlays } from './LifeCompletionOverlays';
```

**C7c — LifeScreen imports: drop `resolveRecurringNames`.** Its only LifeScreen call site is inside the block C7d removes; it moves into the new file. ANCHOR (identical pre-F and post-F — phase-f E1 keeps this line, same indent, in the shrunk import block; verify unique — two-space indent + trailing comma):

```
  resolveRecurringNames,
```

Delete that line only. The rest of the `@/lib/life/campaignLifecycle` import block stays — post-F that leaves `import { type CampaignCompletionSnapshot } from '@/lib/life/campaignLifecycle';` (valid TS; post-F the type is still referenced by LifeScreen's `onCampaignResolved` callback annotation — phase-f.md E1 re-added the import for exactly that after Phase D moved `LocalState` into `lifeScreenState.ts`, which imports the type itself); pre-F it leaves `acceptCampaignHook`, `computeReplanPlan`, `fireBackgroundCampaignPatch`, `snapshotCampaignCompletion`, `type CampaignCompletionSnapshot` — all still used by LifeScreen.

**C7d — LifeScreen render: replace the overlay block with the component.** POST-PHASE-F ANCHOR (primary — this is the post-F block: phase-f E9 re-pointed `closing=`/`generatingNext=` at `overlayBusy`, everything else is unchanged from today. Grep its opening line `{state.completedCampaign && (` and its distinctive tail line `onPause={handlePauseChapter}` → each must print 1, which pins the contiguous 29-line block):

```
        {state.completedCampaign && (
          <CampaignCompleteScreen
            title={state.completedCampaign.title}
            outcomeLine={state.completedCampaign.outcomeLine}
            tone={state.completedCampaign.tone}
            stats={state.completedCampaign.stats}
            closing={overlayBusy}
            onClose={() => void closeCampaign()}
          />
        )}
        {state.arcComplete && (
          <WorldArcCompleteScreen
            arc={state.arcComplete.arc}
            outcomeLine={state.arcComplete.snapshot.outcomeLine}
            stats={{
              campaignsCompleted:
                state.arcComplete.arc.completedCampaignMemories.length,
              gradedCount: state.arcComplete.snapshot.stats.gradedCount,
              correctCount: state.arcComplete.snapshot.stats.correctCount,
            }}
            recurringNpcNames={resolveRecurringNames(
              state.arcComplete.arc.recurringNpcIds,
              npcs.npcs,
            )}
            generatingNext={overlayBusy}
            onContinue={() => void handleContinueChapter()}
            onPause={handlePauseChapter}
          />
        )}
```

Replace with:

```tsx
        <LifeCompletionOverlays
          completedCampaign={state.completedCampaign}
          arcComplete={state.arcComplete}
          busy={overlayBusy}
          eventsData={eventsData}
          npcs={npcs.npcs}
          onCloseCampaign={() => void closeCampaign()}
          onContinueChapter={() => void handleContinueChapter()}
          onPauseChapter={handlePauseChapter}
        />
```

(`eventsData` is the chronological `useLifeEvents` array already in scope in LifeScreen — post-F it also feeds the engine (`phase-f.md` E5: `events: eventsData`), so it is guaranteed present. It feeds the chapter-window derive inside `LifeCompletionOverlays`. After C7a–C7d, re-run the line-count command from the preamble: `LifeScreen.tsx` must print ≤ 600.)

**PRE-F variant of C7d** (only when H runs before F; verified against today's file): the anchor block is identical except the two busy props read `closing={state.busy}` / `generatingNext={state.busy}` — and the replacement passes `busy={state.busy}` instead of `busy={overlayBusy}`. Everything else is byte-identical.

## Tests

Conventions: every `it(...)`/`test(...)` description asserting an invariant starts with the invariant id. Component tests need no i18n provider (`useT` falls back to the `en` catalogue — see `src/screens/Practice/LessonIntro.test.tsx`). Timestamp-like fixtures use the `{ seconds, nanoseconds } as LifeEvent['createdAt']` cast pattern already established in `src/lib/life/campaignLifecycle.test.ts` (this is a test-fixture cast, not an `any`/`ts-ignore`).

### Edit T1 — NEW FILE `src/lib/life/vocabRecap.test.ts` (complete contents)

```ts
import { describe, expect, it } from 'vitest';
import { derivePractisedWords, timestampSeconds } from './vocabRecap';
import type { LifeEvent } from '@/types/firestore';

const at = (seconds: number) =>
  ({ seconds, nanoseconds: 0 }) as LifeEvent['createdAt'];

const correction = (
  correctAnswer: string,
  correct: boolean,
  seconds: number,
): LifeEvent => ({
  id: `c-${correctAnswer}-${seconds}`,
  kind: 'correction',
  payload: {
    kind: 'fill-blank',
    correct,
    picked: correct ? correctAnswer : 'autre',
    correctAnswer,
    promptSource: `… ${correctAnswer} …`,
  },
  createdAt: at(seconds),
});

const flashcard = (
  practice: string,
  native: string,
  seconds: number,
): LifeEvent => ({
  id: `f-${practice}-${seconds}`,
  kind: 'flashcard_added',
  payload: { id: `card-${practice}`, practice, native },
  createdAt: at(seconds),
});

describe('derivePractisedWords — LIFE-VOCAB-RECAP-1', () => {
  it('LIFE-VOCAB-RECAP-1 — corrections in the window contribute correctAnswer + outcome', () => {
    const words = derivePractisedWords(
      [correction('voudrais', false, 150), correction('le marché', true, 200)],
      100,
    );
    expect(words).toEqual([
      { text: 'voudrais', translation: null, correct: false },
      { text: 'le marché', translation: null, correct: true },
    ]);
  });

  it('LIFE-VOCAB-RECAP-1 — events before sinceSeconds are excluded', () => {
    const words = derivePractisedWords(
      [correction('avant', true, 50), flashcard('aussi avant', 'also before', 99)],
      100,
    );
    expect(words).toEqual([]);
  });

  it('LIFE-VOCAB-RECAP-1 — flashcard_added contributes practice text + native gloss', () => {
    const words = derivePractisedWords(
      [flashcard('la boulangerie', 'the bakery', 150)],
      100,
    );
    expect(words).toEqual([
      { text: 'la boulangerie', translation: 'the bakery', correct: null },
    ]);
  });

  it('LIFE-VOCAB-RECAP-1 — dedupes case-insensitively; latest correction wins; flashcard fills translation', () => {
    const words = derivePractisedWords(
      [
        correction('Quand même', false, 110),
        flashcard('quand même', 'even so', 120),
        correction('quand même', true, 130),
      ],
      100,
    );
    expect(words).toEqual([
      { text: 'Quand même', translation: 'even so', correct: true },
    ]);
  });

  it('LIFE-VOCAB-RECAP-1 — empty or missing payload text is skipped', () => {
    const events: LifeEvent[] = [
      { id: 'e1', kind: 'correction', payload: { correct: true }, createdAt: at(150) },
      {
        id: 'e2',
        kind: 'correction',
        payload: { correct: true, correctAnswer: '   ' },
        createdAt: at(150),
      },
      {
        id: 'e3',
        kind: 'flashcard_added',
        payload: { native: 'no practice text' },
        createdAt: at(150),
      },
    ];
    expect(derivePractisedWords(events, 100)).toEqual([]);
  });

  it('LIFE-VOCAB-RECAP-1 — non-practice event kinds are ignored', () => {
    const events: LifeEvent[] = [
      { id: 'b1', kind: 'beat', payload: { practiceText: 'Salut' }, createdAt: at(150) },
      { id: 'd1', kind: 'decision', payload: { text: 'partir' }, createdAt: at(150) },
      correction('voudrais', true, 150),
    ];
    expect(derivePractisedWords(events, 100)).toHaveLength(1);
  });

  it('LIFE-VOCAB-RECAP-1 — missing createdAt counts as seconds 0 (excluded by a positive window)', () => {
    const noTs: LifeEvent = {
      id: 'n1',
      kind: 'correction',
      payload: { correct: true, correctAnswer: 'sans date' },
    };
    expect(derivePractisedWords([noTs], 1)).toEqual([]);
    expect(derivePractisedWords([noTs], 0)).toHaveLength(1);
  });
});

describe('timestampSeconds — LIFE-VOCAB-RECAP-1', () => {
  it('LIFE-VOCAB-RECAP-1 — reads .seconds; 0 on null/undefined', () => {
    expect(timestampSeconds({ seconds: 42 })).toBe(42);
    expect(timestampSeconds(null)).toBe(0);
    expect(timestampSeconds(undefined)).toBe(0);
  });
});
```

### Edit T2 — `src/lib/life/campaignLifecycle.test.ts`: one new test

ANCHOR (verify unique — end of the last test in the `snapshotCampaignCompletion` describe; the three closing lines are the final lines of the file):

```
    expect(snap.stats.gradedCount).toBe(1);
  });
});
```

Replace with:

```ts
    expect(snap.stats.gradedCount).toBe(1);
  });

  it('LIFE-VOCAB-RECAP-2 — snapshot carries practised words from the campaign window', () => {
    const campaign = baseCampaign();
    (campaign as { acceptedAt: { seconds: number } }).acceptedAt = {
      seconds: 100,
    };
    const events: LifeEvent[] = [
      {
        id: 'w-old',
        kind: 'correction',
        payload: { correct: true, kind: 'fill-blank', correctAnswer: 'avant' },
        createdAt: { seconds: 50, nanoseconds: 0 } as LifeEvent['createdAt'],
      },
      {
        id: 'w-new',
        kind: 'correction',
        payload: { correct: false, kind: 'fill-blank', correctAnswer: 'voudrais' },
        createdAt: { seconds: 150, nanoseconds: 0 } as LifeEvent['createdAt'],
      },
      {
        id: 'w-card',
        kind: 'flashcard_added',
        payload: { id: 'card-1', practice: 'la boulangerie', native: 'the bakery' },
        createdAt: { seconds: 160, nanoseconds: 0 } as LifeEvent['createdAt'],
      },
    ];
    const snap = snapshotCampaignCompletion(
      campaign,
      { endingKey: 'open', outcomeLine: '.' },
      events,
    );
    expect(snap.words).toEqual([
      { text: 'voudrais', translation: null, correct: false },
      { text: 'la boulangerie', translation: 'the bakery', correct: null },
    ]);
  });
});
```

### Edit T3 — NEW FILE `src/screens/LifeScreen/CampaignCompleteScreen.test.tsx` (complete contents)

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CampaignCompleteScreen } from './CampaignCompleteScreen';
import type { PractisedWord } from '@/lib/life/vocabRecap';

const BASE = {
  title: 'The Gallery Show',
  outcomeLine: 'Your photos made the wall.',
  tone: 'hopeful',
  stats: {
    gradedCount: 4,
    correctCount: 3,
    fillBlankCount: 2,
    comprehensionCount: 2,
  },
  onClose: () => {},
};

const word = (
  text: string,
  translation: string | null = null,
): PractisedWord => ({ text, translation, correct: true });

describe('CampaignCompleteScreen — LIFE-VOCAB-RECAP-2', () => {
  it('LIFE-VOCAB-RECAP-2 — renders the practised-words list with text + gloss', () => {
    render(
      <CampaignCompleteScreen
        {...BASE}
        words={[word('voudrais'), word('la boulangerie', 'the bakery')]}
      />,
    );
    expect(screen.getByTestId('LifeScreen-VocabRecap')).toBeInTheDocument();
    expect(screen.getByText('Words you practised')).toBeInTheDocument();
    expect(screen.getAllByTestId('LifeScreen-VocabRecap-Word')).toHaveLength(2);
    expect(screen.getByText('voudrais')).toBeInTheDocument();
    expect(screen.getByText('· the bakery')).toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-2 — empty list renders no recap section', () => {
    render(<CampaignCompleteScreen {...BASE} words={[]} />);
    expect(screen.queryByTestId('LifeScreen-VocabRecap')).not.toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-2 — caps at 12 chips and shows a "+N more" overflow chip', () => {
    const words = Array.from({ length: 15 }, (_, i) => word(`mot-${i}`));
    render(<CampaignCompleteScreen {...BASE} words={words} />);
    expect(screen.getAllByTestId('LifeScreen-VocabRecap-Word')).toHaveLength(12);
    expect(screen.getByTestId('LifeScreen-VocabRecap-More')).toHaveTextContent(
      '+3 more',
    );
  });
});
```

### Edit T4 — NEW FILE `src/screens/LifeScreen/WorldArcCompleteScreen.test.tsx` (complete contents)

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorldArcCompleteScreen } from './WorldArcCompleteScreen';
import type { WorldArc } from '@/types/firestore';
import type { PractisedWord } from '@/lib/life/vocabRecap';

const ARC: WorldArc = {
  chapterNumber: 2,
  premise: 'Prove yourself at the gallery.',
  themes: [],
  status: 'completed',
  recurringNpcIds: [],
  completedCampaignMemories: [],
};

const BASE = {
  arc: ARC,
  outcomeLine: 'The chapter closes on a full wall.',
  stats: { campaignsCompleted: 3, gradedCount: 12, correctCount: 9 },
  recurringNpcNames: ['Sophie'],
  generatingNext: false,
  onContinue: () => {},
  onPause: () => {},
};

describe('WorldArcCompleteScreen — LIFE-VOCAB-RECAP-2', () => {
  it('LIFE-VOCAB-RECAP-2 — renders the chapter practised-words list', () => {
    const words: PractisedWord[] = [
      { text: 'le marché', translation: null, correct: true },
      { text: 'quand même', translation: 'even so', correct: false },
    ];
    render(<WorldArcCompleteScreen {...BASE} words={words} />);
    expect(screen.getByTestId('LifeScreen-VocabRecap')).toBeInTheDocument();
    expect(screen.getByText('Words you practised')).toBeInTheDocument();
    expect(screen.getByText('le marché')).toBeInTheDocument();
    expect(screen.getByText('quand même')).toBeInTheDocument();
    expect(screen.getByText('· even so')).toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-2 — empty list renders no recap section', () => {
    render(<WorldArcCompleteScreen {...BASE} words={[]} />);
    expect(screen.queryByTestId('LifeScreen-VocabRecap')).not.toBeInTheDocument();
  });
});
```

### Edit T5 — E2E: `tests/e2e/specs/life-flow.spec.ts`

Tier: this file carries no `@critical`/`@full` tag, so it runs in the `@standard` tier by construction (`test:e2e:standard` = `--grep-invert @full`). Do NOT add a tag to the new test.

**The target file is Phase F's rewrite** (`phase-f.md` F7-c): `test.describe.serial('life-sim node engine (mocked Gemini)', …)` with module-scope `userA` / `page` / `worldId`, a `seedWorld()`-created world (saga + `currentArc` inline, NO `startedAt` on the arc), admin helpers `getAdminFirestore` / `captureBeat`, `RawNodeResponseInput` already imported from `stepSchema`, and two final `LIFE-FLOW-5` tests — the resume-recap test (which contains the `__resume__` resume-chip flow, folding the old LIFE-FLOW-2 resume assertions into the recap-screen test) followed by the world-exit recap-generator test, which is the describe's last test and deliberately ends with the page on `/life/overview`. All anchors below are POST-PHASE-F, quoted verbatim from F7-c. Contracts the implementer must NOT change even if envelope field names drifted: the `campaign.resolved` payload keys (`endingKey`, `outcomeLine`, `arcStage: 'concluding'`) and every assertion in T5c. A compact **PRE-F variant** (only when H runs before F) closes this section.

**T5a — imports.** Add the admin SDK import (needed for `admin.firestore.Timestamp.fromMillis`; `firebase-admin` is already a dependency of `tests/e2e/package.json` and the helper file imports it the same way). ANCHOR (identical today and post-F — the file's first import; verify unique):

```
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
```

Replace with:

```ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test';
import * as admin from 'firebase-admin';
```

**T5b — fixture.** POST-PHASE-F ANCHOR (the tail of F7-c's last fixture constant, `RESUME_LIVE`; grep the line `      practiceText: 'Rester ici',` → must print 1, which pins the block):

```
    {
      id: 'y',
      practiceText: 'Rester ici',
      nativeText: 'Stay here',
      noPreview: true,
    },
  ],
};
```

Insert AFTER that block (one blank line between):

```ts
/** Phase H: a live resume turn that resolves the active campaign with
 *  arcStage 'concluding'. Continuation node → exactly one option with
 *  id 'continue' (schema superRefine); noPreview satisfies the
 *  next-XOR-noPreview rule. The overlay blocks before the option is
 *  ever pickable, so no follow-up fixture is needed. */
const RESOLVING_TURN: RawNodeResponseInput = {
  node: {
    kind: 'continuation',
    beats: [
      {
        speaker: 'narrator',
        practiceText: 'Le vernissage se termine. Tout le monde applaudit.',
        nativeText: 'The opening night winds down. Everyone applauds.',
      },
    ],
  },
  options: [
    {
      id: 'continue',
      practiceText: 'Continuer',
      nativeText: 'Continue',
      noPreview: true,
    },
  ],
  campaign: {
    resolved: {
      endingKey: 'gallery-success',
      outcomeLine: 'Your photos made the gallery wall.',
      arcStage: 'concluding',
    },
  },
};
```

(`RawNodeResponseInput` is already imported in the post-F spec — F7-c line `import type { RawNodeResponseInput } from '../../../src/lib/life/stepSchema';`. The `campaign` envelope survives Phase F unchanged: `ZRawNodeResponse.campaign = ZStepCampaignSignal.optional()`.)

**T5c — the test.** POST-PHASE-F ANCHOR (the tail of F7-c's final `LIFE-FLOW-5` world-exit test + the describe's closing brace — the last 3 lines of the file's describe block; `      .toBe(true);` on its own line appears 6× in the post-F file, so pin the block by grepping `recap.lastEventId !== 'seeded-nonexistent-event'` → must print 1: that line sits 5 lines above this tail (4 lines between), at the bottom of the same `expect.poll` callback whose `.toBe(true);` opens the anchor):

```
      .toBe(true);
  });
});
```

Replace with (i.e. append the new test between the world-exit test's closing `  });` and the describe's closing `});`):

```ts
      .toBe(true);
  });

  test('LIFE-VOCAB-RECAP-2 — completion screens list words practised in their window', async ({}, testInfo) => {
    // Seed (admin SDK, real Firestore): an active campaign accepted
    // 60s ago, the seeded chapter re-stamped as started 120s ago, and
    // three practice-derived events at known offsets:
    //   - 'le marché'      correction  90s ago → chapter window ONLY
    //   - 'voudrais'       correction  30s ago → campaign + chapter
    //   - 'la boulangerie' flashcard   20s ago → campaign + chapter
    // Earlier tests in this serial file wrote a REAL 'voudrais'
    // correction (correct: true, live timestamp) — harmless: the
    // assertions below check presence, never the correct flag, and
    // no earlier fixture tests 'le marché'.
    const db = getAdminFirestore();
    const secsAgo = (s: number) =>
      admin.firestore.Timestamp.fromMillis(Date.now() - s * 1000);

    await db.doc(`users/${userA.uid}/lifeWorlds/${worldId}`).update({
      currentArc: {
        chapterNumber: 1,
        premise: 'Settle into the neighbourhood.',
        themes: [],
        status: 'active',
        recurringNpcIds: [],
        completedCampaignMemories: [],
        startedAt: secsAgo(120),
      },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${worldId}/campaigns/active`)
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
      `users/${userA.uid}/lifeWorlds/${worldId}/events`,
    );
    await eventsCol.add({
      kind: 'correction',
      payload: {
        kind: 'fill-blank',
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
        kind: 'fill-blank',
        correct: false,
        picked: 'veux',
        correctAnswer: 'voudrais',
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

    await installLifeMock(page, {
      steps: [RESOLVING_TURN],
      scenes: [minimalSceneSvg()],
    });
    // The preceding world-exit test ends with the page on
    // /life/overview, so navigate back into the world (a reload
    // would just reload the overview).
    await page.goto(`/life/${worldId}`);
    await page.waitForLoadState('domcontentloaded');
    // Phase C: entering a world with events shows the
    // WurldResumeScreen first; Continue releases the resume chip.
    // Mirror the dismissal the landed resume test above uses.
    await page
      .getByTestId('LifeScreen-WurldResume-Continue')
      .click({ timeout: 15_000 });
    const resumeChip = page.getByTestId('LifeScreen-Choice-__resume__');
    await expect(resumeChip).toBeVisible({ timeout: 15_000 });
    await resumeChip.click();

    // POST-CONDITION 1 — campaign screen shows campaign-window words
    // derived from the REAL Firestore events seeded above.
    const campaignOverlay = page.getByTestId('LifeScreen-CampaignComplete');
    await expect(campaignOverlay).toBeVisible({ timeout: 15_000 });
    const campaignRecap = campaignOverlay.getByTestId('LifeScreen-VocabRecap');
    await expect(campaignRecap).toBeVisible();
    await expect(campaignRecap).toContainText('voudrais');
    await expect(campaignRecap).toContainText('la boulangerie');
    await expect(campaignRecap).toContainText('the bakery');
    // 'le marché' pre-dates acceptedAt → excluded from the campaign list.
    await expect(campaignRecap).not.toContainText('le marché');
    await captureBeat(page, testInfo, 'campaign-complete-vocab');

    // POST-CONDITION 2 — Return home archives the campaign; the
    // chapter screen shows the WHOLE chapter window (arc.startedAt),
    // which includes the pre-campaign correction.
    await page.getByTestId('LifeScreen-CampaignComplete-Return').click();
    const arcOverlay = page.getByTestId('LifeScreen-WorldArcComplete');
    await expect(arcOverlay).toBeVisible({ timeout: 15_000 });
    const arcRecap = arcOverlay.getByTestId('LifeScreen-VocabRecap');
    await expect(arcRecap).toBeVisible();
    await expect(arcRecap).toContainText('le marché');
    await expect(arcRecap).toContainText('voudrais');
    await expect(arcRecap).toContainText('la boulangerie');
    await captureBeat(page, testInfo, 'arc-complete-vocab');
  });
});
```

Notes on determinism: the resolve turn needs NO graded-question or campaign-gen Gemini traffic — the post-F mock 500s every unregistered `life_*` category (background bio/avatar kickoffs fail fast and are tolerated by design), so the only consumed fixture is `RESOLVING_TURN`. `Return home` runs pure Firestore writes (`closeCampaignFlow` + `archiveActiveArc`), no Gemini. The test ends on the arc overlay WITHOUT tapping "Continue your wurld" — that CTA would fire a real `runWorldArcGenerate` (unmocked category → 500 toast) and is out of this test's scope.

After the run, open the two captured screenshots (`campaign-complete-vocab`, `arc-complete-vocab`) with the Read tool and check the chip list visually: chips wrap inside the card, the muted glosses are legible, nothing overflows the modal.

**PRE-F variant of T5** (only when H runs before Phase F lands — the plan's dependency table allows it; H depends only on D). Against TODAY'S file (`test.describe.serial('life-sim flow (mocked Gemini)')`, `StepResponse` fixtures, no module `worldId`):

1. T5a is unchanged (same first-import anchor).
2. The fixture goes after today's last fixture constant `FOLLOW_UP_AFTER_FILL_BLANK`, in today's `StepResponse` shape (`StepResponse` is already imported), same `campaign.resolved` contract:

```ts
const RESOLVING_TURN: StepResponse = {
  beats: [
    {
      speaker: 'narrator',
      practiceText: 'Le vernissage se termine. Tout le monde applaudit.',
      nativeText: 'The opening night winds down. Everyone applauds.',
    },
  ],
  choices: [
    { id: 'continue', practiceText: 'Continuer', nativeText: 'Continue' },
  ],
  campaign: {
    resolved: {
      endingKey: 'gallery-success',
      outcomeLine: 'Your photos made the gallery wall.',
      arcStage: 'concluding',
    },
  },
};
```

3. In the test body: there is no module `worldId` — derive it from the page URL, which the serial file is still parked on: the onboarding test's `waitForURL(/^\/life\/w-/)` landed on the world route, and no later test navigates away (the resume test only `page.reload()`s), so this test only runs with the page on `/life/w-…`. Do NOT resolve it by querying `users/{uid}/lifeWorlds` with an un-ordered `.limit(1)` — `wipeLifeData` only wipes the legacy `lifeWorld`/`lifeEvents`/`lifeNpcs`/`lifeScenes` collections (never `lifeWorlds`), so after a crashed prior run (`afterAll` skipped → same uid, stale worlds persist) that query can return a stale world, seeding and asserting against a world the page isn't showing:

```ts
    const worldId = new URL(page.url()).pathname.split('/').pop()!;
```

   and the seeded `currentArc` write replaces whatever the onboarding's background arc-gen produced (`LIFE-WORLD-6` fires chapter-1 generation at world creation; today's mock passes non-step categories through to the real network) — same literal as the primary body. Drop the `LifeScreen-WurldResume-Continue` click ONLY if Phase C has not landed either (no `WurldResumeScreen` in `src/screens/LifeScreen/` → no overlay to dismiss); the insertion anchor is today's resume-test tail (`await captureBeat(page, testInfo, 'resume-prompt');` + `  });` + `});`). Everything else — seeding, mock install, assertions, screenshots — is identical to the primary body.

## Verify

Run from the repo root, in this order; all must be clean:

```bash
# 1. Scoped unit + component tests (must have FAILED before implementation, step 3):
npx vitest run src/lib/life/vocabRecap.test.ts src/lib/life/campaignLifecycle.test.ts src/screens/LifeScreen/CampaignCompleteScreen.test.tsx src/screens/LifeScreen/WorldArcCompleteScreen.test.tsx

# 2. Full unit suite:
npm test

# 3. Types + lint. Pre-F LifeScreen.tsx was at EXACTLY 600/600 counted
#    lines — this run enforces the max-lines cap after the C7 extraction
#    (must be ≤ 600; see the Edit C7 preamble for the counter command):
npm run typecheck
npx eslint src/lib/life/vocabRecap.ts src/lib/life/campaignLifecycle.ts src/screens/LifeScreen/VocabRecapList.tsx src/screens/LifeScreen/LifeCompletionOverlays.tsx src/screens/LifeScreen/CampaignCompleteScreen.tsx src/screens/LifeScreen/WorldArcCompleteScreen.tsx src/screens/LifeScreen/LifeScreen.tsx src/i18n/locales/en.ts

# 4. The E2E test (real Firebase + mocked Gemini; @standard tier). The file is a
#    serial suite — run the whole spec, not just the new test:
cd tests/e2e && npx playwright test specs/life-flow.spec.ts

# 5. Read every screenshot the E2E run captured (screenshots/<run-id>/…) and
#    check the recap list renders correctly on both overlays.
```

## Out of scope — do NOT touch

- **Why?-explain wiring** (`buildLifeExplainQuestion`, `ExplainModal`, `PracticeFeedback` `onExplain`) — landed with Phase D2 (`phase-d.md` Edit 5); do not duplicate, move, or modify it here.
- **The Phase F engine** — `commitNode.ts` / `generateStepOptions.ts` / `useNodeEngine.ts` / `stepSchema.ts` / any prompt file (pre-F: `runLifeStep.ts`); the correction-event payload shape is read-only input here.
- **The resume-recap screen / `resumeRecap` world field** (Phase C — T5 only CLICKS its Continue CTA) and `useWorldThumbnail` (Phase B).
- **`useLifeEvents`'s 40-event limit and query shape** — no new Firestore queries, no limit change (design decision in §20).
- **`snapshotCampaignCompletion`'s existing stats loop** — add the `words` field only; do not restructure the counting.
- **The arc screen's `gradedCount`/`correctCount` source** — the chapter-stats window mismatch is flagged in Contradiction 5 and deliberately NOT fixed in this phase.
- **`appendFlashcardEvent` / any `flashcard_added` writer** — deliberately deferred (`phase-e.md`: the producer is the unimplemented `LIFE-FLOW-2` resume seeding, "do not add one").
- **The other 80 locale files** — `en.ts` only; regen is a separate user-triggered step (now a §19 backlog bullet).
- **The existing §19 `cachedContent` bullet** — leave its text untouched; the new backlog block only adds a pointer bullet.
- Any file not named in an edit above.
