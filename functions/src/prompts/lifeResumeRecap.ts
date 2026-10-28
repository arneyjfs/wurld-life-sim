/**
 * LIFE-FLOW-5 / LIFE-LANG-8 — the "Previously on…" resume-recap prompt.
 *
 * SRV-PROMPT-8..13 batch 3. Moved here from `src/lib/life/prompts/resumeRecap.ts`,
 * which is DELETED (SRV-PROMPT-3): a retired client prompt module does not stay
 * importable. The client now sends `promptSpec: {kind:'life_resume_recap', …}`
 * and `prompt: ''`; `resolveServerPrompt` validates the spec and builds both
 * halves from this file.
 *
 * ── WHY THIS ONE COULD MOVE AND `life_world_arc` COULD NOT ──────────────────
 *
 * They were batch 3 together, because both already fail NON-FATALLY. Only this
 * one cleared SRV-PROMPT-9's size gate. The gate matters here in a way it did
 * not for batches 1 and 2, whose inputs were scalars: the legacy path caps
 * `prompt` and `systemInstruction` SEPARATELY against `MAX_PROMPT_BYTES`, the
 * built path caps their SUM, so migrating a category halves its byte budget.
 *
 * Every input to THIS prompt is bounded by code:
 *   - `storyLines` — `capStoryLog` holds the log to `STORY_LOG_CAP` (60).
 *   - `events` — the caller hands in the whole `useLifeEvents` window (40), and
 *     `RESUME_RECAP_EVENT_COUNT` (10) caps what renders, so the block is O(1).
 *   - `chapter` — one arc.
 * Measured worst case against those maxima: ~28% of the 65,536 cap, asserted in
 * `functions/src/__tests__/lifeResumeRecap.test.ts`.
 *
 * `buildWorldArcPrompt`, by contrast, renders `previousArcs`, which
 * `readCompletedArcs` returned UNCAPPED (LIFE-WORLD-ARC-7 now caps it at the
 * call site) — one entry per completed chapter, for
 * the life of the world. It stays on the legacy path until that input is
 * bounded, which is a behaviour change rather than a size fix.
 *
 * ── WHAT THE SPEC CARRIES, AND WHAT IT DELIBERATELY DOES NOT ────────────────
 *
 * The client does NOT send a `LifeWorld`. It sends the six things this prompt
 * reads, and the server rebuilds them field-by-field so an extra key on the
 * wire cannot reach a template.
 *
 * `systemLanguage` arrives ALREADY RESOLVED (`world.systemLanguage ??
 * world.nativeLanguage`). It was resolved twice before — once by the call site
 * for the SI and once inside the prompt builder for the `<character>` tag — and
 * two copies of one rule is how they come to disagree.
 *
 * The CHAPTER REGISTER PICK stays here (LIFE-WORLD-ARC-REGISTER): both stored
 * strings travel and the prompt chooses `playerTeaser || premise`. That rule
 * decides whether the model is shown a spoiler-safe teaser or the planner
 * premise, which may name tensions the player has not discovered — exactly the
 * kind of rule that should be correctable by `deploy:prod:functions` rather
 * than an App Store review.
 *
 * The event FILTER, the narrator default, the empty-row skip and the 10-row cap
 * also stay here: they decide what the model sees, which is the prompt's
 * business, not the caller's.
 */

/** How many trailing beat/decision events the prompt includes. */
export const RESUME_RECAP_EVENT_COUNT = 10;

/**
 * One row of the caller's event window, narrowed to the four payload strings
 * this prompt has ever read. The caller sends its whole window; the filter and
 * the cap below decide what renders.
 */
export type ResumeRecapEventRow = {
  kind: string;
  speaker?: string;
  speakerName?: string;
  practiceText?: string;
  text?: string;
};

export type ResumeRecapPromptInput = {
  characterName: string;
  practiceLanguage: string;
  /** Effective system language — the language the recap is written in. Resolved
   *  by the caller as `world.systemLanguage ?? world.nativeLanguage`. */
  systemLanguage: string;
  /** The active chapter, when there is one. BOTH registers travel; the builder
   *  picks (LIFE-WORLD-ARC-REGISTER). */
  chapter?: { chapterNumber: number; premise: string; playerTeaser?: string };
  /** WS1-C / LIFE-MEM-2 — the durable spine, `world.storyLog.entries`. */
  storyLines: readonly string[];
  /** Pre-cutover worlds only: the frozen `rollingSummary`. */
  legacySummary?: string;
  /** The listener window, OLDEST → NEWEST. */
  events: readonly ResumeRecapEventRow[];
};

export function resumeRecapSystemInstruction(opts: {
  systemLanguage: string;
  practiceLanguage: string;
}): string {
  const { systemLanguage, practiceLanguage } = opts;
  return [
    `You write the "Previously on…" recap for a language-learning life simulator. The player has a persistent character living in a fictional world; they're learning ${practiceLanguage}. They are about to re-enter their world after time away, and your recap is the first thing they read.`,
    `YOUR JOB:`,
    `From the story-so-far log (<storySoFar>), the current chapter premise, and the most recent events, write a SHORT "Previously on…" recap of where the story stands — warm TV-recap register, second person ("you"), present tense for the current situation.`,
    `LANGUAGE (CRITICAL): This recap is NARRATION — the "story so far", NOT a language exercise. Write the ENTIRE recap in ${systemLanguage} ONLY. Do NOT translate it, do NOT add a ${practiceLanguage} version, do NOT produce a bilingual or dual-language recap.`,
    `LENGTH — HARD CAP: 2-3 sentences, ≤ 500 characters.`,
    `RULES:`,
    `- FAITHFUL ONLY: recap what actually happened in the input. Never invent characters, places, or events. Never speculate about or foreshadow what happens next — no teases, no "little do you know".`,
    `- End on the CURRENT open thread (the thing the player was in the middle of), so tapping Continue feels natural.`,
    `- Keep proper names and any ${practiceLanguage} vocabulary that appears in the input exactly as written — don't translate names or in-world terms.`,
    `OUTPUT FORMAT (CRITICAL):`,
    `Return a single strict-JSON object. No prose before or after. No markdown fences. The schema is:`,
    `{`,
    `  "text": "the recap, written in ${systemLanguage}"`,
    `}`,
    `Natural, fluent ${systemLanguage}.`,
  ].join("\n\n");
}

export function buildResumeRecapUserPrompt(input: ResumeRecapPromptInput): string {
  const sections: string[] = [];

  // LIFE-LANG-8: the recap is written in the SYSTEM language, so the in-prompt
  // metadata surfaces the effective system language rather than the native one
  // — it has to agree with the SI's output-language instruction.
  sections.push(
    `<character name="${escapeAttr(input.characterName)}" practiceLanguage="${escapeAttr(input.practiceLanguage)}" systemLanguage="${escapeAttr(input.systemLanguage)}"/>`,
  );

  if (input.chapter) {
    // LIFE-WORLD-ARC-REGISTER: the recap is a PLAYER-facing output, so it gets
    // the spoiler-safe playerTeaser. Legacy arcs have none and fall back to the
    // planner premise.
    const chapterText = input.chapter.playerTeaser?.trim() || input.chapter.premise;
    sections.push(
      `<chapter number="${input.chapter.chapterNumber}">${escapeText(chapterText)}</chapter>`,
    );
  }

  // WS1-C (LIFE-MEM-2): the durable spine is <storySoFar> (terse factual lines —
  // a strictly more faithful recap input than the old lossy rollingSummary).
  // Fall back to the legacy rollingSummary only for pre-cutover worlds.
  const storyLines = input.storyLines;
  const legacySummary = (input.legacySummary ?? "").trim();
  if (storyLines.length > 0) {
    sections.push(
      `<storySoFar>\n${storyLines.map((l) => `  <happened>${escapeText(l)}</happened>`).join("\n")}\n</storySoFar>`,
    );
  } else if (legacySummary.length > 0) {
    sections.push(`<priorSummary>\n${escapeText(legacySummary)}\n</priorSummary>`);
  } else {
    sections.push(`<storySoFar empty="true"/>`);
  }

  // The kind filter runs BEFORE the cap, so ten renderable rows are ten rows
  // however much other traffic the window carries.
  const recent = input.events
    .filter((e) => e.kind === "beat" || e.kind === "decision")
    .slice(-RESUME_RECAP_EVENT_COUNT)
    .map((e) => renderEvent(e))
    .filter((line) => line.length > 0)
    .join("\n");
  sections.push(
    recent.length > 0
      ? `<recentEvents>\n${recent}\n</recentEvents>`
      : `<recentEvents empty="true"/>`,
  );

  sections.push(
    `<task>Write the "Previously on…" recap per the SI, in the system language ONLY. Return a single JSON object with a "text" field.</task>`,
  );

  return sections.join("\n\n");
}

function renderEvent(e: ResumeRecapEventRow): string {
  if (e.kind === "beat") {
    const speaker = typeof e.speaker === "string" ? e.speaker : "narrator";
    const name =
      typeof e.speakerName === "string" && e.speakerName.length > 0
        ? ` name="${escapeAttr(e.speakerName)}"`
        : "";
    const text = typeof e.practiceText === "string" ? e.practiceText : "";
    if (text.length === 0) return "";
    return `<event kind="beat" speaker="${escapeAttr(speaker)}"${name}>${escapeText(text)}</event>`;
  }
  if (e.kind === "decision") {
    const text = typeof e.text === "string" ? e.text : "";
    if (text.length === 0) return "";
    return `<event kind="decision">${escapeText(text)}</event>`;
  }
  return "";
}

function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}
