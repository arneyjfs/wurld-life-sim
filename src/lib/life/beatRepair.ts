/**
 * LIFE-BEAT-REPAIR: the ONE place a model-authored beat is normalised before
 * it reaches any consumer.
 *
 * Review finding (2026-07): the attribution repair and the mute→narrator
 * conversion lived only inside `commitNode`, which writes Firestore. But the
 * bubble the player SEES is fed by `beatsToBubbles(node.beats) → appendBubbles`
 * and the in-memory overlay by `beats.map(beatToPayload)` — both the RAW,
 * unrepaired model output. So the safeguard healed the persisted event and the
 * next turn's context, but NOT the on-screen bubble: the player saw the defect
 * all session, and only a reload fixed it. Worse, the overlay then diverged
 * from Firestore (raw text locally, repaired text persisted), which can defeat
 * the dedup fingerprint and double-render the beat.
 *
 * The fix is architectural, not another check: normalise a beat ONCE, at the
 * boundary where beats enter the client (`arriveAtNode`), so the bubble, the
 * overlay, and the persisted event all carry the identical shape. `commitNode`
 * still normalises (idempotent) as a safety net for its other caller
 * (practice resolution).
 *
 * Every transformation here is deterministic and free (no model round-trip):
 *   1. strip a quote-and-attribution wrapper off a spoken line, and
 *      re-attribute to the player when the attribution is the player's
 *      (`LIFE-CONTRACT-BUBBLE-4`);
 *   2. convert a mute entity's `npc` beat to `narrator` (`LIFE-CANON-3`);
 *   3. correct a drifted speaker name from the roster, and re-bind a
 *      re-slugged npcId to the established character (`LIFE-CANON-4`).
 */
import type { LifeBeatPayload, LifeNpc, LifeWorld } from '@/types/firestore';
import * as log from '../log';
import { canonSlug, muteEntityIds, resolveCanon } from './canon';
import type { StepIntroduction } from './stepSchema';
import { attributionSpeaker, stripAttributionWrapper } from './utterance';

export type BeatRepairContext = {
  playerName: string;
  /** npcId → canonical roster name. */
  rosterNames: Map<string, string>;
  /** lowercased roster name → npcId. */
  rosterIdsByName: Map<string, string>;
  /** canon ids that cannot speak (their `npc` beats become narration). */
  muteIds: Set<string>;
  /** LIFE-SPEECH-6: a line the player has ALREADY said, which is already on
   *  screen as their own bubble. A beat that merely restages it is dropped. */
  alreadySpoken?: string | null;
};

/** Assemble the lookup tables a repair needs. `introduces` folds THIS turn's
 *  declarations into the mute set, so an entity introduced AND (mis-)spoken in
 *  the same turn is still converted — the stored canon doesn't have it yet. */
export function buildBeatRepairContext(
  world: LifeWorld,
  npcs: ReadonlyArray<LifeNpc> = [],
  introduces: ReadonlyArray<StepIntroduction> = [],
): BeatRepairContext {
  const muteIds = muteEntityIds(resolveCanon(world, npcs));
  for (const intro of introduces) {
    // The model almost never emits an explicit `intro.id`, so keying on it made
    // the same-turn fold inert (2nd-pass audit). Derive the slug the same way
    // applyIntroductions does, so a mute entity introduced AND (mis-)spoken in
    // the SAME turn is still converted to narration.
    if (intro.canSpeak === false) {
      muteIds.add(intro.id?.trim() || canonSlug(intro.kind, intro.name));
    }
  }
  return {
    playerName: world.characterName,
    rosterNames: new Map(npcs.map((n) => [n.id, n.name] as const)),
    rosterIdsByName: new Map(npcs.map((n) => [n.name.trim().toLowerCase(), n.id] as const)),
    muteIds,
  };
}

/** Normalise one beat. Idempotent: a repaired beat passes through unchanged. */
export function normalizeBeat(raw: LifeBeatPayload, ctx: BeatRepairContext): LifeBeatPayload {
  let b = raw;

  // 1. LIFE-CONTRACT-BUBBLE-4 — a bubble holds the verbatim utterance only.
  if (b.speaker !== 'narrator' && b.practiceText) {
    const rep = stripAttributionWrapper(b.practiceText);
    if (rep.repaired) {
      const who = attributionSpeaker(rep.attribution, {
        playerName: ctx.playerName, speakerName: b.speakerName,
      });
      b = { ...b, practiceText: rep.text };
      // Re-attribute only on a decisive signal (name or subject person);
      // `unknown` keeps the model's choice — a wrong flip would move a genuine
      // NPC line into the player's own voice.
      if (who === 'player' && b.speaker === 'npc') {
        b = { ...b, speaker: 'user', speakerName: null, npcId: null };
      }
      if (b.nativeText) b = { ...b, nativeText: stripAttributionWrapper(b.nativeText).text };
      log.warn('life.beat.utterance-repaired', {
        attribution: rep.attribution.slice(0, 60), reattributedTo: who,
      });
    }
  }

  // 2. LIFE-CANON-3 — a mute entity's "line" is a described action → narrator.
  if (b.speaker === 'npc' && b.npcId && ctx.muteIds.has(b.npcId)) {
    log.warn('life.beat.mute-entity-narrated', { npcId: b.npcId });
    return { ...b, speaker: 'narrator' as const, speakerName: null, npcId: null };
  }

  if (b.speaker !== 'npc' || !b.npcId) return b;

  // 3. LIFE-CANON-4 — the roster is the authority on a character's name/id.
  const canonical = ctx.rosterNames.get(b.npcId);
  if (canonical) {
    if (canonical === b.speakerName) return b;
    log.warn('life.beat.speaker-name-corrected', {
      npcId: b.npcId, was: b.speakerName ?? null, now: canonical,
    });
    return { ...b, speakerName: canonical };
  }
  // Unknown id whose name is already on the roster → the model re-slugged an
  // existing character; re-bind rather than mint a divergent second row.
  const existingId = ctx.rosterIdsByName.get((b.speakerName ?? '').trim().toLowerCase());
  if (existingId && existingId !== b.npcId) {
    log.warn('life.beat.speaker-id-rebound', {
      name: b.speakerName ?? null, was: b.npcId, now: existingId,
    });
    return { ...b, npcId: existingId };
  }
  return b;
}

/**
 * LIFE-SPEECH-6 — the player's line, said once.
 *
 * REPORTED: *"when I get a question directed from ME saying something (e.g.
 * fill blank) it shows in the events as both me and the NPC saying the line,
 * one after the other."*
 *
 * `LIFE-SPEECH-2` diagnosed this exact failure for the `say`-PICK path — the
 * client puts the line on screen the instant the player picks, so a model not
 * told about it stages the speech itself and, barred from `user` beats by the
 * PLAYER-VOICE RULE, hands the player's words to an NPC. The fix there was an
 * `<alreadySpoken>` block in the prompt, and it was never applied to the
 * GRADED path: `buildLifeStepPrompt`'s `practiceOutcome` branch passes only
 * `<picked>` / `<correctAnswer>` / `<promptSource>`, so on a fill-blank — where
 * the player has just PRODUCED a whole line — the post-outcome turn has no idea
 * that line is already on screen.
 *
 * The prompt half is now fixed too, but a prompt rule is a request. This is the
 * guarantee: a beat whose text is the line the player just spoke is not a beat,
 * it is an echo, and it never reaches the transcript OR the bubbles — one seam,
 * because `normalizeBeats` already feeds both.
 *
 * MATCH ON NORMALISED EQUALITY, NOT CONTAINMENT. Dropping a real beat is worse
 * than showing a duplicate, so a longer line that happens to quote the player
 * ("…, dit-il en repensant à hier soir") is KEPT. Quotes, case, surrounding
 * whitespace and terminal punctuation are stripped first, because those are
 * exactly what a restaging varies.
 *
 * A `user` beat is never dropped — that IS the player's bubble.
 */
/** Exported for `LIFE-CONTRACT-EX-6`, which asks the same question ("is this
 *  line already accounted for?") of a different source and must not answer it
 *  differently. Two copies of a normaliser drift; this one is the original. */
export function spokenKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    // Quotation marks of every flavour the models reach for.
    .replace(/[«»""''"'`]/g, '')
    .replace(/\s+/g, ' ')
    // TRIM BEFORE stripping terminal punctuation: a guillemet-wrapped line
    // ("« … plaît. »") leaves a trailing space where the closing mark was, and
    // an anchored `$` will not see the full stop behind it.
    .trim()
    // WHITESPACE IS IN THE CLASS. Stripping punctuation only would stop at the
    // first space, so `« … consumer. »…` normalised to `… consumer.` while the
    // bare line normalised to `… consumer` — two keys for one sentence, and
    // the guard silently missed the echo. Found by the LIFE-CONTRACT-EX-6
    // tests; the defect was equally present here.
    .replace(/[\s.!?…,;:]+$/, '')
    .trim();
}

export function isEchoOfSpokenLine(
  beat: Pick<LifeBeatPayload, 'speaker' | 'practiceText'>,
  alreadySpoken: string | null | undefined,
): boolean {
  const said = alreadySpoken?.trim();
  if (!said) return false;
  if (beat.speaker === 'user') return false;
  const key = spokenKey(said);
  if (!key) return false;
  return spokenKey(beat.practiceText ?? '') === key;
}

export function normalizeBeats(
  beats: ReadonlyArray<LifeBeatPayload>,
  ctx: BeatRepairContext,
): LifeBeatPayload[] {
  const kept: LifeBeatPayload[] = [];
  for (const b of beats) {
    if (isEchoOfSpokenLine(b, ctx.alreadySpoken)) {
      log.warn('life.beat.echoed-player-line-dropped', {
        speaker: b.speaker, speakerName: b.speakerName ?? null,
      });
      continue;
    }
    kept.push(normalizeBeat(b, ctx));
  }
  return kept;
}
