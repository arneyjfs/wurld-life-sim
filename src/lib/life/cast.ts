/**
 * Cast ingest + delta merge. The code half of the two-tier cast contract.
 *
 * Spec: docs/specs/story-architecture.md §3 (LIFE-CAST-*), §2 (LIFE-ARCH-2.1).
 *
 * The first headless playthrough found three things a prompt cannot fix:
 *
 *  1. `nextMove` came back EMPTY on 5 of 6 principals. Gemini's `responseSchema`
 *     has no conditional-required, so a field that only some rows need cannot be
 *     marked required — and a field that is not required gets dropped. The fix is
 *     in `sagaOpen`'s schema (two arrays, each with its own `required`), and this
 *     module is what makes the result safe to merge back into one list.
 *  2. REGULARS came back carrying `wants` and `wrongAbout`. The whole point of
 *     the two tiers is that most people are just living; a regular with an
 *     ambition is the "everyone wants something" failure the tier split exists to
 *     prevent. Stripped here, not asked-for there.
 *  3. `situation` came back as the literal STRING "null" — the model's way of
 *     saying "unchanged" through a STRING-typed field. `if (s)` accepts that and
 *     the world's situation becomes the word null. `cleanText` is the guard, and
 *     every optional model-authored string goes through it.
 *
 * The recurring lesson applies as ever: prevent structurally, do not check for.
 */
import { voiceForSpeaker } from '@/lib/ttsVoices';
import { lifeDebug } from '@/lib/life/debugLog';
import {
  MAX_PRINCIPALS,
  capPrincipals,
} from './fronts';
import type { CastMember, CastTier } from '@/types/lifeState';

/** Strings a model emits when it means "nothing here". A STRING-typed optional
 *  field cannot carry JSON null, so it carries these instead. */
const EMPTY_TOKENS = new Set([
  '',
  '-',
  '--',
  '—',
  'n/a',
  'na',
  'none',
  'null',
  'nil',
  'undefined',
  'unchanged',
  'no change',
  'not applicable',
]);

/** Normalise a model-authored optional string to `string | null`. */
export function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (EMPTY_TOKENS.has(t.toLowerCase().replace(/[.]+$/, ''))) return null;
  return t;
}

/** Same, but for a field with a required default (e.g. `known`, `voice`). */
export function cleanTextOr(v: unknown, fallback: string): string {
  return cleanText(v) ?? fallback;
}

export function clampStanding(v: unknown): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : 0;
  return Math.max(-3, Math.min(3, n));
}

/**
 * LIFE-CAST-3.1 — how far a standing may move in ONE scene close.
 *
 * The first playthrough ran Claudette 0 → -1 → -2 → -3 and Marc 0 → 1 → 2 → 3
 * in five scenes each, after which both sat pinned at the rail and the axis
 * stopped carrying information. Nobody's opinion of you moves two points in one
 * conversation, and a six-point scale spent inside six scenes is not a
 * relationship — it is a slider being dragged. Rate-limiting is a quantity, so
 * it lives in code; the prompt only says what the rails MEAN.
 */
export const STANDING_STEP_MAX = 1;

/**
 * LIFE-CAST-3.2 — how far from neutral anyone may stand at world open.
 *
 * The second playthrough opened a world with a principal already at +3 — the
 * top of the scale, before the player had said a word to her — and she stayed
 * there for all six scenes. A saga that begins with a relationship already
 * finished has nothing to spend. Standing is what the player EARNS; at open
 * it may only hint.
 */
export const STANDING_OPENING_MAX = 1;

export function stepStanding(from: number, to: unknown): number {
  const target = clampStanding(to);
  const delta = Math.max(-STANDING_STEP_MAX, Math.min(STANDING_STEP_MAX, target - from));
  return clampStanding(from + delta);
}

export type RawCastRow = Partial<CastMember> & { id?: string; name?: string };

/**
 * Coerce one model row into a valid `CastMember` of the given tier, dropping
 * every field that does not belong to that tier.
 *
 * A principal keeps wants/nextMove/limit/wrongAbout and loses routine.
 * A regular keeps routine and loses all four — this is the load-bearing half.
 */
export function normaliseMember(raw: RawCastRow, tier: CastTier): CastMember | null {
  const id = cleanText(raw.id);
  const name = cleanText(raw.name);
  if (!id || !name) return null;

  const base = {
    id,
    name,
    known: cleanTextOr(raw.known, ''),
    voice: cleanTextOr(raw.voice, ''),
    // TTS-VOICE-2. This function rebuilds a member FIELD BY FIELD rather than
    // spreading, which is deliberate (a regular must LOSE `wants`) and is also
    // exactly how a newly-added field disappears: `applyCastChanges` runs on
    // every sceneClose, so a gender not carried here would survive one scene
    // and then be gone for the rest of the wurld. Spread-when-present, so an
    // absent gender stays absent rather than becoming `undefined`-the-value.
    ...(raw.gender ? { gender: raw.gender } : {}),
    ...(raw.voiceRegister ? { voiceRegister: raw.voiceRegister } : {}),
    standing: clampStanding(raw.standing),
    ties: (raw.ties ?? [])
      .map((t) => ({ id: cleanText(t?.id) ?? '', how: cleanText(t?.how) ?? '' }))
      .filter((t) => t.id && t.how),
  };

  // LIFE-CAST-6 — SPREAD-WHEN-PRESENT, exactly as `gender` / `voiceRegister`
  // above, and for a harder reason than tidiness: `x: cleanText(...) ?? undefined`
  // creates an EXPLICIT key holding `undefined`, and the Firestore SDK rejects
  // that value outright rather than ignoring it. A principal whose saga omitted
  // `limit` therefore threw the WHOLE world write, leaving the player on
  // "Building your wurld…" with nothing to retry.
  if (tier === 'principal') {
    const wants = cleanText(raw.wants);
    const nextMove = cleanText(raw.nextMove);
    const limit = cleanText(raw.limit);
    const wrongAbout = normaliseWrongAbout(raw.wrongAbout);
    return {
      ...base,
      tier: 'principal',
      ...(wants ? { wants } : {}),
      ...(nextMove ? { nextMove } : {}),
      ...(limit ? { limit } : {}),
      ...(wrongAbout ? { wrongAbout } : {}),
    };
  }
  const routine = cleanText(raw.routine);
  return { ...base, tier: 'regular', ...(routine ? { routine } : {}) };
}

function normaliseWrongAbout(v: unknown): CastMember['wrongAbout'] {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as { aboutId?: unknown; believes?: unknown };
  const aboutId = cleanText(o.aboutId);
  const believes = cleanText(o.believes);
  if (!aboutId || !believes) return undefined;
  return { aboutId, believes };
}

/**
 * Ingest a `sagaOpen` response into one cast list.
 *
 * `wrongAbout` is dropped when `aboutId` does not name someone in the cast.
 * LIFE-CAST-2's irony gate needs the player to be able to SEE the gap, and the
 * only thing guaranteed to be in canon at world open is the cast — the first
 * playthrough emitted beliefs about `la-boulangerie` and `scriptorium`, neither
 * of which was a canon id, so that irony could never surface.
 */
/**
 * LIFE-CAST-5 — nobody in the cast may share the player's name.
 *
 * The first playthrough opened a world for a player called Ines and put a
 * principal called Ines in it. Every turn after that rendered speech bubbles
 * attributed to "Ines" — the player watching themselves talk — and the scene
 * planner could not tell which one a `who` entry meant. Dropping the collision
 * is right rather than renaming it: a cast is 5-8 people and losing one costs
 * nothing, where an auto-renamed "Ines B." is a permanent tell.
 */
export function dropPlayerNameCollisions(
  cast: readonly CastMember[],
  playerName: string,
): { cast: CastMember[]; dropped: string[] } {
  const player = playerName.trim().toLowerCase();
  if (!player) return { cast: [...cast], dropped: [] };
  const dropped = cast.filter((c) => c.name.trim().toLowerCase() === player).map((c) => c.name);
  if (dropped.length === 0) return { cast: [...cast], dropped };

  const droppedIds = new Set(
    cast.filter((c) => c.name.trim().toLowerCase() === player).map((c) => c.id),
  );
  const kept = cast
    .filter((c) => !droppedIds.has(c.id))
    .map((c) => {
      const next = { ...c, ties: c.ties.filter((t) => !droppedIds.has(t.id)) };
      // LIFE-CAST-6: DELETE, never assign `undefined` — an explicit undefined
      // key is what the Firestore SDK rejects, so clearing a dangling belief
      // this way would break the very write that clearing it exists to allow.
      if (next.wrongAbout && droppedIds.has(next.wrongAbout.aboutId)) delete next.wrongAbout;
      return next;
    });
  return { cast: kept, dropped };
}

export function ingestCast(input: {
  principals?: RawCastRow[];
  regulars?: RawCastRow[];
}): CastMember[] {
  const principals = (input.principals ?? [])
    .map((r) => normaliseMember(r, 'principal'))
    .filter((c): c is CastMember => c !== null);
  const regulars = (input.regulars ?? [])
    .map((r) => normaliseMember(r, 'regular'))
    .filter((c): c is CastMember => c !== null);

  const seen = new Set<string>();
  const merged: CastMember[] = [];
  for (const c of [...principals, ...regulars]) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    merged.push(c);
  }

  const ids = new Set(merged.map((c) => c.id));
  for (const c of merged) {
    // LIFE-CAST-6: delete, not `= undefined` — see normaliseMember.
    if (c.wrongAbout && !ids.has(c.wrongAbout.aboutId)) delete c.wrongAbout;
    // LIFE-CAST-3.2 — nobody arrives at the rail.
    c.standing = Math.max(-STANDING_OPENING_MAX, Math.min(STANDING_OPENING_MAX, c.standing));
  }
  return retier(merged);
}

/** `capPrincipals` demotes the surplus but leaves their principal fields in
 *  place; re-normalising at the new tier is what actually strips them. */
function retier(cast: CastMember[]): CastMember[] {
  return capPrincipals(cast)
    .map((c) => normaliseMember(c, c.tier))
    .filter((c): c is CastMember => c !== null);
}

/** Principals missing the fields that make them principals. Reported by the
 *  harness rather than silently repaired — a principal with no `nextMove` is a
 *  world that does not move without the player, and that is worth seeing. */
export function principalsMissingDrive(cast: CastMember[]): string[] {
  return cast
    .filter((c) => c.tier === 'principal' && (!c.wants || !c.nextMove))
    .map((c) => `${c.id}(${!c.wants ? 'wants' : ''}${!c.wants && !c.nextMove ? '+' : ''}${!c.nextMove ? 'nextMove' : ''})`);
}

/** Card role rows are one line; anything longer is prompt material. Mirrors
 *  `MAX_RELATIONSHIP_CHARS` in `npcRole.ts`, which is where this gets used. */
const ROLE_LABEL_CHARS = 48;

/**
 * The cast in the shape `resolveNpcRole` wants (LIFE-NPC-6).
 *
 * Replaces the saga's `keyArchetypes`, which is where "who is this person,
 * authoritatively" used to come from for avatar + profile generation. That
 * field was part of the book-level synopsis and died with it — but the NEED
 * did not: without it every recurring NPC's avatar prompt loses its role line,
 * which was the original reported bug ("Madame Roux, a florist who…").
 *
 * The cast is a strictly better source than the synopsis ever was: it is the
 * ACTUAL recurring cast rather than a prediction of it, and `known` is what the
 * player has witnessed rather than what someone planned.
 */
export function castArchetypes(
  cast: readonly CastMember[] | undefined,
): { role: string; description: string }[] {
  return (cast ?? [])
    .filter((c) => c.name.trim() && c.known.trim())
    .map((c) => ({
      role: shortRoleLabel(c.known),
      // The name must appear here — `resolveNpcRole` matches an NPC to its row
      // by looking for the name inside `description` or `role`.
      description: `${c.name.trim()}, ${c.known.trim()}`,
    }));
}

/**
 * A card-sized label, or nothing.
 *
 * Deliberately NOT a truncation: "a florist who delivers coded scripts and
 * sharp" is worse on a card than an empty role row, because it reads as a bug
 * rather than as an absence. A `known` that does not fit is prompt material
 * only — it still reaches the profile + avatar prompts through `description`.
 */
function shortRoleLabel(known: string): string {
  const s = known.trim().replace(/\s+/g, ' ');
  return s.length <= ROLE_LABEL_CHARS ? s : '';
}

export type CastChange = { id: string } & Partial<
  Pick<CastMember, 'standing' | 'wants' | 'nextMove' | 'limit' | 'routine' | 'voice' | 'tier' | 'wrongAbout'>
>;

/**
 * Merge `sceneClose`'s cast deltas. Three guarantees, all structural:
 *
 *  - `id`, `name` and `known` survive untouched — witnessed truth (LIFE-ARCH-2.1).
 *    They are absent from the response schema too; this is the second lock.
 *  - a TIER FLIP strips the other tier's fields, so a demoted principal stops
 *    carrying an ambition and a promoted regular stops carrying a routine.
 *  - `wrongAbout` pointing at nobody is dropped, as at ingest.
 */
export function applyCastChanges(cast: CastMember[], changes: CastChange[]): CastMember[] {
  const ids = new Set(cast.map((c) => c.id));
  const next = cast.map((c) => ({ ...c }));

  for (const ch of changes) {
    const i = next.findIndex((c) => c.id === ch.id);
    if (i < 0) continue;
    const cur = next[i]!;
    const tier: CastTier = ch.tier === 'principal' || ch.tier === 'regular' ? ch.tier : cur.tier;

    const merged: RawCastRow = {
      ...cur,
      // Only overwrite with values that actually say something — "null" and ""
      // must not blank a field the model simply chose not to restate.
      voice: cleanText(ch.voice) ?? cur.voice,
      standing: ch.standing === undefined ? cur.standing : stepStanding(cur.standing, ch.standing),
      wants: cleanText(ch.wants) ?? cur.wants,
      nextMove: cleanText(ch.nextMove) ?? cur.nextMove,
      limit: cleanText(ch.limit) ?? cur.limit,
      routine: cleanText(ch.routine) ?? cur.routine,
      wrongAbout: ch.wrongAbout === undefined ? cur.wrongAbout : normaliseWrongAbout(ch.wrongAbout),
    };

    const rebuilt = normaliseMember(merged, tier);
    if (!rebuilt) continue;
    // Canon: name and known are never re-emittable, so carry them across.
    // TTS-VOICE-2 puts gender + register in the same bucket. A person's gender
    // is not scene-to-scene state, and letting a close rewrite it would change
    // a character's VOICE mid-wurld — the one thing the per-speaker pick is
    // supposed to hold still.
    next[i] = {
      ...rebuilt,
      name: cur.name,
      known: cur.known,
      ...(cur.gender ? { gender: cur.gender } : {}),
      ...(cur.voiceRegister ? { voiceRegister: cur.voiceRegister } : {}),
    };
  }

  for (const c of next) {
    // LIFE-CAST-6: delete, not `= undefined` — see normaliseMember.
    if (c.wrongAbout && !ids.has(c.wrongAbout.aboutId)) delete c.wrongAbout;
  }
  return retier(next);
}

export { MAX_PRINCIPALS };

/**
 * TTS-VOICE-9 — every cast member's voice, keyed by npcId.
 *
 * `voiceForSpeaker` answers the question for ONE speaker, which is what
 * `TTS-VOICE-6` needed: a comprehension names its `npcId` and the exercise card
 * speaks that one line. The dialogue area asks a wider question — two different
 * NPCs can be on screen at once, and any bubble can be tapped — so it takes the
 * whole cast at once.
 *
 * Lives here rather than in `LifeScreen` so it is testable without mounting a
 * screen that wants Firestore. That matters more than usual: the defect being
 * fixed is precisely a value that was computed correctly and reached only one
 * of its two consumers.
 *
 * Members with no usable gender are OMITTED, not mapped to `''`. Both reach
 * `TTSButton` identically (no override ⇒ the player's `voicePreference`,
 * `TTS-PREF-1`), and leaving them out keeps the map honest about who has
 * actually been cast — every world created before `TTS-VOICE-5` has none.
 * `other` is a real answer with no third pool to send it to, so it falls back
 * with the rest rather than being coerced into one of the two.
 */
export function castVoiceMap(
  world: { id?: string | null; cast?: CastMember[] } | null | undefined,
): ReadonlyMap<string, string> {
  const m = new Map<string, string>();
  const worldId = world?.id;
  if (!worldId) return m;
  /** TTS-VOICE-10: who was cast as what, and who was NOT cast at all. */
  const trace: Array<{ id: string; gender: string; register: string; voice: string }> = [];
  for (const c of world.cast ?? []) {
    const gender = c.gender === 'male' || c.gender === 'female' ? c.gender : null;
    if (!gender || !c.id) {
      if (c.id) {
        trace.push({
          id: c.id,
          gender: String(c.gender ?? 'MISSING'),
          register: String(c.voiceRegister ?? '-'),
          voice: '(player default)',
        });
      }
      continue;
    }
    const voice = voiceForSpeaker({
      worldId,
      speakerId: c.id,
      gender,
      register: c.voiceRegister ?? null,
    });
    if (voice) m.set(c.id, voice);
    trace.push({ id: c.id, gender, register: String(c.voiceRegister ?? '-'), voice });
  }
  // TTS-VOICE-10 — reported 2026-08-08: *"Madame leclaire speaks with a male
  // voice, but I don't have the necessary logs to see if the model assigned the
  // wrong gender, or if one of the voices is assigned female but sounds male."*
  // Three candidate causes and nothing on screen separated them: the model
  // wrote the wrong `gender`, the cast row lost it (leaving the PLAYER's own
  // voicePreference, which is male for this owner and would make EVERY uncast
  // NPC sound male), or the voice pool mislabels a name. This line answers the
  // first two outright and narrows the third to a specific voice to listen to.
  if (trace.length) lifeDebug('SAGA', 'cast voices', { cast: trace });
  return m;
}
