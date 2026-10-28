import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/life/generateStepOptions', () => ({
  generateStepOptions: vi.fn(),
}));

import { generateStepOptions } from '@/lib/life/generateStepOptions';
import { createOpeningPrefetch } from './nodeEngineOpening';
import type { EngineDeps } from './nodeEngineTypes';
import type { BackdropIntent } from '@/lib/life/stepSchema';

/**
 * LIFE-BACKDROP-21 — the opening turn starts behind the intro card, so the first
 * scene is generated from a REAL backdropIntent.
 *
 * Before this, the scene came from `fallbackDescriptor` (a seed guess) and was
 * discarded the moment the opening beat's actual intent arrived — the owner
 * saw `apartment_bedroom`/`noir_city` render behind the intro and then be
 * replaced by `office`/`dark_noir`.
 */
const genMock = vi.mocked(generateStepOptions);

const INTENT: BackdropIntent = {
  locationType: 'office',
  vibe: 'dark_noir',
  persistent: true,
} as BackdropIntent;

function makeDeps(over: { world?: unknown; uid?: string | null } = {}) {
  const onBackdropIntent = vi.fn();
  const deps = {
    propsRef: {
      current: {
        uid: 'uid' in over ? over.uid : 'u1',
        world: 'world' in over ? over.world : { id: 'w1' },
        scene: null,
        npcs: [],
        events: [],
        onBackdropIntent,
        appendBubbles: vi.fn(),
        onSceneResolved: vi.fn(),
        onError: vi.fn(),
      },
    },
    nonceRef: { current: 3 },
    openingPrefetchRef: { current: null },
  } as unknown as EngineDeps;
  return { deps, onBackdropIntent };
}

const okResult = (backdropIntent: BackdropIntent | null) =>
  ({ kind: 'ok', nonce: 3, node: { kind: 'branch', backdropIntent } }) as never;

describe('LIFE-BACKDROP-21 — createOpeningPrefetch', () => {
  // Call counts are per-test; without this the idempotence check would be
  // counting the whole file's calls.
  beforeEach(() => genMock.mockClear());

  it('publishes the opening beat’s backdropIntent WITHOUT arriving at the node', async () => {
    genMock.mockResolvedValueOnce(okResult(INTENT));
    const { deps, onBackdropIntent } = makeDeps();
    createOpeningPrefetch({ deps, currentEvents: () => [] })();
    await deps.openingPrefetchRef.current;
    await Promise.resolve();
    expect(onBackdropIntent).toHaveBeenCalledWith(INTENT);
    // No bubbles: this starts the turn, it does not play it. The beats must
    // still glide in when the player taps Begin.
    expect(deps.propsRef.current.appendBubbles).not.toHaveBeenCalled();
  });

  it('stores the promise so Begin can arrive from cache instead of re-calling', async () => {
    genMock.mockResolvedValueOnce(okResult(INTENT));
    const { deps } = makeDeps();
    createOpeningPrefetch({ deps, currentEvents: () => [] })();
    expect(deps.openingPrefetchRef.current).not.toBeNull();
    await deps.openingPrefetchRef.current;
  });

  it('is idempotent — a re-render must not buy a second opening turn', async () => {
    genMock.mockResolvedValueOnce(okResult(INTENT));
    const { deps } = makeDeps();
    const prefetch = createOpeningPrefetch({ deps, currentEvents: () => [] });
    prefetch();
    prefetch();
    prefetch();
    expect(genMock).toHaveBeenCalledTimes(1);
    await deps.openingPrefetchRef.current;
  });

  it('publishes nothing when the opening node carries no backdropIntent', async () => {
    // LIFE-BACKDROP-18's case: the model is not required to emit one. The
    // events-landed arm of `canGenerateBackdrop` is what covers this, so
    // publishing a null here would be a lie about what the turn said.
    genMock.mockResolvedValueOnce(okResult(null));
    const { deps, onBackdropIntent } = makeDeps();
    createOpeningPrefetch({ deps, currentEvents: () => [] })();
    await deps.openingPrefetchRef.current;
    await Promise.resolve();
    expect(onBackdropIntent).not.toHaveBeenCalled();
  });

  it('swallows a failed prefetch — startOpening owns the error path', async () => {
    // The same promise is handed to `runLiveTurn`, which renders
    // `options-failed` / the Continue ladder. Reporting here would surface one
    // failure twice, and an unhandled rejection would surface it as a crash.
    genMock.mockRejectedValueOnce(new Error('boom'));
    const { deps, onBackdropIntent } = makeDeps();
    createOpeningPrefetch({ deps, currentEvents: () => [] })();
    await expect(deps.openingPrefetchRef.current).rejects.toThrow('boom');
    expect(onBackdropIntent).not.toHaveBeenCalled();
  });

  it('does nothing without a uid or a world', () => {
    const a = makeDeps({ uid: null });
    createOpeningPrefetch({ deps: a.deps, currentEvents: () => [] })();
    const b = makeDeps({ world: null });
    createOpeningPrefetch({ deps: b.deps, currentEvents: () => [] })();
    expect(genMock).not.toHaveBeenCalled();
  });
});
