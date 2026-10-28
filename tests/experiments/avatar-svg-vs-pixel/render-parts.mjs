/**
 * Renders results-parts.json: the assembled (or fallback) avatar per character,
 * which path it took, the chosen parts, and the effective output tokens.
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/render-parts.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dir = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dir, 'results-parts.json'), 'utf8'));

const partsDesc = (p) => {
  if (!p || p.fallback) return 'fallback';
  const bits = [
    p.hair && `hair:${p.hair.style}`,
    p.headwear?.style && p.headwear.style !== 'none' && `hat:${p.headwear.style}`,
    p.facialHair?.style && p.facialHair.style !== 'none' && `beard:${p.facialHair.style}`,
    p.outfit && `outfit:${p.outfit.style}`,
    p.mouth && `mouth:${p.mouth}`,
    p.accessory && p.accessory !== 'none' && `+${p.accessory}`,
  ].filter(Boolean);
  return bits.join(' · ');
};

const cells = data.characters.map((c) => `
  <div class="char">
    <div class="slot" style="width:104px;height:104px">${c.svg}</div>
    <div class="slot" style="width:34px;height:34px">${c.svg}</div>
    <div class="meta">
      <div class="name">${c.name} <span>— ${c.role}</span></div>
      <div class="tag ${c.path.startsWith('fallback') ? 'fb' : ''}">${c.path} · ${c.effOut} tok</div>
      <div class="desc">${partsDesc(c.params)}</div>
    </div>
  </div>`).join('');

const s = data.summary;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#faf8f5;font-family:system-ui,sans-serif;color:#222;width:720px}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#777;font-size:13px;margin-bottom:16px}
  .summary{background:#fff;border:1px solid #eee;border-radius:12px;padding:12px 16px;margin-bottom:16px;font-size:13px}
  .char{background:#fff;border:1px solid #eee;border-radius:16px;padding:14px 16px;margin-bottom:12px;display:flex;align-items:center;gap:16px}
  .slot{border-radius:50%;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.12);flex:0 0 auto}
  .slot svg{width:100%;height:100%;display:block}
  .meta{flex:1}.name{font-weight:700;font-size:15px}.name span{font-weight:400;color:#888;font-size:12px}
  .tag{display:inline-block;margin-top:4px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#2e9e5b}
  .tag.fb{color:#c9772a}
  .desc{font-size:11px;color:#999;margin-top:3px}
</style></head><body>
  <h1>Parts + params avatars (fallback → lean SVG)</h1>
  <div class="sub">model ${data.model} · effective output tokens per avatar (params JSON, or lean SVG on fallback)</div>
  <div class="summary"><b>${s.partsCount}/${s.count}</b> assembled from parts · effective output avg <b>${Math.round(s.eff / s.count)} tok</b> — vs current SVG ~968 and lean SVG ~409.</div>
  ${cells}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('body').screenshot({ path: join(__dir, 'comparison-parts.png') });
console.log(`wrote ${join(__dir, 'comparison-parts.png')}`);
await browser.close();
