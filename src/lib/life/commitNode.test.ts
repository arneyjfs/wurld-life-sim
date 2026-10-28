import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./world', () => ({
  appendBeatEvent: vi.fn(),
  appendDecisionEvent: vi.fn(),
  appendLifeEvent: vi.fn(),
  updateLifeWorld: vi.fn(),
}));
vi.mock('./npcs', () => ({
  promoteOrTouchNpc: vi.fn(),
  // Real signatures return Promises; the source chains `.catch` on
  // the fire-and-forget avatar kickoff, so the mocks must too.
  setNpcAvatar: vi.fn(async () => undefined),
  setNpcAvatarFailed: vi.fn(async () => undefined),
  setNpcDescription: vi.fn(async () => undefined),
  writeNpcMemories: vi.fn(async () => undefined),
  setNpcStanding: vi.fn(async () => undefined),
}));
vi.mock('./generateNpcAvatar', () => ({
  generateNpcAvatar: vi.fn(),
  svgToDataUri: vi.fn(() => 'data:image/svg+xml;base64,x'),
}));
vi.mock('./generateNpcProfile', () => ({
  generateNpcProfile: vi.fn(),
}));
vi.mock('./lifeAvatarAssets', () => ({
  writeCharacterAvatar: vi.fn(async () => undefined),
  writeNpcAvatar: vi.fn(async () => undefined),
}));
vi.mock('./debugLog', () => ({ lifeDebug: vi.fn(), lifeFailed: vi.fn() }));
vi.mock('../log', () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn() }));

import {
  appendBeatEvent,
  appendDecisionEvent,
  appendLifeEvent,
  updateLifeWorld,
} from './world';
import {
  promoteOrTouchNpc,
  setNpcAvatar,
  setNpcAvatarFailed,
  setNpcDescription,
  writeNpcMemories,
  setNpcStanding,
} from './npcs';
import { generateNpcAvatar } from './generateNpcAvatar';
import { generateNpcProfile } from './generateNpcProfile';
import { writeCharacterAvatar } from './lifeAvatarAssets';
import {
  __resetPlayerAvatarInFlight,
  applyTurnSignals,
  capStoryLog,
  commitNode,
  kickoffNpcAssets,
} from './commitNode';
import type { LifeNpc, LifeWorld } from '@/types/firestore';

const appendBeatEventMock = vi.mocked(appendBeatEvent);
const appendDecisionEventMock = vi.mocked(appendDecisionEvent);
const appendLifeEventMock = vi.mocked(appendLifeEvent);
const updateLifeWorldMock = vi.mocked(updateLifeWorld);
const promoteOrTouchNpcMock = vi.mocked(promoteOrTouchNpc);
const generateNpcAvatarMock = vi.mocked(generateNpcAvatar);
const generateNpcProfileMock = vi.mocked(generateNpcProfile);
const setNpcAvatarMock = vi.mocked(setNpcAvatar);
const setNpcAvatarFailedMock = vi.mocked(setNpcAvatarFailed);
const setNpcDescriptionMock = vi.mocked(setNpcDescription);
const writeNpcMemoriesMock = vi.mocked(writeNpcMemories);
const writeCharacterAvatarMock = vi.mocked(writeCharacterAvatar);

const baseWorld: LifeWorld = {
  id: 'w1',
  characterName: 'Marc',
  practiceLanguage: 'French',
  nativeLanguage: 'English',
  difficulty: 3,
  worldSeedKey: 'city_life',
  worldMode: 'realistic',
  // Avatar already generated (status 'ready') → no player-avatar kickoff
  // noise. The bytes live in the assets/character sidecar (LIFE-DATA-1),
  // never on this doc.
  characterAvatarStatus: 'ready',
  currentLocationLabel: 'Ton appartement · matin',
};

const npcBeat = {
  speaker: 'npc' as const,
  speakerName: 'Sophie',
  npcId: 'sophie',
  practiceText: 'Salut !',
  nativeText: 'Hi!',
};
const narratorBeat = {
  speaker: 'narrator' as const,
  speakerName: null,
  npcId: null,
  practiceText: 'Le soleil se lève.',
  nativeText: 'The sun rises.',
};

let calls: string[];

beforeEach(() => {
  calls = [];
  vi.clearAllMocks();
  // LIFE-FAIL-9: clear the module-level player-avatar in-flight guard so a
  // prior test's fire-and-forget kickoff doesn't leak into the next.
  __resetPlayerAvatarInFlight();
  appendDecisionEventMock.mockImplementation(async () => {
    calls.push('decision');
    return 'e-d';
  });
  appendLifeEventMock.mockImplementation(async (input) => {
    calls.push(`event:${(input as { kind: string }).kind}`);
    return 'e-l';
  });
  appendBeatEventMock.mockImplementation(async (_u, _w, beat) => {
    calls.push(`beat:${(beat as { practiceText: string }).practiceText}`);
    return 'e-b';
  });
  updateLifeWorldMock.mockImplementation(async () => {
    calls.push('world');
  });
  promoteOrTouchNpcMock.mockImplementation(async () => {
    calls.push('promote');
    return { isNew: false };
  });
  generateNpcAvatarMock.mockResolvedValue({ kind: 'error', error: 'off' } as never);
  generateNpcProfileMock.mockResolvedValue({ kind: 'error', error: 'off' } as never);
});

describe('commitNode — LIFE-NODE-3 write ordering', () => {
  it('LIFE-NODE-3 — decision event first, then promote→introduced→beat per NPC beat, then backdrop patch', async () => {
    promoteOrTouchNpcMock.mockImplementationOnce(async () => {
      calls.push('promote');
      return { isNew: true };
    });
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'choice', choiceId: 'sophie', text: 'Rejoindre Sophie' },
      beats: [narratorBeat, npcBeat],
      backdropIntent: {
        locationType: 'cafe',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Le café · matin',
      },
    });
    expect(calls).toEqual([
      'decision',
      'beat:Le soleil se lève.',
      'promote',
      'event:npc_introduced',
      'beat:Salut !',
      // LIFE-CTX-12: the backdrop move now WRITES a backdrop_visited event before
      // patching the world — the step SI tells the model to read this event,
      // and until now nothing ever emitted one.
      'event:backdrop_visited',
      'world',
    ]);
    expect(updateLifeWorldMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({
        currentLocationLabel: 'Le café · matin',
        currentBackdrop: expect.objectContaining({ locationType: 'cafe' }),
      }),
    );
  });

  it('LIFE-NODE-3 — practice-outcome commits a correction event with the full payload', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: {
        kind: 'practice-outcome',
        outcome: {
          kind: 'generation',
          correct: true,
          picked: 'voudrais',
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café.',
        },
      },
      beats: [],
      backdropIntent: null,
    });
    expect(appendLifeEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'correction',
        payload: expect.objectContaining({
          kind: 'generation',
          correct: true,
          correctAnswer: 'voudrais',
          promptSource: 'Je ___ un café.',
        }),
      }),
    );
  });

  it('LIFE-NODE-4 — free-text commits a decision with the __write__ id', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'free-text', text: 'On va au parc ?' },
      beats: [],
      backdropIntent: null,
    });
    expect(appendDecisionEventMock).toHaveBeenCalledWith('u1', 'w1', {
      choiceId: '__write__',
      text: 'On va au parc ?',
    });
  });

  it("LIFE-NODE-3 — action 'none' writes no action event", async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [narratorBeat],
      backdropIntent: null,
    });
    expect(appendDecisionEventMock).not.toHaveBeenCalled();
    expect(appendLifeEventMock).not.toHaveBeenCalled();
    expect(appendBeatEventMock).toHaveBeenCalledTimes(1);
  });

  it('LIFE-NODE-3 — the same NPC in two beats promotes once; avatar kickoff only when new', async () => {
    promoteOrTouchNpcMock.mockImplementation(async () => {
      calls.push('promote');
      return { isNew: true };
    });
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: 'c1',
      action: { kind: 'none' },
      beats: [npcBeat, { ...npcBeat, practiceText: 'Ça va ?' }],
      backdropIntent: null,
    });
    expect(promoteOrTouchNpcMock).toHaveBeenCalledTimes(1);
    expect(promoteOrTouchNpcMock).toHaveBeenCalledWith(
      expect.objectContaining({ npcId: 'sophie', sceneId: 'c1' }),
    );
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalled());
  });

  it('LIFE-NODE-3 — no backdrop patch when the location label is unchanged', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: {
        locationType: 'apartment',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Ton appartement · matin',
      },
    });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });

  it('LIFE-BACKDROP-26 — the native label is persisted alongside the practice one', async () => {
    // The step call is already holding both; a translate-on-tap would be a
    // Gemini round-trip for a caption, and the ribbon has no other source.
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: {
        locationType: 'harbour',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Le Vieux-Port',
        locationLabelNative: 'The Old Port',
      },
    });
    expect(updateLifeWorldMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({
        currentLocationLabel: 'Le Vieux-Port',
        currentLocationLabelNative: 'The Old Port',
        currentBackdrop: expect.objectContaining({ labelNative: 'The Old Port' }),
      }),
    );
  });

  it('LIFE-BACKDROP-26 — a move with NO native label clears the stale one', async () => {
    // Otherwise the ribbon at the new place offers a reveal that shows the
    // translation of the place the player just left.
    await commitNode({
      uid: 'u1',
      world: { ...baseWorld, currentLocationLabelNative: 'Your apartment' },
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: {
        locationType: 'harbour',
        vibe: 'modern_city',
        persistent: true,
        locationLabel: 'Le Vieux-Port',
      },
    });
    expect(updateLifeWorldMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({ currentLocationLabelNative: '' }),
    );
  });

  it('LIFE-NPC-2 — player avatar kickoff fires when the world never generated one (status absent)', async () => {
    // characterAvatarStatus undefined (never attempted) → kickoff fires.
    const bare: LifeWorld = { ...baseWorld, characterAvatarStatus: undefined };
    await commitNode({
      uid: 'u1',
      world: bare,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: null,
    });
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalled());
  });

  it('LIFE-NPC-2 — kickoff is SKIPPED once a TERMINAL status exists (ready/failed)', async () => {
    for (const status of ['ready', 'failed'] as const) {
      generateNpcAvatarMock.mockClear();
      __resetPlayerAvatarInFlight();
      await commitNode({
        uid: 'u1',
        world: { ...baseWorld, characterAvatarStatus: status },
        sceneId: null,
        action: { kind: 'none' },
        beats: [],
        backdropIntent: null,
      });
      expect(generateNpcAvatarMock).not.toHaveBeenCalled();
    }
  });

  it('LIFE-FAIL-9 — a stale \'pending\' player avatar is RE-KICKED (dead-gen recovery)', async () => {
    // The old `== null` gate stranded a reload-abandoned 'pending' forever.
    generateNpcAvatarMock.mockResolvedValue({ kind: 'ok', svg: '<svg/>', via: 'parts' });
    await commitNode({
      uid: 'u1',
      world: { ...baseWorld, characterAvatarStatus: 'pending' },
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: null,
    });
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalled());
  });

  it('LIFE-FAIL-9 — a second commit while the player-avatar gen is in flight does NOT double-fire', async () => {
    let settle!: () => void;
    generateNpcAvatarMock.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = () => resolve({ kind: 'ok', svg: '<svg/>', via: 'parts' });
      }) as never,
    );
    const pendingWorld = { ...baseWorld, characterAvatarStatus: 'pending' as const };
    const first = commitNode({
      uid: 'u1',
      world: pendingWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: null,
    });
    await first;
    // Player-avatar gen still in flight (guard held) → a second commit skips.
    await commitNode({
      uid: 'u1',
      world: pendingWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: null,
    });
    expect(generateNpcAvatarMock).toHaveBeenCalledTimes(1);
    settle();
    await vi.waitFor(() =>
      expect(
        updateLifeWorldMock.mock.calls.some(
          (c) => (c[2] as Record<string, unknown>).characterAvatarStatus === 'ready',
        ),
      ).toBe(true),
    );
  });

  it('LIFE-FAIL-5 — the player avatar retries ONCE on a transient failure, then succeeds', async () => {
    generateNpcAvatarMock
      .mockResolvedValueOnce({ kind: 'error', error: 'flaky' } as never)
      .mockResolvedValueOnce({ kind: 'ok', svg: '<svg/>', via: 'parts' } as never);
    await commitNode({
      uid: 'u1',
      world: { ...baseWorld, characterAvatarStatus: undefined },
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: null,
    });
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalledTimes(2));
    // Second attempt succeeded → status flips to 'ready', not 'failed'.
    await vi.waitFor(() =>
      expect(
        updateLifeWorldMock.mock.calls.some(
          (c) => (c[2] as Record<string, unknown>).characterAvatarStatus === 'ready',
        ),
      ).toBe(true),
    );
  });

  it('LIFE-DATA-1 — a successful player avatar writes BYTES to the sidecar, only the STATUS to the world doc', async () => {
    generateNpcAvatarMock.mockResolvedValue({ kind: 'ok', svg: '<svg/>', via: 'parts' });
    await commitNode({
      uid: 'u1',
      world: { ...baseWorld, characterAvatarStatus: undefined },
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      backdropIntent: null,
    });
    // Bytes → sidecar (svgToDataUri mock returns the data URI).
    await vi.waitFor(() =>
      expect(writeCharacterAvatarMock).toHaveBeenCalledWith(
        'u1',
        'w1',
        'data:image/svg+xml;base64,x',
      ),
    );
    // World doc gets ONLY the status flag — never the avatar bytes.
    const statusReadyCall = updateLifeWorldMock.mock.calls.find(
      (c) =>
        (c[2] as Record<string, unknown>).characterAvatarStatus === 'ready',
    );
    expect(statusReadyCall).toBeTruthy();
    for (const call of updateLifeWorldMock.mock.calls) {
      expect(call[2]).not.toHaveProperty('characterAvatarUrl');
    }
  });

  it('LIFE-NPC-7 — a brand-new NPC kicks BOTH avatar and profile gen', async () => {
    promoteOrTouchNpcMock.mockImplementation(async () => {
      calls.push('promote');
      return { isNew: true };
    });
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: 'c1',
      action: { kind: 'none' },
      beats: [npcBeat],
      backdropIntent: null,
    });
    await vi.waitFor(() => {
      expect(generateNpcAvatarMock).toHaveBeenCalled();
      expect(generateNpcProfileMock).toHaveBeenCalled();
    });
  });

  it('LIFE-NPC-8 — a beat-promoted NPC carries its CAST role into BOTH the row and the prompts', async () => {
    // THE REPORTED BUG. This path promoted with a name and nothing else, so
    // `buildNpcProfilePrompt` emitted no <role> at all and the model invented
    // one — "Madame Roux, ta fleuriste" rendering as "your formidable vocal
    // coach and mentor". LIFE-NPC-6 fixed exactly this on the SCENE path
    // and never reached here, which is where most NPCs are born.
    promoteOrTouchNpcMock.mockImplementation(async () => ({ isNew: true }));
    await commitNode({
      uid: 'u1',
      world: {
        ...baseWorld,
        // LIFE-ARCH-3: the role now comes from the CAST, not from the saga's
        // `keyArchetypes` — that field was part of the deleted synopsis. The
        // cast is a better source anyway: it is the ACTUAL recurring cast, and
        // `known` is what the player has witnessed rather than what was planned.
        cast: [
          {
            id: 'madame-roux',
            name: 'Madame Roux',
            known: 'a florist who delivers coded scripts',
            tier: 'principal' as const,
            voice: 'clipped, never repeats herself',
            standing: 0,
            ties: [],
          },
        ],
      } as unknown as LifeWorld,
      sceneId: 'c1',
      action: { kind: 'none' },
      beats: [
        {
          speaker: 'npc' as const,
          speakerName: 'Madame Roux',
          npcId: 'madame-roux',
          practiceText: 'Le texte a changé.',
          nativeText: 'The script has changed.',
        },
      ],
      backdropIntent: null,
    });

    // The ROW gets the short label — it renders as the card's role line.
    expect(promoteOrTouchNpcMock).toHaveBeenCalledWith(
      expect.objectContaining({
        npcId: 'madame-roux',
        relationship: 'a florist who delivers coded scripts',
      }),
    );
    // The PROMPT gets the sentence that actually answers "who is she".
    await vi.waitFor(() => {
      expect(generateNpcProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Madame Roux',
          role: 'a florist who delivers coded scripts',
          // The sentence NAMES her — that is what makes it answer "who is
          // she" to a prompt that has nothing else to go on. And it says it
          // once: the label and the sentence come from one field, so they
          // must not be concatenated into "X — Name, X".
          archetype: 'Madame Roux, a florist who delivers coded scripts',
        }),
      );
    });
  });

  it('LIFE-NPC-8 — an NPC the cast never names still promotes, with no invented role', async () => {
    // The fallback must be SILENCE, not a guess: passing a wrong archetype
    // would render with total confidence.
    promoteOrTouchNpcMock.mockImplementation(async () => ({ isNew: true }));
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: 'c1',
      action: { kind: 'none' },
      beats: [npcBeat],
      backdropIntent: null,
    });
    expect(promoteOrTouchNpcMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ relationship: expect.anything() }),
    );
    await vi.waitFor(() => {
      expect(generateNpcProfileMock).toHaveBeenCalledWith(
        expect.objectContaining({ name: 'Sophie', role: null, archetype: null }),
      );
    });
  });

  it('LIFE-NPC-6 — roster sweep re-kicks avatar gen for a pending, avatar-less NPC (role from relationship)', async () => {
    const stale: LifeNpc = {
      id: 'marie',
      name: 'Marie',
      relationship: 'fruit seller',
      avatarStatus: 'pending',
      // description already set → only the avatar is missing.
      description: 'Your neighbourhood fruit seller.',
    };
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      npcs: [stale],
      backdropIntent: null,
    });
    await vi.waitFor(() => expect(generateNpcAvatarMock).toHaveBeenCalled());
    expect(generateNpcAvatarMock).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Marie', role: 'fruit seller' }),
    );
    // description present → no profile re-kick.
    expect(generateNpcProfileMock).not.toHaveBeenCalled();
  });

  it('LIFE-FAIL-5 — an NPC avatar gen retries ONCE on a transient failure before marking failed', async () => {
    // First attempt fails, retry succeeds → the avatar is stored, NOT failed.
    generateNpcAvatarMock
      .mockResolvedValueOnce({ kind: 'error', error: 'flaky' } as never)
      .mockResolvedValueOnce({ kind: 'ok', svg: '<svg/>', via: 'parts' } as never);
    await kickoffNpcAssets({
      uid: 'u1',
      world: baseWorld,
      npcId: 'retry-npc',
      name: 'Rémi',
      needsAvatar: true,
      needsProfile: false,
    });
    expect(generateNpcAvatarMock).toHaveBeenCalledTimes(2);
    expect(setNpcAvatarMock).toHaveBeenCalledWith('u1', 'w1', 'retry-npc', expect.any(String));
    expect(setNpcAvatarFailedMock).not.toHaveBeenCalled();
  });

  it('LIFE-FAIL-5 — an NPC avatar that fails TWICE lands the terminal \'failed\' status', async () => {
    generateNpcAvatarMock.mockResolvedValue({ kind: 'error', error: 'boom' } as never);
    await kickoffNpcAssets({
      uid: 'u1',
      world: baseWorld,
      npcId: 'doomed-npc',
      name: 'Zoé',
      needsAvatar: true,
      needsProfile: false,
    });
    expect(generateNpcAvatarMock).toHaveBeenCalledTimes(2);
    expect(setNpcAvatarFailedMock).toHaveBeenCalledWith('u1', 'w1', 'doomed-npc');
  });

  it("LIFE-NPC-6 — a 'failed'-avatar NPC is NEVER re-kicked (LIFE-FAIL-5)", async () => {
    const failed: LifeNpc = {
      id: 'paul',
      name: 'Paul',
      relationship: 'baker',
      avatarStatus: 'failed',
      description: 'The baker on the corner.',
    };
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      npcs: [failed],
      backdropIntent: null,
    });
    await Promise.resolve();
    expect(generateNpcAvatarMock).not.toHaveBeenCalled();
    expect(generateNpcProfileMock).not.toHaveBeenCalled();
  });

  it('LIFE-NPC-7 — roster sweep backfills the description for a legacy null-description NPC (avatar already ready, not re-kicked)', async () => {
    generateNpcProfileMock.mockResolvedValue({
      kind: 'ok',
      description: 'Your upstairs neighbour, a retired chef.',
    } as never);
    const legacy: LifeNpc = {
      id: 'leo',
      name: 'Léo',
      relationship: 'neighbour',
      avatarStatus: 'ready',
      description: null,
    };
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [],
      npcs: [legacy],
      backdropIntent: null,
    });
    await vi.waitFor(() =>
      expect(setNpcDescriptionMock).toHaveBeenCalledWith(
        'u1',
        'w1',
        'leo',
        'Your upstairs neighbour, a retired chef.',
      ),
    );
    // avatar already ready → NOT re-kicked.
    expect(generateNpcAvatarMock).not.toHaveBeenCalled();
  });
});

describe('LIFE-REP-5/7 — the clearing turn always lands, the practice answer never does', () => {
  const HELENE = { id: 'helene', name: 'Hélène', standing: 0 } as unknown as LifeNpc;
  const standingMock = vi.mocked(setNpcStanding);

  beforeEach(() => standingMock.mockClear());

  it('LIFE-REP-5 — investing a turn moves standing even when the model reports NOTHING', async () => {
    // The whole point. `felt` is a field the model may simply not author, and
    // this repo has measured that outcome twice (`hear` 4/2110, `addGoals`
    // 0/95). The player was shown a door and told it clears the block; the
    // door working must not depend on the model noticing.
    await applyTurnSignals({
      uid: 'u1', world: baseWorld, npcs: [HELENE],
      investIn: 'Hélène',
      felt: [],
    });
    expect(standingMock).toHaveBeenCalledWith('u1', 'w1', 'helene', 1);
  });

  it('LIFE-REP-5 — exactly ONE step, even when the model reports the same reaction', async () => {
    await applyTurnSignals({
      uid: 'u1', world: baseWorld, npcs: [HELENE],
      investIn: 'Hélène',
      felt: [{ who: 'Hélène', delta: 1 }],
    });
    expect(standingMock).toHaveBeenCalledTimes(1);
    expect(standingMock).toHaveBeenCalledWith('u1', 'w1', 'helene', 1);
  });

  it('LIFE-REP-5 — a hostile reaction cannot CANCEL the turn the player spent', async () => {
    // `applyFelt` keeps the first entry per person, and the invested step is
    // prepended. Without that ordering the model could zero out the one move
    // the player was promised would work.
    await applyTurnSignals({
      uid: 'u1', world: baseWorld, npcs: [HELENE],
      investIn: 'Hélène',
      felt: [{ who: 'Hélène', delta: -1 }],
    });
    expect(standingMock).toHaveBeenCalledWith('u1', 'w1', 'helene', 1);
  });

  it('an UNRESOLVABLE investIn is dropped, never minted', async () => {
    // Same objection LIFE-NEED-6 makes: a standing row for somebody not in the
    // cast is a relationship the player can never see or repair.
    await applyTurnSignals({
      uid: 'u1', world: baseWorld, npcs: [HELENE],
      investIn: 'Somebody Else',
      felt: [],
    });
    expect(standingMock).not.toHaveBeenCalled();
  });

  it('LIFE-REP-7 — an ordinary turn with no investment and no felt moves nothing', async () => {
    // The floor this sits on: standing moves for a REASON, never as ambient
    // drift. A practice answer commits through `commitNode`'s
    // practice-outcome branch, which carries neither field, so it can never
    // reach this write — attaching social cost to a grammar slip is the one
    // thing LIFE-REP-7 calls non-negotiable.
    await applyTurnSignals({ uid: 'u1', world: baseWorld, npcs: [HELENE] });
    expect(standingMock).not.toHaveBeenCalled();
  });
});

describe('applyTurnSignals — LIFE-NODE-3 turn-level deltas', () => {
  it('LIFE-GOAL-3 — a live objective SURVIVES a turn proposing another one', async () => {
    // The reported bug, at the commit seam. `addGoals`/`removeGoals` lived here
    // and let the model rewrite the goal set on any turn; the ladder's reducer
    // only accepts a proposal into an EMPTY slot.
    await applyTurnSignals({
      uid: 'u1',
      world: {
        ...baseWorld,
        goalLadder: {
          saga: { text: 'reach the coast', when: 'Friday', days: 12 },
          objective: { id: 'o1', text: 'find the key' },
          done: [],
          dayIndex: 0,
        },
      },
      worldDelta: { currentLocationLabel: 'Le marché', nextObjective: 'buy oranges' },
    });
    // Only the label moved — the ladder is unchanged, so it is not in the patch.
    expect(updateLifeWorldMock).toHaveBeenCalledWith('u1', 'w1', {
      currentLocationLabel: 'Le marché',
    });
  });

  it('LIFE-GOAL-3 — completing it banks the objective and adopts the next', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: {
        ...baseWorld,
        goalLadder: {
          saga: { text: 'reach the coast', when: 'Friday', days: 12 },
          objective: { id: 'o1', text: 'find the key' },
          done: [],
          dayIndex: 0,
        },
      },
      worldDelta: { objectiveDone: true, nextObjective: 'open the cellar' },
    });
    const patch = updateLifeWorldMock.mock.calls.at(-1)?.[2] as {
      goalLadder?: { objective?: { text: string }; done: unknown[] };
    };
    expect(patch?.goalLadder?.objective?.text).toBe('open the cellar');
    expect(patch?.goalLadder?.done).toEqual([{ text: 'find the key', how: 'done' }]);
  });

  it('writes nothing for an empty delta', async () => {
    await applyTurnSignals({ uid: 'u1', world: baseWorld, worldDelta: {} });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
  });
});

describe('kickoffNpcAssets — LIFE-NPC-2 in-flight dedup', () => {
  it('LIFE-NPC-2 — a second asset kickoff for the same NPC while the first is in flight fires ONE gen', async () => {
    let settle!: () => void;
    generateNpcAvatarMock.mockReturnValueOnce(
      new Promise((resolve) => {
        settle = () => resolve({ kind: 'error', error: 'x' });
      }) as never,
    );
    const args = {
      uid: 'u1',
      world: baseWorld,
      npcId: 'dedup-npc',
      name: 'Marie',
      needsAvatar: true,
      needsProfile: false,
    };
    const first = kickoffNpcAssets(args); // avatar gen in flight (1st gen call)
    await kickoffNpcAssets(args); // SAME key → deduped, resolves immediately
    expect(generateNpcAvatarMock).toHaveBeenCalledTimes(1);
    // Settle the first gen → it FAILS, so LIFE-FAIL-5 retries once (2nd call),
    // then the guard clears the in-flight key.
    settle();
    await first;
    expect(generateNpcAvatarMock).toHaveBeenCalledTimes(2);
    // A fresh kickoff AFTER settle fires again — initial + retry = 2 more.
    await kickoffNpcAssets(args);
    expect(generateNpcAvatarMock).toHaveBeenCalledTimes(4);
  });
});

/**
 * LIFE-CANON-4 — the roster is the authority on a character's name. This is a
 * deterministic correction, not a retry: no model call, no cost, and it makes
 * "the line was attributed to the wrong character" structurally impossible
 * rather than merely discouraged by the prompt.
 */
describe('commitNode — deterministic speaker attribution (LIFE-CANON-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rewrites a drifted speakerName to the roster name for that npcId', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      npcs: [{ id: 'n-sophie', name: 'Sophie', avatarStatus: 'ready', scope: 'world' }],
      sceneId: null,
      action: { kind: 'none' },
      beats: [{
        speaker: 'npc',
        npcId: 'n-sophie',
        // The model drifted — same character, different name.
        speakerName: 'Sophia',
        practiceText: 'Bonjour.',
      }],
      backdropIntent: null,
    });

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as { speakerName?: string };
    expect(beat.speakerName).toBe('Sophie');
  });

  it('leaves a genuinely new NPC alone (nothing to correct against)', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      npcs: [],
      sceneId: null,
      action: { kind: 'none' },
      beats: [{ speaker: 'npc', npcId: 'n-new', speakerName: 'Amélie', practiceText: 'Salut.' }],
      backdropIntent: null,
    });

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as { speakerName?: string };
    expect(beat.speakerName).toBe('Amélie');
  });
});

describe('commitNode — re-slugged speakers bind back to the established id (LIFE-CANON-4)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('binds a new npcId back to the existing character with that name', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      npcs: [{ id: 'n-sophie', name: 'Sophie', avatarStatus: 'ready', scope: 'world' }],
      sceneId: null,
      action: { kind: 'none' },
      // Same person, freshly (and wrongly) slugged — left alone this mints a
      // second Sophie whose memory and avatar then diverge from the first.
      beats: [{ speaker: 'npc', npcId: 'sophie-2', speakerName: 'Sophie', practiceText: 'Re.' }],
      backdropIntent: null,
    });

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as { npcId?: string };
    expect(beat.npcId).toBe('n-sophie');
    expect(promoteOrTouchNpcMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ npcId: 'sophie-2' }),
    );
  });
});

/**
 * LIFE-CANON-1 / LIFE-STORY-LOG-1 — the ledgers extend on the TURN, not the
 * node, so a preview never persists them (LIFE-NODE-2/3).
 */
describe('applyTurnSignals — append-only ledgers', () => {
  beforeEach(() => vi.clearAllMocks());

  const patchOf = () =>
    updateLifeWorldMock.mock.calls.at(-1)?.[2] as Record<string, unknown>;

  /** `patchOf()` is intentionally loose (Record<string, unknown>); these three
   *  cases read specific counters, so narrow once here rather than casting at
   *  each assertion. */
  const storyLogOf = () =>
    patchOf().storyLog as
      | { turns?: number; sceneTurns?: number; sceneId?: string | null }
      | undefined;

  it('appends a declared entity to the canon, carrying its affordance', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: baseWorld,
      introduces: [
        { kind: 'character', name: 'Mireille', subKind: 'spirit', canSpeak: false,
          note: 'answers only by moving objects' },
      ],
    });
    const canon = patchOf().canon as { characters: Array<Record<string, unknown>> };
    expect(canon.characters[0]).toMatchObject({
      name: 'Mireille', kind: 'spirit', canSpeak: false,
    });
  });

  it('APPENDS to the story log — earlier entries are never rewritten', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['Marc refused the key.'] } },
      logLine: 'Sophie left angry.',
    });
    expect((patchOf().storyLog as { entries: string[] }).entries).toEqual([
      'Marc refused the key.',
      'Sophie left angry.',
    ]);
  });

  it('resets the log at a chapter boundary', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: {
        ...baseWorld,
        currentArc: { chapterNumber: 2, premise: 'p', themes: [], status: 'active', recurringNpcIds: [], completedSceneMemories: [] },
        storyLog: { chapterNumber: 1, entries: ['old chapter line'] },
      } as unknown as typeof baseWorld,
      logLine: 'The new chapter opens.',
      countsAsTurn: true,
    });
    expect(patchOf().storyLog).toEqual({
      chapterNumber: 2,
      entries: ['The new chapter opens.'],
      // LIFE-ARC-PACE-4: the DAY counter rides alongside the chapter's. A
      // chapter boundary is also a day boundary, so it restarts here too.
      // `sceneId` is null because this caller passes none — the count is
      // simply not re-scoped by an unknown scene.
      sceneTurns: 1,
      sceneId: null,
      // LIFE-ARC-PACE-1: the pace counter resets with the log, so chapter 2
      // does not inherit chapter 1's length and immediately read as overdue.
      turns: 1,
    });
  });

  it('writes nothing when the turn contributed nothing', async () => {
    await applyTurnSignals({ uid: 'u1', world: baseWorld });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
    expect(writeNpcMemoriesMock).not.toHaveBeenCalled();
  });

  // LIFE-ARC-PACE-1. `entries.length` is NOT the turn count: a graded turn
  // appends the question's line AND its pre-authored resolution's line, so the
  // entry list runs ~1.36x ahead of the turns the SI's pace rule is written in
  // (measured over a 25-turn harness run: 34 entries). Feeding entries.length
  // to <chapterPace> would have concluded chapters at ~turn 23 instead of ~32.
  it('LIFE-ARC-PACE-1 — a generated turn advances the pace counter', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 7 } },
      logLine: 'Sophie left angry.',
      countsAsTurn: true,
    });
    expect(patchOf().storyLog).toMatchObject({ turns: 8, entries: ['a', 'Sophie left angry.'] });
  });

  it('LIFE-ARC-PACE-1 — a resolution arrival logs its line but is NOT a turn', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 7 } },
      logLine: 'She took the key anyway.',
      countsAsTurn: false,
    });
    expect(patchOf().storyLog).toMatchObject({
      turns: 7,
      entries: ['a', 'She took the key anyway.'],
    });
  });

  it('LIFE-ARC-PACE-1 — a turn with a worldDelta but no logLine still counts', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 7 } },
      worldDelta: { currentLocationLabel: 'Le marché' },
      countsAsTurn: true,
    });
    expect(patchOf().storyLog).toMatchObject({ turns: 8, entries: ['a'] });
  });

  it('LIFE-ARC-PACE-1 — a legacy log with no `turns` seeds from its entry count', async () => {
    // Pre-existing worlds were written before the field existed. Seeding from
    // entries.length overstates the count, which can only make an already-long
    // chapter conclude sooner — the safe direction for the bug being fixed.
    await applyTurnSignals({
      uid: 'u1',
      world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a', 'b', 'c'] } },
      logLine: 'next',
      countsAsTurn: true,
    });
    expect(patchOf().storyLog).toMatchObject({ turns: 4 });
  });

  it('LIFE-NPC-MEM-1 — fans npcMemoryUpdates out to writeNpcMemories with the live roster', async () => {
    const npcs: LifeNpc[] = [
      { id: 'n-sophie', name: 'Sophie', avatarStatus: 'ready', scope: 'world' },
    ];
    await applyTurnSignals({
      uid: 'u1',
      world: baseWorld,
      npcs,
      npcMemoryUpdates: [{ npcId: 'n-sophie', oneLineMemory: 'You mended the fence; she trusts you now.' }],
    });
    expect(writeNpcMemoriesMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      [{ npcId: 'n-sophie', oneLineMemory: 'You mended the fence; she trusts you now.' }],
      npcs,
      'life.step',
    );
  });

  it('LIFE-NPC-MEM-1 — memory-only turn fans memory but writes no world patch', async () => {
    await applyTurnSignals({
      uid: 'u1',
      world: baseWorld,
      npcMemoryUpdates: [{ npcId: 'n-sophie', oneLineMemory: 'x' }],
    });
    expect(updateLifeWorldMock).not.toHaveBeenCalled();
    expect(writeNpcMemoriesMock).toHaveBeenCalledTimes(1);
  });
  /**
   * LIFE-ARC-PACE-4 — the DAY's counter re-scopes when the day does.
   *
   * The chapter counter resets on a chapter boundary; this one has to reset on a
   * scene boundary, which is a different and more frequent event. Getting it
   * wrong in either direction is a silent pacing bug: never resetting makes
   * every day after the first look overdue from its first turn, and resetting
   * too eagerly means a day never reaches its window at all.
   */
  describe('LIFE-ARC-PACE-4 / LIFE-SCENE-25 — the scene counter', () => {
    it('counts turns within one scene', async () => {
      await applyTurnSignals({
        uid: 'u1',
        world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 3, sceneTurns: 3, sceneId: 'c1' } } as unknown as typeof baseWorld,
        logLine: 'still the same day',
        countsAsTurn: true,
        sceneId: 'c1',
      });
      expect(storyLogOf()?.sceneTurns).toBe(4);
    });

    it('restarts on a NEW scene, without touching the chapter count', async () => {
      await applyTurnSignals({
        uid: 'u1',
        world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 9, sceneTurns: 9, sceneId: 'c1' } } as unknown as typeof baseWorld,
        logLine: 'a new day begins',
        countsAsTurn: true,
        sceneId: 'c2',
      });
      expect(storyLogOf()?.sceneTurns).toBe(1);
      // The chapter spans several days, so its own count must NOT restart here.
      expect(storyLogOf()?.turns).toBe(10);
    });

    it('LIFE-SCENE-25 — an OVERRUN scene never spends the next one\'s budget', async () => {
      // Owner, verbatim: "The turn counter should never spell into the next
      // scene's quota. The counter should restart when and only when the scene
      // changes." A scene that ran 15 turns — past its 12-turn ceiling — must
      // hand the next one a full budget, not a debt.
      await applyTurnSignals({
        uid: 'u1',
        world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 20, sceneTurns: 15, sceneId: 'c1' } } as unknown as typeof baseWorld,
        logLine: 'the next scene opens',
        countsAsTurn: true,
        sceneId: 'c2',
      });
      expect(storyLogOf()?.sceneTurns).toBe(1);
    });

    it('LIFE-SCENE-25 — the SAME scene id never restarts it, however long it runs', async () => {
      // The other half of "and only when": a mid-scene commit must not reset,
      // or a scene could never reach its ceiling and would run forever.
      await applyTurnSignals({
        uid: 'u1',
        world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 30, sceneTurns: 14, sceneId: 'c1' } } as unknown as typeof baseWorld,
        logLine: 'still going',
        countsAsTurn: true,
        sceneId: 'c1',
      });
      expect(storyLogOf()?.sceneTurns).toBe(15);
    });

    it('leaves the count alone when the caller does not know the scene', async () => {
      // `undefined` is "don't know", not "no scene" — treating it as a change
      // would zero the day on every commit that omits it.
      await applyTurnSignals({
        uid: 'u1',
        world: { ...baseWorld, storyLog: { chapterNumber: 1, entries: ['a'], turns: 5, sceneTurns: 5, sceneId: 'c1' } } as unknown as typeof baseWorld,
        logLine: 'an unattributed commit',
        countsAsTurn: true,
      });
      expect(storyLogOf()?.sceneTurns).toBe(6);
      expect(storyLogOf()?.sceneId).toBe('c1');
    });
  });
});

/**
 * LIFE-CONTRACT-BUBBLE-4 — the exact line observed on beta 2026-07-21. The
 * event log is what every later turn reads back, so the repair has to happen
 * before persistence, not at render time.
 */
describe('commitNode — narrated lines are repaired before they are persisted', () => {
  beforeEach(() => vi.clearAllMocks());

  const commitBeat = (beat: Record<string, unknown>, npcs: unknown[] = []) =>
    commitNode({
      uid: 'u1',
      world: { ...baseWorld, characterName: 'Jimothée' },
      npcs: npcs as never,
      sceneId: null,
      action: { kind: 'none' },
      beats: [beat as never],
      backdropIntent: null,
    });

  it('fully repairs the beta screenshot: de-wraps AND moves the player’s line to a user bubble', async () => {
    // « Qu’est-ce que c’est que ce projet ? », demandes-tu — the player's own
    // line ("demandes-tu" = "you ask") rendered in Élise's NPC bubble. The
    // attribution names nobody, so the 2nd-person subject is what re-attributes
    // it; de-wrapping alone would leave the player's words in the NPC bubble.
    await commitBeat({
      speaker: 'npc', npcId: 'n-elise', speakerName: 'Élise Laurent',
      practiceText: '« Qu’est-ce que c’est que ce projet ? », demandes-tu.',
      nativeText: '"What is this project?", you ask.',
    }, [{ id: 'n-elise', name: 'Élise Laurent', avatarStatus: 'ready', scope: 'world' }]);

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      practiceText: string; nativeText: string; speaker: string; npcId: string | null;
    };
    expect(beat.practiceText).toBe('Qu’est-ce que c’est que ce projet ?');
    expect(beat.nativeText).toBe('What is this project?');
    expect(beat.speaker).toBe('user');
    expect(beat.npcId).toBeNull();
  });

  it('re-attributes to the player when the attribution names them', async () => {
    await commitBeat({
      speaker: 'npc', npcId: 'n-elise', speakerName: 'Élise Laurent',
      practiceText: '« Je ne comprends pas. », dit Jimothée.',
    }, [{ id: 'n-elise', name: 'Élise Laurent', avatarStatus: 'ready', scope: 'world' }]);

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      speaker: string; npcId: string | null;
    };
    expect(beat.speaker).toBe('user');
    expect(beat.npcId).toBeNull();
  });

  it('leaves a clean utterance completely alone', async () => {
    const clean = 'Tu viens avec moi ?';
    await commitBeat({
      speaker: 'npc', npcId: 'n-elise', speakerName: 'Élise Laurent', practiceText: clean,
    }, [{ id: 'n-elise', name: 'Élise Laurent', avatarStatus: 'ready', scope: 'world' }]);

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      practiceText: string; speaker: string;
    };
    expect(beat.practiceText).toBe(clean);
    expect(beat.speaker).toBe('npc');
  });

  it('does not touch narrator beats — narration is prose by definition', async () => {
    const narration = 'Elle demande : « Tu viens ? »';
    await commitBeat({ speaker: 'narrator', practiceText: narration });
    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as { practiceText: string };
    expect(beat.practiceText).toBe(narration);
  });
});

/**
 * LIFE-CANON-3 — a mute entity's "line" is a described ACTION, so it commits as
 * a narrator beat, not an npc speech bubble. This replaces the old approach of
 * rejecting the option that addressed it (which real-Gemini measurement showed
 * suppressed a legitimate action for no benefit).
 */
describe('commitNode — mute entities are narrated, never bubbled (LIFE-CANON-3)', () => {
  beforeEach(() => vi.clearAllMocks());

  const spiritWorld = {
    ...baseWorld,
    canon: {
      characters: [{ id: 'n-mireille', name: 'Mireille', kind: 'spirit', note: '', canSpeak: false }],
      places: [], objects: [], facts: [],
    },
  } as typeof baseWorld;

  it('converts a mute entity npc-beat into a narrator beat', async () => {
    await commitNode({
      uid: 'u1',
      world: spiritWorld,
      npcs: [{ id: 'n-mireille', name: 'Mireille', avatarStatus: 'ready', scope: 'world' }],
      sceneId: null,
      action: { kind: 'none' },
      // The model tagged a non-verbal action as an npc line.
      beats: [{
        speaker: 'npc', npcId: 'n-mireille', speakerName: 'Mireille',
        practiceText: 'Elle glisse une tasse sur la table.',
      }],
      backdropIntent: null,
    });

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      speaker: string; npcId: string | null; speakerName: string | null;
    };
    expect(beat.speaker).toBe('narrator');
    expect(beat.npcId).toBeNull();
    expect(beat.speakerName).toBeNull();
  });

  it('leaves a speaking NPC alone', async () => {
    await commitNode({
      uid: 'u1',
      world: spiritWorld,
      npcs: [{ id: 'n-sophie', name: 'Sophie', avatarStatus: 'ready', scope: 'world' }],
      sceneId: null,
      action: { kind: 'none' },
      beats: [{ speaker: 'npc', npcId: 'n-sophie', speakerName: 'Sophie', practiceText: 'Bonjour !' }],
      backdropIntent: null,
    });

    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as { speaker: string };
    expect(beat.speaker).toBe('npc');
  });
});

/**
 * LIFE-STORY-LOG-1 — the cap keeps a chapter's FOUNDING facts, not just recent
 * churn. Plain `.slice(-cap)` dropped exactly the load-bearing early lines
 * ("you were given the key"), which the owner flagged.
 */
describe('capStoryLog — retains head + recent, drops the middle', () => {
  it('is a no-op under the cap', () => {
    const short = Array.from({ length: 5 }, (_, i) => `line ${i}`);
    expect(capStoryLog(short)).toEqual(short);
  });

  it('keeps the earliest founding lines AND the most recent', () => {
    const many = Array.from({ length: 200 }, (_, i) => `line ${i}`);
    const capped = capStoryLog(many);
    // WS1-C raised the cap 40→60 (head 6→8), reclaiming the deleted <summary>
    // budget so the middle-drop starts past essentially every real chapter.
    expect(capped.length).toBe(60);
    // Founding facts survive (head 8).
    expect(capped[0]).toBe('line 0');
    expect(capped).toContain('line 7');
    // Most recent survives.
    expect(capped.at(-1)).toBe('line 199');
    // The superseded middle is what gets dropped.
    expect(capped).not.toContain('line 100');
  });
});

describe('commitNode — a beat is attributed to ONE speaker (LIFE-EX-DIR-4)', () => {
  it('LIFE-EX-DIR-4 — a `user` beat carrying NPC attribution is written with it cleared', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      // The "attributed to an npc, or to me — and never the wrong one or both"
      // state: the player's own resolved line still wearing the graded
      // question's NPC labels.
      beats: [{
        speaker: 'user',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Je veux un café.',
        nativeText: 'I want a coffee.',
      }],
    });
    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      speaker: string;
      speakerName?: string | null;
      npcId?: string | null;
    };
    expect(beat.speaker).toBe('user');
    expect(beat.speakerName ?? null).toBeNull();
    expect(beat.npcId ?? null).toBeNull();
  });

  it('LIFE-EX-DIR-4 — a `user` beat never promotes an NPC off its stale labels', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [{
        speaker: 'user',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Je veux un café.',
      }],
    });
    expect(promoteOrTouchNpcMock).not.toHaveBeenCalled();
  });

  it('LIFE-EX-DIR-4 — a narrator beat carrying attribution is written with it cleared', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [{
        speaker: 'narrator',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Le soleil se lève.',
      }],
    });
    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      speakerName?: string | null;
      npcId?: string | null;
    };
    expect(beat.speakerName ?? null).toBeNull();
    expect(beat.npcId ?? null).toBeNull();
  });

  it('LIFE-EX-DIR-4 — an npc beat keeps its attribution untouched', async () => {
    await commitNode({
      uid: 'u1',
      world: baseWorld,
      sceneId: null,
      action: { kind: 'none' },
      beats: [npcBeat],
    });
    const beat = appendBeatEventMock.mock.calls.at(-1)?.[2] as {
      speakerName?: string | null;
      npcId?: string | null;
    };
    expect(beat.speakerName).toBe('Sophie');
    expect(beat.npcId).toBe('sophie');
  });
});
