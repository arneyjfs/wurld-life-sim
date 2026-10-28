/**
 * Every case here is a defect the FIRST headless playthrough actually produced,
 * not a hypothetical. See the file header of `cast.ts` for the run they came
 * from. Spec: docs/specs/story-architecture.md §3 (LIFE-CAST-*), §2.
 */
import { describe, expect, it } from 'vitest';
import {
  applyCastChanges,
  cleanText,
  clampStanding,
  dropPlayerNameCollisions,
  ingestCast,
  normaliseMember,
  principalsMissingDrive,
  castArchetypes,
  castVoiceMap,
} from './cast';
import type { CastMember } from '@/types/lifeState';

const principal = (over: Partial<CastMember> = {}): CastMember => ({
  id: 'rey',
  name: 'Madame Rey',
  known: 'runs the bakery',
  tier: 'principal',
  voice: 'stern, precise',
  standing: 0,
  ties: [],
  wants: 'to keep the recipe',
  nextMove: 'refuses the chain buyer on Thursday',
  ...over,
});

const regular = (over: Partial<CastMember> = {}): CastMember => ({
  id: 'pierre',
  name: 'Pierre',
  known: 'buys a baguette daily',
  tier: 'regular',
  voice: 'loud, repetitive',
  standing: 0,
  ties: [],
  routine: 'arrives at 7am sharp',
  ...over,
});

describe('cleanText — LIFE-CAST-4: the word "null" is not a value', () => {
  it('LIFE-CAST-4 — nulls the empty-meaning tokens a STRING field carries', () => {
    for (const t of ['null', 'NULL', 'none', 'N/A', '-', '—', 'unchanged', '  ', 'no change']) {
      expect(cleanText(t), t).toBeNull();
    }
  });

  it('LIFE-CAST-4 — keeps real prose, including prose that mentions none', () => {
    expect(cleanText('  Nobody moved. ')).toBe('Nobody moved.');
    expect(cleanText('None of the bakers agreed')).toBe('None of the bakers agreed');
  });

  it('LIFE-CAST-4 — non-strings are null, never coerced', () => {
    expect(cleanText(undefined)).toBeNull();
    expect(cleanText(null)).toBeNull();
    expect(cleanText(7)).toBeNull();
  });
});

describe('clampStanding', () => {
  it('LIFE-CAST-3 — clamps to -3..3 and rounds', () => {
    expect(clampStanding(9)).toBe(3);
    expect(clampStanding(-9)).toBe(-3);
    expect(clampStanding(1.6)).toBe(2);
    expect(clampStanding('x')).toBe(0);
  });
});

describe('normaliseMember — the tier strip', () => {
  it('LIFE-CAST-1 — a regular cannot keep an ambition', () => {
    const m = normaliseMember(
      { id: 'sofia', name: 'Sofia', known: 'runs the cafe', voice: 'quick', routine: 'opens at six', wants: 'to run a cafe open past midnight', nextMove: 'applies for the late licence', wrongAbout: { aboutId: 'miguel', believes: 'he is a retired spy' } },
      'regular',
    )!;
    expect(m.tier).toBe('regular');
    expect(m.routine).toBe('opens at six');
    expect(m.wants).toBeUndefined();
    expect(m.nextMove).toBeUndefined();
    expect(m.wrongAbout).toBeUndefined();
  });

  it('LIFE-CAST-1 — a principal cannot keep a routine', () => {
    const m = normaliseMember({ ...principal(), routine: 'opens at six' }, 'principal')!;
    expect(m.routine).toBeUndefined();
    expect(m.wants).toBe('to keep the recipe');
  });

  it('LIFE-CAST-1 — a row with no id or no name is dropped, not repaired', () => {
    expect(normaliseMember({ name: 'Nobody' }, 'regular')).toBeNull();
    expect(normaliseMember({ id: 'x' }, 'regular')).toBeNull();
  });

  it('LIFE-CAST-1 — half-empty ties are dropped', () => {
    const m = normaliseMember(
      { id: 'a', name: 'A', ties: [{ id: 'b', how: 'sister' }, { id: '', how: 'x' }, { id: 'c', how: '' }] },
      'regular',
    )!;
    expect(m.ties).toEqual([{ id: 'b', how: 'sister' }]);
  });
});

describe('ingestCast', () => {
  it('LIFE-CAST-1 — merges the two arrays and tags each tier', () => {
    const cast = ingestCast({
      principals: [{ id: 'rey', name: 'Rey', wants: 'w', nextMove: 'n' }],
      regulars: [{ id: 'pierre', name: 'Pierre', routine: 'r' }],
    });
    expect(cast.map((c) => [c.id, c.tier])).toEqual([
      ['rey', 'principal'],
      ['pierre', 'regular'],
    ]);
  });

  it('LIFE-CAST-2 — drops a belief about someone who is not in the cast', () => {
    // The first playthrough emitted beliefs about `la-boulangerie` and
    // `scriptorium` — neither a canon id, so the irony could never surface.
    const cast = ingestCast({
      principals: [
        { id: 'rey', name: 'Rey', wants: 'w', nextMove: 'n', wrongAbout: { aboutId: 'la-boulangerie', believes: 'the village depends on her' } },
        { id: 'lucas', name: 'Lucas', wants: 'w', nextMove: 'n', wrongAbout: { aboutId: 'rey', believes: 'she is hiding a fortune' } },
      ],
    });
    expect(cast[0]!.wrongAbout).toBeUndefined();
    expect(cast[1]!.wrongAbout).toEqual({ aboutId: 'rey', believes: 'she is hiding a fortune' });
  });

  it('LIFE-CAST-1 — a surplus principal is demoted AND stripped', () => {
    const cast = ingestCast({
      principals: [1, 2, 3, 4].map((n) => ({ id: `p${n}`, name: `P${n}`, wants: 'w', nextMove: 'n' })),
    });
    expect(cast.filter((c) => c.tier === 'principal')).toHaveLength(3);
    const demoted = cast[3]!;
    expect(demoted.tier).toBe('regular');
    expect(demoted.wants).toBeUndefined();
  });

  it('LIFE-CAST-1 — a duplicated id appears once, principal wins', () => {
    const cast = ingestCast({
      principals: [{ id: 'rey', name: 'Rey', wants: 'w', nextMove: 'n' }],
      regulars: [{ id: 'rey', name: 'Rey again', routine: 'r' }],
    });
    expect(cast).toHaveLength(1);
    expect(cast[0]!.tier).toBe('principal');
  });
});

describe('principalsMissingDrive', () => {
  it('LIFE-CAST-1 — reports a principal with no nextMove', () => {
    const out = principalsMissingDrive([
      principal(),
      principal({ id: 'lucas', name: 'Lucas', nextMove: undefined }),
      regular(),
    ]);
    expect(out).toEqual(['lucas(nextMove)']);
  });
});

describe('applyCastChanges — LIFE-ARCH-2.1', () => {
  it('LIFE-ARCH-2.1 — name and known survive any delta', () => {
    const out = applyCastChanges([principal()], [
      { id: 'rey', name: 'Someone Else', known: 'a stranger', standing: 2 } as never,
    ]);
    expect(out[0]!.name).toBe('Madame Rey');
    expect(out[0]!.known).toBe('runs the bakery');
    // 1, not 2 — LIFE-CAST-3.1 rate-limits the step. The point of this case is
    // the two canon fields; the standing assertion just confirms the delta was
    // otherwise applied.
    expect(out[0]!.standing).toBe(1);
  });

  it('LIFE-CAST-4 — "null" in a delta does not blank the field', () => {
    const out = applyCastChanges([principal()], [{ id: 'rey', wants: 'null', nextMove: '' }]);
    expect(out[0]!.wants).toBe('to keep the recipe');
    expect(out[0]!.nextMove).toBe('refuses the chain buyer on Thursday');
  });

  it('LIFE-CAST-1 — promoting a regular strips the routine and keeps the drive', () => {
    const out = applyCastChanges([regular()], [
      { id: 'pierre', tier: 'principal', wants: 'to be taken seriously', nextMove: 'stands for the council' },
    ]);
    expect(out[0]!.tier).toBe('principal');
    expect(out[0]!.routine).toBeUndefined();
    expect(out[0]!.wants).toBe('to be taken seriously');
  });

  it('LIFE-CAST-1 — demoting a principal strips wants, nextMove and the belief', () => {
    const out = applyCastChanges([principal({ wrongAbout: { aboutId: 'rey', believes: 'x' } })], [
      { id: 'rey', tier: 'regular', routine: 'opens at six' },
    ]);
    expect(out[0]!.tier).toBe('regular');
    expect(out[0]!.wants).toBeUndefined();
    expect(out[0]!.nextMove).toBeUndefined();
    expect(out[0]!.wrongAbout).toBeUndefined();
    expect(out[0]!.routine).toBe('opens at six');
  });

  it('LIFE-CAST-3 — an out-of-range standing is clamped, then rate-limited', () => {
    // Both rules apply, in that order: 11 clamps to 3, and the step from 0
    // toward 3 is capped at one.
    expect(applyCastChanges([principal()], [{ id: 'rey', standing: 11 }])[0]!.standing).toBe(1);
    expect(applyCastChanges([principal({ standing: 2 })], [{ id: 'rey', standing: 11 }])[0]!.standing).toBe(3);
  });

  it('LIFE-ARCH-2.1 — a delta for an unknown id is ignored, not inserted', () => {
    const out = applyCastChanges([principal()], [{ id: 'ghost', standing: 3 }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.id).toBe('rey');
  });

  it('LIFE-CAST-1 — someone left out of the deltas is untouched', () => {
    const before = [principal(), regular()];
    const out = applyCastChanges(before, [{ id: 'rey', standing: 1 }]);
    expect(out[1]).toEqual(before[1]);
  });
});

describe('LIFE-CAST-3.1 — standing is a slow axis', () => {
  it('a jump of three is served one step at a time', () => {
    // The first playthrough ran Claudette 0 → -1 → -2 → -3 in five scenes and
    // then pinned her at the rail for the rest of the world. Nobody's opinion
    // of you moves two points in one conversation.
    let cast = [principal({ standing: 0 })];
    cast = applyCastChanges(cast, [{ id: 'rey', standing: 3 }]);
    expect(cast[0]!.standing).toBe(1);
    cast = applyCastChanges(cast, [{ id: 'rey', standing: 3 }]);
    expect(cast[0]!.standing).toBe(2);
    cast = applyCastChanges(cast, [{ id: 'rey', standing: 3 }]);
    expect(cast[0]!.standing).toBe(3);
  });

  it('it steps down as reluctantly as it steps up', () => {
    const cast = applyCastChanges([principal({ standing: 2 })], [{ id: 'rey', standing: -3 }]);
    expect(cast[0]!.standing).toBe(1);
  });

  it('a step within the limit lands exactly', () => {
    expect(applyCastChanges([principal({ standing: 0 })], [{ id: 'rey', standing: -1 }])[0]!.standing).toBe(-1);
  });

  it('omitting standing leaves it alone', () => {
    expect(applyCastChanges([principal({ standing: 2 })], [{ id: 'rey', wants: 'x' }])[0]!.standing).toBe(2);
  });
});

describe('LIFE-CAST-5 — nobody shares the player’s name', () => {
  it('drops the collision', () => {
    // The first playthrough opened a world for a player called Ines and put a
    // principal called Ines in it: every NPC bubble thereafter was the player
    // watching themselves talk.
    const { cast, dropped } = dropPlayerNameCollisions(
      [principal({ id: 'ines', name: 'Ines' }), regular()],
      'Ines',
    );
    expect(dropped).toEqual(['Ines']);
    expect(cast.map((c) => c.id)).toEqual(['pierre']);
  });

  it('matches case- and whitespace-insensitively', () => {
    const { dropped } = dropPlayerNameCollisions([principal({ name: '  ines ' })], 'Ines');
    expect(dropped).toHaveLength(1);
  });

  it('takes the dangling ties and beliefs with it', () => {
    const { cast } = dropPlayerNameCollisions(
      [
        principal({ id: 'ines', name: 'Ines' }),
        principal({
          id: 'marc',
          name: 'Marc',
          ties: [{ id: 'ines', how: 'her cousin' }],
          wrongAbout: { aboutId: 'ines', believes: 'she can be trusted' },
        }),
      ],
      'Ines',
    );
    expect(cast).toHaveLength(1);
    expect(cast[0]!.ties).toEqual([]);
    expect(cast[0]!.wrongAbout).toBeUndefined();
  });

  it('leaves a cast with no collision untouched', () => {
    const before = [principal(), regular()];
    const { cast, dropped } = dropPlayerNameCollisions(before, 'Alice');
    expect(dropped).toEqual([]);
    expect(cast).toEqual(before);
  });
});

/**
 * LIFE-NPC-6 — the NPC role line survived the death of `keyArchetypes`.
 *
 * The saga's `keyArchetypes` was where "who is this person, authoritatively"
 * came from for avatar + profile generation. It died with the synopsis; the
 * need did not. These pin the replacement.
 */
describe('castArchetypes', () => {
  const member = (name: string, known: string) => ({
    id: name.toLowerCase(), name, known, tier: 'principal' as const,
    voice: '', standing: 0, ties: [],
  });

  it('names the person in the description — that is how resolveNpcRole matches', () => {
    const [row] = castArchetypes([member('Madame Roux', 'a florist')]);
    expect(row?.description).toContain('Madame Roux');
  });

  it('uses a short `known` as the card label', () => {
    expect(castArchetypes([member('Marc', 'the baker')])[0]?.role).toBe('the baker');
  });

  it('emits NO label rather than a truncated one', () => {
    // A mid-sentence fragment on a card reads as a bug; an empty role row
    // reads as an absence. The text still reaches the prompts via description.
    const long = 'a florist who delivers coded scripts and sharp critiques of the performance';
    const [row] = castArchetypes([member('Madame Roux', long)]);
    expect(row?.role).toBe('');
    expect(row?.description).toContain(long);
  });

  it('skips rows with nothing to say', () => {
    expect(castArchetypes([member('Nobody', '')])).toEqual([]);
    expect(castArchetypes(undefined)).toEqual([]);
  });
});

/**
 * TTS-VOICE-2 — the seams where a newly-added cast field disappears.
 *
 * `normaliseMember` rebuilds a member FIELD BY FIELD rather than spreading —
 * deliberately, because a regular must LOSE `wants` — and that is exactly how
 * a new field vanishes. `applyCastChanges` runs on every sceneClose, so a
 * gender not carried through both would survive one scene and then be gone for
 * the rest of the wurld, silently re-casting the character's voice.
 */
describe('TTS-VOICE-2 — gender + register survive the cast pipeline', () => {
  const member = (over: Record<string, unknown> = {}) => ({
    id: 'remy', name: 'Rémy', known: 'the postman', voice: 'clipped',
    gender: 'male' as const, voiceRegister: 'rough' as const, standing: 0,
    routine: 'walks the round', ...over,
  });

  it('normaliseMember carries them onto a regular', () => {
    const out = normaliseMember(member(), 'regular');
    expect(out).toMatchObject({ gender: 'male', voiceRegister: 'rough' });
  });

  it('normaliseMember carries them onto a principal too', () => {
    const out = normaliseMember(
      member({ wants: 'the route back', nextMove: 'x', limit: 'y' }),
      'principal',
    );
    expect(out).toMatchObject({ gender: 'male', voiceRegister: 'rough' });
  });

  it('an ABSENT gender stays absent rather than becoming undefined-the-value', () => {
    const out = normaliseMember(member({ gender: undefined, voiceRegister: undefined }), 'regular');
    expect(out && 'gender' in out).toBe(false);
  });

  it('a sceneClose delta does NOT re-cast the character', () => {
    // THE REGRESSION THIS GUARDS. A person's gender is not scene-to-scene
    // state; letting a close rewrite it would change their voice mid-wurld,
    // which is the one thing the per-speaker pick exists to hold still.
    const cast = [normaliseMember(member(), 'regular')!];
    const after = applyCastChanges(cast, [
      { id: 'remy', voice: 'warmer now', gender: 'female' } as never,
    ]);
    expect(after[0]).toMatchObject({ gender: 'male', voiceRegister: 'rough' });
    // ...while the fields a close IS allowed to move still move.
    expect(after[0]!.voice).toBe('warmer now');
  });

  it('survives a delta that mentions the character but changes nothing', () => {
    const cast = [normaliseMember(member(), 'regular')!];
    const after = applyCastChanges(cast, [{ id: 'remy' } as never]);
    expect(after[0]).toMatchObject({ gender: 'male', voiceRegister: 'rough' });
  });
});

/**
 * TTS-VOICE-9 — the whole cast's voices, for the per-bubble speak button.
 *
 * Reported 2026-08-07: the listening exercise spoke Madame Mora in her cast
 * voice while tapping her BUBBLE spoke her in the player's. `TTS-VOICE-6`
 * resolved the voice correctly and threaded it to one of two consumers.
 *
 * This lives in `cast.ts` rather than inside `LifeScreen`'s memo precisely
 * because that is the defect: a value computed correctly and delivered to only
 * part of the app is not testable from a screen nothing renders in tests.
 */
describe('TTS-VOICE-9 — castVoiceMap', () => {
  const member = (over: Partial<CastMember> = {}): CastMember =>
    ({
      id: 'madame-mora', name: 'Madame Mora', known: 'the baker',
      tier: 'regular', standing: 0, ties: [], voice: '',
      gender: 'female', ...over,
    }) as CastMember;

  it('casts every member who has a gender', () => {
    const m = castVoiceMap({ id: 'w1', cast: [member(), member({ id: 'zalo', gender: 'male' })] });
    expect(m.size).toBe(2);
    expect(m.get('madame-mora')).toBeTruthy();
    expect(m.get('zalo')).toBeTruthy();
  });

  it('gives two DIFFERENT people different voices — the point of the map', () => {
    // A map that returned one voice for everybody would satisfy "has a voice"
    // and still be the bug.
    const m = castVoiceMap({
      id: 'w1',
      cast: [member(), member({ id: 'lucia', name: 'Lucía' })],
    });
    expect(m.get('madame-mora')).not.toBe(m.get('lucia'));
  });

  it('OMITS a member with no gender — a legacy world casts nobody', () => {
    // Every world created before TTS-VOICE-5 is this case, and it must land on
    // the old behaviour (the player's own voice) rather than an arbitrary pool
    // entry.
    expect(castVoiceMap({ id: 'w1', cast: [member({ gender: undefined })] }).size).toBe(0);
  });

  it('OMITS `other` rather than coercing it into a binary pool', () => {
    expect(castVoiceMap({ id: 'w1', cast: [member({ gender: 'other' })] }).size).toBe(0);
  });

  it('is stable for a world — the same person keeps their voice', () => {
    const a = castVoiceMap({ id: 'w1', cast: [member()] });
    const b = castVoiceMap({ id: 'w1', cast: [member()] });
    expect(a.get('madame-mora')).toBe(b.get('madame-mora'));
  });

  it('re-casts the same person in a DIFFERENT wurld (TTS-VOICE-2 hashes the world)', () => {
    // Not a cosmetic detail: the per-wurld hash is what lets a world vary its
    // ensemble without persisting a voice field.
    const ids = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6'].map(
      (id) => castVoiceMap({ id, cast: [member()] }).get('madame-mora'),
    );
    expect(new Set(ids).size).toBeGreaterThan(1);
  });

  it('returns an empty map for a world with no id, and does not throw', () => {
    expect(castVoiceMap(null).size).toBe(0);
    expect(castVoiceMap({ id: '', cast: [member()] }).size).toBe(0);
    expect(castVoiceMap({ id: 'w1' }).size).toBe(0);
  });
});

/**
 * LIFE-CAST-6 — A CAST MEMBER MUST BE WRITABLE TO FIRESTORE.
 *
 * The bug, found 2026-08-11 by running LIFE-ONBOARD on the emulator: world
 * creation was throwing
 *
 *   FirebaseError: updateDoc() called with invalid data.
 *   Unsupported field value: undefined
 *
 * because `normaliseMember` set `wants` / `nextMove` / `limit` / `wrongAbout` /
 * `routine` with `cleanText(...) ?? undefined` — an EXPLICIT key holding
 * `undefined`, which `Object.entries` lists and the Firestore SDK rejects
 * outright. The whole saga write failed, so the world never got its saga and
 * the player sat on "Building your wurld…" for ever, with nothing to retry.
 *
 * It bit only when the model omitted one of those fields, which is why it
 * survived: `limit` and `wrongAbout` are not required by the response schema,
 * so most sagas happened to fill them.
 *
 * The correct pattern was already in this very function two lines above, used
 * for `gender` / `voiceRegister`: spread-when-present, so an absent field stays
 * ABSENT rather than becoming undefined-the-value.
 *
 * These tests assert the Firestore contract directly — `in` and
 * `Object.keys`, not `=== undefined`, because that is the distinction the SDK
 * makes and the one a truthiness check would miss.
 */
describe('LIFE-CAST-6 — no member carries an explicit undefined key', () => {
  const undefinedKeys = (o: object): string[] =>
    Object.entries(o)
      .filter(([, v]) => v === undefined)
      .map(([k]) => k);

  it('a principal missing limit + wrongAbout OMITS them rather than holding undefined', () => {
    const m = normaliseMember(
      { id: 'sophie', name: 'Sophie', wants: 'company', nextMove: 'knocks' },
      'principal',
    )!;
    expect(undefinedKeys(m)).toEqual([]);
    expect('limit' in m).toBe(false);
    expect('wrongAbout' in m).toBe(false);
  });

  it('a principal missing EVERY optional drive field is still writable', () => {
    const m = normaliseMember({ id: 'x', name: 'X' }, 'principal')!;
    expect(undefinedKeys(m)).toEqual([]);
  });

  it('a regular with no routine omits it', () => {
    const m = normaliseMember({ id: 'b', name: 'Bernard' }, 'regular')!;
    expect(undefinedKeys(m)).toEqual([]);
    expect('routine' in m).toBe(false);
  });

  it('present fields still survive — the fix must not drop real values', () => {
    const m = normaliseMember(
      {
        id: 'sophie', name: 'Sophie', wants: 'company', nextMove: 'knocks',
        limit: 'will not lie for you',
        wrongAbout: { aboutId: 'bernard', believes: 'he fixed the boiler' },
      },
      'principal',
    )!;
    expect(m.wants).toBe('company');
    expect(m.limit).toBe('will not lie for you');
    expect(m.wrongAbout).toEqual({ aboutId: 'bernard', believes: 'he fixed the boiler' });
  });

  it('ingestCast DROPPING an unresolvable wrongAbout leaves no undefined behind', () => {
    // The drop path used to assign `undefined`, which is the same defect one
    // step later: a cast that ingested fine still failed to write after a
    // dangling reference was cleared.
    const cast = ingestCast({
      principals: [
        { id: 'a', name: 'A', wants: 'w', nextMove: 'n', limit: 'l',
          wrongAbout: { aboutId: 'ghost', believes: 'something' } },
      ],
      regulars: [{ id: 'b', name: 'B', routine: 'r' }],
    });
    for (const c of cast) expect(undefinedKeys(c)).toEqual([]);
    expect('wrongAbout' in cast[0]!).toBe(false);
  });

  it('applyCastChanges output is writable too — the sceneClose path', () => {
    const before = ingestCast({
      principals: [{ id: 'a', name: 'A', wants: 'w', nextMove: 'n', limit: 'l' }],
      regulars: [{ id: 'b', name: 'B', routine: 'r' }],
    });
    const after = applyCastChanges(before, [{ id: 'a', nextMove: 'leaves town' }]);
    for (const c of after) expect(undefinedKeys(c)).toEqual([]);
  });
});
