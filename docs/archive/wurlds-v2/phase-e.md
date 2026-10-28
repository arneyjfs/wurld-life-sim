# Phase E — Tappable vocab + save-as-flashcard

Give the wurld dialogue surface the chat bubbles' best learning affordance: every NPC, narrator, and user bubble renders its practice text with the model-flagged hard words (`complexWords`) underlined; tapping a word opens the chat `WordPopover` with the word's native gloss (`wordTranslations`) and a save-to-flashcards toggle. The model already emits these annotations on every beat and `runLifeStep` already persists them to beat events — the client render path currently drops them. This phase plumbs them end-to-end (Bubble type → beat→Bubble map → resume rehydration → practice-resolution bubbles), extends `ZStepChoice` so chips can carry the same annotations (chips render PLAIN — annotations activate only when the chip's line lands as the player's spoken bubble), and adds the save/unsave path via a new `useLifeWordSave` hook with a story-context stamp on each card.

**Invariant ids covered:** `LIFE-BUBBLE-7` (rewritten from its "(Phase D wires the save-word UI)" stub to the implemented contract). No new invariant-id prefix is introduced (`LIFE-BUBBLE-*` already exists in the `docs/specs/README.md` prefix table), so no prefix-table row changes — only one cross-spec-map row update (below).

## Contradictions

No spec contradictions. Three source-drift corrections + one coordination note (intent of the approved plan kept; details corrected against source):

1. **Plan drift — beat persistence is already done.** The approved plan says to "persist them through `appendBeatEvent` (`src/lib/life/world.ts:220`) + `ZLifeBeatPayload`". In current source, `ZLifeBeatPayload` (`src/types/firestore.ts:979`) already carries `complexWords`/`wordTranslations`, and `runLifeStep.ts:394-402` already passes them into `appendBeatEvent`. **Do NOT edit `world.ts` or `ZLifeBeatPayload` — they need no change.** The only missing persist site is the practice-resolution bubble write in `LifeScreen.onFeedbackContinue` (edit E15 below). The missing plumbing is otherwise all on the read/render path.
2. **Plan drift — `FlashcardMatch` lives in `ActionBar.tsx`**, not in LifeScreen (the plan implies it's LifeScreen-local). The type extension (add `id`) lands in `ActionBar.tsx` (edit E9).
3. **LOC-cap pressure.** `LifeScreen.tsx` sits at the `max-lines` 600 boundary (counted sans blanks/comments; Phase C lands it at ≈590, Phase D adds its explain wiring with its own designed extraction `lifeScreenState.ts`). Phase E adds ~14 counted lines to LifeScreen (edits E13–E17), so it EXTRACTS the flashcard-lookup memo into a new `useFlashcardLookup.ts` hook (edits E10–E12), making this phase net-negative on LifeScreen code lines. This is the sanctioned "design extractions when needed" move, not scope creep.
4. **Coordination with Phases C + D (both land before E; this doc's anchors were reconciled against their published implementation docs).** Phase C (`docs/plans/wurlds-v2/phase-c.md`) REPLACES `src/lib/life/resumeBubbles.ts` wholesale (adds a `count` param + `buildResumeSeed`), appends to `src/lib/life/resumeBubbles.test.ts` (its T5b consumes the pre-C file ending), and edits `LifeScreen.tsx` (opening-effect gating, imports, exit hook after `const eventsLoaded`), `en.ts`, `lifeMock.ts`, and `life-flow.spec.ts` (Begin-click inside the onboarding test; replaces the old resume test with two LIFE-FLOW-5 tests). Phase D (`docs/plans/wurlds-v2/phase-d.md`) REPLACES everything in `DialogueArea.tsx` from `function BubbleView({` to end-of-file (adds `viewMode` + a `bubbleTexts()` primary/secondary resolver — the primary line is the NATIVE text in `native-only` mode), replaces ActionBar's `hideChipNative` with `chipDisplay`, extracts `lifeScreenState.ts` from LifeScreen, CREATES `src/screens/LifeScreen/DialogueArea.test.tsx` (its T5), and edits `life-flow.spec.ts` (fixture gloss changes on OUTBOUND_PRACTICE + new tests far below the onboarding test). Consequences absorbed below: (a) every anchor inside a region C or D rewrites is quoted from that phase's planned POST-state and marked **POST-PHASE-C ANCHOR** / **POST-PHASE-D ANCHOR** — verify those against the tree AFTER C/D are merged (they do NOT exist in the pre-C/D tree); (b) `BubbleVocabText` takes the rendered line as a `text` prop and annotates ONLY when that line IS the `practiceText` (in `native-only` mode the primary is the native line and renders plain); (c) the DialogueArea test file is EDITED (appended), not created; (d) the resumeBubbles edits are targeted patches against C's post-state file. Unmarked anchors were verified `grep -F -c` == 1 against the current tree AND sit outside every C/D edit region (one exception: Spec change 2's anchor line is also Phase C S3's insertion anchor — see the note there). If any anchor fails to grep at execution time, STOP and report — do not guess.

## Read first

Spec sections (in `docs/specs/life-sim.md`):
- §9 "Two-bubble dialogue window — LIFE-BUBBLE-*" (the surface you are extending; LIFE-BUBBLE-7 is yours).
- §9.5 "Interaction contract — LIFE-CONTRACT-*" (why chip text never renders directly; why the resolved bubble is the render surface for a picked chip's line).
- §10 "Embedded exercises — LIFE-EX-*", specifically LIFE-EX-VOCAB-1 (the chip-level flashcard-match popover that already exists — distinct from and unaffected by this phase); and §9.6 "Language display system — LIFE-LANG-*" (added by Phase D), specifically LIFE-LANG-4 — the `hideNativeForUtterance` comprehension-source gate whose precedence the vocab-tap suppression mirrors.
- `docs/specs/README.md` — invariant-id conventions + the cross-spec interaction map (you update one row).
- `docs/conventions.md` — §Test selectors (role-first, `data-testid` second), file-size cap, import rules.

Planned post-states this doc anchors against (E lands after C + D are merged; read these to recognise the code you'll be editing):
- `docs/plans/wurlds-v2/phase-c.md` — its E2 (`resumeBubbles.ts` full replacement), T5 (`resumeBubbles.test.ts` append), E7 (LifeScreen exit hook).
- `docs/plans/wurlds-v2/phase-d.md` — its Edit 7e (DialogueArea below-`BubbleView` replacement incl. `bubbleTexts()`), Edit 6 (ActionBar `chipDisplay`), Edit 11/12 (`lifeScreenState.ts` extraction), T5 (`DialogueArea.test.tsx`).

Source files (all paths relative to `/Users/jamesarney/wurld`):
- `src/screens/LifeScreen/DialogueArea.tsx` — `Bubble` type + the three bubble views you edit (post-D shape: `bubbleTexts()` resolves each bubble's `primary`/`secondary` line per viewMode).
- `src/screens/LifeScreen/LifeScreen.tsx` — beat→Bubble map (`applyResponse`), `flashcardLookup` memo, `onFeedbackContinue`.
- `src/components/Message/AnnotatedText.tsx` + `src/components/Message/WordPopover.tsx` — the presentational components you REUSE untouched.
- `src/store/vocabStore.ts` — the global single-open-popover store you reuse untouched (`useActiveWordFor(id)` / `toggle(id, word)`; string keys, bubble ids work).
- `src/lib/flashcards.ts` — `addFlashCard` (line 389; signature `addFlashCard(uid, NewFlashCardInput)`) + `deleteFlashcard` you call.
- `src/lib/life/stepSchema.ts` (`ZStepBeat`, `ZStepChoice`), `src/lib/life/resolvedBubble.ts`, `src/lib/life/resumeBubbles.ts`, `src/lib/life/prompts/step.ts`.
- `src/hooks/useMessageActions.ts` lines 79–155 — chat's word-save pattern (read for context only; deliberately NOT reused — it is chat-message-coupled).
- `tests/e2e/specs/life-flow.spec.ts` + `tests/e2e/helpers/lifeMock.ts` — the mocked-Gemini E2E harness you extend.

## Spec changes

### 1. `docs/specs/life-sim.md` — rewrite the LIFE-BUBBLE-7 row

ANCHOR (verify unique — this is the ENTIRE existing table row, one line in the file):

```markdown
| **LIFE-BUBBLE-7** | Save-word from a bubble (long-press a word in either language) routes through the existing `addFlashCard` path same as chat. The new card emits a `flashcard_added` event on next session resume (`LIFE-FLOW-2`). (Phase D wires the save-word UI.) |
```

Replace that one row with exactly:

```markdown
| **LIFE-BUBBLE-7** | **Tappable vocab + save-as-flashcard.** All three bubble treatments (narrator system cue, NPC, user) render their primary line through the chat surface's `AnnotatedText`: when the primary line IS the beat's `practiceText`, its `complexWords` render underlined; tapping a word opens a `WordPopover` under the text with the word's native gloss (from `wordTranslations`, case-tolerant lookup) and a save toggle. Annotations attach to `practiceText` ONLY — when the wurld's viewMode makes the native line the primary (`LIFE-LANG-3` `native-only`), that line renders plain (no underlines, no taps); practice-primary renders (`visible`, `hidden`, the `native-only` missing-gloss fallback, and the gate-held comprehension source) are the tappable surface. At most ONE popover is open across the whole surface (global `vocabStore`, keyed by bubble id). Save routes through the shared `addFlashCard` path (same write path as chat + practice, `PRACTICE-SAVE-3`) with the story context stamped on the card: `"<practiceText>" — <speaker>, <location>` (speaker = NPC name, the character's name for user bubbles, or a localized "Narrator"). A saved word's toggle deletes via `deleteFlashcard` using the card id from the live deck lookup — saved state derives from the deck (case-insensitive phrase match), never from per-session component state, so it survives remount/resume and syncs across devices. Annotations travel end-to-end: `ZStepBeat` → `Bubble` → beat event (`ZLifeBeatPayload.complexWords`/`wordTranslations`, written by `runLifeStep` AND by the practice-resolution bubble persist) → `resumeBubblesFromEvents`, so resumed bubbles stay tappable. Chips (`ZStepChoice`) MAY carry the same optional annotation fields but chips render PLAIN — a chip's tap already means "pick this option" and two competing tap actions on one chip are forbidden; on practice resolution the correct chip's annotations activate in the resolved user bubble (`buildResolvedBubble`). EXCLUDED surfaces: `PracticePromptCard` and the feedback overlay (a per-word native gloss on the question card would leak the graded answer), and the comprehension-source NPC bubble while its gloss is hidden (`hideNativeForUtterance` suppresses vocab taps too, until tap-to-reveal — same precedence as the gloss gate). Free-text input produces no immediate bubble (`LIFE-CONTRACT-BUBBLE-3`) and no annotation path of its own — the player's own typed words are never annotated; beats the model emits in response are ordinary beats and MAY carry annotations like any other. The new card emits a `flashcard_added` event on next session resume (`LIFE-FLOW-2`). |
```

### 2. `docs/specs/life-sim.md` — append one Design decisions block

ANCHOR (verify unique — the closing sentence of §20 "Why frozen practice language"; it is the tail of that paragraph's single line, so match it as a substring. POST-PHASE-C the file no longer ends here: C's S3 appended "### Why the resume recap assembles from stored data (wurlds-v2 Phase C)" after this same line. Insert the new block after the anchor line — it will sit between the frozen-practice-language paragraph and C's subsection, which is fine — §20 subsections are unordered):

```markdown
This also lets the LLM context safely assume "every event row is in this one language pair" without per-event language fields.
```

Insert AFTER that line (with one blank line between):

```markdown
### Why bubble vocab taps skip chips and the practice-prompt card (Phase E)

Chips already carry a primary tap action — pick the option. Per-word taps inside a chip would create two competing gestures on a small target, so chips render plain; once a chip's line lands as a bubble at practice resolution, its words become tappable there (same information, one gesture per surface). The `PracticePromptCard` is excluded entirely: on a graded turn the card IS the question, and a tap-to-gloss on its words would hand the player the answer — the same reasoning as `hideNativeForUtterance`, which therefore also suppresses vocab taps on the comprehension-source bubble until the player spends the reveal. Annotations bind to the practice line only: in `native-only` viewMode the bubble's primary line is the native text, which renders plain — underlining native words to show practice-side glosses would invert the learning direction for no benefit. The save path stamps `"<practiceText>" — <speaker>, <location>` into the card's `context` so a review weeks later recalls the scene the word came from. Unsave resolves the card id from the live deck lookup rather than a per-session ref (chat's approach) so the toggle still works after remount/resume; the trade-off is that ANY deck card with the same phrase (case-insensitive, same practice language) reads as "saved" — acceptable, since deleting that card is what an unsave should do anyway. Revisit if per-word saves need to be scoped to their source bubble.
```

### 3. `docs/specs/README.md` — update one cross-spec interaction map row

ANCHOR (verify unique):

```markdown
| Save-concept writes a flashcard | PRACTICE-SAVE-3 | Both practice + chat-side word save use `addFlashCard`; dedupe + topic-classify behaviour is shared. |
```

Replace with:

```markdown
| Save-concept writes a flashcard | PRACTICE-SAVE-3 + LIFE-BUBBLE-7 | Practice, chat-side word save, AND life-bubble word save all use `addFlashCard`; dedupe + topic-classify behaviour is shared. |
```

## Ordered steps

Execute strictly in this order. Every `ANCHOR (verify unique)` must be checked with `grep -F -c '<first line of anchor>' <file>` (and visually for the following lines) BEFORE editing. Anchors marked **POST-PHASE-C ANCHOR** / **POST-PHASE-D ANCHOR** quote those phases' planned output and only exist after those phases merged — verify them against the actual tree the same way. If any anchor fails to grep, STOP and report; do not guess.

### Step 1 — Spec edits

Apply the three blocks in **## Spec changes** above.

### Step 2 — Write the failing tests

Create/edit every file in **## Tests** below (two NEW test files, five EDITED test files — including Phase D's `DialogueArea.test.tsx` — one edited E2E spec). Then run:

```bash
npx vitest run src/lib/life/resumeBubbles.test.ts src/lib/life/resolvedBubble.test.ts src/lib/life/stepSchema.test.ts src/lib/life/prompts/step.test.ts src/screens/LifeScreen
```

Expected result: the two NEW test files (`BubbleVocabText.test.tsx`, `useLifeWordSave.test.tsx`) fail at import (the modules do not exist), and the appended `LIFE-BUBBLE-7` cases in the five edited files fail on assertions (the `DialogueArea.test.tsx` additions run — `import type` of the not-yet-existing `useLifeWordSave` is erased at transpile) EXCEPT four negative controls that already pass against the pre-E tree because they assert absences: resumeBubbles "beats without annotations rehydrate with undefined annotation fields", resolvedBubble "inbound (comprehension) resolved bubble carries no annotations", and DialogueArea "without wordSave the bubbles render plain" + "native-only viewMode renders the native primary plain". Every other appended case (word buttons render on npc/user/narrator bubbles, popover opens with the gloss, comprehension-gate re-enable after reveal, resume round-trip, outbound resolved-bubble annotations, chip-schema round-trips, SI line) MUST fail. The pre-existing cases (including Phase C's and Phase D's) must still pass. Do not proceed until you have SEEN the failures.

### Step 3 — Schema: `ZStepChoice` annotations

**Edit E1 — `src/lib/life/stepSchema.ts`**

ANCHOR (verify unique):

```ts
  /** LIFE-EX-1: present iff this is a graded multi-choice turn. */
  correctness: z.enum(['correct', 'wrong']).nullable().optional(),
});
```

Replace with:

```ts
  /** LIFE-EX-1: present iff this is a graded multi-choice turn. */
  correctness: z.enum(['correct', 'wrong']).nullable().optional(),
  /** LIFE-BUBBLE-7 — optional vocab annotations for the chip's
   *  practiceText, same contract as ZStepBeat. Chips render PLAIN
   *  (tap = pick); the annotations activate when the chip's line
   *  lands as the player's bubble at practice resolution. */
  complexWords: z.array(z.string()).optional(),
  wordTranslations: z.record(z.string(), z.string()).optional(),
});
```

### Step 4 — Prompt: one SI line + OUTPUT SCHEMA chips shape

**Edit E2 — `src/lib/life/prompts/step.ts`** (LANGUAGE RULES)

ANCHOR (verify unique):

```ts
    `- Choice chips also carry both languages. Keep them short — at most one clause.`,
```

Replace with:

```ts
    `- Choice chips also carry both languages. Keep them short — at most one clause.`,
    `- Choice chips MAY also carry complexWords[] + wordTranslations{} (same contract as beats) for the 1-2 genuinely hard words in the chip's practiceText — when a chip's line later lands as the player's spoken bubble, those words become tappable. Omit both fields when nothing in the chip is difficult.`,
```

**Edit E3 — `src/lib/life/prompts/step.ts`** (OUTPUT SCHEMA)

ANCHOR (verify unique):

```ts
    `    "emoji": "🍐" | null                      // optional`,
```

Replace with:

```ts
    `    "emoji": "🍐" | null                      // optional`,
    `    "complexWords": ["word", ...],           // optional, hard words in the chip (same contract as beats)`,
    `    "wordTranslations": { "word": "translation", ... } // optional`,
```

### Step 5 — New helper module: `wordGloss.ts`

**Edit E4 — CREATE `src/screens/LifeScreen/wordGloss.ts`** with exactly:

```ts
/**
 * LIFE-BUBBLE-7: case-tolerant lookup of a tapped word's native
 * gloss in a bubble's `wordTranslations` map.
 *
 * `AnnotatedText` lowercases the word it reports on tap (chat
 * contract), but the life model authors `wordTranslations` keys with
 * narrative casing ("Salut"). Chat's own lookup chain is
 * `map[word.toLowerCase()] ?? map[word]` (BubbleRows.tsx); life adds
 * a final case-insensitive scan because its keys are model-authored
 * per beat, not normalised by a server pipeline.
 *
 * Lives in its own module (not useLifeWordSave.ts) so the render path
 * (BubbleVocabText) can import it without dragging `@/lib/flashcards`
 * — and its Firebase initialisation — into component unit tests.
 */
export function glossFor(
  source: { wordTranslations?: Record<string, string> },
  word: string,
): string | undefined {
  const map = source.wordTranslations;
  if (!map) return undefined;
  const direct = map[word] ?? map[word.toLowerCase()];
  if (direct) return direct;
  const lower = word.toLowerCase();
  const key = Object.keys(map).find((k) => k.toLowerCase() === lower);
  return key ? map[key] : undefined;
}
```

### Step 6 — New hook: `useLifeWordSave.ts`

**Edit E5 — CREATE `src/screens/LifeScreen/useLifeWordSave.ts`** with exactly:

```ts
/**
 * LIFE-BUBBLE-7: save/unsave a tapped vocab word from a life bubble
 * as a flashcard.
 *
 * Deliberately NOT chat's `useMessageActions.saveFlashcardWord` —
 * that hook is coupled to a chat message (sourceMessageId/sourceChatId,
 * per-message recycled state). This one is world-scoped:
 *
 *   - Save: `addFlashCard` (shared write path, PRACTICE-SAVE-3) with
 *     the story context stamped: `"<practiceText>" — <speaker>,
 *     <location>` so card reviews recall the scene.
 *   - Saved detection: live from the already-loaded deck lookup
 *     (normalised-phrase keyed) — survives remounts + resume and
 *     syncs across devices, unlike chat's per-session Set.
 *   - Unsave: `deleteFlashcard` via the lookup match's card id. The
 *     cancellation registry inside lib/flashcards drops any in-flight
 *     topic-classify write for the deleted card.
 *   - `isSaving` covers both directions of the toggle.
 */
import { useState } from 'react';
import { useT } from '@/i18n';
import { toUserMessage } from '@/lib/errors';
import { addFlashCard, deleteFlashcard } from '@/lib/flashcards';
import * as log from '@/lib/log';
import { useUIStore } from '@/store/uiStore';
import type { LifeWorld } from '@/types/firestore';
import type { FlashcardMatch } from './ActionBar';
import { glossFor } from './wordGloss';

/** Structural subset of DialogueArea's `Bubble` that the save path
 *  needs. Declared here (not imported) to keep this module free of
 *  component imports. */
export type SaveableBubble = {
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  practiceText: string;
  wordTranslations?: Record<string, string>;
};

export type LifeWordSave = {
  /** True when the word (case-insensitive) is in the user's deck. */
  isSaved: (word: string) => boolean;
  /** True while the toggle for this word is in flight. */
  isSaving: (word: string) => boolean;
  /** Save when unsaved; delete the matched card when saved. */
  toggleSave: (bubble: SaveableBubble, word: string) => void;
};

export function useLifeWordSave(args: {
  uid: string | null;
  world: LifeWorld | null;
  /** Current location-ribbon label — stamped into the card context. */
  locationLabel: string;
  /** LifeScreen's normalised-phrase → card lookup (LIFE-EX-VOCAB-1
   *  map, carrying the card id for unsave). */
  flashcardLookup: ReadonlyMap<string, FlashcardMatch>;
}): LifeWordSave {
  const { uid, world, locationLabel, flashcardLookup } = args;
  const t = useT();
  const pushToast = useUIStore((s) => s.pushToast);
  const [savingWord, setSavingWord] = useState<string | null>(null);

  const norm = (word: string) => word.trim().toLowerCase();
  const matchFor = (word: string): FlashcardMatch | null =>
    flashcardLookup.get(norm(word)) ?? null;

  function isSaved(word: string): boolean {
    return matchFor(word) !== null;
  }

  function isSaving(word: string): boolean {
    return savingWord === norm(word);
  }

  function toggleSave(bubble: SaveableBubble, word: string): void {
    void run(bubble, word);
  }

  async function run(bubble: SaveableBubble, word: string): Promise<void> {
    if (!uid || !world) return;
    const key = norm(word);
    if (!key || savingWord === key) return;
    const match = matchFor(word);
    const translation = glossFor(bubble, key) ?? '';
    // Nothing to save: unsaved word with no gloss (addFlashCard
    // requires a non-empty translation).
    if (!match && !translation.trim()) return;
    setSavingWord(key);
    try {
      if (match) {
        await deleteFlashcard({ uid, cardId: match.id });
        pushToast({ kind: 'info', message: t('life.vocab.removed') });
      } else {
        const speaker =
          bubble.speaker === 'user'
            ? world.characterName
            : bubble.speakerName ?? t('life.vocab.narrator');
        await addFlashCard(uid, {
          phrase: word,
          translation,
          practiceLanguage: world.practiceLanguage,
          nativeLanguage: world.nativeLanguage,
          context: `"${bubble.practiceText}" — ${speaker}, ${locationLabel}`,
        });
        pushToast({ kind: 'success', message: t('life.vocab.saved') });
      }
    } catch (err) {
      log.error(err, { action: 'lifeWordSave' });
      pushToast({ kind: 'error', message: toUserMessage(err) });
    } finally {
      setSavingWord((prev) => (prev === key ? null : prev));
    }
  }

  return { isSaved, isSaving, toggleSave };
}
```

### Step 7 — New component: `BubbleVocabText.tsx`

**Edit E6 — CREATE `src/screens/LifeScreen/BubbleVocabText.tsx`** with exactly:

```tsx
/**
 * LIFE-BUBBLE-7: the tappable-vocab primary-text row shared by all
 * three bubble treatments (narrator / npc / user).
 *
 * The caller passes the line it resolved for the active view mode
 * (`bubbleTexts()`'s `primary`, LIFE-LANG-3). Annotations attach to
 * `practiceText` ONLY: when the rendered line IS the practiceText,
 * the beat's complexWords render underlined through the chat
 * surface's presentational `AnnotatedText` (tap reports the
 * lowercased word); the single-open popover is coordinated through
 * the global `vocabStore` (bubble ids are the store keys — same
 * contract chat message ids use); the chat `WordPopover` renders
 * below the text with the word's native gloss + the save toggle.
 *
 * Renders plain (no buttons, no underlines) when ANY of: `wordSave`
 * absent (also how callers suppress taps, e.g. the comprehension-
 * source leak gate), the bubble carries no complexWords, or the
 * rendered line is NOT the practiceText (native-only primary,
 * LIFE-LANG-3).
 */
import { AnnotatedText } from '@/components/Message/AnnotatedText';
import { WordPopover } from '@/components/Message/WordPopover';
import { dirOf } from '@/lib/textDirection';
import { useActiveWordFor, useVocabStore } from '@/store/vocabStore';
import type { LifeWordSave } from './useLifeWordSave';
import { glossFor } from './wordGloss';

/** Structural subset of DialogueArea's `Bubble` this row needs.
 *  Declared here (not imported from DialogueArea) so there is no
 *  DialogueArea ↔ BubbleVocabText import cycle. */
export type VocabBubble = {
  id: string;
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  practiceText: string;
  complexWords?: string[];
  wordTranslations?: Record<string, string>;
};

type Props = {
  bubble: VocabBubble;
  /** The line to render — the caller's viewMode-resolved `primary`
   *  (`bubbleTexts()`). Annotations activate only when this equals
   *  `bubble.practiceText`. */
  text: string;
  /** Contrast flag for AnnotatedText underline + WordPopover colors:
   *  true on the gradient user bubble (white text), false on npc +
   *  narrator surfaces. */
  mine: boolean;
  /** Save/unsave wiring from useLifeWordSave. Absent → plain text
   *  (also how callers suppress taps, e.g. the comprehension-source
   *  leak gate). */
  wordSave?: LifeWordSave;
  /** Class for the text row — pass the exact class string the
   *  pre-Phase-E row used so bubble geometry doesn't change. */
  className?: string;
};

export function BubbleVocabText({ bubble, text, mine, wordSave, className }: Props) {
  const activeWord = useActiveWordFor(bubble.id);
  const toggle = useVocabStore((s) => s.toggle);
  // LIFE-BUBBLE-7 ∩ LIFE-LANG-3: annotations attach to practiceText
  // only — a native-only primary renders plain.
  const isPracticeLine = text === bubble.practiceText;
  const tappable =
    isPracticeLine && !!wordSave && (bubble.complexWords?.length ?? 0) > 0;
  return (
    <>
      <div dir={dirOf(text)} className={className}>
        <AnnotatedText
          translation={{
            text,
            // No affordance without a tap handler: suppress the
            // underlines entirely when not tappable.
            complexWords: tappable ? bubble.complexWords : [],
          }}
          mine={mine}
          onWordTap={tappable ? (word) => toggle(bubble.id, word) : undefined}
        />
      </div>
      {tappable && wordSave && activeWord && (
        <WordPopover
          word={activeWord}
          translation={glossFor(bubble, activeWord)}
          mine={mine}
          saved={wordSave.isSaved(activeWord)}
          saving={wordSave.isSaving(activeWord)}
          // Life bubbles have no MetaOverlay timestamp to clear —
          // always use the compact bottom margin.
          compactMarginBottom
          onSave={() => wordSave.toggleSave(bubble, activeWord)}
        />
      )}
    </>
  );
}
```

### Step 8 — `DialogueArea.tsx`: Bubble type + threading + render swaps

All edits in `src/screens/LifeScreen/DialogueArea.tsx`. Phase D's Edit 7 rewrote everything from `function BubbleView({` to end-of-file (viewMode + `bubbleTexts()`), so edits E7d and E7f–E7o anchor on **Phase D's planned post-state** (phase-d.md Edit 7c/7e) and are marked **POST-PHASE-D ANCHOR**; E7a/E7b/E7c/E7e/E7i/E7j anchor on lines both the current tree AND D's post-state contain unchanged.

Each view keeps Phase D's `const { primary, secondary } = bubbleTexts(...)` resolution; Phase E swaps ONLY the primary `<div>` for `<BubbleVocabText text={primary} …/>` — `BubbleVocabText` renders plain whenever `primary !== bubble.practiceText` (native-only mode), so every Phase D viewMode test keeps passing.

**Edit E7a — imports.** ANCHOR (verify unique):

```ts
import { Avatar } from './Avatar';
```

Replace with:

```ts
import { Avatar } from './Avatar';
import { BubbleVocabText } from './BubbleVocabText';
import type { LifeWordSave } from './useLifeWordSave';
```

**Edit E7b — Bubble type.** ANCHOR (verify unique):

```ts
  pending?: boolean;
};
```

Replace with:

```ts
  pending?: boolean;
  /** LIFE-BUBBLE-7 — model-flagged hard words in practiceText; the
   *  vocab-tap UI underlines them. Mirrors MSG-VOCAB-*'s field. */
  complexWords?: string[];
  /** LIFE-BUBBLE-7 — per-word native glosses for the tap popover. */
  wordTranslations?: Record<string, string>;
};
```

Then a second sub-edit in the same file — a found-bug fix (pre-existing errors are in-scope): the doc comment sitting directly above this anchor tags the `pending` field's optimistic in-flight state as LIFE-BUBBLE-7, but `docs/specs/life-sim.md` §9 assigns that behaviour to **LIFE-BUBBLE-6**; LIFE-BUBBLE-7 is the save-word row this phase rewrites. Left stale, `git grep LIFE-BUBBLE-7` would land on unrelated pending-dots code right next to the new LIFE-BUBBLE-7-tagged annotation fields. ANCHOR (verify unique):

```ts
   *  text (LIFE-BUBBLE-7 — user-bubble optimistic state while the
```

Replace with:

```ts
   *  text (LIFE-BUBBLE-6 — user-bubble optimistic state while the
```

**Edit E7c — Props type.** ANCHOR (verify unique):

```ts
    npcId: string | null;
    name: string;
  }) => void;
};
```

Replace with:

```ts
    npcId: string | null;
    name: string;
  }) => void;
  /** LIFE-BUBBLE-7: save/unsave wiring from `useLifeWordSave`. When
   *  absent, bubbles render plain text (no vocab taps). */
  wordSave?: LifeWordSave;
};
```

**Edit E7d — DialogueArea destructure.** POST-PHASE-D ANCHOR (verify unique — D's 7c added `viewMode = 'visible',` above this run; `}: Props) {` appears only on DialogueArea's destructure):

```ts
  npcAvatarUrls,
  currentTurnIds,
  onAvatarTap,
}: Props) {
```

Replace with:

```ts
  npcAvatarUrls,
  currentTurnIds,
  onAvatarTap,
  wordSave,
}: Props) {
```

**Edit E7e — BubbleView call site.** ANCHOR (verify unique):

```ts
          isCurrent={currentTurnIds ? currentTurnIds.has(b.id) : false}
          onAvatarTap={onAvatarTap}
        />
```

Replace with:

```ts
          isCurrent={currentTurnIds ? currentTurnIds.has(b.id) : false}
          onAvatarTap={onAvatarTap}
          wordSave={wordSave}
        />
```

**Edit E7f — BubbleView params.** POST-PHASE-D ANCHOR (verify unique — the `npcAvatarUrl,` param only exists in BubbleView's destructure):

```ts
  hideNative,
  npcAvatarUrl,
  isCurrent,
  onAvatarTap,
}: {
```

Replace with:

```ts
  hideNative,
  npcAvatarUrl,
  isCurrent,
  onAvatarTap,
  wordSave,
}: {
```

**Edit E7g — BubbleView props type.** POST-PHASE-D ANCHOR (verify unique — only BubbleView types `onAvatarTap` via `Props['onAvatarTap']`; the view functions use `() => void`):

```ts
  onAvatarTap?: Props['onAvatarTap'];
}) {
```

Replace with:

```ts
  onAvatarTap?: Props['onAvatarTap'];
  wordSave?: LifeWordSave;
}) {
```

**Edit E7h — narrator dispatch.** POST-PHASE-D ANCHOR (verify unique):

```ts
    return <SystemCueView bubble={bubble} viewMode={viewMode} isCurrent={isCurrent} />;
```

Replace with:

```ts
    return (
      <SystemCueView
        bubble={bubble}
        viewMode={viewMode}
        isCurrent={isCurrent}
        wordSave={wordSave}
      />
    );
```

**Edit E7i — user dispatch.** ANCHOR (verify unique):

```ts
        avatarUrl={userAvatarUrl}
```

Replace with:

```ts
        avatarUrl={userAvatarUrl}
        wordSave={wordSave}
```

**Edit E7j — npc dispatch.** ANCHOR (verify unique):

```ts
      avatarUrl={npcAvatarUrl}
```

Replace with:

```ts
      avatarUrl={npcAvatarUrl}
      wordSave={wordSave}
```

**Edit E7k — SystemCueView signature + render.** POST-PHASE-D ANCHOR (verify unique):

```ts
function SystemCueView({
  bubble,
  viewMode,
  isCurrent,
}: {
  bubble: Bubble;
  viewMode: ZViewModeT;
  isCurrent: boolean;
}) {
```

Replace with:

```ts
function SystemCueView({
  bubble,
  viewMode,
  isCurrent,
  wordSave,
}: {
  bubble: Bubble;
  viewMode: ZViewModeT;
  isCurrent: boolean;
  wordSave?: LifeWordSave;
}) {
```

Then, in the same function, POST-PHASE-D ANCHOR (verify unique — the only `primary` render with no className):

```tsx
        <div dir={dirOf(primary)}>{primary}</div>
```

Replace with:

```tsx
        <BubbleVocabText bubble={bubble} text={primary} mine={false} wordSave={wordSave} />
```

**Edit E7l — NpcBubbleView signature.** POST-PHASE-D ANCHOR (verify unique):

```ts
function NpcBubbleView({
  bubble,
  viewMode,
  practiceLanguage,
  hideNative,
  avatarUrl,
  isCurrent,
  onAvatarTap,
}: {
```

Replace with:

```ts
function NpcBubbleView({
  bubble,
  viewMode,
  practiceLanguage,
  hideNative,
  avatarUrl,
  isCurrent,
  onAvatarTap,
  wordSave,
}: {
```

Then POST-PHASE-D ANCHOR (verify unique):

```ts
  bubble: Bubble;
  viewMode: ZViewModeT;
  practiceLanguage?: string;
  hideNative: boolean;
  avatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: () => void;
}) {
```

Replace with:

```ts
  bubble: Bubble;
  viewMode: ZViewModeT;
  practiceLanguage?: string;
  hideNative: boolean;
  avatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: () => void;
  wordSave?: LifeWordSave;
}) {
```

**Edit E7m — NpcBubbleView render.** POST-PHASE-D ANCHOR (three lines — the FIRST TWO are deliberately non-unique: they appear identically in both NpcBubbleView and UserBubbleView, so a first-line `grep -F -c` of 2 is EXPECTED, not an anchor failure. Verify uniqueness on the THIRD line instead: `grep -F -c` of the `text-(--color-fg-muted)` secondary line must print 1, then match the full 3-line block for the edit):

```tsx
          <div dir={dirOf(primary)} className="text-[15px] leading-snug">{primary}</div>
          {secondary && (
            <div dir={dirOf(secondary)} className="text-[13px] leading-snug mt-1 text-(--color-fg-muted)">
```

Replace with:

```tsx
          <BubbleVocabText
            bubble={bubble}
            text={primary}
            mine={false}
            // LIFE-BUBBLE-7 leak gate: while this bubble is the
            // comprehension-question source and its gloss is hidden,
            // per-word glosses would leak the answer too. Reveal
            // re-enables the taps (the answer is spent).
            wordSave={!hideNative || revealed ? wordSave : undefined}
            className="text-[15px] leading-snug"
          />
          {secondary && (
            <div dir={dirOf(secondary)} className="text-[13px] leading-snug mt-1 text-(--color-fg-muted)">
```

**Edit E7n — UserBubbleView signature.** POST-PHASE-D ANCHOR (verify unique):

```ts
function UserBubbleView({
  bubble,
  viewMode,
  characterName,
  practiceLanguage,
  avatarUrl,
  isCurrent,
  onAvatarTap,
}: {
```

Replace with:

```ts
function UserBubbleView({
  bubble,
  viewMode,
  characterName,
  practiceLanguage,
  avatarUrl,
  isCurrent,
  onAvatarTap,
  wordSave,
}: {
```

Then POST-PHASE-D ANCHOR (verify unique):

```ts
  bubble: Bubble;
  viewMode: ZViewModeT;
  characterName: string;
  practiceLanguage?: string;
  avatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: () => void;
}) {
```

Replace with:

```ts
  bubble: Bubble;
  viewMode: ZViewModeT;
  characterName: string;
  practiceLanguage?: string;
  avatarUrl: string | null;
  isCurrent: boolean;
  onAvatarTap?: () => void;
  wordSave?: LifeWordSave;
}) {
```

**Edit E7o — UserBubbleView render.** POST-PHASE-D ANCHOR (three lines — the FIRST TWO are deliberately non-unique: they appear identically in both NpcBubbleView and UserBubbleView, so a first-line `grep -F -c` of 2 is EXPECTED, not an anchor failure. Verify uniqueness on the THIRD line instead: `grep -F -c` of the `text-white/80` secondary line must print 1, then match the full 3-line block for the edit):

```tsx
          <div dir={dirOf(primary)} className="text-[15px] leading-snug">{primary}</div>
          {secondary && (
            <div dir={dirOf(secondary)} className="text-[13px] leading-snug mt-1 text-white/80">
```

Replace with:

```tsx
          <BubbleVocabText
            bubble={bubble}
            text={primary}
            mine
            wordSave={wordSave}
            className="text-[15px] leading-snug"
          />
          {secondary && (
            <div dir={dirOf(secondary)} className="text-[13px] leading-snug mt-1 text-white/80">
```

(`dirOf` stays imported — the secondary rows still use it. `bubbleTexts`, `viewMode`, `revealed`, `showReveal` are Phase D's — leave them untouched.)

### Step 9 — Resolved + resume bubbles carry annotations

**Edit E8a — `src/lib/life/resolvedBubble.ts`** (type). ANCHOR (verify unique):

```ts
export type ResolvedBubble = {
  id: string;
  speaker: 'npc' | 'user';
  speakerName?: string | null;
  npcId?: string | null;
  practiceText: string;
  nativeText: string | null;
};
```

Replace with:

```ts
export type ResolvedBubble = {
  id: string;
  speaker: 'npc' | 'user';
  speakerName?: string | null;
  npcId?: string | null;
  practiceText: string;
  nativeText: string | null;
  /** LIFE-BUBBLE-7: outbound only — the correct chip's annotations
   *  activate in the resolved user bubble. Inbound (comprehension)
   *  bubbles carry none (the gradedPlan has no annotations). */
  complexWords?: string[];
  wordTranslations?: Record<string, string>;
};
```

**Edit E8b — `src/lib/life/resolvedBubble.ts`** (outbound return). ANCHOR (verify unique):

```ts
  return {
    id: `outbound-${now}`,
    speaker: 'user',
    practiceText: userPracticeText,
    nativeText: null,
  };
```

Replace with:

```ts
  return {
    id: `outbound-${now}`,
    speaker: 'user',
    practiceText: userPracticeText,
    nativeText: null,
    complexWords: fb.correctAnswer.complexWords,
    wordTranslations: fb.correctAnswer.wordTranslations,
  };
```

**Edit E8c — `src/lib/life/resumeBubbles.ts`** — three targeted patches. Phase C REPLACED this file (phase-c.md E2: `count` param + `buildResumeSeed`); all three anchors below quote C's planned post-state. `buildResumeSeed`'s narrator-fallback bubble stays annotation-free (the fields are optional) — do not touch it.

**E8c-1 — header comment.** POST-PHASE-C ANCHOR (verify unique):

```ts
 * Pulled out of LifeScreen so the screen stays focused on UI state.
```

Replace with:

```ts
 * LIFE-BUBBLE-7: beat events persist `complexWords` +
 * `wordTranslations` (ZLifeBeatPayload); rehydrating them here keeps
 * resumed bubbles vocab-tappable.
 *
 * Pulled out of LifeScreen so the screen stays focused on UI state.
```

**E8c-2 — `ResumeBubble` type.** POST-PHASE-C ANCHOR (verify unique — the type's last two fields + close; the map return below uses `p.practiceText ?? ''` so it does not match):

```ts
  practiceText: string;
  nativeText: string | null;
};
```

Replace with:

```ts
  practiceText: string;
  nativeText: string | null;
  complexWords?: string[];
  wordTranslations?: Record<string, string>;
};
```

**E8c-3 — payload cast + return inside `resumeBubblesFromEvents`.** POST-PHASE-C ANCHOR (verify unique):

```ts
        practiceText?: string;
        nativeText?: string | null;
      };
```

Replace with:

```ts
        practiceText?: string;
        nativeText?: string | null;
        complexWords?: string[];
        wordTranslations?: Record<string, string>;
      };
```

Then POST-PHASE-C ANCHOR (verify unique):

```ts
        practiceText: p.practiceText ?? '',
        nativeText: p.nativeText ?? null,
      };
```

Replace with:

```ts
        practiceText: p.practiceText ?? '',
        nativeText: p.nativeText ?? null,
        complexWords: p.complexWords ?? undefined,
        wordTranslations: p.wordTranslations ?? undefined,
      };
```

### Step 10 — `FlashcardMatch` gains `id`; lookup extraction

**Edit E9 — `src/screens/LifeScreen/ActionBar.tsx`.** ANCHOR (verify unique — valid both pre- and post-Phase-D: D's Edit 6a re-emits this exact comment line above the type after inserting `ChipDisplay` before it):

```ts
/** Matched flashcard for a chip — drives the vocab-card render. */
export type FlashcardMatch = {
  phrase: string;
  translation: string;
  context?: string | null;
};
```

Replace with:

```ts
/** Matched flashcard for a chip — drives the vocab-card render.
 *  LIFE-BUBBLE-7 also derives bubble word-save state from this map;
 *  `id` lets an unsave route to `deleteFlashcard`. */
export type FlashcardMatch = {
  id: string;
  phrase: string;
  translation: string;
  context?: string | null;
};
```

**Edit E10 — CREATE `src/screens/LifeScreen/useFlashcardLookup.ts`** with exactly:

```ts
/**
 * LIFE-EX-VOCAB-1 + LIFE-BUBBLE-7: the user's flashcard deck as a
 * normalised-phrase → card lookup, filtered to the world's practice
 * language (a card for a different language shouldn't match this
 * world). Keyed by lowercased + trimmed phrase so lookups are O(1).
 *
 * Consumers: ActionBar chips that match a saved phrase render as
 * vocab cards; bubble word-saves derive their saved/unsaved state
 * (and the card id for unsave) from the same map.
 *
 * Extracted from LifeScreen.tsx in Phase E — the screen sits at the
 * 600-LOC lint cap; this is pure derived state with no UI.
 */
import { useMemo } from 'react';
import { useFlashcards } from '@/hooks/useFlashcards';
import type { LifeWorld } from '@/types/firestore';
import type { FlashcardMatch } from './ActionBar';

export function useFlashcardLookup(
  uid: string | null,
  world: LifeWorld | null,
): ReadonlyMap<string, FlashcardMatch> {
  const flashcards = useFlashcards(uid);
  return useMemo(() => {
    const m = new Map<string, FlashcardMatch>();
    if (!world) return m;
    const lang = world.practiceLanguage;
    for (const card of flashcards.data ?? []) {
      const cardLang = card.practiceLanguage ?? card.language;
      if (cardLang && lang && cardLang !== lang) continue;
      const phrase = card.phrase ?? card.front ?? '';
      const translation = card.translation ?? card.back ?? '';
      if (!phrase.trim() || !translation.trim()) continue;
      m.set(phrase.trim().toLowerCase(), {
        id: card.id,
        phrase,
        translation,
        context: card.context ?? null,
      });
    }
    return m;
  }, [flashcards.data, world]);
}
```

### Step 11 — `LifeScreen.tsx` wiring

**Edit E11 — imports.** ANCHOR (verify unique):

```ts
import { type FlashcardMatch } from './ActionBar';
```

Replace with (LifeScreen no longer references `FlashcardMatch` after E12):

```ts
import { useFlashcardLookup } from './useFlashcardLookup';
import { useLifeWordSave } from './useLifeWordSave';
```

**Edit E12 — remove the inline lookup.** ANCHOR (verify unique — this is the whole block from the comment through the memo close; first line and last line each grep-unique):

```ts
  // LIFE-EX-VOCAB-1: load the user's flashcard deck so chips that
  // match a saved phrase render as vocab cards. Filtered to the
  // world's practice language (a card for a different language
  // shouldn't match a chip in this world). Keyed by normalised
  // phrase (lowercased + trimmed) so chip lookups are O(1).
  const flashcards = useFlashcards(user?.uid ?? null);
  const flashcardLookup = useMemo(() => {
    const m = new Map<string, FlashcardMatch>();
    if (!world.data) return m;
    const lang = world.data.practiceLanguage;
    for (const card of flashcards.data ?? []) {
      const cardLang = card.practiceLanguage ?? card.language;
      if (cardLang && lang && cardLang !== lang) continue;
      const phrase = card.phrase ?? card.front ?? '';
      const translation = card.translation ?? card.back ?? '';
      if (!phrase.trim() || !translation.trim()) continue;
      m.set(phrase.trim().toLowerCase(), {
        phrase,
        translation,
        context: card.context ?? null,
      });
    }
    return m;
  }, [flashcards.data, world.data]);
```

Replace with:

```ts
  // LIFE-EX-VOCAB-1 + LIFE-BUBBLE-7: deck lookup (extracted hook).
  const flashcardLookup = useFlashcardLookup(user?.uid ?? null, world.data ?? null);
```

Then DELETE this now-unused import line. ANCHOR (verify unique):

```ts
import { useFlashcards } from '@/hooks/useFlashcards';
```

Replace with nothing (remove the line). If `useMemo` is now unused in the file, remove it from the react import — check with `grep -c "useMemo(" src/screens/LifeScreen/LifeScreen.tsx` first: the `npcAvatarUrls` memo still uses it, so DO NOT remove it (count stays ≥ 1).

**Edit E13 — locationLabel + wordSave hook.** ANCHOR (verify unique):

```ts
  const scene = useLifeScene(descriptor, worldData?.id ?? null, worldData?.practiceLanguage ?? null);
```

Replace with:

```ts
  const scene = useLifeScene(descriptor, worldData?.id ?? null, worldData?.practiceLanguage ?? null);

  // LIFE-BUBBLE-7: one source for the SceneStage ribbon label AND the
  // flashcard story-context stamp.
  const locationLabel =
    state.sceneIntent?.locationLabel ??
    worldData?.currentLocationLabel ??
    t('life.locationRibbon.apartment');
  // LIFE-BUBBLE-7: save/unsave a tapped vocab word as a flashcard.
  const wordSave = useLifeWordSave({
    uid: user?.uid ?? null,
    world: worldData ?? null,
    locationLabel,
    flashcardLookup,
  });
```

**Edit E14 — beat→Bubble map keeps annotations.** ANCHOR (verify unique):

```ts
          practiceText: b.practiceText,
          nativeText: b.nativeText,
        }));
```

Replace with:

```ts
          practiceText: b.practiceText,
          nativeText: b.nativeText,
          complexWords: b.complexWords,
          wordTranslations: b.wordTranslations,
        }));
```

**Edit E15 — resolved-bubble persist keeps annotations.** ANCHOR (verify unique):

```ts
          practiceText: resolvedBubble.practiceText,
          nativeText: resolvedBubble.nativeText ?? null,
        }).catch(() => undefined);
```

Replace with:

```ts
          practiceText: resolvedBubble.practiceText,
          nativeText: resolvedBubble.nativeText ?? null,
          complexWords: resolvedBubble.complexWords,
          wordTranslations: resolvedBubble.wordTranslations,
        }).catch(() => undefined);
```

**Edit E16 — SceneStage uses the shared label.** ANCHOR (verify unique):

```tsx
          locationLabel={
            state.sceneIntent?.locationLabel ??
            worldData.currentLocationLabel ??
            t('life.locationRibbon.apartment')
          }
```

Replace with:

```tsx
          locationLabel={locationLabel}
```

**Edit E17 — pass wordSave to DialogueArea.** ANCHOR (verify unique — D's 12k inserts `viewMode={…}` after the `bubbles={state.bubbles}` line ABOVE this one and leaves this line intact):

```tsx
          currentTurnIds={state.currentTurnIds}
```

Replace with:

```tsx
          currentTurnIds={state.currentTurnIds}
          wordSave={wordSave}
```

### Step 12 — i18n keys

**Edit E18 — `src/i18n/locales/en.ts`.** English source of truth ONLY — do NOT touch the other 80 locale files (regen is a separate user-triggered step). ANCHOR (verify unique):

```ts
  'life.reveal.translation': 'Reveal translation',
```

Replace with:

```ts
  'life.reveal.translation': 'Reveal translation',
  'life.vocab.narrator': 'Narrator',
  'life.vocab.saved': 'Saved to flashcards',
  'life.vocab.removed': 'Removed from flashcards',
```

### Step 13 — Run to green

Run the **## Verify** commands. Iterate until every command passes. If a test added in Step 2 is wrong (not the implementation), fix the test ONLY if the LIFE-BUBBLE-7 spec text from Step 1 is still honoured; if the spec itself seems wrong, STOP and report.

## Tests

### A. NEW `src/screens/LifeScreen/BubbleVocabText.test.tsx` — complete contents

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BubbleVocabText, type VocabBubble } from './BubbleVocabText';
import { useVocabStore } from '@/store/vocabStore';
import type { LifeWordSave } from './useLifeWordSave';

const bubble: VocabBubble = {
  id: 'b1',
  speaker: 'npc',
  speakerName: 'Sophie',
  practiceText: 'On déjeune ensemble à midi ?',
  complexWords: ['déjeune'],
  wordTranslations: { 'déjeune': 'have lunch' },
};

function makeWordSave(overrides?: Partial<LifeWordSave>): LifeWordSave {
  return {
    isSaved: () => false,
    isSaving: () => false,
    toggleSave: vi.fn(),
    ...overrides,
  };
}

beforeEach(() => {
  useVocabStore.getState().close();
});

describe('BubbleVocabText — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — complex word renders as a tappable button; tap opens the popover with the native gloss', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.getByText('have lunch')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Save to flashcards' }),
    ).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — save button routes to toggleSave(bubble, word)', () => {
    const ws = makeWordSave();
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={ws}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save to flashcards' }));
    expect(ws.toggleSave).toHaveBeenCalledWith(bubble, 'déjeune');
  });

  it('LIFE-BUBBLE-7 — saved word shows the remove affordance', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={makeWordSave({ isSaved: () => true })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(
      screen.getByRole('button', { name: 'Remove from flashcards' }),
    ).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — case-tolerant gloss lookup (model-cased key, lowercased tap)', () => {
    const cased: VocabBubble = {
      ...bubble,
      id: 'b-cased',
      practiceText: 'Salut ! On mange ?',
      complexWords: ['Salut'],
      wordTranslations: { 'Salut': 'Hi' },
    };
    render(
      <BubbleVocabText
        bubble={cased}
        text={cased.practiceText}
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Salut' }));
    expect(screen.getByText('Hi')).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — second tap on the same word closes the popover (vocabStore toggle)', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text={bubble.practiceText}
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.getByText('have lunch')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.queryByText('have lunch')).not.toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — only ONE popover open across bubbles (vocabStore singleton)', () => {
    const other: VocabBubble = {
      ...bubble,
      id: 'b2',
      wordTranslations: { 'déjeune': 'second gloss' },
    };
    render(
      <>
        <BubbleVocabText
          bubble={bubble}
          text={bubble.practiceText}
          mine={false}
          wordSave={makeWordSave()}
        />
        <BubbleVocabText
          bubble={other}
          text={other.practiceText}
          mine
          wordSave={makeWordSave()}
        />
      </>,
    );
    const buttons = screen.getAllByRole('button', { name: 'déjeune' });
    fireEvent.click(buttons[0]!);
    expect(screen.getByText('have lunch')).toBeInTheDocument();
    fireEvent.click(buttons[1]!);
    expect(screen.queryByText('have lunch')).not.toBeInTheDocument();
    expect(screen.getByText('second gloss')).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — no wordSave → plain text, no buttons, no underlines', () => {
    render(<BubbleVocabText bubble={bubble} text={bubble.practiceText} mine={false} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText(/On déjeune ensemble/)).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — a non-practice primary line (LIFE-LANG-3 native-only) renders plain', () => {
    render(
      <BubbleVocabText
        bubble={bubble}
        text="Lunch together at noon?"
        mine={false}
        wordSave={makeWordSave()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Lunch together at noon?')).toBeInTheDocument();
  });
});
```

### B. NEW `src/screens/LifeScreen/useLifeWordSave.test.tsx` — complete contents

```tsx
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  addFlashCard: vi.fn(async () => 'new-card-id'),
  deleteFlashcard: vi.fn(async () => {}),
}));
vi.mock('@/lib/flashcards', () => ({
  addFlashCard: mocks.addFlashCard,
  deleteFlashcard: mocks.deleteFlashcard,
}));
vi.mock('@/lib/log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import { useLifeWordSave, type SaveableBubble } from './useLifeWordSave';
import type { FlashcardMatch } from './ActionBar';
import type { LifeWorld } from '@/types/firestore';

const world = {
  id: 'w-1',
  characterName: 'Alex',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
} as LifeWorld;

const npcBubble: SaveableBubble = {
  speaker: 'npc',
  speakerName: 'Sophie',
  practiceText: 'On déjeune ensemble ?',
  wordTranslations: { 'déjeune': 'have lunch' },
};

function mount(lookup: ReadonlyMap<string, FlashcardMatch> = new Map()) {
  return renderHook(() =>
    useLifeWordSave({
      uid: 'u1',
      world,
      locationLabel: 'Le café · matin',
      flashcardLookup: lookup,
    }),
  );
}

beforeEach(() => {
  mocks.addFlashCard.mockClear();
  mocks.deleteFlashcard.mockClear();
});

describe('useLifeWordSave — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — save calls addFlashCard with the story-context stamp', async () => {
    const { result } = mount();
    await act(async () => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(mocks.addFlashCard).toHaveBeenCalledTimes(1);
    expect(mocks.addFlashCard).toHaveBeenCalledWith('u1', {
      phrase: 'déjeune',
      translation: 'have lunch',
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      context: '"On déjeune ensemble ?" — Sophie, Le café · matin',
    });
  });

  it('LIFE-BUBBLE-7 — narrator bubbles stamp the Narrator label; user bubbles stamp the character name', async () => {
    const { result } = mount();
    await act(async () => {
      result.current.toggleSave(
        {
          speaker: 'narrator',
          practiceText: 'Tu entres.',
          wordTranslations: { 'entres': 'enter' },
        },
        'entres',
      );
    });
    expect(mocks.addFlashCard).toHaveBeenLastCalledWith(
      'u1',
      expect.objectContaining({
        context: '"Tu entres." — Narrator, Le café · matin',
      }),
    );
    await act(async () => {
      result.current.toggleSave(
        {
          speaker: 'user',
          practiceText: 'Je voudrais un café.',
          wordTranslations: { 'voudrais': 'would like' },
        },
        'voudrais',
      );
    });
    expect(mocks.addFlashCard).toHaveBeenLastCalledWith(
      'u1',
      expect.objectContaining({
        context: '"Je voudrais un café." — Alex, Le café · matin',
      }),
    );
  });

  it('LIFE-BUBBLE-7 — a word already in the deck unsaves via deleteFlashcard with the matched card id', async () => {
    const lookup = new Map<string, FlashcardMatch>([
      [
        'déjeune',
        { id: 'card-9', phrase: 'déjeune', translation: 'have lunch', context: null },
      ],
    ]);
    const { result } = mount(lookup);
    expect(result.current.isSaved('déjeune')).toBe(true);
    await act(async () => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(mocks.deleteFlashcard).toHaveBeenCalledWith({ uid: 'u1', cardId: 'card-9' });
    expect(mocks.addFlashCard).not.toHaveBeenCalled();
  });

  it('LIFE-BUBBLE-7 — no gloss for an unsaved word → no write at all', async () => {
    const { result } = mount();
    await act(async () => {
      result.current.toggleSave({ speaker: 'npc', practiceText: 'Bonjour.' }, 'bonjour');
    });
    expect(mocks.addFlashCard).not.toHaveBeenCalled();
    expect(mocks.deleteFlashcard).not.toHaveBeenCalled();
  });

  it('LIFE-BUBBLE-7 — isSaving is true while the save is in flight, false after', async () => {
    let release: (v: string) => void = () => {};
    mocks.addFlashCard.mockReturnValueOnce(
      new Promise<string>((r) => {
        release = r;
      }),
    );
    const { result } = mount();
    act(() => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(result.current.isSaving('déjeune')).toBe(true);
    await act(async () => {
      release('new-card-id');
    });
    expect(result.current.isSaving('déjeune')).toBe(false);
  });

  it('LIFE-BUBBLE-7 — null uid/world → no-op', async () => {
    const { result } = renderHook(() =>
      useLifeWordSave({
        uid: null,
        world: null,
        locationLabel: 'x',
        flashcardLookup: new Map(),
      }),
    );
    await act(async () => {
      result.current.toggleSave(npcBubble, 'déjeune');
    });
    expect(mocks.addFlashCard).not.toHaveBeenCalled();
  });
});
```

### C. EDIT `src/screens/LifeScreen/DialogueArea.test.tsx` (created by Phase D's T5 — two edits)

**C-1 — imports.** POST-PHASE-D ANCHOR (verify unique):

```ts
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
```

Replace with:

```ts
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
```

Then POST-PHASE-D ANCHOR (verify unique):

```ts
import { DialogueArea, type Bubble } from './DialogueArea';
```

Replace with:

```ts
import { DialogueArea, type Bubble } from './DialogueArea';
import { useVocabStore } from '@/store/vocabStore';
import type { LifeWordSave } from './useLifeWordSave';
```

**C-2 — append the LIFE-BUBBLE-7 describe.** POST-PHASE-D ANCHOR (verify unique — the final lines of D's T5 file, closing its LIFE-LANG-4 reveal test + the viewMode describe):

```ts
    const reveal = screen.getByTestId('LifeScreen-RevealTranslation');
    fireEvent.click(reveal);
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Hello!');
  });
});
```

Replace with:

```ts
    const reveal = screen.getByTestId('LifeScreen-RevealTranslation');
    fireEvent.click(reveal);
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Hello!');
  });
});

describe('DialogueArea vocab taps — LIFE-BUBBLE-7', () => {
  const annotatedNpc: Bubble = {
    id: 'v1',
    speaker: 'npc',
    speakerName: 'Sophie',
    practiceText: 'On déjeune ensemble à midi ?',
    nativeText: 'Lunch together at noon?',
    complexWords: ['déjeune'],
    wordTranslations: { 'déjeune': 'have lunch' },
  };
  const annotatedUser: Bubble = {
    id: 'v2',
    speaker: 'user',
    practiceText: 'Je voudrais un café.',
    nativeText: null,
    complexWords: ['voudrais'],
    wordTranslations: { 'voudrais': 'would like' },
  };
  const annotatedNarrator: Bubble = {
    id: 'v3',
    speaker: 'narrator',
    practiceText: 'Tu entres au café.',
    nativeText: 'You enter the café.',
    complexWords: ['entres'],
    wordTranslations: { 'entres': 'enter' },
  };

  function makeWordSave(): LifeWordSave {
    return { isSaved: () => false, isSaving: () => false, toggleSave: vi.fn() };
  }

  beforeEach(() => {
    useVocabStore.getState().close();
  });

  it('LIFE-BUBBLE-7 — npc + user bubbles render their complex words as tappable buttons', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc, annotatedUser]}
        characterName="Alex"
        wordSave={makeWordSave()}
      />,
    );
    expect(screen.getByRole('button', { name: 'déjeune' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'voudrais' })).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — narrator system cues render tappable vocab too', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNarrator]}
        characterName="Alex"
        wordSave={makeWordSave()}
      />,
    );
    expect(screen.getByRole('button', { name: 'entres' })).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — tap opens the popover with the native gloss', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc]}
        characterName="Alex"
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.getByText('have lunch')).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — without wordSave the bubbles render plain (no word buttons)', () => {
    render(
      <DialogueArea bubbles={[annotatedNpc, annotatedUser]} characterName="Alex" />,
    );
    expect(
      screen.queryByRole('button', { name: 'déjeune' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'voudrais' }),
    ).not.toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — native-only viewMode renders the native primary plain (annotations attach to practiceText)', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc]}
        characterName="Alex"
        viewMode="native-only"
        wordSave={makeWordSave()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'déjeune' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent(
      'Lunch together at noon?',
    );
  });

  it('LIFE-BUBBLE-7 — comprehension-source bubble suppresses vocab taps while its gloss is hidden; reveal re-enables', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc]}
        characterName="Alex"
        wordSave={makeWordSave()}
        hideNativeForUtterance={annotatedNpc.practiceText}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'déjeune' }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('LifeScreen-RevealTranslation'));
    expect(screen.getByRole('button', { name: 'déjeune' })).toBeInTheDocument();
  });
});
```

### D. EDIT `src/lib/life/resumeBubbles.test.ts` (Phase C's T5 already appended to this file — anchor on C's ending)

POST-PHASE-C ANCHOR (verify unique — the final lines C's T5b produces: the narrator-fallback assertion closing the `buildResumeSeed — LIFE-FLOW-2` describe at end-of-file):

```ts
      practiceText: 't:life.resume.prompt.practice',
      nativeText: 't:life.resume.prompt.native',
    });
  });
});
```

Replace with (appends a new describe; the `beat` helper and the `LifeEvent` import already exist in this file):

```ts
      practiceText: 't:life.resume.prompt.practice',
      nativeText: 't:life.resume.prompt.native',
    });
  });
});

describe('resume annotations — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — round-trips complexWords + wordTranslations so resumed bubbles stay tappable', () => {
    const events: LifeEvent[] = [
      {
        id: 'e-annotated',
        kind: 'beat',
        payload: {
          speaker: 'npc',
          speakerName: 'Sophie',
          practiceText: 'On déjeune ensemble ?',
          nativeText: 'Lunch together?',
          complexWords: ['déjeune'],
          wordTranslations: { 'déjeune': 'have lunch' },
        },
      },
    ];
    const [b] = resumeBubblesFromEvents(events);
    expect(b?.complexWords).toEqual(['déjeune']);
    expect(b?.wordTranslations).toEqual({ 'déjeune': 'have lunch' });
  });

  it('LIFE-BUBBLE-7 — beats without annotations rehydrate with undefined annotation fields', () => {
    const [b] = resumeBubblesFromEvents([beat('npc', 'Salut !')]);
    expect(b?.complexWords).toBeUndefined();
    expect(b?.wordTranslations).toBeUndefined();
  });
});
```

### E. EDIT `src/lib/life/resolvedBubble.test.ts`

ANCHOR (verify unique):

```ts
      expect(bubble.practiceText).toBe('Tu vas où ?');
    });
  });
});
```

Replace with:

```ts
      expect(bubble.practiceText).toBe('Tu vas où ?');
    });
  });

  describe('annotations (LIFE-BUBBLE-7)', () => {
    it('LIFE-BUBBLE-7 — outbound resolved bubble carries the correct chip\'s annotations', () => {
      const bubble = buildResolvedBubble(
        {
          outcomeKind: 'fill-blank',
          promptSource: 'Je ___ un café',
          correctAnswer: choice({
            practiceText: 'voudrais',
            complexWords: ['voudrais'],
            wordTranslations: { 'voudrais': 'would like' },
          }),
        },
        1000,
      );
      expect(bubble.complexWords).toEqual(['voudrais']);
      expect(bubble.wordTranslations).toEqual({ 'voudrais': 'would like' });
    });

    it('LIFE-BUBBLE-7 — inbound (comprehension) resolved bubble carries no annotations', () => {
      const bubble = buildResolvedBubble({
        outcomeKind: 'comprehension',
        promptSource: 'Tu vas où ?',
        correctAnswer: choice({
          practiceText: "She's asking where I'm going",
          complexWords: ['asking'],
          wordTranslations: { 'asking': 'x' },
        }),
        speakerName: 'Sophie',
      });
      expect(bubble.complexWords).toBeUndefined();
      expect(bubble.wordTranslations).toBeUndefined();
    });
  });
});
```

### F. EDIT `src/lib/life/stepSchema.test.ts`

Append at the very END of the file (after its final `});`, which closes the `'ZRawStepResponse — LIFE-EX-PLAN-1/4'` describe whose last case is `'rejects CYOA raw response with correctness on a chip'`):

```ts

describe('ZStepChoice annotations — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — CYOA chips accept + preserve complexWords/wordTranslations', () => {
    const parsed = ZStepResponse.safeParse({
      ...cyoaResponse,
      choices: [
        {
          id: 'greet',
          practiceText: 'Saluer Sophie',
          nativeText: 'Greet Sophie',
          complexWords: ['Saluer'],
          wordTranslations: { 'Saluer': 'to greet' },
        },
        cyoaResponse.choices[1],
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.choices[0]?.complexWords).toEqual(['Saluer']);
    expect(parsed.data.choices[0]?.wordTranslations).toEqual({
      'Saluer': 'to greet',
    });
  });

  it('LIFE-BUBBLE-7 — graded inline chips accept annotations too', () => {
    const parsed = ZStepResponse.safeParse({
      beats: [],
      graded: true,
      practicePrompt: {
        kind: 'fill-blank' as const,
        practiceText: 'Je ___ une baguette.',
        nativeText: 'I ___ a baguette.',
      },
      choices: [
        {
          id: 'c1',
          practiceText: 'voudrais',
          nativeText: 'like',
          correctness: 'correct' as const,
          complexWords: ['voudrais'],
          wordTranslations: { 'voudrais': 'would like' },
        },
        { id: 'c2', practiceText: 'veux', nativeText: 'like', correctness: 'wrong' as const },
        { id: 'c3', practiceText: 'ai', nativeText: 'like', correctness: 'wrong' as const },
      ],
    });
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.choices[0]?.wordTranslations).toEqual({
      'voudrais': 'would like',
    });
  });
});
```

### G. EDIT `src/lib/life/prompts/step.test.ts`

ANCHOR (verify unique):

```ts
    expect(si).toMatch(/JSON/i);
    expect(si).toMatch(/No prose, no markdown fences/);
  });
});
```

Replace with:

```ts
    expect(si).toMatch(/JSON/i);
    expect(si).toMatch(/No prose, no markdown fences/);
  });

  it('LIFE-BUBBLE-7 — instructs the model to annotate chip text like beats', () => {
    const si = lifeStepSystemInstruction({
      practiceLanguage: 'French',
      nativeLanguage: 'English',
      difficulty: 3,
    });
    expect(si).toContain(
      'Choice chips MAY also carry complexWords[] + wordTranslations{}',
    );
  });
});
```

### H. EDIT `tests/e2e/specs/life-flow.spec.ts` (three edits; tier: the file already runs in the `@standard` gate — `test:e2e:standard` is `--grep-invert @full`, and this file carries no `@full` tag)

**H1 — deck wipe for rerun determinism.** ANCHOR (verify unique — `wipeLifeData` is untouched by C's E13 and D's T8):

```ts
  const collections = ['lifeWorld', 'lifeEvents', 'lifeNpcs', 'lifeScenes'];
```

Replace with:

```ts
  // LIFE-BUBBLE-7 E2E determinism: the pool account is reused across
  // runs (HARNESS-ACCOUNTS-1) — a card saved by a previous run would
  // start the vocab popover in "saved" state and flip the save toggle
  // into delete-mode. Wipe the deck alongside the legacy collections.
  const collections = ['lifeWorld', 'lifeEvents', 'lifeNpcs', 'lifeScenes', 'flashcards'];
```

**H2 — annotate the opening NPC beat.** ANCHOR (verify unique — this is inside the `OPENING_BEAT` fixture; D's T8b edits the `OUTBOUND_PRACTICE` fixture's chips and C's E13 edits test bodies, neither touches these lines):

```ts
      practiceText: 'Salut ! On déjeune ensemble à midi ?',
      nativeText: 'Hi! Lunch together at noon?',
    },
```

Replace with:

```ts
      practiceText: 'Salut ! On déjeune ensemble à midi ?',
      nativeText: 'Hi! Lunch together at noon?',
      // LIFE-BUBBLE-7 — annotated so the vocab-tap E2E can drive the
      // word → popover → save flow on the opening bubble.
      complexWords: ['déjeune'],
      wordTranslations: { 'déjeune': 'have lunch' },
    },
```

**H3 — the new test.** Insert IMMEDIATELY after the `'LIFE-ONBOARD — chip pick creates world + redirects to /life'` test block — this test must run while the opening NPC bubble is still on screen. (Phase C's E13a inserted a Begin-click EARLIER inside that same test; its final lines below are unchanged. C's and D's added tests all sit further down the file, and this insertion leaves their on-screen-state assumptions intact: the saved deck card matches no later chip's practiceText, and the popover is closed again at the end.) ANCHOR (verify unique — final lines of that test):

```ts
    await captureBeat(page, testInfo, 'opening-beat');
  });
```

Replace with:

```ts
    await captureBeat(page, testInfo, 'opening-beat');
  });

  test('LIFE-BUBBLE-7 — tap vocab word → popover → save → flashcard doc exists with story context', async ({}, testInfo) => {
    // No installLifeMock here: word taps + saves fire ZERO lifeStep
    // calls. (addFlashCard's background topic-classify falls through
    // the route mock to the real backend; nothing below depends on it.)
    const npcBubble = page.getByTestId('LifeScreen-Bubble-npc');
    await npcBubble.getByRole('button', { name: 'déjeune' }).click();

    // Popover opens with the word + its native gloss.
    const popover = page.locator('[data-popover-card]');
    await expect(popover).toBeVisible();
    await expect(popover).toContainText('déjeune');
    await expect(popover).toContainText('have lunch');
    await captureBeat(page, testInfo, 'vocab-popover');

    await popover.getByRole('button', { name: 'Save to flashcards' }).click();
    // Affordance flips once the live deck listener sees the card…
    await expect(
      popover.getByRole('button', { name: 'Remove from flashcards' }),
    ).toBeVisible({ timeout: 10_000 });
    await captureBeat(page, testInfo, 'vocab-saved');

    // …but the POST-CONDITION is the Firestore doc itself, with the
    // story-context stamp "<practiceText>" — <speaker>, <location>.
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
```

Note on the `context` assertion: the location falls back to the `life.locationRibbon.apartment` i18n value (`'Your apartment · morning'`) because the mocked opening turn carries no `sceneIntent` and a fresh world has no `currentLocationLabel`. Phase A does not change this value (it contains neither "world" nor "life"). If Phase A's landed en.ts DID change it, use the landed value verbatim — the i18n file is the source of truth for the expected string.

## Verify

Run from `/Users/jamesarney/wurld`, in this order — all must pass:

```bash
# 1. Scoped unit + component tests for this phase
npx vitest run src/lib/life/resumeBubbles.test.ts src/lib/life/resolvedBubble.test.ts src/lib/life/stepSchema.test.ts src/lib/life/prompts/step.test.ts src/screens/LifeScreen

# 2. Full unit suite
npm test

# 3. Types + lint (max-lines cap included)
npm run typecheck
npx eslint src/screens/LifeScreen src/lib/life src/i18n/locales/en.ts

# 4. E2E — the life-flow suite (serial; runs the new LIFE-BUBBLE-7 test in context).
#    This is the @standard-tier harness (mocked Gemini; real Firebase project).
cd tests/e2e && npx playwright test life-flow.spec.ts --project=chromium
```

Then open EVERY screenshot the E2E run captured under the run's `screenshots/` output (at minimum `vocab-popover` and `vocab-saved`) with the Read tool and check: the tapped word is underlined; the popover sits under the text inside the bubble (not overflowing it); light-on-dark contrast is correct in the user-bubble case; no layout jump between the two captures. Do NOT report the phase done without having looked at them.

Prompt-suite note: E2 and E3 edit a **client-side** prompt (`src/lib/life/prompts/step.ts`, not `functions/src/`), adding one additive instruction line + two schema-comment lines. There is no `tests/prompts/` suite for the life step prompt; the unit test in G covers the SI change. Do not run `npm run test:prompts` for this phase.

## Out of scope

Do NOT touch any of the following in this phase — they belong to other phases or are deliberately excluded:

- `src/screens/LifeScreen/PracticePromptCard.tsx` and `src/screens/LifeScreen/PracticeFeedback.tsx` — EXCLUDED surfaces per LIFE-BUBBLE-7 (answer leak). No vocab-tap wiring there, not even "while you're in the file".
- `src/screens/LifeScreen/ActionBar.tsx` beyond the `FlashcardMatch` type block (edit E9). Chips render plain — do not add `AnnotatedText`/word taps to chips. Do not touch `ChipDisplay`/`chipDisplay` (Phase D's).
- `src/screens/LifeScreen/lifeScreenState.ts` (Phase D's extraction) and `src/screens/LifeScreen/WurldResumeScreen.tsx` / `useResumeRecapOnExit.ts` (Phase C's). The resume screen's "Moments ago" mini-bubbles render `practiceText` plain — do NOT wire vocab taps there (not a LIFE-BUBBLE-7 surface).
- `src/lib/life/world.ts`, `src/types/firestore.ts` (`ZLifeBeatPayload`), `src/lib/life/runLifeStep.ts` — already persist annotations; no changes (Contradictions §1).
- `src/lib/life/prompts/gradedQuestion.ts` + `src/lib/life/runGradedQuestionGenerate.ts` — Phase D rewrites these; the extended `ZStepChoice` already PERMITS the generator to emit chip annotations, and this phase does not prompt it to. (If graded chips arrive unannotated, the resolved user bubble renders plain — acceptable.)
- Chat surfaces: `src/components/Message/AnnotatedText.tsx`, `WordPopover.tsx`, `BubbleRows.tsx`, `src/hooks/useMessageActions.ts`, `src/store/vocabStore.ts` — consumed as-is, zero edits.
- `src/lib/flashcards.ts` — consumed as-is (`addFlashCard`, `deleteFlashcard`).
- i18n locale files other than `en.ts` (regen is user-triggered, separate).
- The `flashcard_added` life-event write for newly saved cards — that is the existing LIFE-FLOW-2 session-resume mechanism, not a per-save write; do not add one.
- Free-text composer / `__free__` chip behaviour, TTS buttons, avatar taps, `ExplainModal` (Phase D/H), node/lookahead engine (`ZStepOption` gets these same annotation fields in Phase F — F's doc owns that).
- If you discover bugs outside these files, report them in your final summary; do not fix silently.
