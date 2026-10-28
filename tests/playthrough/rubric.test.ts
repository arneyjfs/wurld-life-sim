/**
 * CALIBRATION — does the benchmark FAIL on things that are actually bad?
 *
 * This runs in the ordinary unit suite (no network, no money). It exists
 * because of the lesson the watch-list already taught once: the five original
 * signals all passed on a world that read back as one scene told ten times. A
 * signal set that has never failed on a known-bad case is not evidence of
 * anything — so every check here is fed a deliberately broken input and
 * required to notice.
 */
import { describe, it, expect } from 'vitest';
import {
  collapse, composite, medianScores, scoreCadence, scoreDirections,
  scoreLeaningMovement, scoreLexiconNames,
  scoreSpread, scoreSubjects,
  type Score, type TurnLike,
} from './rubric';
import { renderTranscript, verifyEvidence } from './judge';
import type { OptionType } from '@/types/lifeState';

const beat = (native: string) => ({ speaker: 'narrator', name: null, practice: '', native });
const opt = (id: string, type: OptionType, label: string, targetId: string | null = null) =>
  ({ id, type, targetId, label });

const turn = (over: Partial<TurnLike> = {}): TurnLike => ({
  beats: [beat('Something ordinary happened.')],
  options: [opt('a', 'ask', 'Ask about it'), opt('b', 'do', 'Pick it up')],
  ...over,
});

describe('Q-CADENCE', () => {
  it('FAILS a scene with no question at all', () => {
    expect(scoreCadence([turn(), turn(), turn(), turn()]).score).toBe(0);
  });

  it('FAILS questions crammed back to back', () => {
    const q = { kind: 'generation', target: 'x', line: 'l' };
    const s = scoreCadence([turn({ graded: q }), turn({ graded: q }), turn({ graded: q })]);
    expect(s.score).toBeLessThanOrEqual(1);
  });

  it('rewards the 2-3 turn band', () => {
    const q = { kind: 'generation', target: 'x', line: 'l' };
    const s = scoreCadence([turn(), turn({ graded: q }), turn(), turn({ graded: q }), turn(), turn({ graded: q })]);
    expect(s.score).toBeGreaterThanOrEqual(3);
  });
});

describe('OPT-SPREAD', () => {
  it('FAILS a grid where every option is the same type — the reported complaint', () => {
    const same = turn({ options: [opt('a', 'ask', 'Ask X'), opt('b', 'ask', 'Ask Y'), opt('c', 'ask', 'Ask Z')] });
    expect(scoreSpread([same, same]).score).toBe(0);
  });

  it('FAILS a grid that repeats the previous turn verbatim', () => {
    const a = turn({ options: [opt('a', 'ask', 'Ask', 'marc'), opt('b', 'do', 'Do', 'crate')] });
    expect(scoreSpread([a, a, a]).score).toBeLessThanOrEqual(1);
  });

  it('passes a varied, moving grid', () => {
    const a = turn({ options: [opt('a', 'ask', 'Ask', 'marc'), opt('b', 'do', 'Do', 'crate')] });
    const b = turn({ options: [opt('c', 'move', 'Go', 'dock'), opt('d', 'observe', 'Look', 'list')] });
    expect(scoreSpread([a, b]).score).toBe(4);
  });
});

/*
 * OPT-LEAK HAS NO CALIBRATION TESTS BECAUSE IT HAS NO MEASURED CHECK.
 *
 * There were seven of them, and they all passed — on hand-written inputs.
 * Against four real playthroughs the same check reported false-positive rates
 * of 28%, 32%, 41% and 67%, flagging "still works", "break room" and
 * "installation process" as leaked story. Three narrowings did not fix it,
 * because the signal is not in the text: whether "the bandage cabinet" is a
 * leak depends on whether the world HAS one, which is a canon question.
 *
 * The lesson is about this file as much as about that check. Calibration on
 * invented inputs proves a check fires on the case you thought of; it says
 * nothing about what else it fires on. Every check here should be re-read
 * against a real run's evidence before its number is believed.
 *
 * The dimension is now JUDGED ONLY, and the machine half lives where it always
 * belonged — `canonViolations`, refusing a bad `targetId` at commit time,
 * before the player ever sees the option. See the note on OPT-LEAK in
 * `rubric.ts`.
 */

/*
 * CLICHE HAS NO MEASURED CHECK EITHER — it is judged, under the band
 * descriptors in `markScheme.ts`.
 *
 * The count matched `ash` inside "wash-house" and "cash flow" and `final`
 * inside "finally", scoring 0/4 on two worlds whose prose was fine. Word
 * boundaries fixed that and left the real problem: the lexicon bans these words
 * as ATMOSPHERE and permits them doing concrete work, and no text test
 * distinguishes "the dusty toolbox" from "the Archive of Dust".
 *
 * CLICHE-NAME below survives as a measured check because a NAME has no
 * surrounding sentence to interpret — zero false positives across 74 names of a
 * real run, against 28-67% for the prose version.
 */

describe('CLICHE-NAME — the surface the lexicon ban was written for', () => {
  const banned = ['silence', 'shadow', 'unspoken', 'echo', 'ash'];

  it('CATCHES the reported failure verbatim', () => {
    // "the Syndicate of Silence", "the Archive of Unspoken Vows", "the
    // Echo-Heirs" — all from one session, and all the same name.
    const s = scoreLexiconNames(
      ['The Syndicate of Silence', 'The Archive of Unspoken Vows', 'Rue Cendrillon'],
      banned,
    );
    expect(s.score).toBe(0);
    expect(s.evidence).toMatch(/Syndicate of Silence/);
  });

  it('passes names a player can point at', () => {
    // The rule's own prescription: "a street, a dish, a shop sign, a boat, a
    // debt, a nickname". Measured across four real worlds: 0 hits in 74 names,
    // so this check passes on real data rather than only on a fixture.
    const s = scoreLexiconNames(
      ['La Ferme des Trois Ruisseaux', "Bébert's Ledger", 'The Tuesday Market', 'Mathieu Vignaud'],
      banned,
    );
    expect(s.score).toBe(4);
  });

  it('does not match inside a longer word', () => {
    expect(scoreLexiconNames(['The Wash-house', 'Cashel Road'], banned).score).toBe(4);
  });

  it('says UNMEASURED rather than passing when there are no names', () => {
    expect(scoreLexiconNames([], banned).score).toBe(-1);
  });
});

describe('SUBJECT-SPREAD', () => {
  it('FAILS the ten-scenes-one-subject world this check was written for', () => {
    // The measured failure: every line about Pierre closing the bakery.
    const history = [
      'Pierre revealed he is considering selling his bakery because of failing health.',
      'Pierre confirmed his failing health is forcing him to abandon the bakery.',
      'Pierre confirmed his decision to close the bakery permanently.',
      'The village confirmed awareness of Pierre closing his failing bakery.',
      'Pierre is physically unable to continue the bakery because of health.',
    ];
    const s = scoreSubjects(history);
    expect(s.score).toBe(0);
    expect(s.evidence).toMatch(/bakery|pierre|health/i);
  });

  it('passes a world whose scenes are about different things', () => {
    const history = [
      'Amandine agreed to share the Saturday market run.',
      'The lease notice appeared on the shopfront and nobody would say who put it there.',
      'You repaired the delivery bicycle and Bernard finally used your name.',
      'A cousin arrived from Lyon and refused to explain why.',
    ];
    expect(scoreSubjects(history).score).toBeGreaterThanOrEqual(3);
  });
});

describe('the judge cannot inflate', () => {
  const source = 'Marc counted the change twice and pushed it across the counter.';

  it('CAPS a high score whose quote is not in the transcript', () => {
    const [s] = verifyEvidence(
      [{ dimension: 'PROSE', score: 4, evidence: 'a sentence nobody ever wrote', note: 'lovely' }],
      source,
    );
    expect(s?.score).toBe(2);
    expect(s?.note).toMatch(/capped to 2/);
  });

  it('KEEPS a high score whose quote is real', () => {
    const [s] = verifyEvidence(
      [{ dimension: 'PROSE', score: 4, evidence: 'Marc counted the change twice', note: 'specific' }],
      source,
    );
    expect(s?.score).toBe(4);
  });

  it('leaves low scores alone — they need no quote', () => {
    const [s] = verifyEvidence(
      [{ dimension: 'PROSE', score: 1, evidence: '', note: 'generic throughout' }],
      source,
    );
    expect(s?.score).toBe(1);
  });
});

describe('collapse', () => {
  it('keeps the WORSE of a dimension scored by both layers', () => {
    // OPT-LEAK is measured by a substring check AND judged, because neither
    // alone is enough. The report printed both, adjacent, with nothing saying
    // which one the composite used.
    const out = collapse([
      { dimension: 'OPT-LEAK', score: 0, evidence: 'named the wire', note: 'measured' },
      { dimension: 'OPT-LEAK', score: 2, evidence: '', note: 'judged' },
      { dimension: 'PROSE', score: 3, evidence: '', note: '' },
    ]);
    expect(out).toHaveLength(2);
    expect(out.find((s) => s.dimension === 'OPT-LEAK')?.score).toBe(0);
    expect(out.find((s) => s.dimension === 'OPT-LEAK')?.note).toBe('measured');
  });
});

describe('composite', () => {
  it('reports a gate failure SEPARATELY rather than averaging it away', () => {
    const c = composite([
      { dimension: 'PROSE', score: 4, evidence: '', note: '' },
      { dimension: 'CHARACTER', score: 4, evidence: '', note: '' },
      { dimension: 'INTRIGUE', score: 4, evidence: '', note: '' },
      { dimension: 'OPT-LEAK', score: 1, evidence: 'leaked the wire', note: '' },
    ]);
    // The mean stays high — which is exactly why the gate is reported apart.
    expect(c.mean).toBeGreaterThan(3);
    expect(c.gateFailures.map((g) => g.dimension)).toEqual(['OPT-LEAK']);
  });
});

describe('Q-DIRECTION', () => {
  const q = (direction: string, origin: string) => ({ graded: { direction, origin } });

  it('FAILS a run where only one direction ever fired', () => {
    // The aggregate count looks fine — six questions — but every one of them
    // asks the player to produce, and none to understand.
    const s = scoreDirections([...Array<number>(6)].map(() => q('outbound', 'client')));
    expect(s.score).toBe(0);
    expect(s.note).toMatch(/inbound.*dead|other route is dead/i);
  });

  it('names WHICH route is dead, and by origin', () => {
    // Two inbound questions: inbound is alive, OUTBOUND is the dead one, and
    // `origin` says client-side interception never ran.
    const s = scoreDirections([q('inbound', 'model'), q('inbound', 'model')]);
    expect(s.note).toMatch(/outbound route is dead/i);
    expect(s.evidence).toMatch(/client 0 \/ model 2/);
  });

  it('passes a run that fires both', () => {
    const s = scoreDirections([
      q('outbound', 'client'), q('inbound', 'model'),
      q('outbound', 'client'), q('inbound', 'model'),
    ]);
    expect(s.score).toBe(4);
  });

  it('does not read zero questions as a direction failure', () => {
    // Absent data is not a pass — but it is also not a *balance* defect. The
    // note must point at Q-CADENCE rather than invent a second finding from
    // the same missing evidence.
    const s = scoreDirections([{ graded: null }, { graded: null }]);
    expect(s.score).toBe(0);
    expect(s.note).toMatch(/Q-CADENCE/);
  });
});

describe('absent data is not a FAILURE either', () => {
  // The mirror of the vacuous pass. A dimension the run was too short to
  // exhibit must report UNMEASURED (-1), which `composite` excludes from the
  // mean — not a low number that drags the aggregate and hides real movement.

  it('SUBJECT-SPREAD withholds a score on two scene lines', () => {
    // Two lines sharing any word is 2/2 = 100% dominance, which scored 0 on a
    // world whose two scenes were about entirely different things.
    const s = scoreSubjects(['The water ran out at the north well.', 'A water tax was announced.']);
    expect(s.score).toBe(-1);
    expect(s.note).toMatch(/UNMEASURED/);
  });

  it('collapse prefers a real score over an UNMEASURED one', () => {
    // Taking the minimum blindly would let a layer that could not see its
    // subject overrule one that could.
    const out = collapse([
      { dimension: 'CLICHE', score: -1, evidence: '', note: 'unmeasured' },
      { dimension: 'CLICHE', score: 3, evidence: '', note: 'judged' },
    ]);
    expect(out[0]?.score).toBe(3);
  });

  it('an UNMEASURED gate is not a failed gate', () => {
    const c = composite([
      { dimension: 'OPT-LEAK', score: -1, evidence: '', note: 'nothing to check' },
      { dimension: 'PROSE', score: 3, evidence: '', note: '' },
    ]);
    expect(c.gateFailures).toEqual([]);
    expect(c.mean).toBe(3);
  });
});

describe('absent data is not a pass', () => {
  it('OPT-SPREAD scores 0, not 4, when no turn carried options', () => {
    // The first benchmark run reported OPT-SPREAD 4/4/4/4 across four worlds
    // that had ZERO options — a harness bug returning as a clean bill of
    // health. A check that cannot see its subject must say so.
    const blind = [turn({ options: [] }), turn({ options: [] })];
    const s = scoreSpread(blind);
    expect(s.score).toBe(0);
    expect(s.note).toMatch(/nothing to measure/i);
  });
});

describe('the judged transcript shows what the player chose', () => {
  it('marks the taken option, and leaves the others visible as the counterfactual', () => {
    // The artifact page for a human reader always showed the pick in bold. The
    // JUDGE's copy did not, and `TurnLike` had no `chose` field at all — so the
    // model was asked "did the player's choice shape what followed" while
    // unable to see which choice was made. INTENT came back a flat 2 on every
    // world, which is what a judge returns when it cannot tell.
    //
    // The un-taken options matter as much as the taken one: the INTENT
    // procedure scores the next turn AGAINST what the others would have led to.
    const t = turn({
      options: [opt('a', 'ask', 'Ask about the pump'), opt('b', 'move', 'Head to the shed')],
      chose: 'Head to the shed',
    });
    const out = renderTranscript([t]);
    expect(out).toMatch(/▶ TAKEN.*Head to the shed/);
    expect(out).toMatch(/not taken.*Ask about the pump/);
  });

  it('marks nothing when no pick was recorded, rather than guessing', () => {
    const out = renderTranscript([turn({ chose: null })]);
    expect(out).not.toMatch(/TAKEN/);
  });
});

describe('scoreLeaningMovement — LIFE-INTENT-2, the measured half of INTENT', () => {
  const claims = (moved: number, total: number) =>
    [...Array<number>(total)].map((_, i) => ({ moved: i < moved, stall: i < moved ? 0 : i }));

  it('UNMEASURED when the run recorded no claims at all', () => {
    const s = scoreLeaningMovement([]);
    expect(s.score).toBe(-1);
    expect(s.note).toMatch(/UNMEASURED/);
  });

  it('a scene nothing ever moved scores 0 and says so plainly', () => {
    const s = scoreLeaningMovement(claims(0, 12));
    expect(s.score).toBe(0);
    expect(s.note).toMatch(/on rails/i);
  });

  it('a third of turns moving the scene is the target band', () => {
    expect(scoreLeaningMovement(claims(4, 12)).score).toBe(4);
    expect(scoreLeaningMovement(claims(3, 12)).score).toBe(3);
    expect(scoreLeaningMovement(claims(2, 12)).score).toBe(2);
    expect(scoreLeaningMovement(claims(1, 12)).score).toBe(1);
  });

  it('reports the longest stall, which is where an on-rails stretch hides', () => {
    // A run can average acceptably and still contain a dead stretch; the mean
    // alone would hide it, so the evidence line carries the worst run of luck.
    const s = scoreLeaningMovement([
      { moved: true, stall: 0 }, { moved: false, stall: 1 },
      { moved: false, stall: 2 }, { moved: false, stall: 3 },
    ]);
    expect(s.evidence).toContain('longest stall 3');
  });
});

/**
 * BENCH-1 — the median is the ruler every story-shaped change is blocked on.
 *
 * Tested here, offline and free, because the expensive half (actually running N
 * judge passes against Gemini) cannot be a unit test and the arithmetic can.
 * The bugs worth catching are all in the arithmetic: outlier handling, the
 * UNMEASURED sentinel, and the even-count tie.
 */
describe('BENCH-1 — medianScores', () => {
  const s = (dimension: string, score: number, note = 'n'): Score =>
    ({ dimension, score, evidence: 'e', note });

  it('takes the middle score, not the mean — an outlier pass cannot drag it', () => {
    // The failure mode: one pass lands a wild 0 and a mean would report 1.67.
    const out = medianScores([[s('INTENT', 3)], [s('INTENT', 3)], [s('INTENT', 0)]]);
    expect(out).toHaveLength(1);
    expect(out[0]!.score).toBe(3);
  });

  it('stays ON the 0-4 scale — a mean would invent a band nothing describes', () => {
    const out = medianScores([[s('X', 2)], [s('X', 3)], [s('X', 3)]]);
    expect(out[0]!.score).toBe(3);
    expect(Number.isInteger(out[0]!.score)).toBe(true);
  });

  it('UNMEASURED passes are DROPPED, not counted as bad', () => {
    // The trap this file has now hit three times. Sorting -1 in would drag the
    // median down on exactly the dimensions least able to defend themselves.
    const out = medianScores([[s('ARC', -1)], [s('ARC', 3)], [s('ARC', 3)]]);
    expect(out[0]!.score).toBe(3);
  });

  it('a dimension NO pass could measure stays unmeasured', () => {
    const out = medianScores([[s('ARC', -1)], [s('ARC', -1)]]);
    expect(out[0]!.score).toBe(-1);
  });

  it('an even count takes the lower middle — a tie reads conservatively', () => {
    expect(medianScores([[s('X', 2)], [s('X', 3)]])[0]!.score).toBe(2);
  });

  it('reports the passes and the SPREAD, so the ruler’s precision is visible', () => {
    // The number alone invites the mistake BENCH-1 exists to stop: reading a
    // 0.5 delta as an effect when the instrument moves 2 on a fixed transcript.
    const out = medianScores([[s('X', 1)], [s('X', 2)], [s('X', 3)]]);
    expect(out[0]!.note).toContain('median of 3');
    expect(out[0]!.note).toContain('spread 2');
  });

  it('a single pass is unchanged and unannotated — no false precision', () => {
    const out = medianScores([[s('X', 2, 'plain')]]);
    expect(out[0]!.score).toBe(2);
    expect(out[0]!.note).toBe('plain');
  });

  it('handles every dimension independently across passes', () => {
    const out = medianScores([
      [s('A', 1), s('B', 4)],
      [s('A', 3), s('B', 4)],
      [s('A', 3), s('B', 2)],
    ]);
    expect(new Map(out.map((x) => [x.dimension, x.score]))).toEqual(
      new Map([['A', 3], ['B', 4]]),
    );
  });
});
