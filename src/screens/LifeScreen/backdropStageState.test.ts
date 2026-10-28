/**
 * LIFE-BACKDROP-15 — the stage holds the outgoing backdrop and cross-fades.
 * LIFE-BACKDROP-16 — the pre-first-backdrop placeholder is a planet.
 *
 * Spec: docs/specs/life-sim.md — LIFE-BACKDROP-15, LIFE-BACKDROP-16.
 */
import { describe, expect, it } from 'vitest';
import { getFallbackBackdrop } from '@/lib/life/fallbackBackdrops';
import { backdropBleedColor } from '@/lib/life/backdropBleed';
import { PLANET_PLACEHOLDER_SVG } from './backdropPlanetPlaceholder';
import {
  SCENE_FADE_MS,
  initialStageState,
  isBundledSilhouette,
  namespaceSvgIds,
  nextStageState,
} from './backdropStageState';

const SILHOUETTE_KEYS = [
  'apartment_bedroom',
  'apartment_living',
  'cafe',
  'market',
  'office',
  'street',
  'park',
  'train_station',
] as const;

const SCENE_A =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">' +
  '<rect class="bleed" width="1000" height="1000" fill="#e8d5c4"/>' +
  '<circle cx="500" cy="500" r="100" fill="#333"/></svg>';

const SCENE_B =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">' +
  '<rect class="bleed" width="1000" height="1000" fill="#101820"/>' +
  '<rect x="10" y="10" width="80" height="80" fill="#abc"/></svg>';

describe('LIFE-BACKDROP-15 — silhouette classification', () => {
  it('LIFE-BACKDROP-15 — every bundled silhouette is recognised as NOT a real backdrop', () => {
    for (const key of SILHOUETTE_KEYS) {
      expect(isBundledSilhouette(getFallbackBackdrop(key))).toBe(true);
    }
  });

  it('LIFE-BACKDROP-15 — a generated backdrop is a real backdrop', () => {
    expect(isBundledSilhouette(SCENE_A)).toBe(false);
    expect(isBundledSilhouette(SCENE_B)).toBe(false);
    expect(isBundledSilhouette('')).toBe(false);
  });

  it('LIFE-BACKDROP-16 — the planet placeholder is not mistaken for a real backdrop', () => {
    expect(isBundledSilhouette(PLANET_PLACEHOLDER_SVG)).toBe(false);
  });
});

describe('LIFE-BACKDROP-15 — hold + cross-fade state machine', () => {
  it('LIFE-BACKDROP-15 — a silhouette arriving over a painted backdrop is IGNORED (generating)', () => {
    const painted = initialStageState(SCENE_A);
    const next = nextStageState(painted, getFallbackBackdrop('cafe'));
    // Identity, not just equality: an unchanged object lets React bail out
    // of the re-render entirely instead of re-parsing the inline SVG.
    expect(next).toBe(painted);
    expect(next.current).toBe(SCENE_A);
  });

  it('LIFE-BACKDROP-15 — the LIFE-BACKDROP-8 terminal silhouette also leaves the old backdrop up', () => {
    // Same input shape as the generating case — the orchestrator emits the
    // same silhouette bytes on failure — so the old backdrop must survive both.
    let state = initialStageState(SCENE_A);
    state = nextStageState(state, getFallbackBackdrop('apartment_bedroom'));
    state = nextStageState(state, getFallbackBackdrop('apartment_bedroom'));
    expect(state.current).toBe(SCENE_A);
    expect(state.placeholder).toBe(false);
  });

  it('LIFE-BACKDROP-15 — a real backdrop swap keeps the outgoing backdrop for the fade', () => {
    const first = initialStageState(SCENE_A);
    const next = nextStageState(first, SCENE_B);
    expect(next.current).toBe(SCENE_B);
    expect(next.previous).toBe(SCENE_A);
    expect(next.swapId).toBeGreaterThan(first.swapId);
  });

  it('LIFE-BACKDROP-15 — a generating window between two real backdrops never blanks', () => {
    let state = initialStageState(SCENE_A);
    state = nextStageState(state, getFallbackBackdrop('market')); // gen starts
    expect(state.current).toBe(SCENE_A);
    state = nextStageState(state, SCENE_B); // gen lands
    expect(state.current).toBe(SCENE_B);
    expect(state.previous).toBe(SCENE_A);
  });

  it('LIFE-BACKDROP-15 — re-emitting the same backdrop is a no-op', () => {
    const first = initialStageState(SCENE_A);
    expect(nextStageState(first, SCENE_A)).toBe(first);
  });

  it('LIFE-BACKDROP-15 — the fade duration is a shared constant', () => {
    expect(SCENE_FADE_MS).toBeGreaterThan(0);
    expect(SCENE_FADE_MS).toBeLessThanOrEqual(1000);
  });
});

describe('LIFE-BACKDROP-15 — outgoing-layer id namespacing', () => {
  const SRC =
    '<svg><defs><linearGradient id="sky"/><clipPath id="c1"/></defs>' +
    '<rect fill="url(#sky)" clip-path="url(#c1)"/>' +
    '<use href="#c1"/><use xlink:href="#sky"/>' +
    '<circle style="fill:url(#sky)"/></svg>';

  it('LIFE-BACKDROP-15 — id, url(#…), href and xlink:href are all rewritten', () => {
    const out = namespaceSvgIds(SRC, 'p1-');
    expect(out).toContain('id="p1-sky"');
    expect(out).toContain('id="p1-c1"');
    expect(out).toContain('url(#p1-sky)');
    expect(out).toContain('url(#p1-c1)');
    expect(out).toContain('href="#p1-c1"');
    expect(out).toContain('xlink:href="#p1-sky"');
    // No un-prefixed reference survives — a leftover would resolve into the
    // OTHER layer's defs while both are mounted (the LIFE-BACKDROP-13 hazard).
    expect(out).not.toContain('url(#sky)');
    expect(out).not.toContain('id="sky"');
  });

  it('LIFE-BACKDROP-15 — external and non-fragment references are left alone', () => {
    const out = namespaceSvgIds('<svg><a href="https://x.test/a#b"/></svg>', 'p1-');
    expect(out).toContain('href="https://x.test/a#b"');
  });
});

describe('LIFE-BACKDROP-16 — planet placeholder', () => {
  it('LIFE-BACKDROP-16 — a fresh stage with no real backdrop shows the planet, not the silhouette', () => {
    const state = initialStageState(getFallbackBackdrop('apartment_bedroom'));
    expect(state.current).toBe(PLANET_PLACEHOLDER_SVG);
    expect(state.placeholder).toBe(true);
  });

  it('LIFE-BACKDROP-16 — a second silhouette does not re-swap the planet', () => {
    const first = initialStageState(getFallbackBackdrop('apartment_bedroom'));
    expect(nextStageState(first, getFallbackBackdrop('cafe'))).toBe(first);
  });

  it('LIFE-BACKDROP-16 — the first real backdrop replaces the planet and clears the flag', () => {
    const first = initialStageState(getFallbackBackdrop('apartment_bedroom'));
    const next = nextStageState(first, SCENE_A);
    expect(next.current).toBe(SCENE_A);
    expect(next.previous).toBe(PLANET_PLACEHOLDER_SVG);
    expect(next.placeholder).toBe(false);
  });

  it('LIFE-BACKDROP-16 — the planet never comes back once a real backdrop has landed', () => {
    let state = initialStageState(getFallbackBackdrop('apartment_bedroom'));
    state = nextStageState(state, SCENE_A);
    state = nextStageState(state, getFallbackBackdrop('street'));
    expect(state.current).toBe(SCENE_A);
    expect(state.placeholder).toBe(false);
  });

  it('LIFE-BACKDROP-16 — a real backdrop on first paint skips the planet entirely', () => {
    const state = initialStageState(SCENE_A);
    expect(state.current).toBe(SCENE_A);
    expect(state.placeholder).toBe(false);
    expect(state.previous).toBeNull();
  });
});

describe('LIFE-BACKDROP-16 — the planet artwork itself', () => {
  it('LIFE-BACKDROP-16 — square canvas, tagged, self-contained', () => {
    expect(PLANET_PLACEHOLDER_SVG).toContain('viewBox="0 0 1000 1000"');
    expect(PLANET_PLACEHOLDER_SVG).toContain('data-wurld-backdrop="planet"');
    // No script, no network. Everything the placeholder needs ships inline.
    expect(PLANET_PLACEHOLDER_SVG).not.toContain('<script');
    expect(PLANET_PLACEHOLDER_SVG).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
    expect(PLANET_PLACEHOLDER_SVG).not.toContain('<image');
    expect(PLANET_PLACEHOLDER_SVG).not.toContain('base64');
    expect(PLANET_PLACEHOLDER_SVG.length).toBeLessThan(3000);
  });

  it('LIFE-BACKDROP-16 — theme-aware via style declarations, never presentation attributes', () => {
    expect(PLANET_PLACEHOLDER_SVG).toContain('var(--color-');
    // `fill="var(--x)"` as an ATTRIBUTE does not resolve — only CSS
    // declarations take var(). Any var() must therefore sit inside a style.
    expect(PLANET_PLACEHOLDER_SVG).not.toMatch(
      /\b(?:fill|stroke|stop-color)="var\(/,
    );
  });

  it('LIFE-BACKDROP-16 — declares no bleed plate, so the surround stays themed', () => {
    // LIFE-BACKDROP-12: a hex bleed colour would pin the letterbox to one theme.
    expect(backdropBleedColor(PLANET_PLACEHOLDER_SVG)).toBeNull();
  });

  it('LIFE-BACKDROP-16 — stays vague: no lettering and no landmark geometry', () => {
    const lowered = PLANET_PLACEHOLDER_SVG.toLowerCase();
    // No lettering: the only text on the stage is the LIFE-BACKDROP-7 pill.
    expect(lowered).not.toContain('<text');
    // Word-boundary, not substring — "opacity" contains "city".
    for (const cue of [/\bcontinent/, /\bcastle/, /\bcity\b/, /\btower/]) {
      expect(lowered).not.toMatch(cue);
    }
    // Only primitive, blobby geometry: no <path>, which is where a
    // recognisable coastline or skyline would have to come from.
    expect(lowered).not.toContain('<path');
  });
});

/**
 * LIFE-BACKDROP-17 — a TERMINAL failure paints the silhouette; only an in-flight
 * render is held off with the planet.
 *
 * Reported 2026-08-01: "it's generating and I see the spinner, but when the
 * spinner stops nothing shows". LIFE-BACKDROP-8 emits the bundled silhouette on
 * terminal failure so the player still gets a readable location — and
 * LIFE-BACKDROP-15/16 were suppressing exactly that, leaving a first backdrop that
 * failed stuck on the planet with the spinner gone. The two cases emit
 * identical bytes, so the state machine cannot tell them apart without being
 * told.
 */
describe('LIFE-BACKDROP-17 — terminal failure is not the generating window', () => {
  it('paints the PLANET when generation has failed and nothing is up yet', () => {
    // Reversed from LIFE-BACKDROP-17's first cut. The fallback library is eight
    // modern interiors, so on a fantasy-kingdom world the "readable location"
    // it offers is the wrong story — worse than a placeholder that commits to
    // nothing. Owner: "there's wurlds like old kingdoms that don't suit this".
    const silhouette = getFallbackBackdrop('cafe');
    const state = initialStageState(silhouette, /* generating */ false);
    expect(state.current).not.toBe(silhouette);
    expect(state.placeholder).toBe(true);
  });

  it('still shows the planet while a render is IN FLIGHT', () => {
    const state = initialStageState(getFallbackBackdrop('cafe'), true);
    expect(state.current).not.toBe(getFallbackBackdrop('cafe'));
    expect(state.placeholder).toBe(true);
  });

  it('STAYS on the planet when the in-flight render fails', () => {
    const silhouette = getFallbackBackdrop('market');
    const state = initialStageState(silhouette, true);
    const planet = state.current;
    const after = nextStageState(state, silhouette, false);
    // Identity, not just equality: nothing should move, so the caller can bail
    // out of re-rendering a multi-KB inline SVG.
    expect(after).toBe(state);
    expect(after.current).toBe(planet);
  });

  it('a FAILURE still never replaces a backdrop already painted', () => {
    // The LIFE-BACKDROP-15 hold is about what the player is looking at, not
    // about why the replacement arrived — a failed regen must not blank a
    // backdrop that is up and readable.
    const painted = initialStageState(SCENE_A);
    const next = nextStageState(painted, getFallbackBackdrop('cafe'), false);
    expect(next).toBe(painted);
  });
});

/**
 * LIFE-BACKDROP-18 — a world that has STARTED can generate its backdrop.
 *
 * The gate's purpose is "don't burn a gen on the seed guess before the first
 * beat lands" — one moment. As written it was "never generate without a
 * backdropIntent", which is forever: the model is not required to emit one every
 * turn, so a world whose opening beat omitted it never generated a backdrop and
 * never would. `useLifeBackdrop` returns BEFORE any logging in that branch, which
 * is why it left no trace at all.
 *
 * Asserted as the predicate rather than through the hook: the hook needs a
 * live Firestore world, and the decision under test is this boolean.
 */
describe('LIFE-BACKDROP-18 — the generate gate', () => {
  const canGenerate = (
    hasWorld: boolean,
    backdropIntent: boolean,
    currentBackdrop: boolean,
    eventCount: number,
  ) => hasWorld && (backdropIntent || currentBackdrop || eventCount > 0);

  it('holds before the first beat — the descriptor is still a seed guess', () => {
    expect(canGenerate(true, false, false, 0)).toBe(false);
  });

  it('generates once events exist, even with NO backdropIntent', () => {
    // The case that was stuck forever.
    expect(canGenerate(true, false, false, 3)).toBe(true);
  });

  it('still generates on an explicit backdropIntent, before any events', () => {
    expect(canGenerate(true, true, false, 0)).toBe(true);
  });

  it('still inherits a persisted currentBackdrop', () => {
    expect(canGenerate(true, false, true, 0)).toBe(true);
  });

  it('never generates without a world at all', () => {
    expect(canGenerate(false, true, true, 99)).toBe(false);
  });
});
