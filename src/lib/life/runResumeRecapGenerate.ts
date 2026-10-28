/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): one fire-and-forget resume-recap
 * pass, copied from the runCompaction.ts pattern.
 *
 *   1. Self-gate: skip unless ≥ RESUME_RECAP_MIN_NEW_EVENTS events
 *      landed since world.resumeRecap.lastEventId (no recap yet, or
 *      an out-of-window anchor id, counts as stale ⇒ fire).
 *   2. Build the promptSpec — DATA, no prose. The SI and the user
 *      prompt are built by the SERVER from
 *      `functions/src/prompts/lifeResumeRecap.ts` (SRV-PROMPT-8..13
 *      batch 3); the client prompt module is deleted (SRV-PROMPT-3).
 *   3. Single Gemini call (LIFE_PRIMARY_MODEL, thinkingLevel 'minimal',
 *      JSON output, category 'life_resume_recap'). DEFAULT
 *      temperature on purpose — faithfulness beats variety, the same
 *      stance compaction takes (deliberately NOT LIFE_TEMPERATURE).
 *   4. Validate against ZResumeRecapResponse, then persist
 *      world.resumeRecap = { text, lastEventId, generatedAt } via
 *      updateLifeWorld. LIFE-LANG-8: a "Previously on…" recap is
 *      NARRATION register, so `text` is a SINGLE system-language
 *      paragraph (the effective system language = `world.systemLanguage
 *      ?? world.nativeLanguage`), NOT bilingual. The screen renders it
 *      verbatim (whitespace-pre-line).
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
import { LIFE_PRIMARY_MODEL } from './modelConfig';
import { updateLifeWorld } from './world';
import type { LifeResumeRecapPromptSpec } from '../practicePromptSpec';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

/** Exit fires the generator only when at least this many events
 *  landed since the last recap (LIFE-FLOW-5). */
export const RESUME_RECAP_MIN_NEW_EVENTS = 5;

// LIFE-LANG-8: single-channel, system-language recap — one `text`
// field, not a practice/native pair. The previous bilingual
// `{ practiceText, nativeText }` shape was retired when the recap
// moved to narration register (system language only).
export const ZResumeRecapResponse = z.object({
  text: z.string().trim().min(1).max(1200),
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

/**
 * SRV-PROMPT-8..13 batch 3 — the fields the prompt reads, as DATA.
 *
 * NOT the `LifeWorld`. Six fields, and the ones this prompt has never read
 * (canon, goals, fronts, cast, saga) do not travel.
 *
 * Three things deliberately stay on the SERVER and are visible here by their
 * ABSENCE, because each decides what the model is shown:
 *   - the `<chapter>` register pick (`playerTeaser || premise`) — both stored
 *     strings go up and the prompt chooses (LIFE-WORLD-ARC-REGISTER);
 *   - the `<storySoFar>` / `<priorSummary>` branch — raw lines and the raw
 *     legacy summary go up, the prompt picks and trims (LIFE-MEM-2);
 *   - the event KIND filter and the 10-row cap — the whole listener window goes
 *     up and the prompt decides what renders.
 *
 * `systemLanguage` is the one thing resolved HERE, because it is one rule with
 * one answer (LIFE-LANG-8) and it used to be applied twice.
 */
function resumeRecapSpec(
  world: LifeWorld,
  events: ReadonlyArray<LifeEvent>,
): LifeResumeRecapPromptSpec {
  const arc = world.currentArc;
  return {
    kind: 'life_resume_recap',
    characterName: world.characterName,
    practiceLanguage: world.practiceLanguage,
    // LIFE-LANG-8: legacy worlds (no systemLanguage) fall back to native.
    systemLanguage: world.systemLanguage ?? world.nativeLanguage,
    ...(arc
      ? {
          chapter: {
            chapterNumber: arc.chapterNumber,
            premise: arc.premise,
            ...(arc.playerTeaser !== undefined ? { playerTeaser: arc.playerTeaser } : {}),
          },
        }
      : {}),
    storyLines: [...(world.storyLog?.entries ?? [])],
    // Narrowed to the four payload strings the prompt reads. Everything else a
    // beat carries — word translations, node ids, audio keys — is wire weight
    // for a prompt that has never read it.
    events: events.map((e) => {
      const p = (e.payload ?? {}) as Record<string, unknown>;
      return {
        kind: e.kind,
        ...(typeof p.speaker === 'string' ? { speaker: p.speaker } : {}),
        ...(typeof p.speakerName === 'string' ? { speakerName: p.speakerName } : {}),
        ...(typeof p.practiceText === 'string' ? { practiceText: p.practiceText } : {}),
        ...(typeof p.text === 'string' ? { text: p.text } : {}),
      };
    }),
  };
}

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
      // SRV-PROMPT-8..13 batch 3 — NO prompt text, NO `systemInstruction` and
      // NO `responseSchema`. All three are built in
      // `functions/src/prompts/lifeResumeRecap.ts` and resolved by
      // `resolveServerPrompt` from the spec below. sending NO `prompt` is load-bearing:
      // the endpoint's "Missing prompt" guard is SKIPPED only when the resolver
      // returns `built`, so a resolver that stopped recognising this kind would
      // 400 every recap in production with the unit suite still green.
      promptSpec: resumeRecapSpec(world, events),
      model: LIFE_PRIMARY_MODEL,
      // 'low': 2-3 faithful sentences from a small input — cheaper
      // than compaction's 'medium', which folds a far larger window.
      // Measured 2026-07 (thinking_ab.py recap): 3/3 both levels, 'low' cost
      // 114 thinking tokens — 2x the price and 3.2x the latency of a call the
      // player waits on at resume.
      thinkingLevel: 'minimal',
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

  const text = result.data.text;
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
