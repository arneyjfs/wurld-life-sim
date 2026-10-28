/**
 * THE JUDGE — the half of the benchmark a model has to score.
 *
 * Everything countable lives in `rubric.ts`. What is left here is genuinely
 * subjective: whether the prose is alive, whether anyone sounds like a person,
 * whether there is any reason to take another turn.
 *
 * ── WHY A JUDGE CAN BE TRUSTED AT ALL, AND WHERE IT CANNOT ──────────────────
 *
 * It cannot, by default. An LLM asked "rate this 1-5" returns 4 for almost
 * anything, because agreeing is cheaper than reading. Three mechanisms make the
 * number mean something:
 *
 * 1. **2 IS THE DEFAULT, AND THE PROMPT SAYS SO.** The anchors put competent-
 *    but-unremarkable at 2, not 4. Most generation is competent. A rubric whose
 *    midpoint is "good" has no room left to detect improvement.
 *
 * 2. **EVIDENCE OR THE SCORE IS CAPPED.** Any score of 3 or 4 must quote the
 *    text that earned it, VERBATIM. A quote is checkable — `verifyEvidence`
 *    below drops a score to 2 when its quote is not in the transcript. This is
 *    the mechanism that does the real work: it costs nothing to type "4", and a
 *    great deal to invent a sentence that survives a substring check.
 *
 * 3. **IT SCORES A TRANSCRIPT, NOT A PLAN.** It never sees the prompts, the
 *    fronts or the clocks — only what a player would have read. A judge shown
 *    the machinery scores the machinery.
 *
 * The judge is deliberately NOT the model that wrote the story. Same family is
 * unavoidable here, but same *call* would be marking its own homework.
 */
import { callGemini } from './gemini';
import {
  DIMENSIONS, storyDimensionsFor, withheldStoryDimensions,
  type Score, type TurnLike,
} from './rubric';
import { renderBands } from './markScheme';

/**
 * The generic scale, kept ONLY as a tie-break. Each dimension now carries its
 * own band descriptors (see `markScheme.ts`) and those win wherever they differ
 * — a generic ladder is what produced a wall of 2.0s, because "passable" was
 * the only rung anyone could locate.
 */
const SCALE = [
  'The per-dimension BANDS below are the scoring authority. This generic ladder is only for tie-breaks:',
  '0 BROKEN — actively bad. A player would notice and mind.',
  '1 POOR — the named failure mode is present.',
  '2 PASSABLE — nothing wrong, nothing good. The default for competent work.',
  '3 GOOD — a player would notice this favourably. Requires a verbatim quote.',
  '4 EXCELLENT — as good as this dimension gets. Rare. Requires a verbatim quote.',
  '',
  'WHEN TWO BANDS BOTH FIT, TAKE THE LOWER ONE. "It could be a 3" resolves upward every time otherwise, and a rubric that drifts up cannot show improvement.',
].join('\n');

const HOUSE_RULES = [
  'You are scoring a language-learning life simulator, read as a PLAYER would read it.',
  '',
  'HOW TO SCORE — read this twice, it is the part that is usually got wrong:',
  '- 2 is the CORRECT score for work that is fine. Most of what you read will be fine. Do not award 3 for the absence of problems; award 3 when something is actively good and you can point at it.',
  '- A score of 3 or 4 REQUIRES a verbatim quote from the transcript in `evidence`. Quotes are checked against the source. An invented or paraphrased quote voids the score.',
  '- A score of 0 or 1 requires you to name what specifically failed, in `note`.',
  '- Do not average away a serious defect because other things were good. Score each dimension only on itself.',
  '- Be harder on the things this genre gets wrong by default: portentous prose, characters who exist to deliver information, drama arriving before anyone has earned it, and jokes that are not jokes.',
].join('\n');

function schemaFor(ids: readonly string[]): Record<string, unknown> {
  return {
    type: 'OBJECT',
    properties: {
      scores: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            dimension: { type: 'STRING', enum: [...ids] },
            score: { type: 'INTEGER' },
            evidence: { type: 'STRING' },
            note: { type: 'STRING' },
          },
          required: ['dimension', 'score', 'evidence', 'note'],
        },
      },
    },
    required: ['scores'],
  };
}

/** What the player actually read, and nothing else. */
export function renderTranscript(turns: readonly TurnLike[]): string {
  return turns
    .map((t, i) => {
      const beats = t.beats
        .map((b) => (b.speaker === 'narrator' ? `  ${b.native}` : `  ${b.name ?? 'someone'}: ${b.practice}  (${b.native})`))
        .join('\n');
      // The taken option is MARKED, and the others are the counterfactual the
      // INTENT procedure asks the judge to weigh the next turn against.
      const opts = t.options
        .map((o) => `  ${t.chose && o.label === t.chose ? '▶ TAKEN' : '  not taken'}  [${o.type}] ${o.label}`)
        .join('\n');
      const q = t.graded
        ? `\n  QUESTION (${t.graded.kind}) on the line: "${t.graded.line}"${t.graded.target ? ` — target: ${t.graded.target}` : ''}`
        : '';
      return `TURN ${i + 1}\n${beats}${q}\n  OPTIONS OFFERED:\n${opts}`;
    })
    .join('\n\n');
}

async function score(
  prompt: string,
  ids: readonly string[],
  label: string,
): Promise<Score[]> {
  const raw = await callGemini({
    prompt,
    systemInstruction: HOUSE_RULES,
    responseSchema: schemaFor(ids),
    label,
    // TEMPERATURE 0 — THE JUDGE IS AN INSTRUMENT, NOT AN AUTHOR.
    //
    // This defaulted to `callGemini`'s 0.95, which is the right setting for
    // GENERATING a story and the wrong one for SCORING it. Measured 2026-08-04
    // by re-judging one fixed transcript three times: NINE of twenty dimensions
    // swung a full band — PROSE [1,2,2], ARC [2,3,2], Q-TIMING [0,1,0],
    // CAST-DEPTH [2,3,2], Q-QUALITY [1,2,1] — on identical input.
    //
    // Every product comparison this session was a 0.2-0.5 delta between two
    // runs, read as signal. Against ±1.0 of instrument noise none of them were
    // supported, including the Q-TIMING check the owner explicitly asked to be
    // guarded on. A ruler that reports a different length each time it is laid
    // against the same object cannot answer "did this change help".
    //
    // Sampling is not wanted here at all: scoring against a mark scheme is a
    // classification, and the band the scheme names is the answer whether or
    // not a different one was reachable. Repeated passes could average the
    // noise down, but they pay per pass for a property the call should just
    // have. The same lesson was learned for the production chat + tutor calls
    // and never reached the harness.
    temperature: 0,
  });
  try {
    const parsed = JSON.parse(raw) as { scores?: Score[] };
    return parsed.scores ?? [];
  } catch {
    return [];
  }
}

/**
 * The dimensions to score, each with its full mark scheme.
 *
 * This used to be one line per dimension — "scores 0 when: <failure>" — which
 * told the judge what the floor looked like and left the other four bands to
 * its imagination. Every dimension then came back 2.0, because 2 was the only
 * band the house rules actually described.
 */
function block(ids: readonly string[]): string {
  return DIMENSIONS.filter((d) => ids.includes(d.id))
    .map((d) => `── ${renderBands(d.id)}\n  (score 0 also when: ${d.failure})`)
    .join('\n\n');
}

/** Scene-level dimensions the judge owns (measured ones are excluded). */
export const SCENE_JUDGED = DIMENSIONS
  .filter((d) => d.scope === 'scene' && !d.measured)
  .map((d) => d.id);

export const STORY_JUDGED = DIMENSIONS
  .filter((d) => d.scope === 'story' && !d.measured)
  .map((d) => d.id);

export async function judgeScene(input: {
  worldName: string;
  sceneIndex: number;
  subject: string;
  turns: readonly TurnLike[];
}): Promise<Score[]> {
  const transcript = renderTranscript(input.turns);
  const prompt = [
    `Score ONE SCENE of a life simulator. The player reads the practice language with a gloss.`,
    ``,
    `The scene declared its subject as: "${input.subject}"`,
    ``,
    `DIMENSIONS:`,
    block(SCENE_JUDGED),
    ``,
    `SCALE:`,
    SCALE,
    ``,
    `TRANSCRIPT — this is everything the player saw:`,
    transcript,
    ``,
    `Score every dimension. Quote verbatim for any 3 or 4.`,
  ].join('\n');
  const scores = await score(prompt, SCENE_JUDGED, `judge:scene:${input.worldName}:${input.sceneIndex}`);
  return verifyEvidence(scores, transcript);
}

export async function judgeStory(input: {
  worldName: string;
  title: string;
  situation: string;
  history: readonly string[];
  cast: readonly { name: string; known: string; wants?: string }[];
  transcript: string;
  /** Scenes actually played — decides which arc dimensions are askable. */
  sceneCount: number;
}): Promise<Score[]> {
  const asked = storyDimensionsFor(input.sceneCount);
  const withheld = withheldStoryDimensions(input.sceneCount);
  const prompt = [
    `Score a WHOLE PLAYTHROUGH, read back as a story.`,
    ``,
    `Title: ${input.title}`,
    `It opened on: ${input.situation}`,
    ``,
    `WHAT HAPPENED, one line per scene, in order:`,
    ...input.history.map((h, i) => `${i + 1}. ${h}`),
    ``,
    `THE CAST, as the world describes them:`,
    ...input.cast.map((c) => `- ${c.name}: ${c.known}${c.wants ? ` — wants: ${c.wants}` : ''}`),
    ``,
    `DIMENSIONS:`,
    block(asked),
    ``,
    `SCALE:`,
    SCALE,
    ``,
    `For COHERENCE, check the scene lines against each other AND against the cast descriptions above — a character acting against their own description is the failure.`,
    ``,
    `THE FULL TRANSCRIPT:`,
    input.transcript,
    ``,
    `Score every dimension. Quote verbatim for any 3 or 4.`,
  ].join('\n');
  const scores = await score(prompt, asked, `judge:story:${input.worldName}`);
  return [
    ...verifyEvidence(scores, `${input.transcript}\n${input.history.join('\n')}`),
    ...withheld,
  ];
}

/**
 * The anti-inflation pass, and the reason the numbers are worth reading.
 *
 * A 3 or 4 claims something specific is good. If the quote backing it is not in
 * the source, the claim is unverifiable and the score drops to 2 — the default.
 * Not to 0: the work may well have been good, but an unevidenced high score is
 * exactly the thing this benchmark exists not to trust.
 *
 * Matching is deliberately loose (normalised whitespace, case-insensitive, and
 * a 40-character window) so a judge is not punished for a trailing full stop.
 */
export function verifyEvidence(scores: readonly Score[], source: string): Score[] {
  const hay = source.toLowerCase().replace(/\s+/g, ' ');
  return scores.map((s) => {
    if (s.score < 3) return s;
    const q = (s.evidence ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/^["'“”]|["'“”]$/g, '').trim();
    const probe = q.slice(0, 40);
    if (probe.length >= 12 && hay.includes(probe)) return s;
    return {
      ...s,
      score: 2,
      note: `${s.note} [capped to 2: evidence not found verbatim in the transcript]`,
    };
  });
}

/* ─────────────────────────── ASSET GRADING ────────────────────────────────
 * The player sees more than prose. A backdrop that does not match its scene, or
 * an avatar bio that contradicts how a character behaves, damages the story
 * without appearing anywhere in the transcript — so grading these SEPARATELY is
 * what lets a bad story score be explained rather than just recorded.
 */
export const ASSET_DIMENSIONS = [
  'BACKDROP-FIT — does the image match the place the scene says it is in?',
  'BIO-FIT — does the avatar bio agree with what the character actually did?',
  'QUESTION-VALUE — were the graded moments worth a learner\'s time?',
];

export async function judgeAssets(input: {
  worldName: string;
  backdrops: { label: string; subject: string; svgHead: string }[];
  bios: { name: string; role: string; profile: string }[];
  questions: { kind: string; line: string; choices: string[] }[];
  history: readonly string[];
}): Promise<Score[]> {
  const prompt = [
    `Grade the NON-PROSE material of a life simulator. Same 0-4 scale; 2 is the default for adequate.`,
    ``,
    `DIMENSIONS:`,
    ...ASSET_DIMENSIONS.map((d) => `- ${d}`),
    ``,
    `SCALE:`,
    SCALE,
    ``,
    `WHAT HAPPENED, one line per scene:`,
    ...input.history.map((h, i) => `${i + 1}. ${h}`),
    ``,
    `BACKDROPS (label, the scene's subject, and the opening of the SVG source):`,
    ...input.backdrops.map((b) => `- "${b.label}" for a scene about "${b.subject}": ${b.svgHead}`),
    ``,
    `AVATAR BIOS the player can open:`,
    ...input.bios.map((b) => `- ${b.name} (${b.role}): ${b.profile}`),
    ``,
    `GRADED QUESTIONS:`,
    ...input.questions.map((q) => `- [${q.kind}] on "${q.line}" — choices: ${q.choices.join(' | ')}`),
    ``,
    `Score each dimension. A 3 or 4 needs a verbatim quote from the material above.`,
  ].join('\n');
  const ids = ['BACKDROP-FIT', 'BIO-FIT', 'QUESTION-VALUE'];
  const scores = await score(prompt, ids, `judge:assets:${input.worldName}`);
  return verifyEvidence(scores, prompt);
}
