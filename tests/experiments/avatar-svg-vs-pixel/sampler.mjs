/**
 * Part-library sampler: renders every option of every slot on a neutral base so
 * each part can be judged for join/quality, plus a strip of assembled examples
 * for cohesion. Critique tool — regenerate after each edit.
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/sampler.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
// Renders the REAL app library (src/lib/life/avatar), bundled by:
//   npx esbuild src/lib/life/avatar/index.ts --bundle --format=esm \
//     --platform=node --outfile=tests/experiments/avatar-svg-vs-pixel/app-avatar.bundle.mjs
import { assembleAvatar, OPTIONS } from './app-avatar.bundle.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

const BASE = { bg: '#eef0f4', skin: '#f2c6a0', hair: { style: 'short', color: '#6b4a2f' }, eyes: 'almond', brows: 'neutral', mouth: 'slight' };
const HAIR_C = '#6b4a2f', HAT_C = '#7c6ff0', OUT_C = '#b9c0d6', BEARD_C = '#9a9a9a';

const cellSvg = (svg, size = 84) => `<div class="s" style="width:${size}px;height:${size}px">${svg}</div>`;

function slotRow(slot, opts, makeParams) {
  const cells = opts.map((o) => {
    const { svg } = assembleAvatar(makeParams(o));
    return `<div class="c">${cellSvg(svg)}<div class="l">${o}</div></div>`;
  }).join('');
  return `<div class="slot"><div class="sl">${slot} (${opts.length})</div><div class="row">${cells}</div></div>`;
}

const examples = [
  { bg: '#e7dcf5', skin: '#f3c9a2', hair: { style: 'longStraight', color: '#3a2b4d' }, headwear: { style: 'witchHat', color: '#4a2a6b' }, brows: 'raised', mouth: 'smirk', outfit: { style: 'robe', color: '#2e2140' } },
  { bg: '#dfe4ea', skin: '#f0c19a', hair: { style: 'short', color: '#5a3d28' }, facialHair: { style: 'stubble', color: '#4a3420' }, eyes: 'sleepy', brows: 'furrowed', mouth: 'frown', outfit: { style: 'shirtTie', color: '#2b3a67' }, accessory: 'glasses' },
  { bg: '#bcd6e6', skin: '#e6b48a', hair: { style: 'cropped', color: '#cfcfcf' }, facialHair: { style: 'longBeard', color: '#dedede' }, headwear: { style: 'cap', color: '#22314a' }, mouth: 'slight', outfit: { style: 'apron', color: '#f2b705' } },
  { bg: '#fbe0ea', skin: '#f7cfae', hair: { style: 'pigtails', color: '#7a4a2a' }, headwear: { style: 'flowerCrown', color: '#f48fb1' }, eyes: 'wide', mouth: 'grin', accessory: 'freckles', outfit: { style: 'dress', color: '#f48fb1' } },
  { bg: '#cdd9ea', skin: '#eeb98d', hair: { style: 'cropped', color: '#caa24a' }, headwear: { style: 'helmet', color: '#aeb6bf' }, mouth: 'neutral', outfit: { style: 'armour', color: '#b9c0c7' } },
  { bg: '#2b2733', skin: '#f0c19a', hair: { style: 'mohawk', color: '#ff2d95' }, mouth: 'smirk', accessory: 'earrings', outfit: { style: 'hoodie', color: '#1c1c22' } },
  { bg: '#e6f0e6', skin: '#d69a6a', hair: { style: 'waves', color: '#1c1c22' }, eyes: 'almond', mouth: 'smile', outfit: { style: 'scarf', color: '#c0392b' } },
  { bg: '#efe7d6', skin: '#f2c6a0', hair: { style: 'bun', color: '#3a2b1d' }, headwear: { style: 'headband', color: '#c0392b' }, mouth: 'smile', outfit: { style: 'apron', color: '#8d6e4a' } },
];

const exStrip = examples.map((p) => cellSvg(assembleAvatar(p).svg, 96)).join('');

const rows = [
  slotRow('hair', OPTIONS.hair, (o) => ({ ...BASE, hair: { style: o, color: HAIR_C } })),
  slotRow('headwear', OPTIONS.headwear, (o) => ({ ...BASE, headwear: { style: o, color: HAT_C } })),
  slotRow('outfit', OPTIONS.outfit, (o) => ({ ...BASE, outfit: { style: o, color: OUT_C } })),
  slotRow('facialHair', OPTIONS.facialHair, (o) => ({ ...BASE, facialHair: { style: o, color: BEARD_C } })),
  slotRow('eyes', OPTIONS.eyes, (o) => ({ ...BASE, eyes: o })),
  slotRow('brows', OPTIONS.brows, (o) => ({ ...BASE, brows: o })),
  slotRow('mouth', OPTIONS.mouth, (o) => ({ ...BASE, mouth: o })),
  slotRow('accessory', OPTIONS.accessory, (o) => ({ ...BASE, accessory: o })),
].join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:20px;background:#fff;font-family:system-ui,sans-serif;color:#222;width:940px}
  h1{font-size:18px;margin:0 0 10px}h2{font-size:13px;color:#777;margin:18px 0 8px}
  .strip{display:flex;flex-wrap:wrap;gap:12px;padding:12px;background:#faf8f5;border-radius:12px}
  .slot{margin-bottom:6px;border-bottom:1px solid #f0f0f0;padding-bottom:6px}
  .sl{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#7340f5;margin:8px 0 4px}
  .row{display:flex;flex-wrap:wrap;gap:8px}
  .c{text-align:center}.s{border-radius:12px;overflow:hidden;background:#eef0f4;box-shadow:0 1px 3px rgba(0,0,0,.1)}
  .s svg{width:100%;height:100%;display:block}.l{font-size:9px;color:#888;margin-top:2px}
</style></head><body>
  <h1>Avatar part sampler — critique</h1>
  <h2>Assembled examples (cohesion)</h2>
  <div class="strip">${exStrip}</div>
  <h2>Every option, per slot (join + quality)</h2>
  ${rows}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('body').screenshot({ path: join(__dir, 'sampler.png') });
console.log(`wrote ${join(__dir, 'sampler.png')}`);
await browser.close();
