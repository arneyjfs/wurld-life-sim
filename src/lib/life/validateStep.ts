/**
 * LIFE-NODE cross-turn validator: catches responses that pass schema
 * but break cross-turn narrative rules. Warn-only at the call site
 * (generateStepOptions) — the retry budget is spent on schema.
 *
 *   - An option label duplicated across options (practiceText, or
 *     nativeText — options are never graded, so identical glosses
 *     are always a defect here).
 *   - A beat in the node that
 *     re-quotes the just-practised line (LIFE-CONTRACT-EX-4
 *     never-repeat).
 *
 * The old graded chip-shape rules (full-sentence chips, gloss leaks,
 * emoji leaks, response-shaped comprehension chips) live in the
 * LIFE-EX-GEN-* generator's leakViolations guard — the generator is
 * the only author of graded chips now. salvageFillBlankChips /
 * demoteGradedToCyoa were dead code typed against the deleted
 * StepResponse and are gone.
 */
import type { WorldCanon } from '@/types/lifeNarrative';
import { canonIndex, canonViolations } from './canon';
import { leadInLeaksTestedLine } from './leadInBeats';
import type { NodePreview, StepIntroduction, StepOption } from './stepSchema';

export type ValidatorIssue = {
  /** Stable code for telemetry / log filtering. */
  code:
    | 'duplicate-practice'
    | 'duplicate-native'
    | 'node-repeats-practiced-line'
    /** LIFE-CANON-2: an option acts on an entity the story never established. */
    | 'unknown-entity-ref'
    /** LIFE-CONTRACT-EX-6: a question node's lead-in already said the line the
     *  question is about to test, so the question is spent before it is asked. */
    | 'lead-in-leaks-tested-line'
    /** LIFE-CONTRACT-EX-7: the player DID something and the question node
     *  narrated none of it, so their action vanished from the story. */
    | 'question-omits-lead-in';
  /** Short human-readable description. ⚠ NO LONGER PROMPT TEXT: since
   *  SRV-PROMPT-8..13 batch 8 the retry hint is written server-side from CODES
   *  (`functions/src/prompts/lifeStepViolations.ts`), so this string reaches
   *  the debug overlay and the console and nothing else. */
  message: string;
  /** SRV-PROMPT-12 — set on `unknown-entity-ref` only: the two values its
   *  server-side sentence quotes. Carried structurally so a caller cannot
   *  restate the whole critique. */
  optionId?: string;
  targetId?: string;
};

/** Cross-turn context — the never-repeat rule needs the line that
 *  landed at the previous practice resolution. */
export type ValidatorContext = {
  /** Outbound = template with the correct chip substituted.
   *  Inbound = the verbatim npcUtterance. */
  practicedLine?: string | null;
  /** LIFE-CANON-2/3: the established-entity ledger the options are checked
   *  against. Absent ⇒ the canon checks are skipped (legacy worlds with no
   *  ledger yet never fail a check they cannot possibly satisfy). */
  canon?: WorldCanon | null;
  /** Entities this same response declares — an option MAY reference something
   *  introduced in the very turn that introduces it. */
  introduces?: ReadonlyArray<StepIntroduction>;
  /**
   * LIFE-CONTRACT-EX-7: the `speechAct` of the pick this turn is answering.
   *
   * `'hear'` and absent both DISARM the lead-in requirement, for different
   * reasons that happen to want the same behaviour: a `hear` pick means the
   * NPC speaking IS the event, and an absent one means there was no pick to
   * narrate (an opening turn, a free-text turn the caller did not classify).
   * Neither is a player action that can go missing.
   */
  pickedSpeechAct?: 'say' | 'act' | null;
};

export function validateNodeResponse(
  input: {
    node: NodePreview | null;
    options: ReadonlyArray<
      Pick<StepOption, 'id' | 'practiceText' | 'nativeText'> &
      Partial<Pick<StepOption, 'targetId'>>
    >;
  },
  context?: ValidatorContext,
): ValidatorIssue[] {
  const issues: ValidatorIssue[] = [];
  // LIFE-CANON-2/3 — the two checks that make continuity enforceable rather
  // than merely requested. Run first so their (actionable, specific) hints
  // lead the retry.
  // An EMPTY ledger means nothing has been established yet — a brand-new world
  // on turn one, or a world that predates the ledger. Enforcing then would
  // reject every targeted option for want of a canon that cannot exist yet, so
  // the checks arm only once the ledger has something in it.
  if (context?.canon && canonIndex(context.canon).size > 0) {
    for (const v of canonViolations(input.options, context.canon, context.introduces ?? [])) {
      issues.push({
        code: v.code as ValidatorIssue['code'],
        message: v.detail,
        optionId: v.optionId,
        targetId: v.targetId,
      });
    }
  }

  // LIFE-CONTRACT-EX-4 never-repeat — the live node's beats. (This used to
  // also scan every option's preview beats; with the lookahead gone there is
  // only ever one node's worth of beats in a response — LIFE-NODE-2.)
  const practiced = context?.practicedLine?.trim();
  if (practiced && practiced.length >= 10) {
    const normalised = normaliseForCompare(practiced);
    // LIFE-CONTRACT-EX-6: a question node now HAS beats (its lead-in), so the
    // never-repeat rule applies to it like any other. Skipping it was correct
    // only while `question` was beatless by construction — with the field
    // added, skipping would have opened a hole in exactly the node kind that
    // sits closest to a practised line.
    const scan = (label: string, node: NodePreview | null | undefined) => {
      if (!node) return;
      node.beats.forEach((b, i) => {
        const beat = normaliseForCompare(b.practiceText);
        if (!beat) return;
        if (beat === normalised || beat.includes(normalised)) {
          issues.push({
            code: 'node-repeats-practiced-line',
            message: `${label} beat ${i} repeats the line that was just practised — its bubble already landed at resolution. Emit only what happens AFTER the speech.`,
          });
        } else if (
          normalised.length >= 16 &&
          substantialOverlap(beat, normalised, 0.8)
        ) {
          issues.push({
            code: 'node-repeats-practiced-line',
            message: `${label} beat ${i} substantially overlaps the just-practised line — same content, slightly rephrased. Emit only the next narrative beat.`,
          });
        }
      });
    };
    scan('node', input.node);
  }

  // LIFE-CONTRACT-EX-6 — the lead-in may narrate the ACTION, never the SPEECH.
  // Checked rather than asked for: a pre-empted line reads as a perfectly good
  // beat, so the model has no way to notice it has destroyed its own question.
  const node = input.node;
  if (node?.kind === 'question' && leadInLeaksTestedLine(node.beats, node.gradedPlan)) {
    issues.push({
      code: 'lead-in-leaks-tested-line',
      message:
        'a lead-in beat says the very line this question tests, so the answer is already on screen. Lead-in beats narrate what the PLAYER DID and the world reacting to it — never the utterance being tested. The tested line lands when the question resolves.',
    });
  }

  // LIFE-CONTRACT-EX-7 — the lead-in is REQUIRED after an action, not merely
  // offered.
  //
  // LIFE-CONTRACT-EX-6 gave the question node somewhere to put the player's
  // action and wrote the rule about as forcefully as prose can: *"when the
  // player's pick was an ACTION it MUST: land what they did, and the world's
  // physical reaction to it, BEFORE the teaching moment."* MEASURED over 65
  // archived runs / 712 question turns following an action: 13.8% narrate
  // nothing. That is the owner's original report, still happening, one
  // invariant after it was supposedly fixed.
  //
  // The tell is in the SAME BULLET PAIR. The half about leaking the tested
  // line ends "This is CHECKED; a leak is rejected and you will be asked to
  // redo the turn" — and it is checked, ~10 lines above. The half about
  // narrating the action says MUST and is checked by nothing. The model obeys
  // the checked one. Adding a third, firmer sentence is the move that already
  // failed twice on LIFE-BACKDROP-27's location label.
  //
  // A `say` pick counts: "Ask him what's inside" is a speech ACT whose
  // consequence still has to land. Only `hear` is exempt — there the NPC
  // speaking IS the event — along with a turn that had no pick at all.
  // LIFE-CONTRACT-EX-10 — ONLY an `act` pick requires a lead-in.
  //
  // This armed on everything except `hear`, so a `say` pick with no lead-in was
  // rejected. But BOTH the shipped SI and the per-turn directive tell the model
  // exactly the opposite: "a question that follows a pure SPEECH pick needs no
  // lead-in — the pick and the speech are the same act — so emit `beats: []`".
  // The model obeyed and was charged a full regeneration for it.
  //
  // MEASURED over four runs of the shipped prompt: **9 of the 20
  // `question-omits-lead-in` rejections were `say` picks** — 45% of the defect
  // was the model being right. That is why four separate prompt interventions
  // could not move this number (`LIFE-CONTRACT-EX-9`, `LIFE-PRECEDENCE-1`,
  // `LIFE-SI-LEAN-1`): no wording can fix a rule the validator disagrees with.
  //
  // `say` belongs with `hear`, and the reason is `LIFE-SPEECH-2`: the player's
  // line is ALREADY on screen — the client prepends it the instant they pick,
  // one call before this one. Nothing vanished, so EX-7's premise ("their
  // action never happened on screen") does not hold. Only a physical ACT leaves
  // the screen showing nothing.
  if (
    node?.kind === 'question' &&
    node.beats.length === 0 &&
    context?.pickedSpeechAct === 'act'
  ) {
    issues.push({
      code: 'question-omits-lead-in',
      // LIFE-CONTRACT-EX-8 — this hint used to end "what they did, and the
      // world reacting to it". For a comprehension the world reacting IS the
      // utterance under test, so the hint was walking the model into the
      // sibling invariant, and with MAX_ATTEMPTS=2 that second violation
      // shipped. `stripLeakingLeadIns` now makes the leak impossible either
      // way; the wording is fixed too, because a hint that asks for a
      // forbidden thing wastes the retry it was spent on.
      message:
        'the player just DID something and this question node narrates none of it, so their action never happened on screen. Open the question node with ONE NARRATOR beat: what they did, and the PHYSICAL result — what moved, opened, spilled, went quiet. No spoken line from anybody: the character being tested has not spoken yet, and writing their line here deletes the question. Then the question intercepts.',
    });
  }

  // Duplicate detection across option labels. Options are never
  // graded, so BOTH duplicate practiceText and duplicate nativeText
  // are defects (the fill-blank same-gloss exemption lives with the
  // graded generator, not here).
  const seenPractice = new Map<string, number>();
  const seenNative = new Map<string, number>();
  input.options.forEach((o, i) => {
    const p = o.practiceText.trim().toLowerCase();
    const n = o.nativeText.trim().toLowerCase();
    if (p && seenPractice.has(p)) {
      issues.push({
        code: 'duplicate-practice',
        message: `Option ${i} duplicates option ${seenPractice.get(p)} on practiceText "${p}"`,
      });
    } else if (p) {
      seenPractice.set(p, i);
    }
    if (n && seenNative.has(n)) {
      issues.push({
        code: 'duplicate-native',
        message: `Option ${i} duplicates option ${seenNative.get(n)} on nativeText "${n}"`,
      });
    } else if (n) {
      seenNative.set(n, i);
    }
  });

  return issues;
}

/** Lowercase + strip punctuation/whitespace so the never-repeat
 *  check compares by content only. "«Salut !»" and "Salut" collide. */
function normaliseForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[«»"'`()[\]{}.,!?;:…—–-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Rough overlap detector — longest common substring as a share of
 *  the shorter input. Catches "X" vs "Y said «X»" cheaply. */
function substantialOverlap(a: string, b: string, threshold: number): boolean {
  const m = a.length;
  const n = b.length;
  if (m === 0 || n === 0) return false;
  let prev = new Array<number>(n + 1).fill(0);
  let curr = new Array<number>(n + 1).fill(0);
  let best = 0;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1]! + 1;
        if (curr[j]! > best) best = curr[j]!;
      } else {
        curr[j] = 0;
      }
    }
    [prev, curr] = [curr, prev];
    curr.fill(0);
  }
  const shorter = Math.min(m, n);
  return best / shorter >= threshold;
}

/**
 * `renderRetryHint` LIVED HERE and is DELETED (SRV-PROMPT-3).
 *
 * It rendered the cross-turn retry hint — prompt text — and
 * `generateStepOptions` appended its result to the prompt. Since batch 8 the
 * server writes those sentences from the CODES this module returns
 * (`functions/src/prompts/lifeStepViolations.ts`, the `crossTurn` family), so
 * keeping a second copy here would be the duplication SRV-PROMPT-3 forbids.
 *
 * ⚠ ITS OUTPUT WAS DOUBLE-WRAPPED IN PRODUCTION, and the server reproduces
 * that faithfully rather than quietly fixing it: this function opened
 * `<retryHint>` itself and the call site wrapped the result again, so every
 * cross-turn retry the app has ever sent carried
 * `<retryHint><retryHint>…</retryHint></retryHint>`. Un-nesting changes what
 * the model reads, which needs `npm run test:prompts` evidence rather than a
 * tidy-up. `stepGoldenParity.test.ts` pins the nesting and says so.
 */
