/**
 * LIFE-NPC avatar PART LIBRARY (prototype) — v2.
 *
 * A parameterised set of flat, friendly SVG parts on a shared 200×200 anatomy,
 * so the model can pick a combination (tiny JSON) and the client ASSEMBLES the
 * portrait — ~8× cheaper output than drawing full SVG, artist-consistent, and
 * unbreakable. Each slot has many options; when nothing fits, the caller falls
 * back to the lean direct-SVG draw.
 *
 * v2 fixes the "clip-art" problems of v1:
 *   • HAIR and HEADWEAR now return {back, front} so hair FRAMES the face
 *     (volume behind the head, hairline + side locks in front) and hoods sit
 *     behind the head instead of on top of it.
 *   • Hats WRAP the cranium (dome that follows the skull + curved brim + band)
 *     rather than floating as a lid sliced flat.
 *   • Facial hair wraps the jaw and connects to the sideburns.
 *   • Outfits have a real neckline/collar over a shoulder slope.
 */

// Shared anatomy (keep parts aligned).
export const A = {
  cx: 100,
  faceCy: 90, faceRx: 40, faceRy: 44,
  faceTop: 46, faceBottom: 134,
  eyeY: 90, eyeDx: 18, // eyes at cx±18
  browY: 73,
  noseY: 100,
  mouthY: 113,
  earY: 92,
  hatBaseY: 60, // where a hat band/brim crosses the head
  shoulderY: 152,
};

const el = (cx, cy, rx, ry, fill, extra = '') =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${extra}/>`;
const rct = (x, y, w, h, r, fill) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;
const path = (d, fill, extra = '') => `<path d="${d}" fill="${fill}"${extra}/>`;
const stroke = (d, color, w, extra = '') =>
  `<path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"${extra}/>`;

// Slightly darken (or lighten, f>1) a hex colour for shading.
export function shade(hex, f = 0.82) {
  const n = String(hex).replace('#', '');
  const s = n.length === 3 ? n.split('').map((c) => c + c).join('') : n;
  const ch = (i) => Math.max(0, Math.min(255, Math.round(parseInt(s.slice(i, i + 2), 16) * f)));
  return `#${[ch(0), ch(2), ch(4)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

// ── Background ─────────────────────────────────────────────────────────────
export function bg(color) {
  return `<rect width="200" height="200" fill="${color}"/>`;
}

// ── Skin base: neck (blended to shoulders), face (soft form), ears, nose ───
export function faceBase(skin) {
  const sh = shade(skin, 0.88); // form shadow
  return [
    // Neck — trapezoid that widens into the shoulders (no notch), shaded under chin.
    path(`M ${A.cx - 12} 124 L ${A.cx + 12} 124 L ${A.cx + 17} 152 L ${A.cx - 17} 152 Z`, skin),
    path(`M ${A.cx - 12} 124 q 12 9 24 0 l 1 8 q -13 8 -26 0 z`, sh), // shadow under jaw
    // Ears with inner shade.
    el(A.cx - 38, A.earY + 2, 7, 9, skin) + el(A.cx - 38, A.earY + 2, 3, 4.5, sh),
    el(A.cx + 38, A.earY + 2, 7, 9, skin) + el(A.cx + 38, A.earY + 2, 3, 4.5, sh),
    // Head — rounded cranium tapering to a soft chin. Spans faceTop→faceBottom
    // and OVERLAPS the neck top, so there is no gap for background/hair to show
    // through (the old path stopped ~y=102, leaving the mouth floating in a gap
    // which read as a beard).
    path(`M ${A.cx - A.faceRx} ${A.faceCy} C ${A.cx - A.faceRx} ${A.faceTop + 1}, ${A.cx + A.faceRx} ${A.faceTop + 1}, ${A.cx + A.faceRx} ${A.faceCy} C ${A.cx + A.faceRx} ${A.faceBottom - 16}, ${A.cx + 26} ${A.faceBottom}, ${A.cx} ${A.faceBottom} C ${A.cx - 26} ${A.faceBottom}, ${A.cx - A.faceRx} ${A.faceBottom - 16}, ${A.cx - A.faceRx} ${A.faceCy} Z`, skin),
    // Gentle form shadow down the right cheek.
    `<path d="M ${A.cx + 22} ${A.faceTop + 10} q 20 22 -2 ${A.faceRy * 1.5}" fill="${sh}" opacity="0.22"/>`,
    // Soft nose — a small shaded curve, not a dark blob.
    stroke(`M ${A.cx - 2} ${A.noseY - 2} q 3 5 5 0`, sh, 2.2),
    // Cheek blush — wide + very soft, so it reads as warmth not rouge.
    el(A.cx - 24, A.mouthY - 6, 9, 5, '#f19a8e', ' opacity="0.22"'),
    el(A.cx + 24, A.mouthY - 6, 9, 5, '#f19a8e', ' opacity="0.22"'),
  ].join('');
}

// ── Eyes ───────────────────────────────────────────────────────────────────
const eye = (cx, cy, kind) => {
  const iris = (r = 3) => el(cx, cy, r, r + 0.4, '#2b2620') + el(cx - 1, cy - 1.2, 1, 1.2, '#fff');
  switch (kind) {
    case 'dot': return el(cx, cy, 3.5, 3.5, '#3a3128');
    // Half-lidded: a heavy lash line over a shortened eye (no skin-coloured
    // lid rect — that hardcoded a tone and broke on other skins).
    case 'sleepy': return el(cx, cy + 1, 5.5, 3.6, '#fff') + iris(2.7) + stroke(`M ${cx - 6} ${cy - 2} q 6 2 12 0`, '#3a3128', 2.4);
    case 'wide': return el(cx, cy, 5.8, 6.8, '#fff') + iris(3.3);
    case 'happy': return stroke(`M ${cx - 6} ${cy + 2} q 6 -7 12 0`, '#3a3128', 2.6);
    case 'squint': return stroke(`M ${cx - 6} ${cy} q 6 3.5 12 0`, '#3a3128', 2.6);
    case 'sparkle': return el(cx, cy, 5.8, 6, '#fff') + iris(3.2) + el(cx + 2, cy + 2, 0.9, 0.9, '#fff');
    default: return el(cx, cy, 5.5, 5, '#fff') + iris(3);
  }
};
const bothEyes = (k) => eye(A.cx - A.eyeDx, A.eyeY, k) + eye(A.cx + A.eyeDx, A.eyeY, k);
export const EYES = {
  almond: () => bothEyes('almond'),
  wide: () => bothEyes('wide'),
  sleepy: () => bothEyes('sleepy'),
  happy: () => bothEyes('happy'),
  squint: () => bothEyes('squint'),
  sparkle: () => bothEyes('sparkle'),
  dot: () => bothEyes('dot'),
};

// ── Brows ──────────────────────────────────────────────────────────────────
const brow = (cx, dir, color, m = 1) => {
  const y = A.browY;
  switch (dir) {
    case 'raised': return stroke(`M ${cx - 7} ${y + 1} q 7 -5 14 0`, color, 2.5);
    case 'furrowed': return stroke(`M ${cx - 7 * m} ${y - 1} q ${7 * m} 4 ${14 * m} 2`, color, 2.7);
    case 'worried': return stroke(`M ${cx - 7 * m} ${y + 2} q ${7 * m} -4 ${14 * m} 1`, color, 2.4);
    default: return stroke(`M ${cx - 7} ${y} q 7 -2 14 0`, color, 2.5);
  }
};
export const BROWS = {
  none: () => '',
  neutral: (c) => brow(A.cx - A.eyeDx, 'neutral', c) + brow(A.cx + A.eyeDx, 'neutral', c),
  raised: (c) => brow(A.cx - A.eyeDx, 'raised', c) + brow(A.cx + A.eyeDx, 'raised', c),
  furrowed: (c) => brow(A.cx - A.eyeDx, 'furrowed', c, 1) + brow(A.cx + A.eyeDx, 'furrowed', c, -1),
  worried: (c) => brow(A.cx - A.eyeDx, 'worried', c, 1) + brow(A.cx + A.eyeDx, 'worried', c, -1),
};

// ── Mouth ──────────────────────────────────────────────────────────────────
const LIP = '#a85c52';
const my = A.mouthY;
export const MOUTH = {
  smile: () => stroke(`M ${A.cx - 11} ${my} q 11 11 22 0`, LIP, 2.7),
  slight: () => stroke(`M ${A.cx - 8} ${my} q 8 5 16 0`, LIP, 2.7),
  neutral: () => stroke(`M ${A.cx - 7} ${my + 1} h 14`, LIP, 2.7),
  frown: () => stroke(`M ${A.cx - 8} ${my + 4} q 8 -6 16 0`, LIP, 2.7),
  smirk: () => stroke(`M ${A.cx - 9} ${my + 2} q 10 6 18 -4`, LIP, 2.7),
  pout: () => el(A.cx, my + 1, 5, 4.2, LIP),
  grin: () => path(`M ${A.cx - 10} ${my - 2} q 10 3 20 0 q -2 11 -10 11 q -8 0 -10 -11 z`, '#7d3f39') + path(`M ${A.cx - 8} ${my - 1} q 8 2 16 0 l 0 3 q -8 2 -16 0 z`, '#fff'),
  laugh: () => path(`M ${A.cx - 12} ${my - 3} q 12 4 24 0 q -4 15 -12 15 q -8 0 -12 -15 z`, '#7d3f39') + path(`M ${A.cx - 9.5} ${my - 2} q 9.5 3 19 0 l 0 3.6 q -9.5 2 -19 0 z`, '#fff') + el(A.cx, my + 10, 4.5, 2.6, '#d97b7b'),
  open: () => el(A.cx, my + 2, 5.5, 6.5, '#7d3f39'),
  grimace: () => rct(A.cx - 10, my - 3, 20, 8, 2, '#fff') + stroke(`M ${A.cx - 10} ${my + 1} h 20`, LIP, 1.5) + stroke(`M ${A.cx - 10} ${my - 3} h 20`, LIP, 1.7),
};

// ── Facial hair — wraps the jaw + connects to the sideburns ────────────────
/** Jaw-wrapping mass: runs from sideburn to sideburn round the chin. */
const jawWrap = (inset, c, extra = '') =>
  path(`M ${A.cx - A.faceRx + inset} ${A.faceCy} C ${A.cx - A.faceRx + inset} ${A.faceBottom - 8}, ${A.cx - 22} ${A.faceBottom + 1}, ${A.cx} ${A.faceBottom + 1} C ${A.cx + 22} ${A.faceBottom + 1}, ${A.cx + A.faceRx - inset} ${A.faceBottom - 8}, ${A.cx + A.faceRx - inset} ${A.faceCy} C ${A.cx + 26} ${A.faceCy + 32}, ${A.cx - 26} ${A.faceCy + 32}, ${A.cx - A.faceRx + inset} ${A.faceCy} Z`, c, extra);
const tache = (c, w = 12) => path(`M ${A.cx - w} ${my - 5} q ${w} 7 ${w * 2} 0 q -${w * 0.42} 7 -${w} 6 q -${w * 0.58} 1 -${w} -6 z`, c);
export const FACIAL_HAIR = {
  none: () => '',
  stubble: (c) => jawWrap(3, c, ' opacity="0.3"'),
  mustache: (c) => tache(c),
  goatee: (c) => tache(c, 10) + path(`M ${A.cx - 8} ${my + 7} q 8 3 16 0 q -2 15 -8 15 q -6 0 -8 -15 z`, c),
  shortBeard: (c) => jawWrap(2, c) + tache(shade(c, 0.94)),
  fullBeard: (c) => jawWrap(0, c) + path(`M ${A.cx - 26} ${my + 5} q 26 10 52 0 q -6 30 -26 30 q -20 0 -26 -30 z`, c) + tache(shade(c, 0.94)),
  longBeard: (c) => jawWrap(0, c) + path(`M ${A.cx - 27} ${my + 3} q 27 12 54 0 q -4 50 -27 54 q -23 -4 -27 -54 z`, c) + tache(shade(c, 0.94)),
  muttonChops: (c) => path(`M ${A.cx - A.faceRx + 1} ${A.faceCy - 8} q 3 32 17 38 q 5 -18 1 -38 z`, c) + path(`M ${A.cx + A.faceRx - 1} ${A.faceCy - 8} q -3 32 -17 38 q -5 -18 -1 -38 z`, c),
};

// ── Hair — BACK mass (behind the head) + FRONT mass (hairline/fringe) ──────
/** Crown-hugging top mass; `lineY` is the hairline, `lift` adds volume. */
const topMass = (c, lineY = 68, lift = 6) =>
  path(`M ${A.cx - 43} ${A.faceCy - 4} C ${A.cx - 43} ${A.faceTop - lift}, ${A.cx + 43} ${A.faceTop - lift}, ${A.cx + 43} ${A.faceCy - 4} C ${A.cx + 41} ${lineY + 6}, ${A.cx + 20} ${lineY}, ${A.cx} ${lineY} C ${A.cx - 20} ${lineY}, ${A.cx - 41} ${lineY + 6}, ${A.cx - 43} ${A.faceCy - 4} Z`, c);
/** Mass behind the head, falling to `toY` — tapered ends, never a flat cut. */
const backMass = (c, w = 7, toY = 158) =>
  path(`M ${A.cx - 40 - w} ${A.faceCy} C ${A.cx - 40 - w} ${A.faceTop - 10}, ${A.cx + 40 + w} ${A.faceTop - 10}, ${A.cx + 40 + w} ${A.faceCy} C ${A.cx + 40 + w} ${toY - 10}, ${A.cx + 39 + w} ${toY}, ${A.cx + 33 + w} ${toY} L ${A.cx - 33 - w} ${toY} C ${A.cx - 39 - w} ${toY}, ${A.cx - 40 - w} ${toY - 10}, ${A.cx - 40 - w} ${A.faceCy} Z`, c);
/** A lock falling BESIDE the face. Its inner edge stays outside the jaw
 *  silhouette all the way down — otherwise long styles read as a beard —
 *  while still covering the ear at ±38. */
const sideLock = (side, c, len = 40) => {
  const outer = A.cx + side * 50;
  const inner = A.cx + side * 39;
  return path(`M ${inner} ${A.faceCy - 26} C ${outer} ${A.faceCy - 18}, ${outer} ${A.faceCy + len * 0.6}, ${outer - side * 5} ${A.faceCy + len} L ${inner + side * 3} ${A.faceCy + len - 7} C ${inner + side} ${A.faceCy + len * 0.4}, ${inner - side * 2} ${A.faceCy - 8}, ${inner} ${A.faceCy - 26} Z`, c);
};

export const HAIR = {
  bald: () => ({ back: '', front: '' }),
  buzz: (c) => ({ back: '', front: topMass(shade(c, 0.96), 74, 0) }),
  short: (c) => ({ back: '', front: topMass(c, 70) + sideLock(-1, c, 16) + sideLock(1, c, 16) + el(A.cx - 9, A.faceTop + 5, 15, 6, '#ffffff', ' opacity="0.13"') }),
  cropped: (c) => ({ back: '', front: topMass(c, 73, 2) + el(A.cx - 9, A.faceTop + 6, 15, 6, '#ffffff', ' opacity="0.13"') }),
  sidePart: (c) => ({ back: '', front: topMass(c, 70) + path(`M ${A.cx - 28} 67 q 30 -13 56 5 q -20 -3 -33 5 q -13 8 -23 -10 z`, shade(c, 0.88)) }),
  fringe: (c) => ({ back: '', front: topMass(c, 62) + path(`M ${A.cx - 40} 72 q 12 17 23 3 q 10 15 21 1 q 10 13 21 -7 l 0 -15 l -65 0 z`, c) }),
  bob: (c) => ({ back: backMass(c, 5, A.faceCy + 34), front: topMass(c, 64) + sideLock(-1, c, 42) + sideLock(1, c, 42) }),
  longStraight: (c) => ({ back: backMass(c, 8), front: topMass(c, 64) + sideLock(-1, c, 58) + sideLock(1, c, 58) }),
  waves: (c) => ({
    back: backMass(c, 9, 156) + path(`M ${A.cx - 50} 156 q 14 -18 4 -34 q 16 12 10 34 z`, shade(c, 0.92)) + path(`M ${A.cx + 50} 156 q -14 -18 -4 -34 q -16 12 -10 34 z`, shade(c, 0.92)),
    front: topMass(c, 62) + path(`M ${A.cx - 36} 68 q 16 14 29 0 q 13 14 27 -4 l 0 -10 l -56 0 z`, c),
  }),
  curly: (c) => ({ back: backMass(c, 8, A.faceCy + 26), front: topMass(c, 66, 10) + [[-33, 54], [-15, 46], [4, 44], [23, 48], [36, 58]].map(([dx, y]) => el(A.cx + dx, y, 13, 12, c)).join('') }),
  // One big silhouette behind + a hairline in front (no second bulge).
  afro: (c) => ({ back: el(A.cx, A.faceCy - 16, 53, 45, c), front: topMass(c, 72, 2) }),
  bun: (c) => ({ back: el(A.cx, A.faceTop - 8, 15, 13, c), front: topMass(c, 70) }),
  topKnot: (c) => ({ back: '', front: topMass(c, 73, 0) + el(A.cx, A.faceTop - 12, 11, 12, c) + rct(A.cx - 6, A.faceTop - 4, 12, 6, 3, shade(c, 0.85)) }),
  ponytail: (c) => ({ back: path(`M ${A.cx + 38} ${A.faceCy - 12} q 26 8 22 42 q -4 26 -18 30 q 10 -26 2 -46 q -6 -16 -6 -26 z`, c), front: topMass(c, 68) }),
  pigtails: (c) => ({
    back: el(A.cx - 52, A.faceCy + 20, 13, 18, c) + el(A.cx + 52, A.faceCy + 20, 13, 18, c),
    front: topMass(c, 66) + el(A.cx - 43, A.faceCy + 2, 6, 5, shade(c, 1.18)) + el(A.cx + 43, A.faceCy + 2, 6, 5, shade(c, 1.18)),
  }),
  braids: (c) => ({ back: [0, 1, 2].map((i) => el(A.cx - 50, A.faceCy + 12 + i * 15, 9, 9, i % 2 ? shade(c, 0.9) : c) + el(A.cx + 50, A.faceCy + 12 + i * 15, 9, 9, i % 2 ? shade(c, 0.9) : c)).join(''), front: topMass(c, 66) }),
  // Locks hang BEHIND the head (around it), never as bars across the face.
  dreads: (c) => ({
    back: backMass(c, 6, A.faceCy + 18) + [-46, -34, 34, 46].map((dx, i) => rct(A.cx + dx - 4, A.faceTop + 4, 8, 62 + (i % 2) * 12, 4, i % 2 ? shade(c, 0.9) : c)).join(''),
    front: topMass(c, 68) + [-26, -10, 8, 24].map((dx, i) => rct(A.cx + dx - 3.5, A.faceTop - 6, 7, 16 + (i % 2) * 6, 3.5, i % 2 ? shade(c, 0.92) : c)).join(''),
  }),
  spiky: (c) => ({ back: '', front: topMass(c, 68, 4) + [-34, -22, -10, 2, 14, 25].map((dx, i) => path(`M ${A.cx + dx} ${A.faceTop + 6} L ${A.cx + dx + (dx < 0 ? -4 : 4)} ${A.faceTop + 6 - (22 + (i % 2) * 8)} L ${A.cx + dx + 13} ${A.faceTop + 2} Z`, c)).join('') }),
  mohawk: (c) => ({ back: '', front: path(`M ${A.cx - 13} ${A.faceTop + 18} L ${A.cx - 9} ${A.faceTop - 18} L ${A.cx - 4} ${A.faceTop + 2} L ${A.cx} ${A.faceTop - 28} L ${A.cx + 4} ${A.faceTop + 2} L ${A.cx + 9} ${A.faceTop - 18} L ${A.cx + 13} ${A.faceTop + 18} Z`, c) + path(`M ${A.cx - 13} ${A.faceTop + 14} q 13 9 26 0 l 0 5 q -13 8 -26 0 z`, shade(c, 0.82)) }),
};

// ── Headwear — wraps the cranium: dome + curved brim + band ────────────────
/** A dome that follows the skull, ending at `bandY`. */
const dome = (c, bandY = A.hatBaseY, lift = 10) =>
  path(`M ${A.cx - 44} ${bandY} C ${A.cx - 44} ${A.faceTop - lift}, ${A.cx + 44} ${A.faceTop - lift}, ${A.cx + 44} ${bandY} Z`, c);
const brim = (c, y = A.hatBaseY, rx = 52, ry = 7) => el(A.cx, y, rx, ry, c);
/** A band that curves with the head (not a flat bar). */
const band = (c, y = A.hatBaseY - 4, h = 8) =>
  path(`M ${A.cx - 44} ${y} q 44 8 88 0 l 0 ${h} q -44 8 -88 0 z`, c);

export const HEADWEAR = {
  none: () => ({ back: '', front: '' }),
  witchHat: (c) => ({ back: '', front: brim(shade(c, 0.78), A.hatBaseY - 1, 58, 9) + path(`M ${A.cx + 11} ${A.hatBaseY - 3} C ${A.cx + 5} 20, ${A.cx - 13} 16, ${A.cx - 17} 6 C ${A.cx - 7} 22, ${A.cx - 25} ${A.hatBaseY - 8}, ${A.cx - 30} ${A.hatBaseY - 1} Z`, c) + band(shade(c, 0.68), A.hatBaseY - 11, 7) + el(A.cx - 22, A.hatBaseY - 8, 4, 5, '#f6c945') }),
  cap: (c) => ({ back: '', front: dome(c, A.hatBaseY, 8) + path(`M ${A.cx - 4} ${A.hatBaseY - 4} q 34 -1 46 10 q -22 8 -46 4 z`, shade(c, 0.86)) + band(shade(c, 0.9), A.hatBaseY - 5, 6) }),
  beanie: (c) => ({ back: '', front: dome(c, A.hatBaseY + 4, 8) + band(shade(c, 0.8), A.hatBaseY, 10) + el(A.cx, A.faceTop - 12, 6.5, 6.5, shade(c, 1.15)) }),
  bandana: (c) => ({ back: '', front: path(`M ${A.cx - 44} ${A.hatBaseY + 2} C ${A.cx - 44} ${A.faceTop - 2}, ${A.cx + 44} ${A.faceTop - 2}, ${A.cx + 44} ${A.hatBaseY + 2} q -44 8 -88 0 z`, c) + path(`M ${A.cx + 40} ${A.hatBaseY} l 16 7 l -5 12 l -12 -13 z`, shade(c, 0.88)) }),
  crown: (c) => ({ back: '', front: path(`M ${A.cx - 28} ${A.hatBaseY - 2} l 0 -19 l 10 9 l 9 -16 l 9 16 l 10 -9 l 0 19 z`, c) + band(shade(c, 0.82), A.hatBaseY - 4, 7) + [-16, 0, 16].map((dx) => el(A.cx + dx, A.hatBaseY - 1, 3, 3, '#e8556d')).join('') }),
  helmet: (c) => ({ back: '', front: dome(c, A.hatBaseY + 14, 12) + rct(A.cx - 4, A.faceTop - 8, 8, 54, 3, shade(c, 0.76)) + band(shade(c, 0.86), A.hatBaseY + 8, 9) + el(A.cx, A.faceTop - 12, 6, 6, shade(c, 1.2)) }),
  // A hood is a RIM around the face (outer curve out, inner curve back), so it
  // frames rather than covering the forehead with a band.
  hood: (c) => ({
    back: path(`M ${A.cx - 54} 158 C ${A.cx - 58} ${A.faceTop - 14}, ${A.cx + 58} ${A.faceTop - 14}, ${A.cx + 54} 158 Z`, shade(c, 0.86)),
    front: path(`M ${A.cx - 54} ${A.faceCy + 30} C ${A.cx - 56} ${A.faceTop - 14}, ${A.cx + 56} ${A.faceTop - 14}, ${A.cx + 54} ${A.faceCy + 30} L ${A.cx + 42} ${A.faceCy + 30} C ${A.cx + 44} ${A.faceTop + 4}, ${A.cx - 44} ${A.faceTop + 4}, ${A.cx - 42} ${A.faceCy + 30} Z`, c),
  }),
  strawHat: (c) => ({ back: '', front: brim(c, A.hatBaseY + 3, 62, 10) + dome(shade(c, 0.95), A.hatBaseY, 4) + band(shade(c, 0.72), A.hatBaseY - 6, 8) }),
  topHat: (c) => ({ back: '', front: brim(shade(c, 0.9), A.hatBaseY - 2, 50, 7) + rct(A.cx - 22, A.faceTop - 34, 44, 40, 3, c) + rct(A.cx - 22, A.faceTop - 6, 44, 8, 2, shade(c, 0.7)) }),
  chefHat: (c) => ({ back: '', front: band(shade(c, 0.94), A.hatBaseY - 6, 10) + el(A.cx - 16, A.faceTop - 18, 16, 15, c) + el(A.cx + 16, A.faceTop - 18, 16, 15, c) + el(A.cx, A.faceTop - 24, 18, 17, c) + rct(A.cx - 30, A.faceTop - 10, 60, 14, 4, c) }),
  beret: (c) => ({ back: '', front: path(`M ${A.cx - 38} ${A.hatBaseY - 2} C ${A.cx - 42} ${A.faceTop - 8}, ${A.cx + 34} ${A.faceTop - 14}, ${A.cx + 34} ${A.hatBaseY - 4} q -36 9 -72 2 z`, c) + el(A.cx + 22, A.faceTop - 10, 4, 4, shade(c, 0.8)) }),
  turban: (c) => ({ back: '', front: dome(c, A.hatBaseY + 2, 14) + band(shade(c, 0.9), A.hatBaseY - 6, 9) + path(`M ${A.cx - 30} ${A.hatBaseY - 13} q 30 -10 60 0 q -30 7 -60 0 z`, shade(c, 0.84)) + el(A.cx, A.faceTop - 18, 5, 5, '#f6c945') }),
  flowerCrown: (c) => ({ back: '', front: [-30, -14, 2, 18, 32].map((dx, i) => el(A.cx + dx, A.hatBaseY - 4 - (i % 2) * 4, 7, 6, i % 2 ? shade(c, 1.15) : c) + el(A.cx + dx, A.hatBaseY - 4 - (i % 2) * 4, 2.4, 2.4, '#f6c945')).join('') }),
  headband: (c) => ({ back: '', front: band(c, A.hatBaseY + 2, 9) }),
};

// ── Outfit — shoulder slope + a real neckline/collar ───────────────────────
const shoulders = (c) => path(`M 18 200 C 20 ${A.shoulderY + 6}, 58 ${A.shoulderY - 4}, 100 ${A.shoulderY - 4} C 142 ${A.shoulderY - 4}, 180 ${A.shoulderY + 6}, 182 200 Z`, c);
const neckline = (c) => path(`M ${A.cx - 20} ${A.shoulderY - 3} q 20 16 40 0 q -6 12 -20 12 q -14 0 -20 -12 z`, c);
export const OUTFIT = {
  plain: (c) => shoulders(c) + neckline(shade(c, 0.88)),
  tee: (c) => shoulders(c) + neckline(shade(c, 0.86)) + stroke(`M 36 ${A.shoulderY + 20} q 8 -9 18 -12`, shade(c, 0.86), 2.4) + stroke(`M 164 ${A.shoulderY + 20} q -8 -9 -18 -12`, shade(c, 0.86), 2.4),
  sweater: (c) => shoulders(c) + path(`M ${A.cx - 22} ${A.shoulderY - 4} q 22 18 44 0 q -4 14 -22 14 q -18 0 -22 -14 z`, shade(c, 0.8)) + stroke(`M 26 190 q 74 -14 148 0`, shade(c, 0.88), 2.6),
  shirtTie: (c) => shoulders('#f2f4f7') + path(`M ${A.cx - 20} ${A.shoulderY - 4} l 20 16 l 20 -16 l -8 -3 l -12 9 l -12 -9 z`, '#e4e8ee') + path(`M ${A.cx - 5} ${A.shoulderY + 12} l 10 0 l 4 30 l -9 8 l -9 -8 z`, c) + path(`M ${A.cx - 5} ${A.shoulderY + 12} l 10 0 l -5 6 z`, shade(c, 0.8)),
  suit: (c) => shoulders(c) + path(`M ${A.cx - 24} ${A.shoulderY - 2} L ${A.cx} ${A.shoulderY + 16} L ${A.cx} 200 L ${A.cx - 34} 200 Z`, shade(c, 0.88)) + path(`M ${A.cx + 24} ${A.shoulderY - 2} L ${A.cx} ${A.shoulderY + 16} L ${A.cx} 200 L ${A.cx + 34} 200 Z`, shade(c, 0.88)) + path(`M ${A.cx - 12} ${A.shoulderY} l 12 14 l 12 -14 z`, '#f2f4f7') + path(`M ${A.cx - 4} ${A.shoulderY + 14} l 8 0 l 3 26 l -7 6 l -7 -6 z`, shade(c, 0.6)),
  labCoat: (c) => shoulders('#f6f8fa') + path(`M ${A.cx - 22} ${A.shoulderY - 2} L ${A.cx - 2} ${A.shoulderY + 18} L ${A.cx - 2} 200 L ${A.cx - 32} 200 Z`, '#e8ecf1') + path(`M ${A.cx + 22} ${A.shoulderY - 2} L ${A.cx + 2} ${A.shoulderY + 18} L ${A.cx + 2} 200 L ${A.cx + 32} 200 Z`, '#e8ecf1') + rct(A.cx + 12, 178, 16, 14, 2, '#dfe5ec') + path(`M ${A.cx - 12} ${A.shoulderY} l 12 14 l 12 -14 z`, c),
  robe: (c) => shoulders(c) + path(`M ${A.cx - 22} ${A.shoulderY - 4} L ${A.cx} ${A.shoulderY + 28} L ${A.cx + 22} ${A.shoulderY - 4} L ${A.cx + 30} ${A.shoulderY + 4} L ${A.cx} 200 L ${A.cx - 30} ${A.shoulderY + 4} Z`, shade(c, 0.78)) + stroke(`M 28 194 q 72 -12 144 0`, shade(c, 1.2), 2.4),
  cloak: (c) => shoulders(c) + path(`M ${A.cx - 46} ${A.shoulderY + 6} q 46 -22 92 0 q -6 12 -46 12 q -40 0 -46 -12 z`, shade(c, 0.82)) + el(A.cx, A.shoulderY + 10, 6, 6, '#f6c945'),
  apron: (c) => shoulders('#e9edf2') + rct(A.cx - 26, A.shoulderY + 6, 52, 44, 5, c) + stroke(`M ${A.cx - 20} ${A.shoulderY} l 8 8`, shade(c, 0.8), 3) + stroke(`M ${A.cx + 20} ${A.shoulderY} l -8 8`, shade(c, 0.8), 3),
  overalls: (c) => shoulders('#e9edf2') + rct(A.cx - 24, A.shoulderY + 10, 48, 40, 4, c) + rct(A.cx - 24, A.shoulderY - 2, 9, 20, 3, c) + rct(A.cx + 15, A.shoulderY - 2, 9, 20, 3, c) + el(A.cx - 16, A.shoulderY + 14, 2.6, 2.6, '#f6c945') + el(A.cx + 16, A.shoulderY + 14, 2.6, 2.6, '#f6c945'),
  armour: (c) => shoulders(c) + path(`M ${A.cx - 52} ${A.shoulderY + 18} q 16 -18 30 -2 q -12 10 -30 2 z`, shade(c, 1.12)) + path(`M ${A.cx + 52} ${A.shoulderY + 18} q -16 -18 -30 -2 q 12 10 30 2 z`, shade(c, 1.12)) + path(`M ${A.cx - 22} ${A.shoulderY - 4} q 22 18 44 0 l 0 12 q -22 14 -44 0 z`, shade(c, 0.84)) + stroke(`M ${A.cx} ${A.shoulderY + 18} L ${A.cx} 198`, shade(c, 0.8), 2.4),
  uniform: (c) => shoulders(c) + path(`M ${A.cx - 22} ${A.shoulderY - 2} l 22 16 l 22 -16 l 8 6 l -30 22 l -30 -22 z`, shade(c, 0.84)) + rct(A.cx - 46, A.shoulderY + 16, 18, 7, 2, '#f6c945') + rct(A.cx + 28, A.shoulderY + 16, 18, 7, 2, '#f6c945'),
  hoodie: (c) => shoulders(c) + path(`M ${A.cx - 30} ${A.shoulderY - 6} q 30 24 60 0 q 4 14 -8 18 q -22 10 -44 0 q -12 -4 -8 -18 z`, shade(c, 0.84)) + stroke(`M ${A.cx - 8} ${A.shoulderY + 18} l -2 24`, '#f2f4f7', 2.6) + stroke(`M ${A.cx + 8} ${A.shoulderY + 18} l 2 24`, '#f2f4f7', 2.6),
  dress: (c) => shoulders(c) + neckline(shade(c, 0.86)) + [-24, 0, 24].map((dx) => el(A.cx + dx, A.shoulderY + 28, 4, 4, shade(c, 1.18))).join(''),
  tank: (c) => shoulders(c) + path(`M ${A.cx - 34} ${A.shoulderY} q 12 26 34 26 q 22 0 34 -26 l 10 8 q -14 34 -44 34 q -30 0 -44 -34 z`, shade(c, 0.9)),
  scarf: (c) => shoulders('#e6e9ee') + path(`M ${A.cx - 32} ${A.shoulderY} q 32 22 64 0 l 0 14 q -32 20 -64 0 z`, c) + rct(A.cx + 8, A.shoulderY + 14, 14, 34, 5, shade(c, 0.88)),
};

// ── Accessory (front-most) ─────────────────────────────────────────────────
export const ACCESSORY = {
  none: () => '',
  glasses: () => `<g fill="none" stroke="#3a352d" stroke-width="2.2"><rect x="${A.cx - A.eyeDx - 10}" y="${A.eyeY - 8}" width="20" height="16" rx="5"/><rect x="${A.cx + A.eyeDx - 10}" y="${A.eyeY - 8}" width="20" height="16" rx="5"/><path d="M ${A.cx - 8} ${A.eyeY} h 16"/><path d="M ${A.cx - A.eyeDx - 10} ${A.eyeY - 2} l -10 -3"/><path d="M ${A.cx + A.eyeDx + 10} ${A.eyeY - 2} l 10 -3"/></g>`,
  roundGlasses: () => `<g fill="none" stroke="#3a352d" stroke-width="2.2"><circle cx="${A.cx - A.eyeDx}" cy="${A.eyeY}" r="9.5"/><circle cx="${A.cx + A.eyeDx}" cy="${A.eyeY}" r="9.5"/><path d="M ${A.cx - 8} ${A.eyeY} h 16"/><path d="M ${A.cx - A.eyeDx - 9.5} ${A.eyeY - 2} l -11 -3"/><path d="M ${A.cx + A.eyeDx + 9.5} ${A.eyeY - 2} l 11 -3"/></g>`,
  sunglasses: () => path(`M ${A.cx - 30} ${A.eyeY - 8} q 30 -4 60 0 l 0 5 q -9 13 -21 13 q -9 0 -9 -8 q 0 8 -9 8 q -12 0 -21 -13 z`, '#2b2620'),
  eyepatch: () => path(`M ${A.cx + A.eyeDx - 10} ${A.eyeY - 9} q 10 -2 20 0 l 0 18 q -10 2 -20 0 z`, '#2b2620') + stroke(`M ${A.cx + A.eyeDx - 10} ${A.eyeY - 8} L ${A.cx - 40} ${A.eyeY - 14}`, '#2b2620', 2.4),
  earrings: () => el(A.cx - 38, A.earY + 12, 3, 3, '#f6c945') + el(A.cx + 38, A.earY + 12, 3, 3, '#f6c945'),
  freckles: () => [-7, 0, 7].map((dx) => el(A.cx - 22 + dx, A.mouthY - 9, 1.5, 1.5, '#c98a6a') + el(A.cx + 22 + dx, A.mouthY - 9, 1.5, 1.5, '#c98a6a')).join(''),
  monocle: () => `<circle cx="${A.cx + A.eyeDx}" cy="${A.eyeY}" r="10" fill="#ffffff" fill-opacity="0.18" stroke="#c9a24a" stroke-width="2.2"/>` + stroke(`M ${A.cx + A.eyeDx + 9} ${A.eyeY + 8} q 4 15 -4 22`, '#c9a24a', 1.6),
  scar: () => stroke(`M ${A.cx + A.eyeDx + 6} ${A.eyeY - 14} l -4 24`, '#c07a6a', 2),
};

/** The option names per slot — fed to the model so it picks valid values. */
export const OPTIONS = {
  eyes: Object.keys(EYES),
  brows: Object.keys(BROWS),
  mouth: Object.keys(MOUTH),
  facialHair: Object.keys(FACIAL_HAIR),
  hair: Object.keys(HAIR),
  headwear: Object.keys(HEADWEAR),
  outfit: Object.keys(OUTFIT),
  accessory: Object.keys(ACCESSORY),
};
