/**
 * Engagement-loop helpers — session-day tracking + welcome-back gate.
 *
 * Called once per cold-open of `/wurlds` after the world doc loads.
 * Updates the world with the new sessionDay if this is the first
 * open of the day, and returns a `welcomeBack` flag if the previous
 * open was > WELCOME_BACK_THRESHOLD_HOURS ago. The LifeScreen uses
 * that flag to show a soft welcome-back overlay before the player's
 * next CYOA.
 */
import { serverTimestamp } from 'firebase/firestore';
import { updateLifeWorld } from './world';
import type { LifeWorld } from '@/types/firestore';

/** Surfaces the welcome-back overlay when the player returns after
 *  a meaningful gap. Picked high enough that quick session-resumes
 *  don't trigger it (we already replay events) but low enough that
 *  the player who comes back the next morning sees it. */
export const WELCOME_BACK_THRESHOLD_HOURS = 12;

export type SessionDayResult = {
  /** True iff this open is the FIRST one of today (in the player's
   *  local TZ). Caller bumps any streak UI. */
  newSessionDay: boolean;
  /** Hours since the previous session, or null if this is the
   *  player's first-ever open. */
  hoursSinceLastSession: number | null;
  /** True when the gap is meaningful (> threshold). */
  welcomeBack: boolean;
  /** Updated session-day count (writes through to the world doc).
   *  Drives the streak number a Phase-D engagement widget would
   *  surface. */
  sessionDayCount: number;
};

/** Pure: derive the next session-state from the current world +
 *  the moment of open. The Firestore write is performed separately
 *  by `recordSessionOpen`, which makes this trivially testable. */
export function deriveSessionDay(
  world: LifeWorld,
  nowMs: number,
): SessionDayResult {
  const lastMs = world.lastSessionAt?.toMillis?.() ?? null;
  const hoursSinceLastSession =
    lastMs == null ? null : Math.max(0, (nowMs - lastMs) / (1000 * 60 * 60));
  const todayKey = ymd(new Date(nowMs));
  const newSessionDay = todayKey !== (world.lastSessionDay ?? '');
  const sessionDayCount = (world.sessionDayCount ?? 0) + (newSessionDay ? 1 : 0);
  const welcomeBack =
    hoursSinceLastSession !== null &&
    hoursSinceLastSession >= WELCOME_BACK_THRESHOLD_HOURS;
  return {
    newSessionDay,
    hoursSinceLastSession,
    welcomeBack,
    sessionDayCount,
  };
}

function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Side-effect side — writes the new session-state to the world
 *  doc + returns the derived result. Called once per cold-open. */
export async function recordSessionOpen(
  uid: string,
  world: LifeWorld,
): Promise<SessionDayResult> {
  const nowMs = Date.now();
  const result = deriveSessionDay(world, nowMs);
  await updateLifeWorld(uid, world.id, {
    lastSessionAt: serverTimestamp() as unknown as LifeWorld['lastSessionAt'],
    lastSessionDay: ymd(new Date(nowMs)),
    sessionDayCount: result.sessionDayCount,
  });
  return result;
}
