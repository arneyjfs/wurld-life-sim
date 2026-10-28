import { describe, it, expect } from 'vitest';
import {
  chooseComprehensionVariant,
  generationArrivalsForLevel,
  generationResponsesForLevel,
  chooseGenerationVariant,
  comprehensionVariantsForLevel,
  gradedOrdinal,
  shouldListenComprehension,
  shouldListenFill,
} from './exerciseVariant';

describe('LIFE-EX-17 — the permitted SET per level, which is the actual contract', () => {
  /**
   * These replace six tests that asserted `seed % 3 === 2 → listen` and
   * friends. Those pinned the ARITHMETIC, not the rule — and arithmetic against
   * level gates is exactly the shape that let `comprehension:read` become
   * unreachable without a line of code saying so (`LIFE-EX-15`). What matters is
   * which presentations a level permits; how the rotation indexes them is an
   * implementation detail that should be free to change.
   */
  it('level 1 — recognition only, no typing and no tiles; listening still lands', () => {
    // Tiles need a word-order schema the beginner has not built; typing at this
    // level fails on spelling rather than on language. LIFE-EX-20: `listen` has
    // moved OFF this axis — a beginner still meets it, as an arrival.
    expect(generationResponsesForLevel(1)).toEqual(['chips']);
    expect(generationArrivalsForLevel(1)).toEqual(['read', 'listen']);
  });

  it('level 2 — tiles arrive, BEFORE typing', () => {
    // Production without the spelling tax: the words are given, so a failure
    // means "I don't know the pattern", which is the lesson. That makes it the
    // rung between recognising a word and recalling one — below typing, not
    // above it, which is what the old gate had.
    expect(generationResponsesForLevel(2)).toEqual(['chips', 'order']);
  });

  it('level 4 — typing arrives and chips STAYS: a ramp, not a cliff', () => {
    expect(generationResponsesForLevel(4)).toEqual(['chips', 'order', 'type']);
  });

  it('level 5 — the multiple-choice scaffold retires', () => {
    expect(generationResponsesForLevel(5)).toEqual(['order', 'type']);
    for (const level of [5, 6, 7]) {
      expect(generationResponsesForLevel(level), `level ${level}`).not.toContain('chips');
    }
  });

  it('comprehension gains listening at 3 and never loses reading', () => {
    expect(comprehensionVariantsForLevel(2)).toEqual(['read']);
    for (const level of [3, 4, 5, 6, 7]) {
      expect(comprehensionVariantsForLevel(level), `level ${level}`).toEqual(['read', 'listen']);
    }
  });

  it('the rotation visits every permitted RESPONSE and nothing else', () => {
    for (const level of [1, 2, 3, 4, 5, 6, 7]) {
      const permitted = generationResponsesForLevel(level);
      const arrivals = generationArrivalsForLevel(level).length;
      const seen = new Set(
        Array.from({ length: permitted.length * arrivals * 3 }, (_, i) =>
          chooseGenerationVariant(level, i).response),
      );
      expect([...seen].sort(), `level ${level}`).toEqual([...permitted].sort());
    }
  });

  it('defaults difficulty to 2 when absent', () => {
    expect(generationResponsesForLevel(null)).toEqual(generationResponsesForLevel(2));
    expect(generationResponsesForLevel(undefined)).toEqual(generationResponsesForLevel(2));
    expect(generationArrivalsForLevel(null)).toEqual(generationArrivalsForLevel(2));
  });

  it('never divides by zero, however the gates are later retuned', () => {
    // A level permitting nothing is not a level we have; a rotation over an
    // empty list would blank the exercise rather than fail loudly.
    expect(generationResponsesForLevel(0).length).toBeGreaterThan(0);
    expect(generationArrivalsForLevel(0).length).toBeGreaterThan(0);
    expect(chooseGenerationVariant(0, 7).response).toBeTruthy();
    expect(chooseGenerationVariant(0, 7).arrival).toBeTruthy();
  });
});

describe('shouldListenFill — LIFE-EX-9', () => {
  it('agrees with the chosen variant, at every level and slot', () => {
    // Was pinned to `seed 2 → listen`, which is the rotation's arithmetic rather
    // than this predicate's contract. Its job is only to answer "is THIS
    // question a listen-and-fill", so it is tested against the chooser itself.
    for (const level of [1, 2, 3, 4, 5, 6, 7]) {
      for (let seed = 0; seed < 8; seed++) {
        const isListen = chooseGenerationVariant(level, seed).arrival === 'listen';
        expect(shouldListenFill('generation', level, seed), `L${level} s${seed}`).toBe(isListen);
        // Comprehension has its own listening variant and never a blank to fill.
        expect(shouldListenFill('comprehension', level, seed)).toBe(false);
      }
    }
  });

  it('LIFE-EX-12 — a level-1 beginner does reach it; the floor is 1', () => {
    expect(generationArrivalsForLevel(1)).toContain('listen');
  });

  it('is never true for comprehension (no blank to fill)', () => {
    expect(shouldListenFill('comprehension', 5, 2)).toBe(false);
    expect(shouldListenFill('comprehension', 5, 5)).toBe(false);
  });
});

/**
 * LIFE-EX-12 — comprehension gets a presentation rotation too.
 *
 * It had exactly one, for half of all questions: measured 49.6% inbound over
 * 829 graded questions in 61 archived runs. And worse in real play than in the
 * benchmark — an outbound fill-blank needs the player to PICK a `say` option
 * (LIFE-SPEECH-3), so a scene taken physically produces nothing but
 * comprehension, which is what the owner actually hit.
 */
describe('chooseComprehensionVariant — LIFE-EX-12', () => {
  it('alternates read and listen on the same seed the fill-blank rotation uses', () => {
    expect(chooseComprehensionVariant(3, 0)).toBe('read');
    expect(chooseComprehensionVariant(3, 1)).toBe('listen');
    expect(chooseComprehensionVariant(3, 2)).toBe('read');
    expect(chooseComprehensionVariant(3, 3)).toBe('listen');
  });

  it('a LEVEL 1 beginner does NOT — AMENDED by LIFE-EX-14', () => {
    // This asserted `listen` when LIFE-EX-12 landed, on the reasoning that a
    // beginner meeting one presentation for a whole wurld was the real defect.
    // Half of that still stands: a beginner meets listening from level 1, via
    // listen-and-FILL, which has the sentence on screen and one blank to aim
    // at. Whole-sentence comprehension-listening withholds the line entirely
    // and is a different exercise; the owner moved it to level 3.
    expect(chooseComprehensionVariant(1, 1)).toBe('read');
    expect(chooseComprehensionVariant(3, 1)).toBe('listen');
  });

  it('defaults difficulty to 2 when absent — so read, under the LIFE-EX-14 gate', () => {
    expect(chooseComprehensionVariant(null, 1)).toBe('read');
    expect(chooseComprehensionVariant(undefined, 0)).toBe('read');
  });

  it('is DETERMINISTIC — same seed, same variant', () => {
    // No Math.random: varied in play, reproducible in tests, and a re-render
    // mid-question must never swap the exercise out from under the player.
    for (const seed of [0, 1, 7, 42]) {
      expect(chooseComprehensionVariant(4, seed)).toBe(chooseComprehensionVariant(4, seed));
    }
  });
});

describe('shouldListenComprehension — LIFE-EX-12', () => {
  it('is true ONLY for comprehension on a listen slot', () => {
    expect(shouldListenComprehension('comprehension', 3, 1)).toBe(true);
    expect(shouldListenComprehension('comprehension', 3, 0)).toBe(false);
  });

  it('is never true for a fill-blank — that is shouldListenFill\'s job', () => {
    // The two rotations are separate on purpose: a fill-blank speaks the
    // COMPLETED sentence, a comprehension speaks the NPC's verbatim line, and
    // one predicate answering for both would route the wrong text to TTS.
    expect(shouldListenComprehension('generation', 3, 1)).toBe(false);
  });
});

/**
 * LIFE-EX-14 — the listening LADDER.
 *
 * Owner, 2026-08-06: *"At levels 1-2 listen should only be listen and fill.
 * Not listen for the whole sentence. Level 3 should be listen to whole
 * sentence but not too hard. 4-7 should be harder and more and more native."*
 *
 * This AMENDS LIFE-EX-12 rather than reversing it: listening still starts at
 * level 1, but only in the form that gives the learner something to aim at.
 */
describe('LIFE-EX-14 — whole-sentence listening waits for level 3', () => {
  const bothSeeds = [0, 1, 2, 3, 4, 5, 6, 7];

  it('levels 1-2 NEVER get a listening comprehension, on any seed', () => {
    for (const level of [1, 2]) {
      for (const seed of bothSeeds) {
        expect(chooseComprehensionVariant(level, seed), `L${level} seed ${seed}`).toBe('read');
      }
    }
  });

  it('levels 3-7 still alternate read / listen', () => {
    for (const level of [3, 4, 5, 6, 7]) {
      const seen = new Set(bothSeeds.map((s) => chooseComprehensionVariant(level, s)));
      expect(seen, `L${level}`).toEqual(new Set(['read', 'listen']));
    }
  });

  it('a beginner still meets LISTENING — via fill, which LIFE-EX-12 kept at level 1', () => {
    // The half of LIFE-EX-12 that stands. A level-1 player who met no audio at
    // all would be the regression this amendment must not cause.
    // LIFE-EX-20: `listen` is an ARRIVAL now, not one entry in the response
    // list — so this reads the arrival axis. The invariant is unchanged and is
    // exactly the one worth keeping: a level-1 player must still meet audio.
    const heard = [1, 2].flatMap((level) =>
      bothSeeds.map((s) => chooseGenerationVariant(level, s).arrival),
    );
    expect(heard).toContain('listen');
  });

  it('an absent difficulty is treated as level 2 — read, not listen', () => {
    // Same default the rest of the module uses (`difficulty ?? 2`). A world
    // with no difficulty must not silently get the hardest presentation.
    for (const seed of bothSeeds) {
      expect(chooseComprehensionVariant(null, seed)).toBe('read');
      expect(chooseComprehensionVariant(undefined, seed)).toBe('read');
    }
  });

  it('shouldListenComprehension honours the same gate', () => {
    expect(shouldListenComprehension('comprehension', 2, 1)).toBe(false);
    expect(shouldListenComprehension('comprehension', 3, 1)).toBe(true);
  });
});

/**
 * LIFE-EX-15 — every variant a level permits must be REACHABLE at that level.
 *
 * The bug this replaces was not a rare miss, it was an impossibility. A kind
 * rotation (`gradedKindForSlot`, since deleted by LIFE-EX-18) read the same
 * counter the variant rotations did: even →
 * fill-blank, odd → comprehension. So comprehension only ever occurred at an
 * ODD seed, and `chooseComprehensionVariant` returned `listen` at exactly
 * `seed % 2 === 1` — making `read` unreachable at every level >= 3, forever.
 * Half of all questions had one presentation, which is the defect that
 * function's own comment says it exists to prevent.
 *
 * These tests walk the ACTUAL sequence a player experiences — kind chosen by the
 * slot, variant chosen by the per-kind ordinal — rather than testing either
 * function in isolation. Isolation is what hid it: both functions were correct
 * on their own and wrong together.
 */
describe('LIFE-EX-15 — the rotations are independent of the kind alternation', () => {
  /**
   * Every presentation reachable as each KIND's own ordinal advances.
   *
   * This used to walk `gradedKindForSlot` to decide which kind each slot was,
   * then index that kind's rotation. `LIFE-EX-18` deleted the rotation — the
   * kind is derived from whose line the plan holds — and the test is better for
   * it: coupling the reachability check to the kind sequence is precisely the
   * coupling that let `comprehension:read` go unreachable in the first place.
   * The two rotations are now independent by construction, so they are walked
   * independently.
   */
  const walk = (level: number, moments = 40): Set<string> => {
    const seen = new Set<string>();
    for (let ordinal = 0; ordinal < moments; ordinal++) {
      const v = chooseGenerationVariant(level, ordinal);
      seen.add(`gen:${v.arrival}+${v.response}`);
      seen.add(`comp:${chooseComprehensionVariant(level, ordinal)}`);
    }
    return seen;
  };

  it('comprehension:read is reachable at EVERY level — it was reachable at none >= 3', () => {
    for (const level of [1, 2, 3, 4, 5, 6, 7]) {
      expect(walk(level), `level ${level}`).toContain('comp:read');
    }
  });

  it('comprehension:listen is reachable from its gate up, and never below it', () => {
    for (const level of [1, 2]) expect(walk(level)).not.toContain('comp:listen');
    for (const level of [3, 4, 5, 6, 7]) {
      expect(walk(level), `level ${level}`).toContain('comp:listen');
    }
  });

  it('LIFE-EX-20 — every PAIR its level permits is reachable', () => {
    // The odometer's whole promise. Before the split this could only ever be a
    // list of four singles; `listen+type` did not exist as an expressible
    // state, let alone a reachable one.
    for (const level of [1, 2]) {
      expect(walk(level), `level ${level}`).toContain('gen:read+chips');
      expect(walk(level), `level ${level}`).toContain('gen:listen+chips');
    }
    for (const level of [4, 5, 6, 7]) {
      expect(walk(level), `level ${level}`).toContain('gen:read+type');
      // THE NEW ONE: hear the sentence, then produce the missing word from
      // memory with no chips to recognise it from.
      expect(walk(level), `level ${level}`).toContain('gen:listen+type');
    }
    for (const level of [2, 3, 4, 5, 6, 7]) {
      expect(walk(level), `level ${level}`).toContain('gen:read+order');
    }
  });

  it('LIFE-EX-20 — `order` always arrives as READ, and that is a DECISION', () => {
    // `arrivalFor`. Word-order's answer IS the sentence, so there is no blanked
    // template that can share the screen with the audio without giving it away.
    // Pinned so the exception reads as deliberate — an arrival axis that
    // silently did nothing for one response is the LIFE-EX-15 defect again.
    for (const level of [2, 3, 4, 5, 6, 7]) {
      expect(walk(level), `level ${level}`).not.toContain('gen:listen+order');
    }
    for (let ordinal = 0; ordinal < 40; ordinal++) {
      const v = chooseGenerationVariant(4, ordinal);
      if (v.response === 'order') expect(v.arrival, `ordinal ${ordinal}`).toBe('read');
    }
  });

  it('LIFE-EX-20 — the odometer visits every pair BEFORE it repeats one', () => {
    // Not two independent `% n` on one seed: that is the phase-lock that made
    // comprehension:read unreachable. An odometer cannot lock, and this is the
    // assertion that says so rather than leaving it to be re-derived.
    for (const level of [1, 3, 4, 6]) {
      const arrivals = generationArrivalsForLevel(level).length;
      const responses = generationResponsesForLevel(level).length;
      const period = arrivals * responses;
      const seen = new Set<string>();
      for (let ordinal = 0; ordinal < period; ordinal++) {
        const v = chooseGenerationVariant(level, ordinal);
        seen.add(`${v.arrival}+${v.response}`);
      }
      // `order` folds its arrival to `read`, so the distinct-pair count is the
      // product MINUS the listen+order cells the fold collapses.
      const folded = generationResponsesForLevel(level).includes('order') && arrivals > 1 ? 1 : 0;
      expect(seen.size, `level ${level}`).toBe(period - folded);
    }
  });

  it('gradedOrdinal counts only corrections OF THAT KIND', () => {
    const events = [
      { kind: 'correction', payload: { kind: 'generation' } },
      { kind: 'decision', payload: {} },
      { kind: 'correction', payload: { kind: 'comprehension' } },
      { kind: 'correction', payload: { kind: 'generation' } },
      { kind: 'question_demoted', payload: {} },
    ];
    expect(gradedOrdinal(events, 'generation')).toBe(2);
    expect(gradedOrdinal(events, 'comprehension')).toBe(1);
  });

  it('gradedOrdinal is 0 on an empty log and ignores unpayloaded corrections', () => {
    expect(gradedOrdinal([], 'generation')).toBe(0);
    expect(gradedOrdinal([{ kind: 'correction' }], 'generation')).toBe(0);
  });
});
