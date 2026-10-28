import { describe, expect, it } from "vitest";
import {
  buildResumeRecapUserPrompt,
  RESUME_RECAP_EVENT_COUNT,
  resumeRecapSystemInstruction,
  type ResumeRecapPromptInput,
} from "../prompts/lifeResumeRecap";

/**
 * SRV-PROMPT-8..13 batch 3 — the "Previously on…" recap prompt, now built by
 * the server.
 *
 * THESE ASSERTIONS MOVED (SRV-PROMPT-3 / PRACTICE-OWN-8). They lived at
 * `src/lib/life/prompts/resumeRecap.test.ts`, against the client module this
 * batch deletes. Landing them here rather than deleting them with the file is
 * the rule SRV-PROMPT-3 states in terms: the server copy had NO coverage of its
 * own, so dropping them would retire this prompt's only tests at the moment it
 * became the only copy.
 *
 * WHAT IS NEW HERE, and why it is not padding:
 *
 *  - The SIZE GATE (SRV-PROMPT-9) at the bottom. The legacy path capped
 *    `prompt` and `systemInstruction` SEPARATELY; the built path caps their SUM
 *    and answers `too-large`. This prompt takes the whole story log and a
 *    40-event window, so unlike batches 1 and 2 the gate is not obviously
 *    satisfied and is asserted against the two terms that actually grow.
 *  - The `<chapter>` REGISTER pick. `playerTeaser ?? premise` used to run at the
 *    call site; it is the rule deciding which register the model is shown, so it
 *    moved with the prompt and is asserted here.
 */

const base: ResumeRecapPromptInput = {
  characterName: "Marc",
  practiceLanguage: "French",
  systemLanguage: "English",
  storyLines: [],
  events: [],
};

const beat = (practiceText: string, speakerName = "Sophie") => ({
  kind: "beat",
  speaker: "npc",
  speakerName,
  practiceText,
});

describe("resumeRecapSystemInstruction — LIFE-FLOW-5 / LIFE-LANG-8", () => {
  const si = resumeRecapSystemInstruction({
    systemLanguage: "English",
    practiceLanguage: "French",
  });

  it("LIFE-LANG-8 — names the SYSTEM language as the recap language", () => {
    expect(si).toContain("English");
    expect(si).toMatch(/in English ONLY/);
  });

  it("LIFE-LANG-8 — does NOT ask for a bilingual / practice-language recap", () => {
    expect(si).not.toContain("practiceText");
    expect(si).not.toContain("nativeText");
    expect(si).not.toMatch(/per language/i);
    expect(si).toMatch(/bilingual|dual-language/i);
    expect(si).toMatch(/do NOT translate/i);
  });

  it("LIFE-LANG-8 — the practice language is context-only, not an output channel", () => {
    expect(si).toContain("French");
    expect(si).toMatch(/learning French/);
    expect(si).toMatch(/exactly as written/);
  });

  it("LIFE-LANG-8 — emits a single `text` output field + strict JSON", () => {
    expect(si).toContain('"text"');
    expect(si).toMatch(/strict-JSON/);
    expect(si).toMatch(/No markdown fences/);
  });

  it("LIFE-FLOW-5 — carries the spoiler-safety rules", () => {
    expect(si).toMatch(/Never invent/i);
    expect(si).toMatch(/foreshadow/i);
  });

  it("LIFE-FLOW-5 — caps the recap at 2-3 sentences (single language)", () => {
    expect(si).toContain("2-3 sentences");
    expect(si).not.toContain("2-3 sentences per language");
  });

  it("LIFE-LANG-8 — resolves the system language from the caller (distinct from native)", () => {
    const german = resumeRecapSystemInstruction({
      systemLanguage: "German",
      practiceLanguage: "French",
    });
    expect(german).toMatch(/in German ONLY/);
  });
});

describe("buildResumeRecapUserPrompt — LIFE-FLOW-5", () => {
  it("LIFE-FLOW-5 — emits character / chapter / storySoFar / recentEvents / task in order", () => {
    const out = buildResumeRecapUserPrompt({
      ...base,
      storyLines: ["STORY_MARKER happened."],
      chapter: {
        chapterNumber: 2,
        premise: "PREMISE_MARKER",
        playerTeaser: "TEASER_MARKER",
      },
      events: [beat("Salut !")],
    });
    const charIdx = out.indexOf("<character");
    const chapterIdx = out.indexOf("<chapter");
    const summaryIdx = out.indexOf("<storySoFar");
    const eventsIdx = out.indexOf("<recentEvents");
    const taskIdx = out.indexOf("<task");
    expect(charIdx).toBeGreaterThan(-1);
    expect(chapterIdx).toBeGreaterThan(charIdx);
    expect(summaryIdx).toBeGreaterThan(chapterIdx);
    expect(eventsIdx).toBeGreaterThan(summaryIdx);
    expect(taskIdx).toBeGreaterThan(eventsIdx);
    expect(out).toContain("STORY_MARKER");
    expect(out).toContain("number=\"2\"");
  });

  it("LIFE-WORLD-ARC-REGISTER — renders the spoiler-safe playerTeaser, never the planner premise", () => {
    // The register pick moved here WITH the prompt. It decides which of two
    // stored strings the model is shown, and the planner premise may name
    // tensions the player has not discovered — so leaving it at the call site
    // would keep the spoiler rule in the bundle.
    const out = buildResumeRecapUserPrompt({
      ...base,
      chapter: { chapterNumber: 2, premise: "PREMISE_MARKER", playerTeaser: "TEASER_MARKER" },
    });
    expect(out).toContain("TEASER_MARKER");
    expect(out).not.toContain("PREMISE_MARKER");
  });

  it("LIFE-WORLD-ARC-REGISTER — falls back to the premise for a legacy arc with no teaser", () => {
    const blank = buildResumeRecapUserPrompt({
      ...base,
      chapter: { chapterNumber: 2, premise: "PREMISE_MARKER", playerTeaser: "   " },
    });
    expect(blank).toContain("PREMISE_MARKER");
    const missing = buildResumeRecapUserPrompt({
      ...base,
      chapter: { chapterNumber: 3, premise: "PREMISE_MARKER" },
    });
    expect(missing).toContain("PREMISE_MARKER");
  });

  it("LIFE-MEM-2 — falls back to a <priorSummary> shim when there is no story log", () => {
    const out = buildResumeRecapUserPrompt({ ...base, legacySummary: "  LEGACY_MARKER  " });
    expect(out).toContain("<priorSummary>");
    expect(out).toContain("LEGACY_MARKER");
    expect(out).not.toContain("<storySoFar>");
    // Trimmed, as the client builder trimmed it before rendering.
    expect(out).not.toContain("  LEGACY_MARKER");
  });

  it("LIFE-MEM-2 — the story log WINS over a legacy summary when both are present", () => {
    const out = buildResumeRecapUserPrompt({
      ...base,
      storyLines: ["STORY_MARKER"],
      legacySummary: "LEGACY_MARKER",
    });
    expect(out).toContain("<storySoFar>");
    expect(out).toContain("STORY_MARKER");
    expect(out).not.toContain("LEGACY_MARKER");
  });

  it("LIFE-FLOW-5 — omits the chapter tag when no arc is active", () => {
    expect(buildResumeRecapUserPrompt(base)).not.toContain("<chapter");
  });

  it("LIFE-LANG-8 — surfaces the effective system language + single `text` task", () => {
    const out = buildResumeRecapUserPrompt(base);
    expect(out).toContain('systemLanguage="English"');
    expect(out).toContain('"text"');
    expect(out).not.toContain("practiceText and nativeText");

    const german = buildResumeRecapUserPrompt({ ...base, systemLanguage: "German" });
    expect(german).toContain('systemLanguage="German"');
  });

  it("LIFE-FLOW-5 — flags an empty story-so-far (no story log, no legacy summary)", () => {
    const out = buildResumeRecapUserPrompt(base);
    expect(out).toContain('<storySoFar empty="true"/>');
    expect(out).toContain('<recentEvents empty="true"/>');
  });

  it("LIFE-FLOW-5 — renders only beat + decision events", () => {
    const out = buildResumeRecapUserPrompt({
      ...base,
      events: [
        beat("Bonjour"),
        { kind: "decision", text: "Dire oui" },
        { kind: "correction", text: "veux" },
        { kind: "npc_introduced", text: "X" },
      ],
    });
    expect(out).toContain('kind="beat"');
    expect(out).toContain('kind="decision"');
    expect(out).toContain("Dire oui");
    expect(out).not.toContain('kind="correction"');
    expect(out).not.toContain('kind="npc_introduced"');
    // A `correction` row carrying a `text` must not leak through the decision
    // branch — the filter is on KIND, not on which field happens to be set.
    expect(out).not.toContain("veux");
  });

  it("LIFE-FLOW-5 — drops a beat with no practiceText and a decision with no text", () => {
    const out = buildResumeRecapUserPrompt({
      ...base,
      events: [
        { kind: "beat", speaker: "npc", practiceText: "" },
        { kind: "decision", text: "" },
        beat("kept"),
      ],
    });
    expect(out.match(/<event /g) ?? []).toHaveLength(1);
    expect(out).toContain("kept");
  });

  it("LIFE-FLOW-5 — a beat with no speaker renders as the narrator", () => {
    const out = buildResumeRecapUserPrompt({
      ...base,
      events: [{ kind: "beat", practiceText: "Il pleuvait." }],
    });
    expect(out).toContain('speaker="narrator"');
    // No empty name attribute for a beat with no speakerName.
    expect(out).not.toContain('name=""');
  });

  it("LIFE-FLOW-5 — caps the event window at RESUME_RECAP_EVENT_COUNT", () => {
    const many = Array.from({ length: RESUME_RECAP_EVENT_COUNT + 2 }, (_, i) =>
      beat(`line-${i + 1}`),
    );
    const out = buildResumeRecapUserPrompt({ ...base, events: many });
    expect(out.match(/<event /g) ?? []).toHaveLength(RESUME_RECAP_EVENT_COUNT);
    expect(out).not.toContain("line-1<");
    expect(out).not.toContain("line-2<");
    expect(out).toContain(`line-${RESUME_RECAP_EVENT_COUNT + 2}`);
  });

  it("LIFE-FLOW-5 — the cap is applied AFTER the kind filter, not before", () => {
    // 10 renderable beats preceded and interleaved with noise. Slicing first
    // would render fewer than ten and silently shorten the recap's input.
    const noise = { kind: "correction", text: "x" };
    const events = [
      ...Array.from({ length: 12 }, () => noise),
      ...Array.from({ length: RESUME_RECAP_EVENT_COUNT }, (_, i) => beat(`keep-${i + 1}`)),
    ];
    const out = buildResumeRecapUserPrompt({ ...base, events });
    expect(out.match(/<event /g) ?? []).toHaveLength(RESUME_RECAP_EVENT_COUNT);
    expect(out).toContain("keep-1<");
  });

  it("LIFE-FLOW-5 — escapes XML-breaking characters", () => {
    const out = buildResumeRecapUserPrompt({
      ...base,
      characterName: 'M&M "the kid" <Marc>',
      events: [beat("a < b & c")],
    });
    expect(out).toContain("M&amp;M &quot;the kid&quot; &lt;Marc&gt;");
    expect(out).toContain("a &lt; b &amp; c");
  });

  it("SRV-PROMPT-8..13 — a speakerName closes its own attribute", () => {
    // Model-authored, so the escaping moved to the server WITH the prompt.
    const out = buildResumeRecapUserPrompt({
      ...base,
      events: [beat("Bonjour", 'Sophie" injected="yes')],
    });
    expect(out).not.toContain('injected="yes"');
    expect(out).toContain("&quot;");
  });
});

/**
 * SRV-PROMPT-9 — THE GATE, and the reason this batch exists.
 *
 * The legacy path capped `prompt` and `systemInstruction` SEPARATELY against
 * `MAX_PROMPT_BYTES`; the built path caps their SUM and rejects `too-large`. A
 * category that fits today can therefore stop fitting on the day it moves, with
 * no change to its content — so the size is asserted here rather than measured
 * once and forgotten.
 *
 * ⚠ THE FIXTURE IS SYNTHETIC. `SRV-PROMPT-9` says the archived worlds live in
 * `.playthroughs/`, which is gitignored and absent from a fresh checkout, so
 * this is BUILT to the maxima the code itself enforces rather than loaded from a
 * real save:
 *   - `storyLines` at 60 = `STORY_LOG_CAP` (`src/lib/life/commitNode.ts`), the
 *     hard cap `capStoryLog` holds the log to.
 *   - 40 events = `DEFAULT_LIMIT` in `src/hooks/useLifeEvents.ts`, the whole
 *     listener window the exit hook hands in — every one of them renderable, so
 *     the kind filter removes nothing.
 * Both terms are BOUNDED IN CODE, which is what makes this measurement a
 * ceiling rather than a sample: there is no input to this prompt that grows
 * without limit.
 */
describe("SRV-PROMPT-9 — assembled size against the byte cap", () => {
  const CAP = 65_536;
  const bytes = (s: string) => Buffer.byteLength(s, "utf8");

  const LONG_LINE =
    "You read the roster upside down across the clerk's desk and learned the week you needed was already promised to a name you did not recognise, and you said nothing about it to anyone.";
  const LONG_BEAT =
    "« Vous savez, le registre des écluses pour le printemps est déjà arrêté, et personne ici ne va vous le dire en face — alors si vous voulez descendre avant la fonte, il faudra trouver quelqu'un qui vous doit quelque chose, et je ne suis pas cette personne. »";

  const worstCase: ResumeRecapPromptInput = {
    characterName: "Marc Lavalle",
    practiceLanguage: "French",
    systemLanguage: "English",
    chapter: {
      chapterNumber: 9,
      premise: "planner register, never rendered",
      playerTeaser:
        "Winter is coming down the valley and the roster is still not yours. Someone in the customs house has decided to be useful, which is rarely free.",
    },
    // STORY_LOG_CAP.
    storyLines: Array.from({ length: 60 }, (_, i) => `Log line ${i + 1}: ${LONG_LINE}`),
    // The full useLifeEvents window, all renderable.
    events: Array.from({ length: 40 }, (_, i) => ({
      kind: "beat",
      speaker: "npc",
      speakerName: `Principal ${i % 3}`,
      practiceText: LONG_BEAT,
    })),
  };

  it("SRV-PROMPT-9 — SI + the worst case the code permits stays under a third of the cap", () => {
    const si = resumeRecapSystemInstruction({
      systemLanguage: "English",
      practiceLanguage: "French",
    });
    const sum = bytes(si) + bytes(buildResumeRecapUserPrompt(worstCase));
    expect(sum).toBeLessThan(CAP / 3);
  });

  it("SRV-PROMPT-9 — the event window is O(1): 40 events cost no more than 10", () => {
    // The gate's real safety is that both growing terms are capped in code.
    // The window one is capped HERE, so a later change raising
    // `RESUME_RECAP_EVENT_COUNT` shows up as a size change rather than silently
    // scaling the prompt with the listener's limit.
    const ten = { ...worstCase, events: worstCase.events.slice(0, 10) };
    expect(bytes(buildResumeRecapUserPrompt(worstCase))).toBe(
      bytes(buildResumeRecapUserPrompt(ten)),
    );
  });
});
