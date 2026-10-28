/**
 * LIFE-ARCH / LIFE-UNIVERSE-1 — the world-state blocks, now the ONLY copy.
 *
 * ⚠ THESE FIXTURES ARE INHERITED, and that is why the file exists. They were
 * the behavioural parity sweep in `tests/playthrough/serverPromptParity.test.ts`
 * that compared `src/lib/life/prompts/{worldState,universe}.ts` against this
 * module while both existed. SRV-PROMPT-8..13 batch 8 deleted the client copies
 * with `life_step`, so the comparison expired — but the fixtures did not, and
 * dropping them with the guard would have been the thing batch 5's note warns
 * about: *a guard retired on schedule can still take something with it that was
 * never its stated job.*
 *
 * What they were chosen for survives: every branch of both renderers, XML-
 * breaking characters in every interpolated position, principals declared after
 * regulars (ordering is load-bearing), more regulars than the render ceiling,
 * and — added after a mutation SURVIVED — a front whose `resolved` is ABSENT,
 * which is the only input that tells `== null` from `=== null`.
 *
 * The byte-level comparison they used to make is now
 * `stepGoldenParity.test.ts`, against a capture of the client's own output.
 * What these assert instead is the property each fixture was reaching for.
 */
import { describe, expect, it } from "vitest";
import {
  REGULARS_RENDER_CEILING,
  renderUniverse,
  renderWorldStory,
  type WorldStoryCastMember,
  type WorldStoryFront,
  type WorldStoryUniverse,
} from "../prompts/lifeWorldState";

const universeFixtures: Array<[string, WorldStoryUniverse | null | undefined]> = [
  ['null', null],
  ['undefined', undefined],
  ['empty', { setting: '', era: '', laws: [], places: [], figures: [] }],
  [
    'setting only',
    { setting: 'A canal town', era: '', laws: [], places: [], figures: [] },
  ],
  [
    'era only',
    { setting: '', era: 'the present day', laws: [], places: [], figures: [] },
  ],
  [
    'laws only',
    { setting: '', era: '', laws: ['No barge moves without a slip.'], places: [], figures: [] },
  ],
  [
    'places only',
    { setting: '', era: '', laws: [], places: ['The wash-house'], figures: [] },
  ],
  [
    'figures only',
    {
      setting: '',
      era: '',
      laws: [],
      places: [],
      figures: [{ name: 'Bebert', what: 'Keeps the roster book.' }],
    },
  ],
  [
    'full, with XML-breaking characters',
    {
      setting: 'A town of <locks> & gates',
      era: '"now"',
      laws: ['a < b & c', 'second law'],
      places: ['The <wash-house>', 'The bridge'],
      figures: [
        { name: 'Bébert "the clerk"', what: 'Keeps the <book> & the keys' },
        { name: 'Sophie', what: 'Sells bread' },
      ],
    },
  ],
];

describe('LIFE-UNIVERSE-1 — every branch of renderUniverse still renders', () => {
  for (const [label, u] of universeFixtures) {
    it(`LIFE-UNIVERSE-1 — ${label}`, () => {
      const out = renderUniverse(u);
      // Only the empty arms render nothing; everything else opens the block.
      const empty = !u || (!u.setting && !u.era && !u.laws.length && !u.places.length && !u.figures.length);
      expect(out === '').toBe(empty);
      if (!empty) {
        expect(out.startsWith('<universe>')).toBe(true);
        expect(out.endsWith('</universe>')).toBe(true);
        // Nothing a caller supplies reaches the block as markup.
        expect(out.replace(/<\/?(universe|setting|era|laws|law|places|place|figures|figure)\b[^>]*>/g, ''))
          .not.toMatch(/[<>]/);
      }
    });
  }
});

const member = (over: Partial<WorldStoryCastMember> & Pick<WorldStoryCastMember, 'id' | 'name' | 'tier'>): WorldStoryCastMember =>
  ({
    voice: 'clipped',
    standing: 0,
    known: 'Runs the lock.',
    ties: [],
    ...over,
  }) as unknown as WorldStoryCastMember;

const front = (op: Partial<WorldStoryFront> & { id: string; agenda: string }): WorldStoryFront =>
  ({
    name: 'Front',
    driverId: 'p1',
    kind: 'obligation',
    scope: 'saga',
    clock: { filled: 3, size: 8, consequence: 'the lease changes hands', peak: 3, unattended: 0 },
    resolved: null,
    ...op,
  }) as unknown as WorldStoryFront;

const storyFixtures: Array<
  [string, { situation?: string; fronts?: readonly WorldStoryFront[]; cast?: readonly WorldStoryCastMember[] }]
> = [
  ['empty', {}],
  ['situation only', { situation: 'You have a room over the bakery.' }],
  ['whitespace-only situation', { situation: '   ' }],
  ['one live front', { fronts: [front({ id: 'f1', agenda: 'Buying the lease.' })] }],
  [
    // ⚠ ADDED AFTER A MUTATION SURVIVED. Every other fixture sets `resolved`
    // explicitly, so flipping the live filter from `== null` to `=== null` on
    // one side changed nothing and the guard reported agreement — the silent
    // failure mode this whole file is written to avoid, found in the guard
    // itself rather than in the code it watches. A front with `resolved` ABSENT
    // is LIVE under `==` and DROPPED under `===`, so it is the only input that
    // tells the two operators apart.
    'front with resolved ABSENT (distinguishes == null from === null)',
    { fronts: [{ driverId: 'p1', agenda: 'Absent resolved.' } as unknown as WorldStoryFront] },
  ],
  [
    'front with resolved explicitly undefined',
    {
      fronts: [
        { driverId: 'p1', agenda: 'Undefined resolved.', resolved: undefined } as unknown as WorldStoryFront,
      ],
    },
  ],
  [
    'all fronts resolved',
    { fronts: [front({ id: 'f1', agenda: 'Done.', resolved: 'filled' })] },
  ],
  [
    'mixed live and resolved fronts',
    {
      fronts: [
        front({ id: 'f1', agenda: 'Live one.' }),
        front({ id: 'f2', agenda: 'Cleared one.', resolved: 'cleared' }),
        front({ id: 'f3', agenda: 'Another live one.', driverId: 'circumstance' }),
      ],
    },
  ],
  [
    'principal with every optional field',
    {
      cast: [
        member({
          id: 'p1',
          name: 'Bebert',
          tier: 'principal',
          wants: 'The roster changed.',
          nextMove: 'Corner the clerk.',
          limit: 'Nothing in writing.',
          ties: [{ id: 'r1', how: 'owes them coal' }],
        } as Partial<WorldStoryCastMember> & Pick<WorldStoryCastMember, 'id' | 'name' | 'tier'>),
      ],
    },
  ],
  [
    'principal with NO optional fields (the undefined branch)',
    { cast: [member({ id: 'p1', name: 'Bebert', tier: 'principal' })] },
  ],
  [
    'regular with and without a routine',
    {
      cast: [
        member({ id: 'r1', name: 'Sophie', tier: 'regular', routine: 'Opens at five.' } as Partial<WorldStoryCastMember> &
          Pick<WorldStoryCastMember, 'id' | 'name' | 'tier'>),
        member({ id: 'r2', name: 'Marc', tier: 'regular' }),
      ],
    },
  ],
  [
    'more regulars than the render ceiling',
    {
      cast: [
        ...Array.from({ length: 2 }, (_, i) =>
          member({ id: `p${i}`, name: `Principal ${i}`, tier: 'principal' }),
        ),
        ...Array.from({ length: 14 }, (_, i) =>
          member({ id: `r${i}`, name: `Regular ${i}`, tier: 'regular' }),
        ),
      ],
    },
  ],
  [
    'principals declared AFTER regulars (ordering is load-bearing)',
    {
      cast: [
        member({ id: 'r1', name: 'Sophie', tier: 'regular' }),
        member({ id: 'p1', name: 'Bebert', tier: 'principal' }),
      ],
    },
  ],
  [
    'multiple ties, and XML-breaking characters everywhere',
    {
      situation: 'a < b & c',
      fronts: [front({ id: 'f1', agenda: 'A & B <together>', driverId: 'p"1' })],
      cast: [
        member({
          id: 'p1',
          name: 'Bébert "the clerk"',
          tier: 'principal',
          voice: 'dry & <quiet>',
          known: 'Runs the <lock> & the gate',
          wants: 'A & B',
          nextMove: '<move>',
          limit: 'not "that"',
          ties: [
            { id: 'r1', how: 'owes them & more' },
            { id: 'r2', how: '<cousin>' },
          ],
        } as Partial<WorldStoryCastMember> & Pick<WorldStoryCastMember, 'id' | 'name' | 'tier'>),
      ],
    },
  ],
];

describe('LIFE-ARCH — every branch of renderWorldStory still renders', () => {
  for (const [label, input] of storyFixtures) {
    it(`LIFE-ARCH — ${label}`, () => {
      const out = renderWorldStory(input);
      // The LIVE filter is the branch a mutation can flip invisibly: a front
      // with `resolved` ABSENT is live under `== null` and dropped under
      // `===`, and it is the only input that tells them apart.
      const live = (input.fronts ?? []).filter((f) => f.resolved == null);
      expect(out.includes('<inMotion>')).toBe(live.length > 0);
      expect((out.match(/<force /g) ?? []).length).toBe(live.length);
      // Nothing a caller supplies reaches a block as markup.
      expect(
        out.replace(
          /<\/?(situation|inMotion|inMotionRule|force|cast|castRule|person|known|wants|nextMove|willNot|routine|tie)\b[^>]*>/g,
          '',
        ),
      ).not.toMatch(/[<>]/);
    });
  }

  it('LIFE-CAST-3 — both copies cap regulars at the SAME ceiling', () => {
    // The parity tests above would still pass if BOTH sides dropped the slice,
    // so the bound itself is asserted rather than only the agreement.
    const out = renderWorldStory({
      cast: Array.from({ length: 14 }, (_, i) =>
        member({ id: `r${i}`, name: `NAME_regular_${i}`, tier: 'regular' }),
      ),
    });
    // Driven off the constant rather than a re-typed 8, so a retune moves the
    // assertion with it instead of leaving it pinned to a stale number.
    expect(out).toContain(`NAME_regular_${REGULARS_RENDER_CEILING - 1}`);
    expect(out).not.toContain(`NAME_regular_${REGULARS_RENDER_CEILING}`);
  });

  it('LIFE-FRONT-1.1 — neither copy shows the model a clock', () => {
    const out = renderWorldStory({
      fronts: [front({ id: 'f1', agenda: 'Buying the lease.' })],
    });
    expect(out).not.toContain('clock');
    expect(out).not.toContain('consequence');
    expect(out).not.toContain('filled');
  });
});
