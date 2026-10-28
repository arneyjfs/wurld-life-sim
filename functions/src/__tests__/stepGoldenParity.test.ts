import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveServerPrompt } from "../prompts/serverPromptSpec";
import { lifeStepSystemInstruction } from "../prompts/lifeStep";
import {
  STEP_VIOLATION_FAMILY,
  renderStepRetryHint,
  type StepViolation,
} from "../prompts/lifeStepViolations";

/**
 * SRV-PROMPT-3 — THE BATCH-8 PORT DID NOT CHANGE A BYTE, and this is the
 * evidence.
 *
 * Same shape as `bioGoldenParity.test.ts` / `gradedQuestionGoldenParity.test.ts`
 * and for the same reason: the live comparison
 * (`tests/playthrough/serverPromptParity.test.ts`) runs both copies over one
 * input and diffs the bytes, which is only available while both copies exist.
 * `src/lib/life/prompts/step.ts` and its seven satellites are DELETED — that is
 * what SRV-PROMPT-3 requires — so there is nothing live to compare against.
 *
 * `fixtures/stepGolden.json` is therefore a CAPTURE: the exact output of the
 * CLIENT builders and the CLIENT critic, taken immediately before the prompt
 * half was deleted, across 4 system instructions, 43 prompt shapes and 19
 * retry hints. Each prompt row carries the `promptSpec` the migrated call site
 * sends for the SAME turn, so this file needs nothing from `src/`.
 *
 * ⚠ THE FIXTURE IS ONLY EVER DELETED, NEVER REFRESHED. Regenerating it from the
 * SERVER would make every assertion here vacuous — it would compare the port
 * with itself and report agreement. A genuine change to this prompt retires the
 * affected rows rather than re-recording them.
 *
 * ── THE TWO DISCLOSED DIVERGENCES ───────────────────────────────────────────
 *
 * Both are on the RETRY path, both are forced, and both are asserted as a
 * TRANSFORM of the client's bytes rather than skipped — so the transform itself
 * is pinned and the claim cannot rot into a comparison of two identical strings.
 *
 *  1. **The server ESCAPES `&<>` in every violation parameter; the client did
 *     not.** `schema-issue`'s `message` is Zod's own text and lands inside
 *     `<retryHint>`, which is the same unescaped-interpolation-into-a-block
 *     shape SRV-PROMPT-14 was written for and the same one batch 7 found on
 *     `<violationHint>`.
 *  2. **`spellComparisons` is applied to that message**, reusing batch 7's
 *     helper rather than copying it. Zod writes array bounds as `>=2` / `<=4`
 *     and `ZRawNodeResponse` bounds three arrays, so without it the escape
 *     would hand the model `&gt;=2` on the commonest schema failure this call
 *     has. That is a PRODUCTION difference, not a fixture artefact, and it is
 *     asserted row by row below.
 *
 * ⚠ AND ONE DEFECT IS PINNED RATHER THAN FIXED: the cross-turn frame is
 * DOUBLE-wrapped (`<retryHint><retryHint>…`), because `renderRetryHint` opens
 * the tag and `generateStepOptions` wrapped its return value again. Every
 * cross-turn retry the app has ever sent carried it. Un-nesting changes what
 * the model reads — a prompt edit, needing `npm run test:prompts` evidence — so
 * batch 8 ports it faithfully and this test states it out loud.
 */

type Golden = {
  note: string;
  si: Record<
    string,
    {
      practiceLanguage: string;
      nativeLanguage: string;
      systemLanguage: string;
      difficulty: number;
      out: string;
    }
  >;
  prompts: Record<string, { spec: Record<string, unknown>; out: string }>;
  retryHints: Record<string, string>;
};

const golden: Golden = JSON.parse(
  fs.readFileSync(path.join(__dirname, "fixtures", "stepGolden.json"), "utf8"),
);

/**
 * Escape + `spellComparisons`, i.e. exactly what the two disclosed divergences
 * do — applied to the PARAMETER VALUES only, which is the whole point. The
 * frame's own `<retryHint>` tags and the template's own literal `<canon>` are
 * server-written text and are NOT escaped; only what the caller sends is.
 *
 * Written here rather than imported so the expectation is stated independently
 * of the code it checks, and driven off each row's own violation parameters so
 * a row cannot be "transformed" into agreement by a blanket rewrite.
 */
function transformParams(clientBytes: string, violations: readonly StepViolation[]): string {
  const escape = (s: string) =>
    s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
  const spell = (s: string) => s.replace(/<=\s*/g, "at most ").replace(/>=\s*/g, "at least ");
  let out = clientBytes;
  for (const v of violations) {
    for (const [key, value] of Object.entries(v)) {
      if (key === "code") continue;
      const raws = Array.isArray(value) ? value : [value];
      for (const raw of raws) {
        if (typeof raw !== "string") continue;
        const want = escape(v.code === "schema-issue" && key === "message" ? spell(raw) : raw);
        if (want !== raw) out = out.split(raw).join(want);
      }
    }
  }
  return out;
}

/**
 * LIFE-LANG-18 — RETIRED 2026-09-24 (swap words cut from the app). The ONLY
 * sanctioned divergence from the captured SI: the SWAP WORDS section and the
 * two `swapWords` schema fragments are DELETED, byte for byte, and nothing else
 * moves. Asserted as a transform of the client capture — the fixture is not
 * re-recorded (see the ⚠ above) — so "pure deletion" is itself pinned.
 */
function retireSwapWords(clientBytes: string): string {
  const lines = clientBytes.split("\n");
  const head = lines.findIndex((l) => l.startsWith("SWAP WORDS (LIFE-LANG-18)"));
  const tail = lines.findIndex((l) => l.startsWith("- ZERO swap words on a line"));
  if (head < 1 || tail < head || lines[head - 1] !== "") {
    throw new Error("golden SI no longer has the SWAP WORDS block this transform deletes");
  }
  lines.splice(head - 1, tail - head + 2);
  const out = lines
    .filter((l) => !l.trimStart().startsWith('"swapWords": ["word", ...]'))
    .join("\n")
    .split(', "swapWords": ["word", ...] // optional, same as a beat')
    .join(" // optional, same as a beat");
  return out;
}

describe("SRV-PROMPT-3 — the life_step SYSTEM INSTRUCTION is byte-identical", () => {
  it("SRV-PROMPT-3 — the fixture is the CLIENT capture, not a server re-record", () => {
    expect(golden.note).toContain("CAPTURED from src/lib/life/prompts/step.ts");
    expect(golden.note).toContain("Never regenerate from the server");
    // …and it is not empty, which is the way a golden silently stops proving
    // anything (batch 1's `renderWorldStory` guard learned this on an empty SI).
    expect(Object.keys(golden.si).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(golden.prompts).length).toBeGreaterThanOrEqual(40);
    expect(Object.keys(golden.retryHints).length).toBeGreaterThanOrEqual(19);
  });

  for (const [label, row] of Object.entries(golden.si)) {
    it(`SRV-PROMPT-3 — SI byte-identical (LIFE-LANG-18 retired: swap block deleted): ${label}`, () => {
      const want = retireSwapWords(row.out);
      expect(want).not.toContain("swapWords");
      expect(want.length).toBeLessThan(row.out.length);
      expect(
        lifeStepSystemInstruction({
          practiceLanguage: row.practiceLanguage,
          nativeLanguage: row.nativeLanguage,
          systemLanguage: row.systemLanguage,
          difficulty: row.difficulty,
        }),
      ).toBe(want);
    });
  }

  it("SRV-PROMPT-11 — the SI carries the OUTPUT CONTRACT, which is what replaces the missing schema", () => {
    // This kind has no `responseSchema` by measured decision (LIFE-CTX-15), so
    // SRV-PROMPT-1's usual proof-of-migration — "the built call carries a
    // schema the client no longer sends" — is unavailable. The contract text is
    // the thing that had to cross, so it is what gets asserted.
    const si = lifeStepSystemInstruction({
      practiceLanguage: "French",
      nativeLanguage: "English",
      systemLanguage: "English",
      difficulty: 3,
    });
    for (const marker of [
      "OUTPUT SCHEMA (enforced):",
      '"gradedPlan": {',
      '"kind": "fill-blank",',
      '"kind": "comprehension",',
      '"resolution": {',
      '"backdropIntent": {',
      '"options": [{',
      '"worldDelta": {',
      '"introduces": [{',
      '"npcMemoryUpdates":',
      '"felt":',
      "Return ONLY valid JSON matching this schema. No prose, no markdown fences.",
    ]) {
      expect(si, `the SI must still state: ${marker}`).toContain(marker);
    }
    // LIFE-SI-LEAN-6 — the schema block's cross-reference has to RESOLVE here,
    // and it cost two failed rewrites to learn that. Asserted because a port
    // that dropped the heading would leave the rule dangling exactly as before.
    expect(si).toContain("See OUTBOUND GRADING below.");
    expect(si).toContain("OUTBOUND GRADING (`gradeTarget`)");
  });
});

describe("SRV-PROMPT-3 — the life_step USER PROMPT is byte-identical", () => {
  for (const [label, row] of Object.entries(golden.prompts)) {
    it(`SRV-PROMPT-3 — prompt byte-identical: ${label}`, () => {
      const r = resolveServerPrompt("life_step", row.spec);
      expect(r.status, `spec rejected: ${JSON.stringify(r)}`).toBe("built");
      if (r.status !== "built") throw new Error("unreachable");
      expect(r.prompt).toBe(row.out);
    });
  }

  it("SRV-PROMPT-9 — every captured shape is under the cap, through the RESOLVER", () => {
    // Measured through `resolveServerPrompt` rather than the builder, so the
    // `too-large` check is the one the endpoint runs. The batch-7 note records
    // why that distinction matters: a number taken off the builder cannot move
    // when a cap changes, so it stops describing the endpoint.
    for (const [label, row] of Object.entries(golden.prompts)) {
      const r = resolveServerPrompt("life_step", row.spec);
      expect(r.status, `${label} must not be too-large`).toBe("built");
    }
  });
});

describe("SRV-PROMPT-12 — the retry ladder is byte-identical, from CODES", () => {
  /**
   * ⚠ REBUILT FROM THE CODES, not replayed from a stored string. The point of
   * SRV-PROMPT-12 is that the client sends a verdict and the SERVER writes the
   * words, so a test that fed the server its own rendered output would prove
   * nothing. Each row below names the codes the client's critic pushed for that
   * fixture and asserts the frame, the templates, the order and the join.
   */
  const CASES: Array<[string, StepViolation[]]> = [
    ["A invalid json", [{ code: "invalid-json" }]],
    [
      "B one issue",
      [{ code: "schema-issue", path: "node.kind", message: "Invalid input" }],
    ],
    [
      "B six issues (the slice bound)",
      [
        { code: "schema-issue", path: "node.kind", message: "Invalid input" },
        { code: "schema-issue", path: "options", message: "Too small: expected array to have >=2 items" },
        {
          code: "schema-issue",
          path: "node.beats.0.practiceText",
          message: "Too small: expected string to have >=1 characters",
        },
        { code: "schema-issue", path: "options.0.id", message: "Invalid input: expected string" },
        { code: "schema-issue", path: "logLine", message: "Invalid input" },
        { code: "schema-issue", path: "introduces", message: "Too big: expected array to have <=4 items" },
      ],
    ],
    [
      "B a message carrying markup",
      [{ code: "schema-issue", path: "node", message: 'Unrecognized key: "</retryHint><b>"' }],
    ],
    ["C live turn with no node", [{ code: "live-turn-missing-node" }]],
    ["C question node with options", [{ code: "question-carries-options", count: 2 }]],
    ["C continuation with two options", [{ code: "continuation-option-count", count: 2 }]],
    ["C continuation with the wrong id", [{ code: "continuation-option-id", optionId: "go-on" }]],
    ["C branch with one option", [{ code: "branch-option-count", count: 1 }]],
    [
      "C branch with repeated action types",
      [{ code: "options-repeat-action-type", actionTypes: ["ask", "ask", "do"] }],
    ],
    ["C branch with nothing active", [{ code: "options-none-active" }]],
    ["C duplicate option ids", [{ code: "option-ids-duplicated", optionIds: ["ask"] }]],
    [
      "C two spread issues at once (order matters)",
      [
        { code: "options-repeat-action-type", actionTypes: ["ask", "ask"] },
        { code: "options-none-active" },
      ],
    ],
    ["D a dangled goal", [{ code: "dangled-goal", goal: "ask:obje-ledger", takes: 3 }]],
    [
      "D a dangled goal with markup in the id",
      [{ code: "dangled-goal", goal: "move:plac-<wash>&house", takes: 2 }],
    ],
    [
      "E unknown entity ref",
      [{ code: "unknown-entity-ref", optionId: "take-it", targetId: "obje-nope" }],
    ],
    [
      "E two unknown entity refs, and the ORDER",
      [
        { code: "unknown-entity-ref", optionId: "a", targetId: "obje-nope" },
        { code: "unknown-entity-ref", optionId: "b", targetId: "char-<who>&co" },
      ],
    ],
    ["E question omits the lead-in", [{ code: "question-omits-lead-in" }]],
    ["E lead-in leaks the tested line", [{ code: "lead-in-leaks-tested-line" }]],
  ];

  /** The rows whose captured bytes carry `&`, `<`, `>` or a Zod comparison, so
   *  the two disclosed divergences apply. Listed rather than detected, so a row
   *  cannot quietly join the set. */
  const DIVERGES = new Set([
    "B six issues (the slice bound)",
    "B a message carrying markup",
    "D a dangled goal with markup in the id",
    "E two unknown entity refs, and the ORDER",
  ]);

  for (const [label, violations] of CASES) {
    it(`SRV-PROMPT-12 — retry hint byte-identical: ${label}`, () => {
      const client = golden.retryHints[label];
      expect(client, `missing golden row ${label}`).toBeTruthy();
      const server = renderStepRetryHint(violations);
      if (DIVERGES.has(label)) {
        expect(server).toBe(transformParams(client!, violations));
        // …and the row really does carry something to transform, so this branch
        // cannot pass by comparing two identical strings.
        expect(server).not.toBe(client);
      } else {
        expect(server).toBe(client);
      }
    });
  }

  it("SRV-PROMPT-12 — the DIVERGING rows really do carry markup or a Zod comparison", () => {
    for (const label of DIVERGES) {
      const client = golden.retryHints[label]!;
      // Strip the frame's own tags before looking, or every row "carries markup".
      const body = client
        .replace(/^<retryHint>(<retryHint>)?/, "")
        .replace(/(<\/retryHint>)?<\/retryHint>$/, "");
      expect(
        /[&<>]/.test(body),
        `${label} is in DIVERGES but its body has nothing to escape`,
      ).toBe(true);
    }
  });

  it("SRV-PROMPT-12 — the cross-turn frame is DOUBLE-wrapped, and that is the ported defect", () => {
    // `validateStep.renderRetryHint` opens `<retryHint>` and
    // `generateStepOptions` wrapped its return value again. Pinned, not fixed:
    // un-nesting changes what the model reads. See this file's header.
    const server = renderStepRetryHint([{ code: "question-omits-lead-in" }]);
    expect(server.startsWith("<retryHint><retryHint>")).toBe(true);
    expect(server.endsWith("</retryHint></retryHint>")).toBe(true);
    // The four other families are single-wrapped, so the nesting is specific to
    // the site that has it rather than something this port did everywhere.
    for (const v of [
      { code: "invalid-json" } as const,
      { code: "schema-issue", path: "a", message: "b" } as const,
      { code: "live-turn-missing-node" } as const,
      { code: "dangled-goal", goal: "ask:x", takes: 2 } as const,
    ]) {
      const out = renderStepRetryHint([v]);
      expect(out.startsWith("<retryHint><retryHint>"), v.code).toBe(false);
      expect(out.startsWith("<retryHint>"), v.code).toBe(true);
    }
  });

  it("SRV-PROMPT-12 — every code in the union has a golden row or a stated reason", () => {
    // The union is closed, so a code added without a parity row would ship a
    // sentence nothing has ever compared. Asserted against the FAMILY table,
    // which is the one place every code has to appear.
    const covered = new Set(CASES.flatMap(([, vs]) => vs.map((v) => v.code)));
    for (const code of Object.keys(STEP_VIOLATION_FAMILY)) {
      expect(covered.has(code as StepViolation["code"]), `${code} has no parity row`).toBe(true);
    }
  });
});
