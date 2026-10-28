/**
 * LIFE-BACKDROP-2: backdrop descriptor + cache-key normalisation.
 *
 * A descriptor names a location in a way the cache + the
 * SVG-gen prompt both understand. The cache key derived from it
 * MUST be stable across calls — same descriptor → same key →
 * same SVG.
 *
 * The per-world prefix is added at the call site (we don't have
 * the world doc here); this module only normalises the descriptor
 * → string part of the key.
 *
 * Spec: docs/specs/life-sim.md §6.
 */

/** Shape returned by the step generator's `backdropIntent` field. */
export type BackdropDescriptor = {
  /** Snake-cased location category (e.g. "fruit_market", "office_kitchen"). */
  locationType: string;
  /** Worldseed-adjacent vibe modifier — kept short ("modern_city",
   *  "medieval_village", "noir_city", "frontier_colony"). Allows the
   *  same `cafe` to look very different in a medieval vs a sci-fi
   *  world. */
  vibe: string;
  /** Whether this descriptor should be persisted past the current
   *  beat. Persistent = cached + returned to. Transient = render
   *  fresh, never cached. */
  persistent: boolean;
  /** Human-readable name of the place ("Bibliothèque Municipale",
   *  "Le Bateleur Café"). When present, the normalised label is the
   *  primary cache-key component — two libraries with different
   *  names get different SVGs. Without a label, the cache key falls
   *  back to locationType + vibe. */
  label?: string;
  /** Optional free-form details the gen prompt may use but that
   *  DO NOT participate in the cache key (e.g. "bustling", "rainy").
   *  Same cafe-by-night and cafe-by-day should still match a single
   *  cache entry — time-of-day is a CSS overlay, not a separate
   *  backdrop. */
  flavour?: string;
  /** LIFE-TIME-1: the world clock at generation time. Like `flavour` it is NOT
   *  part of the cache key — one SVG per place, re-skinned by time, which is
   *  the whole reason the backdrop SI's rule 12
   *  (`functions/src/prompts/lifeBackdrop.ts`) tags `sky` / `lighting` /
   *  `lamp` / `shadow`. It IS passed to the generator so the SVG is drawn lit
   *  for the hour it was first seen at, rather than for whatever mood the vibe
   *  implied. */
  timeOfDay?: TimeOfDay;
};

import type { TimeOfDay } from '@/types/lifeState';

const SAFE = /[^a-z0-9_]/g;

/**
 * LIFE-BACKDROP-28 — FOLD accents, don't delete them.
 *
 * `SAFE` is `/[^a-z0-9_]/g` and runs after `toLowerCase`, so before this fix
 * every accented character was DELETED rather than folded: `café` → `caf`,
 * `Bibliothèque` → `bibliothque`. NFD splits a letter from its combining mark;
 * the range strips the marks and leaves the base letter.
 *
 * WHERE IT ACTUALLY BIT, measured before the fix rather than assumed. The v2
 * branch (which hit this independently) frames it as the FALLBACK silhouette —
 * `café` matching no `FALLBACK_MAP` key and landing on `apartment_bedroom`. Our
 * data does not support that: `pickFallback` reads `locationType`, and across
 * the archive's 12 distinct locationTypes ZERO carry a non-ASCII character —
 * the model writes them in English snake_case (`attic`, `repair_shed`).
 *
 * It bit the CACHE KEY, which reads the LABEL: 25 of 281 archived labels (9%)
 * are accented — `Café de la Place`, `The workshop of Elías`. The model writes
 * both `Café` and `Cafe` for one place, and those minted two keys and two PAID
 * backdrop generations. Folding collapses them to one.
 *
 * ONE-TIME COST, stated because it is real: an existing world whose label
 * carries an accent gets a new key and regenerates its backdrop once. Cheaper
 * than keeping two normalisers, which is the shape that drifts.
 */
function normaliseToken(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '_')
    .replace(SAFE, '');
}

/** Returns the descriptor portion of the cache key — the call site
 *  prepends the `worldId::` prefix.
 *
 *  Primary key: the normalised place label ("Bibliothèque Municipale"
 *  → "bibliotheque_municipale", LIFE-BACKDROP-28). Two named places never collide even
 *  when they share locationType + vibe. Resume hits the cache because
 *  the same label always produces the same key.
 *
 *  Legacy fallback (no label): locationType + vibe. Mostly affects
 *  backdrops generated before `label` was added to the descriptor.
 *  `flavour` is intentionally NOT part of the key so cosmetic
 *  variants ("bustling", "rainy") reuse one SVG. */
export function descriptorCacheKey(d: BackdropDescriptor): string {
  const label = d.label ? normaliseToken(d.label) : '';
  if (label) return label;
  const loc = normaliseToken(d.locationType) || 'unknown';
  const vibe = normaliseToken(d.vibe) || 'unknown';
  return `${loc}::${vibe}`;
}

/** Best-effort guess at which fallback silhouette to show for a
 *  descriptor when SVG gen is in-flight or has failed. Falls back
 *  to `apartment_bedroom` for unrecognised types so the screen
 *  never renders blank. */
const FALLBACK_MAP: Record<string, string> = {
  apartment_bedroom: 'apartment_bedroom',
  apartment_living: 'apartment_living',
  bedroom: 'apartment_bedroom',
  living_room: 'apartment_living',
  cafe: 'cafe',
  coffee_shop: 'cafe',
  market: 'market',
  fruit_market: 'market',
  office: 'office',
  workplace: 'office',
  street: 'street',
  road: 'street',
  park: 'park',
  garden: 'park',
  train_station: 'train_station',
  metro_station: 'train_station',
  station: 'train_station',
};

export type FallbackKey =
  | 'apartment_bedroom'
  | 'apartment_living'
  | 'cafe'
  | 'market'
  | 'office'
  | 'street'
  | 'park'
  | 'train_station';

export function pickFallback(d: BackdropDescriptor): FallbackKey {
  const loc = normaliseToken(d.locationType);
  const mapped = FALLBACK_MAP[loc];
  if (mapped) return mapped as FallbackKey;
  // Match by prefix for compound types we haven't explicitly
  // listed (`fruit_market_outdoor` → `market`).
  for (const [key, value] of Object.entries(FALLBACK_MAP)) {
    if (loc.startsWith(key) || loc.includes(`_${key}`) || loc.endsWith(`_${key}`)) {
      return value as FallbackKey;
    }
  }
  return 'apartment_bedroom';
}
