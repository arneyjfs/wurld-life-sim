/**
 * LIFE-ARCH / LIFE-UNIVERSE-1 — the world-STATE blocks. THE ONLY COPY.
 *
 * ── WHY THIS FILE WAS A DUPLICATE, AND WHY IT IS NOT DELETED ────────────────
 *
 * `renderWorldStory` (was `src/lib/life/prompts/worldState.ts`) and
 * `renderUniverse` (was `src/lib/life/prompts/universe.ts`) are shared by
 * exactly TWO prompts: `life_world_arc`, which moved server-side in
 * SRV-PROMPT-8..13 batch 3, and `life_step`, which moved in batch 8. So they
 * could not move whole with the arc, and they existed on both sides between
 * those two batches.
 *
 * ⚠ **The old note here said "DELETE THIS FILE when batch 8 lands", and that
 * was wrong** — worth leaving as a correction rather than a silent fix. Batch 8
 * deleted the two CLIENT modules, not this one: the second consumer arrived
 * server-side rather than going away, so what ended was the duplication, not
 * the need for the file. `lifeStep.ts` and `lifeWorldArc.ts` both import from
 * here now (as do `lifeBio.ts` and `serverPromptSpec.ts`). An expiry note that
 * names a FILE rather than a CONDITION reads as an instruction the day the
 * batch lands, and this one would have deleted four callers' dependency.
 * The behavioural parity test at `tests/playthrough/serverPromptParity.test.ts`
 * did expire as promised, because it guarded the two copies against each other
 * and there are no longer two.
 *
 * ⚠ `sagaOpen.ts` is NOT a consumer, despite being the other world-shaped
 * prompt: it renders its own blocks inline. Checked rather than assumed — an
 * earlier reading of this migration had all three shared artefacts retiring
 * with the same batch, and all three were wrong about which.
 *
 * ── WHAT THESE BLOCKS ARE, AND WHAT THEY DELIBERATELY WITHHOLD ──────────────
 *
 * `renderWorldStory` replaces the book-level synopsis that used to head every
 * turn (premise, centralConflict, antagonist, storyMovements, midpointTwist,
 * climax, endStates). `LIFE-STORY-STAGE-2` measured the consequence directly —
 * a model handed the twist writes toward the twist — so what the prompt gets
 * instead is what is TRUE, WANTED and IN MOTION.
 *
 * **LIFE-FRONT-1.1 — the prompt never sees a clock.** Fronts render as `agenda`
 * + `driver` only. A model handed "3/6 → the bakery is sold" writes a countdown
 * whatever the prose rules say; a model handed "Bébert is trying to buy the
 * lease" writes a person with an intention. `consequence` is withheld for the
 * same reason. This is why the spec sends three fields per front and not a
 * `Front` — the withheld fields never reach the wire at all.
 *
 * `renderUniverse` is the SETTING as distinct from any story told in it:
 * Middle-earth, not the story of the Ring. Written once by `sagaOpen` and never
 * regenerated. `laws` is the load-bearing field — failures like "offers to talk
 * to something established as unable to talk" are LAW violations, and a law the
 * model sees every turn is far harder to contradict than one buried forty
 * events ago.
 */

/** LIFE-CAST-1.1 / LIFE-CAST-3 — regulars otherwise accumulate to thirty named
 *  people by chapter five, which is prompt bloat and a cast the player cannot
 *  track. Principals are never capped: they are the ones the story turns on.
 *
 *  Duplicated from `MAX_PRINCIPALS`/`REGULARS_RENDER_CEILING`'s home in
 *  `src/lib/life/fronts.ts`, which holds the clock arithmetic the server has no
 *  business knowing. Only the render ceiling is needed here, and the parity
 *  test asserts both copies slice at the same place. */
export const REGULARS_RENDER_CEILING = 8;

/** One cast member, narrowed to what the STATE BLOCKS render. Deliberately not
 *  the app's `CastMember`: `gender`, `voiceRegister` and `wrongAbout` are read
 *  by TTS and by the step prompt, never by this one. */
export type WorldStoryCastMember = {
  id: string;
  name: string;
  voice: string;
  standing: number;
  tier: "principal" | "regular";
  known: string;
  wants?: string;
  nextMove?: string;
  limit?: string;
  routine?: string;
  ties: ReadonlyArray<{ id: string; how: string }>;
};

/** One force in motion, narrowed to the three fields the block reads.
 *  `resolved` travels because the LIVE filter below is a PROMPT rule; the clock
 *  does not travel at all (LIFE-FRONT-1.1). */
export type WorldStoryFront = {
  driverId: string;
  agenda: string;
  resolved?: string | null;
};

export type WorldStoryUniverse = {
  setting: string;
  era: string;
  laws: readonly string[];
  places: readonly string[];
  figures: ReadonlyArray<{ name: string; what: string }>;
};

export function renderWorldStory(input: {
  situation?: string;
  fronts?: readonly WorldStoryFront[];
  cast?: readonly WorldStoryCastMember[];
}): string {
  const out: string[] = [];

  if (input.situation?.trim()) {
    out.push(`<situation>${escT(input.situation)}</situation>`);
  }

  const live = (input.fronts ?? []).filter((f) => f.resolved == null);
  if (live.length) {
    out.push(
      `<inMotion>\n${live
        .map((f) => `  <force driver="${esc(f.driverId)}">${escT(f.agenda)}</force>`)
        .join("\n")}\n</inMotion>`,
      `<inMotionRule>These are the pressures already running in this world — an agenda and who is driving it. They are WEATHER, not a plot. Let them show up as ordinary facts: someone busy, a notice on a door, a conversation you catch the end of. NEVER as a warning, never as portent, and nobody in this world says "there is something you should know".</inMotionRule>`,
    );
  }

  const cast = input.cast ?? [];
  if (cast.length) {
    const principals = cast.filter((c) => c.tier === "principal");
    // Regulars are capped for prompt weight; principals never are, because
    // they are the ones the story turns on.
    const regulars = cast.filter((c) => c.tier === "regular").slice(0, REGULARS_RENDER_CEILING);
    out.push(
      `<cast>\n${[...principals, ...regulars].map(renderMember).join("\n")}\n</cast>`,
      `<castRule>THE WORLD IS NOT ABOUT THE PLAYER. <wants> and <nextMove> say what a person is driving at and what they do NEXT if nobody stops them; <routine> says what someone is doing when the player is not there. Use them. People pursue their own things, mention their own news, are busy, are elsewhere. A world that revolves around the player is a world with one character in it.</castRule>`,
    );
  }

  return out.join("\n\n");
}

function renderMember(c: WorldStoryCastMember): string {
  const head = `  <person id="${esc(c.id)}" name="${esc(c.name)}" voice="${esc(c.voice)}" standing="${c.standing}">`;
  const body =
    c.tier === "principal"
      ? `<known>${escT(c.known)}</known><wants>${escT(c.wants ?? "")}</wants><nextMove>${escT(c.nextMove ?? "")}</nextMove>` +
        (c.limit ? `<willNot>${escT(c.limit)}</willNot>` : "")
      : `<known>${escT(c.known)}</known><routine>${escT(c.routine ?? "")}</routine>`;
  const ties = c.ties.map((t) => `<tie to="${esc(t.id)}">${escT(t.how)}</tie>`).join("");
  return `${head}${body}${ties}</person>`;
}

export function renderUniverse(u: WorldStoryUniverse | null | undefined): string {
  if (!u) return "";
  const laws = u.laws.map((l) => `    <law>${escapeText(l)}</law>`).join("\n");
  const places = u.places.map((p) => `    <place>${escapeText(p)}</place>`).join("\n");
  const figures = u.figures
    .map((f) => `    <figure name="${escapeAttr(f.name)}">${escapeText(f.what)}</figure>`)
    .join("\n");
  const rows = [
    u.setting ? `  <setting>${escapeText(u.setting)}</setting>` : "",
    u.era ? `  <era>${escapeText(u.era)}</era>` : "",
    laws ? `  <laws>\n${laws}\n  </laws>` : "",
    places ? `  <places>\n${places}\n  </places>` : "",
    figures ? `  <figures>\n${figures}\n  </figures>` : "",
  ].filter(Boolean);
  return rows.length > 0 ? `<universe>\n${rows.join("\n")}\n</universe>` : "";
}

// Two escape pairs rather than one, mirroring the client split: `worldState.ts`
// names them escT/esc and `universe.ts` names them escapeText/escapeAttr. Same
// behaviour; kept apart so a line-by-line diff against either client file reads
// clean while both still exist.
function escT(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function esc(s: string): string {
  return escT(s).replace(/"/g, "&quot;");
}
function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}
function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
