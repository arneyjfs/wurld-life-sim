/**
 * Renders results-lean.json: original head-shot SVG vs the lean (economy-of-
 * line) SVG, each big + at the real 32px chat slot, with output-token counts.
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/render-lean.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dir = dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(readFileSync(join(__dir, 'results-lean.json'), 'utf8'));

const slot = (svg, px) => `<div class="slot" style="width:${px}px;height:${px}px">${svg}</div>`;
const cell = (label, svg, tok) => `<div class="cell"><div class="tag">${label} · ${tok} tok</div><div class="row">${slot(svg, 96)}${slot(svg, 32)}</div></div>`;

const rows = data.characters.map((c) => `
  <div class="char"><div class="name">${c.name} <span>— ${c.role}</span></div>
    <div class="cells">
      ${cell('SVG (current)', c.svg.text, c.svg.tokens.out)}
      ${cell('SVG (lean)', c.lean.text, c.lean.tokens.out)}
    </div></div>`).join('');

const s = data.summary;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#faf8f5;font-family:-apple-system,system-ui,sans-serif;color:#222;width:760px}
  h1{font-size:20px;margin:0 0 4px}.sub{color:#777;font-size:13px;margin-bottom:18px}
  .summary{background:#fff;border:1px solid #eee;border-radius:12px;padding:12px 16px;margin-bottom:18px;font-size:13px}
  .char{background:#fff;border:1px solid #eee;border-radius:16px;padding:16px;margin-bottom:14px}
  .name{font-weight:700;font-size:15px;margin-bottom:12px}.name span{font-weight:400;color:#888;font-size:13px}
  .cells{display:flex;gap:32px}.cell{flex:1}
  .tag{font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#7340f5;margin-bottom:8px}
  .row{display:flex;align-items:center;gap:16px}
  .slot{border-radius:50%;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.12);background:#fff;flex:0 0 auto}
  .slot svg{width:100%;height:100%;display:block}
</style></head><body>
  <h1>SVG: current vs "economy of line" (lean) — head-shot</h1>
  <div class="sub">model ${data.model} · same character prompt, leaner drawing budget · output tokens per gen</div>
  <div class="summary"><b>Output tokens (${s.count}):</b> current total ${s.sumO} (avg ${Math.round(s.sumO / s.count)}) · lean total ${s.sumL} (avg ${Math.round(s.sumL / s.count)}) — lean is <b>${(s.sumL / s.sumO).toFixed(2)}×</b> the current.</div>
  ${rows}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
await page.locator('body').screenshot({ path: join(__dir, 'comparison-lean.png') });
console.log(`wrote ${join(__dir, 'comparison-lean.png')}`);
await browser.close();
