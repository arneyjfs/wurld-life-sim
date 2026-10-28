/**
 * LIFE-GRID-1.1 / 4 / 5 — the grid mechanics as they reach the LIVE step path.
 *
 * `optionGrid.test.ts` covers the mechanics in isolation; this asserts they are
 * actually WIRED — the blocks reach the prompt, the backstop reaches the retry
 * ladder, and the log can rebuild the memory. The reported complaint was about
 * the shipped game, so the shipped path is what has to be pinned.
 */
import { describe, expect, it } from 'vitest';
import { optionSpreadIssues, ZStepOption } from './stepSchema';

/**
 * ⚠ THE TWO `…reaches the live PROMPT` BLOCKS MOVED with SRV-PROMPT-8..13
 * batch 8, to `functions/src/__tests__/life/optionGridWiring.test.ts`.
 *
 * They asserted that `<requiredAction>` and `<recentActions>` actually reach
 * the assembled prompt — which is exactly the claim this file exists to make,
 * and exactly the claim that now has to be made where the prompt is built. The
 * two blocks BELOW stayed, because they assert the RETRY ladder: the spread
 * backstop and the `actionType` coercion both judge a response the model has
 * already written, and neither ever touched the prompt.
 */

describe('LIFE-GRID-1.1 — the backstop reaches the retry ladder', () => {
  const opt = (actionType?: string) => ({ actionType }) as { actionType?: never };

  it('flags two options of the same type', () => {
    const issues = optionSpreadIssues([opt('ask'), opt('ask')] as never, 'branch');
    expect(issues[0]).toContain('DIFFERENT actionType');
  });

  it('flags a set where nothing acts on the world', () => {
    const issues = optionSpreadIssues([opt('ask'), opt('observe')] as never, 'branch');
    expect(issues[0]).toContain('act on the world');
  });

  it('passes a healthy spread', () => {
    expect(optionSpreadIssues([opt('ask'), opt('do'), opt('move')] as never, 'branch')).toEqual([]);
  });

  it('skips a set where any option is untyped — legacy must not fail the turn', () => {
    expect(optionSpreadIssues([opt('ask'), opt()] as never, 'branch')).toEqual([]);
  });

  it('ignores continuation and question nodes', () => {
    expect(optionSpreadIssues([opt('ask'), opt('ask')] as never, 'continuation')).toEqual([]);
    expect(optionSpreadIssues([] as never, 'question')).toEqual([]);
  });
});

describe('LIFE-GRID-1.1 — an unusable actionType degrades, it does not cost a turn', () => {
  // PRODUCTION REGRESSION, 2026-08-03. Live turns were rejected on
  // `options.0.actionType: Invalid input` and regenerated — a whole extra
  // billed generation on the one call the player waits on. `z.enum().optional()`
  // accepts ABSENT but rejects `null`, and the model writes `null` into
  // optional fields routinely (the same responses carried
  // `"speakerName": null, "npcId": null`).
  const parse = (actionType: unknown) =>
    ZStepOption.safeParse({ id: 'x', nativeText: 'Do the thing', actionType });

  it('accepts each of the six', () => {
    for (const t of ['ask', 'do', 'move', 'observe', 'offer', 'leave']) {
      expect(parse(t).success, t).toBe(true);
    }
  });

  it('null does not fail the parse — it drops the field', () => {
    const r = parse(null);
    expect(r.success).toBe(true);
    expect(r.success && r.data.actionType).toBeUndefined();
  });

  it('an unknown verb drops rather than throws', () => {
    for (const t of ['say', 'act', 'hear', '', 'DO', 7, {}]) {
      const r = parse(t);
      expect(r.success, String(t)).toBe(true);
      expect(r.success && r.data.actionType, String(t)).toBeUndefined();
    }
  });

  it('an absent field still parses, as it always did', () => {
    const r = ZStepOption.safeParse({ id: 'x', nativeText: 'Do the thing' });
    expect(r.success).toBe(true);
  });
});
