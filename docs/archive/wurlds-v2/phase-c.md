# Phase C — Resume recap screen ("Previously, in <wurld>…")

**Goal.** When a player re-enters a world that already has events, they see a `WurldResumeScreen` overlay assembled ENTIRELY from stored data (zero LLM calls on the resume path): saga title + tone, the card teaser, the current chapter premise, a "Previously" recap paragraph (`world.resumeRecap.text`, falling back to `rollingSummary`), and the last ≤3 beat events as mini-bubbles. Tapping Continue releases the existing LIFE-FLOW-2 resume seeding (the `__resume__` chip flow). Fresh worlds (0 events) keep the existing `WorldIntroScreen`. The recap paragraph is *polished* by a single fire-and-forget flash-lite call on world EXIT (LifeScreen unmount / back-nav), fired only when ≥5 new events landed since `resumeRecap.lastEventId`; every failure is tolerated.

**Invariant covered:** `LIFE-FLOW-5` (new — see Contradictions below for why not LIFE-FLOW-4).

## Contradictions / deviations from the approved plan

1. **Invariant id: LIFE-FLOW-5, not LIFE-FLOW-4.** The plan assigns "LIFE-FLOW-4 (recap screen contract + recap-generation trigger)", but `docs/specs/life-sim.md` §2 ALREADY defines **LIFE-FLOW-4** (in-flight lifeStep resume idempotency). Per the pinned invariant-id list in `docs/plans/wurlds-v2/README.md` § Shared contracts ("LIFE-FLOW-5 (C — NOT 4; the spec already defines LIFE-FLOW-4)"), this phase uses **LIFE-FLOW-5**. All test descriptions below use `LIFE-FLOW-5`.
2. **One extra new file: `src/screens/LifeScreen/useResumeRecapOnExit.ts`.** `LifeScreen.tsx` is at **exactly 600 counted lines** today (the ESLint `max-lines` cap; verified with `npx eslint --no-inline-config --rule '{"max-lines": ["error", {"max": 1, "skipBlankLines": true, "skipComments": true}]}' src/screens/LifeScreen/LifeScreen.tsx` → "(600)"). Any net-positive edit trips lint. Two extractions keep the file under the cap: (a) the exit-generation wiring moves to the new hook file; (b) the resume-seeding literal moves into `buildResumeSeed()` in `resumeBubbles.ts`. Net LifeScreen delta after this phase: **−9 counted lines** (≈591; E5 +2, E6 +1, E7 +1, E8 −17, E8b +1, E9b +3). Do not "simplify" these extractions away.
3. **`resumeRecap.text` stores BOTH languages in one string.** The plan's generator output is "2-3 spoiler-free sentences in BOTH languages" while the pinned schema has a single `text: string`. Resolution: the generator returns `{ practiceText, nativeText }` JSON and the runner stores `text = practiceText + '\n\n' + nativeText`, rendered with `whitespace-pre-line`.
4. **Two extra i18n keys.** The plan pins `life.resume.eyebrow/chapter/momentsAgo/continue`; the screen's "The story" and "Previously" section labels also need keys → `life.resume.story` and `life.resume.previously` are added. (`life.resume.continue` coexists safely with the existing `life.resume.continue.practice/native` — the catalogue is a flat string-keyed map.)
5. **Found-bug (pre-existing, fixed here because it blocks this phase's E2E):** `tests/e2e/specs/life-flow.spec.ts`'s first test never clicks the `WorldIntroScreen` Begin button, which commit `ba8ce1c` made a hard gate on the opening step — the test deadlocks waiting for the first bubble. This phase's E2E tests run serially after it, so step 10 adds the missing click (flagged inline as a found-bug fix). Do not otherwise restructure that test.
6. **`resumeBubblesFromEvents` gains an optional `count` param (default 2).** The plan says "last 2-3 beat events … reuse `resumeBubblesFromEvents`" — the helper currently hard-slices `-2`. The param keeps existing call sites byte-identical in behaviour and lets the recap screen ask for 3.
7. **Session-open recording moves behind the recap gate (accepted semantics change).** Today the resumed-world path fires `recordSessionOpen` (`src/lib/life/engagement.ts` — `lastSessionAt` + `sessionDayCount` streak tracking; `docs/specs/life-sim-status.md` pins "updated per session-open") the moment the events listener resolves. E8 places it AFTER the `recapDismissed` gate, so it now fires when the player taps Continue on the recap — a recap peek-and-leave does not count as a session open. Accepted deliberately: this mirrors the existing fresh-world behaviour, where `recordSessionOpen` already sits behind the `introDismissed` gate (an intro peek-and-leave records nothing), and the exit-time recap generation (N4) still runs on such a peek.

## Read first

1. `docs/plans/wurlds-v2/00-approved-plan.md` — "Phase C" section + Context.
2. `docs/specs/life-sim.md` — §2 (LIFE-FLOW-*), §1 (LIFE-DATA-*), §13 (LIFE-EVENT-3 — beat payloads carry the bilingual text the mini-bubbles rehydrate), §12 (LIFE-COMPACT-* — the pattern `runResumeRecapGenerate` copies), §20 Design decisions.
3. `docs/specs/README.md` — naming convention + prefix table. **No README change is needed**: the `LIFE-*` row already lists `FLOW` as a section; LIFE-FLOW-5 introduces no new prefix.
4. Source to mirror (read, do not modify unless an edit below says so): `src/screens/LifeScreen/WorldIntroScreen.tsx` (overlay pattern), `src/screens/LifeScreen/LifeScreen.tsx` (introDismissed gate + opening effect), `src/lib/life/runCompaction.ts` + `src/lib/life/compactionPrompts.ts` (the generate pattern being copied), `src/lib/life/modelConfig.ts`, `src/lib/life/world.ts` (`updateLifeWorld`), `src/lib/life/engagement.ts` (the `serverTimestamp() as unknown as …` write-cast precedent), `src/hooks/useLifeEvents.ts` (events are OLDEST → NEWEST, window of 40), `tests/e2e/helpers/lifeMock.ts`, `tests/e2e/specs/life-flow.spec.ts`.

## Spec changes

### S1 — `docs/specs/life-sim.md`: add LIFE-FLOW-5 to the §2 table

ANCHOR (verify unique — this whole table row on one line):

```
| **LIFE-FLOW-4** | If a `lifeStep` was in-flight when the app was backgrounded, the optimistic UI state (bubble + chip grid placeholder) re-renders on resume. The Cloud Function call resumes from where it left off (idempotent on the `stepId` the client provides). |
```

Insert this new table row IMMEDIATELY AFTER that line:

```
| **LIFE-FLOW-5** | **Resume recap (wurlds-v2 Phase C).** Re-entering a world whose event log is NON-empty overlays `WurldResumeScreen` before any dialogue seeding, assembled ENTIRELY from stored data (zero LLM on the resume path): saga title + tone; `saga.playerFacingTeaser` ("The story"); `currentArc.premise` + chapter number; `resumeRecap.text` — else `rollingSummary` when non-empty, else the section hides; and the last ≤3 `beat` events as verbatim mini-bubbles ("Moments ago"). Tapping Continue releases the LIFE-FLOW-2 seeding. Fresh worlds (0 events) keep `WorldIntroScreen` and never see the recap. The recap text is polished FIRE-AND-FORGET on world exit (LifeScreen unmount / back-nav): a flash-lite call (category `life_resume_recap`; input = rollingSummary + chapter premise + last ≤10 beat/decision events) writes `world.resumeRecap = { text: practice paragraph + '\n\n' + native paragraph, lastEventId: newest event id in the input, generatedAt }`. It fires ONLY when ≥5 events landed since `resumeRecap.lastEventId` (no recap yet, or an anchor id that fell out of the 40-event listener window, counts as stale ⇒ fire). Every generation failure is tolerated — no retry, no UI; the next world exit is the retry. |
```

### S2 — `docs/specs/life-sim.md`: add the Phase C test row to §18

ANCHOR (verify unique):

```
| TBD: `src/screens/LifeScreen/*.test.tsx` (Phase B) | LIFE-UI-1..7, LIFE-BUBBLE-1..8 |
```

Insert IMMEDIATELY AFTER that line:

```
| `src/lib/life/runResumeRecapGenerate.test.ts`, `src/lib/life/prompts/resumeRecap.test.ts`, `src/screens/LifeScreen/WurldResumeScreen.test.tsx`, `src/screens/LifeScreen/useResumeRecapOnExit.test.tsx`, `src/lib/life/resumeBubbles.test.ts`, `tests/e2e/specs/life-flow.spec.ts` (wurlds-v2 Phase C) | LIFE-FLOW-5 — recap screen contract, exit-generation gate, persisted recap |
```

### S3 — `docs/specs/life-sim.md`: append a Design decisions subsection

ANCHOR (verify unique — the current LAST line of the file):

```
without per-event language fields.
```

Append AFTER it (blank line, then):

```

### Why the resume recap assembles from stored data (wurlds-v2 Phase C)

The recap screen must be INSTANT — it renders in the same frame as the world it overlays, offline-tolerant, and free. Every field it shows is already persisted (saga teaser, arc premise, rollingSummary, beat events), so the resume path makes zero LLM calls; the only generation is a single flash-lite polish call fired-and-forgotten on world EXIT, where its latency is invisible and its failure costs nothing (the screen falls back to rollingSummary, then hides the section). Exit-not-entry also means the recap describes the session that just ended — exactly the "Previously on…" content. The ≥5-new-events gate (anchored on `resumeRecap.lastEventId`) keeps a quick peek-and-leave from burning a call; an out-of-window anchor id counts as stale because at least a full listener window of events has landed since. Session-open recording moves with the Continue tap for the same reason: a recap peek-and-leave counts as neither a generation trigger nor a session day — `recordSessionOpen` (streak tracking) fires on recap-Continue, mirroring the fresh-world flow where it already sits behind the intro's Begin. `resumeRecap.text` stores BOTH languages in one string (practice paragraph + blank line + native paragraph, rendered `whitespace-pre-line`) — one field keeps the world-doc schema flat and the fallback chain (`text → rollingSummary → hide`) one-dimensional. The call uses DEFAULT temperature (not `LIFE_TEMPERATURE` 0.95): recap is faithful summarisation, the same stance compaction takes. Revisit trigger: the "recap quiz" backlog item wants a comprehension question at recap time — that adds a gen call on the resume path and should re-open this decision.
```

## Ordered steps

1. **Spec edit** — apply S1, S2, S3 above to `docs/specs/life-sim.md`. No `docs/specs/README.md` change (FLOW prefix already listed).
2. **Write the failing tests.** Create/extend ALL files in "## Tests" below (T1–T6) exactly as written. Then run:
   `npx vitest run src/lib/life/runResumeRecapGenerate.test.ts src/lib/life/prompts/resumeRecap.test.ts src/lib/life/resumeBubbles.test.ts src/screens/LifeScreen/WurldResumeScreen.test.tsx src/screens/LifeScreen/useResumeRecapOnExit.test.tsx`
   Expected result at this point: the new test files FAIL (unresolved imports — the modules don't exist yet) and the extended `resumeBubbles.test.ts` fails wholesale at import time (the old module has no `buildResumeSeed` export, so the whole file errors before any assertion — including the `count=3` case — runs). If everything passes, STOP — the assertions are wrong.
3. **Edit E1** — `src/types/firestore.ts`: add the `resumeRecap` field to `ZLifeWorld`.
4. **Edit E2** — `src/lib/life/resumeBubbles.ts`: full-file replacement (adds `count` param + `buildResumeSeed`).
5. **New file N1** — `src/lib/life/prompts/resumeRecap.ts`.
6. **New file N2** — `src/lib/life/runResumeRecapGenerate.ts`.
7. **Edit E3** — `src/i18n/locales/en.ts`: add the six `life.resume.*` keys. (Do NOT touch any other locale file — regen happens later.)
8. **New file N3** — `src/screens/LifeScreen/WurldResumeScreen.tsx`. **New file N4** — `src/screens/LifeScreen/useResumeRecapOnExit.ts`.
9. **Edits E4–E9** — `src/screens/LifeScreen/LifeScreen.tsx` wiring (imports, state, hook call, gated resume seeding, fresh-world recap dismissal E8b, deps, render).
10. **Edits E10–E13** — E2E: extend `tests/e2e/helpers/lifeMock.ts` (recap fixture queue) and `tests/e2e/specs/life-flow.spec.ts` (found-bug Begin click; fresh-world no-recap guard; replace the old resume test with the two LIFE-FLOW-5 tests).
11. **Run to green** — everything in "## Verify", in order. Read the two new screenshots (`resume-recap`, `resume-prompt`) with your eyes per the repo's reliability principles.

---

### E1 — `src/types/firestore.ts`: `resumeRecap` on `ZLifeWorld`

ANCHOR (verify unique):

```ts
  /** LIFE-WORLD-ARC-*: archived chapters, oldest → newest. */
  completedArcs: z.array(ZWorldArc).optional(),
```

Insert IMMEDIATELY AFTER those two lines (before `createdAt: ZTimestamp.optional(),`):

```ts
  /** LIFE-FLOW-5 (wurlds-v2 Phase C): "Previously on…" recap shown by
   *  WurldResumeScreen on re-entry. Generated fire-and-forget on world
   *  exit. `text` = practice paragraph + '\n\n' + native paragraph.
   *  `lastEventId` = newest event id included in the generation input;
   *  the exit hook regenerates only when ≥5 newer events exist.
   *  Absent/null = never generated (screen falls back to
   *  rollingSummary). */
  resumeRecap: z
    .object({
      text: z.string(),
      lastEventId: z.string(),
      generatedAt: ZTimestamp.optional(),
    })
    .nullable()
    .optional(),
```

### E2 — `src/lib/life/resumeBubbles.ts`: full-file replacement

Replace the ENTIRE file contents with:

```ts
/**
 * LIFE-FLOW-2 / LIFE-FLOW-5: derive the bubble window + resume chip
 * the player sees when they come back into an existing life world.
 * Reads trailing beat events from the events log + maps them back
 * into Bubble objects the dialogue area (and the WurldResumeScreen's
 * "Moments ago" strip) can render directly.
 *
 * Pulled out of LifeScreen so the screen stays focused on UI state.
 */
import type { MessageKey, TParams } from '@/i18n';
import type { StepChoice } from './stepSchema';
import type { LifeEvent } from '@/types/firestore';

export type ResumeBubble = {
  id: string;
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  npcId?: string | null;
  practiceText: string;
  nativeText: string | null;
};

export function resumeBubblesFromEvents(
  events: ReadonlyArray<LifeEvent>,
  count = 2,
): ResumeBubble[] {
  return events
    .filter((e) => e.kind === 'beat')
    .slice(-count)
    .map((e, i) => {
      const p = (e.payload ?? {}) as {
        speaker?: 'narrator' | 'npc' | 'user';
        speakerName?: string | null;
        npcId?: string | null;
        practiceText?: string;
        nativeText?: string | null;
      };
      return {
        id: `resume-${e.id ?? i}`,
        speaker: p.speaker ?? 'narrator',
        speakerName: p.speakerName ?? null,
        npcId: p.npcId ?? null,
        practiceText: p.practiceText ?? '',
        nativeText: p.nativeText ?? null,
      };
    })
    .filter((b) => b.practiceText.length > 0);
}

/** LIFE-FLOW-2: the dialogue seed LifeScreen applies once the player
 *  dismisses the WurldResumeScreen (LIFE-FLOW-5) — last-2 beat
 *  bubbles (or a narrator fallback) + the single '__resume__' chip.
 *  Takes `t` as a plain function so this module stays React-free. */
export function buildResumeSeed(
  events: ReadonlyArray<LifeEvent>,
  t: (key: MessageKey, params?: TParams) => string,
): { bubbles: ResumeBubble[]; choices: StepChoice[] } {
  const beatBubbles = resumeBubblesFromEvents(events);
  const bubbles: ResumeBubble[] =
    beatBubbles.length > 0
      ? beatBubbles
      : [
          {
            id: 'resume',
            speaker: 'narrator',
            practiceText: t('life.resume.prompt.practice'),
            nativeText: t('life.resume.prompt.native'),
          },
        ];
  return {
    bubbles,
    choices: [
      {
        id: '__resume__',
        practiceText: t('life.resume.continue.practice'),
        nativeText: t('life.resume.continue.native'),
        emoji: '▶️',
      },
    ],
  };
}
```

### N1 — NEW `src/lib/life/prompts/resumeRecap.ts` (complete contents)

```ts
/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): SI + user-prompt builder for the
 * fire-and-forget "Previously on…" resume-recap Gemini call.
 *
 * Mirrors compactionPrompts.ts (XML-tagged sections, stable-on-top).
 * The recap is a FAITHFUL summary in TV-recap register — it reads
 * ONLY what happened (rollingSummary + chapter premise + recent
 * beat/decision events). Saga pillars (twists, antagonist, endings)
 * are deliberately NOT in the input, so the model cannot spoil them.
 *
 * Spec: docs/specs/life-sim.md LIFE-FLOW-5.
 */
import type { LifeEvent, LifeWorld } from '@/types/firestore';

/** How many trailing beat/decision events the prompt includes. */
export const RESUME_RECAP_EVENT_COUNT = 10;

export function resumeRecapSystemInstruction(opts: {
  practiceLanguage: string;
  nativeLanguage: string;
}): string {
  const { practiceLanguage, nativeLanguage } = opts;
  return [
    `You write the "Previously on…" recap for a language-learning life simulator. The player has a persistent character living in a fictional world; they're learning ${practiceLanguage} (native language: ${nativeLanguage}). They are about to re-enter their world after time away, and your recap is the first thing they read.`,
    `YOUR JOB:`,
    `From the rolling summary, the current chapter premise, and the most recent events, write a SHORT "Previously on…" recap of where the story stands — warm TV-recap register, second person ("you"), present tense for the current situation.`,
    `LENGTH — HARD CAP: 2-3 sentences per language, ≤ 500 characters per language.`,
    `RULES:`,
    `- FAITHFUL ONLY: recap what actually happened in the input. Never invent characters, places, or events. Never speculate about or foreshadow what happens next — no teases, no "little do you know".`,
    `- End on the CURRENT open thread (the thing the player was in the middle of), so tapping Continue feels natural.`,
    `- Keep proper names and ${practiceLanguage} vocabulary exactly as they appear in the input.`,
    `OUTPUT FORMAT (CRITICAL):`,
    `Return a single strict-JSON object. No prose before or after. No markdown fences. The schema is:`,
    `{`,
    `  "practiceText": "the recap written in ${practiceLanguage}",`,
    `  "nativeText": "the same recap written in ${nativeLanguage}"`,
    `}`,
    `Both fields carry the SAME recap content — one per language. Simple ${practiceLanguage} (the player is a learner); natural ${nativeLanguage}.`,
  ].join('\n\n');
}

export function buildResumeRecapPrompt(input: {
  world: LifeWorld;
  /** Event window, OLDEST → NEWEST (the exit hook passes the
   *  listener's 40-event window; only the trailing beat/decision
   *  rows are rendered). */
  events: ReadonlyArray<LifeEvent>;
}): string {
  const { world, events } = input;
  const sections: string[] = [];

  sections.push(
    `<character name="${escapeAttr(world.characterName)}" practiceLanguage="${escapeAttr(world.practiceLanguage)}" nativeLanguage="${escapeAttr(world.nativeLanguage)}"/>`,
  );

  if (world.currentArc) {
    sections.push(
      `<chapter number="${world.currentArc.chapterNumber}">${escapeText(world.currentArc.premise)}</chapter>`,
    );
  }

  const summary = (world.rollingSummary ?? '').trim();
  sections.push(
    summary.length > 0
      ? `<rollingSummary>\n${escapeText(summary)}\n</rollingSummary>`
      : `<rollingSummary empty="true"/>`,
  );

  const recent = events
    .filter((e) => e.kind === 'beat' || e.kind === 'decision')
    .slice(-RESUME_RECAP_EVENT_COUNT)
    .map((e) => renderEvent(e))
    .filter((line) => line.length > 0)
    .join('\n');
  sections.push(
    recent.length > 0
      ? `<recentEvents>\n${recent}\n</recentEvents>`
      : `<recentEvents empty="true"/>`,
  );

  sections.push(
    `<task>Write the "Previously on…" recap per the SI. Return a single JSON object with practiceText and nativeText.</task>`,
  );

  return sections.join('\n\n');
}

function renderEvent(e: LifeEvent): string {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  if (e.kind === 'beat') {
    const speaker = typeof p.speaker === 'string' ? p.speaker : 'narrator';
    const name =
      typeof p.speakerName === 'string' && p.speakerName.length > 0
        ? ` name="${escapeAttr(p.speakerName)}"`
        : '';
    const text = typeof p.practiceText === 'string' ? p.practiceText : '';
    if (text.length === 0) return '';
    return `<event kind="beat" speaker="${escapeAttr(speaker)}"${name}>${escapeText(text)}</event>`;
  }
  if (e.kind === 'decision') {
    const text = typeof p.text === 'string' ? p.text : '';
    if (text.length === 0) return '';
    return `<event kind="decision">${escapeText(text)}</event>`;
  }
  return '';
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;',
  );
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, '&quot;');
}
```

### N2 — NEW `src/lib/life/runResumeRecapGenerate.ts` (complete contents)

```ts
/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): one fire-and-forget resume-recap
 * pass, copied from the runCompaction.ts pattern.
 *
 *   1. Self-gate: skip unless ≥ RESUME_RECAP_MIN_NEW_EVENTS events
 *      landed since world.resumeRecap.lastEventId (no recap yet, or
 *      an out-of-window anchor id, counts as stale ⇒ fire).
 *   2. Build SI + prompt (prompts/resumeRecap.ts).
 *   3. Single Gemini call (LIFE_PRIMARY_MODEL, thinkingLevel 'low',
 *      JSON output, category 'life_resume_recap'). DEFAULT
 *      temperature on purpose — faithfulness beats variety, the same
 *      stance compaction takes (deliberately NOT LIFE_TEMPERATURE).
 *   4. Validate against ZResumeRecapResponse, then persist
 *      world.resumeRecap = { text, lastEventId, generatedAt } via
 *      updateLifeWorld. `text` = practice paragraph + '\n\n' +
 *      native paragraph (single stored string; the screen renders it
 *      whitespace-pre-line).
 *
 * Every failure returns a typed result and is TOLERATED by the
 * caller (useResumeRecapOnExit fires-and-forgets): the resume screen
 * falls back to rollingSummary. No retries — the next world exit is
 * the retry.
 *
 * Spec: docs/specs/life-sim.md LIFE-FLOW-5.
 */
import { serverTimestamp } from 'firebase/firestore';
import { z } from 'zod';
import { generateGemini } from '../gemini';
import * as log from '../log';
import {
  buildResumeRecapPrompt,
  resumeRecapSystemInstruction,
} from './prompts/resumeRecap';
import { LIFE_PRIMARY_MODEL } from './modelConfig';
import { updateLifeWorld } from './world';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

/** Exit fires the generator only when at least this many events
 *  landed since the last recap (LIFE-FLOW-5). */
export const RESUME_RECAP_MIN_NEW_EVENTS = 5;

export const ZResumeRecapResponse = z.object({
  practiceText: z.string().trim().min(1).max(1200),
  nativeText: z.string().trim().min(1).max(1200),
});
export type ResumeRecapResponse = z.infer<typeof ZResumeRecapResponse>;

/** Events strictly NEWER than the stored recap's anchor event.
 *  `events` is the listener window, OLDEST → NEWEST. When the anchor
 *  id isn't in the window (≥ a full window of newer events exists) or
 *  no recap was ever generated, every event in the window counts. */
export function countEventsSinceRecap(
  world: LifeWorld,
  events: ReadonlyArray<LifeEvent>,
): number {
  const lastId = world.resumeRecap?.lastEventId;
  if (!lastId) return events.length;
  const idx = events.findIndex((e) => e.id === lastId);
  if (idx === -1) return events.length;
  return events.length - (idx + 1);
}

export type RunResumeRecapInput = {
  uid: string;
  world: LifeWorld;
  /** Listener window, OLDEST → NEWEST. */
  events: ReadonlyArray<LifeEvent>;
};

export type RunResumeRecapResult =
  | { kind: 'ok'; text: string; lastEventId: string }
  | { kind: 'skipped'; reason: 'no-events' | 'too-few-new-events' }
  | { kind: 'schema-failed'; raw: string }
  | { kind: 'error'; error: unknown };

export async function runResumeRecapGenerate(
  input: RunResumeRecapInput,
): Promise<RunResumeRecapResult> {
  const { uid, world, events } = input;
  const lastEventId = events.at(-1)?.id ?? '';
  if (lastEventId.length === 0) {
    return { kind: 'skipped', reason: 'no-events' };
  }
  if (countEventsSinceRecap(world, events) < RESUME_RECAP_MIN_NEW_EVENTS) {
    return { kind: 'skipped', reason: 'too-few-new-events' };
  }

  let raw: string;
  try {
    raw = await generateGemini({
      prompt: buildResumeRecapPrompt({ world, events }),
      systemInstruction: resumeRecapSystemInstruction({
        practiceLanguage: world.practiceLanguage,
        nativeLanguage: world.nativeLanguage,
      }),
      model: LIFE_PRIMARY_MODEL,
      // 'low': 2-3 faithful sentences from a small input — cheaper
      // than compaction's 'medium', which folds a far larger window.
      thinkingLevel: 'low',
      responseMimeType: 'application/json',
      category: 'life_resume_recap',
    });
  } catch (err) {
    log.warn('life.resumeRecap.gen-failed', { err: String(err) });
    return { kind: 'error', error: err };
  }

  const result = ZResumeRecapResponse.safeParse(safeParseJson(raw));
  if (!result.success) {
    log.warn('life.resumeRecap.schema-failed', { rawHead: raw.slice(0, 200) });
    return { kind: 'schema-failed', raw };
  }

  const text = `${result.data.practiceText}\n\n${result.data.nativeText}`;
  try {
    await updateLifeWorld(uid, world.id, {
      // serverTimestamp() is a FieldValue at write time; the read
      // side parses it back into a Timestamp via ZTimestamp. Same
      // cast precedent as engagement.ts's lastSessionAt write.
      resumeRecap: {
        text,
        lastEventId,
        generatedAt: serverTimestamp(),
      } as unknown as LifeWorld['resumeRecap'],
    });
  } catch (err) {
    log.warn('life.resumeRecap.write-failed', { err: String(err) });
    return { kind: 'error', error: err };
  }
  return { kind: 'ok', text, lastEventId };
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

### E3 — `src/i18n/locales/en.ts`: six new keys

ANCHOR (verify unique — two consecutive lines):

```ts
  'life.resume.continue.practice': 'Continuer',
  'life.resume.continue.native': 'Continue',
```

Insert IMMEDIATELY AFTER those two lines:

```ts
  'life.resume.eyebrow': 'Previously, in this wurld',
  'life.resume.story': 'The story',
  'life.resume.chapter': 'Chapter {number}',
  'life.resume.previously': 'Previously',
  'life.resume.momentsAgo': 'Moments ago',
  'life.resume.continue': 'Continue',
```

### N3 — NEW `src/screens/LifeScreen/WurldResumeScreen.tsx` (complete contents)

```tsx
/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): "Previously, in this wurld…" —
 * the overlay a player sees when re-entering a world whose event log
 * is non-empty.
 *
 * Mirrors WorldIntroScreen's overlay pattern (fresh worlds keep THAT
 * screen; resumed worlds get this one). Assembled ENTIRELY from
 * stored data — zero LLM on the resume path:
 *   - header: saga title + tone;
 *   - "The story": saga.playerFacingTeaser (the card description);
 *   - "Chapter N": currentArc.premise;
 *   - "Previously": resumeRecap.text, else rollingSummary;
 *   - "Moments ago": the last ≤3 beat events as mini-bubbles;
 *   - "Continue" CTA → onContinue releases the resume-seeding gate.
 * Every section hides when its stored datum is absent — a degenerate
 * world still shows header + CTA (never a broken section).
 *
 * Spec: docs/specs/life-sim.md LIFE-FLOW-5.
 */
import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import {
  resumeBubblesFromEvents,
  type ResumeBubble,
} from '@/lib/life/resumeBubbles';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

export type WurldResumeScreenProps = {
  world: LifeWorld;
  /** Event window, OLDEST → NEWEST (LifeScreen's useLifeEvents). */
  events: LifeEvent[];
  onContinue: () => void;
};

export function WurldResumeScreen({
  world,
  events,
  onContinue,
}: WurldResumeScreenProps) {
  const t = useT();
  const title = world.saga?.title?.trim() || world.characterName;
  const tone = world.saga?.tone?.trim() ?? '';
  const teaser = world.saga?.playerFacingTeaser?.trim() ?? '';
  const premise = world.currentArc?.premise?.trim() ?? '';
  const recapStored = world.resumeRecap?.text.trim() ?? '';
  const recap = recapStored.length > 0 ? recapStored : world.rollingSummary.trim();
  const moments = resumeBubblesFromEvents(events, 3);
  return (
    <div
      data-testid="LifeScreen-WurldResume"
      role="dialog"
      aria-modal="true"
      className="absolute inset-0 z-40 flex items-center justify-center px-4 pb-4 pt-safe-top bg-(--color-bg)/85 backdrop-blur-sm animate-in fade-in duration-300"
    >
      <div className="max-w-md w-full max-h-full overflow-y-auto rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-6 flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center gap-1.5 text-(--color-fg-muted) text-[11px] uppercase font-semibold tracking-wider">
          <History size={12} className="text-(--color-accent)" />
          <span>{t('life.resume.eyebrow')}</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold leading-tight text-gradient-accent">
            {title}
          </h2>
          {tone.length > 0 && (
            <p className="mt-1 text-xs italic text-(--color-fg-muted)">{tone}</p>
          )}
        </div>
        {teaser.length > 0 && (
          <div>
            <SectionLabel>{t('life.resume.story')}</SectionLabel>
            <p className="mt-1 text-sm text-(--color-fg) leading-relaxed">
              {teaser}
            </p>
          </div>
        )}
        {world.currentArc && premise.length > 0 && (
          <div data-testid="LifeScreen-WurldResume-Chapter">
            <SectionLabel>
              {t('life.resume.chapter', {
                number: world.currentArc.chapterNumber,
              })}
            </SectionLabel>
            <p className="mt-1 text-sm text-(--color-fg) leading-relaxed">
              {premise}
            </p>
          </div>
        )}
        {recap.length > 0 && (
          <div data-testid="LifeScreen-WurldResume-Recap">
            <SectionLabel>{t('life.resume.previously')}</SectionLabel>
            <p className="mt-1 text-sm text-(--color-fg) leading-relaxed whitespace-pre-line">
              {recap}
            </p>
          </div>
        )}
        {moments.length > 0 && (
          <div data-testid="LifeScreen-WurldResume-Moments">
            <SectionLabel>{t('life.resume.momentsAgo')}</SectionLabel>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {moments.map((m) => (
                <MomentBubble key={m.id} moment={m} />
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onContinue}
          data-testid="LifeScreen-WurldResume-Continue"
          className="mt-2 w-full shrink-0 py-3 rounded-full text-sm font-semibold bg-gradient-accent text-white"
        >
          {t('life.resume.continue')}
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
      {children}
    </div>
  );
}

function MomentBubble({ moment }: { moment: ResumeBubble }) {
  if (moment.speaker === 'narrator') {
    return (
      <div className="self-center px-3 text-center text-xs italic text-(--color-fg-muted)">
        {moment.practiceText}
      </div>
    );
  }
  if (moment.speaker === 'user') {
    return (
      <div className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-gradient-accent px-3 py-2 text-xs text-white">
        {moment.practiceText}
      </div>
    );
  }
  return (
    <div className="self-start max-w-[85%] rounded-2xl rounded-bl-md bg-(--color-bg-hover) border border-(--color-border)/50 px-3 py-2 text-xs text-(--color-fg)">
      {moment.speakerName ? (
        <span className="block text-[10px] font-semibold text-(--color-fg-muted)">
          {moment.speakerName}
        </span>
      ) : null}
      {moment.practiceText}
    </div>
  );
}
```

### N4 — NEW `src/screens/LifeScreen/useResumeRecapOnExit.ts` (complete contents)

```ts
/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): fire the fire-and-forget
 * resume-recap generator when the player EXITS a world (LifeScreen
 * unmount or worldId change — back-nav, exit-to-overview, any route
 * change). Extracted from LifeScreen.tsx to respect the 600-LOC cap.
 *
 * A ref snapshots the latest {uid, world, events} on every render
 * commit; the unmount cleanup reads the snapshot and fires
 * runResumeRecapGenerate, which self-gates on ≥5 new events since
 * the last recap and tolerates every failure (LIFE-FLOW-5).
 *
 * StrictMode note (dev-only double-mount): the synthetic first
 * cleanup runs right after mount. On a cold cache the snapshot is
 * still null (listeners haven't delivered) and nothing fires. With
 * a WARM in-memory snapshot cache (lib/snapshotCache.ts —
 * session-scoped, not persisted; useLifeWorld / useLifeEvents seed
 * synchronously from it on same-session re-entry, never across a
 * reload) it CAN fire once on entry — tolerated by design:
 * the call self-gates on ≥5 new events, and an entry-time recap
 * describes the end of the PREVIOUS session, which is exactly the
 * content the resume screen wants. Production builds double-mount
 * nothing.
 *
 * World-delete note: deleting the world also unmounts the screen;
 * the generator's updateLifeWorld then rejects on the missing doc
 * and the error is swallowed by design (fire-and-forget).
 */
import { useEffect, useRef } from 'react';
import { runResumeRecapGenerate } from '@/lib/life/runResumeRecapGenerate';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

export function useResumeRecapOnExit(opts: {
  uid: string | null;
  world: LifeWorld | null;
  events: LifeEvent[];
  worldId: string | null;
}): void {
  const snapRef = useRef<{
    uid: string;
    world: LifeWorld;
    events: LifeEvent[];
  } | null>(null);
  useEffect(() => {
    snapRef.current =
      opts.uid && opts.world
        ? { uid: opts.uid, world: opts.world, events: opts.events }
        : null;
  }, [opts.uid, opts.world, opts.events]);
  useEffect(() => {
    const exitedWorldId = opts.worldId;
    return () => {
      const snap = snapRef.current;
      // The snapshot must belong to the world being exited — guards
      // the (currently impossible) direct world→world navigation.
      if (!snap || snap.world.id !== exitedWorldId) return;
      snapRef.current = null;
      void runResumeRecapGenerate(snap).catch(() => undefined);
    };
  }, [opts.worldId]);
}
```

### E4 — `src/screens/LifeScreen/LifeScreen.tsx`: swap the resumeBubbles import

ANCHOR (verify unique):

```ts
import { resumeBubblesFromEvents } from '@/lib/life/resumeBubbles';
```

Replace with:

```ts
import { buildResumeSeed } from '@/lib/life/resumeBubbles';
```

### E5 — `LifeScreen.tsx`: add the two new imports

ANCHOR (verify unique):

```ts
import { WorldIntroScreen } from './WorldIntroScreen';
```

Replace with:

```ts
import { WorldIntroScreen } from './WorldIntroScreen';
import { WurldResumeScreen } from './WurldResumeScreen';
import { useResumeRecapOnExit } from './useResumeRecapOnExit';
```

### E6 — `LifeScreen.tsx`: `recapDismissed` state

ANCHOR (verify unique):

```ts
  const [introDismissed, setIntroDismissed] = useState(false);
```

Replace with:

```ts
  const [introDismissed, setIntroDismissed] = useState(false);
  /** LIFE-FLOW-5 (wurlds-v2 Phase C): false until the player taps
   *  Continue on the WurldResumeScreen overlay. Gates the LIFE-FLOW-2
   *  resume seeding the same way introDismissed gates a fresh world's
   *  opening step. Fresh worlds (0 events) never see the recap. */
  const [recapDismissed, setRecapDismissed] = useState(false);
```

### E7 — `LifeScreen.tsx`: mount the exit hook

ANCHOR (verify unique):

```ts
  const eventsLoaded = !events.loading;
```

Replace with:

```ts
  const eventsLoaded = !events.loading;

  // LIFE-FLOW-5: fire-and-forget recap polish on world exit.
  useResumeRecapOnExit({ uid: user?.uid ?? null, world: worldData ?? null, events: eventsData, worldId });
```

### E8 — `LifeScreen.tsx`: gate + compact the resume seeding

ANCHOR (verify unique — copy the whole block exactly; it is the only `if (eventsData.length > 0) {` in the file):

```ts
    if (eventsData.length > 0) {
      // LIFE-FLOW-2: resume replays the last beat events into the
      // dialogue window so the player lands on context, not a
      // generic continue prompt. Helper extracted to resumeBubbles.ts.
      openingFiredRef.current = true;
      void recordSessionOpen(user.uid, worldData).catch(() => undefined);
      const beatBubbles = resumeBubblesFromEvents(eventsData);
      const fallbackBubble: Bubble = {
        id: 'resume',
        speaker: 'narrator',
        practiceText: t('life.resume.prompt.practice'),
        nativeText: t('life.resume.prompt.native'),
      };
      setState((prev) => ({
        ...prev,
        bubbles: beatBubbles.length > 0 ? beatBubbles : [fallbackBubble],
        choices: [
          {
            id: '__resume__',
            practiceText: t('life.resume.continue.practice'),
            nativeText: t('life.resume.continue.native'),
            emoji: '▶️',
          },
        ],
      }));
      return;
    }
```

Replace with:

```ts
    if (eventsData.length > 0) {
      // LIFE-FLOW-5 (wurlds-v2 Phase C): the WurldResumeScreen overlay
      // shows first on resumed worlds; hold the LIFE-FLOW-2 seeding
      // until the player taps Continue (same gate shape as
      // introDismissed). openingFiredRef stays false so this effect
      // re-runs when recapDismissed flips.
      if (!recapDismissed) return;
      // LIFE-FLOW-2: resume replays the last beat events into the
      // dialogue window so the player lands on context, not a
      // generic continue prompt. Helper extracted to resumeBubbles.ts.
      openingFiredRef.current = true;
      void recordSessionOpen(user.uid, worldData).catch(() => undefined);
      setState((prev) => ({ ...prev, ...buildResumeSeed(eventsData, t) }));
      return;
    }
```

(`Bubble` remains imported and used elsewhere in the file — do not remove its import.)

### E8b — `LifeScreen.tsx`: fresh worlds never see the recap

Without this edit, a FRESH world would pop the recap overlay mid-play: the opening step's beats land as events moments after `runStep({ isOpening: true })`, flipping `eventsData.length > 0` while `recapDismissed` is still `false` — E9b's render condition would then show the overlay on top of the live first turn. Mark the recap dismissed the instant the fresh-world opening path commits.

ANCHOR (verify unique — `grep -F -c 'void runStep({ isOpening: true });' src/screens/LifeScreen/LifeScreen.tsx` must print `1`):

```ts
    void runStep({ isOpening: true });
```

Replace with:

```ts
    // LIFE-FLOW-5: a fresh world must never show the resume recap.
    // The opening step's beats land as events moments from now
    // (eventsData.length flips > 0); without this, E9b's overlay
    // condition would fire mid-play. Dismissed = never shows.
    setRecapDismissed(true);
    void runStep({ isOpening: true });
```

(This sits inside the effect already wrapped in `/* eslint-disable react-hooks/set-state-in-effect */` — no new lint suppression is needed.)

### E9a — `LifeScreen.tsx`: effect deps

ANCHOR (verify unique):

```ts
  }, [user, worldData, worldData?.saga, worldData?.currentArc, eventsLoaded, eventsData.length, introDismissed, runStep, t]);
```

Replace with:

```ts
  }, [user, worldData, worldData?.saga, worldData?.currentArc, eventsLoaded, eventsData.length, introDismissed, recapDismissed, runStep, t]);
```

### E9b — `LifeScreen.tsx`: render the overlay

ANCHOR (verify unique — the whole WorldIntroScreen JSX block; the `onBegin` line is unique in the file):

```tsx
        {worldData.saga &&
          eventsLoaded &&
          eventsData.length === 0 &&
          !introDismissed && (
            <WorldIntroScreen
              title={worldData.saga.title}
              teaser={worldData.saga.playerFacingTeaser}
              tone={worldData.saga.tone}
              onBegin={() => setIntroDismissed(true)}
            />
          )}
```

Replace with:

```tsx
        {worldData.saga &&
          eventsLoaded &&
          eventsData.length === 0 &&
          !introDismissed && (
            <WorldIntroScreen
              title={worldData.saga.title}
              teaser={worldData.saga.playerFacingTeaser}
              tone={worldData.saga.tone}
              onBegin={() => setIntroDismissed(true)}
            />
          )}
        {eventsLoaded && eventsData.length > 0 && !recapDismissed && (
          <WurldResumeScreen world={worldData} events={eventsData} onContinue={() => setRecapDismissed(true)} />
        )}
```

### E10 — `tests/e2e/helpers/lifeMock.ts`: fixture type

ANCHOR (verify unique):

```ts
export type LifeMockFixtures = {
  steps: StepResponse[];
  scenes: string[];
};
```

Replace with:

```ts
export type LifeResumeRecapFixture = {
  practiceText: string;
  nativeText: string;
};

export type LifeMockFixtures = {
  steps: StepResponse[];
  scenes: string[];
  /** LIFE-FLOW-5: fixtures for `life_resume_recap` calls (fired on
   *  world exit). Omit when the spec never exits a world. */
  resumeRecaps?: LifeResumeRecapFixture[];
};
```

### E11 — `tests/e2e/helpers/lifeMock.ts`: recap queue

ANCHOR (verify unique):

```ts
  const sceneQueue = [...fixtures.scenes];
```

Replace with:

```ts
  const sceneQueue = [...fixtures.scenes];
  const recapQueue = [...(fixtures.resumeRecaps ?? [])];
```

### E12 — `tests/e2e/helpers/lifeMock.ts`: recap handler

ANCHOR (verify unique):

```ts
    if (body.category === 'life_scene') {
```

Insert IMMEDIATELY BEFORE that line:

```ts
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
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ text: JSON.stringify(next) }),
      });
      return;
    }
```

### E13 — `tests/e2e/specs/life-flow.spec.ts`: found-bug Begin click + fresh-world no-recap guard + the two LIFE-FLOW-5 tests

**E13a** — ANCHOR (verify unique):

```ts
    // Opening beat lands once lifeStep resolves.
```

Insert IMMEDIATELY BEFORE that comment line:

```ts
    // LIFE-WORLD-SAGA-*: a brand-new world gates its opening step on
    // the WorldIntroScreen. The saga is real-generated (not mocked in
    // this spec), so give it a generous window to land, then release
    // the gate. Found-bug fix: this click was missing since the intro
    // screen shipped (ba8ce1c), which deadlocked the opening step.
    await page
      .getByTestId('LifeScreen-WorldIntro-Begin')
      .click({ timeout: 45_000 });

```

**E13a2** — ANCHOR (verify unique — `grep -F -c "await expect(page.getByTestId('LifeScreen-Bubble-npc')).toBeVisible();" tests/e2e/specs/life-flow.spec.ts` must print `1`):

```ts
    await expect(page.getByTestId('LifeScreen-Bubble-npc')).toBeVisible();
```

Insert IMMEDIATELY AFTER that line:

```ts
    // LIFE-FLOW-5 / E8b: fresh worlds never see the resume recap —
    // not even once the opening beats land as events. (Best-effort
    // instant check; the hard enforcement is the NEXT tests' chip
    // clicks, which a stray overlay would block.)
    await expect(page.getByTestId('LifeScreen-WurldResume')).toHaveCount(0);
```

**E13b** — POST-PHASE-A ANCHOR (verify unique). Phase A's T3 appended a `LIFE-UI-8` rebrand test AFTER the resume test, so the resume test is NO LONGER the last one in the describe — the anchor below therefore ends at the resume test's own closing `  });` and does NOT include the describe's final `});`. The two replacement tests land in the same slot, i.e. they run (serially) BEFORE Phase A's LIFE-UI-8 test — that ordering is correct: the exit test finishes on `/life/overview`, which is exactly the populated-overview state the LIFE-UI-8 test wants. If Phase A has NOT landed yet, you are executing out of order — stop.

```ts
  test('LIFE-FLOW-2 — resume on cold-open lands on a continue prompt', async ({}, testInfo) => {
    // Brand-new browser context but the world doc already exists
    // from the previous tests' onboarding. Simulate a cold reload.
    await installLifeMock(page, {
      steps: [FOLLOW_UP_AFTER_FILL_BLANK],
      scenes: [minimalSceneSvg()],
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    await expect(page.getByTestId('LifeScreen-DialogueArea')).toBeVisible({ timeout: 15_000 });
    // The resume path renders a "Continue" prompt because there are
    // already events in the log (LIFE-FLOW-2 Phase B.2).
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toBeVisible({ timeout: 10_000 });
    await captureBeat(page, testInfo, 'resume-prompt');
  });
```

Replace with:

```ts
  test('LIFE-FLOW-5 — resumed world shows the recap screen from stored data; Continue releases the LIFE-FLOW-2 seeding', async ({}, testInfo) => {
    // Seed a stored recap via the admin SDK so every assertion below
    // is deterministic. The screen must render STORED data — this
    // path makes zero LLM calls (steps: [] means any unexpected
    // life_step call 500s loudly). The nonexistent lastEventId also
    // arms the exit-generation test that follows: an out-of-window
    // anchor id counts as stale ⇒ ≥5 new events.
    const db = getAdminFirestore();
    const worlds = await db.collection(`users/${userA.uid}/lifeWorlds`).get();
    expect(worlds.empty).toBe(false);
    const worldRef = worlds.docs[0]!.ref;
    await worldRef.update({
      resumeRecap: {
        text: 'Sophie t\'a invité à déjeuner.\n\nSophie invited you to lunch.',
        lastEventId: 'seeded-nonexistent-event',
      },
    });

    await installLifeMock(page, {
      steps: [],
      scenes: [minimalSceneSvg()],
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');

    // The recap overlay renders BEFORE any dialogue seeding.
    await expect(page.getByTestId('LifeScreen-WurldResume')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText('Previously, in this wurld')).toBeVisible();
    // Stored resumeRecap.text wins over rollingSummary.
    await expect(page.getByTestId('LifeScreen-WurldResume-Recap')).toContainText(
      'Sophie invited you to lunch.',
    );
    // "Moments ago" mini-bubbles rehydrate from stored beat events —
    // Sophie's last line from the fill-blank test is the newest beat.
    await expect(page.getByTestId('LifeScreen-WurldResume-Moments')).toContainText(
      'À midi alors',
    );
    // The LIFE-FLOW-2 seeding is GATED until Continue.
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toHaveCount(0);
    await captureBeat(page, testInfo, 'resume-recap');

    await page.getByTestId('LifeScreen-WurldResume-Continue').click();
    await expect(page.getByTestId('LifeScreen-WurldResume')).toHaveCount(0);
    await expect(page.getByTestId('LifeScreen-Choice-__resume__')).toBeVisible({ timeout: 10_000 });
    await captureBeat(page, testInfo, 'resume-prompt');
  });

  test('LIFE-FLOW-5 — world exit fires the recap generator and persists resumeRecap', async () => {
    // ≥5 events landed since the seeded nonexistent lastEventId, so
    // exiting the world must fire exactly one life_resume_recap call.
    await installLifeMock(page, {
      steps: [],
      scenes: [],
      resumeRecaps: [
        {
          practiceText: 'Précédemment : Sophie et toi avez prévu un déjeuner.',
          nativeText: 'Previously: you and Sophie planned a lunch.',
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
    const worlds = await db.collection(`users/${userA.uid}/lifeWorlds`).get();
    const worldRef = worlds.docs[0]!.ref;
    await expect
      .poll(
        async () => {
          const snap = await worldRef.get();
          const recap = snap.data()?.resumeRecap as { text?: string } | undefined;
          return recap?.text ?? '';
        },
        { timeout: 15_000 },
      )
      .toContain('Previously: you and Sophie planned a lunch.');
    const snap = await worldRef.get();
    const recap = snap.data()?.resumeRecap as { text: string; lastEventId: string };
    expect(recap.text).toContain('Précédemment');
    expect(recap.lastEventId).not.toBe('seeded-nonexistent-event');
    expect(recap.lastEventId.length).toBeGreaterThan(0);
  });
```

(The blank line + Phase A's `LIFE-UI-8` test + the describe's closing `});` that follow the anchor stay exactly where they are — this edit replaces ONLY the old resume test.)

## Tests

Write these in step 2, BEFORE any implementation edit. They must fail (module-not-found for the new files; an import-time failure for the extended `resumeBubbles.test.ts` — see step 2) until steps 3–10 land.

### T1 — NEW `src/lib/life/runResumeRecapGenerate.test.ts` (complete contents)

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../gemini', () => ({
  generateGemini: vi.fn(),
}));

vi.mock('../log', () => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('./world', () => ({
  updateLifeWorld: vi.fn(),
}));

import { generateGemini } from '../gemini';
import { updateLifeWorld } from './world';
import {
  countEventsSinceRecap,
  runResumeRecapGenerate,
  RESUME_RECAP_MIN_NEW_EVENTS,
  ZResumeRecapResponse,
} from './runResumeRecapGenerate';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const generateGeminiMock = generateGemini as unknown as ReturnType<typeof vi.fn>;
const updateLifeWorldMock = updateLifeWorld as unknown as ReturnType<typeof vi.fn>;

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const beat = (id: string, practiceText = `line-${id}`): LifeEvent => ({
  id,
  kind: 'beat',
  payload: { speaker: 'npc', speakerName: 'Sophie', practiceText },
});

const events = (n: number): LifeEvent[] =>
  Array.from({ length: n }, (_, i) => beat(`e${i + 1}`));

const OK_JSON = JSON.stringify({
  practiceText: "Sophie t'a proposé un déjeuner.",
  nativeText: 'Sophie suggested lunch.',
});

beforeEach(() => {
  generateGeminiMock.mockReset();
  updateLifeWorldMock.mockReset();
  updateLifeWorldMock.mockResolvedValue(undefined);
});

describe('countEventsSinceRecap — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — counts every event when no recap was ever generated', () => {
    expect(countEventsSinceRecap(baseWorld, events(7))).toBe(7);
  });

  it('LIFE-FLOW-5 — counts only events newer than the anchor id', () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e6' },
    };
    expect(countEventsSinceRecap(world, events(10))).toBe(4);
  });

  it('LIFE-FLOW-5 — returns 0 when the anchor is the newest event', () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e10' },
    };
    expect(countEventsSinceRecap(world, events(10))).toBe(0);
  });

  it('LIFE-FLOW-5 — treats an out-of-window anchor id as all-new', () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'scrolled-out' },
    };
    expect(countEventsSinceRecap(world, events(10))).toBe(10);
  });
});

describe('ZResumeRecapResponse — LIFE-FLOW-5', () => {
  it('accepts a { practiceText, nativeText } payload', () => {
    expect(
      ZResumeRecapResponse.safeParse({ practiceText: 'a', nativeText: 'b' })
        .success,
    ).toBe(true);
  });

  it('rejects an empty practiceText', () => {
    expect(
      ZResumeRecapResponse.safeParse({ practiceText: '  ', nativeText: 'b' })
        .success,
    ).toBe(false);
  });

  it('rejects a missing nativeText', () => {
    expect(
      ZResumeRecapResponse.safeParse({ practiceText: 'a' }).success,
    ).toBe(false);
  });
});

describe('runResumeRecapGenerate — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — skips on an empty event log without calling the model', async () => {
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: [],
    });
    expect(result).toEqual({ kind: 'skipped', reason: 'no-events' });
    expect(generateGeminiMock).not.toHaveBeenCalled();
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — skips when fewer than 5 events landed since the last recap', async () => {
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e6' },
    };
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world,
      events: events(10), // e7..e10 = 4 new < 5
    });
    expect(result).toEqual({ kind: 'skipped', reason: 'too-few-new-events' });
    expect(generateGeminiMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — fires when exactly RESUME_RECAP_MIN_NEW_EVENTS new events landed', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'e5' },
    };
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world,
      // e1..e10 with anchor e5 → e6..e10 = 5 new = RESUME_RECAP_MIN_NEW_EVENTS.
      events: events(10),
    });
    expect(result.kind).toBe('ok');
    expect(generateGeminiMock).toHaveBeenCalledTimes(1);
    expect(RESUME_RECAP_MIN_NEW_EVENTS).toBe(5);
  });

  it('LIFE-FLOW-5 — treats an out-of-window lastEventId as stale and fires', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    const world = {
      ...baseWorld,
      resumeRecap: { text: 'old', lastEventId: 'scrolled-out' },
    };
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world,
      events: events(5),
    });
    expect(result.kind).toBe('ok');
  });

  it('LIFE-FLOW-5 — calls flash-lite with json mime + life_resume_recap category', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    await runResumeRecapGenerate({ uid: 'u1', world: baseWorld, events: events(6) });
    const call = generateGeminiMock.mock.calls[0]![0];
    expect(call.model).toBe('gemini-3.1-flash-lite');
    expect(call.thinkingLevel).toBe('low');
    expect(call.responseMimeType).toBe('application/json');
    expect(call.category).toBe('life_resume_recap');
    expect(call.temperature).toBeUndefined();
    expect(call.systemInstruction).toContain('French');
    expect(call.prompt).toContain('<character');
  });

  it('LIFE-FLOW-5 — persists practice+native combined text and re-anchors lastEventId to the newest event', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(10),
    });
    expect(result).toEqual({
      kind: 'ok',
      text: "Sophie t'a proposé un déjeuner.\n\nSophie suggested lunch.",
      lastEventId: 'e10',
    });
    expect(updateLifeWorldMock).toHaveBeenCalledTimes(1);
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      resumeRecap: expect.objectContaining({
        text: "Sophie t'a proposé un déjeuner.\n\nSophie suggested lunch.",
        lastEventId: 'e10',
      }),
    });
  });

  it('LIFE-FLOW-5 — strips markdown fences before parsing (defensive)', async () => {
    generateGeminiMock.mockResolvedValue('```json\n' + OK_JSON + '\n```');
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('ok');
  });

  it('LIFE-FLOW-5 — schema-failed on non-JSON output; nothing written', async () => {
    generateGeminiMock.mockResolvedValue('not json');
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('schema-failed');
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — schema-failed when a language field is missing; nothing written', async () => {
    generateGeminiMock.mockResolvedValue(
      JSON.stringify({ practiceText: 'only one' }),
    );
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('schema-failed');
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — error result when generateGemini throws; nothing written', async () => {
    generateGeminiMock.mockRejectedValue(new Error('network down'));
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('error');
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — error result when the world write fails', async () => {
    generateGeminiMock.mockResolvedValue(OK_JSON);
    updateLifeWorldMock.mockRejectedValue(new Error('firestore offline'));
    const result = await runResumeRecapGenerate({
      uid: 'u1',
      world: baseWorld,
      events: events(6),
    });
    expect(result.kind).toBe('error');
  });
});
```

### T2 — NEW `src/lib/life/prompts/resumeRecap.test.ts` (complete contents)

```ts
import { describe, expect, it } from 'vitest';
import {
  buildResumeRecapPrompt,
  resumeRecapSystemInstruction,
  RESUME_RECAP_EVENT_COUNT,
} from './resumeRecap';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const beat = (id: string, practiceText: string): LifeEvent => ({
  id,
  kind: 'beat',
  payload: { speaker: 'npc', speakerName: 'Sophie', practiceText },
});

describe('resumeRecapSystemInstruction — LIFE-FLOW-5', () => {
  const si = resumeRecapSystemInstruction({
    practiceLanguage: 'French',
    nativeLanguage: 'English',
  });

  it('LIFE-FLOW-5 — embeds practice + native languages', () => {
    expect(si).toContain('French');
    expect(si).toContain('English');
  });

  it('LIFE-FLOW-5 — names both JSON output fields and demands strict JSON', () => {
    expect(si).toContain('practiceText');
    expect(si).toContain('nativeText');
    expect(si).toMatch(/strict-JSON/);
    expect(si).toMatch(/No markdown fences/);
  });

  it('LIFE-FLOW-5 — carries the spoiler-safety rules', () => {
    expect(si).toMatch(/Never invent/i);
    expect(si).toMatch(/foreshadow/i);
  });

  it('LIFE-FLOW-5 — caps the recap at 2-3 sentences per language', () => {
    expect(si).toContain('2-3 sentences per language');
  });
});

describe('buildResumeRecapPrompt — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — emits character / chapter / rollingSummary / recentEvents / task in order', () => {
    const out = buildResumeRecapPrompt({
      world: {
        ...baseWorld,
        rollingSummary: 'SUMMARY_MARKER',
        currentArc: {
          chapterNumber: 2,
          premise: 'PREMISE_MARKER',
          themes: [],
          status: 'active',
          recurringNpcIds: [],
          completedCampaignMemories: [],
        },
      },
      events: [beat('e1', 'Salut !')],
    });
    const charIdx = out.indexOf('<character');
    const chapterIdx = out.indexOf('<chapter');
    const summaryIdx = out.indexOf('<rollingSummary');
    const eventsIdx = out.indexOf('<recentEvents');
    const taskIdx = out.indexOf('<task');
    expect(charIdx).toBeGreaterThan(-1);
    expect(chapterIdx).toBeGreaterThan(charIdx);
    expect(summaryIdx).toBeGreaterThan(chapterIdx);
    expect(eventsIdx).toBeGreaterThan(summaryIdx);
    expect(taskIdx).toBeGreaterThan(eventsIdx);
    expect(out).toContain('SUMMARY_MARKER');
    expect(out).toContain('PREMISE_MARKER');
    expect(out).toContain('number="2"');
  });

  it('LIFE-FLOW-5 — omits the chapter tag when no arc is active', () => {
    const out = buildResumeRecapPrompt({ world: baseWorld, events: [] });
    expect(out).not.toContain('<chapter');
  });

  it('LIFE-FLOW-5 — flags an empty rolling summary', () => {
    const out = buildResumeRecapPrompt({ world: baseWorld, events: [] });
    expect(out).toContain('<rollingSummary empty="true"/>');
    expect(out).toContain('<recentEvents empty="true"/>');
  });

  it('LIFE-FLOW-5 — renders only beat + decision events', () => {
    const out = buildResumeRecapPrompt({
      world: baseWorld,
      events: [
        beat('e1', 'Bonjour'),
        { id: 'e2', kind: 'decision', payload: { choiceId: 'yes', text: 'Dire oui' } },
        { id: 'e3', kind: 'correction', payload: { picked: 'veux' } },
        { id: 'e4', kind: 'npc_introduced', payload: { npcId: 'x', name: 'X' } },
      ],
    });
    expect(out).toContain('kind="beat"');
    expect(out).toContain('kind="decision"');
    expect(out).toContain('Dire oui');
    expect(out).not.toContain('kind="correction"');
    expect(out).not.toContain('kind="npc_introduced"');
  });

  it('LIFE-FLOW-5 — caps the event window at RESUME_RECAP_EVENT_COUNT', () => {
    const many = Array.from({ length: RESUME_RECAP_EVENT_COUNT + 2 }, (_, i) =>
      beat(`e${i + 1}`, `line-${i + 1}`),
    );
    const out = buildResumeRecapPrompt({ world: baseWorld, events: many });
    const rendered = out.match(/<event /g) ?? [];
    expect(rendered).toHaveLength(RESUME_RECAP_EVENT_COUNT);
    expect(out).not.toContain('line-1<');
    expect(out).not.toContain('line-2<');
    expect(out).toContain(`line-${RESUME_RECAP_EVENT_COUNT + 2}`);
  });

  it('LIFE-FLOW-5 — escapes XML-breaking characters', () => {
    const out = buildResumeRecapPrompt({
      world: { ...baseWorld, characterName: 'M&M "the kid" <Marc>' },
      events: [beat('e1', 'a < b & c')],
    });
    expect(out).toContain('M&amp;M &quot;the kid&quot; &lt;Marc&gt;');
    expect(out).toContain('a &lt; b &amp; c');
  });
});
```

### T3 — NEW `src/screens/LifeScreen/WurldResumeScreen.test.tsx` (complete contents)

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { WurldResumeScreen } from './WurldResumeScreen';
import type { LifeEvent, LifeWorld, WorldArc, WorldSaga } from '@/types/firestore';

const saga: WorldSaga = {
  title: 'The Lyon Letters',
  premise: 'model-only premise',
  playerFacingTeaser: 'A new life in Lyon, and a mystery in the mail.',
  tone: 'warm, curious',
  estimatedChapters: 6,
  centralConflict: 'c',
  antagonist: 'a',
  factions: [],
  keyArchetypes: [],
  storyMovements: [],
  midpointTwist: 'm',
  climax: 'x',
  endStates: [],
  loveInterestFate: 'open',
  openThreads: [],
};

const arc: WorldArc = {
  chapterNumber: 2,
  premise: 'Find out who sends the letters.',
  themes: [],
  status: 'active',
  recurringNpcIds: [],
  completedCampaignMemories: [],
};

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const beat = (
  id: string,
  practiceText: string,
  speaker: 'narrator' | 'npc' | 'user' = 'npc',
): LifeEvent => ({
  id,
  kind: 'beat',
  payload: { speaker, speakerName: speaker === 'npc' ? 'Sophie' : null, practiceText },
});

describe('WurldResumeScreen — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — renders header, teaser, chapter, stored recap and moments from stored data', () => {
    const world: LifeWorld = {
      ...baseWorld,
      saga,
      currentArc: arc,
      rollingSummary: 'ROLLING (must not show)',
      resumeRecap: {
        text: 'Tu as rencontré Sophie.\n\nYou met Sophie.',
        lastEventId: 'e2',
      },
    };
    render(
      <WurldResumeScreen
        world={world}
        events={[beat('e1', 'Salut !'), beat('e2', 'On déjeune ?')]}
        onContinue={vi.fn()}
      />,
    );
    expect(screen.getByText('Previously, in this wurld')).toBeInTheDocument();
    expect(screen.getByText('The Lyon Letters')).toBeInTheDocument();
    expect(screen.getByText('warm, curious')).toBeInTheDocument();
    expect(
      screen.getByText('A new life in Lyon, and a mystery in the mail.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Chapter 2')).toBeInTheDocument();
    expect(
      screen.getByText('Find out who sends the letters.'),
    ).toBeInTheDocument();
    const recap = screen.getByTestId('LifeScreen-WurldResume-Recap');
    expect(recap.textContent).toContain('Tu as rencontré Sophie.');
    expect(recap.textContent).toContain('You met Sophie.');
    expect(recap.textContent).not.toContain('ROLLING');
    const moments = screen.getByTestId('LifeScreen-WurldResume-Moments');
    expect(moments.textContent).toContain('Salut !');
    expect(moments.textContent).toContain('On déjeune ?');
    expect(moments.textContent).toContain('Sophie');
  });

  it('LIFE-FLOW-5 — falls back to rollingSummary when no resumeRecap is stored', () => {
    const world: LifeWorld = {
      ...baseWorld,
      saga,
      rollingSummary: 'Marc has settled into Lyon.',
    };
    render(
      <WurldResumeScreen world={world} events={[beat('e1', 'Salut !')]} onContinue={vi.fn()} />,
    );
    expect(
      screen.getByTestId('LifeScreen-WurldResume-Recap').textContent,
    ).toContain('Marc has settled into Lyon.');
  });

  it('LIFE-FLOW-5 — hides chapter, previously and moments sections when their datum is absent', () => {
    render(
      <WurldResumeScreen world={baseWorld} events={[]} onContinue={vi.fn()} />,
    );
    expect(screen.queryByTestId('LifeScreen-WurldResume-Chapter')).toBeNull();
    expect(screen.queryByTestId('LifeScreen-WurldResume-Recap')).toBeNull();
    expect(screen.queryByTestId('LifeScreen-WurldResume-Moments')).toBeNull();
    // Saga missing → title falls back to the character name.
    expect(screen.getByText('Marc')).toBeInTheDocument();
    expect(
      screen.getByTestId('LifeScreen-WurldResume-Continue'),
    ).toBeInTheDocument();
  });

  it('LIFE-FLOW-5 — shows at most the last 3 beats as moments', () => {
    const world: LifeWorld = { ...baseWorld, saga };
    render(
      <WurldResumeScreen
        world={world}
        events={[
          beat('e1', 'one'),
          beat('e2', 'two'),
          beat('e3', 'three'),
          beat('e4', 'four'),
          beat('e5', 'five'),
        ]}
        onContinue={vi.fn()}
      />,
    );
    const moments = screen.getByTestId('LifeScreen-WurldResume-Moments');
    expect(moments.textContent).not.toContain('one');
    expect(moments.textContent).not.toContain('two');
    expect(moments.textContent).toContain('three');
    expect(moments.textContent).toContain('four');
    expect(moments.textContent).toContain('five');
  });

  it('LIFE-FLOW-5 — Continue fires onContinue', () => {
    const onContinue = vi.fn();
    render(
      <WurldResumeScreen world={{ ...baseWorld, saga }} events={[]} onContinue={onContinue} />,
    );
    fireEvent.click(screen.getByTestId('LifeScreen-WurldResume-Continue'));
    expect(onContinue).toHaveBeenCalledTimes(1);
  });
});
```

### T4 — NEW `src/screens/LifeScreen/useResumeRecapOnExit.test.tsx` (complete contents)

```tsx
import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/life/runResumeRecapGenerate', () => ({
  runResumeRecapGenerate: vi
    .fn()
    .mockResolvedValue({ kind: 'skipped', reason: 'no-events' }),
}));

import { runResumeRecapGenerate } from '@/lib/life/runResumeRecapGenerate';
import { useResumeRecapOnExit } from './useResumeRecapOnExit';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

const runMock = runResumeRecapGenerate as unknown as ReturnType<typeof vi.fn>;

const world: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  rollingSummary: '',
};

const beat = (id: string): LifeEvent => ({
  id,
  kind: 'beat',
  payload: { speaker: 'npc', practiceText: `line-${id}` },
});

beforeEach(() => {
  runMock.mockClear();
});

describe('useResumeRecapOnExit — LIFE-FLOW-5', () => {
  it('LIFE-FLOW-5 — does not fire while mounted', () => {
    renderHook(() =>
      useResumeRecapOnExit({
        uid: 'u1',
        world,
        events: [beat('e1')],
        worldId: 'w1',
      }),
    );
    expect(runMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — fires once on unmount with the LATEST snapshot', () => {
    const { rerender, unmount } = renderHook(
      (p: Parameters<typeof useResumeRecapOnExit>[0]) => useResumeRecapOnExit(p),
      {
        initialProps: {
          uid: 'u1',
          world,
          events: [beat('e1')],
          worldId: 'w1',
        },
      },
    );
    rerender({ uid: 'u1', world, events: [beat('e1'), beat('e2')], worldId: 'w1' });
    unmount();
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock).toHaveBeenCalledWith({
      uid: 'u1',
      world,
      events: [beat('e1'), beat('e2')],
    });
  });

  it('LIFE-FLOW-5 — does not fire when the world never loaded', () => {
    const { unmount } = renderHook(() =>
      useResumeRecapOnExit({ uid: 'u1', world: null, events: [], worldId: 'w1' }),
    );
    unmount();
    expect(runMock).not.toHaveBeenCalled();
  });

  it('LIFE-FLOW-5 — does not fire when the loaded world does not match the exited worldId', () => {
    const { unmount } = renderHook(() =>
      useResumeRecapOnExit({
        uid: 'u1',
        world,
        events: [beat('e1')],
        worldId: 'other-world',
      }),
    );
    unmount();
    expect(runMock).not.toHaveBeenCalled();
  });
});
```

### T5 — EXTEND `src/lib/life/resumeBubbles.test.ts`

**T5a** — ANCHOR (verify unique):

```ts
import { resumeBubblesFromEvents } from './resumeBubbles';
```

Replace with:

```ts
import { buildResumeSeed, resumeBubblesFromEvents } from './resumeBubbles';
import type { MessageKey } from '@/i18n';
```

**T5b** — ANCHOR (verify unique — the closing of the last existing test + describe):

```ts
    expect(b?.npcId).toBe('sophie-friend');
  });
});
```

Replace with:

```ts
    expect(b?.npcId).toBe('sophie-friend');
  });

  it('LIFE-FLOW-5 — count=3 returns the last 3 beat events', () => {
    const events: LifeEvent[] = [
      beat('narrator', 'first'),
      beat('npc', 'second'),
      beat('narrator', 'third'),
      beat('user', 'fourth'),
    ];
    const out = resumeBubblesFromEvents(events, 3);
    expect(out).toHaveLength(3);
    expect(out[0]?.practiceText).toBe('second');
    expect(out[2]?.practiceText).toBe('fourth');
  });
});

describe('buildResumeSeed — LIFE-FLOW-2', () => {
  const t = (key: MessageKey) => `t:${key}`;

  it('LIFE-FLOW-2 — seeds the last-2 beat bubbles + the __resume__ chip', () => {
    const events: LifeEvent[] = [
      beat('narrator', 'first'),
      beat('npc', 'second'),
      beat('user', 'third'),
    ];
    const seed = buildResumeSeed(events, t);
    expect(seed.bubbles).toHaveLength(2);
    expect(seed.bubbles[0]?.practiceText).toBe('second');
    expect(seed.bubbles[1]?.practiceText).toBe('third');
    expect(seed.choices).toHaveLength(1);
    expect(seed.choices[0]).toEqual({
      id: '__resume__',
      practiceText: 't:life.resume.continue.practice',
      nativeText: 't:life.resume.continue.native',
      emoji: '▶️',
    });
  });

  it('LIFE-FLOW-2 — falls back to the narrator prompt bubble when no beats exist', () => {
    const seed = buildResumeSeed(
      [{ id: 'd', kind: 'decision', payload: {} }],
      t,
    );
    expect(seed.bubbles).toHaveLength(1);
    expect(seed.bubbles[0]).toMatchObject({
      id: 'resume',
      speaker: 'narrator',
      practiceText: 't:life.resume.prompt.practice',
      nativeText: 't:life.resume.prompt.native',
    });
  });
});
```

### T6 — E2E

The E2E additions are edits E10–E13 above (they are the tests). Tier: `test:e2e:standard` runs `--grep-invert @full`, so untagged tests already run in the `@standard` lane — leave the two new test titles untagged exactly as written (post-Phase-A the file also contains one `@standard`-titled test; both forms run in the same lane); do NOT add `@critical` (this surface is not in the emulator gate) and do NOT add `@full` (it would drop them from the PR lane). Both new tests assert POST-CONDITIONS: (1) the recap overlay renders the seeded stored data and gates the `__resume__` chip until Continue; (2) after in-app exit, the world doc in Firestore carries the generated `resumeRecap` with a re-anchored real `lastEventId` — verified via the admin SDK, not the UI.

## Verify

Run from `/Users/jamesarney/wurld`, in this order; all must pass:

```bash
# 1. Phase-scoped unit + component tests
npx vitest run src/lib/life/runResumeRecapGenerate.test.ts src/lib/life/prompts/resumeRecap.test.ts src/lib/life/resumeBubbles.test.ts src/screens/LifeScreen/WurldResumeScreen.test.tsx src/screens/LifeScreen/useResumeRecapOnExit.test.tsx

# 2. Full unit suite
npm test

# 3. Types (both packages)
npm run typecheck

# 4. Lint every touched source file (max-lines on LifeScreen.tsx must stay green)
npx eslint src/types/firestore.ts src/lib/life/resumeBubbles.ts src/lib/life/prompts/resumeRecap.ts src/lib/life/runResumeRecapGenerate.ts src/screens/LifeScreen/WurldResumeScreen.tsx src/screens/LifeScreen/useResumeRecapOnExit.ts src/screens/LifeScreen/LifeScreen.tsx src/i18n/locales/en.ts

# 5. E2E (chromium; needs network + the repo's .env — the config auto-spawns Vite on :5187.
#    NOTE: the spec's world-creation test uses REAL Gemini for saga/arc gen — expect ~1-2 min.)
cd tests/e2e && npx playwright test specs/life-flow.spec.ts --project=chromium
```

After step 5, open and visually inspect the captured screenshots for the two new beats (`resume-recap`, `resume-prompt`) under the run's screenshot directory — check overlay legibility in both sections, no clipped text, mini-bubble alignment (narrator centered / npc left with name label / user right).

## Out of scope — do NOT touch

- **Other locales** (`src/i18n/locales/*` except `en.ts`) — regen is a separate user-triggered step.
- **`docs/specs/README.md`** — no new invariant prefix; the `LIFE-*` row already covers FLOW.
- **Phase A/B/D/E/F/G surfaces**: `WorldCard.tsx`, `useWorldThumbnail.ts`, `viewMode`, `LifeScreenHeader.tsx`, `ActionBar.tsx`, `DialogueArea.tsx`, `stepSchema.ts`, `runLifeStep.ts`, `prompts/step.ts`, `runGradedQuestionGenerate.ts`, `prompts/gradedQuestion.ts` — all owned by other phases.
- **`WorldIntroScreen.tsx`** — read-only pattern source; the fresh-world flow is unchanged (the only intro-related edit in this phase is the E2E Begin click, E13a).
- **`runCompaction.ts` / `compactionPrompts.ts` / `modelConfig.ts` / `world.ts` / `engagement.ts` / `gemini.ts`** — read-only pattern sources. Do NOT extract the duplicated `stripFences`/`safeParseJson` helpers into a shared module — the duplication is deliberate: `src/lib/life/` already carries NINE private copies (runCompaction, runLifeStep, runGradedQuestionGenerate, runCampaignGenerate, runCampaignReplan, runWorldSagaGenerate, runWorldArcGenerate, generateScene, generateNpcAvatar) and N2 knowingly adds a tenth rather than minting a new shared surface mid-phase. Surface it in your report if you disagree; don't do it here.
- **`functions/`** — the `geminiGenerate` backend treats `category` as a free string; `life_resume_recap` needs no backend change.
- **No recap-quiz, no TTS on the recap screen, no recap on the overview card** — backlog items.
- Known pre-existing oddity you will see but must NOT fix here: `wipeLifeData` in `life-flow.spec.ts` still wipes the LEGACY collections (`lifeWorld`, `lifeEvents`, …) rather than `lifeWorlds/*` — harmless because `cleanupTestUsers` deletes the whole user in `afterAll`. Mention it in your report; leave the code alone.
