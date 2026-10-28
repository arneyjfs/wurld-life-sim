/**
 * Renders results.json into a comparison PNG: for each character, the SVG
 * full-body figure and the pixel-matrix full-body figure side by side, big and
 * small, so silhouette + character read is comparable. Handles rectangular
 * pixel grids (W×H).
 *
 * Run from tests/e2e so `playwright` resolves:
 *   cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/render.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.OUT_PNG || 'comparison.png';
const RESULTS = process.env.RESULTS_JSON || 'results.json';
const data = JSON.parse(readFileSync(join(__dir, RESULTS), 'utf8'));

/** Pixel matrix → crisp SVG (bg = palette[0], then non-bg pixels). Rectangular. */
function pixelToSvg(text) {
  let obj;
  try {
    obj = JSON.parse(text);
  } catch {
    return `<svg viewBox="0 0 20 32" xmlns="http://www.w3.org/2000/svg"><rect width="20" height="32" fill="#eee"/></svg>`;
  }
  const palette = Array.isArray(obj.palette) ? obj.palette : ['#eee'];
  const rows = Array.isArray(obj.rows) ? obj.rows.map(String) : [];
  const h = rows.length || 32;
  const w = rows[0]?.length || 20;
  const rects = [];
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < rows[r].length; c++) {
      const idx = parseInt(rows[r][c], 16);
      if (Number.isNaN(idx) || idx === 0) continue;
      rects.push(`<rect x="${c}" y="${r}" width="1.03" height="1.03" fill="${palette[idx] ?? '#000'}"/>`);
    }
  }
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid meet" shape-rendering="crispEdges" xmlns="http://www.w3.org/2000/svg"><rect width="${w}" height="${h}" fill="${palette[0] ?? '#fff'}"/>${rects.join('')}</svg>`;
}

// 5:8 standing-figure frames.
const frame = (svg, w) =>
  `<div class="frame" style="width:${w}px;height:${Math.round(w * 1.6)}px">${svg}</div>`;

const cell = (label, svg, outTok) => `
  <div class="cell">
    <div class="tag">${label} · ${outTok} tok</div>
    <div class="row">${frame(svg, 104)}${frame(svg, 48)}</div>
  </div>`;

const rowsHtml = data.characters
  .map(
    (c) => `
  <div class="char">
    <div class="name">${c.name} <span>— ${c.role}</span></div>
    <div class="cells">
      ${cell('SVG', c.svg.text, c.svg.tokens.out)}
      ${cell('PIXEL', pixelToSvg(c.pixel.text), c.pixel.tokens.out)}
    </div>
  </div>`,
  )
  .join('');

const s = data.summary;
const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body { margin:0; padding:24px; background:#faf8f5; font-family:-apple-system,system-ui,sans-serif; color:#222; width:820px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .sub { color:#777; font-size:13px; margin-bottom:18px; }
  .summary { background:#fff; border:1px solid #eee; border-radius:12px; padding:12px 16px; margin-bottom:18px; font-size:13px; }
  .char { background:#fff; border:1px solid #eee; border-radius:16px; padding:16px; margin-bottom:14px; }
  .name { font-weight:700; font-size:15px; margin-bottom:12px; }
  .name span { font-weight:400; color:#888; font-size:13px; }
  .cells { display:flex; gap:40px; }
  .cell { flex:1; }
  .tag { font-size:11px; font-weight:700; letter-spacing:.04em; text-transform:uppercase; color:#7340f5; margin-bottom:8px; }
  .row { display:flex; align-items:flex-end; gap:18px; }
  .frame { border-radius:12px; overflow:hidden; box-shadow:0 1px 4px rgba(0,0,0,.12); background:#fff; flex:0 0 auto; }
  .frame svg { width:100%; height:100%; display:block; }
</style></head><body>
  <h1>Avatar generation: SVG vs pixel-matrix — FULL BODY</h1>
  <div class="sub">model ${data.model} · standing figures shown at 104px and 48px wide · output-token count per gen</div>
  <div class="summary">
    <b>Output tokens (${s.count} characters):</b> SVG total ${s.svgOut} (avg ${Math.round(s.svgOut / s.count)}) · PIXEL total ${s.pixOut} (avg ${Math.round(s.pixOut / s.count)}) — pixel is <b>${(s.pixOut / s.svgOut).toFixed(2)}×</b> the SVG output.
  </div>
  ${rowsHtml}
</body></html>`;

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'networkidle' });
const outPng = join(__dir, OUT);
await page.locator('body').screenshot({ path: outPng });
console.log(`wrote ${outPng}`);
await browser.close();
