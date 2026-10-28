import { describe, expect, it } from 'vitest';
import {
  localBeatEvent,
  localCorrectionEvent,
  localDecisionEvent,
  mergeLocalEvents,
  pruneDelivered,
} from './mergeLocalEvents';
import type { LifeEvent } from '@/types/firestore';

const listenerEvent = (kind: LifeEvent['kind'], payload: Record<string, unknown>): LifeEvent => ({
  id: `srv-${Math.random().toString(36).slice(2, 8)}`,
  kind,
  payload,
});

describe('mergeLocalEvents — LIFE-NODE-3 overlay', () => {
  it('appends undelivered local events after the listener list', () => {
    const listener = [listenerEvent('beat', { practiceText: 'A' })];
    const local = [localDecisionEvent({ choiceId: 'x', text: 'Pick X' })];
    const merged = mergeLocalEvents(listener, local);
    expect(merged).toHaveLength(2);
    expect(merged[1]!.kind).toBe('decision');
  });

  it('drops a local event once the listener delivers a matching fingerprint', () => {
    const local = [
      localDecisionEvent({ choiceId: 'x', text: 'Pick X' }),
      localBeatEvent({
        speaker: 'narrator',
        speakerName: null,
        npcId: null,
        practiceText: 'Le soleil se lève.',
        nativeText: 'The sun rises.',
      }),
    ];
    const listener = [
      listenerEvent('decision', { choiceId: 'x', text: 'Pick X' }),
      listenerEvent('beat', { practiceText: 'Le soleil se lève.' }),
    ];
    expect(pruneDelivered(listener, local)).toHaveLength(0);
    expect(mergeLocalEvents(listener, local)).toHaveLength(2);
  });

  it('LIFE-NODE-3 — two-channel narrator beats (empty practiceText) fingerprint on nativeText, so distinct narrations do NOT collide', () => {
    // Regression: narrator beats leave practiceText empty (LIFE-LANG-8). With
    // the old practiceText-only fingerprint they ALL collided to "beat:", so a
    // just-committed narration was dropped the instant the listener tail held
    // any other narrator beat. It must be KEPT when the narrations differ.
    const local = [
      localBeatEvent({
        speaker: 'narrator',
        speakerName: null,
        npcId: null,
        practiceText: '',
        nativeText: 'You notice a loose stone in the wall.',
      }),
    ];
    const listener = [
      listenerEvent('beat', {
        practiceText: '',
        nativeText: 'The cellar is cold and quiet.',
      }),
    ];
    const pruned = pruneDelivered(listener, local);
    expect(pruned).toHaveLength(1);
    expect((pruned[0]!.payload as Record<string, unknown>).nativeText).toBe(
      'You notice a loose stone in the wall.',
    );
  });

  it('LIFE-NODE-3 — an empty-practiceText narrator beat IS dropped once its own narration lands in the listener', () => {
    const local = [
      localBeatEvent({
        speaker: 'narrator',
        speakerName: null,
        npcId: null,
        practiceText: '',
        nativeText: 'You nod.',
      }),
    ];
    const listener = [
      listenerEvent('beat', { practiceText: '', nativeText: 'You nod.' }),
    ];
    expect(pruneDelivered(listener, local)).toHaveLength(0);
  });

  it('keeps local events whose text has not appeared', () => {
    const local = [localCorrectionEvent({
      kind: 'generation',
      correct: false,
      picked: 'veux',
      correctAnswer: 'voudrais',
      promptSource: 'Je ___ un café.',
    })];
    const listener = [listenerEvent('beat', { practiceText: 'Autre chose.' })];
    const pruned = pruneDelivered(listener, local);
    expect(pruned).toHaveLength(1);
    expect(pruned[0]!.kind).toBe('correction');
  });
  it('caps the overlay at 12 entries', () => {
    const local = Array.from({ length: 20 }, (_, i) =>
      localDecisionEvent({ choiceId: `c${i}`, text: `Pick ${i}` }),
    );
    expect(pruneDelivered([], local)).toHaveLength(12);
  });
});
