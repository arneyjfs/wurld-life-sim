import { useEffect, useRef, useState } from 'react';

/**
 * LIFE-BUBBLE-15 — a bubble pushed out of the two-bubble window FADES.
 *
 * `DialogueArea` renders `bubbles.slice(-2)`, so the moment a third beat
 * arrives the oldest is simply gone from the tree — one frame, no cue.
 * Reported 2026-08-01: *"message bubbles should fade on their way out, as
 * they're pushed off screen, rather than suddenly disappear."*
 *
 * React unmounts synchronously and has no exit transition, so the departing
 * bubble has to be KEPT — this hook holds it for `exitMs` after it leaves the
 * visible window and hands it back so the caller can render it under an exit
 * class. The column is bottom-anchored, and the departing bubble is the top
 * one, so nothing below it moves while it fades: the exit is purely visual and
 * cannot disturb the beats the player is reading.
 *
 * Deliberately NOT a general TransitionGroup: the window is at most two items
 * and the only thing that ever leaves is the top one.
 */
export const BEAT_EXIT_MS = 320;

/** Ids in `before` that are no longer in `after`. Extracted so the diff — the
 *  part that can actually be wrong — is testable without a renderer. */
export function departedIds(before: readonly string[], after: readonly string[]): string[] {
  const kept = new Set(after);
  return before.filter((id) => !kept.has(id));
}

/**
 * The bubbles that have just left `visible` and are still fading.
 *
 * Returned OLDEST-FIRST and intended to render ABOVE `visible`, which is where
 * they were when they left.
 */
export function useExitingBubbles<T extends { id: string }>(
  visible: readonly T[],
  exitMs: number = BEAT_EXIT_MS,
): T[] {
  const [exiting, setExiting] = useState<T[]>([]);
  const prevRef = useRef<readonly T[]>(visible);
  // The id list, not the array identity: `slice(-2)` allocates on every
  // render, so depending on the array itself would re-run this every frame.
  const key = visible.map((b) => b.id).join('\u0000');

  useEffect(() => {
    const before = prevRef.current;
    prevRef.current = visible;
    const gone = departedIds(
      before.map((b) => b.id),
      visible.map((b) => b.id),
    );
    const liveIds = new Set(visible.map((b) => b.id));
    if (gone.length === 0) {
      // A bubble can come BACK (a turn reset re-mounts the same ids). If it is
      // visible again it must not also be painted as a ghost above itself.
      setExiting((cur) =>
        cur.some((c) => liveIds.has(c.id))
          ? cur.filter((c) => !liveIds.has(c.id))
          : cur,
      );
      return;
    }
    const goneSet = new Set(gone);
    const departed = before.filter((b) => goneSet.has(b.id));
    setExiting((cur) => [
      ...cur.filter((c) => !goneSet.has(c.id) && !liveIds.has(c.id)),
      ...departed,
    ]);
    const timer = setTimeout(
      () => setExiting((cur) => cur.filter((c) => !goneSet.has(c.id))),
      exitMs,
    );
    return () => clearTimeout(timer);
    // `visible` is intentionally absent: `key` is its identity, and including
    // the array would defeat the point of computing `key` at all.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, exitMs]);

  return exiting;
}
