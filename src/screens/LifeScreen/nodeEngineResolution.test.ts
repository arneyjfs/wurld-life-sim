import { describe, expect, it, vi } from 'vitest';

import {
  arriveAtResolution,
  resolutionToArrival,
  takeResolution,
} from './nodeEngineResolution';
import type { QuestionResolution } from '@/lib/life/stepSchema';

/**
 * LIFE-EX-PLAN-5. The question node pre-authors the continuation that follows
 * resolution, so the post-feedback `life_step` call disappears. These pin the
 * mapping onto the normal arrival path — the part that decides how the
 * pre-authored content is rendered and committed.
 */
const beat = (practiceText: string) => ({
  speaker: 'npc' as const,
  speakerName: 'Paul',
  npcId: 'paul',
  practiceText,
  nativeText: 'gloss',
  complexWords: [],
});

const resolution = (over: Partial<QuestionResolution> = {}): QuestionResolution =>
  ({
    beats: [beat('Deux euros.')],
    options: [
      { id: 'pay', practiceText: 'Pay', nativeText: 'Pay' },
      { id: 'leave', practiceText: 'Leave', nativeText: 'Leave' },
    ],
    logLine: 'You paid Paul.',
    ...over,
  }) as QuestionResolution;

describe('resolutionToArrival', () => {
  it('presents the resolution as a BRANCH, never a continuation', () => {
    // A continuation means exactly ONE option with id "continue"
    // (optionCountIssues). A resolution carries 2-3, so calling it a
    // continuation would either fail validation or collapse the player's
    // choices to one.
    const { node } = resolutionToArrival(resolution(), 7);
    expect(node.kind).toBe('branch');
  });

  it('carries the resolution beats and options onto the arrival', () => {
    const { node, liveResult } = resolutionToArrival(resolution(), 7);
    expect(node.kind === 'branch' && node.beats).toHaveLength(1);
    expect(liveResult.options.map((o) => o.id)).toEqual(['pay', 'leave']);
    expect(liveResult.node).toBe(node);
  });

  it('LIFE-STORY-LOG-1 — threads the resolution logLine through as a live turn would', () => {
    const { liveResult } = resolutionToArrival(resolution(), 7);
    expect(liveResult.logLine).toBe('You paid Paul.');
  });

  it('LIFE-ARC-PACE-1 — marks itself as NOT a generated turn, so pacing ignores it', () => {
    // The resolution costs no `life_step` call. It appends a story-log line, so
    // without this flag the chapter pace counter would advance twice on every
    // graded turn and chapters would be told they were overdue ~9 turns early.
    expect(resolutionToArrival(resolution(), 7).liveResult.fromResolution).toBe(true);
  });

  it('LIFE-NODE-6 — stamps the CURRENT nonce so a stale arrival can still be dropped', () => {
    expect(resolutionToArrival(resolution(), 42).liveResult.nonce).toBe(42);
  });

  it('LIFE-EX-3 — an EMPTY beat list is legal (after inbound, the NPC line is still current)', () => {
    const { node, liveResult } = resolutionToArrival(resolution({ beats: [] }), 1);
    expect(node.kind === 'branch' && node.beats).toEqual([]);
    expect(liveResult.options).toHaveLength(2);
  });

  it('passes backdropIntent through when the resolution moves the scene', () => {
    const backdropIntent = {
      locationType: 'cafe',
      vibe: 'modern_city',
      persistent: true,
      locationLabel: 'Le Café',
    };
    const { node } = resolutionToArrival(resolution({ backdropIntent }), 1);
    expect(node.backdropIntent).toEqual(backdropIntent);
  });

  it('omits backdropIntent entirely when absent, rather than setting undefined', () => {
    // `arriveAtNode` branches on `node.backdropIntent` truthiness and commitNode
    // persists `backdropIntent ?? null`; an explicit undefined key is harmless but
    // an explicit null would read as "the scene changed to nothing".
    const { node } = resolutionToArrival(resolution(), 1);
    expect('backdropIntent' in node).toBe(false);
  });
});

describe('arriveAtResolution', () => {
  it('lands through arriveAtNode with append + a causeless commit', () => {
    const arriveAtNode = vi.fn();
    arriveAtResolution(resolution(), 3, arriveAtNode);
    expect(arriveAtNode).toHaveBeenCalledTimes(1);
    const [node, opts] = arriveAtNode.mock.calls[0]!;
    expect(node.kind).toBe('branch');
    // 'append', not 'reset': the resolved-line bubble was appended with
    // resetTurn immediately before, so this continues the same turn.
    expect(opts.appendMode).toBe('append');
    // The correction event is already committed by feedbackContinue.
    expect(opts.action).toEqual({ kind: 'none' });
    expect(opts.liveResult.options).toHaveLength(2);
  });
});

describe('takeResolution', () => {
  it('returns the held resolution and clears it in the same step', () => {
    const ref = { current: resolution() };
    expect(takeResolution(ref)).not.toBeNull();
    expect(ref.current).toBeNull();
  });

  it('is single-use — a second take yields null', () => {
    // The failure this prevents: a stale continuation from an earlier graded
    // turn being replayed onto a later one.
    const ref = { current: resolution() };
    takeResolution(ref);
    expect(takeResolution(ref)).toBeNull();
  });

  it('tolerates an already-empty ref', () => {
    const ref: { current: QuestionResolution | null } = { current: null };
    expect(takeResolution(ref)).toBeNull();
  });
});
