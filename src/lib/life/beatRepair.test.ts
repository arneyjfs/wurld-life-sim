/**
 * LIFE-BEAT-REPAIR — the one shared beat-normalisation path. Focus here is the
 * same-turn mute fold, which the second-pass audit found inert (it keyed on an
 * `intro.id` the model never emits).
 */
import { describe, expect, it } from 'vitest';
import type { LifeBeatPayload, LifeNpc, LifeWorld } from '@/types/firestore';
import { canonSlug } from './canon';
import { buildBeatRepairContext, normalizeBeat, normalizeBeats } from './beatRepair';

const world = (over: Partial<LifeWorld> = {}): LifeWorld => ({
  id: 'w1', characterName: 'Marc', practiceLanguage: 'French', nativeLanguage: 'English',
  difficulty: 3, worldSeedKey: 'city_life', worldMode: 'realistic', ...over,
});

const npcBeat = (npcId: string, name: string, practiceText: string): LifeBeatPayload => ({
  speaker: 'npc', speakerName: name, npcId, practiceText, nativeText: '',
});

describe('buildBeatRepairContext — same-turn mute fold (2nd-pass audit)', () => {
  it('folds a canSpeak:false introduction into muteIds via the DERIVED slug', () => {
    const ctx = buildBeatRepairContext(world(), [], [
      { kind: 'character', name: 'Mireille', subKind: 'spirit', canSpeak: false },
    ]);
    // The model emits no explicit id — the slug is derived exactly as
    // applyIntroductions derives it.
    expect(ctx.muteIds.has(canonSlug('character', 'Mireille'))).toBe(true);
  });

  it('converts a mute entity introduced AND spoken in the SAME turn to narration', () => {
    const id = canonSlug('character', 'Mireille');
    const ctx = buildBeatRepairContext(world(), [], [
      { kind: 'character', name: 'Mireille', subKind: 'spirit', canSpeak: false },
    ]);
    const out = normalizeBeat(npcBeat(id, 'Mireille', 'Elle glisse une tasse.'), ctx);
    expect(out.speaker).toBe('narrator');
    expect(out.npcId).toBeNull();
  });

  it('respects an explicit intro id when the model does supply one', () => {
    const ctx = buildBeatRepairContext(world(), [], [
      { kind: 'character', id: 'n-custom', name: 'X', canSpeak: false },
    ]);
    expect(ctx.muteIds.has('n-custom')).toBe(true);
  });

  it('leaves a speaking introduced character alone', () => {
    const ctx = buildBeatRepairContext(world(), [], [
      { kind: 'character', name: 'Sophie' },
    ]);
    const npcs: LifeNpc[] = [{ id: canonSlug('character', 'Sophie'), name: 'Sophie', avatarStatus: 'ready', scope: 'world' }];
    const ctx2 = buildBeatRepairContext(world(), npcs, [{ kind: 'character', name: 'Sophie' }]);
    void ctx;
    const out = normalizeBeat(npcBeat(canonSlug('character', 'Sophie'), 'Sophie', 'Bonjour !'), ctx2);
    expect(out.speaker).toBe('npc');
  });
});

describe('LIFE-SPEECH-6 — a beat that echoes the player\'s own line is dropped', () => {
  const ctx = (alreadySpoken: string | null) => ({
    ...buildBeatRepairContext(world(), [], []),
    alreadySpoken,
  });
  const npc = (practiceText: string) => ({
    speaker: 'npc' as const, speakerName: 'Bruno', npcId: 'bruno',
    practiceText, nativeText: 'x',
  });

  it('drops an NPC beat repeating the line verbatim', () => {
    // THE REPORTED BUG: on a fill-blank the player produces a line, it is
    // already their bubble on screen, and the post-outcome turn stages it
    // again — barred from `user` beats, the model gives it to an NPC.
    const out = normalizeBeats(
      [npc('Je voudrais un café, s\'il vous plaît.'), npc('Bien sûr.')],
      ctx('Je voudrais un café, s\'il vous plaît.'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.practiceText).toBe('Bien sûr.');
  });

  it('matches through quotes, case and trailing punctuation', () => {
    for (const echo of [
      '« Je voudrais un café, s\'il vous plaît. »',
      'je voudrais un café, s\'il vous plaît',
      '  Je voudrais un café, s\'il vous plaît!  ',
    ]) {
      const out = normalizeBeats([npc(echo)], ctx('Je voudrais un café, s\'il vous plaît.'));
      expect(out, `should drop: ${echo}`).toHaveLength(0);
    }
  });

  it('keeps a beat that merely MENTIONS the same words in a longer line', () => {
    // Dropping a real beat is worse than the duplicate, so the match is
    // normalised EQUALITY — not containment.
    const out = normalizeBeats(
      [npc('Je voudrais un café, s\'il vous plaît, dit-il en repensant à hier soir.')],
      ctx('Je voudrais un café, s\'il vous plaît.'),
    );
    expect(out).toHaveLength(1);
  });

  it('is inert when nothing was spoken', () => {
    const beats = [npc('Bonjour.'), npc('Ça va ?')];
    expect(normalizeBeats(beats, ctx(null))).toHaveLength(2);
    expect(normalizeBeats(beats, ctx('   '))).toHaveLength(2);
  });

  it('never drops the player\'s OWN bubble — only a restaging of it', () => {
    const user = {
      speaker: 'user' as const, speakerName: null, npcId: null,
      practiceText: 'Je voudrais un café.', nativeText: 'I would like a coffee.',
    };
    const out = normalizeBeats([user], ctx('Je voudrais un café.'));
    expect(out).toHaveLength(1);
  });
});
