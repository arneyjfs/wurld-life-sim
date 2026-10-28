/**
 * LIFE-BACKDROP-*: helpers that translate between the LifeWorld doc /
 * step `backdropIntent` and the descriptor shape the backdrop renderer
 * understands.
 *
 * Resume path: prefer `world.currentBackdrop` (persisted by commitNode
 * on every backdrop change). On the very first backdrop of a fresh world,
 * fall back to a worldseed-vibed apartment.
 *
 * NOTE (LIFE-BACKDROP-16): `fallbackDescriptor` is a GEN SEED, not something
 * the player is shown. Its `apartment_bedroom` used to reach the screen as
 * the pre-first-backdrop silhouette (paired with the `life.locationRibbon.
 * apartment` ribbon, "Your apartment · morning"); `BackdropStage` now paints
 * the planet placeholder and suppresses the ribbon until a real backdrop lands,
 * because both were guesses about a world that has not started. Changing the
 * locationType here will NOT change that placeholder — it only steers
 * `pickFallback` for the cache/thumbnail paths.
 */
import type { BackdropDescriptor } from '@/lib/life/backdropDescriptor';
import type { BackdropIntent } from '@/lib/life/stepSchema';
import type { LifeWorld, WorldSeedKey } from '@/types/firestore';

const SEED_VIBE: Record<WorldSeedKey, string> = {
  city_life: 'modern_city',
  studying_abroad: 'student_quarter',
  // LIFE-ONBOARD-12: the reason-shaped seeds. Each vibe names where the
  // person actually SPENDS their time, not the trip that brought them —
  // a posting happens in an office district, not on a plane.
  work_abroad: 'business_district',
  family_country: 'ancestral_village',
  farm_life: 'working_farm',
  retired_village: 'rural_countryside',
  // LIFE-ONBOARD-17: each of the three new realistic seeds has ONE home
  // location it keeps returning to — which is the point of them.
  restaurant: 'restaurant_kitchen',
  local_team: 'sports_ground',
  hostel: 'hostel_quarter',
  magic_university: 'magical_academy',
  noir_detective: 'noir_city',
  alien_invasion: 'occupied_city',
  frontier_colony: 'frontier_colony',
  sea_voyage: 'tall_ship_at_sea',
  pilgrim_town: 'old_cathedral_town',
  outlaw_trail: 'frontier_west_town',
  heist: 'heist_target_city',
  haunted_house: 'haunted_manor',
  surprise: 'modern_city',
  manual: 'manual_world',
};

export function fallbackDescriptor(world: LifeWorld): BackdropDescriptor {
  return {
    locationType: 'apartment_bedroom',
    vibe: SEED_VIBE[world.worldSeedKey] ?? 'modern_city',
    persistent: true,
  };
}

export function descriptorFromWorld(
  world: LifeWorld,
): BackdropDescriptor | null {
  const backdrop = world.currentBackdrop;
  if (!backdrop) return null;
  return {
    locationType: backdrop.locationType,
    vibe: backdrop.vibe,
    persistent: backdrop.persistent,
    label: backdrop.label,
    flavour: backdrop.flavour,
  };
}

export function descriptorFromIntent(intent: BackdropIntent): BackdropDescriptor {
  return {
    locationType: intent.locationType,
    vibe: intent.vibe,
    persistent: intent.persistent,
    label: intent.locationLabel,
    flavour: intent.flavour,
  };
}
