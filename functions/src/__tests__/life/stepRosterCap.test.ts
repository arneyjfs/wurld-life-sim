/**
 * LIFE-CTX-19 — the `<npcRoster>` is BOUNDED, and the bound keeps the rows the
 * rest of the prompt points AT.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 *
 * `buildLifeStepPrompt` mapped `input.npcs` whole: no slice, no cap. Its own
 * comment said *"Filter is applied by the caller (LifeScreen) so we just render
 * what was passed"* — and there is no such filter. `useLifeNpcs` subscribes to
 * the entire `npcs` subcollection with no `limit()` and no `where()`, and
 * `npcSpec` maps every row it is handed. The chain is unbounded end to end, and
 * the roster grows monotonically for the life of a world.
 *
 * ⚠ WHY IT MATTERS MORE HERE THAN ANYWHERE ELSE. Batch 8 moved `life_step` onto
 * the BUILT path, which caps `prompt + systemInstruction` as a SUM against
 * `MAX_PROMPT_BYTES`; the legacy path capped the two SEPARATELY. That is
 * `SRV-PROMPT-9`'s stated hazard — *migrating a category halves its byte
 * budget* — landing on the app's most failure-sensitive call. Measured
 * (synthetically) at batch 8: the roster crosses the cap at **81 rows**, where
 * `LIFE-CAST-3` expects ~30 by chapter five.
 *
 * And the failure is the worst in the programme. `LIFE-WORLD-ARC-7`'s overflow
 * fell back to `trivialArc` silently; this one is `SRV-PROMPT-10`'s hard loop —
 * "the story hit a snag" and a Continue chip whose only action is to repeat the
 * same rejected call.
 *
 * ── WHY A PLAIN `slice` WOULD BE WRONG ──────────────────────────────────────
 *
 * `LIFE-CTX-10`(a) binds a `beat` to its roster row by `npcId`, precisely so the
 * model does not re-match speakers by NAME across turns — the attribution drift
 * `LIFE-CANON-4` also guards. Dropping a row that a rendered beat, an
 * `<npcMemory>` block or `<recurringNpcs>` still names would reintroduce exactly
 * that, and would do it silently. So the cap RETAINS what the rest of the prompt
 * references and fills the remainder, rather than taking a prefix.
 *
 * The retained set is bounded by construction, which is what makes this safe
 * rather than merely better: `<recentEvents>` renders `STEP_EVENT_WINDOW` (20)
 * events (`LIFE-CTX-13`), so at most ~20 distinct ids can be referenced by
 * history, plus the canon working set, the arc's recurring ids and the current
 * scene's cast.
 */
import { describe, expect, it } from "vitest";
import { resolveServerPrompt } from "../../prompts/serverPromptSpec";
import { STEP_ROSTER_CAP } from "../../prompts/lifeStep";

const MAX_PROMPT_BYTES = 65_536;

function build(over: Record<string, unknown>): { si: string; prompt: string } {
  const r = resolveServerPrompt("life_step", {
    kind: "life_step",
    practiceLanguage: "Spanish (Latin America)",
    nativeLanguage: "English",
    systemLanguage: "English",
    difficulty: 3,
    characterName: "Marc",
    worldSeedKey: "city_life",
    isOpeningBeat: false,
    requestKind: "live",
    ...over,
  });
  if (r.status !== "built") throw new Error(`rejected: ${JSON.stringify(r).slice(0, 200)}`);
  return { si: r.systemInstruction, prompt: r.prompt };
}

const npc = (i: number, over: Record<string, unknown> = {}) => ({
  id: `npc-${i}`,
  name: `Entity ${i}`,
  scope: "world",
  ...over,
});

/**
 * ⚠ SCOPED TO THE `<npcRoster>` BLOCK, deliberately. The first version of these
 * helpers regexed the WHOLE prompt, so any other block naming an npc id would
 * satisfy a retention assertion and the test would pass without the roster
 * containing anything. A mutation that dropped the scene source survived
 * exactly that way. Extract the block first; assert inside it.
 */
const rosterBlock = (prompt: string): string =>
  /<npcRoster>([\s\S]*?)<\/npcRoster>/.exec(prompt)?.[1] ?? "";

const rosterRows = (prompt: string): number =>
  (rosterBlock(prompt).match(/<npc\s+id="/g) ?? []).length;

const idsInRoster = (prompt: string): string[] =>
  [...rosterBlock(prompt).matchAll(/<npc\s+id="([^"]+)"/g)].map((m) => m[1]!);

describe("LIFE-CTX-19 — the roster is capped", () => {
  it("a roster AT OR UNDER the cap is rendered untouched", () => {
    // The common path must be byte-identical: a cap that changes what a normal
    // world sends would be a behaviour change wearing a bound's clothes.
    const npcs = Array.from({ length: STEP_ROSTER_CAP }, (_, i) => npc(i));
    const { prompt } = build({ npcs });
    expect(rosterRows(prompt)).toBe(STEP_ROSTER_CAP);
    for (const n of npcs) expect(idsInRoster(prompt)).toContain(n.id);
  });

  it("a roster OVER the cap is bounded", () => {
    const { prompt } = build({ npcs: Array.from({ length: 400 }, (_, i) => npc(i)) });
    expect(rosterRows(prompt)).toBeLessThanOrEqual(STEP_ROSTER_CAP);
    // Non-vacuous in the other direction: a cap that rendered NOTHING would
    // satisfy the line above and destroy the block's purpose.
    expect(rosterRows(prompt)).toBeGreaterThan(0);
  });

  it("LIFE-CTX-10 — an npc a RENDERED BEAT names survives the cap", () => {
    // The binding the invariant exists for. `npc-399` sorts last and would be
    // the first thing a prefix-slice dropped.
    const { prompt } = build({
      npcs: Array.from({ length: 400 }, (_, i) => npc(i)),
      events: [
        {
          kind: "beat",
          // `npcId` lives in the PAYLOAD — `StepEvent` is
          // `{kind, payload?, createdAtMs?}`. Written from the type, not from
          // the implementation, which is what caught the reader being wrong.
          payload: {
            npcId: "npc-399",
            practiceText: "Te lo dije ayer.",
            nativeText: "I told you yesterday.",
          },
        },
      ],
    });
    expect(idsInRoster(prompt)).toContain("npc-399");
  });

  it("LIFE-NPC-RECUR-6 — a RECURRING npc survives the cap", () => {
    const { prompt } = build({
      npcs: Array.from({ length: 400 }, (_, i) => npc(i)),
      recurringNpcIds: ["npc-350", "npc-399"],
    });
    const ids = idsInRoster(prompt);
    expect(ids).toContain("npc-350");
    expect(ids).toContain("npc-399");
  });

  it("the current SCENE's cast survives the cap", () => {
    const { prompt } = build({
      npcs: [
        ...Array.from({ length: 400 }, (_, i) => npc(i)),
        npc(900, { scope: "scene", sceneId: "sc-1" }),
      ],
      scene: {
        id: "sc-1",
        currentPhase: "middle",
        turnsSinceReplan: 2,
        outline: {
          title: "The weighbridge",
          premise: "The clerk counts the same sacks twice.",
          tone: "wry",
          practiceFocus: ["numbers"],
          keyNpcs: [{ npcId: "npc-900", name: "Entity 900", role: "clerk" }],
        },
      },
    });
    expect(idsInRoster(prompt)).toContain("npc-900");
  });

  it("SRV-PROMPT-9 — a 400-npc world now assembles UNDER the cap", () => {
    // Before the bound this crossed `MAX_PROMPT_BYTES` at 81 rows and the
    // resolver answered `too-large`, which `runStepTurn` turns into the hard
    // loop. The assertion is the post-condition, not the mechanism.
    const { si, prompt } = build({
      npcs: Array.from({ length: 400 }, (_, i) =>
        npc(i, { relationship: "the one who keeps the roster book and will not say so" }),
      ),
    });
    const total = Buffer.byteLength(si, "utf8") + Buffer.byteLength(prompt, "utf8");
    expect(total).toBeLessThan(MAX_PROMPT_BYTES);
  });
});
