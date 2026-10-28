/**
 * LIFE-CAST-6 — remove every key whose value is `undefined`, at any depth.
 *
 * The Firestore SDK REJECTS an explicit `undefined` field value rather than
 * ignoring it (`ignoreUndefinedProperties` is not set on this app's instance in
 * `src/lib/firebase.ts`), so ONE absent optional field fails the ENTIRE write —
 * `Object.entries` lists the key, the SDK refuses the doc, and the caller gets
 * `Unsupported field value: undefined`.
 *
 * That is why this is a shared module rather than a local helper. Every
 * life-sim write assembles its payload from model output, and model output is
 * exactly where an optional field goes missing: `cleanText` maps the `""` /
 * `"none"` / `"n/a"` that LIFE-CAST-4 measured the model returning for a
 * REQUIRED string down to `null`, and `?? undefined` then turns that into a
 * present key holding `undefined`. The failures are silent and total — for a
 * scene, `startSceneIfNone` swallows the throw and the world is left with no
 * active scene, which per LIFE-SCENE-24 is a chapter that can never end while a
 * billed `sceneOpen` re-fires on every turn.
 *
 * DEEP, not top-level. The field that actually bit was `outline.where`, nested
 * one level down, and every other life-sim write is the same shape: worlds
 * patch `cast` / `fronts` / `canon` / `saga` / `currentArc` / `storyLog`, all
 * nested maps or arrays. A top-level-only loop looks like a guard and is not
 * one.
 *
 * Only PLAIN objects and arrays are walked, so `serverTimestamp()` and any
 * other `FieldValue` / `Timestamp` / `DocumentReference` sentinel passes
 * through BY IDENTITY rather than being copied into an inert plain object —
 * which would be a far worse bug than the one this fixes, and a silent one.
 *
 * Spreading-when-present at the source (`...(where ? { where } : {})`, as
 * `cast.ts` does) is still the primary rule; this is the backstop for the
 * writes that assemble a payload from somewhere else.
 */

function isPlainObject(v: unknown): v is Record<string, unknown> {
  if (typeof v !== 'object' || v === null) return false;
  const proto: unknown = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

export function stripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    return value
      .filter((v) => v !== undefined)
      .map((v) => stripUndefined(v)) as unknown as T;
  }
  if (isPlainObject(value)) {
    const clean: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v !== undefined) clean[k] = stripUndefined(v);
    }
    return clean as T;
  }
  return value;
}
