import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BEAT_EXIT_MS, departedIds, useExitingBubbles } from './useExitingBubbles';

/**
 * LIFE-BUBBLE-15 — a beat pushed out of the two-bubble window fades.
 *
 * `DialogueArea` renders `bubbles.slice(-2)`, so the third beat's arrival used
 * to delete the oldest in one frame, with no cue at all.
 */
describe('LIFE-BUBBLE-15 — departedIds', () => {
  it('names the ids that left', () => {
    expect(departedIds(['a', 'b'], ['b', 'c'])).toEqual(['a']);
  });

  it('is empty when nothing left', () => {
    expect(departedIds(['a', 'b'], ['a', 'b'])).toEqual([]);
    expect(departedIds([], ['a'])).toEqual([]);
  });

  it('reports every departure when the whole window is replaced', () => {
    // A turn reset swaps both beats at once.
    expect(departedIds(['a', 'b'], ['c', 'd'])).toEqual(['a', 'b']);
  });
});

const b = (id: string) => ({ id });

describe('LIFE-BUBBLE-15 — useExitingBubbles', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('holds a departed beat for the length of the fade, then drops it', () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useExitingBubbles(visible),
      { initialProps: { visible: [b('a'), b('b')] } },
    );
    expect(result.current).toEqual([]);

    rerender({ visible: [b('b'), b('c')] });
    expect(result.current.map((x) => x.id)).toEqual(['a']);

    act(() => void vi.advanceTimersByTime(BEAT_EXIT_MS + 1));
    expect(result.current).toEqual([]);
  });

  it('does not re-run on a render that changed nothing', () => {
    // `slice(-2)` allocates a new array every render, so an array-identity
    // dependency would restart the fade on every frame.
    const { result, rerender } = renderHook(
      ({ visible }) => useExitingBubbles(visible),
      { initialProps: { visible: [b('a'), b('b')] } },
    );
    rerender({ visible: [b('b'), b('c')] });
    act(() => void vi.advanceTimersByTime(BEAT_EXIT_MS - 50));
    // A fresh array with the SAME ids must not extend the fade.
    rerender({ visible: [b('b'), b('c')] });
    act(() => void vi.advanceTimersByTime(60));
    expect(result.current).toEqual([]);
  });

  it('never paints a ghost above a beat that came back', () => {
    // A turn reset can re-mount the same ids. Rendering the ghost as well
    // would show the bubble twice.
    const { result, rerender } = renderHook(
      ({ visible }) => useExitingBubbles(visible),
      { initialProps: { visible: [b('a'), b('b')] } },
    );
    rerender({ visible: [b('b'), b('c')] });
    expect(result.current.map((x) => x.id)).toEqual(['a']);
    rerender({ visible: [b('a'), b('b')] });
    expect(result.current.map((x) => x.id)).not.toContain('a');
  });

  it('holds both when the whole window is replaced at once', () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useExitingBubbles(visible),
      { initialProps: { visible: [b('a'), b('b')] } },
    );
    rerender({ visible: [b('c'), b('d')] });
    expect(result.current.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('keeps departures oldest-first, matching where they stood', () => {
    const { result, rerender } = renderHook(
      ({ visible }) => useExitingBubbles(visible),
      { initialProps: { visible: [b('a'), b('b')] } },
    );
    rerender({ visible: [b('c'), b('d')] });
    expect(result.current.map((x) => x.id)).toEqual(['a', 'b']);
  });
});

/**
 * LIFE-BUBBLE-15 (motion) — the ghost must not replay the ENTRANCE.
 *
 * `BubbleView` puts `.life-beat-enter` on every bubble unconditionally, and
 * the ghost is a freshly-mounted node, so its 380ms fade-IN ran at the same
 * time as the wrapper's 320ms fade-OUT. Nested opacity animations MULTIPLY,
 * so the composite went 0 -> up -> down: the reported "flickers a couple
 * times as it fades".
 *
 * Asserted on the stylesheet, because jsdom computes no animation and the bug
 * is the INTERACTION of two rules that live in different places in the file.
 */
describe('LIFE-BUBBLE-15 — the exit is a single, monotonic fade', () => {
  const CSS = readFileSync(
    path.join(process.cwd(), 'src/styles/globals.css'),
    'utf8',
  );

  it('suppresses the entrance animation inside a fading ghost', () => {
    expect(CSS).toMatch(
      /\.life-beat-exit\s+\.life-beat-enter\s*\{[^}]*animation:\s*none/,
    );
  });

  it('places the override AFTER the rule it overrides', () => {
    // Specificity already decides this, but the LIFE-NODE-12 tests locate
    // `.life-beat-enter {` by FIRST occurrence — an override written above it
    // silently becomes the rule those tests measure.
    expect(CSS.indexOf('\n.life-beat-enter {')).toBeLessThan(
      CSS.indexOf('.life-beat-exit .life-beat-enter'),
    );
  });

  it('exits FASTER than it enters — a departure is not an arrival', () => {
    const exit = /\.life-beat-exit\s*\{[^}]*animation:\s*lifeBeatExit (\d+)ms/.exec(CSS);
    const enter = /\n\.life-beat-enter\s*\{[^}]*animation:\s*lifeBeatEnter (\d+)ms/.exec(CSS);
    expect(exit, 'no .life-beat-exit duration').not.toBeNull();
    expect(enter, 'no .life-beat-enter duration').not.toBeNull();
    expect(Number(exit![1])).toBeLessThan(Number(enter![1]));
    // And the hook must outlive the animation, or the ghost is unmounted
    // mid-fade and the pop is back.
    expect(BEAT_EXIT_MS).toBeGreaterThanOrEqual(Number(exit![1]));
  });
});
