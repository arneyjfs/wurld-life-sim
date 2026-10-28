/**
 * Two system instructions for the parts+params approach:
 *  - PARAMS_SI: pick parts from the library → tiny JSON (the cheap primary path).
 *  - LEAN_SVG_SI: the economy-of-line direct SVG draw (the fallback when the
 *    library can't represent a character).
 */
import { OPTIONS } from './parts.mjs';

const list = (k) => `${k}: ${OPTIONS[k].join(' | ')}`;

export const PARAMS_SI = [
  `You style a small, cute character portrait by CHOOSING PARTS from a fixed library. You do NOT draw — you pick options + colours that best capture the person and their role.`,
  ``,
  `OUTPUT — return ONLY this JSON (no prose):`,
  `{"bg":"#hex","skin":"#hex","hair":{"style":"…","color":"#hex"},"facialHair":{"style":"…","color":"#hex"},"eyes":"…","brows":"…","mouth":"…","headwear":{"style":"…","color":"#hex"},"outfit":{"style":"…","color":"#hex"},"accessory":"…"}`,
  ``,
  `Every "style" MUST be one of these exact values:`,
  list('hair'),
  list('facialHair'),
  list('eyes'),
  list('brows'),
  list('mouth'),
  list('headwear'),
  list('outfit'),
  list('accessory'),
  ``,
  `GUIDANCE:`,
  `• Read <role> + <worldVibe> and pick the combination that makes THIS person unmistakable — a witch: witchHat + robe + a knowing mouth; an office worker: shirtTie + a tired/neutral mouth + sleepy or furrowed brows; a fisherman: cap + a beard + apron (oilskins).`,
  `• Use COLOUR to carry the role (a witch's purple/black, a fisherman's yellow oilskins, a knight's steel-grey armour). bg is a soft complementary pastel.`,
  `• Match hair colour/style + skin tone to age + character. facialHair "none" unless it fits. accessory "none" unless it adds character.`,
  ``,
  `FALLBACK — only if the library genuinely CANNOT capture this character (e.g. a non-human, a very specific creature): return exactly {"fallback": true} and nothing else. Prefer a good approximation over falling back.`,
].join('\n');

// Economy-of-line direct SVG draw — the fallback (≤14 shapes, integer coords).
export const LEAN_SVG_SI = [
  `You draw a small character portrait as SVG for a 32px circular chat slot — bold economy over detail.`,
  ``,
  `OUTPUT: ONLY the SVG. Root <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">…</svg>. No width/height, <text>, <script>, <image>, external URLs or animations.`,
  `BUDGET: at most ~14 shapes; round every coordinate to an integer; FLAT fills only (no gradients/defs/filters); prefer <circle>/<ellipse>/<rect>.`,
  `STYLE: friendly children's-book, warm pastels, soft rounded shapes.`,
  `COMPOSITION: pastel background rect; head + shoulders centred, face upper-middle. Eyes with a pupil (not dots), a small mouth expression that fits, hair with colour + style, and the ONE detail that names the character (a pointed hat, collar + tie, a cap). Skin one warm tone.`,
  `Return only the SVG.`,
].join('\n');
