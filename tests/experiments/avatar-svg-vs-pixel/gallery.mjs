/**
 * Cohesion gallery: many diverse archetypes assembled from the part library, the
 * real "does this produce cute, varied, believable characters — and do the
 * COMBINATIONS join up?" test (the per-slot sampler only judges parts alone).
 * Each entry is the kind of params the model would emit for that role.
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/gallery.mjs
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';
import { assembleAvatar } from './assemble.mjs';

const __dir = dirname(fileURLToPath(import.meta.url));

// role, then params — colours chosen to carry the character.
const CHARS = [
  ['Witch', { bg: '#e7dcf5', skin: '#efc4a2', hair: { style: 'longStraight', color: '#2b1f3d' }, headwear: { style: 'witchHat', color: '#4a2a6b' }, eyes: 'sparkle', brows: 'raised', mouth: 'smirk', outfit: { style: 'robe', color: '#2e2140' } }],
  ['Wizard', { bg: '#dfe6f2', skin: '#e9b98d', hair: { style: 'longStraight', color: '#d8d8d8' }, facialHair: { style: 'longBeard', color: '#e2e2e2' }, headwear: { style: 'witchHat', color: '#2b3a67' }, eyes: 'almond', brows: 'raised', mouth: 'slight', outfit: { style: 'robe', color: '#33508a' } }],
  ['Office worker', { bg: '#e4e8ee', skin: '#f0c19a', hair: { style: 'short', color: '#4a3626' }, facialHair: { style: 'stubble', color: '#4a3420' }, eyes: 'sleepy', brows: 'furrowed', mouth: 'frown', outfit: { style: 'shirtTie', color: '#2b3a67' }, accessory: 'glasses' }],
  ['Executive', { bg: '#eae4ef', skin: '#e6b48a', hair: { style: 'bob', color: '#3a2b1d' }, eyes: 'almond', brows: 'neutral', mouth: 'neutral', outfit: { style: 'suit', color: '#3a3550' }, accessory: 'earrings' }],
  ['Old fisherman', { bg: '#bcd6e6', skin: '#dca878', hair: { style: 'cropped', color: '#cfcfcf' }, facialHair: { style: 'fullBeard', color: '#dedede' }, headwear: { style: 'cap', color: '#22314a' }, eyes: 'squint', mouth: 'slight', outfit: { style: 'apron', color: '#f2b705' } }],
  ['Child (girl)', { bg: '#fbe0ea', skin: '#f7cfae', hair: { style: 'pigtails', color: '#7a4a2a' }, headwear: { style: 'flowerCrown', color: '#f48fb1' }, eyes: 'wide', mouth: 'grin', accessory: 'freckles', outfit: { style: 'dress', color: '#f48fb1' } }],
  ['Child (boy)', { bg: '#e0f0ea', skin: '#eeb98d', hair: { style: 'fringe', color: '#3a2b1d' }, eyes: 'wide', brows: 'raised', mouth: 'laugh', outfit: { style: 'tee', color: '#3aa76d' }, accessory: 'freckles' }],
  ['Knight', { bg: '#cdd9ea', skin: '#eeb98d', hair: { style: 'cropped', color: '#6b4a2f' }, headwear: { style: 'helmet', color: '#aeb6bf' }, eyes: 'almond', brows: 'furrowed', mouth: 'neutral', outfit: { style: 'armour', color: '#b9c0c7' } }],
  ['Punk', { bg: '#2b2733', skin: '#f0c19a', hair: { style: 'mohawk', color: '#ff2d95' }, eyes: 'almond', mouth: 'smirk', accessory: 'earrings', outfit: { style: 'hoodie', color: '#1c1c22' } }],
  ['Doctor', { bg: '#dff0ef', skin: '#c98a5e', hair: { style: 'cropped', color: '#1c1c22' }, eyes: 'almond', brows: 'neutral', mouth: 'slight', outfit: { style: 'labCoat', color: '#4a90c2' }, accessory: 'glasses' }],
  ['Chef', { bg: '#f0ece2', skin: '#f0c19a', hair: { style: 'short', color: '#3a2b1d' }, facialHair: { style: 'mustache', color: '#3a2b1d' }, headwear: { style: 'chefHat', color: '#f6f6f6' }, eyes: 'happy', mouth: 'smile', outfit: { style: 'apron', color: '#e8ecf1' } }],
  ['Farmer', { bg: '#eaf0d8', skin: '#dca878', hair: { style: 'short', color: '#6b4a2f' }, facialHair: { style: 'stubble', color: '#5a3d28' }, headwear: { style: 'strawHat', color: '#d9a441' }, eyes: 'squint', mouth: 'smile', outfit: { style: 'overalls', color: '#4a6fa5' } }],
  ['Barista', { bg: '#efe6dc', skin: '#e6b48a', hair: { style: 'bun', color: '#2b1f14' }, eyes: 'almond', mouth: 'smile', headwear: { style: 'beanie', color: '#8d6e4a' }, outfit: { style: 'apron', color: '#3a3230' } }],
  ['Granny', { bg: '#f2e7ef', skin: '#eec3a4', hair: { style: 'bun', color: '#e6e6e6' }, eyes: 'happy', brows: 'raised', mouth: 'smile', outfit: { style: 'scarf', color: '#b0577a' }, accessory: 'roundGlasses' }],
  ['Soldier', { bg: '#d8ded0', skin: '#d69a6a', hair: { style: 'buzz', color: '#3a2b1d' }, headwear: { style: 'cap', color: '#5a6b48' }, eyes: 'almond', brows: 'furrowed', mouth: 'neutral', outfit: { style: 'uniform', color: '#5a6b48' } }],
  ['Artist', { bg: '#f0e8dc', skin: '#f0c19a', hair: { style: 'waves', color: '#3a2b1d' }, facialHair: { style: 'goatee', color: '#3a2b1d' }, headwear: { style: 'beret', color: '#c0392b' }, eyes: 'sparkle', mouth: 'slight', outfit: { style: 'sweater', color: '#5a7d8c' } }],
  ['Monk', { bg: '#f2e6d0', skin: '#d69a6a', hair: { style: 'bald', color: '#000' }, eyes: 'sleepy', brows: 'neutral', mouth: 'slight', outfit: { style: 'robe', color: '#c06a2a' } }],
  ['Pirate', { bg: '#cfe0e2', skin: '#dca878', hair: { style: 'longStraight', color: '#1c1c14' }, facialHair: { style: 'fullBeard', color: '#1c1c14' }, headwear: { style: 'bandana', color: '#a83232' }, eyes: 'squint', mouth: 'smirk', outfit: { style: 'cloak', color: '#5a3a2a' }, accessory: 'eyepatch' }],
  ['Teacher', { bg: '#e6ecf2', skin: '#eec3a4', hair: { style: 'sidePart', color: '#5a3d28' }, eyes: 'almond', brows: 'neutral', mouth: 'smile', outfit: { style: 'sweater', color: '#8a6d3a' }, accessory: 'roundGlasses' }],
  ['Rockstar', { bg: '#2a2730', skin: '#e6b48a', hair: { style: 'longStraight', color: '#1c1c1c' }, eyes: 'almond', mouth: 'smirk', outfit: { style: 'tank', color: '#7a1f2a' }, accessory: 'sunglasses' }],
  ['King', { bg: '#efe2d0', skin: '#b06a3a', hair: { style: 'short', color: '#1c1c1c' }, facialHair: { style: 'fullBeard', color: '#1c1c1c' }, headwear: { style: 'crown', color: '#e8b23a' }, eyes: 'almond', brows: 'neutral', mouth: 'neutral', outfit: { style: 'cloak', color: '#7a1f4a' } }],
  ['Scientist', { bg: '#e4eef0', skin: '#f0c19a', hair: { style: 'curly', color: '#6b4a2f' }, eyes: 'wide', brows: 'raised', mouth: 'open', outfit: { style: 'labCoat', color: '#4a90c2' }, accessory: 'glasses' }],
  ['Nurse', { bg: '#e6f0ef', skin: '#c98a5e', hair: { style: 'ponytail', color: '#2b1f14' }, eyes: 'almond', mouth: 'smile', outfit: { style: 'labCoat', color: '#3aa78c' } }],
  ['Athlete', { bg: '#e0ecf2', skin: '#a86a42', hair: { style: 'afro', color: '#1c1c1c' }, headwear: { style: 'headband', color: '#e83a3a' }, eyes: 'almond', brows: 'raised', mouth: 'grin', outfit: { style: 'tank', color: '#2b6fc2' } }],
];

const cell = (role, p) => {
  const { svg, errors } = assembleAvatar(p);
  const body = svg
    ? `<div class="s">${svg}</div>`
    : `<div class="s err">ERR<br>${errors.join(' ')}</div>`;
  return `<div class="c">${body}<div class="l">${role}</div></div>`;
};

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#fff;font-family:system-ui,sans-serif;color:#222;width:1000px}
  h1{font-size:19px;margin:0 0 4px}.sub{font-size:12px;color:#888;margin:0 0 16px}
  .grid{display:flex;flex-wrap:wrap;gap:14px}
  .c{text-align:center;width:150px}
  .s{width:150px;height:150px;border-radius:20px;overflow:hidden;background:#eef0f4;box-shadow:0 2px 6px rgba(0,0,0,.12)}
  .s svg{width:100%;height:100%;display:block}
  .s.err{display:flex;align-items:center;justify-content:center;color:#c0392b;font-size:11px;font-weight:700}
  .l{font-size:12px;color:#555;margin-top:5px;font-weight:600}
</style></head><body>
  <h1>Cohesion gallery — ${CHARS.length} archetypes</h1>
  <div class="sub">assembled from the part library; the params each row uses are what the model would pick for the role</div>
  <div class="grid">${CHARS.map(([r, p]) => cell(r, p)).join('')}</div>
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('body').screenshot({ path: join(__dir, 'gallery.png') });
console.log(`wrote ${join(__dir, 'gallery.png')}`);
await browser.close();
