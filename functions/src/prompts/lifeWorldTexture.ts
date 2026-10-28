/**
 * LIFE-STORY-EXEMPLAR-2 — vary the CONTEXT per world, because varying the
 * WORDING has been measured not to work.
 *
 * THE DEFECT, reported 2026-08-07: *"This is not the first feature that is
 * heavily recycled. Before it was the same names everywhere and before that
 * the same cliches. What structurally is leading to lack in variation?"*
 *
 * The question deserves the measurement rather than a fourth round of wording.
 * Across the 56 distinct worlds in `.playthroughs/`, grouping cast names by how
 * the PROMPTS treat them:
 *
 *   used as a worked EXAMPLE      Sophie 1.8%   Marc 10.7%    Sabine 12.5%   Marcel 17.9%
 *   listed under <doNotReachFor>  Élodie 10.7%  Claire 16.1%  Luc 17.9%      Elena 17.9%
 *   never mentioned in any prompt Elara 12.5%   Hana 12.5%    Paco 14.3%     Lucía 19.6%
 *
 * One band, three treatments. A name the prompts demonstrate constantly is
 * RARER than names they explicitly forbid, and neither group separates from
 * names the prompts have never heard of. `LIFE-NPC-10` shipped BOTH of those
 * levers — it rewrote the worked examples and added the ban list — and the
 * numbers say neither moved anything.
 *
 * THAT IS THE STRUCTURAL ANSWER. Every world is generated from a context that
 * is, for this purpose, identical: same system instruction, same rules, same
 * seed table. A model handed the same context twice returns the same
 * distribution twice, and the one per-world signal that exists —
 * `<alreadyInThisWorld>` — is EMPTY at world creation, which is precisely the
 * call that chooses the cast and the places. So there is nothing in the system
 * that differs between world #1 and world #7, and asking more firmly inside a
 * constant context cannot produce variety. Only a DIFFERENT CONTEXT can.
 *
 * So each world draws a TEXTURE: one naming axis and one everyday-life axis,
 * picked deterministically from the world id. The model still chooses every
 * actual name and place — this does not hand it a list to copy, which would
 * only relocate the problem — but it chooses them from a different corner of
 * the space per world, and it never sees the other rows to average over.
 *
 * SAME SHAPE AS `voiceForSpeaker` (TTS-VOICE-2), deliberately: hash the stable
 * id, index a pool, and let determinism do the work a random seed cannot (a
 * world must read the same on every device and every reload).
 *
 * WHY THE AXES ARE PHRASED AS A LEAN, NOT A RULE. A hard requirement fights the
 * seed — "everything happens after dark" is wrong for `farm_life` — and a
 * mechanism that makes some worlds worse to make the set more varied is a bad
 * trade. Each axis is a bias the seed can overrule.
 *
 * ── SRV-PROMPT-8..13 batch 5 ────────────────────────────────────────────────
 *
 * MOVED WHOLE from `src/lib/life/worldTexture.ts`, which is DELETED. Verified
 * rather than assumed: `renderWorldTexture` had exactly ONE non-test consumer
 * (`prompts/sagaOpen.ts`), and `worldTexture` / `NAME_AXES` / `PLACE_AXES` had
 * none outside this module's own test. So there is no client copy and no parity
 * guard — a guard on one copy is worthless, and `serverPromptParity.test.ts`
 * asserts the deletion instead.
 *
 * ⚠ THE POOLS MAY NOT CROSS THE WIRE. They are PROMPT TEXT: a client that
 * supplied them could write arbitrary prose into a user prompt, which is the
 * hole this migration closes (batch 2 refused to ship the avatar part names for
 * the same reason). What travels is the `worldId` — an opaque string this file
 * only ever HASHES — so a caller can pick a row and cannot author one.
 */

/** FNV-1a, the same one `ttsVoices.ts` uses. Small, stable across engines, and
 *  good enough to spread ids over a pool of a dozen. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * How this world's people got their names.
 *
 * Every row is a SOURCE, not a list of names — the point is to move where the
 * model samples from, not to hand it eight names that become the next thing
 * reported as recycled. Rows are deliberately orthogonal to each other: the
 * generation, the origin, the register and the form of address are independent
 * dials, and landing on a different one changes the whole cast at once.
 */
export const NAME_AXES: readonly string[] = [
  'This world runs one generation OLDER than the obvious choice — the names here belong to the players\' parents and grandparents, not to people their own age.',
  'This world runs one generation YOUNGER — current, short, the names of people in their twenties, including a couple that older characters find faintly ridiculous.',
  'Several people here MOVED FROM SOMEWHERE ELSE, and their names came with them. At least a third of the cast carries a name that is not local to this setting, and nobody remarks on it.',
  'This is a place with a REGIONAL or minority language alongside the main one, and names come from it — the spellings look slightly unfamiliar to an outsider.',
  'People here are known by BY-NAMES: what they do, where they live, something that happened once. The given name exists but is rarely the thing anyone says.',
  'This world is FORMAL. People are addressed by surname, rank or title far more often than by first name, and being on first-name terms is information about a relationship.',
  'Names here are SHORTENED almost to the point of privacy — nicknames, initials, one syllable — and the full form only appears when somebody is in trouble.',
  'This setting sits at a CROSSROADS: two or three naming traditions in the same street, and which one a person carries says where their family stood.',
  'Names here carry WEIGHT — a family name that means something locally, a name reused down a line, a name somebody would rather not have. At least one person is named after somebody.',
  'This world names people PLAINLY and repeats itself: two characters share a name and have to be told apart by something else, which everyone finds normal.',
];

/**
 * What ordinary life in this world is BUILT AROUND.
 *
 * The `sagaOpen` rule this pairs with asks for ordinary, usable places without
 * naming any — this decides which KIND of ordinary. Measured motivation: in
 * `country_life` worlds the bakery appeared in 9 of 10, which is not a setting,
 * it is a reflex.
 */
export const PLACE_AXES: readonly string[] = [
  'Daily life here happens around WORK that does not stop — shifts, rounds, a thing that has to be done again tomorrow. The places that matter are the ones people are in because they have to be.',
  'This world is organised around WAITING. Queues, appointments, a service that runs to a timetable, somebody who decides who is seen next.',
  'Life here runs on WATER or the crossing of it — what has to get to the other side, who controls the way over, what happens when it is closed.',
  'This world happens mostly AFTER DARK, or in the hours nobody else is up. The daytime version of it is a different place with different people.',
  'The centre of life here is somewhere people EAT OR DRINK STANDING UP — quick, cheap, and the same faces every day. Deals and rumours move through it.',
  'This world is shaped by a ROUTE rather than a room: a road, a stair, a track, a corridor everyone uses and nobody owns, where people meet by accident.',
  'Life here is organised by a CALENDAR — a market day, a service, a season, a delivery — so what is possible depends on which day it is.',
  'The important places here are ones people are NOT supposed to be in: back rooms, the wrong side of a door, somewhere that is only unlocked for certain people.',
  'This world revolves around WEATHER or the land itself, which decides the week and cannot be argued with.',
  'Ordinary life here happens in places of STORAGE and repair — where things are kept, mended, stacked and lost. The people who know where anything is hold the real power.',
];

export type WorldTexture = { nameAxis: string; placeAxis: string };

/**
 * The texture for one world. Deterministic in `worldId` — the same world
 * always draws the same pair, so a reload, another device and a regenerated
 * saga all agree.
 *
 * The two axes are salted differently so they are independent: without the
 * salt, `nameAxis[i]` and `placeAxis[i]` would move together and ten pools of
 * ten would collapse to ten combinations instead of a hundred.
 */
export function worldTexture(worldId: string): WorldTexture {
  const id = worldId || 'world';
  return {
    nameAxis: NAME_AXES[hash(`name:${id}`) % NAME_AXES.length]!,
    placeAxis: PLACE_AXES[hash(`place:${id}`) % PLACE_AXES.length]!,
  };
}

/**
 * The `<texture>` block.
 *
 * ONE row of each pool, never the pool — a model shown the whole list averages
 * over it and lands back on the median world, which is the failure this exists
 * to fix.
 */
export function renderWorldTexture(worldId: string): string {
  const t = worldTexture(worldId);
  return [
    `<texture>`,
    `  <naming>${t.nameAxis}</naming>`,
    `  <everydayLife>${t.placeAxis}</everydayLife>`,
    `  <rule>These two are a LEAN for this particular world, not a checklist and not a plot. Let them decide the flavour of the names you pick and which ordinary places exist; do NOT announce them, and do NOT let them override the seed — where they and the seed disagree, the seed wins.</rule>`,
    `</texture>`,
  ].join('\n');
}
