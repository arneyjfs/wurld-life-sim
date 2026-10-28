/**
 * LIFE-ONBOARD-17 — the chip's PROMISE has to reach the saga generator.
 *
 * The hints were rewritten to name what a universe makes possible rather than
 * what furniture is in it (owner, 2026-08-05: *"Although they can't give actual
 * plot, your descriptions can still give an idea of what's possible"*). That is
 * strictly better copy and it introduces a failure the old flat hints could not
 * have had: the chip can now SELL something the generator was never told about.
 * A player picks "The University of Magic" for the forbidden shelves, and the
 * saga comes back as a polite campus with an open library.
 *
 * Nothing structural prevents that — the chip hints and the seed-register table
 * are different files edited at different times, which is exactly the shape that
 * drifts (the same reasoning as the two `<alreadySpoken>` builders in
 * LIFE-SPEECH-6). So the pairing is asserted: every seed with a hint must have a
 * brief, and the load-bearing nouns of the hint must appear in it.
 *
 * This is a COVERAGE check, not a prose check. It cannot tell whether the brief
 * is good — only whether the promise reached it at all. That is the half worth
 * mechanising; the rest is judgement and belongs in the playthrough benchmark.
 *
 * ── WHY THIS FILE LIVES HERE NOW (SRV-PROMPT-3) ─────────────────────────────
 *
 * MOVED from `src/screens/LifeScreen/seedBriefCoverage.test.ts` when
 * SRV-PROMPT-8..13 batch 5 took `life_saga` server-side. It is the one test in
 * the repo that has to hold a CLIENT artefact and a SERVER one in the same hand:
 * the chip hints are `src/i18n/locales/en.ts` + `worldModes.ts` and always will
 * be (they are UI), while the seed-register brief is now
 * `functions/src/prompts/lifeSagaOpen.ts`. A test under `src/` cannot reach
 * across — `no-restricted-imports` bans the `../../../` hop — and a test under
 * `functions/` cannot resolve `@/`. `tests/playthrough/` can do both, which is
 * the same reason `serverPromptParity.test.ts` sits here.
 *
 * It did not die in the move and it did not get weaker: the assertions are
 * unchanged and the SI is the REAL built string, so a refactor that drops the
 * block still fails here. Retiring it would have left LIFE-ONBOARD-17 —
 * "the chip must not sell what the generator was never told about" — with
 * nothing asserting it at all.
 */
import { describe, expect, it } from 'vitest';
import { en } from '@/i18n/locales/en';
import { WORLD_MODES } from '@/screens/LifeScreen/worldModes';

const { sagaOpenSystemInstruction } = await import(
  '../../functions/src/prompts/lifeSagaOpen'
);

const strings = en as Record<string, string>;
const chipKeys = [...new Set(WORLD_MODES.flatMap((m) => m.chips.map((c) => c.key)))].filter(
  (k) => k !== 'surprise',
);

/** The whole system instruction, lower-cased once. The brief block is part of
 *  it, and reading the built string rather than the array means a refactor that
 *  drops the block from the instruction fails here too. */
const si = sagaOpenSystemInstruction({
  practiceLanguage: 'French',
  systemLanguage: 'English',
  succession: false,
  realistic: false,
}).toLowerCase();

/**
 * The load-bearing words of each hint — the thing a player would pick the chip
 * FOR. Deliberately hand-written rather than tokenised from the hint: "trams"
 * and "bunks" are colour, "forbidden" and "league table" are promises, and no
 * word-frequency rule tells those apart.
 */
const PROMISES: Record<string, string[]> = {
  city_life: ['tram', 'paperwork', 'neighbours'],
  studying_abroad: ['term', 'librar'],
  work_abroad: ['borrowed desk', 'return ticket'],
  family_country: ['surname'],
  farm_life: ['weather', 'animals', 'neighbours'],
  retired_village: ['garden', 'neighbours'],
  restaurant: ['service every night', 'suppliers', 'regulars'],
  local_team: ['training', 'league table', 'teammates'],
  hostel: ['staff recur', 'guests rotate'],
  magic_university: ['rivalries', 'romances', 'restricted', 'costs'],
  noir_detective: ['owes'],
  alien_invasion: ['ships in the sky', 'cordons', 'disagree'],
  frontier_colony: ['thin air', 'rationed light', 'charter'],
  outlaw_trail: ['dust', 'railhead', 'marshal', 'price on'],
  sea_voyage: ['captain nobody crosses twice', 'own arrangements'],
  pilgrim_town: ['bell towers', 'pilgrim money', 'relics', 'doubt'],
  heist: ['target', 'plan with too many steps', 'date that cannot move'],
  haunted_house: ['inherited', 'village', 'rooms nobody opens'],
};

describe('LIFE-ONBOARD-17 — every chip promise reaches the saga brief', () => {
  it('every chip key has a label and a hint', () => {
    for (const key of chipKeys) {
      expect(strings[`life.onboard.seed.chip.${key}`], `label for ${key}`).toBeTruthy();
      expect(strings[`life.onboard.seed.chip.${key}.hint`], `hint for ${key}`).toBeTruthy();
    }
  });

  it('every chip key is named in the seed-register block', () => {
    // Without this, a new chip silently inherits whatever the model guesses
    // from the key string — which is how `magic_apprentice` once produced a
    // coastal French town with a butcher and a bank.
    for (const key of chipKeys) {
      expect(si, `brief for ${key}`).toContain(`${key} →`);
    }
  });

  it('every promise the hint makes appears in that seed\'s brief', () => {
    const missing: string[] = [];
    for (const key of chipKeys) {
      for (const promise of PROMISES[key] ?? []) {
        if (!si.includes(promise.toLowerCase())) missing.push(`${key}: "${promise}"`);
      }
    }
    expect(missing, `promises sold on a chip but absent from the brief:\n${missing.join('\n')}`)
      .toEqual([]);
  });

  it('PROMISES covers every chip — a new seed cannot opt out of the check', () => {
    // A coverage check that a new key can skip by not appearing in the table is
    // the kind of guard that passes forever and catches nothing.
    for (const key of chipKeys) {
      expect(PROMISES[key], `no PROMISES entry for ${key}`).toBeTruthy();
      expect(PROMISES[key]!.length, `empty PROMISES entry for ${key}`).toBeGreaterThan(0);
    }
  });

  it('a retired seed key leaves nothing behind', () => {
    for (const dead of [
      'magic_apprentice', 'wandering_bard', 'last_train', 'saints_relic',
      'just_moved_here', 'backpacker_hostels', 'work_secondment', 'ancestral_roots',
      'country_life', 'drowned_court',
    ]) {
      expect(si, `retired key still in the brief: ${dead}`).not.toContain(`${dead} →`);
      expect(strings[`life.onboard.seed.chip.${dead}`], `retired label: ${dead}`).toBeUndefined();
    }
  });
});

/**
 * LIFE-ONBOARD-18 — `fantasy` is "a life you could not live today", and that
 * is NOT the same as "magic".
 *
 * `outlaw_trail` sits in the fantasy row because the player cannot live in the
 * 19th century, not because anything supernatural happens. The first run of it
 * came back a weird-west — *"your skin stinging from the mana-flecked wind"* —
 * which is a reasonable reading of a mode rule that said, in terms,
 * *"a fantasy world that turns out to be a village with no magic in it is a
 * bug"*. The model was obeying the instruction it was given.
 *
 * Owner: *"the cowboy scene should stay realistic without magic. only fantasy
 * as it's set in the past."* So the mode rule now defines fantasy by what the
 * player cannot LIVE rather than by what is impossible, and the seed carries an
 * explicit exemption. Both halves are asserted, because a later edit that
 * restores "fantasy means magic" would silently re-break the western.
 */
describe('LIFE-ONBOARD-18 — a period seed is fantasy without being magical', () => {
  it('the mode rule defines fantasy to include the historical past', () => {
    expect(si).toContain('historical past');
  });

  it('the mode rule states outright that magic is not compulsory', () => {
    expect(si).toContain('fantasy does not mean magic is compulsory');
  });

  it('the outlaw brief rules magic out in its own line', () => {
    // In the seed line itself, not only in the mode preamble: the brief is what
    // the model reads once it has identified the seed, and a rule that lives
    // only in the general section is one it can satisfy by not looking back.
    const line = si.split('\n').find((l) => l.includes('outlaw_trail →')) ?? '';
    expect(line, 'outlaw_trail brief').toContain('no magic');
    expect(line, 'outlaw_trail brief').toContain('past');
  });

  it('the magical seeds are NOT weakened by the exemption', () => {
    // The risk of loosening "fantasy means magic" is that the genuinely
    // magical seeds get quieter too. LIFE-ONBOARD-16's rule still has to bite.
    expect(si).toContain('if the seed says magic, the universe laws must be about magic');
  });
});
