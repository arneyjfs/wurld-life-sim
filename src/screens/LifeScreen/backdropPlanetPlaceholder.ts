/**
 * LIFE-BACKDROP-16 — the placeholder shown before a wurld has EVER rendered
 * a real backdrop.
 *
 * It replaces what used to sit there: the `apartment_bedroom` silhouette
 * from the fallback library plus a location ribbon reading "Your apartment
 * · morning". Both were guesses seeded from the world chip — the world has
 * no backdrop, no location and no time of day at that point, and the first
 * beat's `backdropIntent` routinely contradicts them. A planet says the only
 * true thing available (a world is being formed) without committing to a
 * genre.
 *
 * Deliberately VAGUE: a soft disc, an atmosphere ring, amorphous surface
 * blobs, a slow drifting band, a few stars. No continents, no landmarks,
 * no architecture — nothing that reads as Earth or as any particular
 * setting.
 *
 * Hand-authored inline, never fetched / generated / base64'd. Two
 * constraints that are easy to get wrong:
 *   - Theme-awareness goes through `style="fill:var(--color-…)"`, NOT
 *     presentation attributes. `fill="var(--x)"` as an ATTRIBUTE does not
 *     resolve — only CSS declarations take `var()`.
 *   - No `<rect class="bleed">`, so `backdropBleedColor` returns null and the
 *     surround stays `--color-bg` in both themes (LIFE-BACKDROP-12). A hex
 *     bleed plate would pin the letterbox to one theme.
 *
 * Ids are prefixed `wurldPlanet…` so they cannot collide with a generated
 * backdrop's during the LIFE-BACKDROP-15 cross-fade.
 *
 * Spec: docs/specs/life-sim.md — LIFE-BACKDROP-16.
 */
export const PLANET_PLACEHOLDER_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" data-wurld-backdrop="planet">' +
  '<defs>' +
  '<radialGradient id="wurldPlanetGlow" cx="0.5" cy="0.5" r="0.5">' +
  '<stop offset="0.5" style="stop-color:var(--color-accent);stop-opacity:0.18"/>' +
  '<stop offset="1" style="stop-color:var(--color-accent);stop-opacity:0"/>' +
  '</radialGradient>' +
  '<radialGradient id="wurldPlanetBody" cx="0.36" cy="0.3" r="0.9">' +
  '<stop offset="0" style="stop-color:var(--color-fg-subtle);stop-opacity:0.42"/>' +
  '<stop offset="0.6" style="stop-color:var(--color-fg-muted);stop-opacity:0.34"/>' +
  '<stop offset="1" style="stop-color:var(--color-fg);stop-opacity:0.28"/>' +
  '</radialGradient>' +
  '<clipPath id="wurldPlanetClip"><circle cx="500" cy="520" r="250"/></clipPath>' +
  '</defs>' +
  '<rect width="1000" height="1000" style="fill:var(--color-bg)"/>' +
  '<g style="fill:var(--color-fg-subtle)">' +
  '<circle cx="168" cy="196" r="5" opacity="0.4">' +
  '<animate attributeName="opacity" values="0.15;0.55;0.15" dur="6s" repeatCount="indefinite"/>' +
  '</circle>' +
  '<circle cx="812" cy="238" r="4" opacity="0.4">' +
  '<animate attributeName="opacity" values="0.5;0.12;0.5" dur="7.5s" repeatCount="indefinite"/>' +
  '</circle>' +
  '<circle cx="694" cy="122" r="3" opacity="0.3"/>' +
  '<circle cx="262" cy="828" r="4" opacity="0.28"/>' +
  '<circle cx="876" cy="742" r="3" opacity="0.32"/>' +
  '<circle cx="112" cy="596" r="3" opacity="0.26"/>' +
  '</g>' +
  '<circle cx="500" cy="520" r="430" fill="url(#wurldPlanetGlow)"/>' +
  '<circle cx="500" cy="520" r="250" fill="url(#wurldPlanetBody)"/>' +
  '<g clip-path="url(#wurldPlanetClip)" style="fill:var(--color-fg-muted)" opacity="0.2">' +
  '<ellipse cx="424" cy="446" rx="146" ry="60"/>' +
  '<ellipse cx="612" cy="596" rx="118" ry="46"/>' +
  '<ellipse cx="466" cy="676" rx="88" ry="32"/>' +
  '</g>' +
  '<g clip-path="url(#wurldPlanetClip)" style="fill:var(--color-bg)" opacity="0.18">' +
  '<ellipse cx="500" cy="512" rx="270" ry="34">' +
  '<animateTransform attributeName="transform" type="translate" values="-150 0;150 0;-150 0" dur="22s" repeatCount="indefinite"/>' +
  '</ellipse>' +
  '</g>' +
  '<circle cx="500" cy="520" r="252" fill="none" style="stroke:var(--color-accent);stroke-opacity:0.28" stroke-width="3"/>' +
  '</svg>';
