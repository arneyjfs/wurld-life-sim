// ─────────────────────────────────────────────────────────────────────────
// Deterministic Gemini stub — Layer B test harness (the missing plumbing layer)
// ─────────────────────────────────────────────────────────────────────────
//
// When GEMINI_STUB=1 (set ONLY by the emulator-based e2e harness), `robustGenerate`
// routes through `stubGenerateResult` INSTEAD of a real Gemini call. The stub:
//
//   1. Produces deterministic, PARSEABLE output for each pipeline stage (analysis,
//      per-message convert, batch) so the REAL orchestration runs end-to-end —
//      seeding jobs, routing keys, threading gender, dispatching notifications —
//      exactly as in prod, minus the non-deterministic model.
//   2. RECORDS every call (label + system instruction + prompt + output) to the
//      `_e2eLlmCalls` collection so a test can assert the REQUEST-LEVEL contract:
//      "the convert for english_BritishAnnotatedSpanish was an ANNOTATE prompt with
//      target English and a female-speaker gender note" — i.e. the exact things the
//      flip (MSG-KEY-7) and gender (MSG-KEY-8) bugs got wrong.
//
// The stub deliberately produces MARKER content (not real translations) — content
// quality is Layer C's job (real Gemini + graders). Layer B asserts PLUMBING:
// which keys exist, in which mode, with which gender request, and that
// notifications dispatched. See docs/specs/test-harness-redesign.md.
//
// Branch selection (analysis) is driven by a leading sentinel token in the message
// text so tests deterministically pick ready/corrections/unclear without a real LLM:
//   "@@corrections …" → practice_corrections   "@@unclear …" → unclear
//   "@@ready-native …" → ready(native)          (default / "@@ready-practice") → ready(practice)
//   "@@native-vocab …" → ready(native) whose <vocab> lists up to three of the
//                        body's longer words, glossed "<word> (gloss)", so a
//                        test can see vocab-driven UI (QUIZ-BUILD-9 hints)
//   "@@3 …" → the same as "@@native-vocab", with a sentinel that counts as no
//             word, so a 3-word body stays under QUIZ-GATE-6's minimum
//   "@@stream-vocab …" → the same answer as "@@native-vocab", delivered to a
//                   streaming caller line by line (`stubStreamDelivery`,
//                   MSG-PIPE-32.7) so the sender's preview stream is observable
//   "@@suggest …" → ready(practice) + <nat>check</nat>, so the MSG-PIPE-22
//                   suggestion call runs and the stub answers it (suggestion-only dock)
//   "@@misread-vocab …" → ready(practice) whose <vocab> is read off the NATIVE
//                   row (MSG-VOCAB-10); the annotate-only repair call then lists
//                   the message's last word, so a test can assert the repair

import { getFirestore } from "firebase-admin/firestore";

export const GEMINI_STUB_ENABLED = process.env.GEMINI_STUB === "1";

/** Marker prefix on stub "translations" so tests can recognise stub output and it
 *  never accidentally equals the source (survives the echo guard, MSG-KEY-5). */
const STUB_TRANSLATION_PREFIX = "⟨stub⟩ ";

/** Marker on a stub CORRECTED practice text (the accept path) so a test can
 *  assert the corrected text propagated to the message + recipient convert. */
const STUB_CORRECTION_PREFIX = "⟨corrected⟩ ";

/** Minimal SDK `GenerateContentResult` shape that `robustGenerate` consumes:
 *  it reads `response.usageMetadata`, `response.candidates[0].content.parts`,
 *  and falls back to `response.text()`. */
function asResult(text: string) {
  return {
    response: {
      usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 8, totalTokenCount: 16 },
      candidates: [{ content: { parts: [{ text }] } }],
      text: () => text,
    },
  };
}

/** Pull the message/source text out of a stage prompt via the known markers the
 *  prompt builders use (`MESSAGE:` for analysis, `>>> TEXT TO … <<<` for convert). */
function extractSource(prompt: string): string {
  const convert = prompt.match(/>>> TEXT TO (?:ANNOTATE|TRANSLATE) <<<\n([\s\S]*)$/);
  if (convert) return convert[1].trim();
  // MSG-PIPE-26 — the multi-target batch names the message once, for all targets.
  const multi = prompt.match(/>>> MESSAGE <<<\n([\s\S]*)$/);
  if (multi) return multi[1].trim();
  const analysis = prompt.match(/\nMESSAGE:\n([\s\S]*)$/);
  if (analysis) return analysis[1].trim();
  return prompt.trim();
}

/**
 * MSG-PIPE-24.6 — the LANGUAGE block TELLS the model which bucket the message
 * is in ("Write detected=\"native\"" / "…\"practice\"") whenever the
 * deterministic classifier settled it; only when it abstained is the model
 * asked to decide. A real model transcribes what it was told, and so does the
 * stub: the sentinel decides the bucket ONLY on the abstain path. Without
 * this, a stub `detected=` that disagreed with the settled bucket sent every
 * such message down the parser's override branch (MSG-PIPE-24.7), which
 * needs a genuinely cross-language row the stub cannot produce — an
 * `analysis_failed` on every native-language send in the e2e gate.
 */
function settledBucketOf(prompt: string): "native" | "practice" | null {
  const m = /Write detected="(native|practice)"/.exec(prompt);
  return m ? (m[1] as "native" | "practice") : null;
}

function stripSentinel(text: string): { branch: string; body: string } {
  const m = text.match(/^@@(ready-native|native-vocab|stream-vocab|ready-practice|corrections|unclear|suggest|misread-vocab|3)\s+([\s\S]*)$/);
  // MSG-PIPE-32.7 — `stream-vocab` answers like `native-vocab`; only its delivery differs.
  if (m) return { branch: m[1] === "3" || m[1] === "stream-vocab" ? "native-vocab" : m[1], body: m[2] };
  return { branch: "ready-practice", body: text };
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Analysis output — the CURRENT unified-analysis shape (MSG-PIPE-17), which is
 * the only one `parseUnifiedAnalysis` accepts since the pre-2026-07
 * `<ready>/<edits>/<unclear>` shape was retired (2026-09-29, MSG-PIPE-17.6
 * RETIRED): one `<output format=… detected=…>` element, sentence rows with no
 * markup inside, an empty `<vocab>` LIST, then `<reflect>` OUTSIDE it.
 *
 * SLOT DISCIPLINE as the real prompt has it: the sender's own row is OMITTED
 * on READY (the server reconstitutes it from `originalText`, MSG-PIPE-17.3) and
 * only the cross-language rendering is emitted — a marker, since content is
 * Layer C's concern. EDITS carries the CORRECTED practice row plus its native
 * rendering; UNCLEAR carries `<suggestion>` blocks. `geminiStub.test.ts` runs
 * every branch through the real parser so this stays in step with it.
 */
function synthesizeAnalysis(source: string, prompt = ""): string {
  const { branch, body } = stripSentinel(source);
  const src = escapeXml(body);
  const nativeMarker = escapeXml(STUB_TRANSLATION_PREFIX + body);
  const reflect = "\n<vocab>\n</vocab>\n</output>\n<reflect>ok</reflect>";
  const settled = settledBucketOf(prompt);
  if (branch === "corrections") {
    // A deterministic single fix. The corrected practice text carries a distinct
    // marker so a test can assert the accepted correction actually propagated to
    // the stored message + the recipient re-translation (not just that the path
    // ran). Layer C grades real correction content; Layer B asserts plumbing.
    // The corrected row differs from the original, so MSG-PIPE-17.9's
    // substitution repair is not attempted and the row is taken as written.
    const corrected = escapeXml(STUB_CORRECTION_PREFIX + body);
    return (
      `<output format="EDITS" detected="${settled ?? "practice"}">\n` +
      `<fix w="x" c="x" r="stub correction reason" />\n` +
      `<practice>${corrected}</practice>\n<native>${nativeMarker}</native>` + reflect
    );
  }
  if (branch === "unclear") {
    return (
      `<output format="UNCLEAR" detected="${settled ?? "practice"}">\n` +
      `<suggestion><practice>${src}</practice><native>${nativeMarker}</native></suggestion>\n` +
      `<suggestion><practice>${src} (alt)</practice><native>${nativeMarker} (alt)</native></suggestion>\n` +
      `<description>stub: ambiguous</description>` + reflect
    );
  }
  // The settled bucket wins (it was TOLD, see `settledBucketOf`); the sentinel
  // decides only when the classifier abstained. `detected` names the language
  // the user wrote in; ONLY the other row is emitted — the sender's own row is
  // reconstituted server-side (MSG-PIPE-17.3).
  const detected = settled ?? (branch === "ready-native" || branch === "native-vocab" ? "native" : "practice");
  const row = detected === "practice"
    ? `<native>${nativeMarker}</native>`
    : `<practice>${nativeMarker}</practice>`;
  // MSG-PIPE-22.2 — the nat bit is written LAST, after <reflect>, outside
  // <output>, exactly where the parser reads it. Only on `@@suggest`: absent
  // means "no suggestion", so every other send stays one call.
  const nat = branch === "suggest" ? "\n<nat>check</nat>" : "";
  if (branch === "misread-vocab") {
    // MSG-VOCAB-10 — the reported shape: the list is read off the native row,
    // with a native gloss, so nothing can be flipped and the repair must run.
    const misread = `\n<vocab>\n${escapeXml(STUB_TRANSLATION_PREFIX.trim())} = ${escapeXml(STUB_TRANSLATION_PREFIX.trim())}\n</vocab>\n</output>\n<reflect>ok</reflect>`;
    return `<output format="READY" detected="${detected}">\n${row}` + misread;
  }
  if (branch === "native-vocab") {
    const words = [...new Set(body.split(/\s+/).map((w) => w.replace(/[^\p{L}]/gu, "")))]
      .filter((w) => w.length >= 5)
      .slice(0, 3);
    const lines = words.map((w) => `${escapeXml(w)} = ${escapeXml(w)} (gloss)\n`).join("");
    return `<output format="READY" detected="${detected}">\n${row}\n<vocab>\n${lines}</vocab>\n</output>\n<reflect>ok</reflect>`;
  }
  return `<output format="READY" detected="${detected}">\n${row}` + reflect + nat;
}

/** Per-message convert output. Annotate-only must preserve the source verbatim
 *  (MSG-KEY-4 guard); translate must DIFFER from it (MSG-KEY-5 echo guard). */
function synthesizeConvert(prompt: string): string {
  const isAnnotate = prompt.includes(">>> TEXT TO ANNOTATE <<<");
  const source = extractSource(prompt);
  // Failure-injection sentinel (tests only): a source containing "@@failtx"
  // makes every convert (translate/annotate) throw, so a test can exercise the
  // translation-failure recovery paths (e.g. BROADCAST-3 partial_failed).
  if (source.includes("@@failtx")) throw new Error("stub: forced convert failure (@@failtx)");
  const out = isAnnotate ? source : STUB_TRANSLATION_PREFIX + source;
  // MSG-VOCAB-10.3 — the repair call over a `@@misread-vocab` message lists
  // its last word, so the repaired underline is observable.
  if (isAnnotate && source.startsWith("@@misread-vocab")) {
    const last = source.match(/[\p{L}\p{N}'-]+(?=[^\p{L}\p{N}]*$)/u)?.[0] ?? "stub";
    return `<output>${out}\n<vocab>\n${last} = stub-repaired\n</vocab></output>`;
  }
  // TUTOR-ACTION-13 — the annotate call over an action card's lead-in lists
  // its first word, so the lead-in's underline is observable.
  if (isAnnotate && source === STUB_ACTION_LEAD_IN.practice) {
    return `<output>${out}\n<vocab>\n${firstWordVocab(source)}</vocab></output>`;
  }
  return `<output>${out}</output>`;
}

/** The bilingual lead-in every stub action card carries (TUTOR-ACTION). */
const STUB_ACTION_LEAD_IN = { native: "stub lead-in", practice: "stub lead-in (practice)" };

/** Marker on a stub NATURAL alternative (MSG-PIPE-22) — never equal to the
 *  sentence it improves on, so the duplicate guard (MSG-PIPE-17.7) lets it through. */
const STUB_NATURAL_PREFIX = "⟨natural⟩ ";

/** `first = ⟨gloss⟩` — a vocab line naming a word that really occurs in the
 *  sentence, since the parsers drop any entry whose span is not in it. */
function firstWordVocab(body: string): string {
  const first = (body.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}]/gu, "");
  return first ? `${first} = ⟨gloss⟩\n` : "";
}

/**
 * MSG-PIPE-22 — the dedicated suggestion call, in the `<out>` envelope
 * `parseSuggestNative` reads. Only reached when the analysis set the nat bit
 * (`@@suggest`). Rewrites the CORRECTED sentence when the prompt carries one
 * (MSG-PIPE-22.5), else the message; the routing sentinel is stripped.
 */
function synthesizeSuggest(prompt: string): string {
  const source =
    /^CORRECTED: (.*)$/m.exec(prompt)?.[1] ?? /^MESSAGE: (.*)$/m.exec(prompt)?.[1] ?? "";
  const { body } = stripSentinel(source.trim());
  const text = body || "stub";
  return (
    "<out>\n" +
    `<practice>${escapeXml(STUB_NATURAL_PREFIX + text)}</practice>\n` +
    `<native>${escapeXml(STUB_TRANSLATION_PREFIX + text)}</native>\n` +
    "<reason>stub: more natural</reason>\n" +
    `<vocab>\n${firstWordVocab(text)}</vocab>\n` +
    "</out>"
  );
}

/** Marker on a stub CLARIFIED rewrite (MSG-REVIEW-CLARIFY-4) — distinct from
 *  the ⟨corrected⟩ row it replaces, so a test can assert a NEW sentence landed. */
const STUB_CLARIFY_PREFIX = "⟨clarified⟩ ";

/**
 * MSG-REVIEW-CLARIFY-3/4 — the clarify rewrite, in the `<out>` envelope
 * `parseClarifyCorrection` reads. Before this branch the call fell through to
 * the echo default, which that parser rightly calls `unusable`, so under the
 * stub every clarify ended in `clarifyFailed` and the dock's clarified variant
 * — and its accept path — were unreachable on the emulator.
 *
 * Built from the prompt's `THEY WROTE:` line (the sender's original, routing
 * sentinel stripped). The vocab entry names the sentence's first word so the
 * variant has a real span to underline, as the parser requires.
 */
function synthesizeClarify(prompt: string): string {
  const wrote = /^THEY WROTE: (.*)$/m.exec(prompt)?.[1] ?? "";
  const { body } = stripSentinel(wrote.trim());
  const sentence = STUB_CLARIFY_PREFIX + (body || "stub");
  const list = firstWordVocab(body);
  return (
    "<out>\n" +
    `<practice>${escapeXml(sentence)}</practice>\n` +
    `<native>${escapeXml(STUB_TRANSLATION_PREFIX + (body || "stub"))}</native>\n` +
    `<vocab>\n${list}</vocab>\n` +
    "</out>"
  );
}

/** Backfill batch output — MSG-PIPE-20 `<m i="N">` blocks, one per message.
 *  Annotate-only items carry no <text>; the server substitutes the source. */
function synthesizeBatch(prompt: string): string {
  const isAnnotate = /\bannotate\b/i.test(prompt) || prompt.includes("annotated text");
  const lines = [...prompt.matchAll(/^\[(\d+)\][^\n]*?\s("(?:[^"\\]|\\.)*"|.+)$/gm)];
  const items = lines.map((m) => {
    let text = m[2];
    try { text = JSON.parse(m[2]); } catch { /* already raw */ }
    return { i: Number(m[1]), t: isAnnotate ? text : STUB_TRANSLATION_PREFIX + text };
  });
  const rows = items.length ? items : [{ i: 0, t: STUB_TRANSLATION_PREFIX + "stub" }];
  // MSG-PIPE-20 shape. This used to emit a JSON array, which is the shape that
  // rebuild RETIRED — `parseBatchOutput` finds no `<m>` blocks in it, reports
  // `matched: false`, and the caller silently falls back to per-message. So the
  // emulator has never once exercised the batch path it was written to cover.
  // An annotate-only item carries no <text> by construction (MSG-KEY-4).
  return rows
    .map((r) => (isAnnotate
      ? `<m i="${r.i}">\n<vocab>\n</vocab>\n</m>`
      : `<m i="${r.i}">\n<text>${escapeXml(r.t)}</text>\n</m>`))
    .join("\n");
}

/**
 * MSG-PIPE-26 — the multi-TARGET batch: one message, one block per target, and
 * each target's mode read off its own TARGETS line.
 *
 * The modes matter here in a way they do not in the backfill: a single response
 * mixes all three, and getting one wrong is exactly the failure the real prompt
 * is written to avoid. So the stub honours them — a LIST-ONLY block carries no
 * <text> at all, which is what makes MSG-KEY-4 structural rather than policed.
 */
function synthesizeMultiTarget(prompt: string): string {
  const source = extractSource(prompt);
  const targets = [...prompt.matchAll(/^\[(\d+)\]\s+(TRANSLATE\+LIST|TRANSLATE|LIST-ONLY)\b/gm)];
  if (!targets.length) return `<m i="0">\n<text>${escapeXml(STUB_TRANSLATION_PREFIX + source)}</text>\n</m>`;
  // A vocab span has to occur in the sentence its list belongs to or the parser
  // discards it, so take a real word rather than inventing one.
  const firstWord = (s: string) => (s.trim().split(/\s+/)[0] ?? "").replace(/[^\p{L}\p{N}]/gu, "");
  return targets.map((m) => {
    const i = Number(m[1]);
    const mode = m[2];
    if (mode === "LIST-ONLY") {
      const w = firstWord(source);
      const list = w ? `${w} = ⟨gloss⟩\n` : "";
      return `<m i="${i}">\n<vocab>\n${list}</vocab>\n</m>`;
    }
    const text = STUB_TRANSLATION_PREFIX + source;
    if (mode === "TRANSLATE") return `<m i="${i}">\n<text>${escapeXml(text)}</text>\n</m>`;
    const w = firstWord(source);
    const list = w ? `${w} = ⟨gloss⟩\n` : "";
    return `<m i="${i}">\n<text>${escapeXml(text)}</text>\n<vocab>\n${list}</vocab>\n</m>`;
  }).join("\n");
}

/**
 * Tutor reply (TUTOR-INV-18) — the unified bilingual shape. The vocab list is
 * empty on purpose: entries are matched against the practice row, and a marker
 * row has no real spans to underline.
 *
 * Action routing is driven by a sentinel in the user's message so a test can
 * exercise the `<saveFlashcards/>` bail deterministically, the same way the
 * analysis branches are selected (`@@corrections`, `@@unclear`).
 *
 * ⚠ Read from THIS turn's `USER MESSAGE:` line only. The prompt also carries
 * the CONVERSATION HISTORY, so matching the whole prompt let an earlier turn's
 * sentinel answer every later turn in the same chat (a flashcards request
 * followed by an explain request got `<saveFlashcards/>` twice).
 */
function synthesizeTutorReply(prompt: string): string {
  const lines = [...prompt.matchAll(/^USER MESSAGE: (.*)$/gm)];
  const turn = lines.length ? lines[lines.length - 1][1] : prompt;
  if (/@@tutor-flashcards/.test(turn)) return "<saveFlashcards/>";
  if (/@@tutor-explain/.test(turn)) return "<explainThis/>";
  if (/@@tutor-practice/.test(turn)) return "<startPractice/>";
  return (
    "<output>\n" +
    `<native>${STUB_TRANSLATION_PREFIX}tutor native row</native>\n` +
    `<practice>${STUB_TRANSLATION_PREFIX}tutor practice row</practice>\n` +
    "<vocab>\n</vocab>\n" +
    "</output>\n<reflect>ok</reflect>"
  );
}

/** Setup/onboarding message (TUTOR-SETUP-3) — practice row carries the INLINE
 *  `<vocab t="…">` tags that path still uses, so `parseCwTags` has something
 *  real to extract and the stored doc has the same shape as in prod. */
function synthesizeTutorSetup(prompt: string): string {
  // TUTOR-SETUP-25 — the handover turn emits <topic> only when the user named
  // something studiable. Driven by a sentinel so a test can exercise BOTH the
  // "they chose a topic" and the "they declined" branches deterministically.
  const declined = /@@tutor-no-topic/.test(prompt);
  const topicLine =
    /CURRENT TRIGGER: topic_chosen/.test(prompt) && !declined
      ? "\n<topic>stub topic</topic>"
      : "";
  return (
    "<output>\n" +
    `<native>${STUB_TRANSLATION_PREFIX}setup native row</native>\n` +
    `<practice>${STUB_TRANSLATION_PREFIX}setup <vocab t="practice">pratique</vocab> row</practice>\n` +
    "</output>\n<reflect>ok</reflect>" + topicLine
  );
}

/** Action generator output (TUTOR-ACTION) — JSON, one minimal valid payload
 *  per intent, enough for the parsers' validity floors (≥1 card, ≥1 section). */
function synthesizeTutorAction(label: string, prompt: string): string {
  const intent = label.slice("tutorAction_".length);
  const message = STUB_ACTION_LEAD_IN;
  if (intent === "flashcards") {
    return JSON.stringify({
      message,
      cards: [{ phrase: "pratique", translation: "practice" }],
    });
  }
  if (intent === "explain") {
    return JSON.stringify({
      message,
      explanation: {
        title: "stub explanation",
        sections: [{ heading: "stub", body: "stub body" }],
      },
    });
  }
  // TUTOR-ACTION-10.2 — `@@skill-<skill>` in the user's message picks the
  // question-type filter, so a test can drive it without judging phrasing.
  const skill = /@@skill-(reading|writing|listening)/.exec(prompt)?.[1];
  return JSON.stringify({
    message,
    label: "stub practice session",
    sessionIntent: "stub intent",
    ...(skill ? { skill } : {}),
  });
}

/** The measured `topic_classify` user prompt's last line (TOPIC-SET-5). */
const TOPIC_THEMES_LINE = /^Available topics \(use one of these if at all possible\): (.*)$/m;
/** Words that put a card in "food" — enough for the harness's seeded cards. */
const FOOD_WORDS = /\b(bread|cheese|apple|tart|food|eat|baguette|fromage|pommes?|pain)\b/i;

/**
 * TOPIC-SET-5 — a closed-set answer `parseTopicClassification` accepts: a
 * listed theme the card's words name (or "food" for food words), else "other".
 * Detected by the prompt's shape, not its label, so both the client kind
 * (`topic_classify`) and the background retry take it. Never a new name.
 */
function synthesizeTopicClassify(prompt: string): string | null {
  const m = TOPIC_THEMES_LINE.exec(prompt);
  if (!m) return null;
  const themes = m[1].split(",").map((t) => t.trim().toLowerCase()).filter(Boolean);
  const card = prompt.slice(0, m.index);
  const named = themes.find((t) => card.toLowerCase().includes(t));
  const topic = named ?? (FOOD_WORDS.test(card) && themes.includes("food") ? "food" : "other");
  return JSON.stringify({ subject: "stub subject", topic });
}

function synthesize(label: string, prompt: string): string {
  // Before the label branches: tutorCardTopic keeps its own fixed answer.
  if (label !== "tutorCardTopic") {
    const topic = synthesizeTopicClassify(prompt);
    if (topic !== null) return topic;
  }
  if (label.startsWith("analyze")) return synthesizeAnalysis(extractSource(prompt), prompt);
  if (label === "clarify_correction") return synthesizeClarify(prompt);
  if (label === "suggest_native") return synthesizeSuggest(prompt);
  if (label.startsWith("convertMulti")) return synthesizeMultiTarget(prompt);
  if (label.startsWith("backfillBatch") || /^Messages:\n/.test(prompt)) return synthesizeBatch(prompt);
  if (label.startsWith("translate.") || label.startsWith("annotate.") || label.startsWith("annotateOnly.")) return synthesizeConvert(prompt);
  if (label === "tutorSetup") return synthesizeTutorSetup(prompt);
  if (label === "tutorChat") return synthesizeTutorReply(prompt);
  if (label.startsWith("tutorAction_")) return synthesizeTutorAction(label, prompt);
  // Auto-topic for tutor-added flashcards (TUTOR-ACTION-6). Best-effort in
  // prod, but leaving it unstubbed logged a JSON parse failure on every action
  // scenario — a red herring in the harness output.
  if (label === "tutorCardTopic") return JSON.stringify({ topic: "stub topic" });
  // EXPLAIN-PHRASE-3 — the phrase explainer (streamed, so labelled
  // geminiStreamV2): two sections, the shape `parseExplanationXML` reads.
  const tapped = /^The tapped phrase: "(.*)"$/m.exec(prompt);
  if (tapped) {
    return `<section title="Literally">Stub: "${tapped[1]}" word by word, for the plumbing tests.</section>\n`
      + `<section title="Trip-up">Stub: the part learners usually get wrong in this phrase.</section>`;
  }
  // Practice / other stages aren't needed for the plumbing tests; return the
  // source so nothing downstream crashes.
  return extractSource(prompt) || "stub";
}

/**
 * How much of each half is recorded.
 *
 * ⚠ RAISED FROM 6,000 BY SRV-PROMPT-8..13 batch 8, and it was a LIVE defect
 * rather than a headroom tweak. `life_step`'s system instruction is ~22,800
 * characters — the largest in the app by 4× — and its OUTPUT CONTRACT sits at
 * the very END of it. At 6,000 the Layer B scenario could not see three
 * quarters of the biggest SI this project sends, so an assertion on the
 * contract text failed while the prompt was perfectly correct.
 *
 * That matters more for this kind than for any other: `life_step` has NO
 * `responseSchema` by measured decision (LIFE-CTX-15 / SRV-PROMPT-11), so the
 * contract prose in the SI tail is the ONLY thing standing in for one — and it
 * was the one part of the request the harness silently dropped. Same family as
 * the three defects SRV-PROMPT-13 has already caught: a seam that records
 * nothing looks identical to one that records something wrong.
 *
 * 32,000 clears the largest SI with room, and the documents stay far inside
 * Firestore's 1 MiB limit (~72 kB worst case, and the collection is drained
 * between blocks).
 */
const RECORD_MAX = 32_000;
const OUTPUT_RECORD_MAX = 4_000;

/** Record the request so e2e can assert WHAT the pipeline asked the model for. */
function record(
  label: string,
  systemInstruction: string | undefined,
  prompt: string,
  output: string,
  responseSchema?: unknown,
): void {
  try {
    getFirestore()
      .collection("_e2eLlmCalls")
      .add({
        label,
        systemInstruction: (systemInstruction ?? "").slice(0, RECORD_MAX),
        prompt: prompt.slice(0, RECORD_MAX),
        output: output.slice(0, OUTPUT_RECORD_MAX),
        // PRACTICE-OWN-10 — the schema is part of the request-level contract
        // this collection exists to make assertable, and it was the one part
        // not recorded. Without it a scenario can prove the server built the
        // right PROMPT while the half that constrains the ANSWER silently went
        // missing on the way to the model. Stored as a string so the shape
        // stays inspectable without a nested-map schema in Firestore.
        responseSchema: responseSchema ? JSON.stringify(responseSchema).slice(0, OUTPUT_RECORD_MAX) : "",
        atMs: Date.now(),
      })
      .catch(() => {});
  } catch {
    /* getFirestore not initialised (non-emulator unit context) — skip */
  }
}

/** Entry point used by robustGenerate when GEMINI_STUB_ENABLED. Returns a value
 *  SHAPED like the real SDK result so all downstream extraction is unchanged. */
export function stubGenerateResult(params: {
  label: string;
  systemInstruction?: string;
  prompt: string;
  responseSchema?: unknown;
}): ReturnType<typeof asResult> {
  let text: string;
  try {
    text = synthesize(params.label, params.prompt);
  } catch (err) {
    // A forced failure (e.g. "@@failtx") is still a CALL the pipeline made —
    // record it, so a scenario can count attempts, not just successes.
    record(params.label, params.systemInstruction, params.prompt, `THROW: ${(err as Error)?.message ?? String(err)}`, params.responseSchema);
    throw err;
  }
  record(params.label, params.systemInstruction, params.prompt, text, params.responseSchema);
  return asResult(text);
}

/**
 * MSG-PIPE-32.7 — how a streaming `robustGenerate` caller receives the stub's
 * answer: line by line, `delayMs` apart, for an `@@stream-vocab` analysis; null
 * (the whole answer at once) for everything else.
 */
export function stubStreamDelivery(label: string, prompt: string, text: string): { chunks: string[]; delayMs: number } | null {
  if (!label.startsWith("analyze") || !/^@@stream-vocab\s/.test(extractSource(prompt))) return null;
  return { chunks: text.split(/(?<=\n)/), delayMs: 400 };
}

/**
 * SRV-PROMPT-7 — the STREAMING seam. `geminiStreamV2` had none, so the only
 * end-to-end evidence available for anything stream-only was that its REJECTION
 * paths worked — `practicePromptOwnership.mjs` said exactly that in a comment.
 *
 * That covered the practice planner and all three Explain prompts: four
 * server-built prompts whose substitution nothing verified. It is the same
 * shape as the vacuous system-instruction check found under SRV-PROMPT-5 — the
 * code read correctly and no test could have noticed if it stopped.
 *
 * Returns a value shaped like the SDK's `generateContentStream` result: a
 * `.stream` async-iterable of chunks carrying `candidates[0].content.parts` and
 * a `.text()`, plus a `.response` promise with `usageMetadata`. ONE chunk is
 * enough — the endpoint's job is to forward whatever arrives, and a scenario
 * asserting on delivery would be asserting on this stub's chunking rather than
 * on production behaviour.
 */
export function stubStreamResult(params: {
  label: string;
  systemInstruction?: string;
  prompt: string;
  responseSchema?: unknown;
}): {
  stream: AsyncIterable<{
    candidates?: Array<{ content?: { parts?: unknown[] } }>;
    text: () => string;
  }>;
  response: Promise<{ usageMetadata: { promptTokenCount: number; candidatesTokenCount: number } }>;
} {
  const text = synthesize(params.label, params.prompt);
  record(params.label, params.systemInstruction, params.prompt, text, params.responseSchema);
  return {
    stream: {
      async *[Symbol.asyncIterator]() {
        yield {
          candidates: [{ content: { parts: [{ text }] } }],
          text: () => text,
        };
      },
    },
    response: Promise.resolve({
      usageMetadata: {
        promptTokenCount: Math.ceil(params.prompt.length / 4),
        candidatesTokenCount: Math.ceil(text.length / 4),
      },
    }),
  };
}
