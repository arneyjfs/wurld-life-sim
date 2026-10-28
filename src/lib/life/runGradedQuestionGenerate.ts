/**
 * LIFE-EX-GEN-*: orchestrator for the graded-question generator.
 *
 * Fires AFTER `lifeStep` returns a graded turn with a `gradedPlan`.
 * Authors the actual `practicePrompt` + chip set via a focused Gemini
 * call with ruthlessly-scoped SI (`functions/src/prompts/lifeGradedQuestion.ts`).
 *
 * Failure modes are explicit (LIFE-EX-GEN-6):
 *   - Gemini throws / times out  → kind: 'failed' (caller demotes to CYOA)
 *   - schema parse fails twice   → kind: 'failed'
 *   - leak guard fails twice     → kind: 'failed'
 *
 * The caller (useNodeEngine) translates 'failed' into the
 * options-failed Continue ladder (LIFE-NODE-8) so the player never sees a broken graded turn.
 *
 * ── SRV-PROMPT-8..13 batch 7 ────────────────────────────────────────────────
 *
 * THE PROMPT IS GONE FROM HERE AND FROM `prompts/gradedQuestion.ts`, which is
 * DELETED (SRV-PROMPT-3). Both halves are built by
 * `functions/src/prompts/lifeGradedQuestion.ts` from a validated spec; the
 * engine half (`gradedDirection`, `applyGradedDirection`, `gradedPlanIssues`,
 * `directionViolations`) lives on in `gradedQuestionEngine.ts`.
 *
 * ⚠ THE RETRY LADDER IS WHY THIS IS BATCH 7 AND NOT BATCH 2 (SRV-PROMPT-12).
 * The three guards below run on the MODEL's response, on the client, and their
 * verdict steers attempt 2. They used to return English and this file joined it
 * into a `violationHint` string that the prompt builder interpolated — so
 * migrating the prompt alone would have left the proxy OPEN through the retry
 * path while attempt 1 looked migrated. They return CODES now, the spec carries
 * the codes, and the server writes the sentences. The sentences did not change:
 * `functions/src/__tests__/gradedQuestionGoldenParity.test.ts` proves every one
 * byte-identical against a capture taken before the move.
 *
 * ⚠ AND THE LOGS NOW CARRY CODES, WHICH IS A DISCLOSED BEHAVIOUR CHANGE. The
 * `lifeFailed` payloads and the `exhausted-retries: …` demote reason used to
 * print those sentences. Re-rendering them client-side purely to keep the log
 * identical would be a second copy of the templates — the duplication this
 * migration exists to remove — so the overlay shows
 * `exhausted-retries: line-vocab-missing, direction-kind-mismatch` instead of a
 * paragraph. Nothing parses either string: the demote reason is stored on a
 * `question_demoted` event whose only readers are the cadence counter and the
 * debug buffer, and `stepRender.ts` drops the event from the prompt entirely.
 */
import { z } from 'zod';
import { generateWithTransportRetry } from './generateWithRetry';
import { GRADED_QUESTION_MODEL, LIFE_TEMPERATURE_GRADED } from './modelConfig';
import { lifeDebug, lifeFailed } from './debugLog';
import {
  ZPracticePrompt,
  ZStepChoice,
  type GradedPlan,
  type PracticePrompt,
  type StepChoice,
} from './stepSchema';
import {
  applyGradedDirection,
  directionViolations,
  gradedDirection,
  gradedPlanIssues,
  type GradedQuestionSceneContext,
} from './gradedQuestionEngine';
import type { GradedViolation, LifeGradedQuestionPromptSpec } from '@/lib/practicePromptSpec';
import { shuffleChoices } from './shuffleChoices';
import { hasAttributionWrapper } from './utterance';

/** The codes, for a log line and a demote reason. Not the wording — that is the
 *  server's, and duplicating it here to keep a log string identical is the
 *  duplication SRV-PROMPT-3 exists to prevent. */
const codesOf = (violations: readonly GradedViolation[]): string =>
  violations.map((v) => v.code).join(', ');

/** Generator-only response shape. */
const ZGeneratedQuestion = z.object({
  practicePrompt: ZPracticePrompt,
  choices: z.array(ZStepChoice).min(3).max(4),
}).superRefine((val, ctx) => {
  // Exactly one correct.
  const correct = val.choices.filter((c) => c.correctness === 'correct').length;
  if (correct !== 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Expected exactly 1 correct chip; got ${correct}`,
      path: ['choices'],
    });
  }
  // Every chip carries correctness.
  const missing = val.choices.findIndex((c) => c.correctness == null);
  if (missing !== -1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `Chip ${missing} missing correctness`,
      path: ['choices', missing, 'correctness'],
    });
  }
});
type GeneratedQuestion = z.infer<typeof ZGeneratedQuestion>;

export type RunGradedQuestionInput = {
  plan: GradedPlan;
  practiceLanguage: string;
  nativeLanguage: string;
  recentTargets: ReadonlyArray<string>;
  /** LIFE-EX-GEN-7: tight scene snapshot so distractors fit the
   *  world. Without it the generator authors generic café-shop chips
   *  in a sci-fi resistance saga. */
  scene?: GradedQuestionSceneContext;
};

export type RunGradedQuestionResult =
  | { kind: 'ok'; practicePrompt: PracticePrompt; choices: StepChoice[] }
  | { kind: 'failed'; reason: string };

export async function runGradedQuestionGenerate(
  input: RunGradedQuestionInput,
): Promise<RunGradedQuestionResult> {
  // LIFE-EX-DIR-1 — decide the direction ONCE, before any generation, from
  // the plan kind that already locked it. Everything downstream reads this
  // value; nothing re-derives it, so the prompt and the attribution cannot be
  // written independently and disagree.
  //
  // The malformed-plan check in front of it is not defensive padding. The
  // repair at `generateStepOptions.ts` spreads the OLD variant's body under
  // the NEW discriminant, so a repaired plan can arrive as
  // `{kind:'generation'}` with no `testTarget` — and `buildGradedQuestionPrompt`
  // then throws on `undefined.replace()`. `authorQuestion` fires this as an
  // uncaught `void` promise, so the throw left the node wedged in
  // `question-authoring` FOREVER. Demoting to a `failed` result turns a hang
  // into a recoverable miss (LIFE-EX-GEN-6).
  // LIFE-EX-PLAN-7 — the FRESH-TARGET rule, finally enforced.
  //
  // The prompt states it as hard ("FRESH TARGETS ONLY (HARD): it MUST NOT
  // appear in <recentlyPracticed>. Never recycle."), `<recentlyPracticed>` is
  // rendered on every turn, and nothing anywhere checked it. Measured: Ines
  // planned "escaleras" three times with the word VISIBLY in the block on the
  // second and third — and Alice recycled two targets in the next run. A rule
  // stated in a prompt and checked nowhere is a suggestion.
  //
  // The consequence is a DEMOTE, not a retry: the defect is in the plan, which
  // is re-sent unchanged on every generator attempt, so retrying here would be
  // the same unwinnable loop as `LIFE-EX-PLAN-6`. Demoting costs the turn its
  // question (the node still renders, the cadence counter picks it up next
  // turn) and costs ZERO extra calls — where recycling costs a question the
  // player has already answered.
  if (input.plan.kind === 'generation') {
    const t = input.plan.testTarget.trim().toLowerCase();
    if (t && input.recentTargets.some((r) => r.trim().toLowerCase() === t)) {
      lifeFailed('STEP', 'graded-question rejected: stale target', {
        target: input.plan.testTarget,
        recentTargets: input.recentTargets.length,
      });
      return { kind: 'failed', reason: `stale-target: ${input.plan.testTarget}` };
    }
  }
  const planIssues = gradedPlanIssues(input.plan);
  if (planIssues.length > 0) {
    lifeFailed('STEP', 'graded-question rejected: malformed plan', {
      planKind: input.plan.kind,
      issues: planIssues,
    });
    return { kind: 'failed', reason: `malformed-plan: ${planIssues.join(' ')}` };
  }
  const direction = gradedDirection(input.plan);

  // SRV-PROMPT-8..13 batch 7 — the spec, narrowed field by field.
  //
  // `scene` in particular is REBUILT rather than forwarded: the call site's
  // `GradedQuestionSceneContext` also carries `difficulty` and `systemLanguage`,
  // which the SI reads and the user prompt does not, so they travel ONCE as
  // resolved top-level scalars below. Forwarding the object whole would put a
  // second copy of each on the wire for the server to disagree with.
  //
  // `npcId` does not travel at all: no prompt renders it, and the only reader
  // is `applyGradedDirection`, which runs on the RESULT, here.
  const base: LifeGradedQuestionPromptSpec = {
    kind: 'life_graded_question',
    plan:
      input.plan.kind === 'generation'
        ? {
            kind: 'generation',
            testTarget: input.plan.testTarget,
            sentenceContext: input.plan.sentenceContext,
          }
        : {
            kind: 'comprehension',
            npcUtterance: input.plan.npcUtterance,
            ...(input.plan.speakerName !== undefined
              ? { speakerName: input.plan.speakerName }
              : {}),
          },
    practiceLanguage: input.practiceLanguage,
    // LIFE-LANG-7/8: the instruction/interpretation language rides in the
    // scene context (built from the world); legacy world docs with no
    // systemLanguage fall back to the native language. RESOLVED HERE, so the
    // server never re-applies a fallback the client already applied.
    systemLanguage: input.scene?.systemLanguage ?? input.nativeLanguage,
    // LIFE-CTX-3: player level rides in the scene context (built from the
    // world); default 2 when a legacy world doc has no difficulty set.
    difficulty: input.scene?.difficulty ?? 2,
    recentTargets: [...input.recentTargets],
    ...(input.scene
      ? {
          scene: {
            ...(input.scene.sagaTitle !== undefined
              ? { sagaTitle: input.scene.sagaTitle }
              : {}),
            ...(input.scene.locationLabel !== undefined
              ? { locationLabel: input.scene.locationLabel }
              : {}),
            ...(input.scene.speakerName !== undefined
              ? { speakerName: input.scene.speakerName }
              : {}),
            ...(input.scene.recentBeats !== undefined
              ? { recentBeats: [...input.scene.recentBeats] }
              : {}),
          },
        }
      : {}),
  };

  let violations: GradedViolation[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    // SRV-PROMPT-12 — attempt 2 carries the verdict as CODES. The server holds
    // the templates and renders `<violationHint>`; an empty array renders
    // nothing, so attempt 1 and a clean verdict are the same prompt.
    const promptSpec: LifeGradedQuestionPromptSpec =
      violations.length > 0 ? { ...base, violations } : base;

    let raw: string;
    try {
      // LIFE-NODE-14: transport retried underneath, on its own budget — a
      // dropped socket here used to demote a perfectly good graded plan.
      raw = await generateWithTransportRetry({
        // SRV-PROMPT-8..13: the server builds both halves from `promptSpec`.
        // sending NO `prompt` is load-bearing — the endpoint's "Missing prompt" guard
        // is skipped only when the resolver returns `built`, so this is also
        // what makes a resolver regression visible.
        promptSpec,
        model: GRADED_QUESTION_MODEL,
        responseMimeType: 'application/json',
        temperature: LIFE_TEMPERATURE_GRADED,
        // Measured 2026-07 (thinking_ab.py graded) on ANSWER CORRECTNESS, not
        // schema: template carries the blank, exactly one correct chip, that
        // chip IS the planned target, no duplicate/empty chips. 4/4 at both
        // levels, and the distractors were read side by side — indistinguishable.
        // 'low' cost 1030 thinking tokens: 2.2x price, 5.1x latency.
        thinkingLevel: 'minimal',
        category: 'life_graded_question',
        // LIFE-COST-3: attempt > 0 is the leak-guard regeneration.
        attempt,
      });
    } catch (err) {
      lifeFailed('STEP', 'graded-question gen threw', {
        attempt,
        err: String(err),
      });
      return { kind: 'failed', reason: `gen-threw: ${String(err)}` };
    }

    const parsed = safeParseJson(raw);
    if (!parsed) {
      violations = [{ code: 'invalid-json' }];
      // LIFE-EX-GEN-LOG: every rejected attempt is logged so a snag is
      // diagnosable without re-deriving it from raw JSON (owner ask, 2026-07).
      lifeFailed('STEP', 'graded-question rejected: invalid JSON', { attempt });
      continue;
    }
    const result = ZGeneratedQuestion.safeParse(parsed);
    if (!result.success) {
      // SRV-PROMPT-12 — `message` is LIBRARY text rather than model text, but it
      // is still a free string on the wire, so the server bounds and escapes it
      // and caps this array at four on its own side. The slice stays here
      // because four issues is a PROMPT decision that predates the migration.
      violations = result.error.issues.slice(0, 4).map((i) => ({
        code: 'schema-issue' as const,
        path: i.path.join('.'),
        message: i.message,
      }));
      lifeFailed('STEP', 'graded-question rejected: schema', {
        attempt,
        planKind: input.plan.kind,
        issues: violations,
      });
      continue;
    }

    // Pedagogical guard: enforce LIFE-EX-GEN-3 (answer-leak rules).
    // LIFE-EX-DIR-3 — direction violations sit alongside the leak rules so
    // both feed the same retry hint. Identity is NORMALISED below rather than
    // rejected (the right value is known in code, so a retry could only
    // reproduce it); what is rejected here is a line whose VOICE contradicts
    // the direction, which no amount of field-overwriting can fix.
    const leak = leakViolations(result.data, input.plan);
    const dir = directionViolations(direction, result.data.practicePrompt);
    // LIFE-EX-VOCAB-4: an inbound line with no tappable words.
    const vocab = vocabViolations(result.data);
    // ORDER IS MEANING: leak, then direction, then vocab — the order the joined
    // hint has always read in, preserved on the wire because the server renders
    // the array as it arrives and never re-sorts.
    violations = [...leak, ...dir, ...vocab];
    if (violations.length > 0) {
      // LIFE-EX-GEN-LOG: the summary names the family that ACTUALLY fired.
      // Three independent guards share this branch, and all three used to be
      // reported as "answer-leak" — so a `lineVocab` miss (the model simply
      // omitted the annotations) read in the overlay as the model having
      // spoiled the answer. That is the one diagnosis that sends you to the
      // wrong prompt: seen 2026-08-06 in the owner's production log, where the
      // real fault was LIFE-EX-VOCAB-4 and nothing about the answer leaked.
      const families = [
        leak.length ? 'answer-leak' : '',
        dir.length ? 'direction' : '',
        vocab.length ? 'line-vocab' : '',
      ]
        .filter(Boolean)
        .join(' + ');
      // The recurring cause of the LEAK family specifically (translation-anchor
      // whose native sentence contains the answer — e.g. a COGNATE testTarget
      // "plan" → "…exact plan?"). Log the target + violations so it is
      // visible, not silently retried.
      lifeFailed('STEP', `graded-question rejected: ${families}`, {
        attempt,
        planKind: input.plan.kind,
        target:
          input.plan.kind === 'generation'
            ? input.plan.testTarget
            : input.plan.npcUtterance,
        violations,
      });
      continue;
    }

    lifeDebug('STEP', `graded-question generated (${input.plan.kind})`, {
      target:
        input.plan.kind === 'generation'
          ? input.plan.testTarget
          : input.plan.npcUtterance,
      sentenceContext:
        input.plan.kind === 'generation' ? input.plan.sentenceContext : undefined,
      chipCount: result.data.choices.length,
    });
    return {
      kind: 'ok',
      // LIFE-EX-DIR-2 — speakerName/npcId come from the DIRECTION, never from
      // the model. They used to be model-authored, which is how the card could
      // say "Élise said:" while the bubble beside it said "?".
      practicePrompt: applyGradedDirection(direction, result.data.practicePrompt),
      // LIFE-EX-GEN-8: randomise chip position (the generator authors
      // the correct chip first). correctness identifies the answer, so
      // shuffling never loses it.
      choices: shuffleChoices(result.data.choices),
    };
  }

  // Both attempts exhausted — carry the LAST violation into the reason so the
  // demote log (LIFE-NODE-8) says WHY, not just "exhausted-retries".
  //
  // ⚠ CODES, NOT SENTENCES, since batch 7. The templates are the server's now
  // and re-rendering them here to keep this string identical would be the
  // duplication SRV-PROMPT-3 forbids. It is also a better line: the whole
  // verdict fits on one row of the overlay and `line-vocab-missing` is
  // greppable where a paragraph about tappable words is not.
  const reason = `exhausted-retries: ${violations.length > 0 ? codesOf(violations) : 'unknown'}`;
  lifeFailed('STEP', 'graded-question exhausted retries → demote', {
    planKind: input.plan.kind,
    lastViolation: violations.length > 0 ? violations : null,
  });
  return { kind: 'failed', reason };
}

/**
 * LIFE-EX-VOCAB-4 — a graded line the player cannot tap is a hole, and the
 * comprehension branch is where it opens.
 *
 * MEASURED over two four-world runs: of 141 graded questions, fill-blank
 * supplied `lineVocab` 77/77 times and comprehension **16 of 64 times did not
 * (25%)**. `buildResolvedBubble`'s outbound branch degrades gracefully — it
 * falls back to the answer chip's own annotations — but the comprehension
 * branch spreads `lineVocab` in conditionally and has NOTHING to fall back on,
 * so one inbound question in four put a full practice-language NPC line on
 * screen with no tappable words at all.
 *
 * `LIFE-EX-VOCAB-3` added the field in 2026-07 for exactly this symptom
 * ("graded lines arrive as messages with no underlined words") and left it
 * `.optional()` on both kinds — which made the guarantee a request, and the
 * request is declined a quarter of the time.
 *
 * A VIOLATION, NOT A SCHEMA REQUIREMENT: this joins the existing retry ladder
 * beside the leak and direction guards, so the model gets one hinted retry to
 * supply it. Making it `z.string()`-required instead would fail the whole
 * response on a field the bubble can survive without — the line still carries
 * its full-sentence `nativeText`, so the degradation is "bilingual but not
 * tappable", not "incomprehensible". Retry, then accept.
 */
export function vocabViolations(q: GeneratedQuestion): GradedViolation[] {
  const pp = q.practicePrompt;
  if (pp.kind !== 'comprehension') return [];
  const n = pp.lineVocab ? Object.keys(pp.lineVocab).length : 0;
  if (n > 0) return [];
  return [{ code: 'line-vocab-missing' }];
}

/**
 * LIFE-EX-GEN-3: pre-render guard. Returns the codes that fired; empty when
 * clean.
 *
 * ⚠ SRV-PROMPT-12 — codes, not sentences, since batch 7. Every `push` below
 * used to be the English the model read on attempt 2, and that string travelled
 * back up the wire as prompt text. The wording is unchanged and now lives in
 * `functions/src/prompts/lifeGradedViolations.ts`, one template per code; the
 * PUSH ORDER is preserved because it is the order the joined hint reads in.
 *
 * Nothing that the server already holds is carried: the two chip-versus-plan
 * codes name the CHIP, and the server quotes `sentenceContext` / `testTarget`
 * off the plan it validated.
 */
export function leakViolations(q: GeneratedQuestion, plan: GradedPlan): GradedViolation[] {
  const out: GradedViolation[] = [];
  if (plan.kind === 'comprehension') {
    if (q.practicePrompt.kind !== 'comprehension') {
      out.push({ code: 'comprehension-kind-mismatch' });
    } else {
      const utteranceLower = plan.npcUtterance.trim().toLowerCase();
      // LIFE-LANG-2: the instruction is ALWAYS native — a comprehension
      // turn without a native question has no instruction surface.
      // LIFE-EX-GEN-10: comprehension needs the same justification discipline
      // as fill-blank. Interpretations are FUZZIER than tokens — "she's asking
      // about your week" and "she's asking how you are" can both be defensible
      // readings of one line — so a wrong chip must contradict something
      // specific in the utterance, and the generator has to say what.
      const missingWhy = q.choices
        .filter((c) => c.correctness === 'wrong')
        .some((c) => trimPunc(c.whyWrong ?? '').length === 0);
      if (missingWhy) {
        out.push({ code: 'comprehension-missing-why-wrong' });
      }
      // LIFE-CONTRACT-BUBBLE-4: the utterance becomes an NPC BUBBLE verbatim
      // at resolution (resolvedBubble.ts), so it must be the spoken words and
      // nothing else. A quote-wrapped, attributed line — « … », demandes-tu —
      // is narrator prose about speech; shipping it puts the PLAYER's own
      // question inside the NPC's bubble, which is what beta showed.
      if (hasAttributionWrapper(q.practicePrompt.npcUtterance)) {
        out.push({
          code: 'comprehension-utterance-narrated',
          quote: q.practicePrompt.npcUtterance.slice(0, 60),
        });
      }
      if (!q.practicePrompt.question.trim()) {
        out.push({ code: 'comprehension-question-empty' });
      }
      // LIFE-LANG-12: the post-answer feedback reveals the FAITHFUL
      // translation of the whole utterance (not the chip interpretation).
      // Require it so the learner always sees what was actually said.
      if (!q.practicePrompt.utteranceNativeText?.trim()) {
        out.push({ code: 'comprehension-utterance-native-missing' });
      }
      q.choices.forEach((c, i) => {
        const p = c.practiceText.trim().toLowerCase();
        const n = c.nativeText.trim().toLowerCase();
        if (p && (p === utteranceLower || utteranceLower.includes(p))) {
          out.push({ code: 'comprehension-chip-echoes-utterance', chipIndex: i });
        }
        if (n && utteranceLower.includes(n) && n.length >= 4) {
          out.push({ code: 'comprehension-chip-native-in-utterance', chipIndex: i });
        }
      });
      // LIFE-LANG-1: comprehension chips render ONLY the native
      // interpretation — nativeText is the visible label, so it must be
      // present and distinct on every chip.
      const seenNative = new Map<string, number>();
      q.choices.forEach((c, i) => {
        const n = c.nativeText.trim().toLowerCase();
        if (!n) {
          out.push({ code: 'comprehension-chip-native-empty', chipIndex: i });
          return;
        }
        const prev = seenNative.get(n);
        if (prev !== undefined) {
          out.push({
            code: 'comprehension-chips-share-native',
            chipIndex: prev,
            otherChipIndex: i,
            quote: c.nativeText,
          });
        } else {
          seenNative.set(n, i);
        }
      });
    }
  } else {
    if (q.practicePrompt.kind !== 'generation') {
      out.push({ code: 'fill-blank-kind-mismatch' });
    } else {
      if (!q.practicePrompt.practiceText.includes('___')) {
        out.push({ code: 'fill-blank-missing-blank-marker' });
      }
      // LIFE-LANG-6: completedNativeText is the full native translation
      // with the blank FILLED IN. REQUIRED — the post-answer overlay
      // always shows the sentence's meaning, and fill-blank chips carry
      // no gloss (LIFE-LANG-1), so this field is the only place the
      // learner ever sees what the sentence means. Must be non-empty and
      // must NOT still contain the blank marker.
      const completed = q.practicePrompt.completedNativeText?.trim() ?? '';
      if (!completed) {
        out.push({ code: 'fill-blank-completed-native-missing' });
      } else if (completed.includes('___')) {
        out.push({ code: 'fill-blank-completed-native-has-blank' });
      }
      // Sanity: the testTarget should appear verbatim in sentenceContext
      // so the generator can blank it out cleanly. If lifeStep got the
      // pairing wrong, retry-with-hint usually fixes it.
      const target = plan.testTarget.trim().toLowerCase();
      const context = plan.sentenceContext.trim().toLowerCase();
      // LIFE-EX-PLAN-6 — when the target is absent from the sentence, the
      // SENTENCE wins and the target check is dropped.
      //
      // This used to emit a violation, and that violation was UNWINNABLE. The
      // defect belongs to the PLAN, authored by `life_step` one call earlier;
      // `input.plan` is re-sent byte-identical on every attempt, so the
      // generator was being asked to fix something it does not own — while the
      // same prompt told it "the correct chip IS the testTarget". Both attempts
      // failed identically and the question was DROPPED. Measured 7 times
      // across 47 stored transcripts; the German case is the shape of it —
      // testTarget "können" against "Ich kann das Logbuch einfach nicht finden."
      // The model planned a LEMMA and wrote the INFLECTED form, which is not a
      // mistake in any sense the learner would recognise.
      //
      // The sentence is what the player is about to SAY, so it is authoritative;
      // the target is the model's label for a word inside it. When they
      // disagree, test the word that is actually there. Morphology is not
      // attempted — no stemming, no edit distance — because the generator picks
      // the blank from the sentence anyway and only has to be ALLOWED to.
      const targetInContext = target.length > 0 && context.length > 0 && context.includes(target);
      const correctChip = q.choices.find((c) => c.correctness === 'correct');
      if (correctChip) {
        const cp = correctChip.practiceText.trim().toLowerCase();
        if (!targetInContext) {
          // The relaxed contract: the chip must be IN the sentence. That is the
          // property the generator actually needs (something to blank out), and
          // unlike the target check it is one the generator can satisfy.
          if (context.length > 0 && cp.length > 0 && !context.includes(cp)) {
            // The SENTENCE is not carried: the server quotes it off the plan
            // it validated, so a caller cannot restate the plan inside its own
            // critique.
            out.push({
              code: 'fill-blank-correct-chip-not-in-sentence',
              quote: correctChip.practiceText,
            });
          }
        } else if (target.length > 0 && cp !== target && !target.includes(cp) && !cp.includes(target)) {
          // Soft warning — generator may have inflected, but flag big drifts.
          out.push({
            code: 'fill-blank-correct-chip-diverges',
            quote: correctChip.practiceText,
          });
        }
      }
      // LIFE-LANG-1 (2026-07 revision — supersedes the 2026-06-01
      // judgment-based gloss handling): fill-blank chips are practice-
      // language ONLY. Any native gloss telegraphs the inflectional
      // answer, so nativeText must be the empty string on every chip.
      q.choices.forEach((c, i) => {
        if (c.nativeText.trim() !== '') {
          out.push({ code: 'fill-blank-chip-has-native-gloss', chipIndex: i, quote: c.nativeText });
        }
      });

      // Chip practiceText must be short — no template surroundings.
      const template = q.practicePrompt.practiceText.toLowerCase();
      const blankIdx = template.indexOf('___');
      const before = blankIdx >= 0 ? trimPunc(template.slice(0, blankIdx)) : '';
      const after = blankIdx >= 0 ? trimPunc(template.slice(blankIdx + 3)) : '';
      q.choices.forEach((c, i) => {
        const p = c.practiceText.trim().toLowerCase();
        if (!p) {
          out.push({ code: 'fill-blank-chip-practice-empty', chipIndex: i });
          return;
        }
        if (before.length >= 4 && p.includes(before)) {
          out.push({ code: 'fill-blank-chip-contains-template-before', chipIndex: i, quote: before });
        }
        if (after.length >= 4 && p.includes(after)) {
          out.push({ code: 'fill-blank-chip-contains-template-after', chipIndex: i, quote: after });
        }
        const tokens = p.split(/\s+/).filter(Boolean).length;
        if (tokens >= 4) {
          out.push({ code: 'fill-blank-chip-too-long', chipIndex: i, tokenCount: tokens });
        }
      });

      // Fill-blank chips render practiceText as the visible option — two chips
      // with identical text is an unanswerable "pick between the same word
      // twice" question (beta bug). Mirrors the comprehension distinct-
      // nativeText check above.
      const seenPractice = new Map<string, number>();
      q.choices.forEach((c, i) => {
        const p = c.practiceText.trim().toLowerCase();
        if (!p) return; // empty already flagged above
        const prev = seenPractice.get(p);
        if (prev !== undefined) {
          out.push({
            code: 'fill-blank-chips-share-practice',
            chipIndex: prev,
            otherChipIndex: i,
            quote: c.practiceText,
          });
        } else {
          seenPractice.set(p, i);
        }
      });

      // LIFE-EX-GEN-9: the DISAMBIGUATION contract, lifted from practice mode's
      // PRACTICE-GEN-10. Every distractor a good generator writes is a real word
      // that fits the slot — that is what makes [peux / veux / doit] so easy to
      // ship and so impossible to answer. The question must therefore commit to
      // HOW it rules the others out, and justify each one it rejects.
      const fb = q.practicePrompt;
      if (fb.disambiguation !== 'context-anchor' && fb.disambiguation !== 'translation-anchor') {
        out.push({ code: 'fill-blank-disambiguation-missing' });
      }
      // Every wrong chip must be justifiable. NOTE: we deliberately do NOT
      // reject two distractors that share a reason. That check shipped briefly
      // and was wrong: distractors being wrong for the SAME reason is the
      // normal, healthy shape of a vocabulary question (café → thé / eau /
      // lait are all "wrong drink"), and the defect it was meant to catch —
      // two chips that are both DEFENSIBLE — is a property of the correct
      // answer's uniqueness, not of how the distractors fail. It fired on good
      // questions, burned a retry, and could demote a valid practice turn to
      // CYOA. The `disambiguation` strategy is what actually guarantees one
      // right answer.
      const missingReason = q.choices
        .filter((c) => c.correctness === 'wrong')
        .some((c) => trimPunc(c.whyWrong ?? '').length === 0);
      if (missingReason) {
        out.push({ code: 'fill-blank-missing-why-wrong' });
      }
      // A shown anchor must not contain the answer, or the question answers
      // itself the moment it is rendered.
      if (fb.disambiguation === 'translation-anchor') {
        const anchor = (fb.completedNativeText ?? '').toLowerCase();
        const chip = q.choices.find((c) => c.correctness === 'correct');
        const answer = trimPunc(chip?.practiceText ?? '').toLowerCase();
        if (answer.length >= 3 && anchor.includes(answer)) {
          // `chip` is necessarily defined here: `answer.length >= 3` is false
          // for the `?? ''` fallback, so the branch is unreachable without one.
          out.push({
            code: 'fill-blank-anchor-leaks-answer',
            quote: chip?.practiceText ?? '',
          });
        }
      }
    }
  }
  return out;
}

function trimPunc(s: string): string {
  return s.replace(/^[\s.,!?;:'"-]+|[\s.,!?;:'"-]+$/gu, '');
}

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(stripFences(raw));
  } catch {
    return null;
  }
}

function stripFences(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('```')) return trimmed;
  const lines = trimmed.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}
