/**
 * Structured dev-console logging for the life-sim Gemini round-trips.
 * One channel per call kind so the console reads at a glance:
 *
 *   [LIFE/STEP]              — every lifeStep response (parsed)
 *   [LIFE/BIO]               — character bio generation
 *   [LIFE/SCENE-GEN]      — sceneGenerate response
 *   [LIFE/SCENE-REPLAN]   — sceneReplan response
 *   [LIFE/SCENE-COMPLETE] — when a scene archives
 *   [LIFE/WORLD-ARC]         — worldArcGenerate response
 *   [LIFE/GEN-RETRY]         — a transport attempt that failed and is being
 *                              retried (LIFE-NODE-14/15)
 *   …-FAILED                 — loud failure markers (warn-level)
 *
 * Routes through the existing src/lib/log.ts so production stays
 * controlled (log.info / log.warn obey the central log level). ALSO
 * appends each entry to an in-memory ring buffer so the LifeScreen
 * debug overlay can show the recent history even after the user
 * navigates between routes (which would otherwise blow away the
 * browser devtools console).
 *
 * Spec: docs/specs/life-sim.md §11 (LIFE-SCENE-*).
 */
import * as log from '../log';
import { setTelemetryWorld } from './telemetry';

type Channel =
  /** LIFE-GOAL-11: the ladder narrates itself every turn. It shipped silent,
   *  and a player report of "the goal didn't regenerate" could not be answered
   *  from a nine-minute transcript because this channel did not exist. */
  | 'GOAL'
  | 'STEP'
  | 'BIO'
  | 'SAGA'
  | 'SCENE-GEN'
  | 'SCENE-REPLAN'
  /** LIFE-ARCH-4: `sceneClose` — the call that replaces SCENE-REPLAN. Its own
   *  channel because it does four jobs the replan never did (compaction,
   *  clocks, cast deltas, canon) and a reader needs to tell them apart. */
  | 'SCENE-CLOSE'
  | 'SCENE-COMPLETE'
  | 'SCENE-HOOK-DECLINED'
  | 'WORLD-ARC'
  | 'NPC-AVATAR'
  /** LIFE-NODE-15(d): a transport attempt that failed and is being retried
   *  underneath a content attempt (`generateWithRetry.ts`). Its own channel
   *  rather than the caller's, because the retry ladder is shared by every
   *  life-sim generator and the payload's `category` says which one it was. */
  | 'GEN-RETRY';

export type LifeDebugEntry = {
  /** Wall-clock ms; sorts the buffer chronologically. */
  ts: number;
  /** 'info' for success paths, 'warn' for failures. */
  level: 'info' | 'warn';
  /** `LIFE/<channel>` (success) or `LIFE/<channel>-FAILED` (warn). */
  tag: string;
  /** Short summary line — same as the dev-console prefix. */
  summary: string;
  /** Free-form payload (parsed response, error string, etc.). */
  payload: Record<string, unknown>;
};

const BUFFER_MAX = 100;
const buffer: LifeDebugEntry[] = [];
const listeners = new Set<(entries: ReadonlyArray<LifeDebugEntry>) => void>();
/** The buffer is per-world. Switching worlds wipes the previous
 *  world's entries — they don't belong in the new world's context.
 *  LifeScreen drives this via `setLifeDebugWorld(worldId)` on mount
 *  + route param change. Null = no world currently bound. */
let currentWorldId: string | null = null;

function push(entry: LifeDebugEntry): void {
  buffer.push(entry);
  if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  // Snapshot a copy so React state updaters see a new identity.
  const snapshot = buffer.slice();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore */
    }
  });
}

export function readLifeDebugBuffer(): ReadonlyArray<LifeDebugEntry> {
  return buffer.slice();
}

export function subscribeLifeDebug(
  fn: (entries: ReadonlyArray<LifeDebugEntry>) => void,
): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function clearLifeDebugBuffer(): void {
  buffer.length = 0;
  const snapshot = buffer.slice();
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      /* ignore */
    }
  });
}

/** Bind the buffer to a worldId. When the bound id changes (e.g.
 *  the player navigates from one world to another), the buffer is
 *  cleared so the new world's debug view doesn't inherit the prior
 *  world's traces. Pass `null` to unbind without clearing (e.g.
 *  the overview screen). */
export function setLifeDebugWorld(worldId: string | null): void {
  // Always forward to telemetry so its buffer is wiped on the same
  // world-switch boundary as the debug log.
  setTelemetryWorld(worldId);
  if (worldId === currentWorldId) return;
  if (worldId !== null && currentWorldId !== null) {
    // Switching from world A → world B. Wipe.
    clearLifeDebugBuffer();
  }
  currentWorldId = worldId;
}

export function lifeDebug(
  channel: Channel,
  summary: string,
  payload?: Record<string, unknown>,
): void {
  const tag = `LIFE/${channel}`;
  log.info(`[${tag}] ${summary}`, payload ?? {});
  push({ ts: Date.now(), level: 'info', tag, summary, payload: payload ?? {} });
}

/**
 * LIFE-NODE-15(c) — a fault the code RECOVERED from.
 *
 * Warn-level (so the overlay renders it amber, same as a failure) but under the
 * plain `LIFE/<channel>` tag rather than `LIFE/<channel>-FAILED`, because
 * nothing failed: the beat clamp trimmed a beat, the graded direction was
 * repaired in place, the transport retry succeeded. Routing these through
 * `lifeFailed` was rejected — the beat clamp fires on the ORDINARY `say` turn,
 * so a `-FAILED` badge would land on every healthy speech turn and bury the
 * real failures the overlay exists to surface.
 */
export function lifeWarn(
  channel: Channel,
  summary: string,
  payload?: Record<string, unknown>,
): void {
  const tag = `LIFE/${channel}`;
  log.warn(`[${tag}] ${summary}`, payload ?? {});
  push({ ts: Date.now(), level: 'warn', tag, summary, payload: payload ?? {} });
}

export function lifeFailed(
  channel: Channel,
  summary: string,
  payload?: Record<string, unknown>,
): void {
  const tag = `LIFE/${channel}-FAILED`;
  log.warn(`[${tag}] ${summary}`, payload ?? {});
  push({ ts: Date.now(), level: 'warn', tag, summary, payload: payload ?? {} });
}
