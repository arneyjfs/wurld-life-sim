/**
 * Topic-classifier prompt builders — the closed-set classifier of
 * docs/specs/topics.md §2. Single source of truth for the system instruction,
 * user prompt and response schema of the `topic_classify` kind, used by:
 *   - `geminiGenerate` via `resolveServerPrompt` (the client sends
 *     `{ kind: "topic_classify", phrase, translation, themes }`, SRV-PROMPT-1);
 *   - `assignTutorCardTopics` in `index.ts` (tutor-added cards, TUTOR-ACTION-6);
 *   - `scripts/topics-recategorise.mjs` (TOPIC-SET-9) via `functions/lib/`;
 *   - the prompt-eval suite `tests/prompts/topic-classify/` via the dump written
 *     by `scripts/build-prompts.mjs`.
 *
 * TOPIC-SET-4 — the theme glossary is DATA: it is rendered from the live
 * `/topics` theme docs at call time (`- name — description`, one line per
 * theme, `other` excluded), so editing a description or adding a theme changes
 * the prompt with no deploy. The rest of the SI text was measured
 * (docs/specs/topics.md, design decisions, 88.8% acceptable-pick rate) — do not
 * reword it without re-running `npm run test:prompts -- --suite=topic-classify`
 * and the measurement in `scripts/measure/topic_regroup_eval.py`.
 *
 * TOPIC-SET-5 — the model picks one theme or `"other"`; it never mints. The
 * schema's `topic` enum is the theme names plus `"other"`, and `subject` (1–3
 * English words) is written first so the model names what the card is about
 * before it chooses (the SI's rule 1).
 */

/** The escape theme (TOPIC-SET-5). A real `/topics` doc, never listed to the
 *  model as a theme, always present in the schema enum. */
export const OTHER_TOPIC = "other";

/** One theme of the live set: a `/topics` doc's name + description. A legacy
 *  bundle's bare `existingTopics` names arrive with no description
 *  (TOPIC-SET-7.1). */
export type TopicTheme = { name: string; description?: string };

/** The measured system instruction. `{THEMES}` is replaced by the glossary. */
const SYSTEM_INSTRUCTION_TEMPLATE = `You sort a language-learning flashcard into one of a learner's PRACTICE THEMES.

Themes exist to build practice sessions: each one gathers cards a learner would study together, so each must be BROAD — wide enough to hold dozens of cards. Given a phrase (in the language being learned), its translation when available, and the list of themes that exist, pick the ONE theme where a learner would most naturally meet and use this card. Only when no listed theme covers the card's situation at all, return "other".

HOW TO CHOOSE
1. First write "subject": 1–3 plain English words naming what the card is about ("flat tyre", "court case", "feeling guilty", "greeting"). Then ask: in what situation of life does someone say or hear it? That situation's theme wins.
2. Part of speech never decides. An adjective, a verb and a noun go by situation: "crevé" (of a tyre) → about town; "bruyant" (noisy neighbours) → home; "réfléchir" (to think it over) → thinking & learning.
3. Broad themes absorb their sub-subjects. Never look for a narrower home: a church, a museum, a train, a shop, a holiday are all "about town"; a sofa, a chore, sleep are "home"; a pet is "nature".
4. Words that could fit several themes go where they are MOST OFTEN used, not where they could technically sit.

THE THEMES AND WHAT EACH COVERS
{THEMES}

"OTHER" IS RARE
The theme list is fixed; you cannot create a theme. Return "other" only when the card's situation lies outside EVERY theme as described above — "other" cards are reviewed later to decide whether a new theme is needed. Before choosing it, check each theme's coverage once more: a loose but honest fit beats "other". But do not force a card into a theme that is plainly about something else just to avoid "other".

Return ONLY valid JSON matching the provided schema.
`;

/** Any run of whitespace, line breaks included — a glossary entry is ONE line
 *  (SRV-PROMPT-17: a break inside a value opens a line the model reads as a new
 *  instruction). */
const WHITESPACE_RUN = /\s+/g;

/**
 * The themes as the model sees them: names lowercased + trimmed, empty names,
 * duplicates (first wins) and `other` dropped, descriptions collapsed to one
 * line. Every builder below goes through this, so SI, user prompt and schema
 * enum always list the same names in the same order.
 */
export function normaliseTopicThemes(themes: ReadonlyArray<TopicTheme>): TopicTheme[] {
  const seen = new Set<string>();
  const out: TopicTheme[] = [];
  for (const t of themes) {
    const name = t.name.trim().toLowerCase();
    if (!name || name === OTHER_TOPIC || seen.has(name)) continue;
    seen.add(name);
    const description = (t.description ?? "").replace(WHITESPACE_RUN, " ").trim();
    out.push(description ? { name, description } : { name });
  }
  return out;
}

/** The theme names offered to the model, `other` excluded. */
export function topicThemeNames(themes: ReadonlyArray<TopicTheme>): string[] {
  return normaliseTopicThemes(themes).map((t) => t.name);
}

/**
 * TOPIC-SET-4 — the system instruction, with the glossary rendered from the
 * live theme set: `- name — description` per theme (`- name` when there is no
 * description), in the order given, `other` excluded.
 */
export function topicClassifySystemInstruction(themes: ReadonlyArray<TopicTheme>): string {
  const glossary = normaliseTopicThemes(themes)
    .map((t) => (t.description ? `- ${t.name} — ${t.description}` : `- ${t.name}`))
    .join("\n");
  // split/join, not String.replace: a description holding `$&` must not be
  // read as a replacement pattern.
  return SYSTEM_INSTRUCTION_TEMPLATE.split("{THEMES}").join(glossary);
}

/** The per-call user prompt. Phrase and translation go in verbatim (the
 *  classifier needs the surface form); the theme names are joined with `, `,
 *  `other` excluded — the line that was measured. */
export function topicClassifyUserPrompt(
  phrase: string,
  translation: string,
  themes: ReadonlyArray<TopicTheme>,
  /** TOPIC-SET-7 — the card's practice language, when known. Without it a
   *  false friend reads in the wrong language (French "pain" = bread went to
   *  health). Accuracy-neutral on the 463-card measurement, within noise. */
  practiceLanguage?: string,
): string {
  const lang = practiceLanguage?.trim();
  return (
    (lang ? `Phrase (${lang}): "${phrase}"\n` : `Phrase: "${phrase}"\n`) +
    `Translation: "${translation}"\n` +
    `Available topics (use one of these if at all possible): ${topicThemeNames(themes).join(", ")}`
  );
}

/**
 * TOPIC-SET-5 — structured-output schema. `topic` is constrained to the theme
 * names plus `other`, so the model cannot mint or misspell a theme; `subject`
 * comes first in `propertyOrdering` so it is generated before the choice.
 */
export function topicClassifySchema(themes: ReadonlyArray<TopicTheme>) {
  return {
    type: "OBJECT",
    properties: {
      subject: { type: "STRING" },
      topic: { type: "STRING", enum: [...topicThemeNames(themes), OTHER_TOPIC] },
    },
    required: ["subject", "topic"],
    propertyOrdering: ["subject", "topic"],
  };
}

/**
 * TOPIC-SET-5/6 — read a parsed model answer. Returns the topic to stamp (one
 * of the theme names or `other`) and the subject (lowercased, may be empty),
 * or `null` when the answer is not an object or its topic is outside the enum —
 * in which case the caller writes NOTHING (TOPIC-SET-6).
 */
export function parseTopicClassification(
  parsed: unknown,
  themes: ReadonlyArray<TopicTheme>,
): { topic: string; subject: string } | null {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const { topic, subject } = parsed as { topic?: unknown; subject?: unknown };
  if (typeof topic !== "string") return null;
  const t = topic.trim().toLowerCase();
  if (t !== OTHER_TOPIC && !topicThemeNames(themes).includes(t)) return null;
  const s = typeof subject === "string" ? subject.replace(WHITESPACE_RUN, " ").trim().toLowerCase() : "";
  return { topic: t, subject: s };
}

/**
 * TOPIC-SET-4 — the live theme set from `/topics` doc data: docs with a string
 * name and a non-empty description. Legacy topics (no description) are not
 * themes; `other` is dropped (it is always in the enum, never listed).
 */
export function themesFromTopicDocs(
  docs: ReadonlyArray<Record<string, unknown>>,
): TopicTheme[] {
  const themes: TopicTheme[] = [];
  for (const d of docs) {
    if (typeof d.name !== "string" || typeof d.description !== "string") continue;
    if (!d.description.trim()) continue;
    themes.push({ name: d.name, description: d.description });
  }
  return normaliseTopicThemes(themes);
}
