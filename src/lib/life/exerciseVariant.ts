/**
 * LIFE-EX-9: which RENDER variant a fill-blank graded question takes. All
 * variants test the SAME authored fill-blank (one `life_graded_question` gen);
 * the client just swaps the presentation for variety, so "the questions
 * following an event option" stop feeling samey (the owner ask):
 *
 *   - 'chips'  — the default multiple-choice grid (LIFE-EX-1).
 *   - 'type'   — the player TYPES the missing word (LIFE-EX-8, intermediate+).
 *   - 'listen' — the completed sentence is SPOKEN (TTS autoPlay) and the player
 *                picks the word they heard (LIFE-EX-9, a listening exercise).
 *
 * The variant is a deterministic function of the difficulty + a per-question
 * `seed` (the count of graded questions already resolved in this wurld), so it
 * ROTATES across questions — varied in play, predictable in tests — with no
 * extra LLM call and no Math.random.
 */
import { TYPE_FILL_MIN_LEVEL } from './typeToFill';

/**
 * LIFE-EX-20 — a generation exercise is a PAIR on two orthogonal axes.
 *
 * This was one list, `'chips' | 'type' | 'listen' | 'order'`, and the odd one
 * out is `listen`: the other three say how the player ANSWERS, while `listen`
 * says how the prompt ARRIVES. Conflating them silently defined `listen` as
 * "spoken, answered with chips" and made the two best exercises in the set —
 * hear a sentence and TYPE the missing word, hear it and rebuild the ORDER —
 * unreachable. Nobody decided that; it fell out of the encoding.
 */
export type GenerationArrival = 'read' | 'listen';
export type GenerationResponse = 'chips' | 'type' | 'order';

/** LIFE-EX-12: listening lands from level 1.
 *
 *  This was 2, on the assumption that hearing a line needs footing that
 *  reading it does not. The owner reports the opposite — listening and fill
 *  are the EASIER forms for them — and the cost of the guess was severe: under
 *  the old floor a level-1 player met `chips` and nothing else for the entire
 *  wurld, because `order` needs 3 and `type` needs 4. One presentation, for
 *  every question, for ever. */
export const LISTEN_FILL_MIN_LEVEL = 1;
/**
 * LIFE-EX-17 — word-order lands at 2, and BEFORE type-to-fill, not after.
 *
 * Was 3, which put it one level ABOVE typing in the old cascade's effective
 * order. That is the wrong rung. Arranging tiles is production WITHOUT the
 * spelling tax: the words are given, so the exercise is syntax, and a failure
 * means "I don't know the pattern" rather than "I missed an accent". That makes
 * it the natural step between recognising a word (`chips`) and recalling one
 * (`type`), so it belongs below typing, not above it.
 *
 * Not 1: a beginner has no word-order schema to exercise yet, so the tiles
 * become guesswork and a lucky arrangement teaches nothing.
 */
export const WORD_ORDER_MIN_LEVEL = 2;

/**
 * LIFE-EX-17 — the level at which the multiple-choice scaffold RETIRES.
 *
 * The old cascade dropped `chips` the moment `type` became available, because
 * type occupied its slot: level 4 stepped from recognition straight to full
 * recall with no overlap. One level of both is a ramp instead of a cliff, and
 * recognition still has a job at 4 — it is the right presentation when the
 * target is a word the player is meeting for the first time.
 */
export const CHIPS_RETIRE_LEVEL = 5;

/**
 * LIFE-EX-14: whole-sentence LISTENING starts at level 3.
 *
 * AMENDS LIFE-EX-12, which made comprehension-listening available at every
 * level in the same breath as dropping `LISTEN_FILL_MIN_LEVEL` to 1. The first
 * half was right and stands — a beginner still meets listening from level 1 —
 * but the two are not one exercise in different clothes:
 *
 *   listen-and-FILL   the sentence is ON SCREEN with one blank. The audio is
 *                     support, and there is a target to aim at.
 *   listen-COMPREHEND the line is withheld in print entirely. The audio is the
 *                     whole question.
 *
 * Owner, 2026-08-06: *"At levels 1-2 listen should only be listen and fill.
 * Not listen for the whole sentence."* So levels 1-2 keep three presentations
 * (fill-chips · fill-listen · comprehension-read), every one of which still
 * carries audio, and the unsupported form waits until there is footing for it.
 */
export const COMPREHENSION_LISTEN_MIN_LEVEL = 3;

/**
 * LIFE-EX-15 — the seed each rotation is indexed by, and the bug it fixes.
 *
 * ── THE COLLISION ───────────────────────────────────────────────────────────
 *
 * `exerciseSeed` used to be "how many graded questions this wurld has resolved"
 * — ONE counter, shared. A kind ROTATION (`gradedKindForSlot`, since deleted by
 * LIFE-EX-18) indexed the KIND off the same number: even → fill-blank, odd →
 * comprehension. So a comprehension question
 * could only ever occur at an ODD seed, and `chooseComprehensionVariant`
 * returned `listen` exactly when `seed % 2 === 1`.
 *
 * **`read` was therefore unreachable at every level ≥ 3.** Not rare — impossible.
 * Half of all questions had exactly one presentation, which is the defect that
 * function's own comment says it was written to remove ("Comprehension had
 * exactly one presentation while the fill-blank had four"). The rotation's PHASE
 * was locked to the kind's parity, so it could never rotate.
 *
 * The fill-blank side survived by luck: a 3-slot rotation sampled at even seeds
 * still visits all three slots, just at half rate.
 *
 * ── THE FIX ─────────────────────────────────────────────────────────────────
 *
 * Index each kind's rotation by how many of THAT KIND have resolved. The two
 * rotations then advance independently of the alternation, and of each other.
 * Enumerated exhaustively in `exerciseVariant.test.ts` — every variant its level
 * permits is reachable, at every level.
 */
export function gradedOrdinal(
  events: ReadonlyArray<{ kind: string; payload?: unknown }>,
  kind: 'generation' | 'comprehension',
): number {
  let n = 0;
  for (const e of events) {
    if (e.kind !== 'correction') continue;
    const p = (e.payload ?? {}) as { kind?: unknown };
    if (p.kind === kind) n += 1;
  }
  return n;
}

/**
 * LIFE-EX-17 — the presentations a level PERMITS, as an explicit list.
 *
 * The rotation used to be a cascade of guarded returns over `seed % 3`, and
 * that shape is what hid `LIFE-EX-15`: which variants were reachable was an
 * emergent property of modular arithmetic against level gates, so a variant
 * could become unreachable without any line of code saying so. Here the
 * permitted set is BUILT, then indexed — every entry is reachable by
 * construction, and the level ladder reads off the page.
 */
export function generationResponsesForLevel(
  difficulty: number | null | undefined,
): GenerationResponse[] {
  const level = difficulty ?? 2;
  const out: GenerationResponse[] = [];
  if (level < CHIPS_RETIRE_LEVEL) out.push('chips');
  if (level >= WORD_ORDER_MIN_LEVEL) out.push('order');
  if (level >= TYPE_FILL_MIN_LEVEL) out.push('type');
  // A level that permits nothing is not a level we have, but a rotation over an
  // empty list would divide by zero and blank the exercise.
  return out.length > 0 ? out : ['chips'];
}

export function generationArrivalsForLevel(
  difficulty: number | null | undefined,
): GenerationArrival[] {
  const level = difficulty ?? 2;
  return level >= LISTEN_FILL_MIN_LEVEL ? ['read', 'listen'] : ['read'];
}

/**
 * LIFE-EX-20 — the ODOMETER, and why it is not two independent `% n`.
 *
 * Indexing both axes off `seed % len` would relate their phases to each other
 * through the seed, which is the precise mechanism that made
 * `comprehension:read` unreachable (`LIFE-EX-15`): whenever the two lengths
 * share a factor, some pairs never come up, and nothing in the code says which.
 *
 * An odometer cannot do that. The arrival axis turns every question; the
 * response axis advances one place per full turn of the arrival axis. Every
 * PAIR is visited before any repeats, at every level, by construction — which
 * is a property a test can assert directly instead of inferring from modular
 * arithmetic.
 */
export function chooseGenerationVariant(
  difficulty: number | null | undefined,
  seed: number,
): { arrival: GenerationArrival; response: GenerationResponse } {
  const arrivals = generationArrivalsForLevel(difficulty);
  const responses = generationResponsesForLevel(difficulty);
  const n = Math.abs(Math.trunc(seed));
  const response = responses[Math.floor(n / arrivals.length) % responses.length]!;
  const arrival = arrivals[n % arrivals.length]!;
  return { arrival: arrivalFor(response, arrival), response };
}

/**
 * LIFE-EX-20 — the ONE pair the axes do not produce, stated out loud.
 *
 * `listen` + `order` has no honest rendering yet. The other two arrivals pair
 * cleanly: `listen`+`chips` and `listen`+`type` both show the blanked template
 * beside the audio, which is the whole point of listen-and-FILL — you hear the
 * sentence, you see where the hole is. Word-order has no blank; its answer IS
 * the sentence, so there is no template that can share the screen with the
 * audio without giving the answer away. The right UI is audio + word bank and
 * NO practice text, which is a component that does not exist.
 *
 * So `order` arrives as `read` until that component does. **Stated here, as a
 * function, rather than left to happen inside the render** — a render that
 * quietly ignored the arrival axis for one response would make a third of the
 * axis do nothing with no line of code admitting it, which is the exact defect
 * `LIFE-EX-15` and `LIFE-EX-20` are both about. Asserted in the tests, so it
 * reads as a decision and not as an omission.
 */
function arrivalFor(
  response: GenerationResponse,
  arrival: GenerationArrival,
): GenerationArrival {
  return response === 'order' ? 'read' : arrival;
}

/** Convenience predicate mirroring `shouldTypeFill`. Comprehension is never a
 *  listen-and-FILL (there is no blank to fill) — it has its own listening
 *  variant instead, `chooseComprehensionVariant` below.
 *
 *  LIFE-EX-20: this now reads the ARRIVAL axis, so it is true for
 *  `listen`+`type` and `listen`+`order` as well as `listen`+`chips`. Those two
 *  combinations did not exist before and are the point of the split. */
export function shouldListenFill(
  kind: string,
  difficulty: number | null | undefined,
  seed: number,
): boolean {
  return kind === 'generation' && chooseGenerationVariant(difficulty, seed).arrival === 'listen';
}

/** LIFE-EX-12: how an INBOUND question is presented.
 *
 *   - 'read'   — the NPC's line is printed and the player interprets it.
 *   - 'listen' — the line is SPOKEN and withheld in print until they answer.
 *
 * Comprehension had exactly one presentation while the fill-blank had four,
 * and it is ~half of all questions (measured 49.6% inbound over 829). In real
 * play it is worse than half: an outbound fill-blank is gated on the player
 * picking a `say` option (LIFE-SPEECH-3), so a scene the player takes
 * physically produces comprehension every single time.
 *
 * A TWO-slot alternation rather than the fill-blank's three: there are only
 * two honest ways to receive a spoken line, and stretching it to three would
 * mean inventing a variant to fill the slot. */
export type ComprehensionVariant = 'read' | 'listen';

export function comprehensionVariantsForLevel(
  difficulty: number | null | undefined,
): ComprehensionVariant[] {
  return (difficulty ?? 2) >= COMPREHENSION_LISTEN_MIN_LEVEL ? ['read', 'listen'] : ['read'];
}

export function chooseComprehensionVariant(
  difficulty: number | null | undefined,
  seed: number,
): ComprehensionVariant {
  const list = comprehensionVariantsForLevel(difficulty);
  return list[Math.abs(Math.trunc(seed)) % list.length]!;
}

/** Sibling of `shouldListenFill`, kept separate on purpose: a fill-blank
 *  speaks the COMPLETED sentence and a comprehension speaks the NPC's verbatim
 *  line, so one predicate answering for both would send the wrong text to
 *  TTS. */
export function shouldListenComprehension(
  kind: string,
  difficulty: number | null | undefined,
  seed: number,
): boolean {
  return kind === 'comprehension' && chooseComprehensionVariant(difficulty, seed) === 'listen';
}

/** The fill-blank template with the CORRECT chip substituted into the blank —
 *  what the listen-and-fill exercise SPEAKS (LIFE-EX-9). Falls back to the raw
 *  template (blank spoken as nothing) if no correct chip is present. Matches
 *  `resolveGraded`'s `/_{2,}/` fill so the spoken line == the resolved bubble. */
export function completedFillBlank(
  template: string,
  choices: ReadonlyArray<{ practiceText: string; correctness?: string | null }>,
): string {
  const correct = choices.find((c) => c.correctness === 'correct');
  return correct ? template.replace(/_{2,}/, correct.practiceText) : template;
}
