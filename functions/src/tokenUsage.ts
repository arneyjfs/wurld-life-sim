/**
 * Token-usage accounting — single writer for the per-user daily counters the
 * admin usage dashboard reads (`getAdminUsageStatsV2` → `queryTokenUsage`).
 *
 * Extracted into its own module so BOTH the main pipeline graph (`index.ts`)
 * and the standalone compaction task (`tutorCompact.ts`, which deliberately
 * avoids importing `index.ts`) can record usage without duplicating the write
 * shape. Spec: docs/specs/wurld-tutor.md — TUTOR-CTX-CACHE-3 (cached-token
 * capture) + the tutor token-visibility invariants.
 */
import { FieldValue, getFirestore } from "firebase-admin/firestore";
import { normalizeModelKeyForUsage } from "./usageStatsHelpers";

/**
 * Increment the additive daily counters at `tokenUsage/{userId}/daily/{date}`
 * for one Gemini call. Best-effort — a write failure logs and swallows so it
 * never breaks the user-facing path.
 *
 * `opts.cached` = tokens served from Gemini's implicit/explicit cache on this
 * call (the primary cache-hit signal — TUTOR-CTX-CACHE-3). `opts.model`, when
 * present, additionally writes `${category}.byModel.${model}.{in,out,cached,
 * thoughts,count}` so the dashboard can break hit-rate down per model.
 *
 * `opts.thoughts` = reasoning tokens (LIFE-COST-2). Gemini bills these at the
 * OUTPUT rate but excludes them from `candidatesTokenCount`, so a dashboard fed
 * only `tokensOut` under-reports the cost of every thinking call. Recorded as
 * its own counter — callers pricing a call must charge `out + thoughts` at the
 * output rate.
 */
export async function recordTokenUsage(
  userId: string,
  category: string,
  tokensIn: number,
  tokensOut: number,
  opts: { cached?: number; model?: string; thoughts?: number } = {},
): Promise<void> {
  try {
    const dateKey = new Date().toISOString().slice(0, 10); // "YYYY-MM-DD"
    const ref = getFirestore().doc(`tokenUsage/${userId}/daily/${dateKey}`);
    const cached = Math.max(0, Math.floor(opts.cached ?? 0));
    const thoughts = Math.max(0, Math.floor(opts.thoughts ?? 0));
    const updates: Record<string, unknown> = {
      [`${category}.in`]: FieldValue.increment(tokensIn),
      [`${category}.out`]: FieldValue.increment(tokensOut),
      [`${category}.count`]: FieldValue.increment(1),
      userId,
      date: dateKey,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (cached > 0) {
      updates[`${category}.cached`] = FieldValue.increment(cached);
    }
    if (thoughts > 0) {
      updates[`${category}.thoughts`] = FieldValue.increment(thoughts);
    }
    if (opts.model) {
      const mKey = normalizeModelKeyForUsage(opts.model);
      updates[`${category}.byModel.${mKey}.in`] = FieldValue.increment(tokensIn);
      updates[`${category}.byModel.${mKey}.out`] = FieldValue.increment(tokensOut);
      updates[`${category}.byModel.${mKey}.count`] = FieldValue.increment(1);
      if (cached > 0) {
        updates[`${category}.byModel.${mKey}.cached`] = FieldValue.increment(cached);
      }
      if (thoughts > 0) {
        updates[`${category}.byModel.${mKey}.thoughts`] = FieldValue.increment(thoughts);
      }
    }
    await ref.set(updates, { merge: true });
  } catch (err: any) {
    console.warn("[tokenUsage] recordTokenUsage failed:", err?.message ?? err);
  }
}

/**
 * MSG-PIPE-22 — the send-mix counters behind the admin dashboard's
 * "what is the analysis actually doing" row.
 *
 * WHY IT RIDES ON THE SAME DOC. `tokenUsage/{userId}/daily/{date}` is already
 * written on every analysed message, and `queryTokenUsage` already reads the
 * whole window with `collectionGroup("daily").where("date", ...)`. Putting
 * these counters anywhere else would mean a second collection, a second query
 * and a NEW composite index for a handful of integers. Here they cost one
 * extra field per doc and no index at all.
 *
 * Keys are LITERAL dotted field names, matching `recordTokenUsage` above —
 * `set(..., { merge: true })` treats a dotted key as a flat name rather than a
 * path, and the reader looks them up the same way. Mixing the two conventions
 * on one document would produce fields nothing can read.
 *
 * Best-effort, like every counter here: telemetry never breaks a send.
 */
export type SendMixKey = "native" | "practice" | "corrected" | "suggested";

export async function recordSendMix(userId: string, keys: SendMixKey[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    const dateKey = new Date().toISOString().slice(0, 10);
    const updates: Record<string, unknown> = {
      userId, date: dateKey, updatedAt: FieldValue.serverTimestamp(),
    };
    // `corrected` and `suggested` are NOT mutually exclusive with each other or
    // with `practice` — one message can be all three. They are counted as
    // independent tallies, not as buckets of a partition, so the dashboard must
    // read them as "of the practice messages, N were corrected" rather than
    // summing them to a total.
    for (const k of keys) updates[`sendMix.${k}`] = FieldValue.increment(1);
    await getFirestore().doc(`tokenUsage/${userId}/daily/${dateKey}`).set(updates, { merge: true });
  } catch (err: any) {
    console.warn("[tokenUsage] recordSendMix failed:", err?.message ?? err);
  }
}

/**
 * XP-METRIC-1..3 (docs/specs/xp.md §6) — the quiz funnel, XP by source and
 * level changes by cause, on the same `tokenUsage/{uid}/daily/{date}` doc as
 * the send mix above and for the same reasons: no new collection, no index,
 * already in the deletion cascade. LITERAL dotted keys, like `sendMix.*`.
 *
 * `counts` maps a counter to its increment; zero / negative / non-finite
 * entries are dropped, and a call with nothing left writes nothing.
 * Best-effort: a failed counter never fails the request that raised it.
 */
export type ActivityCounterKey =
  | "quiz.shown" | "quiz.answered" | "quiz.clean" | "quiz.dismissed" // XP-METRIC-1
  | "xp.quiz" | "xp.write" | "xp.session" // XP-METRIC-2
  | "level.auto" | "level.undo" | "level.manual"; // XP-METRIC-3

export async function recordActivityCounters(
  userId: string,
  counts: Partial<Record<ActivityCounterKey, number>>,
): Promise<void> {
  const entries = Object.entries(counts).filter(
    (e): e is [string, number] => typeof e[1] === "number" && Number.isFinite(e[1]) && e[1] > 0,
  );
  if (entries.length === 0) return;
  try {
    const dateKey = new Date().toISOString().slice(0, 10);
    const updates: Record<string, unknown> = {
      userId, date: dateKey, updatedAt: FieldValue.serverTimestamp(),
    };
    for (const [k, n] of entries) updates[k] = FieldValue.increment(n);
    await getFirestore().doc(`tokenUsage/${userId}/daily/${dateKey}`).set(updates, { merge: true });
  } catch (err) {
    console.warn("[tokenUsage] recordActivityCounters failed:", err instanceof Error ? err.message : err);
  }
}
