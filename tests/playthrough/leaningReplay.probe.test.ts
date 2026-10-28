/**
 * LIFE-INTENT-3 — replay a stored run's leanings through the CURRENT state
 * machine, so a rule change can be sized before a run is spent on it.
 *
 * A four-world benchmark costs real money and ~20 minutes. The leanings the
 * model already produced are on disk; whether a new rule would have rejected
 * them is a pure function. This answers "how much of the reported movement was
 * real" against evidence that already exists.
 *
 * Point it at run JSONs with `PLAY_RUNS=<stamp>` (the timestamp prefix).
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { isRestatedQuestion, nextLeaningState } from '@/lib/life/sceneLeaning';

const STAMP = process.env.PLAY_RUNS ?? '';
const DIR = '.playthroughs';

type Claim = { moved: boolean; stall: number; leaning: string };

describe('LIFE-INTENT-3 — what the new rule does to a run already played', () => {
  // `skipIf` + `ctx.skip()`, not bare `return`s. A returning test body reports
  // as PASSED with zero assertions on every ordinary run — a green tick that
  // proves nothing, which is the false-signal class this repo removed a
  // MSG-KEY test for rather than keep as coverage it never had.
  it.skipIf(!STAMP)('re-folds every stored leaning claim and reports the delta', (ctx) => {
    const files = fs.readdirSync(DIR)
      .filter((f) => f.startsWith(STAMP) && f.endsWith('.json') && !f.includes('calls'));
    if (files.length === 0) ctx.skip();

    const lines: string[] = [];
    let allBefore = 0;
    let allAfter = 0;
    let allTotal = 0;

    for (const f of files) {
      const run = JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')) as {
        run?: { leaningClaims?: Claim[] };
      };
      const claims = run.run?.leaningClaims ?? [];
      if (claims.length === 0) continue;

      // BEFORE: what the run actually recorded.
      const before = claims.filter((c) => c.moved).length;

      // AFTER: re-fold the same claimed text through the current rule. The
      // stored claim carries the leaning that WON, so a rejected turn shows up
      // as a repeat of the previous one — which the state machine already
      // refuses. Rejection here is therefore a lower bound, not an estimate.
      let state = { leaning: '', stall: 0 };
      let after = 0;
      let rejected = 0;
      for (const c of claims) {
        const claimed = c.leaning ?? '';
        if (c.moved && isRestatedQuestion(claimed)) rejected += 1;
        state = nextLeaningState(state, { leaning: claimed, leaningMoved: c.moved });
        if (state.stall === 0) after += 1;
      }
      allBefore += before;
      allAfter += after;
      allTotal += claims.length;
      lines.push(
        `${f.replace(STAMP + '-', '').replace('.json', '').padEnd(8)} ` +
        `${claims.length} turns · reported ${before} moves ` +
        `(${Math.round((before / claims.length) * 100)}%) · ` +
        `after LIFE-INTENT-3 ${after} (${Math.round((after / claims.length) * 100)}%) · ` +
        `${rejected} restated questions`,
      );
    }

    if (allTotal === 0) ctx.skip();
    lines.push(
      `TOTAL ${allTotal} turns · ${allBefore} reported → ${allAfter} real ` +
      `(${Math.round((allBefore / allTotal) * 100)}% → ${Math.round((allAfter / allTotal) * 100)}%)`,
    );
    fs.writeFileSync(path.join(DIR, 'leaning-replay.txt'), lines.join('\n'));

    // The rule can only ever reject, never invent, movement.
    expect(allAfter).toBeLessThanOrEqual(allBefore);
  });
});
