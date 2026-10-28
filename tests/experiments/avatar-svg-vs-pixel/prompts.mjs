/**
 * Avatar generation experiment — FULL-BODY variant. Current SVG portrait prompt
 * adapted to a standing full-body figure, vs a full-body pixel-matrix prompt.
 *
 * Hypothesis (owner): pixels reflect CHARACTER better with a full body than a
 * head-shot — the model has room to express personality through pose, the whole
 * outfit, and props (a witch's broom, a knight's sword), not just a face.
 */

// Full-body pixel grid — taller than wide (standing figure), classic sprite
// proportions. WIDTH×HEIGHT cells.
export const PIX_W = 20;
export const PIX_H = 32;

// ── SVG prompt (full body) ─────────────────────────────────────────────────
export const SVG_SI = [
  `You draw small full-body character illustrations as SVG — a standing figure shown head to toe, like a cute RPG character select.`,
  ``,
  `OUTPUT:`,
  `Return ONLY the SVG. Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 320">…</svg> (taller than wide, for a standing figure). No width/height on the root. No <text>, no <script>, no <image href>, no external URLs, no animations.`,
  ``,
  `STYLE:`,
  `Friendly children's-book / Studio Ghibli illustration. Warm pastels, gentle gradients, soft rounded shapes. Avoid harsh outlines, avoid hyper-realism, avoid creepy or uncanny features.`,
  ``,
  `COMPOSITION:`,
  `A solid pastel background fills the whole canvas. On top: ONE full-body character, standing, facing forward, centred, head near the top and feet near the bottom — the whole figure fits with a little margin. A relaxed, characterful pose.`,
  ``,
  `THE CHARACTER — head to toe:`,
  `• Face: warm and alive — eyes with shape + a pupil (not dots), a small expression that fits the person (sly, tired, cheerful, stern). Hair with style + colour.`,
  `• Body + outfit: the FULL costume that says who they are — a witch's robe + pointed hat, a knight's armour, an office worker's shirt + tie + slacks, a fisherman's oilskins + boots. Skin one warm tone.`,
  `• A signature prop or pose if it fits (a broom, a sword, hands in pockets, a fishing rod). One is plenty.`,
  ``,
  `CHARACTER:`,
  `Make this PERSON specific and readable from the silhouette + outfit alone. Pick hair colour, skin tone, age range, clothing, and one signature detail. Sameness is worse than a bold choice.`,
  ``,
  `Return only the SVG. No prose.`,
].join('\n');

// ── Pixel-matrix prompt (full body) ────────────────────────────────────────
export const PIXEL_SI = [
  `You design cute full-body characters as PIXEL ART — a standing figure head to toe, like a 16-bit RPG sprite on the character-select screen. BOLD readable shapes and a warm limited palette matter far more than fine detail.`,
  ``,
  `OUTPUT:`,
  `Return ONLY a JSON object, no prose, no markdown fences:`,
  `{"palette":["#rrggbb", …], "rows":["<row>", …]}`,
  `• "palette": 4–16 hex colours. Index 0 (hex digit "0") is ALWAYS the background.`,
  `• "rows": EXACTLY ${PIX_H} strings, each EXACTLY ${PIX_W} hex digits (0-9a-f). Each digit indexes "palette". Row 0 is the TOP (head); the last rows are the feet.`,
  ``,
  `STYLE:`,
  `Cute, friendly, chunky pixel art. A clear silhouette, bold shapes, a warm limited palette. NO dithering or single-pixel noise. No creepy or uncanny faces.`,
  ``,
  `COMPOSITION:`,
  `The background (index 0) fills the canvas. ONE full-body character stands centred, facing forward: head near the top (a small face — a couple of pixels for eyes with a darker pupil, a tiny mouth), then torso + arms + the whole outfit, then legs + feet near the bottom. Leave a little margin left/right and top/bottom.`,
  ``,
  `CHARACTER — this is the whole point:`,
  `Read <role> and <worldVibe> and make THIS PERSON unmistakable from the SILHOUETTE + OUTFIT: a witch in a robe + pointed hat (maybe a broom); a knight in full armour; an office worker in a shirt + tie + slacks; a fisherman in oilskins + boots. Choose the palette, the full costume, a pose, and ONE signature prop or detail. Someone should read the role at a glance. Sameness is worse than a bold choice.`,
  ``,
  `Return only the JSON.`,
].join('\n');

export function buildPrompt({ name, role, worldVibe }) {
  const parts = [`<character name="${esc(name)}"/>`];
  if (role) parts.push(`<role>${esc(role)}</role>`);
  parts.push(`<worldVibe>${esc(worldVibe)}</worldVibe>`);
  parts.push(`Draw the full-body character.`);
  return parts.join('\n\n');
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;',
  );
}

// ── Test cast — spread across age, style + personality ─────────────────────
export const CHARACTERS = [
  { key: 'witch', name: 'Morgana', role: 'a village witch with a pointed hat and a sly grin', worldVibe: 'cosy fantasy folklore' },
  { key: 'office', name: 'Dave', role: 'a tired mid-level office worker in a shirt and tie', worldVibe: 'modern city life' },
  { key: 'fisherman', name: 'Old Tomas', role: 'a weathered old fisherman with a grey beard and a cap', worldVibe: 'a windswept seaside town' },
  { key: 'child', name: 'Lily', role: 'a cheerful little girl with pigtails, about six years old', worldVibe: 'warm everyday life' },
  { key: 'knight', name: 'Sir Rowan', role: 'a young knight in armour with a noble bearing', worldVibe: 'high-medieval fantasy' },
  { key: 'punk', name: 'Zee', role: 'a punk musician with a bright mohawk and piercings', worldVibe: 'gritty modern nightlife' },
];
