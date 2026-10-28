/**
 * LIFE-ONBOARD-3/4 — the two KINDS of wurld, and which seed examples
 * belong to each.
 *
 * Replaces the old flat nine-chip grid (LIFE-ONBOARD-4, pre-2026-07-31).
 * The chips were always split down this line — the spec even said so
 * ("the first four are realistic … the next four are fantastic") — but
 * nothing in the UI said it out loud, so the split did no work: the
 * player had to infer the realism trade-off from a hint above a grid.
 * Naming the two modes puts the choice where the decision is made.
 *
 * `surprise` deliberately appears in BOTH lists. It is the one chip
 * whose key carries no register of its own, so it is the reason
 * `worldMode` has to be persisted rather than derived from the key.
 */
import type { WorldMode, WorldSeedKey } from '@/types/firestore';

/** Chip keys exclude 'manual' — that path is the free-text input. */
export type SeedChipKey = Exclude<WorldSeedKey, 'manual'>;

export type SeedChip = { key: SeedChipKey; emoji: string };

export type WorldModeDef = {
  mode: WorldMode;
  /** Seed chips shown while this mode is active, in render order. */
  chips: SeedChip[];
};

/**
 * LIFE-ONBOARD-15 — **fantasy leads and is the default**; realistic is second.
 *
 * Owner, 2026-08-01: *"Fantasy should be the default story type, realistic
 * second."* Realistic led because it is the safer-sounding option, but this is
 * the screen where a player decides what KIND of thing they are about to make,
 * and the fantastic row is what makes the product read as more than a chat
 * partner. A learner who wants the grounded version recognises it instantly
 * from the second segment; a learner who did not know the fantastic option
 * existed never goes looking for it.
 *
 * **This array is the ONLY order.** `LifeStartScreen` used to carry its own
 * `['realistic', 'fantasy']` literal for the toggle, so the two could disagree
 * — and did, the moment this one changed. It now maps over `WORLD_MODES`.
 */
export const WORLD_MODES: WorldModeDef[] = [
  {
    mode: 'fantasy',
    chips: [
      { key: 'magic_university', emoji: '🪄' },
      { key: 'noir_detective', emoji: '🕵️' },
      { key: 'alien_invasion', emoji: '🛸' },
      { key: 'frontier_colony', emoji: '🚀' },
      { key: 'sea_voyage', emoji: '⛵' },
      { key: 'pilgrim_town', emoji: '🕯️' },
      { key: 'outlaw_trail', emoji: '🤠' },
      { key: 'heist', emoji: '💎' },
      { key: 'haunted_house', emoji: '🏚️' },
      { key: 'surprise', emoji: '🎲' },
    ],
  },
  {
    mode: 'realistic',
    chips: [
      { key: 'city_life', emoji: '🏙️' },
      { key: 'studying_abroad', emoji: '🎓' },
      // LIFE-ONBOARD-12: the reasons people give for brushing up a language,
      // rather than four flavours of "somewhere abroad".
      { key: 'work_abroad', emoji: '💼' },
      { key: 'family_country', emoji: '🌳' },
      { key: 'farm_life', emoji: '🌾' },
      { key: 'retired_village', emoji: '🫖' },
      // LIFE-ONBOARD-17: a food seed, a sport seed and a travel seed, because
      // the list had no room for three large populations and because each one
      // gives the engine what it actually needs — a fixed cast, one place, and
      // a clock (service, the league table, the season).
      { key: 'restaurant', emoji: '🍲' },
      { key: 'local_team', emoji: '⚽' },
      { key: 'hostel', emoji: '🛏️' },
      { key: 'surprise', emoji: '🎲' },
    ],
  },
];

/** LIFE-ONBOARD-15: the FIRST entry, so the default and the render order
 *  cannot drift apart. */
export const DEFAULT_WORLD_MODE: WorldMode = WORLD_MODES[0]!.mode;

export function chipsForMode(mode: WorldMode): SeedChip[] {
  return WORLD_MODES.find((m) => m.mode === mode)?.chips ?? [];
}
