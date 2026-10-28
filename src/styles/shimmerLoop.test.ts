import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LIFE-BACKDROP-19 — every looping background-position shimmer travels a WHOLE
 * number of tiles.
 *
 * A percentage `background-position` resolves against (container − image), not
 * against the container, so how far a given ΔP moves the gradient depends on
 * `background-size`. For a size of S container-widths the travel is
 *
 *     ΔP/100 × (S − 1)   container widths
 *
 * and the loop only rejoins itself when that is an exact multiple of the tile
 * width S. `shimmerGradient` (ΔP = 400) satisfies this at S = 2 — 2 tiles —
 * which is why every 200% shimmer in the file looks continuous. The scene
 * "building" veil is S = 2.5, where ΔP = 400 is 2.4 tiles: the last 0.4 of a
 * tile was thrown away on every wrap, and the sheen visibly restarted once per
 * cycle (owner, 2026-08-01, on the planet placeholder).
 *
 * Asserted against the STYLESHEET rather than a render: jsdom computes no
 * animation, and the bug is arithmetic between two declarations that live in
 * different places in the file. A rule paired with the wrong keyframe is
 * exactly what a reviewer cannot see.
 */

// `import.meta.url` is a vite:// URL under the app vitest project, so resolve
// off the repo root instead.
const CSS = readFileSync(
  path.join(process.cwd(), 'src/styles/globals.css'),
  'utf8',
);

/** Start/end `background-position` percentages of a `@keyframes` block. */
function keyframeTravel(name: string): number | null {
  const block = new RegExp(
    `@keyframes\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`,
    'm',
  ).exec(CSS);
  if (!block) return null;
  const positions = [
    ...block[1]!.matchAll(/background-position:\s*(-?[\d.]+)%/g),
  ].map((m) => Number(m[1]));
  if (positions.length < 2) return null;
  return Math.abs(positions[0]! - positions[positions.length - 1]!);
}

/** Every rule that pairs a `background-size: N% 100%` with an animation. */
function shimmerRules(): { selector: string; size: number; anim: string }[] {
  const out: { selector: string; size: number; anim: string }[] = [];
  for (const m of CSS.matchAll(/(\.[\w-]+)\s*\{([\s\S]*?)\n\s*\}/g)) {
    const body = m[2]!;
    const size = /background-size:\s*([\d.]+)%\s+100%/.exec(body);
    const anim = /animation:\s*([\w-]+)\s/.exec(body);
    if (size && anim) {
      out.push({ selector: m[1]!, size: Number(size[1]), anim: anim[1]! });
    }
  }
  return out;
}

describe('LIFE-BACKDROP-19 — shimmer loops rejoin themselves', () => {
  const rules = shimmerRules();

  it('finds the shimmer utilities at all (the parse still matches the file)', () => {
    // A regex that silently matches nothing would make every check below pass.
    expect(rules.length).toBeGreaterThanOrEqual(4);
    expect(rules.map((r) => r.selector)).toContain('.life-scene-building');
  });

  it.each(rules)(
    '$selector travels a whole number of tiles ($anim @ $size%)',
    ({ selector, size, anim }) => {
      const deltaP = keyframeTravel(anim);
      expect(deltaP, `no @keyframes ${anim} with two positions`).not.toBeNull();
      const S = size / 100;
      const tiles = (deltaP! / 100) * (S - 1) / S;
      expect(
        Math.abs(tiles - Math.round(tiles)),
        `${selector}: ${anim} moves ${tiles} tiles at background-size ${size}% — a fractional tile is a visible snap at the loop boundary`,
      ).toBeLessThan(1e-9);
    },
  );

  it('rejects the pairing that caused the report', () => {
    // The guard on the guard: .life-scene-building on the SHARED keyframe is
    // what shipped, and the check above must fail for it.
    const shared = keyframeTravel('shimmerGradient')!;
    const S = 2.5;
    const tiles = (shared / 100) * (S - 1) / S;
    expect(Number.isInteger(tiles)).toBe(false);
  });
});

/**
 * LIFE-BACKDROP-19 (pace) — the building-wurld sheen is SLOW.
 *
 * Owner, 2026-08-01: "shimmer on a building wurld scene is too quick." It
 * sweeps a full-bleed scene rather than a 200px skeleton chip, so the same
 * angular speed reads as urgent — and what it signals is a 5-8s generation the
 * player is meant to wait calmly through.
 */
describe('LIFE-BACKDROP-19 — the scene sheen is paced for a full-bleed image', () => {
  const durationOf = (selector: string): number | null => {
    const rule = new RegExp(
      `\\${selector}\\s*\\{[^}]*animation:\\s*[\\w-]+\\s+([\\d.]+)s`,
    ).exec(CSS);
    return rule ? Number(rule[1]) : null;
  };

  it('sweeps more slowly than the small skeleton shimmers', () => {
    const scene = durationOf('.life-scene-building');
    const chip = durationOf('.skeleton-chip');
    expect(scene, 'no .life-scene-building duration').not.toBeNull();
    expect(chip, 'no .skeleton-chip duration').not.toBeNull();
    // A relationship, not a magic number: the rule is "slower than a chip
    // because it is bigger", which survives a later re-tune of either.
    expect(scene!).toBeGreaterThan(chip!);
  });

  it('is slower than the 2.4s that was reported as too quick', () => {
    expect(durationOf('.life-scene-building')!).toBeGreaterThan(2.4);
  });
});
