import { describe, expect, it } from 'vitest';
import { chipsForMode } from './worldModes';

/**
 * LIFE-ONBOARD-12 — the realistic row offers REASONS, not just settings.
 *
 * The original four ("city life", "studying abroad", "country life", "just
 * moved here") all name a place. Most learners arrive with a reason instead —
 * a posting, a family, a trip, a move made late — and had to translate that
 * into one of ours before they could start.
 */
describe('LIFE-ONBOARD-12 — reason-shaped realistic seeds', () => {
  const keys = chipsForMode('realistic').map((c) => c.key);

  it('offers the reason-shaped seeds alongside the original settings', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'work_abroad',
        'family_country',
        'retired_village',
      ]),
    );
  });

  it('keeps the settings-shaped seeds alongside them', () => {
    // LIFE-ONBOARD-17: `just_moved_here` folded into `city_life` (they asked
    // the same question twice) and `country_life` became `farm_life`, which
    // says countryside where the old name said nation — the exact confusion
    // it shared with `ancestral_roots`/`family_country`.
    expect(keys).toEqual(
      expect.arrayContaining(['city_life', 'studying_abroad', 'farm_life']),
    );
  });

  it('LIFE-ONBOARD-17 — carries the three population seeds the list had none of', () => {
    // Food, sport and travel. Each also gives the engine a fixed cast, one
    // home location and a clock, which is why these three and not others.
    expect(keys).toEqual(expect.arrayContaining(['restaurant', 'local_team', 'hostel']));
  });

  it('leaves surprise LAST, so the row still ends on the shrug', () => {
    expect(keys[keys.length - 1]).toBe('surprise');
  });

  it('adds none of them to fantasy — a secondment is not a genre', () => {
    const fantasy = chipsForMode('fantasy').map((c) => c.key);
    expect(fantasy).not.toContain('work_abroad');
    expect(fantasy).not.toContain('retired_village');
  });
});

/**
 * LIFE-ONBOARD-13 — the fantasy row is eight WORLDS, not four genres.
 *
 * Four genre labels gave the saga generator a category and no place.
 * `sea_voyage` replaced `cartographers_guild`, which named an occupation
 * rather than a world; a ship at sea is confined, hierarchical and long, so
 * mutiny and superstition arise from the setting instead of being seeded.
 */
describe('LIFE-ONBOARD-13 — the fantastic seeds', () => {
  const keys = chipsForMode('fantasy').map((c) => c.key);

  it('carries the four world-shaped seeds alongside the original genres', () => {
    expect(keys).toEqual(
      expect.arrayContaining(['sea_voyage', 'pilgrim_town', 'heist', 'haunted_house']),
    );
  });

  it('keeps the original four genres', () => {
    expect(keys).toEqual(
      expect.arrayContaining([
        'magic_university',
        'frontier_colony',
        'noir_detective',
        'outlaw_trail',
      ]),
    );
  });

  it('ends on surprise, like the realistic row', () => {
    expect(keys[keys.length - 1]).toBe('surprise');
  });

  it('gives every fantasy chip a distinct emoji — the row is scanned visually', () => {
    const emojis = chipsForMode('fantasy').map((c) => c.emoji);
    expect(new Set(emojis).size).toBe(emojis.length);
  });
});
