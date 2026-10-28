import { describe, it, expect } from 'vitest';
import {
  capSceneMemories,
  appendSceneMemory,
  MAX_BIO_SCENE_MEMORIES,
} from './bioMemory';

// The frozen character-sheet block that always leads the bio.
const BASE = ['<bio>', '  <job>Baker</job>', '  <neighborhood>Montmartre</neighborhood>', '</bio>'].join(
  '\n',
);

const mem = (i: number) =>
  `\n<completedScene title="Arc ${i}" ending="win">Outcome ${i}.</completedScene>`;

const withMemories = (n: number) =>
  BASE + Array.from({ length: n }, (_, i) => mem(i + 1)).join('');

const ccCount = (s: string) => (s.match(/<completedScene\b/g) ?? []).length;

describe('capSceneMemories — LIFE-SCENE-13', () => {
  it('returns a bio with NO memory tail unchanged (byte-identical)', () => {
    expect(capSceneMemories(BASE, 8)).toBe(BASE);
    expect(capSceneMemories('', 8)).toBe('');
  });

  it('leaves a below-cap tail byte-identical', () => {
    const bio = withMemories(3);
    expect(capSceneMemories(bio, 8)).toBe(bio);
  });

  it('leaves an exactly-at-cap tail byte-identical', () => {
    const bio = withMemories(8);
    expect(capSceneMemories(bio, 8)).toBe(bio);
  });

  it('drops the OLDEST entries above the cap, keeping the last N (byte-identical to a fresh re-append)', () => {
    const capped = capSceneMemories(withMemories(11), 8);
    expect(ccCount(capped)).toBe(8);
    expect(capped).toContain('Outcome 11.'); // newest kept
    expect(capped).toContain('Outcome 4.'); // boundary kept
    expect(capped).not.toContain('Outcome 3.'); // oldest dropped
    expect(capped).not.toContain('Outcome 1.');
    // Exactly what appending memories 4..11 onto the base would produce.
    expect(capped).toBe(
      BASE + Array.from({ length: 8 }, (_, i) => mem(i + 4)).join(''),
    );
  });

  it('preserves the base <bio> block verbatim when trimming', () => {
    const capped = capSceneMemories(withMemories(20), 5);
    expect(capped.startsWith(BASE + '\n<completedScene')).toBe(true);
    expect(ccCount(capped)).toBe(5);
  });

  it('is unambiguous when an outcome body contains an escaped angle bracket', () => {
    // `escapeText` turns `<` → `&lt;`, so a memory body can NEVER contain the
    // literal `\n<completedScene` marker — the split stays clean.
    const escMem = (i: number) =>
      `\n<completedScene title="Arc ${i}" ending="win">He said &lt;stop&gt; then left.</completedScene>`;
    const bio = BASE + [1, 2, 3].map(escMem).join('');
    const capped = capSceneMemories(bio, 2);
    expect(ccCount(capped)).toBe(2);
    expect(capped).toContain('Arc 3');
    expect(capped).not.toContain('Arc 1');
  });

  it('defaults max to MAX_BIO_SCENE_MEMORIES (8)', () => {
    const capped = capSceneMemories(withMemories(MAX_BIO_SCENE_MEMORIES + 3));
    expect(ccCount(capped)).toBe(MAX_BIO_SCENE_MEMORIES);
  });
});

describe('appendSceneMemory — LIFE-SCENE-13', () => {
  it('appends below the cap, preserving every entry', () => {
    expect(appendSceneMemory(withMemories(3), mem(4), 8)).toBe(withMemories(4));
  });

  it('appends AND drops the oldest when already at the cap', () => {
    const next = appendSceneMemory(withMemories(8), mem(9), 8);
    expect(ccCount(next)).toBe(8);
    expect(next).not.toContain('Outcome 1.'); // oldest dropped
    expect(next).toContain('Outcome 9.'); // newest kept
    expect(next).toBe(BASE + Array.from({ length: 8 }, (_, i) => mem(i + 2)).join(''));
  });

  it('handles a bio with NO tail yet (first memory ever)', () => {
    expect(appendSceneMemory(BASE, mem(1), 8)).toBe(withMemories(1));
  });
});
