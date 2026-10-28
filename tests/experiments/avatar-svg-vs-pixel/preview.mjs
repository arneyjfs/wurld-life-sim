/**
 * Sanity-check the part library WITHOUT the model: hand-authored params for the
 * 6 test characters, assembled + rendered so alignment/quality issues show up
 * before spending Gemini calls.
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/preview.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { assembleAvatar } from './assemble.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

const cast = [
  { name: 'Witch', p: { bg: '#e7dcf5', skin: '#f3c9a2', hair: { style: 'long', color: '#3a2b4d' }, headwear: { style: 'witchHat', color: '#4a2a6b' }, eyes: 'almond', brows: 'raised', mouth: 'smirk', outfit: { style: 'robe', color: '#2e2140' } } },
  { name: 'Office', p: { bg: '#dfe4ea', skin: '#f0c19a', hair: { style: 'short', color: '#5a3d28' }, eyes: 'sleepy', brows: 'furrowed', mouth: 'frown', outfit: { style: 'shirtTie', color: '#2b3a67' } } },
  { name: 'Fisherman', p: { bg: '#bcd6e6', skin: '#e6b48a', hair: { style: 'cropped', color: '#cfcfcf' }, facialHair: { style: 'longBeard', color: '#dedede' }, headwear: { style: 'cap', color: '#22314a' }, eyes: 'almond', mouth: 'neutral', outfit: { style: 'apron', color: '#f2b705' } } },
  { name: 'Child', p: { bg: '#fbe0ea', skin: '#f7cfae', hair: { style: 'pigtails', color: '#7a4a2a' }, eyes: 'wide', mouth: 'grin', accessory: 'freckles', outfit: { style: 'dress', color: '#f48fb1' } } },
  { name: 'Knight', p: { bg: '#cdd9ea', skin: '#eeb98d', hair: { style: 'cropped', color: '#caa24a' }, headwear: { style: 'helmet', color: '#aeb6bf' }, eyes: 'almond', brows: 'neutral', mouth: 'neutral', outfit: { style: 'armour', color: '#b9c0c7' } } },
  { name: 'Punk', p: { bg: '#2b2733', skin: '#f0c19a', hair: { style: 'mohawk', color: '#ff2d95' }, eyes: 'almond', mouth: 'smirk', accessory: 'earrings', outfit: { style: 'hoodie', color: '#1c1c22' } } },
];

const cells = cast.map((c) => {
  const { svg, errors } = assembleAvatar(c.p);
  return `<div class="cell"><div class="slot">${svg ?? ''}</div><div class="lbl">${c.name}${errors.length ? ' ⚠ ' + errors.join(',') : ''}</div></div>`;
}).join('');

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#faf8f5;font-family:system-ui,sans-serif;width:720px}
  h1{font-size:18px}.grid{display:flex;flex-wrap:wrap;gap:20px}
  .cell{text-align:center}.slot{width:120px;height:120px;border-radius:50%;overflow:hidden;box-shadow:0 1px 5px rgba(0,0,0,.15)}
  .slot svg{width:100%;height:100%;display:block}.lbl{font-size:12px;margin-top:6px;color:#555}
</style></head><body><h1>Parts library — hand-authored preview</h1><div class="grid">${cells}</div></body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('body').screenshot({ path: join(__dir, 'preview.png') });
console.log(`wrote ${join(__dir, 'preview.png')}`);
await browser.close();
