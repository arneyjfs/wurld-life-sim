/**
 * The client-selectable model allowlist.
 *
 * `index.ts` cannot be imported here (firebase-functions + sharp + the whole
 * pipeline graph), which is exactly why `resolveClientModel` was extracted:
 * a guard on a request field that no test can reach is a guard on trust. The
 * one assertion that genuinely needs `index.ts` reads it as TEXT, in the
 * `no-client-prompt-copies.static.test.ts` shape.
 */
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  CLIENT_SELECTABLE_MODELS,
  isSelectableModel,
  resolveClientModel,
  resolveClientThinking,
  THINKING_LEVELS,
  type GeminiModel,
} from "../modelAllowlist";

const FALLBACK: GeminiModel = "gemini-3.1-flash-lite";

describe("resolveClientModel — a caller may not choose what we are billed for", () => {
  it("passes through every model this project actually serves", () => {
    // Non-vacuous by construction: if the list were emptied, the loop would
    // assert nothing and the length check below would fail instead.
    expect(CLIENT_SELECTABLE_MODELS.length).toBeGreaterThan(1);
    for (const m of CLIENT_SELECTABLE_MODELS) {
      const warn = vi.fn();
      expect(resolveClientModel(m, FALLBACK, "life_step", warn)).toBe(m);
      expect(warn, `${m} should be silent`).not.toHaveBeenCalled();
    }
  });

  it("an absent model is the endpoint default, silently — it is the common case", () => {
    const warn = vi.fn();
    expect(resolveClientModel(undefined, FALLBACK, "explain", warn)).toBe(FALLBACK);
    expect(resolveClientModel(null, FALLBACK, "explain", warn)).toBe(FALLBACK);
    // Warning on the DEFAULT path would bury the real signal under one line per
    // call — most callers send no model at all.
    expect(warn).not.toHaveBeenCalled();
  });

  it("an unserved model falls back and is LOGGED, rather than being refused", () => {
    // ⚠ The posture, asserted so it reads as a decision. A 400 here would
    // reproduce the functions-before-hosting asymmetry: a client bundle naming
    // a model newer than the deployed functions would fail every call until the
    // two met. The log line going non-zero is how that drift gets noticed.
    const warn = vi.fn();
    expect(resolveClientModel("gemini-9-ultra-expensive", FALLBACK, "life_step", warn)).toBe(
      FALLBACK,
    );
    expect(warn).toHaveBeenCalledTimes(1);
    const line = warn.mock.calls[0]![0] as string;
    // The CATEGORY is in the line because the two causes look different there:
    // one category is a client bug, every category is somebody probing.
    expect(line).toContain("life_step");
    expect(line).toContain("gemini-9-ultra-expensive");
  });

  it("a non-string model cannot slip past a `typeof` that was never written", () => {
    // The hole this closes was a TYPE assertion over `req.body`, so the values
    // that matter are the ones a type would have excluded and JSON permits.
    for (const hostile of [42, true, {}, [], { toString: () => "gemini-2.5-flash" }]) {
      const warn = vi.fn();
      expect(resolveClientModel(hostile, FALLBACK, "practice_gen_mc", warn)).toBe(FALLBACK);
      expect(warn, String(hostile)).toHaveBeenCalledTimes(1);
    }
    // ⚠ Specifically: an object whose `toString` names an allowed model is
    // still refused. `String(raw)` appears in the LOG line, and a guard that
    // compared the stringified value would have accepted this.
    expect(isSelectableModel({ toString: () => "gemini-2.5-flash" })).toBe(false);
  });

  it("the empty string is not a model", () => {
    const warn = vi.fn();
    expect(resolveClientModel("", FALLBACK, "topic_classify", warn)).toBe(FALLBACK);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe("the allowlist cannot fall behind MODELS", () => {
  it("every model index.ts routes to is one a caller may also name", () => {
    // The drift this exists for: someone points a `MODELS` entry at a new
    // model, the type no longer constrains anything at runtime, and the
    // endpoint quietly serves the DEFAULT instead of the model the app asked
    // for. Read as text: `MODELS` lives in `gemini/client.ts` (moved out of
    // `index.ts` by CPLX-FN-3), and reading the source keeps this test free of
    // the SDK clients that module constructs.
    const src = readFileSync(resolve(__dirname, "../gemini/client.ts"), "utf8");
    const block = /export const MODELS = \{([\s\S]*?)\n\} as const/.exec(src)?.[1];
    expect(block, "MODELS block not found — this test has rotted, fix it").toBeTruthy();

    const routed = [...block!.matchAll(/:\s*"([^"]+)"/g)].map((m) => m[1]!);
    // Non-vacuous: a regex that stopped matching would otherwise report
    // agreement about nothing, which is the failure mode five guards in this
    // programme have already had.
    expect(routed.length).toBeGreaterThanOrEqual(5);

    const allowed = new Set<string>(CLIENT_SELECTABLE_MODELS);
    expect([...new Set(routed)].filter((m) => !allowed.has(m))).toEqual([]);
  });

  it("the fallback is not the primary — otherwise it is not a fallback", () => {
    const src = readFileSync(resolve(__dirname, "../gemini/client.ts"), "utf8");
    const block = /export const MODELS = \{([\s\S]*?)\n\} as const/.exec(src)![1]!;
    const pick = (k: string) => new RegExp(`\\n\\s*${k}:\\s*"([^"]+)"`).exec(block)?.[1];
    const fallback = pick("fallback");
    expect(fallback, "MODELS.fallback not found").toBeTruthy();
    // Both client-facing defaults, since `robustGenerate` swaps away from
    // whichever one served the primary attempt.
    expect(fallback).not.toBe(pick("clientGenerate"));
    expect(fallback).not.toBe(pick("clientStream"));
  });

  it("every selectable model is 3.x — the thinking code now DEPENDS on it", () => {
    // ⚠ Not trivia. `getDynamicThinking` / `getMinimalThinking` used to branch
    // on `isGemini3(model)` and return a numeric `thinkingBudget` for 2.x; that
    // branch was deleted because no 2.x model answers any more (404 "no longer
    // available to new users"). If a 2.x id were ever added back here, those
    // functions would silently hand it a knob it does not take — so the
    // deletion is only safe while this holds.
    for (const m of CLIENT_SELECTABLE_MODELS) {
      expect(m, `${m} is not 3.x — the thinking branch was removed on that assumption`).toMatch(
        /^gemini-3/,
      );
    }
  });
});

describe("resolveClientThinking — a caller may not choose what we pay to reason", () => {
  it("passes through every level the models actually take", () => {
    expect(THINKING_LEVELS.length).toBe(4);
    for (const level of THINKING_LEVELS) {
      const warn = vi.fn();
      expect(resolveClientThinking(level, "explain", warn)).toEqual({
        thinkingLevel: level,
      });
      expect(warn, `${level} should be silent`).not.toHaveBeenCalled();
    }
  });

  it("NEVER answers undefined — no config means the MODEL's default, which is not free", () => {
    // Measured: `gemini-3.1-flash-lite` spends 0 thinking tokens with no config,
    // but `gemini-3.6-flash` — the fallback — spends 874 on the same prompt, 4x
    // the total tokens of an explicit `minimal`. So "just pass nothing through"
    // is a cost regression on exactly the path that only runs when something has
    // already gone wrong.
    for (const lvl of [undefined, null, ""] as const) {
      const got = resolveClientThinking(lvl, "life_step", () => {});
      expect(got.thinkingLevel, String(lvl)).toBeTruthy();
    }
    expect(resolveClientThinking(undefined, "life_step", () => {})).toEqual({
      thinkingLevel: "minimal",
    });
  });

  it("the retired 2.x `thinkingBudget` is not a parameter any more (2026-09-29)", () => {
    // Every client ≥ 0.3.0 sends `thinkingLevel` only. The signature no longer
    // takes a budget, so `-1` (unbounded) has no way in at all — the lever is
    // closed by absence rather than by a check.
    expect(resolveClientThinking.length).toBeLessThanOrEqual(3);
    expect(resolveClientThinking(undefined, "explain_followup", () => {})).toEqual({
      thinkingLevel: "minimal",
    });
  });

  it("an unknown level neutralises DOWNWARD and is logged", () => {
    const warn = vi.fn();
    expect(resolveClientThinking("ludicrous", "practice_gen_mc", warn)).toEqual({
      thinkingLevel: "minimal",
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0] as string).toContain("practice_gen_mc");
  });

  it("a non-string level cannot slip past a `typeof` that was never written", () => {
    for (const hostile of [42, true, {}, [], { toString: () => "high" }]) {
      const got = resolveClientThinking(hostile, "explain", () => {});
      expect(got).toEqual({ thinkingLevel: "minimal" });
    }
  });
});
