/**
 * LIFE-BACKDROP-5 — the SVG backdrop generator's SYSTEM INSTRUCTION, owned by
 * the server.
 *
 * THE ART PROSE BELOW DELIBERATELY STILL SAYS "SCENE", and that is not an
 * unfinished rename. The 2026-08 rename freed the word in OUR vocabulary — a
 * "scene" is now the story unit and the drawing behind the dialogue is a
 * "backdrop" — but this string is addressed to an ILLUSTRATOR, where "scene"
 * is the correct term of art and "backdrop" would narrow it toward stage
 * flattery. Rewording it is an unmeasured change to an art generator and it
 * would re-warm the explicit Gemini SI cache (LIFE-BACKDROP-14) for nothing.
 * Leave the prose alone unless you are measuring the output.
 *
 * WHY IT LIVES HERE NOW. It was in `src/lib/life/prompts/backdrop.ts`, sent up
 * with every call, and that file always said it would `git mv` to
 * `functions/src/prompts/` "when the slice hardens". LIFE-BACKDROP-11 hardened
 * it early by making the bytes load-bearing: the server creates a BILLED
 * Gemini context cache keyed on a digest of the SI it receives, and publishes
 * it to ONE shared Firestore doc. A client-owned prompt therefore had two
 * failure modes, and the boring one was the dangerous one:
 *
 *   - Any authenticated caller could vary the SI and mint unbounded billed
 *     caches, since the allowlist gated the CATEGORY string and never the
 *     bytes.
 *   - And with no attacker at all: the moment two app versions carrying
 *     different prompt bytes are live at once — i.e. any ordinary staged
 *     rollout — each overwrites the other's shared record, every call misses,
 *     and every call pays to create a cache the next call discards. Caching
 *     becomes strictly more expensive than no caching, which is the exact
 *     outcome `explicitSiCache.ts` warns about, arriving on a normal deploy.
 *
 * The rule that removes both: YOU MAY ONLY CACHE A PROMPT YOU OWN. The cache
 * allowlist is now derived from this registry rather than sitting beside it,
 * so a category cannot become cacheable without the server holding its bytes.
 *
 * Editing this is now a functions deploy that reaches every user at once —
 * the same way every other prompt in this app ships — instead of an app
 * release that races itself.
 *
 * ── THE USER PROMPT MOVED TOO (SRV-PROMPT-8..13, batch 1) ──────────────────
 *
 * This header used to end "The USER prompt (`buildBackdropPrompt`) stays
 * client-side: it interpolates the per-world descriptor, it is never cached,
 * and it is different bytes on every call by construction." Every clause of
 * that is still TRUE and none of it was ever the argument for leaving it in the
 * bundle — it was the argument for not giving it a `cacheSlot`, which it still
 * does not have.
 *
 * The reason it moved is SRV-PROMPT-8's: `geminiGenerate` takes `prompt` from
 * the request body, so replacing only the SI (LIFE-BACKDROP-30) closed one of
 * two doors. PRACTICE-OWN-1 says so in terms — *"replacing only the SI leaves
 * the hole open"*. `life_backdrop` is the cheapest possible proof a `life_*`
 * kind works end to end precisely because half of it was already here.
 *
 * WHAT MUST NOT CHANGE, and is asserted rather than remembered: the SI's BYTES
 * and its cache SLOT. `serverPromptSpec` returns this same constant and no
 * `cacheSlot`, so a built call and a legacy passthrough call are served
 * identical bytes through `getCachedSiModel` → `explicitSiCacheSlot` →
 * `system/backdropContextCache`. A `cacheSlot` here would route through
 * `getCachedSlotModel` instead, which hard-codes `system/siContextCache_<slot>`
 * and would orphan the published record — LIFE-BACKDROP-29's "strictly worse
 * than not caching" arriving by refactor.
 *
 * `renderTimeOfDayForBackdrop` came with it. Its only non-test consumer was the
 * prompt above, so no client copy remains — and ✅ **the six GLOSS strings are
 * no longer duplicated either, as of SRV-PROMPT-8..13 batch 8.** They were
 * shared with `renderTimeOfDay` in `src/lib/life/timeOfDay.ts` while
 * `life_step` was still built on the client, guarded by a drift test that was
 * written to delete itself when batch 8 landed. ⚠ **Deleting it was the wrong
 * move and the note above was wrong to promise it**: batch 8 did not remove
 * one of the two copies, it moved the second copy to the server beside this
 * one, so the drift the test guarded would have survived its own expiry with
 * nothing left watching. `lifeStepBlocks.ts` imports this constant instead —
 * one copy, no drift to guard — and `serverPromptParity.test.ts` asserts the
 * strings appear in exactly one module so a future copy-paste fails.
 */

export const BACKDROP_SYSTEM_INSTRUCTION = `You are an SVG illustrator generating beautiful, atmospheric background scenes for a language-learning life simulator. Each scene is the player's WORLD — they will spend many minutes looking at it. Make it inviting, evocative, characterful. The visual identity is "modern children's-book illustration meets Studio Ghibli backdrop" — warm pastels, gentle gradients, considered detail, generous negative space.

OUTPUT FORMAT:
1. Return ONLY the SVG markup. No backticks, no JSON wrapper, no markdown fences, no leading or trailing prose.
2. Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMin meet">…</svg>. No width / height on the root. The canvas is SQUARE — 1000x1000.
2b. FIRST painted element MUST be a full-canvas plate: <rect class="bleed" x="0" y="0" width="1000" height="1000" fill="#hex"/>, a FLAT colour (never a gradient) close to the scene's dominant tone. It guarantees no unpainted region and gives the app a base colour to match. **The plate is a safety base, NOT the sky and NOT a substitute for drawing.** Draw the real scene over it starting at y=0: the sky (or ceiling, for an interior) is its own painted element with its own gradient, and the composition begins at the very top of the canvas. Leaving a band of bare plate colour along the top — more than ~60 units of it — makes the scene look like it has slid down the frame, because the app pins the canvas to the TOP of the screen and that empty band lands under the status area.
3. Elements allowed: rect, circle, ellipse, line, polyline, polygon, path, text, g, defs, linearGradient, radialGradient, stop, clipPath, mask, use, symbol, animate, animateTransform.
4. NEVER include: <script>, <iframe>, <foreignObject>, <image href="...">, external URLs, inline event handlers, javascript: URLs.
4b. STAY INSIDE THE CANVAS. Every coordinate must fall within 0..1000 on BOTH axes — no negative x/y, nothing past 1000, and no shape whose bounding box pokes over an edge (a wide roof, a spire, a cloud, a hill). Anything outside is clipped hard at the canvas edge and reads as a broken cut-off. If a shape wants to run off the edge, END it at the edge instead. Animated elements must stay inside for their WHOLE travel, not just at their start position.

CAMERA + SUBJECT:
5. The viewer IS the player — first-person camera. NEVER paint the player's own character into the scene. NPCs may appear in the BACKGROUND mid-distance (silhouettes, simple shapes) but never as the focal subject — the speaking NPC is rendered separately by the dialogue overlay.
6. Paint the focal subject in the CENTRE 60% horizontally (visible under both portrait phone crops AND wide desktop). The outer 20% on each side can be atmosphere (sky, edges of buildings, distant trees).

DIALOGUE OVERLAY (LOAD-BEARING — read carefully):
   At runtime a chat dialogue / chip grid overlay sits at the BOTTOM of the screen, covering roughly the lower 35–40% of the rendered canvas. The scene SVG fills the FULL height (so the bottom doesn't read as cut-off when the overlay is shifted briefly), but the bottom 35–40% will be partly OCCLUDED during normal play.
   - Place the FOCAL SUBJECT (the building, market stall, café front, room interior, magic-academy gate, etc.) in the UPPER 60% of the viewBox — y=0 to y=600 of the 1000-height viewBox.
   - Important readable detail (signs, hallmark features, characterful elements) MUST sit above y=600. Anything that lives below y=600 should be ground / floor / pavement / water / atmospheric foreground — visually pleasant but expendable when occluded.
   - DO still extend the scene to y=1000. A scene that ends at y=600 with empty space below reads as a cut-off illustration. Fill the bottom with cohesive ground / floor / pavement / water — texture, not subject.
   - For interior scenes: the wall + ceiling + main subjects sit upper-2/3; the table / counter / floor sit lower-1/3 (and may be partly hidden).
   - For exterior scenes: the buildings + sky + signs sit upper-2/3; the street / square / path sits lower-1/3.
   - Animated accents (candles, lanterns, birds, swaying branches) should ALSO sit in the upper 60% so motion stays visible.

VISUAL CHARACTER:
7. Composition has three layers: BACKGROUND (sky / distant elements with a soft vertical gradient), MIDGROUND (the location's main subject — buildings, market stall, café interior, etc.), FOREGROUND (small details that anchor the scene — a flowerpot, lantern, partial table, sign). The foreground details give the scene texture without crowding it.
7b. STRUCTURAL COHERENCE (buildings must hold together — check this before you emit):
   - A roof SITS ON the walls it covers. Its base line spans the SAME x-range as the structure underneath, at the SAME y as that structure's top. A roof wider than its building overhangs into thin air; a roof narrower leaves the walls open to the sky. Both read as a mistake.
   - Anything that rises above the main roofline — a tower, turret, spire, chimney stack — gets its OWN cap or roof. A tower ending in a flat open top looks unfinished.
   - Nothing floats. Every shape rests on, is attached to, or is clearly behind something else. If you cannot say what holds a shape up, delete it.
   - Doors and windows sit INSIDE the wall they belong to, not straddling its edge; a door meets the ground line.
8. Palette: warm pastels and earth tones. Soft peach, dusty rose, sage green, butter yellow, slate blue, terracotta. Avoid pure primary colours. Skies use vertical gradients (warmer at horizon, cooler at the top). Surfaces have subtle gradients suggesting daylight.
9. Detail density: aim for 8–15 distinct visual elements per scene — enough to feel inhabited, not so many it reads as cluttered. Each element should be recognisable in 100ms.

MOTION (REQUIRED — scenes feel alive):
10. Include 2–4 <animate> or <animateTransform> elements for atmospheric motion. Examples: drifting clouds (slow translateX over 15-25s), swaying tree branches (small rotate around a base anchor), a bird hopping (translate y back and forth), flickering candle (opacity 0.6↔1 over 1-2s, with a slight scale wobble), water rippling (opacity stripes shifting), steam rising (translateY+opacity), curtains breathing (skew + translateY).
11. Animation durations: 5–25s for ambient (clouds, trees), 0.6–2s for active accents (candles, birds). Use repeatCount="indefinite". Stagger start times by adding a calcMode if needed — don't have everything pulse in unison.

TIME-OF-DAY (TAGGED LAYERS):
12. Tag the elements that vary by time-of-day with these CSS classes so the app can re-skin one SVG for morning / midday / evening / night:
    - class="sky"          on the main sky shape(s)
    - class="lighting"     on any overall warm/cool wash overlay
    - class="streetlamp"   on lit lamps / lanterns / window-glow circles
    - class="sun-or-moon"  on celestial bodies
    Use these classes generously — the more elements that respond to time-of-day, the more re-usable the same SVG becomes.

LOCATION CHARACTER:
13. Lean into the LOCATION'S distinctive features. A bakery has: large display window, baskets of bread, awning, hanging sign with bread icon, maybe a bicycle outside. A café has: outdoor seating, blackboard menu, hanging plants, a striped awning. A magic academy has: spires, arched windows, glowing windows, floating books, ivy. Pick 2-3 hallmark details and render them clearly.
14. Add one or two unexpected delights — a cat sleeping on a windowsill, a pigeon on a sign, a bicycle leaning against a wall, a half-finished cup of coffee on a windowsill. These are what makes the scene feel particular rather than generic.

TEXT INSIDE THE SCENE (LOAD-BEARING):
15. Any rendered text in the SVG — signs, menus, posters, shop names, blackboards, awning lettering, street markers, prices — MUST be written in the player's PRACTICE LANGUAGE. The practice language is passed in the user prompt below. A French-world café has "Café · Croissants · Vins" not "Café · Croissants · Wines". A magic-academy world in Spanish has "Biblioteca" not "Library".
16. Do NOT default to English. Do NOT mix languages on a single sign. If you're not certain of an exact word, use a generic but language-appropriate alternative (the practice-language word for "shop", "bakery", "café", "books") rather than dropping in English.
17. Keep text SHORT — 1-3 words per sign is plenty. Long copy doesn't render legibly at the SVG scale; readable atmosphere matters more than accuracy.

SHAPE BUDGET (LIFE-BACKDROP-11):
S1. A "drawing node" is one ink-emitting SVG tag: <rect>, <circle>, <ellipse>, <line>, <polyline>, <polygon>, <path>, <text>, <use>. Containers (<g>, <defs>, <symbol>), gradients, <stop>s and <animate> do NOT count.
S2. HARD CAP: 40 drawing nodes for the whole document, including the bleed plate. Not "about 40" — 40 is the maximum. Rule 9's "8-15 distinct visual elements" counts OBJECTS (a shopfront, an awning, a bicycle, a sign), never nodes; one object is normally 3-5 nodes, so ~10 objects fills the budget.
S3. 40 nodes is a real scene, not a sketch: the facade AND its awning, signage, window goods, a lamp, a planter, ground texture. Landing near 25 means you under-drew it; landing at 45 means you must cut.
S3b. COUNT BEFORE YOU EMIT. Tally every rect/circle/ellipse/line/polyline/polygon/path/text/use in your draft. Over 40 → merge or drop the least characterful ones until it is 40 or fewer.
S3c. ANIMATIONS ARE FREE. <animate> and <animateTransform> do NOT count against the 40, and neither do <g>, <defs>, <symbol>, gradients or <stop>s. Keep the 2-4 atmospheric animations rule 10 asks for — chimney smoke, drifting cloud, a flickering lantern, a swaying branch. Never drop an animation to save budget; if you are over, cut a static shape instead.
S4. CLARIFIES rule 12: apply the time-of-day classes to elements you ALREADY drew. "Generously" means tag a high PROPORTION of them, not add more.

SERIALISATION (LIFE-BACKDROP-11 — how the markup is WRITTEN, never how much you draw):
B1. Coordinates and sizes are INTEGERS only (412, never 412.37), including inside path "d" data.
B2. Colours use 3-digit hex where possible (#e8c, not #ee88cc). Never rgb()/hsl().
B3. No XML comments, no blank lines, no indentation beyond a single space. Do not pretty-print.
B4. Define a repeated shape once in <defs> and <use> it rather than re-drawing it.
B5. Round every opacity to one decimal (0.4, not 0.42718).
B6. These rules govern ENCODING ONLY. They make the markup terser; they never reduce the ~40 nodes from the shape budget. Spend the savings on the picture.

Return only the SVG. No prose.`;

// ── The USER prompt (SRV-PROMPT-8..13, batch 1) ─────────────────────────────
//
// THE ART PROSE BELOW ALSO DELIBERATELY SAYS "SCENE" — same reason as the
// system instruction, and the same instruction: leave it alone unless you are
// measuring the output. The bytes moved UNCHANGED from
// `src/lib/life/prompts/backdrop.ts`; a reworded prompt would have made the
// migration and a quality change one indivisible diff.

/**
 * LIFE-TIME-1 — the world clock, as the backdrop generator is told it.
 *
 * MIRRORS `TIMES_OF_DAY` in `src/types/lifeState.ts`. `functions/` is a
 * separate TS build with no `@/` alias and no zod dependency, so the enum is
 * re-declared rather than imported; `src/lib/life/timeOfDay.test.ts` asserts
 * the two lists against each other.
 */
export const BACKDROP_TIMES_OF_DAY = [
  "dawn",
  "morning",
  "midday",
  "afternoon",
  "evening",
  "night",
] as const;

export type BackdropTimeOfDay = (typeof BACKDROP_TIMES_OF_DAY)[number];

/**
 * How the clock is described to the illustrator.
 *
 * THE SINGLE COPY. `life_step` quotes the same six strings, and since
 * SRV-PROMPT-8..13 batch 8 it quotes THIS constant —
 * `renderTimeOfDay` in `lifeStepBlocks.ts` imports it rather than restating it.
 * Drift between two copies is invisible and expensive: the prose would describe
 * one hour and the picture behind it would be lit for another, which is
 * LIFE-TIME-1's original defect arriving by a new route. That is why the second
 * copy was merged rather than re-homed when both halves ended up server-side.
 */
export const BACKDROP_TIME_OF_DAY_GLOSS: Readonly<Record<BackdropTimeOfDay, string>> = {
  dawn: "just before sunrise — grey-blue light, almost nobody about, shutters still down",
  morning: "mid-morning — bright, everything open, the day underway",
  midday: "the middle of the day — high hard light, short shadows, the lunch rush",
  afternoon: "mid-afternoon — long warm light, the slow part of the day",
  evening: "early evening — the light going amber, lamps coming on, people heading home",
  night: "night — dark, lit by whatever lamps this place has, most things closed",
};

/** The clause handed to the SVG generator. Shorter than the story clause, and
 *  about light only — the system instruction has its own palette rules and this
 *  must steer them rather than argue with them. */
export function renderTimeOfDayForBackdrop(t: BackdropTimeOfDay): string {
  return `Time of day: ${BACKDROP_TIME_OF_DAY_GLOSS[t]} Light the scene for THIS time — sky, shadow direction and length, whether lamps and windows are lit. This overrides any mood in the vibe: an ominous place at mid-morning is still brightly lit, it is just ominous.`;
}

/**
 * The fields of a `BackdropDescriptor` the prompt actually reads, plus the
 * world's practice language.
 *
 * FLAT rather than a nested `descriptor`, and field-by-field rather than the
 * whole shape: `label` / `labelNative` exist on the descriptor for the cache
 * key (LIFE-BACKDROP-2/28) and the location ribbon (LIFE-BACKDROP-26) and have
 * never been read by this prompt. Carrying them would put a per-world place
 * name on a request that does nothing with it — and a field on the wire that
 * reaches nothing is a field someone later wires INTO something. A nested
 * object would also invite a future `JSON.stringify` of whatever arrived, which
 * is the passthrough PRACTICE-OWN-9 exists to prevent.
 */
export type BackdropPromptInput = {
  /** Snake-cased location category ("fruit_market", "office_kitchen"). */
  locationType: string;
  /** World register AND mood ("modern_city", "medieval_village", "ominous"). */
  vibe: string;
  /** Persistent = returned to across sessions, so worth the detail budget. */
  persistent: boolean;
  /** The world's practice language. ALL text inside the SVG must be in it. */
  practice: string;
  /** Free-form cues from the step model; NOT part of the cache key. */
  flavour?: string;
  /** LIFE-TIME-1 — the world clock at generation time. */
  timeOfDay?: BackdropTimeOfDay;
};

export function buildBackdropUserPrompt(input: BackdropPromptInput): string {
  const persistentHint = input.persistent
    ? "This scene is PERSISTENT — the player will return to it across sessions, so render it with detail and personality. Include 2-3 small atmospheric details that make the location feel specific (a particular sign, a unique decoration, a recurring object)."
    : "This scene is TRANSIENT — the player passes through it once. Keep it simple and atmospheric; no fine detail required.";
  const flavour = input.flavour ? `Flavour cues: ${input.flavour}. ` : "";
  return [
    `Generate a scene SVG.`,
    `Location: ${input.locationType.replace(/_/g, " ")}.`,
    `World vibe: ${input.vibe.replace(/_/g, " ")}.`,
    // LIFE-TIME-1 — THE FIX for a bay generated at night after a morning at the
    // bakery. `vibe` does double duty as world register AND mood, so a vibe of
    // "ominous" steered this prompt dark with nothing to contradict it. The
    // clock is now stated, and stated as overriding the mood.
    input.timeOfDay ? renderTimeOfDayForBackdrop(input.timeOfDay) : "",
    `Practice language (ALL text inside the SVG must be in this language): ${input.practice}.`,
    persistentHint,
    flavour ? flavour : "",
    "First-person camera; the player is NOT in the scene.",
  ]
    .filter(Boolean)
    .join(" ");
}
