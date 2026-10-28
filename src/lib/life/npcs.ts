/**
 * LIFE-NPC-1/4/5: persistent NPC roster writes.
 *
 * The step generator flags each new NPC as transient or persistent
 * (via npcId — slug present = persistent, omitted = transient). The
 * orchestrator promotes persistent NPCs by writing a row to
 * users/{uid}/lifeNpcs/{npcId} on first appearance + kicking off
 * avatar generation (LIFE-NPC-2 / Phase C).
 *
 * Idempotent — a re-introduction of an existing NPC does NOT
 * overwrite the avatar; only `lastSeenAt` updates.
 */
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/lib/firebase';
import * as log from '@/lib/log';
import { writeNpcAvatar } from './lifeAvatarAssets';
import type { LifeNpc } from '@/types/firestore';

/** Strip undefined values (Firestore rejects them) — same helper
 *  pattern world.ts uses. */
function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export type PromoteNpcInput = {
  uid: string;
  /** LIFE-WORLD-*: required; NPCs live under each world. */
  worldId: string;
  /** Stable slug the model emits (e.g. "marie-fruit-seller"). */
  npcId: string;
  /** Display name; first non-empty wins on re-introduction. */
  name: string;
  /** Optional relationship hint ("fruit seller", "colleague"). */
  relationship?: string;
  /** LIFE-SCENE-8: scope. Pass the active scene's id when
   *  promoting a scene-scoped NPC. World NPCs omit / pass null. */
  sceneId?: string | null;
};

/**
 * LIFE-NPC-9 — canonical NPC id.
 *
 * THE DEFECT, reported 2026-08-03: ONE baker, TWO roster rows, two avatar
 * generations and two description generations, all billed. The step's
 * `introduces` block supplied `Marc`, `sceneGenerate`'s `keyNpcs` supplied
 * `marc`, and `worldArc`'s `recurringNpcIds` supplied `Marc` again — three
 * generators, three id conventions, and nothing anywhere reconciling them.
 * `npcDoc` took whatever it was handed, so `Marc` and `marc` were simply two
 * different people who happened to look identical on screen.
 *
 * Canonicalised HERE rather than at each of the three call sites, because a
 * rule enforced at N call sites is a rule that breaks when someone adds the
 * N+1th. Every read and write in this module goes through `npcDoc`, so this is
 * the one door they all pass.
 */
export function npcIdFor(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Élodie → Elodie, so accents cannot fork an id
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function npcDoc(uid: string, worldId: string, npcId: string) {
  return doc(db, 'users', uid, 'lifeWorlds', worldId, 'npcs', npcIdFor(npcId));
}

/** Either creates a new lifeNpcs row OR updates lastSeenAt on an
 *  existing one. Returns true if this was a NEW promotion (caller
 *  may kick off avatar generation). */
export async function promoteOrTouchNpc(
  input: PromoteNpcInput,
): Promise<{ isNew: boolean }> {
  const ref = npcDoc(input.uid, input.worldId, input.npcId);
  const existing = await getDoc(ref);
  if (existing.exists()) {
    await updateDoc(
      ref,
      stripUndefined({
        lastSeenAt: serverTimestamp(),
        // sceneId is sticky once set — don't overwrite to null on
        // a re-touch. If the caller passes a NEW sceneId (rare
        // edge case where an NPC straddles two arcs), update.
        ...(input.sceneId ? { sceneId: input.sceneId } : {}),
      } as Record<string, unknown>),
    );
    return { isNew: false };
  }
  await setDoc(
    ref,
    stripUndefined({
      id: npcIdFor(input.npcId),
      name: input.name,
      relationship: input.relationship ?? null,
      // Avatar bytes live in the assets/npc-{id} sidecar (LIFE-DATA-1);
      // the doc carries only the status flag.
      avatarStatus: 'pending',
      scope: 'scene',
      sceneId: input.sceneId ?? null,
      firstMetAt: serverTimestamp(),
      lastSeenAt: serverTimestamp(),
    } as Record<string, unknown>),
  );
  return { isNew: true };
}

/** LIFE-NPC-RECUR-*: promote a scene-scoped NPC to world scope.
 *  Called on scene resolve when the model includes the NPC in
 *  `scene.resolved.promotedNpcIds`. The NPC survives into future
 *  arcs as a recurring world-scope character. */
export async function promoteNpcToWorld(
  uid: string,
  worldId: string,
  npcId: string,
): Promise<void> {
  await updateDoc(
    npcDoc(uid, worldId, npcId),
    stripUndefined({
      scope: 'world',
      sceneId: null,
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>),
  );
}

/** LIFE-NPC-RECUR-*: retire a world-scope NPC. Sets scope to
 *  'transient' so the roster filter drops them; the next turn's
 *  promoteOrTouchNpc cycle plus event log writes
 *  `npc_forgotten`. The model picks who retires via
 *  `scene.resolved.retiredNpcIds`. */
export async function retireNpcToTransient(
  uid: string,
  worldId: string,
  npcId: string,
): Promise<void> {
  await updateDoc(
    npcDoc(uid, worldId, npcId),
    stripUndefined({
      scope: 'transient',
      updatedAt: serverTimestamp(),
    } as Record<string, unknown>),
  );
}

/** Store the NPC's avatar after gen lands. LIFE-DATA-1: bytes go to the
 *  `assets/npc-{id}` sidecar FIRST, THEN the npc doc's status flips to
 *  'ready' — so a status==='ready' reader always finds the sidecar. The
 *  roster-listened npc doc never carries the avatar bytes. */
export async function setNpcAvatar(
  uid: string,
  worldId: string,
  npcId: string,
  dataUri: string,
): Promise<void> {
  await writeNpcAvatar(uid, worldId, npcId, dataUri);
  await updateDoc(npcDoc(uid, worldId, npcId), {
    avatarStatus: 'ready',
    updatedAt: serverTimestamp(),
  });
}

/** LIFE-NPC-7: write the NPC's profile description after gen lands.
 *  No failure marker — a failed gen just leaves `description` null and
 *  the commitNode roster sweep re-attempts on a later turn. */
export async function setNpcDescription(
  uid: string,
  worldId: string,
  npcId: string,
  description: string,
): Promise<void> {
  await updateDoc(npcDoc(uid, worldId, npcId), {
    description,
    updatedAt: serverTimestamp(),
  });
}

/** LIFE-REP-3: write ONE NPC's reputation total. The VALUE is computed by
 *  `applyFelt` (clamped both per-turn and absolutely) — this only persists it,
 *  so there is exactly one place that decides what the number may be. */
export async function setNpcStanding(
  uid: string,
  worldId: string,
  npcId: string,
  standing: number,
): Promise<void> {
  await updateDoc(npcDoc(uid, worldId, npcId), {
    standing,
    updatedAt: serverTimestamp(),
  });
}

/** LIFE-NPC-MEM-1: write ONE NPC's one-line "story so far" memory. Called via
 *  the shared `writeNpcMemories` helper from both the inline step-turn writer
 *  and (until it retires) compaction. Best-effort — a failed write is swallowed
 *  by the caller (background polish, not critical). */
export async function setNpcOneLineMemory(
  uid: string,
  worldId: string,
  npcId: string,
  oneLineMemory: string,
): Promise<void> {
  await updateDoc(npcDoc(uid, worldId, npcId), {
    oneLineMemory,
    updatedAt: serverTimestamp(),
  });
}

/** LIFE-NPC-MEM-1: apply a batch of per-NPC `oneLineMemory` updates, dropping
 *  any `npcId` NOT in the live roster (the model can hallucinate ids) or with
 *  empty text, and swallowing individual write failures. Shared by the inline
 *  step-turn writer (`applyTurnSignals`) and compaction — best-effort, since
 *  memory is a convenience hint (roster nudge + profile card), never a
 *  continuity primitive (continuity lives in storyLog / canon / recentEvents).
 *  `source` tags the log channel so the two callers stay distinguishable. */
export async function writeNpcMemories(
  uid: string,
  worldId: string,
  memories: ReadonlyArray<{ npcId: string; oneLineMemory: string }>,
  roster: ReadonlyArray<LifeNpc>,
  source = 'life',
): Promise<void> {
  if (memories.length === 0) return;
  const known = new Set(roster.map((n) => n.id));
  const valid = memories.filter((m) => known.has(m.npcId) && m.oneLineMemory.trim());
  const dropped = memories.length - valid.length;
  if (dropped > 0) {
    log.warn(`${source}.npc-memory-dropped`, {
      dropped,
      reason: 'npcId not in roster, or empty',
    });
  }
  await Promise.all(
    valid.map(async (m) => {
      try {
        await setNpcOneLineMemory(uid, worldId, m.npcId, m.oneLineMemory.trim());
      } catch (err) {
        log.warn(`${source}.npc-memory-write-failed`, {
          npcId: m.npcId,
          err: String(err),
        });
      }
    }),
  );
}

/** Mark gen as failed so the orchestrator doesn't retry forever
 *  (LIFE-FAIL-5). */
export async function setNpcAvatarFailed(
  uid: string,
  worldId: string,
  npcId: string,
): Promise<void> {
  await updateDoc(npcDoc(uid, worldId, npcId), {
    avatarStatus: 'failed',
    updatedAt: serverTimestamp(),
  });
}

/** Returns the path used by useDocSnapshot consumers. */
export function npcsCollection(uid: string, worldId: string) {
  return collection(db, 'users', uid, 'lifeWorlds', worldId, 'npcs');
}

/** Read-side type guard for the avatar status. The bytes live in the
 *  sidecar now (LIFE-DATA-1), so 'ready' status IS the readiness signal —
 *  the caller fetches the sidecar via `useNpcAvatars`. */
export function npcHasReadyAvatar(npc: LifeNpc | null | undefined): boolean {
  return !!npc && npc.avatarStatus === 'ready';
}
