/**
 * MSG-PIPE-31.7 / 31.9 — the OpenAI (Luna) side of the client-direct kinds
 * `geminiGenerate` and `geminiStreamV2` serve.
 *
 * `resolveServerPrompt` stays the whole prompt rule (PRACTICE-OWN-*,
 * SRV-PROMPT-*): this resolver only runs on a spec it has BUILT, and reads the
 * same bounded values (SRV-PROMPT-17). Where Luna was measured on the
 * production prompt, the production builder's output is reused, not copied:
 *
 * | kind | SI | user prompt |
 * |---|---|---|
 * | `explain`, `explain_practice` | Luna template (explainLuna.ts) | production + "Write your explanation in <native>." |
 * | `explain_phrase`, `topic_classify`, `chat_import_extract` | production | production |
 * | `practice_planner_stream` | Luna (plan) | production minus the LANGUAGE MAPPING preamble; EXACTLY dropped when USER INTENT is set outside review mode |
 * | `practice_gen_{mc,p2n,n2p,lap,fb,fm,lf,lw}` | Luna per kind | Luna's own brief lines, strict JSON schema |
 *
 * Request parameters mirror the measurement scripts (`run_ex.py`,
 * `run_ph.py`, the topic / chat-extract suites, `practice/llm.py`).
 * Every other kind answers null and stays Gemini-only.
 *
 * Spec: docs/specs/message-pipeline.md (MSG-PIPE-31).
 */
import type { ProviderCategory } from "../../providerSwitch";
import { boundPromptField, PROMPT_FIELD_CAPS, resolveServerPrompt, type PracticeResolution } from "../serverPromptSpec";
import { LUNA_EXPLAIN_PRACTICE_SI, LUNA_EXPLAIN_SI } from "./explainLuna";
import {
  LUNA_PRACTICE_COMMON,
  LUNA_PRACTICE_FB_SI,
  LUNA_PRACTICE_FM_SI,
  LUNA_PRACTICE_LF_SI,
  LUNA_PRACTICE_LW_SI,
  LUNA_PRACTICE_MC_SI,
  LUNA_PRACTICE_PLAN_SI,
} from "./practiceLuna";

export type LunaClientPrompt = {
  providerCategory: ProviderCategory;
  systemInstruction: string;
  prompt: string;
  maxOutputTokens: number;
  responseSchema?: Record<string, unknown>;
  strictSchema?: boolean;
};

/** `{P}` / `{N}` → the two language names, every occurrence. */
export function fillLanguages(template: string, practice: string, native: string): string {
  return template.split("{P}").join(practice).split("{N}").join(native);
}

/** Gemini responseSchema → JSON Schema: Gemini spells types upper-case. The
 *  same rewrite as `_json_schema` in tests/prompts/_shared/openai_call.py. */
export function toJsonSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(toJsonSchema);
  if (s && typeof s === "object") {
    return Object.fromEntries(Object.entries(s).map(([k, v]) =>
      [k, k === "type" && typeof v === "string" ? v.toLowerCase() : toJsonSchema(v)]));
  }
  return s;
}

const lang = (v: unknown): string => boundPromptField(String(v), PROMPT_FIELD_CAPS.language, "single-line");
const sentence = (v: unknown): string => boundPromptField(String(v), PROMPT_FIELD_CAPS.sentence, "single-line");
const briefing = (v: unknown): string => boundPromptField(String(v), PROMPT_FIELD_CAPS.briefing, "single-line");

// --- practice generators -----------------------------------------------------

type GenKind = "mc" | "fb" | "fm" | "lf" | "lw";

/** The generator kinds that were measured (results.md), and nothing else. */
const GENERATOR_KINDS: Readonly<Record<string, GenKind>> = {
  practice_gen_mc: "mc",
  practice_gen_p2n: "mc",
  practice_gen_n2p: "mc",
  practice_gen_lap: "mc",
  practice_gen_fb: "fb",
  practice_gen_fm: "fm",
  practice_gen_lf: "lf",
  practice_gen_lw: "lw",
};

const GEN_SI: Readonly<Record<GenKind, string>> = {
  mc: LUNA_PRACTICE_MC_SI,
  fb: LUNA_PRACTICE_FB_SI,
  fm: LUNA_PRACTICE_FM_SI,
  lf: LUNA_PRACTICE_LF_SI,
  lw: LUNA_PRACTICE_LW_SI,
};

const LEVELS = ["", "Beginner", "Basic", "Improver", "Intermediate", "Conversational", "Comfortable", "Advanced"];

/** luna_prompts.py MC_TYPE_RULES, verbatim. */
const MC_TYPE_RULES: Readonly<Record<string, string>> = {
  "multiple-choice":
    "Decide which language the options are in by what the learner must produce. If the brief asks for the {P} word " +
    "for a meaning, options are {P}, the correct one is the target phrase, and practiceText is \"\" (the {N} cue goes in " +
    "the instruction). Otherwise show the {P} target in a short sentence as practiceText and the options are {N} meanings.",
  "practice-to-native":
    "practiceText is the {P} target (a short sentence containing it if it is a single word). Options are four {N} " +
    "translations of the whole practiceText; three of them get the key word or phrase wrong. optionGlosses all \"\".",
  "native-to-practice":
    "practiceText is \"\". The instruction gives the {N} meaning to translate. Options are four {P} words or phrases " +
    "from the same area; the correct one is the target phrase.",
  "listen-and-pick":
    "The learner hears practiceText as audio and does not see it. practiceText is the {P} target. Options are four {P} " +
    "words or phrases that sound alike; the correct one is what was said. The instruction is a short cue like " +
    "\"What did you hear?\".",
};

const S = { type: "string" } as const;
const KEY = { type: "string", enum: ["a", "b", "c", "d"] } as const;
const OPT = {
  type: "object",
  properties: { a: S, b: S, c: S, d: S },
  required: ["a", "b", "c", "d"],
  additionalProperties: false,
} as const;
const strictObject = (props: Record<string, unknown>): Record<string, unknown> => ({
  type: "object",
  properties: props,
  required: Object.keys(props),
  additionalProperties: false,
});

/** luna_prompts.py SCHEMAS: no `thinking` / `intent` (the client schemas take
 *  both as optional, src/lib/practiceGenerator/schemas.ts). */
export const LUNA_GENERATOR_SCHEMAS: Readonly<Record<GenKind, Record<string, unknown>>> = {
  mc: strictObject({ instruction: S, practiceText: S, options: OPT, correctKey: KEY, explanation: S, optionGlosses: OPT }),
  fb: strictObject({ instruction: S, practiceText: S, options: OPT, correctKey: KEY, explanation: S, optionGlosses: OPT }),
  fm: strictObject({
    correctedText: S, practiceText: S, instruction: S, mistakeIndex: { type: "integer" },
    options: OPT, correctKey: KEY, correctAnswer: S, explanation: S,
  }),
  lf: strictObject({ instruction: S, practiceText: S, correctAnswer: S, explanation: S }),
  lw: strictObject({ instruction: S, practiceText: S, correctAnswer: S, explanation: S }),
};

/** Python's round(): half to even, as the measurement computed the level. */
function roundHalfEven(x: number): number {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r;
}

function levelLine(difficulty: number): string {
  const lv = Math.max(1, Math.min(7, roundHalfEven(difficulty)));
  return `${LEVELS[lv]} (${lv}/7)`;
}

function generatorSi(kind: GenKind, p: string, n: string): string {
  return fillLanguages(GEN_SI[kind].split("{COMMON}").join(LUNA_PRACTICE_COMMON), p, n);
}

function resolveGenerator(kind: GenKind, raw: Record<string, unknown>): LunaClientPrompt | null {
  const spec = raw.spec as { type: string; prompt: string; flashcard: { phrase: string; translation: string } };
  const p = lang(raw.practice);
  const n = lang(raw.native);
  const lines = [
    `Level: ${levelLine(raw.difficulty as number)}`,
    `Question type: ${spec.type}`,
    `Brief: ${briefing(spec.prompt)}`,
    `Target: ${sentence(spec.flashcard.phrase)} (${p}) = ${sentence(spec.flashcard.translation)} (${n})`,
  ];
  if (kind === "mc") {
    const rules = MC_TYPE_RULES[spec.type];
    // Not a measured combination: Gemini only.
    if (!rules) return null;
    lines.push(`Type rules: ${fillLanguages(rules, p, n)}`);
  }
  return {
    providerCategory: "practice_generate",
    systemInstruction: generatorSi(kind, p, n),
    prompt: lines.join("\n"),
    maxOutputTokens: 8192,
    responseSchema: LUNA_GENERATOR_SCHEMAS[kind],
    // MSG-PIPE-31.4 — without strict mode Luna once nested correctKey in options.
    strictSchema: true,
  };
}

// --- planner -----------------------------------------------------------------

const EXACTLY_LINE = "SLOT LAYOUT: produce EXACTLY";
const DEFAULT_LINE = "SLOT LAYOUT (default, unless USER INTENT says otherwise):";

/** The production planner user prompt minus its LANGUAGE MAPPING preamble (the
 *  Luna SI names the languages itself). With a USER INTENT outside review
 *  mode, the layout line loses its EXACTLY: Luna obeys the closer, louder line
 *  over the SI's override rule (results.md). */
export function lunaPlannerUserPrompt(productionPrompt: string, raw: Record<string, unknown>): string {
  const cut = productionPrompt.indexOf("\n\n");
  const user = cut === -1 ? productionPrompt : productionPrompt.slice(cut + 2);
  const intent = typeof raw.custom === "string" && raw.custom.length > 0;
  return intent && raw.reviewMode !== true ? user.replace(EXACTLY_LINE, DEFAULT_LINE) : user;
}

// --- resolver ----------------------------------------------------------------

const EXPLAIN_TAIL = (native: string) => `\n\nWrite your explanation in ${native}.`;

/**
 * The OpenAI request for a client-direct call, or null when the kind has no
 * measured Luna prompt (or the spec does not build: the Gemini side answers
 * that 400 itself). `built` is the production resolution when the caller
 * already has it.
 */
export function resolveLunaPrompt(
  category: string,
  promptSpec: unknown,
  built: PracticeResolution = resolveServerPrompt(category, promptSpec),
): LunaClientPrompt | null {
  if (built.status !== "built") return null;
  const raw = promptSpec as Record<string, unknown>;
  switch (category) {
    case "explain":
    case "explain_practice": {
      const p = lang(raw.practice);
      const n = lang(raw.native);
      return {
        providerCategory: category,
        systemInstruction: fillLanguages(category === "explain" ? LUNA_EXPLAIN_SI : LUNA_EXPLAIN_PRACTICE_SI, p, n),
        // Without the tail Luna drifts into the practice language (README).
        prompt: built.prompt + EXPLAIN_TAIL(n),
        maxOutputTokens: 2048,
      };
    }
    case "explain_phrase":
      // run_ph.py luna-port: the production prompt as is, no tail.
      return { providerCategory: "explain_phrase", systemInstruction: built.systemInstruction, prompt: built.prompt, maxOutputTokens: 1500 };
    case "topic_classify":
    case "chat_import_extract":
      return {
        providerCategory: category,
        systemInstruction: built.systemInstruction,
        prompt: built.prompt,
        maxOutputTokens: category === "topic_classify" ? 256 : 4096,
        ...(built.responseSchema ? { responseSchema: toJsonSchema(built.responseSchema) as Record<string, unknown> } : {}),
      };
    case "practice_planner_stream":
      return {
        providerCategory: "practice_planner",
        systemInstruction: fillLanguages(LUNA_PRACTICE_PLAN_SI, lang(raw.practice), lang(raw.native)),
        prompt: lunaPlannerUserPrompt(built.prompt, raw),
        maxOutputTokens: 8192,
      };
    default: {
      const kind = GENERATOR_KINDS[category];
      return kind ? resolveGenerator(kind, raw) : null;
    }
  }
}
