/**
 * The wurld SEED keys — which starting situation a world was created from.
 *
 * Extracted from `firestore.ts` when that file reached its 600-line cap
 * (LIFE-ONBOARD-12 added four). It is a genuinely separable list: nothing here
 * depends on the rest of the schema, and several modules key exhaustive
 * `Record<WorldSeedKey, …>` maps off it — `backdropDescriptorForLife`'s vibe map,
 * `WorldCard`'s label map — so those maps fail to COMPILE when a key is added
 * without them, which is how the four new ones were caught.
 *
 * `firestore.ts` re-exports both names, so every existing import site is
 * unchanged.
 *
 * LIFE-ONBOARD-17 (2026-08-05) reworked the whole list, and the KEYS were
 * renamed with it rather than left to drift from their labels — owner's call:
 * *"don't worry about firestore migration … we are not tied to this list or
 * existing wurlds."* A key that says `saints_relic` under a chip that says
 * "The pilgrim town" is the kind of small mismatch that makes every later
 * reader check twice. `magic_apprentice`→`magic_university`,
 * `saints_relic`→`pilgrim_town`, `work_secondment`→`work_abroad`,
 * `ancestral_roots`→`family_country`, `country_life`→`farm_life`.
 * Dropped entirely: `wandering_bard`, `last_train`, `backpacker_hostels` (all
 * built on MOVEMENT, which starves the recurring-cast machinery the canon
 * ledger depends on) and `just_moved_here` (folded into `city_life`).
 */
import { z } from 'zod';

export const ZWorldSeedKey = z.enum([
  // ── REALISTIC ────────────────────────────────────────────────────────────
  'city_life',
  'studying_abroad',
  // LIFE-ONBOARD-12 — seeds named for WHY someone is learning the language,
  // not just for a genre. A learner who recognises their own situation does
  // not have to translate it into one of ours first.
  'work_abroad',
  'family_country',
  'farm_life',
  'retired_village',
  // LIFE-ONBOARD-17 — three seeds chosen for a POPULATION the list had none
  // of, and for the engine's own requirements (below).
  'restaurant',
  'local_team',
  'hostel',
  // ── FANTASTIC ────────────────────────────────────────────────────────────
  'magic_university',
  'frontier_colony',
  'noir_detective',
  // LIFE-ONBOARD-13 — fantastic seeds each carrying a question the first
  // chapter can already start answering. A seed that is only a SETTING ("a
  // kingdom", "a spaceship") gives the saga generator a backdrop and no story,
  // which is how a world turns into pleasant nothing.
  'outlaw_trail',
  'sea_voyage',
  'pilgrim_town',
  // LIFE-ONBOARD-16 — the invasion. Same rule as LIFE-ONBOARD-13: the seed
  // carries a QUESTION, not just a spectacle. Aliens arriving is a backdrop;
  // "who do you believe, in a language you are still learning" is a story, and
  // it happens to be the situation every learner is already in. The chip HINT
  // stays a standing state of the world (LIFE-ONBOARD-14) — the question is
  // for the saga generator, not for the moment of choosing.
  'alien_invasion',
  'heist',
  'haunted_house',
  'surprise',
  'manual',
]);
export type WorldSeedKey = z.infer<typeof ZWorldSeedKey>;
