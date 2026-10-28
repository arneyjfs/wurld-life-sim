import { describe, it, expect } from 'vitest';
import {
  descriptorCacheKey,
  pickFallback,
  type BackdropDescriptor,
} from './backdropDescriptor';

const descriptor = (
  partial: Partial<BackdropDescriptor> & Pick<BackdropDescriptor, 'locationType' | 'vibe'>,
): BackdropDescriptor => ({
  persistent: true,
  ...partial,
});

describe('descriptorCacheKey — LIFE-BACKDROP-2', () => {
  it('emits a stable lowercase snake-case key', () => {
    expect(
      descriptorCacheKey(descriptor({ locationType: 'Fruit Market', vibe: 'Modern City' })),
    ).toBe('fruit_market::modern_city');
  });

  it('strips disallowed characters, but FOLDS accented letters (LIFE-BACKDROP-28)', () => {
    // Was `cafbar` — this test encoded the defect. Punctuation is still
    // stripped; an accented LETTER now keeps its base form, which is what the
    // function's own doc comment always claimed it did.
    expect(
      descriptorCacheKey(descriptor({ locationType: 'café/bar!', vibe: 'noir-city' })),
    ).toBe('cafebar::noircity');
  });

  it('treats whitespace + casing as the same key', () => {
    const a = descriptorCacheKey(descriptor({ locationType: 'office', vibe: 'modern' }));
    const b = descriptorCacheKey(descriptor({ locationType: '  OFFICE  ', vibe: 'MODERN' }));
    expect(a).toBe(b);
  });

  it('IGNORES the optional flavour field — same key regardless', () => {
    const dayCafe = descriptor({ locationType: 'cafe', vibe: 'modern', flavour: 'bustling' });
    const nightCafe = descriptor({ locationType: 'cafe', vibe: 'modern', flavour: 'quiet' });
    expect(descriptorCacheKey(dayCafe)).toBe(descriptorCacheKey(nightCafe));
  });

  it('falls back to "unknown" when a field is empty', () => {
    expect(descriptorCacheKey(descriptor({ locationType: '', vibe: '' }))).toBe(
      'unknown::unknown',
    );
  });
});

describe('pickFallback — LIFE-BACKDROP-7/8', () => {
  it('returns the exact match when the locationType is in the registry', () => {
    expect(pickFallback(descriptor({ locationType: 'cafe', vibe: 'modern' }))).toBe('cafe');
    expect(pickFallback(descriptor({ locationType: 'office', vibe: 'modern' }))).toBe('office');
  });

  it('returns the mapped equivalent for synonyms', () => {
    expect(pickFallback(descriptor({ locationType: 'coffee_shop', vibe: 'modern' }))).toBe(
      'cafe',
    );
    expect(pickFallback(descriptor({ locationType: 'metro_station', vibe: 'modern' }))).toBe(
      'train_station',
    );
  });

  it('matches by compound substring for unknown variants', () => {
    expect(
      pickFallback(descriptor({ locationType: 'fruit_market_outdoor', vibe: 'modern' })),
    ).toBe('market');
    expect(pickFallback(descriptor({ locationType: 'shared_office', vibe: 'modern' }))).toBe(
      'office',
    );
  });

  it('falls back to apartment_bedroom for completely unrecognised types', () => {
    expect(
      pickFallback(descriptor({ locationType: 'crystalline_caverns', vibe: 'fantasy' })),
    ).toBe('apartment_bedroom');
  });
});

describe('LIFE-BACKDROP-28 — accents FOLD, they do not vanish', () => {
  /**
   * Found 2026-08-09 comparing against the v2 engine branch, which hit it
   * independently. `SAFE` is `/[^a-z0-9_]/g` and runs AFTER `toLowerCase`, so
   * every accented character was DELETED rather than folded: `café` → `caf`,
   * `Bibliothèque` → `bibliothque`.
   *
   * THE HONEST SCOPE, measured before writing the fix rather than after. The v2
   * note frames this as "every French world gets the generic bedroom
   * silhouette", and OUR data does not support that: `pickFallback` reads
   * `locationType`, and across the archive's 12 distinct locationTypes ZERO
   * carry a non-ASCII character — the model writes them in English snake_case
   * (`attic`, `repair_shed`, `post_office`). The bedroom path needs a LOCALISED
   * locationType, which we do not currently produce.
   *
   * Where it does bite is `descriptorCacheKey`, which reads the LABEL: 25 of
   * 281 archived labels (9%) carry an accent — `Café de la Place`, `The
   * workshop of Elías`. Those keys were mangled, and `Café`/`Cafe` (the model
   * writes both) minted two keys and two paid backdrop generations for one
   * place. Folding fixes that and is the reason to ship this.
   *
   * The module's doc comment was also wrong about its own output — it claimed
   * `biblioth_que_municipale` where the code returned `bibliothque_municipale`.
   * A comment describing behaviour the code never had is how this survived
   * being read.
   */
  const d = (locationType: string): BackdropDescriptor =>
    ({ locationType, vibe: 'warm', persistent: true }) as BackdropDescriptor;

  it('an accented label and its bare form share ONE cache key', () => {
    // The measured win: one place, one key, one paid generation.
    expect(descriptorCacheKey(descriptor({ locationType: 'cafe', vibe: 'noir', label: 'Café de la Place' })))
      .toBe(descriptorCacheKey(descriptor({ locationType: 'cafe', vibe: 'noir', label: 'Cafe de la Place' })));
  });

  it('the folded key keeps the LETTER, not a hole', () => {
    expect(descriptorCacheKey(descriptor({ locationType: 'café', vibe: 'noir' })))
      .toContain('cafe');
  });

  it('a localised locationType now resolves instead of falling to the bedroom', () => {
    // Not currently produced (see scope note) — this is the guard for the day
    // the prompt starts emitting localised types, which is a one-word change.
    expect(pickFallback(d('café'))).toBe('cafe');
  });

  it('unaccented types are untouched — this is a fold, not a rewrite', () => {
    expect(pickFallback(d('cafe'))).toBe('cafe');
    expect(pickFallback(d('train_station'))).toBe('train_station');
  });

  it('a genuinely unknown place still falls back to the bedroom', () => {
    expect(pickFallback(d('observatoire'))).toBe('apartment_bedroom');
  });
});
