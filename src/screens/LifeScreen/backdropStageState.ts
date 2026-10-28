/**
 * LIFE-BACKDROP-15 / LIFE-BACKDROP-16 — what `BackdropStage` actually paints.
 *
 * `useLifeBackdrop` answers "what is the resolved SVG for THIS descriptor",
 * and while a render is in flight that answer is the bundled fallback
 * silhouette. Painting it verbatim is the blank-out the player sees: their
 * backdrop vanishes for the 3-8s a Gemini SVG takes, then a different picture
 * appears.
 *
 * This module holds the separate, presentational question — what belongs on
 * screen right now — as a pure state machine so it can be asserted without
 * a DOM. Two rules:
 *
 *   1. A bundled silhouette NEVER replaces a backdrop that is already painted
 *      (LIFE-BACKDROP-15). That covers the generating window AND the
 *      LIFE-BACKDROP-8 terminal-failure path, which emit the same bytes: on
 *      failure the old backdrop simply stays, and the shimmer removes itself
 *      because `backdropBuildingVisible` is already false there.
 *   2. Before any real backdrop has been painted, the placeholder is the
 *      planet, not a location silhouette (LIFE-BACKDROP-16).
 *
 * Classification is an EXACT match against the shipped fallback library,
 * never a heuristic. A fuzzy test ("looks like a fallback") would eventually
 * hold a real backdrop off-screen forever — the one failure mode worse than
 * blanking. Only generator output is ever written to the backdrop cache, so a
 * real backdrop cannot collide with a library entry.
 *
 * Spec: docs/specs/life-sim.md — LIFE-BACKDROP-15, LIFE-BACKDROP-16.
 */
import {
  getFallbackBackdrop,
  type FallbackBackdropKey,
} from '@/lib/life/fallbackBackdrops';
import { PLANET_PLACEHOLDER_SVG } from './backdropPlanetPlaceholder';

/**
 * How long the outgoing backdrop is kept mounted after a swap. Deliberately
 * LONGER than the `.life-backdrop-fade-in` CSS animation in `globals.css`
 * (360ms) so the incoming layer has reached full opacity before the layer
 * underneath is torn out — otherwise the last frame of the fade shows the
 * stage background through the half-transparent new backdrop.
 *
 * It is also the window during which TWO inline SVGs are in the DOM, which
 * is why the outgoing copy's ids are namespaced (see `namespaceSvgIds`).
 */
export const SCENE_FADE_MS = 420;

const FALLBACK_KEYS: readonly FallbackBackdropKey[] = [
  'apartment_bedroom',
  'apartment_living',
  'cafe',
  'market',
  'office',
  'street',
  'park',
  'train_station',
];

/** Built once: the exact bytes of every silhouette the bundle ships. */
const SILHOUETTES: ReadonlySet<string> = new Set(
  FALLBACK_KEYS.map((k) => getFallbackBackdrop(k)),
);

/**
 * True when `svg` is one of the bundled fallback silhouettes — i.e. the
 * orchestrator's "no real backdrop right now" value, not a drawing of where
 * the player is.
 */
export function isBundledSilhouette(svg: string): boolean {
  return svg.length > 0 && SILHOUETTES.has(svg);
}

/* `id="x"` / `url(#x)` / `href="#x"`. Each requires the preceding
   whitespace so `data-backdrop-id="…"` is not mistaken for an id attribute.
   Written without lookbehind on purpose — Safari only gained it in 16.4
   and this ships inside a WebView. */
const ID_ATTR = /(\s)id=(["'])([^"']*)\2/g;
const URL_REF = /url\(\s*#([^)\s"']+)\s*\)/g;
const HREF_REF = /(\s)(xlink:href|href)=(["'])#([^"']*)\3/g;

/**
 * Prefix every id + internal reference in `svg`.
 *
 * During a cross-fade two inline SVGs are mounted at once, and `url(#id)`
 * resolves document-wide against the FIRST matching element — the exact
 * id-collision hazard recorded in LIFE-BACKDROP-13. Applied to the OUTGOING
 * copy only: the incoming backdrop is the one that persists, so it must never
 * depend on a transform having been applied correctly.
 *
 * External references (`href="https://…#frag"`) are left alone — only
 * pure-fragment references point inside this document.
 */
export function namespaceSvgIds(svg: string, prefix: string): string {
  return svg
    .replace(ID_ATTR, (_m, ws: string, q: string, id: string) =>
      `${ws}id=${q}${prefix}${id}${q}`)
    .replace(URL_REF, (_m, id: string) => `url(#${prefix}${id})`)
    .replace(HREF_REF, (_m, ws: string, attr: string, q: string, id: string) =>
      `${ws}${attr}=${q}#${prefix}${id}${q}`);
}

export type BackdropStageState = {
  /** The SVG painted on top — the backdrop the player is looking at. */
  current: string;
  /** The backdrop being faded OUT, kept mounted underneath for `SCENE_FADE_MS`.
   *  Null when there is nothing to cross-fade from. */
  previous: string | null;
  /** True while `current` is the LIFE-BACKDROP-16 planet, i.e. this wurld has
   *  never painted a real backdrop. Also suppresses the location ribbon. */
  placeholder: boolean;
  /** Bumped on every visual swap. Re-keys the layers so the CSS fade
   *  restarts, and namespaces the outgoing copy's ids uniquely. */
  swapId: number;
};

const EMPTY: BackdropStageState = {
  current: '',
  previous: null,
  placeholder: true,
  swapId: 0,
};

/**
 * Fold one incoming `svg` from `useLifeBackdrop` into what should be painted.
 * Returns `prev` UNCHANGED (by identity) when nothing should move, so the
 * caller can bail out of re-rendering — re-parsing a multi-KB inline SVG on
 * every unrelated snapshot is exactly what `BackdropStage`'s memo exists to
 * avoid.
 */
export function nextStageState(
  prev: BackdropStageState,
  incoming: string,
  /**
   * LIFE-BACKDROP-17 — is a render actually IN FLIGHT?
   *
   * The generating window and the LIFE-BACKDROP-8 terminal failure emit the
   * SAME bytes (the bundled silhouette), so the bytes cannot tell them
   * apart and this module was treating both as "nothing to paint yet".
   * That is right mid-generation and wrong on failure: LIFE-BACKDROP-8 exists
   * precisely so a world that cannot render a backdrop still shows the
   * location silhouette. Suppressing it left a FIRST backdrop that failed
   * stuck on the LIFE-BACKDROP-16 planet with no spinner — reported
   * 2026-08-01 as "the spinner stops and nothing shows".
   *
   * Defaults true so an un-updated caller keeps the old hold-the-stage
   * behaviour rather than flashing a silhouette over a live backdrop.
   */
  generating = true,
): BackdropStageState {
  const real = incoming.length > 0 && !isBundledSilhouette(incoming);
  if (real) {
    if (incoming === prev.current) return prev;
    return {
      current: incoming,
      previous: prev.current || null,
      placeholder: false,
      swapId: prev.swapId + 1,
    };
  }
  // Not a real backdrop. Never allowed to take the stage from a backdrop that is
  // already painted — that hold is the whole of LIFE-BACKDROP-15 and it applies
  // whether a render is in flight or has just failed.
  if (!prev.placeholder) return prev;

  // Nothing painted yet -> the PLANET, whether a render is in flight or has
  // failed for good.
  //
  // LIFE-BACKDROP-17 briefly sent the terminal-failure case to the bundled
  // silhouette instead, reasoning that a readable location beats a placeholder.
  // That reasoning ignores what the library actually contains: eight MODERN
  // interiors — an apartment, a cafe, an office, a train station. On a world
  // that is a fantasy kingdom, that is not a fallback, it is the wrong story,
  // and the player is told their backdrop failed by being shown somebody else's
  // (owner, 2026-08-01: "there's wurlds like old kingdoms that don't suit
  // this"). The planet commits to nothing, which is exactly right when we have
  // nothing to say — that is why LIFE-BACKDROP-16 introduced it.
  //
  // `generating` is kept in the signature: the caller has it, it costs nothing,
  // and the moment there is a genre-aware fallback library this is where the
  // two cases separate again.
  void generating;
  if (prev.current === PLANET_PLACEHOLDER_SVG) return prev;
  return {
    current: PLANET_PLACEHOLDER_SVG,
    previous: null,
    placeholder: true,
    swapId: prev.swapId + 1,
  };
}

/** First paint. A real backdrop shows immediately (no fade from nothing); a
 *  silhouette becomes the planet. */
export function initialStageState(svg: string, generating = true): BackdropStageState {
  return nextStageState(EMPTY, svg, generating);
}
