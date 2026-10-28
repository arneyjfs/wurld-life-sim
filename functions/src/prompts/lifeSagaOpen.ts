/**
 * LIFE-ARCH-1/3 — the world's universe and its opening SITUATION.
 *
 * Spec: docs/specs/story-architecture.md §3.
 *
 * Replaces `worldSaga.ts`. The difference is the whole design in one sentence:
 * that prompt asked for a NOVEL SYNOPSIS — midpoint twist, climax, candidate
 * endings, a chapter plan — and this one is forbidden from stating any outcome
 * at all. It writes the first page and the cast list, and stops.
 *
 * WHY. `LIFE-STORY-STAGE-2` measured that a model handed the twist writes toward
 * the twist; the old design's answer was to WITHHOLD the pillars during a
 * world's first turns, which worked but left the pillars sitting in Firestore
 * waiting to leak. Not generating them is strictly better than hiding them.
 *
 * At world creation this emits the universe too (one call, not two — the
 * universe is immutable and only ever needs writing once). On SUCCESSION
 * (`LIFE-FRONT-5` closeout → a new saga in the same world) the universe is
 * passed IN and must not be re-invented.
 *
 * ── SRV-PROMPT-8..13 batch 5 ────────────────────────────────────────────────
 *
 * Moved here from `src/lib/life/prompts/sagaOpen.ts`, which is DELETED
 * (SRV-PROMPT-3). The client now sends `promptSpec: {kind:'life_saga', …}` and
 * `prompt: ''`; `resolveServerPrompt` validates the spec and builds all THREE
 * artefacts from here.
 *
 * ⚠ THREE, NOT TWO, AND THAT IS WHY THIS IS BATCH 5. `sagaOpenResponseSchema`
 * takes a flag, so this prompt is the case SRV-PROMPT-1 was written about:
 * *"prompt and schema are ONE artefact, and owning the prompt while trusting a
 * client-sent schema would leave the half that constrains the ANSWER in the
 * bundle."* The schema forks on whether the world already has a universe; the
 * PROMPT forks on the same bit, in the opposite direction — the SI that says
 * "the universe is FIXED, do not re-invent it" must be paired with the schema
 * that has no `universe` property to write it into.
 *
 * ⚠ SO THE FLAG IS DERIVED, NEVER SENT. `succession` is read off the spec's own
 * shape (`universe` present or absent) and `realistic` off `worldMode`, which
 * has to travel anyway because it is rendered into `<world mode="…">`. A
 * separate boolean beside either would be a SECOND COPY OF ONE FACT, and both
 * decide what the model is allowed to write: a caller could ask for the
 * succession schema with a new-world payload and get a world whose universe
 * nobody ever authors, or flip `realistic` and lift the consequence ceiling its
 * own world mode promises. Deriving makes the mismatch unrepresentable rather
 * than merely checked.
 *
 * ⚠ AND THE TEXTURE POOL STAYS HERE. `renderWorldTexture` moved whole
 * (`lifeWorldTexture.ts`) and the client sends only the `worldId` it hashes —
 * shipping the rendered block up would let a caller write arbitrary prose into a
 * user prompt, which is this migration's own hole reached from the other
 * direction (batch 2 refused to ship the avatar part names for the same reason).
 *
 * ── WHAT THE SPEC CARRIES, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 *
 * The client does NOT send a `LifeWorld`. `situation`, `canon`, `storyLog`,
 * `saga`, `currentArc`, `sagaHistory`, `fronts` and `cast` are all on the world
 * doc and none has ever been read here — this is the call that WRITES them.
 *
 * `universe` is the CALLER'S ARGUMENT, not a field off the world doc, and that
 * distinction is load-bearing: `runSagaOpen` takes succession as a parameter
 * because the world being opened is the one that has none yet. Reading it off
 * the doc would make every re-open of an existing world a succession by
 * accident — and that bit picks the response schema.
 *
 * `universe.figures` does not travel. The block below renders setting, era,
 * laws and places; a field on the wire that reaches nothing is a field someone
 * later wires INTO something.
 *
 * ── SIZE (SRV-PROMPT-9) ─────────────────────────────────────────────────────
 *
 * Measured, see `__tests__/lifeSagaOpen.test.ts` for the fixtures. The NEW-WORLD
 * arm — the only one any app call site reaches today — assembles to 21,165 B,
 * 32.3% of `MAX_PROMPT_BYTES`, and that is a CEILING rather than a sample: there
 * is no cast, no history and no universe on that arm. ⚠ Its two caller strings
 * (`characterName`, `worldSeedText`) are capped at 32 and 500 characters by the
 * ONBOARDING FORM and by nothing in `src/lib/`, so the ceiling is a UI ceiling.
 * The `too-large` check after assembly is the honest backstop — a seed text
 * would have to reach ~44 kB to reach it.
 *
 * The SUCCESSION arm is where the unbounded terms are. Its realistic maximum is
 * 30,565 B (46.6%); a deliberately harsher fixture — twice LIFE-CAST-3's
 * chapter-five cast AND every one-clause prose field at 400 characters — reaches
 * 52,552 B (80.2%), and crosses the cap at 87 surviving cast members. Recorded
 * rather than smoothed over. If it ever bites, the fix is a BYTE budget on the
 * rendered `<survivingCast>` block (the `LIFE-WORLD-ARC-7` shape), not a smaller
 * count.
 */
import { LEXICON_RULES } from "./lifeLexiconRules";
import { renderWorldTexture } from "./lifeWorldTexture";

/**
 * LIFE-FRONT-7 — chapter 1 carries no threat and no fast clock.
 *
 * ⚠ A DUPLICATE OF `src/lib/life/fronts.ts`'s constant, and it does NOT EXPIRE.
 * Unlike the lexicon rules this batch retired, the other copy is not another
 * PROMPT — it is `conformsToOpeningRule`, which `runSagaOpen` runs over the
 * model's answer. Engine code never migrates, so the two never re-converge; this
 * is the `DELTA_PER_FRONT` shape from batch 4, not the story-stage one.
 *
 * Drift would be invisible and wrong in the quiet direction: the SI would ask
 * for a clock of at least N, the check would demand at least M, and every world
 * would open with a logged LIFE-FRONT-7 breach nobody caused — a debug line
 * that is always on, which is the same as no signal. `serverPromptParity.test.ts`
 * compares the two copies and sweeps the classifier across the bound.
 */
export const CHAPTER_ONE_MIN_CLOCK = 8;

/** The world's fixed universe, narrowed to the four fields this prompt renders.
 *  `figures` is on the world's `Universe` and has never been rendered here. */
export type SagaOpenUniverse = {
  setting: string;
  era: string;
  laws: readonly string[];
  places: readonly string[];
};

/** A survivor of the previous act, narrowed to what `<person>` renders. */
export type SagaOpenSurvivor = {
  id: string;
  name: string;
  tier: "principal" | "regular";
  known: string;
};

export type SagaOpenPromptInput = {
  /** Hashed for `<texture>` (LIFE-STORY-EXEMPLAR-2) and never rendered. */
  worldId: string;
  characterName: string;
  practiceLanguage: string;
  nativeLanguage: string;
  worldSeedKey: string;
  /** LIFE-ONBOARD-3: persisted for EVERY seed, so it is not implied by the key. */
  worldMode?: "realistic" | "fantasy";
  /** Only when the seed is `manual`: the user's verbatim text. */
  worldSeedText?: string;
  /** Present on SUCCESSION only. When set, the universe is fixed and the
   *  surviving cast + canon carry forward — this is a new act of the same life,
   *  not a new life (LIFE-ARCH-6). It is also the bit the RESPONSE SCHEMA forks
   *  on, which is why it is a payload rather than a flag. */
  universe?: SagaOpenUniverse;
  survivingCast?: readonly SagaOpenSurvivor[];
  priorSagaHistory?: readonly string[];
};

/** How many lines of the previous act's history reach the prompt. */
export const PRIOR_SAGA_HISTORY_RENDER_CAP = 10;

/** The seven kinds, with the register each one lives in. Rendered into the
 *  prompt so `LIFE-FRONT-3`'s "mostly not threats" is a menu rather than a
 *  prohibition — a model given six good non-threatening options does not have
 *  to be talked out of the seventh. */
/**
 * The seed → register table, carried over from `worldSaga.ts`.
 *
 * The rewrite dropped it and the first playthrough showed exactly what that
 * costs: `seed="magic_apprentice"` (now `magic_university`) `mode="fantasy"` produced a coastal French
 * town with a butcher, a bank and a property dispute. Not one law, place or
 * person was fantastical. The seed key is a WORD, and a word in an attribute
 * with nothing attached to it does not survive contact with "write something
 * ordinary" — which the rest of this prompt says at length and on purpose.
 *
 * Compressed to one clause per key: the old version's paragraphs were written
 * for a prompt that also had to invent a plot, and this one does not.
 */
const SEED_REGISTER_RULES = [
  `THE SEED DECIDES THE GENRE — read <world seed="..."> and match it. This is not a mood; it is what kind of world this is:`,
  // LIFE-ONBOARD-17 — THE BRIEF MUST COVER WHAT THE CHIP PROMISED.
  //
  // The chip hints were rewritten to name what a universe makes POSSIBLE
  // ("forbidden shelves", "a charter nobody agrees on", "a court where
  // drowning can be a verdict") instead of listing its furniture. That raises
  // a failure the old flat hints could not have: the player is SOLD something
  // the generator was never told about, picks the chip for it, and the saga
  // comes back without it. So every promise a hint makes appears here as a
  // required element, and `seedBriefCoverage` asserts the pairing in the unit
  // suite — otherwise the hint is marketing the world need not deliver, which
  // is the same defect class as a rule the model can satisfy by doing nothing.
  `  city_life → grounded modern city; trams, small flats, paperwork, neighbours passed on the stairs, a city keeping its own hours.`,
  `  studying_abroad → fish-out-of-water, language as plot; cheap rent, late libraries, and a TERM THAT WILL END — the clock is the point.`,
  `  work_abroad → a fixed-term posting: a borrowed desk, a borrowed flat, and a RETURN TICKET WITH A DATE, which everything is measured against.`,
  `  family_country → the country a family left, revisited. The player's SURNAME IS ALREADY KNOWN here, and people have opinions about it that predate them.`,
  `  farm_life → a WORKING farm. Weather decides the week, animals will not wait, and the neighbours all have opinions about how it should be run.`,
  `  retired_village → somewhere small and warm, late in life; slow mornings, a garden getting away from them, neighbours with time to talk.`,
  `  restaurant → a working restaurant. SERVICE EVERY NIGHT is the clock; suppliers, staff and regulars are the cast, and the kitchen is the place they all return to.`,
  `  local_team → a local sports club mid-SEASON. Training twice a week, a LEAGUE TABLE that moves, and teammates who know the player only from here.`,
  `  hostel → a backpacker hostel worked from the night desk. The STAFF RECUR and the GUESTS ROTATE — that split is the shape of the world, not a detail.`,
  // LIFE-ONBOARD-16. This said "taught by someone", which is a DYAD — one
  // master, one student — and a dyad is a cast of two. The weakest judged
  // dimensions across every benchmark run are CAST-DEPTH and CHARACTER, and the
  // recurring note on the worst of them is that people "function primarily as
  // quest-givers". A cohort fixes that structurally: peers have their own
  // reasons to be there, their own results coming back, and their own opinions
  // about each other, none of which the player has to trigger.
  `  magic_university → FANTASY. Real, working magic with rules and costs, in a world where it is ordinary — studied at UNIVERSITY. The player is an undergraduate, not one master's apprentice: halls of residence, lectures that reframe how the world works, a cohort of peers on very different courses and trajectories, friendships, RIVALRIES and ROMANCES. Some of them are better at this than the player. Teaching staff exist and are not the point; the people the player LIVES with are. Two things the chip promises and the world must contain: knowledge that is RESTRICTED (a closed collection, a course you cannot take yet, work nobody will sign off) and a magic that COSTS — every working takes something back, and some people pay it anyway.`,
  `  noir_detective → 1940s noir. Late offices, wet streets, and a city where EVERYBODY OWES SOMEBODY — favours and debts are the social structure, not colour.`,
  `  alien_invasion → the first weeks of an arrival nobody planned for, played at human scale. Ships in the sky, cordons on the roads, and NEIGHBOURS WHO DISAGREE ABOUT WHAT THEY ARE — the argument between people is the story; the ships are the setting.`,
  `  frontier_colony → SCI-FI. A colony on a new world: thin air, rationed light, a CHARTER NOBODY AGREES ON, and no way home for a year. (Not a western — that is outlaw_trail.)`,
  `  outlaw_trail → WESTERN, and a STRAIGHT one. Dust, a railhead town, a marshal with a long memory, and a PRICE ON MORE THAN ONE HEAD. The player rides with people the law wants; horses, rifles, distance, and a frontier where the law is a person rather than an institution. NO MAGIC, no monsters, no supernatural element of any kind — this seed is filed under fantasy ONLY because it is set in the PAST, not because anything impossible happens in it. Everything that occurs must be something that could have happened in the real 19th-century American West. A weird-west with mana in the wind is the specific failure to avoid.`,
  `  sea_voyage → months at sea on a working ship. A CAPTAIN NOBODY CROSSES TWICE, and a crew with ITS OWN ARRANGEMENTS below decks that the afterguard does not know about.`,
  `  pilgrim_town → a town shaped by its miracle. Bell towers, PILGRIM MONEY, RELICS WORTH STEALING, and a miracle NOBODY MAY DOUBT out loud.`,
  `  heist → a crew assembled for ONE JOB. A target, a plan with too many steps, and a DATE THAT CANNOT MOVE. Every scene is a step in the plan, a complication to it, or the crew disagreeing about it.`,
  `  haunted_house → a house the player has INHERITED, and a village that knew it long before they did. Rooms nobody opens, and something in the house that is not settled. Dread and unease, never gore.`,
  `  surprise → choose the setting and genre yourself. manual → the player's own description in <world description="..."> IS the seed.`,
  `A fantastical seed that comes back as an ordinary town is the single most likely way to get this wrong. If the seed says magic, the UNIVERSE LAWS must be about magic and the PLACES must be places that only exist because of it.`,
  ``,
  `MODE — the <world mode="..."> attribute is the register the player explicitly chose:`,
  `  realistic → a life they could plausibly live. No magic, no monsters, no speculative technology. Drama from people, money, work, family and time.`,
  `  fantasy → a life the player could NOT plausibly live today: magic, other worlds, the far future, the supernatural — OR the historical past. Use it; a "fantasy" world that turns out to be a present-day village is a bug.`,
  `  ⚠ FANTASY DOES NOT MEAN MAGIC IS COMPULSORY. Most fantasy seeds here are magical and should be emphatically so. A PERIOD seed is fantasy because the player cannot live in that century, not because anything supernatural happens in it — see outlaw_trail, which is a STRAIGHT western and must contain no magic at all. Read the seed line; it says which kind it is.`,
  `Mode governs how far a free-text or "surprise" seed may be pushed. Where mode and seed disagree on REGISTER, MODE WINS — but a seed that explicitly rules something out (as outlaw_trail rules out magic) is the more specific instruction and stands.`,
  ``,
];

const FRONT_KIND_MENU = [
  `  threat        — something is damaged or lost. AT MOST ONE of these may exist in the whole world at a time, and NOT in chapter 1.`,
  `  opportunity   — a door closes. "the keynote slot goes to someone else", "the room above the shop is let to somebody else"`,
  `  relationship  — someone cools, leaves, or gives up on the player: a named person stops trying to include them.`,
  `  obligation    — a debt, a promise or a duty comes due. "your talk is on Thursday whether or not it is ready"`,
  `  rivalry       — someone else gets there first. "Tomas publishes first"`,
  `  mastery       — the player is found out as not good enough. "they realise you cannot actually read the old script"`,
  `  decay         — a place, a trade or a routine quietly ends. "the group you eat lunch with stops forming"`,
];

export function sagaOpenSystemInstruction(opts: {
  practiceLanguage: string;
  systemLanguage: string;
  succession: boolean;
  realistic: boolean;
}): string {
  const { practiceLanguage, systemLanguage, succession, realistic } = opts;
  return [
    `You are opening a world for a language-learning life simulator. The player will live in it for many sessions.`,
    ``,
    `WHAT YOU ARE WRITING — AND WHAT YOU ARE NOT (read this twice):`,
    `You are writing the FIRST PAGE and the CAST LIST. You are NOT writing the book.`,
    `There is NO plot to design here. No twist, no climax, no ending, no plan for what happens in chapter three. If you catch yourself writing what happens LATER, stop and delete it — that is the player's to decide, and a story that already knows its ending reads like one.`,
    `What you DO write: where this is, what is true, who is here, what they want, and what is already in motion. Drama comes from those things meeting the player. It does not come from you.`,
    ``,
    succession
      ? `THIS IS A SUCCESSION. The universe is FIXED and given to you — do not re-invent it. The surviving cast carry forward with everything the player knows about them. This is the NEXT ACT of the same life: a returning player should recognise the place and the people, and feel the story turning a corner rather than restarting.`
      : `THIS IS A NEW WORLD. You author the universe as well as the situation.`,
    ``,
    ...(succession ? [] : SEED_REGISTER_RULES),
    ...(succession
      ? []
      : [
          `THE UNIVERSE (immutable — written once, referenced forever):`,
          `  setting, era — where and when, concretely.`,
          // LIFE-STORY-EXEMPLAR-1. These two lines used to carry three worked
          // examples built on a bakery and a ferry. MEASURED across 56 archived
          // worlds: bakery in 30.4% of them, on seeds as unrelated as `heist`
          // and `magic_university`. This is the FIRST call in the chain and its
          // `places` feed everything downstream, so a noun demonstrated here
          // becomes the world. Both lines now describe the SHAPE the example
          // has to have — what the rule must DO, what the place must be FOR —
          // and leave the instance to the seed.
          `  laws — 3-6 STANDING RULES, present tense, that CONSTRAIN WHAT A PERSON CAN DO. This is the single most useful field you will write: a rule that makes certain actions IMPOSSIBLE generates story, where a rule that merely describes generates nothing. The test is that you can finish the sentence "so you cannot ___ unless ___". Draw the rule from THIS world's own materials — its geography, its trade, its authority, its magic if it has any, its hours. For an ordinary contemporary world write ordinary social laws; do not invent fantasy to fill this.`,
          `  places, figures — 3-6 each. Make several ORDINARY and usable, chosen from what THIS world's people actually need: somewhere they eat, somewhere they cross, somewhere they wait, someone who is awake when everyone else is asleep, a stretch of the route everybody complains about. A world whose only named places are the palace and the vault leaves the player nowhere to have breakfast. Pick the instances from the seed's own setting — the food, the transport and the trades of THIS place, not the generic European high street.`,
          ``,
        ]),
    `THE SITUATION (2-3 sentences):`,
    `Where the player stands RIGHT NOW. Their days, their room, their work, who is nearby. Present tense, concrete, and ordinary — this is a life, not a premise.`,
    `NO QUESTION MARKS. Read your draft back and count them; if there is a "?", rewrite that sentence as a statement. Asking the reader a question is the tell of a thriller blurb, and it is banned outright.`,
    `NO stakes clause. No "before it is too late", no "nothing here is what it seems", no "but something is wrong". If it would work as the back of a paperback about ordinary people in that place, it is right; if it would work as a film trailer, rewrite it.`,
    ``,
    `THE CAST — TWO TIERS, and this distinction is load-bearing:`,
    `  PRINCIPALS (exactly 2-3). People with an AMBITION. They carry: wants (what they are driving toward), nextMove (what they do next if nobody stops them), limit (what they will NOT do — this is what makes them a person rather than a plot function), and wrongAbout (something they believe about ANOTHER PERSON here that is not true).`,
    `  "nextMove" is the field the whole world turns on, so make it CONCRETE AND IMMINENT — an action with a place and a time, not a direction of travel. "Goes to the landlord on Thursday with a counter-offer" is a nextMove; "tries to secure her future" is not. If nobody interferes, this is literally what happens next, and every scene is built out of these.`,
    `  "wrongAbout.aboutId" must name ANOTHER PERSON IN THIS CAST. A belief about a place or an idea has nothing the player can watch it collide with. Make it something ordinary and human — "she thinks he is only staying for the season", "he is sure she never read the letter" — not a secret. The value is the GAP: the player will end up knowing better, and every scene with that person is quietly funnier or sadder for it.`,
    `  STANDING at world open is 0 for almost everyone, and -1 or +1 at the very most. This is where the player is STARTING. Nobody adores them yet and nobody has written them off.`,
    `  REGULARS (3-5). People with a ROUTINE, not an ambition. What they are doing when the player is not there: opens at six and complains about the delivery van; walks the dog past at the same hour; always has an opinion about the football. They exist to make the place REAL.`,
    `  A regular has NO wants and NO plan. Do not give one an ambition and call it a routine — if you catch yourself writing "wants to save enough to leave", that person is either a principal or their routine is something else entirely.`,
    `A world where everyone wants something is exhausting, and it is the single fastest way to make every scene feel like a plot. Most people are just living. Write far more regulars than principals.`,
    `NOBODY IN THE CAST MAY SHARE THE PLAYER'S NAME (see <character name="..."/>). The player would spend the whole world watching themselves speak.`,
    `EVERY cast member gets a "voice" — 6-10 words on HOW they talk. "clipped, never finishes a sentence, says 'right' a lot." This is what stops every character sounding the same; if two of your cast could swap lines without anyone noticing, you have written one character twice.`,
    // TTS-VOICE-2. `voice` says how they talk; these two say who the player
    // HEARS. Before them, every character in every wurld was read aloud in
    // the PLAYER's preferred voice, so a wurld of eight people had one.
    `EVERY cast member also gets a "gender" (male | female | other) and a "voiceRegister" (warm | firm | bright | calm | rough). These are not decoration: the app reads lines aloud, and it picks a real speaking voice from these two. Set "gender" to fit the character you have written — the name, the role, the world. "other" is a genuine answer for a character no binary voice suits (a chorus, a machine, a creature); it is not a way to avoid deciding. Pick "voiceRegister" to match the "voice" line you just wrote: gravelly and worn is "rough", brisk and authoritative is "firm", young and quick is "bright", low and unhurried is "calm", open and easy is "warm". A cast whose registers are all the same sounds like one person doing accents.`,
    `EVERY cast member may get "ties" — relationships to OTHER cast, not to the player: two of them have not spoken in a year, and neither will say why. This is what turns a list of people into a place, and it makes story out of nothing at all.`,
    ``,
    `THE ONE FRONT (scope "saga") — pressure, not plot:`,
    `A front is something already IN MOTION that will change the world if nobody attends to it. It has an agenda (what it is trying to achieve, present tense), a driver (a cast member, or "circumstance"), a KIND, and a clock: how many scenes of neglect before its consequence lands.`,
    `The kinds:`,
    ...FRONT_KIND_MENU,
    `Pick the kind that fits this world. Most worlds are not under threat — a life has opportunities closing, relationships cooling, debts coming due, and people getting there first, and those make better stories than danger does.`,
    `The consequence is a WORLD EVENT, stated concretely, never "the player fails". Name a thing in THIS world that changes hands, closes, or is given to somebody else — a place sold, a door shut, a post filled, a person who stops speaking to them.`,
    `THIS IS THE OPENING FRONT, so: it may NOT be kind "threat", and its clock size must be at least ${CHAPTER_ONE_MIN_CLOCK}. A world should arrive with WEATHER, not with a countdown. There is time.`,
    realistic
      ? `REGISTER — REALISTIC. The consequence must cap at social, professional, financial or personal cost. Nobody dies, nothing burns down, no crime unless the player's own seed asked for one. Drama comes from people, money, work, family, pride and time.`
      : `REGISTER — FANTASY. The consequence may reach as far as the universe supports.`,
    ``,
    ...LEXICON_RULES,
    ``,
    `TITLE (LIFE-LANG-14): "title" is the in-world name in ${practiceLanguage}; "titleNative" is that same title in ${systemLanguage}. Short, and grown from something CONCRETE in this specific world — a street, a dish, a shop sign, a boat, a date. Not a mood.`,
    ``,
    // LIFE-ARCH-8, written to LIFE-STORY-STAGE-5's shape and NOT to
    // LIFE-STORY-STAGE-4's. Asking for "the ordinary world plus one unanswered
    // question" is the wording that produced the defect: 4 of 4 measured
    // teasers closed on a rhetorical interrogative naming the plot, because the
    // model complied with the word "question" literally. So the thing wanted is
    // defined POSITIVELY (a plain fact with a loose end still attached), the
    // ban is a COUNT the model can execute rather than a request it can
    // believe it honoured, and the worked examples are statements.
    `THE PLAYER'S TEASER (LIFE-ARCH-8): "playerFacingTeaser" is the only thing here the PLAYER reads — the caption on their wurld card, the line on the intro screen, and "the story" on the resume screen. 2-3 sentences in ${systemLanguage}.`,
    `  Write PLAIN FACTS about the life they are walking into, each with a loose end still attached. The test: things a NEIGHBOUR would mention. "The room above the chandlery came cheap, and nobody will say who had it before." · "Your grandfather's name is still etched into the pier, though no one seems eager to talk about why he left." · "There is a stack of unopened mail on the floor, and the neighbour is watching from the fence."`,
    `  NOT A LOGLINE. No stakes clause ("before it is too late", "nothing here is what it seems"), no promise, no threat. Back of a paperback, not a film trailer — and nothing has happened yet, so there is no outcome for you to tease.`,
    `  NO QUESTION MARKS: read your draft back and count them. If there is a "?", rewrite that sentence as a statement.`,
    ``,
    `OUTPUT — JSON only, no prose, no fences:`,
    `{`,
    ...(succession
      ? []
      : [
          `  "universe": { "setting": "...", "era": "...", "laws": ["..."], "places": ["..."], "figures": [{"name":"...","what":"..."}] },`,
        ]),
    `  "title": "in ${practiceLanguage}", "titleNative": "in ${systemLanguage}", "tone": "one line",`,
    `  "playerFacingTeaser": "2-3 sentences in ${systemLanguage} — the ordinary world + one unanswered thing. No question marks.",`,
    `  "situation": "2-3 sentences of NOW",`,
    `  "goal": {         // LIFE-GOAL-1 — the ONE distant thing the whole saga is played toward or against. Known from turn one; not a mystery.`,
    `    "text": "hang three canvases in the Friday show",  // second-person, concrete, ${systemLanguage}. STRUCTURE, not drama — "the lease is decided in three weeks" is as valid as any emergency, and the seed's register decides which.`,
    `    "when": "Friday",                                  // a SHORT named day, 2-3 words. It goes on one line beside the goal.`,
    `    "days": 12                                         // 10-14. It must OUTLAST a sitting: a goal reached in one session turns the last turns into wind-down.`,
    `  },`,
    `  "firstObjective": "get Hélène to look at your work",  // LIFE-GOAL-2 — the NEAR thing, finishable in 1-3 scenes, that starts them toward the goal.`,
    `  "firstObjectiveNeed": "Hélène",                       // optional; ONE name — a person, thing or place it depends on. Just the name. Use a principal's NAME when it is a person.`,
    `  "principals": [   // 2-3, no more`,
    `    { "id": "kebab-slug", "name": "Display Name", "known": "what the player can see about them on sight", "voice": "6-10 words on how they talk", "gender": "male|female|other", "voiceRegister": "warm|firm|bright|calm|rough", "standing": 0,`,
    `      "wants": "...", "nextMove": "...", "limit": "...", "wrongAbout": { "aboutId": "ANOTHER CAST ID", "believes": "..." },`,
    `      "ties": [{ "id": "another-cast-id", "how": "one clause" }] }`,
    `  ],`,
    `  "regulars": [     // 3-5`,
    `    { "id": "kebab-slug", "name": "...", "known": "...", "voice": "...", "gender": "male|female|other", "voiceRegister": "warm|firm|bright|calm|rough", "standing": 0, "routine": "what they do when the player is not there", "ties": [] }`,
    `  ],`,
    `  "front": { "id": "kebab-slug", "name": "short", "driverId": "a cast id or circumstance", "agenda": "present tense, what it is trying to achieve", "kind": "one of the seven", "clock": { "size": ${CHAPTER_ONE_MIN_CLOCK}, "consequence": "the world event when it fills" } }`,
    `}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSagaOpenPrompt(input: SagaOpenPromptInput): string {
  const rows: string[] = [
    `<character name="${esc(input.characterName)}" practiceLanguage="${esc(input.practiceLanguage)}" nativeLanguage="${esc(input.nativeLanguage)}"/>`,
    `<world seed="${esc(input.worldSeedKey)}"${input.worldMode ? ` mode="${esc(input.worldMode)}"` : ""}${input.worldSeedText ? ` description="${esc(input.worldSeedText)}"` : ""}/>`,
  ];
  if (input.universe) {
    const u = input.universe;
    rows.push(
      [
        `<universe FIXED="true">`,
        `  <setting>${escT(u.setting)}</setting>`,
        `  <era>${escT(u.era)}</era>`,
        `  <laws>${u.laws.map((l: string) => `\n    <law>${escT(l)}</law>`).join("")}\n  </laws>`,
        `  <places>${u.places.map((p: string) => `\n    <place>${escT(p)}</place>`).join("")}\n  </places>`,
        `</universe>`,
      ].join("\n"),
    );
  }
  if (input.survivingCast?.length) {
    rows.push(
      `<survivingCast>\n${input.survivingCast
        .map((c) => `  <person id="${esc(c.id)}" name="${esc(c.name)}" tier="${c.tier}">${escT(c.known)}</person>`)
        .join("\n")}\n</survivingCast>`,
    );
  }
  if (input.priorSagaHistory?.length) {
    rows.push(
      `<whatHasHappened>\n${input.priorSagaHistory
        .slice(-PRIOR_SAGA_HISTORY_RENDER_CAP)
        .map((h) => `  <line>${escT(h)}</line>`)
        .join("\n")}\n</whatHasHappened>`,
    );
  }
  // LIFE-STORY-EXEMPLAR-2 — the ONE thing about this call that differs between
  // one world and the next. Everything above is identical for every world ever
  // created, which is why every world came back the same; measured across 56
  // archived worlds, neither demonstrating a name nor banning it moved its
  // frequency at all, so wording was never going to be the lever. Placed LAST,
  // next to the instruction to open the world, because it governs the choices
  // this call is about to make.
  //
  // SUCCESSION IS EXEMPT: the universe, cast and naming are already fixed by
  // the act that came before, and re-leaning a world that already has people
  // in it would rename them mid-life.
  if (!input.universe) rows.push(renderWorldTexture(input.worldId));
  rows.push(
    input.universe
      ? `Open the next act. Same place, same people, a new thing in motion.`
      : `Open the world.`,
  );
  return rows.join("\n\n");
}

/** Gemini `responseSchema`. Small and required-heavy on purpose: measured in
 *  `LIFE-WORLD-SAGA-10`, a model under a schema drops non-required fields far
 *  more readily than in free JSON, so anything load-bearing must be required.
 *
 *  ⚠ SRV-PROMPT-1 — `succession` is DERIVED by the caller from the spec's own
 *  shape, never accepted as a field. See this module's header. */
export function sagaOpenResponseSchema(succession: boolean): Record<string, unknown> {
  const STR = { type: "STRING" } as const;
  const ties = {
    type: "ARRAY",
    items: { type: "OBJECT", properties: { id: STR, how: STR }, required: ["id", "how"] },
  };
  // TWO ARRAYS, NOT ONE TAGGED ARRAY. Gemini's responseSchema has no
  // conditional-required, so a single `cast` array can only mark the fields
  // EVERY row needs — which left `nextMove` optional, and the first playthrough
  // came back with it empty on 5 of 6 principals. Splitting the arrays lets each
  // tier carry its own `required` list, and makes the anti-drama half
  // structural too: `wants` is not a property a regular HAS, so a regular
  // cannot be handed an ambition (LIFE-CAST-1).
  const principalItem = {
    type: "OBJECT",
    properties: {
      id: STR, name: STR, known: STR, voice: STR, standing: { type: "INTEGER" },
      // TTS-VOICE-2: who reads their lines aloud.
      gender: { type: "STRING", enum: ["male", "female", "other"] },
      voiceRegister: { type: "STRING", enum: ["warm", "firm", "bright", "calm", "rough"] },
      wants: STR, nextMove: STR, limit: STR,
      wrongAbout: {
        type: "OBJECT",
        properties: { aboutId: STR, believes: STR },
        required: ["aboutId", "believes"],
      },
      ties,
    },
    // `wrongAbout` is REQUIRED, not optional as first written. It is the only
    // generator of dramatic irony in the whole design — a scene where the
    // player knows more than the person in front of them — and the second
    // playthrough's fantasy world emitted none at all, so no principal belief
    // ever became visibly false across eighteen scenes. A principal with an
    // agenda and no mistaken belief is a plot function with a name.
    // `gender` is REQUIRED for the same reason `wrongAbout` is: optional +
    // absent is how LIFE-ARCH-8's teaser and LIFE-EX-VOCAB-4's lineVocab both
    // shipped as fields nobody ever emitted. A character with no gender falls
    // back to the player's own voice, which is precisely the bug.
    required: ["id", "name", "known", "voice", "gender", "wants", "nextMove", "limit", "wrongAbout"],
  };
  const regularItem = {
    type: "OBJECT",
    properties: {
      id: STR, name: STR, known: STR, voice: STR, standing: { type: "INTEGER" },
      gender: { type: "STRING", enum: ["male", "female", "other"] },
      voiceRegister: { type: "STRING", enum: ["warm", "firm", "bright", "calm", "rough"] },
      routine: STR, ties,
    },
    required: ["id", "name", "known", "voice", "gender", "routine"],
  };
  const props: Record<string, unknown> = {
    title: STR, titleNative: STR, tone: STR, situation: STR,
    // LIFE-ARCH-8 — REQUIRED, not merely declared. Under a responseSchema the
    // model drops a non-required field far more readily than in free JSON
    // (measured, LIFE-WORLD-SAGA-10), and this one is the caption on every
    // wurld card: absent, it defaults to '' and the card shows the pending
    // stub for the life of the world without anything saying so.
    playerFacingTeaser: STR,
    // LIFE-GOAL-1/2 — required, for the same measured reason as the teaser
    // above: the model drops a non-required field far more readily, and a saga
    // with no goal produces a world with no direction at all, which is the
    // defect this whole feature exists to fix.
    goal: {
      type: "OBJECT",
      properties: { text: STR, when: STR, days: { type: "NUMBER" } },
      required: ["text", "when", "days"],
    },
    firstObjective: STR,
    // The counts are bounds, not requests. Asked in prose for "2-3 principals"
    // the model returned ONE in a measured run, which left that world with a
    // single ambition in it.
    principals: { type: "ARRAY", items: principalItem, minItems: 2, maxItems: 3 },
    regulars: { type: "ARRAY", items: regularItem, minItems: 3, maxItems: 5 },
    front: {
      type: "OBJECT",
      properties: {
        id: STR, name: STR, driverId: STR, agenda: STR,
        kind: {
          type: "STRING",
          enum: ["threat", "opportunity", "relationship", "obligation", "rivalry", "mastery", "decay"],
        },
        clock: {
          type: "OBJECT",
          properties: { size: { type: "INTEGER" }, consequence: STR },
          required: ["size", "consequence"],
        },
      },
      required: ["id", "name", "agenda", "kind", "clock"],
    },
  };
  if (!succession) {
    props.universe = {
      type: "OBJECT",
      properties: {
        setting: STR, era: STR,
        laws: { type: "ARRAY", items: STR },
        places: { type: "ARRAY", items: STR },
        figures: {
          type: "ARRAY",
          items: { type: "OBJECT", properties: { name: STR, what: STR }, required: ["name", "what"] },
        },
      },
      required: ["setting", "era", "laws", "places"],
    };
  }
  return {
    type: "OBJECT",
    properties: props,
    required: [
      "title", "titleNative", "playerFacingTeaser", "tone", "situation",
      "principals", "regulars", "front",
      // LIFE-GOAL-1/2 — see the note on `goal` above. `firstObjectiveNeed` is
      // deliberately NOT required: most first objectives are a free push, and a
      // model forced to name a need will invent one (LIFE-NEED-6's wall wearing
      // a name).
      "goal", "firstObjective",
    ],
  };
}

function escT(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function esc(s: string): string {
  return escT(s).replace(/"/g, "&quot;");
}
