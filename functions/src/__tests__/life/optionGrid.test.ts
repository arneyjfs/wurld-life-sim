/**
 * LIFE-GRID-* — the option grid's PREVENT half, which is prompt text.
 *
 * ⚠ MOVED from `src/lib/life/optionGrid.test.ts` by SRV-PROMPT-8..13 batch 8.
 * The rotation, the two `<requiredAction>` blocks, `<recentActions>` and the
 * `<dangledGoal>` line are all things the model READS, so they crossed with the
 * step prompt. The REJECT half — `gradeOptionSet` and the two key functions —
 * stayed client-side, because it judges the answer.
 *
 * The assertions are unchanged.
 */
import { describe, expect, it } from 'vitest';
import {
  RECENT_ACTIONS_WINDOW,
  pushRecentActions,
  renderRecentActions,
  renderRequiredType,
  requiredTypeForTurn,
  type ActionShape,
} from '../../prompts/lifeStepBlocks';

const a = (type: ActionShape['type'], targetId: string | null = null): ActionShape => ({
  type,
  targetId,
});

describe('LIFE-GRID-5 — prevent the repeat rather than reject it', () => {
  it('rotates the required type so adjacent turns cannot demand the same thing', () => {
    const seq = [0, 1, 2, 3, 4].map(requiredTypeForTurn);
    expect(new Set(seq.slice(0, 4)).size).toBe(4);
    expect(seq[4]).toBe(seq[0]); // wraps
  });

  it('never requires ASK — that is the default the rule exists to counteract', () => {
    const seen = new Set(Array.from({ length: 20 }, (_, i) => requiredTypeForTurn(i)));
    expect(seen.has('ask')).toBe(false);
  });

  it('is deterministic, so a replay of the same world offers the same demands', () => {
    expect(requiredTypeForTurn(7)).toBe(requiredTypeForTurn(7));
  });

  it('renders a demand the model can act on, not an abstraction', () => {
    expect(renderRequiredType('move')).toContain('MOVE');
    expect(renderRequiredType('move')).toContain('go somewhere');
  });
});

describe('LIFE-GRID-2 — the cross-turn memory the grid never had', () => {
  it('renders the shapes already offered, plus the rule that bans them', () => {
    const out = renderRecentActions([a('ask', 'marie'), a('do', 'ledger')]);
    expect(out).toContain('ask:marie');
    expect(out).toContain('do:ledger');
    expect(out).toContain('Do NOT offer them again');
  });

  it('names the loophole explicitly — a new verb on the same target is a repeat', () => {
    expect(renderRecentActions([a('ask', 'marie')])).toContain(
      'A different verb on the same target is still a repeat',
    );
  });

  it('renders nothing at all on the first turn', () => {
    expect(renderRecentActions([])).toBe('');
  });

  it('keeps the window bounded — this rides BELOW the cache boundary', () => {
    let recent: ActionShape[] = [];
    for (let i = 0; i < 12; i += 1) {
      recent = pushRecentActions(recent, [a('ask', `t${i}`), a('do', `t${i}`)]);
    }
    expect(recent).toHaveLength(RECENT_ACTIONS_WINDOW);
    // …and it keeps the NEWEST, which is what "the situation has moved on" means.
    expect(recent[recent.length - 1]!.targetId).toBe('t11');
  });
});

/**
 * The backstop's SPREAD rules moved to `optionSpreadIssues` (stepSchema.ts) —
 * which is where they were already duplicated, more strictly, and where they
 * are actually wired. This function now owns only what needs the event log.
 * `optionGridWiring.test.ts` covers the spread half against the live path.
 */
describe('LIFE-INTENT-1 — the moment outranks the rotation', () => {
  it('states the precedence in the SAME block as the required type', () => {
    // Measured 2026-08-04: the player grabbed someone by the collar and the
    // grid came back "Tighten the main pipe with the wrench | Ask him about the
    // lower pasture | Walk away from the pump" — a rotation-satisfying `do`
    // grown from the SCENE while the moment had changed underneath it.
    //
    // The relevance rule already existed and said the right thing. It sits in
    // the cached prefix ~500 lines above; this block rides in the volatile tail
    // beside the turn. Two rules at different distances from the decision, and
    // the nearer one won — so the precedence is written where the conflict is
    // actually resolved, not only where the rule is introduced.
    const out = renderRequiredType('do');
    expect(out).toMatch(/requiredAction type="relevance"/);
    expect(out).toMatch(/MOMENT OUTRANKS THE ROTATION/);
    // And it must say which side yields, or it is not a precedence rule.
    expect(out).toMatch(/DROP IT/);
  });

  it('carries the precedence on every rotation slot, not just some', () => {
    for (const t of ['do', 'move', 'observe', 'offer'] as const) {
      expect(renderRequiredType(t)).toMatch(/MOMENT OUTRANKS THE ROTATION/);
    }
  });
});

/**
 * LIFE-GRID-6 — the dangled goal.
 *
 * MEASURED before the threshold was chosen, against this module's own ceiling
 * ("above ~15% the rule is wrong, not the model"), over 2,016 archived grids:
 *   reject ANY re-offer of a taken shape   16.5%  — over the line
 *   reject at TWO takes                     2.2%  — chosen
 */
describe('LIFE-GRID-6 — renderRecentActions surfaces the repeat', () => {
  it('shows a count only for shapes seen more than once', () => {
    const out = renderRecentActions([a('do', 'letter'), a('do', 'letter'), a('ask', 'remy')]);
    expect(out).toContain('do:letter ×2');
    expect(out).toContain('ask:remy');
    expect(out).not.toContain('ask:remy ×');
  });

  it('adds the dangledGoal block ONLY when something actually repeats', () => {
    expect(renderRecentActions([a('do', 'letter'), a('ask', 'remy')])).not.toContain('dangledGoal');
    expect(renderRecentActions([a('do', 'letter'), a('do', 'letter')])).toContain('<dangledGoal');
  });

  it('the block forces a CHOICE rather than repeating the prohibition', () => {
    const out = renderRecentActions([a('do', 'letter'), a('do', 'letter')]);
    expect(out).toMatch(/LET IT HAPPEN/);
    expect(out).toMatch(/CLOSE IT/);
    expect(out).toMatch(/not a story beat, it is a wall/);
  });
});

/**
 * LIFE-GRID-6 — A GOAL IS A THING, NOT A VERB.
 *
 * The rule was chosen from a measurement and then implemented against a
 * DIFFERENT key from the one measured. The measurement keyed a targetless
 * option by its LABEL (near-unique, so targetless picks never collided); the
 * implementation used `shapeKey`, which collapses a targetless option to its
 * bare verb. Two targetless `ask` picks — nothing at all in a conversation
 * game — and every later grid containing any targetless `ask` was rejected.
 *
 * Caught by a real playthrough, then measured over all 2,026 archived grids:
 *   bare-verb key (shipped, wrong)  75.7%   five times the ~15% ceiling
 *   targeted-only, taken >= 2        7.1%   chosen
 *   targeted-only, taken >= 3        2.5%
 *   targeted-only, taken >= 1       19.5%   over the ceiling
 */
describe('LIFE-GRID-6 — the dangle key ignores options with no target', () => {
  it('<dangledGoal> names only TARGETED shapes, so the block and the check agree', () => {
    // A block saying shapes="ask" asks the model to "let it happen or close it
    // off" for the act of asking, which it cannot act on.
    const out = renderRecentActions([
      a('ask', null), a('ask', null), a('observe', null), a('observe', null),
    ]);
    expect(out).not.toContain('<dangledGoal');

    const withGoal = renderRecentActions([
      a('ask', null), a('ask', null), a('do', 'letter'), a('do', 'letter'),
    ]);
    expect(withGoal).toContain('<dangledGoal');
    expect(withGoal).toContain('do:letter');
    expect(withGoal).not.toMatch(/shapes="[^"]*\bask\b[^"]*"/);
  });

  it('<recentActions> still LISTS targetless shapes — display is not the dangle key', () => {
    const out = renderRecentActions([a('ask', null), a('do', 'letter')]);
    expect(out).toContain('<recentActions>ask · do:letter</recentActions>');
  });
});
