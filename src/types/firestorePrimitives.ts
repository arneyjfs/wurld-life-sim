/**
 * The leaf scalars every Firestore schema in this directory is built out of:
 * the Timestamp coercion, the difficulty scale, and the translation view-mode
 * pair.
 *
 * Extracted from `firestore.ts` so that `lifeFirestore.ts` can reach them
 * WITHOUT importing `firestore.ts` itself. `firestore.ts` re-exports the
 * life-sim cluster, so a direct `lifeFirestore` -> `firestore` import closes a
 * module cycle, and these are Zod schemas evaluated at module load: the cycle
 * is not a lint nicety there, it throws `Cannot read properties of undefined
 * (reading 'optional')` the first time anything imports the schema. A shared
 * leaf module both sides depend on is the fix; duplicating a schema is not.
 *
 * `firestore.ts` re-exports every name here, so each existing
 * `from '@/types/firestore'` import site is unchanged.
 */
import { z } from 'zod';
import { Timestamp } from 'firebase/firestore';

// ---------- shared scalars ----------

/** Firestore Timestamp from the JS SDK. Zod can't deeply introspect class
 * instances; we accept either a real Timestamp instance OR any object with
 * `toMillis`/`toDate` methods (which the JS SDK always returns), AND we
 * tolerate the raw server-side `{ _seconds, _nanoseconds }` shape some
 * older / function-written docs carry, plus null/empty strings — coercing
 * non-Timestamps to undefined rather than failing the whole doc parse.
 * Every consumer field uses `.optional()` so undefined is always safe. */
function looksLikeTimestamp(v: unknown): v is Timestamp {
  if (v instanceof Timestamp) return true;
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  if (typeof o.toMillis === 'function' && typeof o.toDate === 'function') return true;
  // Raw server-shape: { _seconds, _nanoseconds } or { seconds, nanoseconds }.
  // We rewrap into a real Timestamp via the JS SDK static constructor.
  if (typeof o._seconds === 'number' || typeof o.seconds === 'number') return true;
  return false;
}

export const ZTimestamp = z.preprocess(
  (v) => {
    if (looksLikeTimestamp(v)) {
      if (v instanceof Timestamp) return v;
      const o = v as Record<string, unknown>;
      if (typeof o.toMillis === 'function' && typeof o.toDate === 'function') return v;
      // Coerce raw seconds/nanoseconds shape into a real Timestamp.
      const seconds = (o._seconds ?? o.seconds) as number;
      const nanoseconds = ((o._nanoseconds ?? o.nanoseconds) as number) ?? 0;
      try {
        return new Timestamp(seconds, nanoseconds);
      } catch {
        return undefined;
      }
    }
    // Anything else (null, '', wrong type) → undefined. Drops the field
    // silently so the surrounding doc still parses.
    return undefined;
  },
  z
    .custom<Timestamp>((v): v is Timestamp => looksLikeTimestamp(v), {
      message: 'Expected Firestore Timestamp',
    })
    .optional(),
);

/** Difficulty enum. Source: contexts/AppStateContext.tsx:22. 1-7, default 2. */
export const ZDifficulty = z.union([
  z.literal(1), z.literal(2), z.literal(3), z.literal(4),
  z.literal(5), z.literal(6), z.literal(7),
]);
export type Difficulty = z.infer<typeof ZDifficulty>;

/** MSG-VIEW-7 — the two-row view model, the ONE stored representation of the
 *  view settings. Every field is optional so a partially-written block still
 *  parses; `fromStored` supplies the defaults. Mirrors
 *  `StoredViewSettings['viewSettings']` in `lib/viewSettings.ts`. The retired
 *  Mixed primary / `mixedSecond` (MSG-VIEW-7.12) were migrated out 2026-09-29. */
export const ZStoredViewSettings = z.object({
  primary: z.enum(['practice', 'native']).optional(),
  secondRow: z.boolean().optional(),
});
