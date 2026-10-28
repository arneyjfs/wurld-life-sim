/**
 * LIFE-BACKDROP-27 — the location label is normalised in CODE.
 *
 * Two prompt rules already say it (`step.ts`: *"A PLACE ONLY — no time of
 * day"*; `playerKnowledge.ts`: *"do NOT append the hour to it"*), and a
 * production label still arrived as `Ton appartement · nuit`. A rule the model
 * can break with no consequence is not a mechanism — and this one costs more
 * than a cosmetic slip, because the label IS the backdrop cache key: a time
 * baked into it re-generates the same place once per hour of story time and
 * then contradicts the light on screen.
 */
import { describe, expect, it } from 'vitest';
import { normaliseLocationLabel } from './locationLabel';
import { ZBackdropIntent } from './stepSchema';

describe('LIFE-BACKDROP-27 — a time suffix is cut, not tolerated', () => {
  it('cuts the documented failure shape', () => {
    expect(normaliseLocationLabel('Ton appartement · nuit')).toBe('Ton appartement');
  });

  it('cuts regardless of the spacing around the dot', () => {
    for (const s of ['Le Vieux-Port·soir', 'Le Vieux-Port ·soir', 'Le Vieux-Port· soir']) {
      expect(normaliseLocationLabel(s)).toBe('Le Vieux-Port');
    }
  });

  it('cuts at the FIRST dot, so a two-suffix label loses both', () => {
    expect(normaliseLocationLabel('Le marché · quai nord · matin')).toBe('Le marché');
  });

  it('leaves a clean place name completely alone', () => {
    for (const s of ['Le Café de Flore', 'Chez Bébert', 'The Library of Scrolls', '和菓子屋']) {
      expect(normaliseLocationLabel(s)).toBe(s);
    }
  });

  it('keeps a hyphen, which is part of French place names', () => {
    expect(normaliseLocationLabel('Le Vieux-Port')).toBe('Le Vieux-Port');
  });
});

describe('LIFE-BACKDROP-27 — a label is a name, not a sentence', () => {
  it('strips a terminal full stop — a ribbon label never ends in one', () => {
    // MEASURED over 145 distinct archived labels: 2.8% were descriptions
    // rather than names, e.g. "Pedro's Hearth, a bakery that stays warm even
    // in the dead of winter." The trailing stop is the unambiguous half.
    expect(normaliseLocationLabel('Chez Bébert.')).toBe('Chez Bébert');
  });

  it('does NOT cut at a comma — "Pedro\'s Hearth, in the cellar" is a real place', () => {
    // Deliberate. A comma tail is sometimes a sub-location, which is a
    // DIFFERENT backdrop and must keep its own cache key. Only the separator
    // with no legitimate use is cut.
    expect(normaliseLocationLabel("Pedro's Hearth, in the cellar")).toBe(
      "Pedro's Hearth, in the cellar",
    );
  });

  it('collapses runs of whitespace and trims', () => {
    expect(normaliseLocationLabel('  Le   Vieux-Port  ')).toBe('Le Vieux-Port');
  });
});

describe('LIFE-BACKDROP-27 — never returns something worse than it got', () => {
  it('a label that is ONLY a time survives rather than becoming empty', () => {
    // Cutting would leave '', which the ribbon renders as a blank pill and the
    // cache keys as the empty string — every timeless place colliding on one
    // entry. A bad label is recoverable; an empty one is not.
    expect(normaliseLocationLabel('· nuit')).toBe('· nuit');
  });

  it('handles the empty and whitespace cases without throwing', () => {
    expect(normaliseLocationLabel('')).toBe('');
    expect(normaliseLocationLabel('   ')).toBe('');
  });
});

/**
 * The WIRING. The helper being right is worth nothing if nothing calls it —
 * the LIFE-GRID-6 lesson from the same day, where a fully unit-tested
 * `gradeOptionSet` turned out to have no caller in `src` at all.
 */
describe('LIFE-BACKDROP-27 — the normalisation is wired into the schema', () => {
  const intent = (locationLabel: string, locationLabelNative?: string) =>
    ZBackdropIntent.parse({
      locationType: 'apartment',
      vibe: 'warm',
      persistent: true,
      locationLabel,
      ...(locationLabelNative ? { locationLabelNative } : {}),
    });

  it('every backdropIntent that parses has a cleaned label', () => {
    expect(intent('Ton appartement · nuit').locationLabel).toBe('Ton appartement');
  });

  it('the NATIVE label is cleaned too — it is the tap-to-reveal twin', () => {
    // LIFE-BACKDROP-26 shows this one on tap. A time suffix here is the same
    // staleness with an English face on it.
    expect(intent('Ton appartement · nuit', 'Your flat · night').locationLabelNative).toBe(
      'Your flat',
    );
  });

  it('a clean intent parses byte-identically', () => {
    expect(intent('Le Café de Flore').locationLabel).toBe('Le Café de Flore');
  });
});
