import { describe, expect, it } from 'vitest';
import {
  RULES,
  type Turn,
  beats,
  compareArms,
  containsWord,
  lastAttempts,
  options,
  pickSpeechAct,
  wilson,
} from './ruleConformance';

/**
 * LIFE-CONFORM-1 — tests for the checker, not for the model.
 *
 * Every case here is one of the shape traps that made an EARLIER version of
 * this file report a confident wrong number. They are regression tests in the
 * literal sense: each one failed at some point today, on real archive data, and
 * each failure looked like a finding about the prompt.
 */

const turn = (res: unknown, prompt = ''): Turn => ({ seq: 1, attempt: 0, prompt, res: res as never });

describe('LIFE-CONFORM-1 — option gathering', () => {
  it('finds options in ALL THREE places they are written', () => {
    // Trap 1. Reading only `response.options` drops every question node's
    // resolution grid — ~40% of all options, and 100% of the graded ones.
    const t = turn({
      options: [{ id: 'a' }],
      node: { options: [{ id: 'b' }], resolution: { options: [{ id: 'c' }] } },
    });
    expect(options(t).map((o) => o.id)).toEqual(['a', 'b', 'c']);
  });

  it('excludes the synthetic Continue chip from every option rule', () => {
    // Trap 3. A continuation's one `continue` chip carries no speechAct and
    // often no actionType, so leaving it in drags every option rate down —
    // unequally between arms, because the arms emit continuations at very
    // different rates (99% vs 67% of turns offered a real choice).
    const t = turn({ options: [{ id: 'continue', actionType: 'move' }, { id: 'x', actionType: 'do' }] });
    expect(RULES['LIFE-GRID option carries actionType']!([t])).toEqual({ hit: 1, total: 1 });
  });

  it('reads beats from the node AND the resolution', () => {
    const t = turn({
      node: { beats: [{ practiceText: 'a', nativeText: 'A' }], resolution: { beats: [{ practiceText: 'b', nativeText: 'B' }] } },
    });
    expect(beats(t)).toHaveLength(2);
  });
});

describe('LIFE-CONFORM-1 — the pick that led to this turn', () => {
  it('reads speechAct off the turn tag', () => {
    expect(pickSpeechAct(turn({}, '<turn kind="choice" speechAct="say"><choice id="x">Hi</choice></turn>'))).toBe('say');
  });

  it('treats a MISSING speechAct as "act", because that is what the SI says', () => {
    // Trap 2. `stepSpeech.ts`: *"act — this is the DEFAULT; omit speechAct for
    // it."* An earlier audit scored "options carry speechAct" at 73% vs 66% and
    // read a regression into it — it was scoring compliance with the opposite
    // of the rule.
    expect(pickSpeechAct(turn({}, '<turn kind="choice"><choice id="x">Go</choice></turn>'))).toBe('act');
  });

  it('is null when no choice led here — an opening, or a Continue', () => {
    expect(pickSpeechAct(turn({}, '<turn kind="continue"></turn>'))).toBeNull();
  });

  it('matches a turn tag that CARRIES attributes', () => {
    // The `>`-terminated regex excluded precisely the turns with the attribute
    // — i.e. the whole population the cross-turn rules are about — and reported
    // zero of them. Same bug class as the ASCII `\b` below.
    const t = turn({ node: { kind: 'question', beats: [] } }, '<turn kind="choice" speechAct="act"><choice id="x">Look</choice></turn>');
    expect(RULES['LIFE-CONTRACT-EX-6 question after an act pick has a lead-in beat']!([t])).toEqual({
      hit: 0,
      total: 1,
    });
  });
});

describe('LIFE-CONFORM-1 — a retry is not a turn', () => {
  const call = (seq: number, attempt: number) =>
    ({ seq, attempt, category: 'life_step', prompt: '', response: '{}' });

  it('keeps only the attempt the player actually saw', () => {
    // Retries get their OWN seq in the archive, so the obvious dedupe (by seq)
    // is a silent no-op: every REJECTED attempt counts as a turn. That read as
    // a 62% lead-in omission rate against a validator that rejects exactly
    // that, on a prompt where the true rate is 39%.
    const kept = lastAttempts([call(6, 0), call(7, 0), call(8, 0), call(9, 1), call(11, 0)]);
    expect(kept.map((c) => c.seq)).toEqual([6, 7, 9, 11]);
  });

  it('handles a ladder deeper than one retry', () => {
    expect(lastAttempts([call(1, 0), call(2, 1), call(3, 2), call(4, 0)]).map((c) => c.seq)).toEqual([3, 4]);
  });

  it('is the identity on an archive that never retried', () => {
    const straight = [call(1, 0), call(2, 0), call(3, 0)];
    expect(lastAttempts(straight)).toHaveLength(3);
  });
});

describe('LIFE-CONFORM-1 — accent-safe word matching', () => {
  it('matches an accented target that ASCII \\b silently misses', () => {
    // `/\bétouffante\b/` does not match "l'air étouffante": `é` is not an ASCII
    // word char, so the leading boundary never holds. Every accented French
    // target would have read as "no leak" — a check that cannot fire reports
    // 100% and looks like a passing rule.
    expect(containsWord("l'air étouffante ce soir", 'étouffante')).toBe(true);
    expect(/\bétouffante\b/.test("l'air étouffante ce soir")).toBe(false);
  });

  it('still requires a WHOLE word', () => {
    expect(containsWord('la clémence du juge', 'clé')).toBe(false);
    expect(containsWord('donne-moi la clé.', 'clé')).toBe(true);
  });
});

describe('LIFE-CONFORM-1 — rules read what they claim to read', () => {
  it('LIFE-SPEECH-3 counts gradeTarget over SAY options only', () => {
    const t = turn({
      options: [
        { id: 'a', speechAct: 'say', saysLine: { practiceText: 'Bonjour Marc' }, gradeTarget: 'Bonjour' },
        { id: 'b', speechAct: 'say', saysLine: { practiceText: 'Salut' } },
        { id: 'c', actionType: 'do' },
      ],
    });
    expect(RULES['LIFE-SPEECH-3 say option carries gradeTarget']!([t])).toEqual({ hit: 1, total: 2 });
  });

  it('LIFE-SPEECH-3 catches a gradeTarget that is not in its own line', () => {
    // Not verbatim = SILENTLY DROPPED downstream. No validator, no parse error,
    // no retry — the exercise just does not happen.
    const t = turn({
      options: [{ id: 'a', speechAct: 'say', saysLine: { practiceText: 'Salut Marc' }, gradeTarget: 'bonjour' }],
    });
    expect(RULES['LIFE-SPEECH-3 gradeTarget appears verbatim in its own saysLine']!([t])).toEqual({
      hit: 0,
      total: 1,
    });
  });

  it('LIFE-NODE-7 counts a continuation as a turn WITHOUT a choice', () => {
    const t = [turn({ node: { kind: 'continuation' } }), turn({ node: { kind: 'branch' } })];
    expect(RULES['LIFE-NODE-7 turn offers a choice (not a continuation)']!(t)).toEqual({ hit: 1, total: 2 });
  });

  it('LIFE-CONTRACT-EX-6 exempts a question after a SAY pick', () => {
    // `beats: []` after a speech pick is what the SI instructs. Arming on it is
    // the LIFE-CONTRACT-EX-10 defect — 9 of 20 rejections were the model being
    // right — so the checker must not repeat the validator's mistake.
    const t = turn({ node: { kind: 'question', beats: [] } }, '<turn kind="choice" speechAct="say"><choice id="x">Ask</choice></turn>');
    expect(RULES['LIFE-CONTRACT-EX-6 question after an act pick has a lead-in beat']!([t])).toEqual({
      hit: 0,
      total: 0,
    });
  });

  it('LIFE-CONTRACT-EX-6 catches the tested line sitting above its own question', () => {
    const shown = turn({
      node: {
        kind: 'question',
        beats: [{ practiceText: 'Les conduits sont fragiles.' }],
        gradedPlan: { kind: 'comprehension', npcUtterance: 'Les conduits sont fragiles.' },
      },
    });
    const clean = turn({
      node: {
        kind: 'question',
        beats: [{ practiceText: 'Tu montes les marches.' }],
        gradedPlan: { kind: 'comprehension', npcUtterance: 'Les conduits sont fragiles.' },
      },
    });
    const rule = RULES['LIFE-CONTRACT-EX-6 comprehension does not show the tested line first']!;
    expect(rule([shown, clean])).toEqual({ hit: 1, total: 2 });
  });

  it('an unparseable response is a row, not a skip', () => {
    const rule = RULES['response parsed']!;
    expect(rule([turn(null), turn({ node: {} })])).toEqual({ hit: 1, total: 2 });
  });
});

describe('LIFE-CONFORM-1 — comparison', () => {
  it('an OVERLAP is not a regression', () => {
    // The distinction LIFE-PRECEDENCE-1 was reverted over. 22% vs 34% at n=96
    // looks like a big move and is not resolvable at that sample size.
    const a = Array.from({ length: 96 }, (_, i) => turn({ npcMemoryUpdates: i < 21 ? [{}] : [] }));
    const b = Array.from({ length: 96 }, (_, i) => turn({ npcMemoryUpdates: i < 33 ? [{}] : [] }));
    const row = compareArms(a, b).find((r) => r.rule.startsWith('LIFE-NPC-MEM-1'))!;
    expect(row.worse).toBe(false);
    expect(row.better).toBe(false);
  });

  it('flags a DISJOINT drop, in the right direction', () => {
    const say = (graded: boolean) => ({
      options: [{ id: 'a', speechAct: 'say', saysLine: { practiceText: 'x' }, ...(graded ? { gradeTarget: 'x' } : {}) }],
    });
    const a = Array.from({ length: 92 }, (_, i) => turn(say(i < 11)));
    const b = Array.from({ length: 57 }, () => turn(say(false)));
    const row = compareArms(a, b).find((r) => r.rule.startsWith('LIFE-SPEECH-3 say'))!;
    expect(row.worse).toBe(true);
    expect(row.better).toBe(false);
    expect(compareArms(b, a).find((r) => r.rule.startsWith('LIFE-SPEECH-3 say'))!.better).toBe(true);
  });

  it('never claims a difference against an EMPTY arm', () => {
    const row = compareArms([turn({ logLine: 'x' })], []).find((r) => r.rule.startsWith('LIFE-STORY-LOG-1'))!;
    expect(row.worse).toBe(false);
    expect(row.better).toBe(false);
  });
});

describe('LIFE-CONFORM-1 — Wilson', () => {
  it('never leaves [0,1], which is why it is not the normal approximation', () => {
    for (const [hit, total] of [[0, 5], [5, 5], [1, 100], [0, 1]] as const) {
      const [lo, hi] = wilson(hit, total);
      expect(lo).toBeGreaterThanOrEqual(0);
      expect(hi).toBeLessThanOrEqual(1);
      expect(lo).toBeLessThanOrEqual(hi);
    }
  });

  it('returns a degenerate interval for no observations rather than NaN', () => {
    expect(wilson(0, 0)).toEqual([0, 0]);
  });

  it('narrows as n grows', () => {
    const [lo1, hi1] = wilson(3, 10);
    const [lo2, hi2] = wilson(30, 100);
    expect(hi2 - lo2).toBeLessThan(hi1 - lo1);
  });
});
