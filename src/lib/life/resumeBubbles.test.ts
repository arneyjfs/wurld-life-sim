import { describe, it, expect } from 'vitest';
import { buildResumeSeed, resumeBubblesFromEvents } from './resumeBubbles';
import type { MessageKey } from '@/i18n';
import type { LifeEvent } from '@/types/firestore';

const beat = (
  speaker: 'narrator' | 'npc' | 'user',
  practiceText: string,
  id?: string,
): LifeEvent => ({
  id: id ?? `e-${practiceText}`,
  kind: 'beat',
  payload: { speaker, practiceText, nativeText: 'gloss' },
});

describe('resumeBubblesFromEvents — LIFE-FLOW-2', () => {
  it('returns the LAST 2 beat events as bubbles', () => {
    const events: LifeEvent[] = [
      beat('narrator', 'first'),
      beat('npc', 'second'),
      beat('narrator', 'third'),
      beat('user', 'fourth'),
    ];
    const out = resumeBubblesFromEvents(events);
    expect(out).toHaveLength(2);
    expect(out[0]?.practiceText).toBe('third');
    expect(out[1]?.practiceText).toBe('fourth');
  });

  it('filters out non-beat events', () => {
    const events: LifeEvent[] = [
      { id: 'd', kind: 'decision', payload: {} },
      beat('npc', 'spoken'),
      { id: 'f', kind: 'flashcard_added', payload: {} },
    ];
    const out = resumeBubblesFromEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0]?.practiceText).toBe('spoken');
  });

  it('LIFE-LANG-8 — keeps narrator beats (narration in nativeText, empty practiceText)', () => {
    const events: LifeEvent[] = [
      {
        id: 'narr',
        kind: 'beat',
        payload: { speaker: 'narrator', practiceText: '', nativeText: 'You wake up.' },
      },
      beat('npc', 'Salut !'),
    ];
    const out = resumeBubblesFromEvents(events);
    expect(out).toHaveLength(2);
    expect(out[0]?.speaker).toBe('narrator');
    expect(out[0]?.nativeText).toBe('You wake up.');
    expect(out[1]?.practiceText).toBe('Salut !');
  });

  it('LIFE-WIP-2 — drops a truly-blank beat (no text on either channel)', () => {
    const events: LifeEvent[] = [
      beat('npc', 'real'),
      { id: 'blank', kind: 'beat', payload: { speaker: 'npc', practiceText: '' } },
    ];
    const out = resumeBubblesFromEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0]?.practiceText).toBe('real');
  });

  it('returns empty array when there are no beat events', () => {
    expect(resumeBubblesFromEvents([])).toEqual([]);
    expect(
      resumeBubblesFromEvents([{ id: 'd', kind: 'decision', payload: {} }]),
    ).toEqual([]);
  });

  it('preserves speaker / speakerName / npcId fields', () => {
    const events: LifeEvent[] = [
      {
        id: 'e-1',
        kind: 'beat',
        payload: {
          speaker: 'npc',
          speakerName: 'Sophie',
          npcId: 'sophie-friend',
          practiceText: 'Salut !',
          nativeText: 'Hi!',
        },
      },
    ];
    const b = resumeBubblesFromEvents(events)[0]!;
    expect(b?.speaker).toBe('npc');
    expect(b?.speakerName).toBe('Sophie');
    expect(b?.npcId).toBe('sophie-friend');
  });

  it('LIFE-FLOW-5 — count=3 returns the last 3 beat events', () => {
    const events: LifeEvent[] = [
      beat('narrator', 'first'),
      beat('npc', 'second'),
      beat('narrator', 'third'),
      beat('user', 'fourth'),
    ];
    const out = resumeBubblesFromEvents(events, 3);
    expect(out).toHaveLength(3);
    expect(out[0]?.practiceText).toBe('second');
    expect(out[2]?.practiceText).toBe('fourth');
  });
});

describe('buildResumeSeed — LIFE-FLOW-2', () => {
  const t = (key: MessageKey) => `t:${key}`;

  it('LIFE-FLOW-2 — seeds the last-2 beat bubbles + the __resume__ chip', () => {
    const events: LifeEvent[] = [
      beat('narrator', 'first'),
      beat('npc', 'second'),
      beat('user', 'third'),
    ];
    const seed = buildResumeSeed(events, t);
    expect(seed.bubbles).toHaveLength(2);
    expect(seed.bubbles[0]?.practiceText).toBe('second');
    expect(seed.bubbles[1]?.practiceText).toBe('third');
    expect(seed.choices).toHaveLength(1);
    // v2.1: no emoji — the resume no longer renders a manual continue chip
    // (LifeScreen auto-continues), and the ▶️ was ugly regardless.
    expect(seed.choices[0]).toEqual({
      id: '__resume__',
      practiceText: 't:life.resume.continue.practice',
      nativeText: 't:life.resume.continue.native',
    });
  });

  it('LIFE-FLOW-2 — falls back to the narrator prompt bubble when no beats exist', () => {
    const seed = buildResumeSeed(
      [{ id: 'd', kind: 'decision', payload: {} }],
      t,
    );
    expect(seed.bubbles).toHaveLength(1);
    expect(seed.bubbles[0]).toMatchObject({
      id: 'resume',
      speaker: 'narrator',
      practiceText: 't:life.resume.prompt.practice',
      nativeText: 't:life.resume.prompt.native',
    });
  });
});

describe('resume annotations — LIFE-BUBBLE-7', () => {
  it('LIFE-BUBBLE-7 — round-trips complexWords + wordTranslations so resumed bubbles stay tappable', () => {
    const events: LifeEvent[] = [
      {
        id: 'e-annotated',
        kind: 'beat',
        payload: {
          speaker: 'npc',
          speakerName: 'Sophie',
          practiceText: 'On déjeune ensemble ?',
          nativeText: 'Lunch together?',
          complexWords: ['déjeune'],
          wordTranslations: { 'déjeune': 'have lunch' },
        },
      },
    ];
    const b = resumeBubblesFromEvents(events)[0]!;
    expect(b?.complexWords).toEqual(['déjeune']);
    expect(b?.wordTranslations).toEqual({ 'déjeune': 'have lunch' });
  });

  it('LIFE-BUBBLE-7 — beats without annotations rehydrate with undefined annotation fields', () => {
    const [b] = resumeBubblesFromEvents([beat('npc', 'Salut !')]);
    expect(b?.complexWords).toBeUndefined();
    expect(b?.wordTranslations).toBeUndefined();
  });
});

describe('LIFE-LANG-18 — retired', () => {
  it('LIFE-LANG-18 — retired: a stored beat event carrying swapWords rehydrates without it', () => {
    const events: LifeEvent[] = [
      {
        id: 'e-old',
        kind: 'beat',
        payload: {
          speaker: 'npc',
          practiceText: 'Bonjour, mon ami.',
          nativeText: 'Hello, my friend.',
          complexWords: ['bonjour'],
          wordTranslations: { bonjour: 'hello' },
          swapWords: ['bonjour'],
        },
      },
    ];
    const b = resumeBubblesFromEvents(events)[0]!;
    expect(b.practiceText).toBe('Bonjour, mon ami.');
    expect(b.complexWords).toEqual(['bonjour']);
    expect(b).not.toHaveProperty('swapWords');
  });
});
