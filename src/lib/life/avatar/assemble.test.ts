import { describe, it, expect } from 'vitest';
import { assembleAvatar, ZAvatarParams } from './assemble';
import { HAIR, OPTIONS } from './parts';

describe('assembleAvatar — LIFE-NPC-2', () => {
  it('assembles a complete SVG from valid params', () => {
    const { svg, errors } = assembleAvatar({
      bg: '#eee',
      skin: '#f2c6a0',
      hair: { style: 'longStraight', color: '#3a2b4d' },
      headwear: { style: 'witchHat', color: '#4a2a6b' },
      outfit: { style: 'robe', color: '#2e2140' },
      mouth: 'smirk',
      eyes: 'almond',
    });
    expect(errors).toEqual([]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('viewBox="0 0 200 200"');
    expect(svg).toContain('#4a2a6b'); // the hat colour made it through
  });

  it('renders with NO params (every slot falls back to a default)', () => {
    const { svg, errors } = assembleAvatar({});
    expect(errors).toEqual([]);
    expect(svg).toContain('<svg');
  });

  it('returns null + the offending slot when a part name is unknown', () => {
    const { svg, errors } = assembleAvatar({ hair: { style: 'notAStyle' } });
    expect(svg).toBeNull();
    expect(errors).toContain('hair=notAStyle');
  });

  it('collects EVERY unknown slot so the log names them all', () => {
    const { svg, errors } = assembleAvatar({
      hair: { style: 'nope' },
      outfit: { style: 'alsoNope' },
    });
    expect(svg).toBeNull();
    expect(errors).toEqual(expect.arrayContaining(['hair=nope', 'outfit=alsoNope']));
  });

  it('every advertised option actually assembles (the prompt only offers real parts)', () => {
    for (const style of OPTIONS.hair) {
      expect(assembleAvatar({ hair: { style } }).svg, `hair=${style}`).toBeTruthy();
    }
    for (const style of OPTIONS.headwear) {
      expect(assembleAvatar({ headwear: { style } }).svg, `headwear=${style}`).toBeTruthy();
    }
    for (const style of OPTIONS.outfit) {
      expect(assembleAvatar({ outfit: { style } }).svg, `outfit=${style}`).toBeTruthy();
    }
    for (const style of OPTIONS.facialHair) {
      expect(assembleAvatar({ facialHair: { style } }).svg, `facialHair=${style}`).toBeTruthy();
    }
    for (const v of OPTIONS.eyes) expect(assembleAvatar({ eyes: v }).svg, `eyes=${v}`).toBeTruthy();
    for (const v of OPTIONS.brows) expect(assembleAvatar({ brows: v }).svg, `brows=${v}`).toBeTruthy();
    for (const v of OPTIONS.mouth) expect(assembleAvatar({ mouth: v }).svg, `mouth=${v}`).toBeTruthy();
    for (const v of OPTIONS.accessory) expect(assembleAvatar({ accessory: v }).svg, `accessory=${v}`).toBeTruthy();
  });
});

describe('ZAvatarParams — LIFE-NPC-2', () => {
  it('parses a normal params payload', () => {
    const r = ZAvatarParams.safeParse({
      skin: '#f2c6a0',
      hair: { style: 'short', color: '#6b4a2f' },
      eyes: 'almond',
    });
    expect(r.success).toBe(true);
  });

  it('parses the explicit fallback signal', () => {
    const r = ZAvatarParams.safeParse({ fallback: true });
    expect(r.success).toBe(true);
    expect(r.success && r.data.fallback).toBe(true);
  });

  it('rejects a non-hex colour (a malformed colour must not reach the SVG)', () => {
    expect(ZAvatarParams.safeParse({ skin: 'red' }).success).toBe(false);
    expect(ZAvatarParams.safeParse({ hair: { style: 'short', color: 'brown' } }).success).toBe(false);
  });
});

/**
 * LIFE-NPC-2c: layer-containment invariants. Every one of these encodes a
 * defect that actually shipped and was visible on screen — the parts are only
 * "fine" at 84px, so these assert the composition rules rather than pixels.
 */
describe('LIFE-NPC-2c — layer containment', () => {
  const SKIN = '#f2c6a0';

  it('the skin torso uses the EXACT garment silhouette (no skin above any collar)', () => {
    // The torso leaked 2px above every outfit when the two paths drifted apart.
    const torsoD = /<path d="(M 18 200[^"]*)" fill="#f2c6a0"/.exec(
      assembleAvatar({ skin: SKIN, outfit: { style: 'plain', color: '#b9c0d6' } }).svg ?? '',
    );
    const shoulderPath = torsoD?.[1];
    expect(shoulderPath, 'skin torso must render on the shared shoulder path').toBeTruthy();
    for (const style of OPTIONS.outfit) {
      const svg = assembleAvatar({ skin: SKIN, outfit: { style, color: '#b9c0d6' } }).svg ?? '';
      expect(svg.includes(shoulderPath ?? ''), `outfit=${style} must sit on the shared shoulder path`).toBe(true);
    }
  });

  it('every open-collar garment shows SKIN in the collar, not a garment shade', () => {
    // "Neck behind the hoodie": the collar scoop was painted in garment colour.
    for (const style of ['plain', 'tee', 'sweater', 'hoodie', 'dress', 'cloak', 'scarf']) {
      const svg = assembleAvatar({ skin: SKIN, outfit: { style, color: '#b9c0d6' } }).svg ?? '';
      const afterTorso = svg.slice(svg.lastIndexOf('M 18 200'));
      expect(afterTorso.includes(SKIN), `outfit=${style} collar must expose the neck`).toBe(true);
    }
  });

  it('the hoodie hangs its hood BEHIND the head so the neck sits inside it', () => {
    const svg = assembleAvatar({ skin: SKIN, outfit: { style: 'hoodie', color: '#1c1c22' } }).svg ?? '';
    expect(svg.indexOf('#181820')).toBeLessThan(svg.indexOf('M 18 200'));
  });

  it('enclosing headwear suppresses the hair entirely (nothing bursts out of a hood)', () => {
    for (const hw of ['hood', 'helmet']) {
      for (const style of ['afro', 'dreads', 'braids', 'spiky', 'longStraight']) {
        const svg = assembleAvatar({
          hair: { style, color: '#6b4a2f' }, headwear: { style: hw, color: '#7c6ff0' },
        }).svg ?? '';
        expect(svg.includes('#6b4a2f'), `${style} must be hidden under ${hw}`).toBe(false);
      }
    }
  });

  it('tall hair does not skewer a domed hat', () => {
    for (const style of ['spiky', 'mohawk', 'dreads', 'topKnot']) {
      const front = HAIR[style]?.('#6b4a2f').front ?? '';
      expect(front, `${style} must have a front mass to suppress`).toBeTruthy();
      const hatted = assembleAvatar({
        hair: { style, color: '#6b4a2f' }, headwear: { style: 'beanie', color: '#7c6ff0' },
      }).svg ?? '';
      expect(hatted.includes(front), `${style} front mass must be dropped under a beanie`).toBe(false);
    }
  });
});
