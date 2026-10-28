/**
 * Zoom critique sheet: 200px tiles for the combos where LAYERS collide —
 * hair-under-headwear, neck-in-collar, hair-vs-hood. Thumbnails hide seams;
 * every defect found so far was invisible at 84px.
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/zoom.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { assembleAvatar } from './app-avatar.bundle.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));
const BASE = { bg: '#eef0f4', skin: '#f2c6a0', eyes: 'almond', brows: 'neutral', mouth: 'slight' };
const H = '#6b4a2f';

const group = (title, items) => `<h2>${title}</h2><div class="row">${items.map(([label, p]) => {
  const { svg } = assembleAvatar({ ...BASE, ...p });
  return `<div class="c"><div class="s">${svg}</div><div class="l">${label}</div></div>`;
}).join('')}</div>`;

const hairs = ['short', 'longStraight', 'afro', 'curly', 'spiky', 'dreads', 'braids', 'ponytail', 'pigtails', 'bun', 'topKnot', 'mohawk', 'waves', 'bob'];
const outfits = ['plain', 'tee', 'sweater', 'hoodie', 'tank', 'dress', 'cloak', 'scarf', 'armour', 'robe', 'suit', 'uniform'];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:18px;background:#fff;font-family:system-ui,sans-serif;color:#222;width:1180px}
  h1{font-size:20px;margin:0 0 6px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#7340f5;margin:16px 0 6px}
  .row{display:flex;flex-wrap:wrap;gap:10px}
  .c{text-align:center}.s{width:180px;height:180px;border-radius:14px;overflow:hidden;background:#eef0f4}
  .s svg{width:100%;height:100%;display:block}.l{font-size:10px;color:#777;margin-top:2px}
</style></head><body>
<h1>Zoom critique — layer collisions at 180px</h1>
${group('Hair alone (scalp join, silhouette)', hairs.map((h) => [h, { hair: { style: h, color: H } }]))}
${group('Hair under an ENCLOSING hood', hairs.slice(0, 8).map((h) => [h, { hair: { style: h, color: H }, headwear: { style: 'hood', color: '#7c6ff0' } }]))}
${group('Hair under a beanie (partial cover)', hairs.slice(0, 8).map((h) => [h, { hair: { style: h, color: H }, headwear: { style: 'beanie', color: '#7c6ff0' } }]))}
${group('Neck in the collar (every garment)', outfits.map((o) => [o, { hair: { style: 'short', color: H }, outfit: { style: o, color: '#b9c0d6' } }]))}
${group('Dark skin (shading + collar contrast)', outfits.slice(0, 6).map((o) => [o, { skin: '#6b4630', hair: { style: 'afro', color: '#241a14' }, outfit: { style: o, color: '#b9c0d6' } }]))}
${group('Beard × long hair (jaw seam)', ['stubble', 'shortBeard', 'fullBeard', 'longBeard', 'muttonChops', 'goatee'].map((f) => [f, { hair: { style: 'longStraight', color: H }, facialHair: { style: f, color: '#9a9a9a' } }]))}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('body').screenshot({ path: join(__dir, 'zoom.png') });
console.log(`wrote ${join(__dir, 'zoom.png')}`);
await browser.close();
