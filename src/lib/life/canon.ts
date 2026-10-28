/**
 * LIFE-CANON-*: the established-entity ledger.
 *
 * The consistency failures this exists to kill are all one failure: the model
 * had no authoritative record of what the story had already established, so it
 * referenced people who had never appeared, offered actions on objects the
 * player did not own, and proposed talking to things that cannot talk. Those
 * rules USED to live only as prose in the step SI ("only name an NPC the player
 * has already been introduced to") with zero enforcement — the model was asked
 * to re-derive continuity by re-reading a 40-event window, every turn.
 *
 * The ledger replaces that with state:
 *   - It is APPEND-ONLY, so the rendered block is byte-stable and free in the
 *     prefix cache (LIFE-CTX-1). Entries are never reordered or removed.
 *   - Characters + places are DERIVED (NPC roster, backdrop moves) so they cost
 *     zero output tokens. Only objects/facts/non-standard characters need the
 *     model to declare them, via `introduces` on the step response.
 *   - Options carry `targetId` + `intent`, which turns "does this exist?" and
 *     "can you do that to it?" into exact, language-independent checks
 *     (`canonViolations`) rather than heuristics over prose.
 */
import type { LifeNpc, LifeWorld } from '@/types/firestore';
import type { CanonEntry, WorldCanon } from '@/types/lifeNarrative';
import type { StepIntroduction } from './stepSchema';

export const EMPTY_CANON: WorldCanon = {
  characters: [],
  places: [],
  objects: [],
  facts: [],
};

/** Stable slug for a model-declared entity. Deterministic so the same name
 *  declared twice lands on the same id and dedups instead of accreting. */
export function canonSlug(kind: string, name: string): string {
  const base = name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${kindPrefix(kind)}-${base || 'x'}`;
}

/** A distinct short prefix per kind. A plain `kind.slice(0,4)` collapsed
 *  'fact' and 'faction' to the same "fact" prefix, so a fact and a faction of
 *  the same name got the SAME id and one silently dropped in the dedup
 *  (review gap G3). */
function kindPrefix(kind: string): string {
  switch (kind) {
    case 'place': return 'plac';
    case 'object': return 'obje';
    case 'fact': return 'fact';
    case 'faction': return 'grp';
    default: return 'char'; // character / person / spirit / animal / …
  }
}

const byId = (entries: ReadonlyArray<CanonEntry>): Map<string, CanonEntry> =>
  new Map(entries.map((e) => [e.id, e]));

/** Append `next` to `list`, skipping ids already present. Append-only: an
 *  existing entry is NEVER rewritten, because rewriting one would shift every
 *  later byte and evict the cached prefix. */
function append(
  list: ReadonlyArray<CanonEntry>,
  next: ReadonlyArray<CanonEntry>,
): CanonEntry[] {
  const seen = new Set(list.map((e) => e.id));
  const out = [...list];
  for (const e of next) {
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    out.push(e);
  }
  return out;
}

/** The canon as the model should see it: the stored ledger, plus every NPC on
 *  the live roster (so a character is in the canon the moment they are
 *  promoted, with no extra write) and the current location. */
export function resolveCanon(
  world: Pick<LifeWorld, 'canon' | 'currentLocationLabel'>,
  npcs: ReadonlyArray<LifeNpc> = [],
): WorldCanon {
  const stored = world.canon ?? EMPTY_CANON;
  // id-sorted: the roster arrives in Firestore doc order, so appending it raw
  // would give the ledger a non-deterministic tail that reshuffles between
  // turns and evicts the cached prefix (LIFE-CTX-5).
  const fromRoster: CanonEntry[] = [...npcs]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((n) => ({
      id: n.id,
      name: n.name,
      kind: 'person',
      note: n.relationship ?? '',
    }));
  const here: CanonEntry[] = world.currentLocationLabel
    ? [{
        id: canonSlug('place', world.currentLocationLabel),
        name: world.currentLocationLabel,
        kind: 'place',
        note: '',
      }]
    : [];
  // Stored entries come FIRST so their (possibly richer, e.g. canSpeak:false)
  // records win the dedup over the derived ones.
  return {
    characters: append(stored.characters, fromRoster),
    places: append(stored.places, here),
    objects: stored.objects,
    facts: stored.facts,
  };
}

/** Fold this turn's declarations into the stored ledger. Returns null when
 *  nothing new landed, so the caller can skip the Firestore write entirely. */
export function applyIntroductions(
  canon: WorldCanon,
  introductions: ReadonlyArray<StepIntroduction>,
  chapterNumber?: number,
): WorldCanon | null {
  if (introductions.length === 0) return null;
  const buckets: Record<string, CanonEntry[]> = {
    characters: [], places: [], objects: [], facts: [],
  };
  for (const intro of introductions) {
    // A faction is a group entity — file it with facts (established world
    // truths), not characters (review gap G3: it used to land in characters
    // AND collide slugs with facts).
    const bucket =
      intro.kind === 'place' ? 'places'
        : intro.kind === 'object' ? 'objects'
          : intro.kind === 'fact' || intro.kind === 'faction' ? 'facts'
            : 'characters';
    buckets[bucket]!.push({
      id: intro.id?.trim() || canonSlug(intro.kind, intro.name),
      name: intro.name,
      kind: intro.kind === 'character' ? (intro.subKind ?? 'person') : intro.kind,
      note: intro.note ?? '',
      ...(intro.canSpeak === undefined ? {} : { canSpeak: intro.canSpeak }),
      ...(chapterNumber === undefined ? {} : { chapter: chapterNumber }),
    });
  }
  // Append FIRST, decide "did anything new land?" against the pre-cap lengths,
  // THEN cap. Checking growth after the cap was wrong: at the cap the length
  // stays constant while the content rolls, so a genuinely-new entry read as
  // "no change" and was silently dropped.
  const appended: WorldCanon = {
    characters: append(canon.characters, buckets.characters!),
    places: append(canon.places, buckets.places!),
    objects: append(canon.objects, buckets.objects!),
    facts: append(canon.facts, buckets.facts!),
  };
  const grew = (['characters', 'places', 'objects', 'facts'] as const).some(
    (k) => appended[k].length > canon[k].length,
  );
  return grew ? capCanon(appended) : null;
}

/** LIFE-CANON-5: the STORED canon rides the stable prefix of every prompt AND
 *  the world doc (1 MiB Firestore ceiling), so — like storyLog and bio — it is
 *  bounded. Only model-DECLARED entities are stored (characters/places derive
 *  from the roster + location at render time and are never persisted here,
 *  `LIFE-CANON-6`), so growth is objects + facts + non-roster characters. When
 *  a bucket overflows, keep the earliest founding entries and the most recent,
 *  dropping the superseded middle — the same head+tail scheme as `capStoryLog`. */
export const CANON_BUCKET_CAP = 48;
const CANON_BUCKET_HEAD = 8;

function capBucket(entries: CanonEntry[]): CanonEntry[] {
  if (entries.length <= CANON_BUCKET_CAP) return entries;
  return [
    ...entries.slice(0, CANON_BUCKET_HEAD),
    ...entries.slice(entries.length - (CANON_BUCKET_CAP - CANON_BUCKET_HEAD)),
  ];
}

export function capCanon(canon: WorldCanon): WorldCanon {
  return {
    characters: capBucket(canon.characters),
    places: capBucket(canon.places),
    objects: capBucket(canon.objects),
    facts: capBucket(canon.facts),
  };
}

/** Flat id → entry lookup across every bucket. */
export function canonIndex(canon: WorldCanon): Map<string, CanonEntry> {
  return byId([
    ...canon.characters, ...canon.places, ...canon.objects, ...canon.facts,
  ]);
}

/** Words too common to identify an entity by name. Matching "Marc" against the
 *  history is meaningful; matching "the" is not, and a one- or two-letter name
 *  would put every entity in the working set.
 *
 *  ⚠ SHARED WITH `canonWorkingSetIds`, which MOVED server-side below — this is
 *  the copy `canonDormancy` reads, and that function is planner input rather
 *  than prompt text, so it never migrates. The two are the same floor for the
 *  same reason, and being wrong in either direction costs a weaker suggestion
 *  rather than a broken contract, which is why this one is a comment and not a
 *  parity guard. */
const MIN_NAME_MATCH = 3;

/**
 * `renderCanon` and `canonWorkingSetIds` LIVED HERE and MOVED to
 * `functions/src/prompts/lifeStepBlocks.ts` with SRV-PROMPT-8..13 batch 8: the
 * first writes the `<canon>` block and the second decides which rows carry
 * their note (LIFE-CANON-5), so both are prompt text and `prompts/step.ts` was
 * their only consumer.
 *
 * `resolveCanon` STAYED, and it is the interesting half. It is what
 * `validateNodeResponse` checks the model's `targetId`s against, so it judges
 * the ANSWER; its RESULT travels in the spec (`stepSpec.ts`) rather than the
 * function crossing. Same call the goal ladder's `exposureReason` makes.
 */

export type CanonViolation = {
  code: string;
  detail: string;
  /** SRV-PROMPT-12 — the two values the sentence quotes, carried structurally
   *  so `generateStepOptions` can send the CODE and let the server write the
   *  words. `detail` stays because `canonViolations` has non-prompt readers. */
  optionId: string;
  targetId: string;
};

/** LIFE-CANON-2: an option whose `targetId` is not in the canon is offering
 *  the player an action on something the story has not established — the "Show
 *  the book to Marc before Marc exists" failure, caught exactly rather than by
 *  scanning prose for capital letters (which would misfire on every noun in
 *  German).
 *
 *  This is the ONLY canon rule that rejects a turn, and in practice it almost
 *  never fires (the model reliably targets real ids) — which is what a
 *  safeguard should be: silent when things are fine, catching the rare miss.
 *
 *  It deliberately does NOT reject "speak to a mute entity". Measuring that
 *  against real Gemini (tests/experiments/narrative-machinery/mute-spirit.mjs)
 *  showed the model already keeps such an entity mute — it responds by moving
 *  objects, not words — so rejecting the option only suppressed a legitimate
 *  player action and burned a retry on the majority of turns. The real defect
 *  was that the non-verbal response was tagged as SPEECH; that is handled at
 *  commit time by `muteEntityIds` + a narrator conversion, with no retry
 *  (LIFE-CANON-3). */
export function canonViolations(
  options: ReadonlyArray<{ id: string; targetId?: string | null }>,
  canon: WorldCanon,
  introducedThisTurn: ReadonlyArray<StepIntroduction> = [],
): CanonViolation[] {
  const index = canonIndex(canon);
  for (const intro of introducedThisTurn) {
    const id = intro.id?.trim() || canonSlug(intro.kind, intro.name);
    index.set(id, { id, name: intro.name, kind: intro.kind, note: intro.note ?? '' });
  }
  const out: CanonViolation[] = [];
  for (const o of options) {
    const target = o.targetId?.trim();
    if (!target || index.has(target)) continue;
    out.push({
      code: 'unknown-entity-ref',
      optionId: o.id,
      targetId: target,
      detail: `option "${o.id}" targets "${target}", which is not in <canon>. Either target an entity that already exists, describe what the player can perceive instead of naming it, or declare it in "introduces".`,
    });
  }
  return out;
}

/**
 * LIFE-CANON-6 — how long since each canon entity was last in play.
 *
 * Dormancy is what makes reuse cheaper than invention. A person or a place
 * returning after five scenes carries meaning a brand-new one cannot, because
 * the player has changed in between — so `sceneOpen` is handed the canon sorted
 * with the longest-dormant material FIRST, and told to prefer it.
 *
 * MECHANISM — DERIVED, NOT STORED. The spec (§6, LIFE-CANON-6) originally said
 * canon entries would carry a `lastTouchedScene` field. This computes the same
 * answer from `sagaHistory` instead — one line per closed scene, so the index of
 * the newest line mentioning an entity IS its dormancy. Three reasons:
 *
 *  1. No write path. Storing it means touching the canon array on every turn to
 *     record who was named, for a number only one rare call ever reads.
 *  2. It cannot go stale or drift out of sync with the history it describes,
 *     because it IS the history.
 *  3. Its error skews the RIGHT WAY. A one-line summary does not name every
 *     entity that appeared, so a background entity present-but-unmentioned
 *     reads as more dormant than it was — biasing `drawsOn` toward older
 *     material, which is the direction watch-list signal 4 measures ("always
 *     the most recent entity → dormancy not working"). A stored counter is
 *     more precise and biases neither way.
 *
 * Matching is by id OR name substring, the same crude test `canonWorkingSetIds`
 * uses and for the same reason: a wrong answer costs the planner a weaker
 * suggestion, and cannot break a contract.
 */
export type CanonDigestRow = {
  id: string;
  name: string;
  note: string;
  scenesSince: number;
};

/** Canon reaches ~192 entries at the bucket cap — far too much to hand a
 *  planner. Keeping the most dormant is not a compromise here, it is the
 *  selection LIFE-CANON-6 actually wants. */
export const CANON_DIGEST_CAP = 24;

export function canonDormancy(
  canon: WorldCanon,
  history: readonly string[],
): CanonDigestRow[] {
  const lines = history.map((h) => h.toLowerCase());
  const all = [
    ...canon.characters, ...canon.places, ...canon.objects, ...canon.facts,
  ];
  const rows = all.map((e) => {
    let scenesSince = lines.length;
    // Walk newest → oldest and stop at the first mention.
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i]!;
      const byId = e.id.length >= MIN_NAME_MATCH && line.includes(e.id.toLowerCase());
      const byName = e.name.length >= MIN_NAME_MATCH && line.includes(e.name.toLowerCase());
      if (byId || byName) {
        scenesSince = lines.length - 1 - i;
        break;
      }
    }
    return { id: e.id, name: e.name, note: e.note ?? '', scenesSince };
  });
  // Longest-dormant first, so "prefer what has been away a while" is cheap to
  // obey. Stable within a tie, which preserves canon's append order.
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r.scenesSince - a.r.scenesSince || a.i - b.i)
    .slice(0, CANON_DIGEST_CAP)
    .map(({ r }) => r);
}

/** LIFE-CANON-3: canon character ids whose record says they cannot speak.
 *  `commitNode` uses this to convert a mute entity's `npc` beat into a
 *  `narrator` beat — a hush-spirit that answers by moving a cup is narration,
 *  not a speech bubble. Deterministic, no model round-trip. */
export function muteEntityIds(canon: WorldCanon): Set<string> {
  return new Set(
    canon.characters.filter((c) => c.canSpeak === false).map((c) => c.id),
  );
}
