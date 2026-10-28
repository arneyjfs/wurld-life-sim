/**
 * LIFE-ONBOARD-6 / LIFE-ARCH-3 — the character-bio system instruction and user
 * prompt.
 *
 * Spec: docs/specs/life-sim.md.
 *
 * The bio is generated ONCE per world, immediately after `sagaOpen`, and lands
 * on `lifeWorld.bio` — where every later prompt reads it as the stable
 * character sheet. Failure is non-fatal: the world starts with a bare
 * `characterName` and the model invents context per turn.
 *
 * LIFE-ARCH-3: the `<saga>` block this used to open with is gone. It fed the
 * bio the synopsis — premise, centralConflict, antagonist, factions,
 * keyArchetypes, openThreads — none of which is generated any more. `<world>`
 * replaces it with the opening STATE, which is a better answer to the same
 * question anyway: the bio has to fit the world the player will actually walk
 * into, and `situation` + `cast` ARE that world.
 *
 * ── SRV-PROMPT-8..13 batch 6 ────────────────────────────────────────────────
 *
 * Moved here from `src/lib/life/prompts/bio.ts`, which is DELETED
 * (SRV-PROMPT-3). The client now sends `promptSpec: {kind:'life_bio', …}` and
 * `prompt: ''`; `resolveServerPrompt` validates the spec and builds both halves
 * from here.
 *
 * ⚠ BATCH 6 AND NOT EARLIER, BECAUSE ITS INPUT IS BATCH 5'S OUTPUT. `story` is
 * the `title` / `tone` / `situation` / `cast` / `fronts` that `runSagaOpen` has
 * just written. Where this spec and `LifeSagaOpenPromptSpec` describe the same
 * thing they AGREE rather than being designed twice:
 *
 *   `characterName`, `practiceLanguage`, `nativeLanguage`, `worldSeedKey`,
 *   `worldSeedText`, `worldMode` — the same six names and the same types,
 *   including `worldMode` as a CLOSED enum. ⚠ The client type had it as a bare
 *   `string`, and the builder branches `=== 'realistic'` — so any other value
 *   rendered as itself inside the mode line AND silently took the fantasy
 *   register. Narrowed on the wire; the rendering is unchanged.
 *   `story.cast[]` reuses the saga survivor's `name` / `known`, and
 *   `story.fronts[]` reuses `lifeWorldState`'s `agenda` / `resolved`.
 *
 * WHERE THEY DIVERGE, DELIBERATELY: there is no `worldId` (this prompt renders
 * no `<texture>`) and no `systemLanguage` (it reads `nativeLanguage`) — a field
 * that reaches nothing is a field someone later wires INTO something.
 *
 * ⚠ AND THE STORY IS NESTED, where the two SCENE specs carry `situation`,
 * `cast` and `fronts` flat. The `<world>` block renders as a UNIT — all of it or
 * none — so nesting makes a half-present world UNREPRESENTABLE instead of
 * merely rejected, which is the same argument `life_saga`'s `universe` makes for
 * being a payload rather than a flag.
 *
 * ── WHAT IS NARROWED, AND WHY IT MATTERS HERE ───────────────────────────────
 *
 * The call site holds whole `CastMember`s and `Front`s and this prompt reads
 * two fields off each. The spec carries only those. `Front.clock.consequence`
 * in particular is withheld from prompts by LIFE-FRONT-1.1 — a model handed
 * "3/6 → the bakery is sold" writes a countdown — so putting it on the wire
 * would be a spec violation as well as a proxy hole.
 *
 * ⚠ THE LIVE FILTER STAYS HERE. `fronts` travels whole and the server drops the
 * resolved ones, exactly as `renderWorldStory` does: which fronts the model sees
 * is a PROMPT RULE, and a client that filtered would be a second copy of one.
 *
 * ── NO SCHEMA, NO CACHE SLOT ────────────────────────────────────────────────
 *
 * NO `responseSchema`, before this batch and after it (SRV-PROMPT-11's shape).
 * The output contract is the JSON shape written into the system instruction and
 * `ZBio` defends against the answer. Adding one would be a behaviour change
 * rather than a migration — LIFE-WORLD-SAGA-10 measured that a model under a
 * schema drops non-required fields far more readily.
 *
 * NO `cacheSlot`, checked rather than assumed: the SI interpolates the practice
 * language, so it is not byte-constant across the population and a slot would
 * make every call a billed cache CREATE (PRACTICE-CACHE-1).
 * `explicitSiCache.ts`'s `SERVER_OWNED_SI` holds `life_backdrop` and nothing
 * else — read from the CODE, because LIFE-BACKDROP-14's prose is stale by
 * LIFE-BACKDROP-22's rename and has already misled one work brief. A bio also
 * fires once per world, orders below the ~5.8 calls/hour per distinct cache
 * flash-lite needs.
 *
 * ── SIZE (SRV-PROMPT-9) ─────────────────────────────────────────────────────
 *
 * Measured, see `__tests__/lifeBio.test.ts` for the fixtures. The biggest
 * payload the APP can send assembles to 6,621 B, 10.1% of `MAX_PROMPT_BYTES`;
 * the story-less arm is 3,622 B (5.5%). The cast is the only slope and it
 * crosses the cap at 125 members against a call site that can send 8 — the
 * saga's own response schema pins `principals` at 2-3 and `regulars` at 3-5,
 * and the bio runs once, immediately after it.
 */

/** One cast member, narrowed to what `<person>` renders. Deliberately not the
 *  app's `CastMember`: `tier`, `voice`, `standing`, `wants`, `nextMove`,
 *  `wrongAbout` and `ties` are read by other prompts, never by this one. */
export type BioStoryCastMember = {
  name: string;
  known: string;
};

/** One force in motion, narrowed to the two fields the block reads. `resolved`
 *  travels because the LIVE filter below is a PROMPT rule; the clock does not
 *  travel at all (LIFE-FRONT-1.1). Mirrors `WorldStoryFront` minus `driverId`,
 *  which `<force>` has no attribute for. */
export type BioStoryFront = {
  agenda: string;
  resolved?: string | null;
};

/** LIFE-ARCH-3: the world's opening STATE, from `sagaOpen`. Replaces the saga
 *  synopsis this prompt used to read — same job (the bio must fit the world),
 *  but sourced from what is TRUE rather than from what was planned. */
export type BioStory = {
  title: string;
  tone: string;
  situation: string;
  cast: readonly BioStoryCastMember[];
  fronts: readonly BioStoryFront[];
};

export type BioPromptInput = {
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  worldSeedKey: string;
  worldSeedText?: string;
  /** LIFE-ONBOARD-3: the register the player picked. Absent on legacy worlds. */
  worldMode?: "realistic" | "fantasy";
  /**
   * ⚠ `null` IS ACCEPTED HERE AND REJECTED ON THE WIRE, deliberately.
   *
   * The call site passes `null` when `sagaOpen` failed, and the builder has
   * always rendered nothing for it — that equivalence is asserted by the golden
   * (`story = null — identical to no story at all`) and is why the port can be
   * proved byte-identical at all. The SPEC validator refuses a null instead,
   * because on the wire the field's PRESENCE is the fork and two spellings of
   * absent is how one of them later stops being handled.
   */
  story?: BioStory | null;
};

export function bioSystemInstruction(practiceLanguage: string): string {
  return `You generate a rich character bio for a language-learning life simulator. The player will inhabit this character for many sessions; your job is to seed enough texture that the narrative has anchors to pull on.

Return ONE JSON object matching this schema:
{
  "people": [{ "name": string, "relationship": string, "oneLine": string }, ...],     // 2-5 recurring people in the player's life
  "job": string,                                                                       // 1-line current job/role
  "cityNeighborhood": string,                                                          // where they live / hang out
  "homeDescription": string,                                                           // 1-2 lines about their place
  "quirks": string[],                                                                  // 2-4 character details (hobbies, habits, taste)
  "currentSituation": string,                                                          // 1-2 lines about what's going on right now in their life
  "hooks": string[]                                                                    // 2-4 open threads / things they're anticipating or worried about
}

RULES:
- Pick names + cultural context appropriate to the practice language: ${practiceLanguage}.
- People should be VARIED — a close friend, a colleague or classmate, a family member, maybe a romantic interest or a quirky neighbour. Each should have a distinct personality in their oneLine.
- Quirks make the character specific: hobbies, food preferences, neuroses, talents.
- Hooks are STORY SEEDS the LLM will pull on across sessions. Make them concrete — a date, a person, an unresolved thing.
- Match the seed vibe. A magic_university world has different people + hooks than a city_life world.

THE WORLD (when a <world> block is present):
- The bio MUST agree with it. This character LIVES here, and the world was written first — where the two disagree, the world is right and the bio is wrong.
- The job must fit <situation> and the place it describes. If the world is a coastal village whose main employer is in trouble, the player holds a village job, not a consultant's — they live inside the problem rather than visiting it.
- "currentSituation" must be THIS character's version of <situation> — what THEY are doing while that is going on, in the same place, on the same day.
- <cast> lists people who ALREADY EXIST in this world. Do NOT re-invent them under new names: if the bio needs someone in a trade and the cast already has that person, it is the SAME person. You may add people the cast does not have.
- <inMotion> is what is already under way. The hooks are the player's PERSONAL stakes near it — the rent, a favour owed, a job that depends on it — never a restatement of the pressure itself.
- Return ONLY the JSON. No prose, no markdown fences.`;
}

export function buildBioPrompt(input: BioPromptInput): string {
  const seedDescription = input.worldSeedText
    ? `User's free-text seed: "${input.worldSeedText}"`
    : `Vibe key: ${input.worldSeedKey} (one of: city_life, studying_abroad, work_abroad, family_country, farm_life, retired_village, restaurant, local_team, hostel, magic_university, noir_detective, alien_invasion, frontier_colony, outlaw_trail, sea_voyage, pilgrim_town, heist, haunted_house, surprise).`;
  // LIFE-ONBOARD-3: the register the player picked. Only load-bearing
  // for 'surprise' and free-text seeds, whose keys carry none — but
  // stated unconditionally so the model never has to infer it.
  const modeLine = input.worldMode
    ? `World mode: ${input.worldMode} — ${
        input.worldMode === "realistic"
          ? "a life the player could plausibly live. No magic, no monsters, no speculative technology."
          : "heightened genre. Magic, other worlds, the far future and the supernatural are all in play."
      }`
    : "";
  const s = input.story;
  const cast = (s?.cast ?? [])
    .map((c) => `    <person name="${esc(c.name)}">${esc(c.known)}</person>`)
    .join("\n");
  // LIFE-FRONT-1.1 / LIFE-ARCH-3 — the LIVE filter, and `== null` on purpose:
  // absent, `undefined` and `null` are all live, and only a string resolves. It
  // matches `renderWorldStory`'s filter exactly, and batch 3 recorded what the
  // `=== null` mutation costs when no fixture leaves the field off.
  const inMotion = (s?.fronts ?? [])
    .filter((f) => f.resolved == null)
    .map((f) => `    <force>${esc(f.agenda)}</force>`)
    .join("\n");
  const worldBlock = s
    ? [
        `<world title="${esc(s.title)}" tone="${esc(s.tone)}">`,
        `  <situation>${esc(s.situation)}</situation>`,
        cast ? `  <cast>\n${cast}\n  </cast>` : "",
        inMotion ? `  <inMotion>\n${inMotion}\n  </inMotion>` : "",
        `</world>`,
        // ⚠ THIS ROW DOES NOTHING, AND IT IS PRESERVED. It was plainly meant to
        // leave a blank line between `</world>` and the instruction below, and
        // `.filter(Boolean)` drops it — so the two run together in every prompt
        // that has ever shipped. Byte-identity is this batch's contract and a
        // prompt-text change needs `npm run test:prompts` evidence, so it is
        // pinned by test rather than quietly corrected here.
        ``,
      ]
        .filter(Boolean)
        .join("\n")
    : "";

  return `${worldBlock}Generate a bio for ${input.characterName}, a ${input.practiceLanguage}-speaking character.
${seedDescription}${modeLine ? `\n${modeLine}` : ""}
Native language: ${input.nativeLanguage}.
Return ONLY the JSON.`;
}

/** ⚠ ONE escape for BOTH attributes and text nodes, unlike `lifeSagaOpen` and
 *  `lifeWorldState`, which split `esc` (escapes `"`) from `escT` (does not).
 *  The difference is observable only on a `"` inside a text node, which is
 *  exactly what a port reaching for the two-function idiom would have lost —
 *  so the golden fixture carries a quoted `<situation>`. */
function esc(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
