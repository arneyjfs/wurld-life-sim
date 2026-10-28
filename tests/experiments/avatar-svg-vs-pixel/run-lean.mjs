/**
 * Idea #2: can a LEANER prompt keep the SVG's expressiveness at a fraction of
 * the tokens? Same head-shot portrait intent as the current prompt, but with an
 * "economy of line" budget: small integer-coord viewBox, a hard shape cap, flat
 * fills. Compares against the original head-shot SVGs (results-headshot.json).
 *
 *   GEMINI_API_KEY=... node run-lean.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPrompt, CHARACTERS } from './prompts.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('ERROR: GEMINI_API_KEY not set.'); process.exit(1); }
const MODEL = process.env.AVATAR_MODEL || 'gemini-3-flash-preview';
const __dir = dirname(fileURLToPath(import.meta.url));

const LEAN_SVG_SI = [
  `You draw small character portraits as SVG for a 32px circular chat slot — it reads tiny, so BOLD economy matters far more than detail.`,
  ``,
  `OUTPUT:`,
  `Return ONLY the SVG. Root: <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">…</svg>. No width/height. No <text>/<script>/<image>/external URLs/animations.`,
  ``,
  `TOKEN BUDGET — this is a hard constraint:`,
  `• Use AT MOST ~14 shapes total. Every shape must earn its place — a confident illustrator's economy of line, not a detailed render.`,
  `• Round EVERY coordinate to a whole integer.`,
  `• FLAT fills only — no gradients, no <defs>, no filters. Short hex (#abc) where you can.`,
  `• Prefer <circle>/<ellipse>/<rect>; use <path> only when a shape truly needs it, with as few points as possible.`,
  ``,
  `STYLE:`,
  `Friendly children's-book illustration, warm pastel palette, soft rounded shapes. Not creepy, not hyper-real.`,
  ``,
  `COMPOSITION:`,
  `A solid pastel background rect fills the canvas. Head + shoulders, centred, face in the upper-middle. The face is the focal point.`,
  ``,
  `MAKE IT EXPRESSIVE WITH FEW SHAPES:`,
  `• Eyes: give them shape + a pupil, not bare dots.`,
  `• Mouth: one small shape suggesting an expression that fits the person (sly, tired, cheerful, stern).`,
  `• Hair: one or two shapes with a clear colour + style.`,
  `• Read <role> + <worldVibe> and add the ONE detail that names the character (a pointed hat, a collar + tie, a cap, an eyepatch). Skin one warm tone.`,
  ``,
  `Return only the SVG. No prose.`,
].join('\n');

async function gen(si, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = { systemInstruction: { parts: [{ text: si }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1, responseMimeType: 'text/plain' } };
  for (let a = 0; a < 3; a++) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      const text = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
      const u = j.usageMetadata ?? {};
      return { text: strip(text), tokens: { in: u.promptTokenCount ?? 0, out: u.candidatesTokenCount ?? 0 } };
    } catch (e) { if (a === 2) throw e; await new Promise((r) => setTimeout(r, 1500 * (a + 1))); }
  }
}
function strip(raw) { const t = raw.trim(); if (!t.startsWith('```')) return t; const l = t.split('\n'); l.shift(); if (l.at(-1)?.startsWith('```')) l.pop(); return l.join('\n').trim(); }

const base = JSON.parse(readFileSync(join(__dir, 'results-headshot.json'), 'utf8'));
const baseOut = Object.fromEntries(base.characters.map((c) => [c.key, c.svg]));

const out = { model: MODEL, characters: [] };
for (const c of CHARACTERS) {
  process.stdout.write(`${c.key}: lean-svg…`);
  const lean = await gen(LEAN_SVG_SI, buildPrompt(c));
  const orig = baseOut[c.key];
  console.log(` done  [orig ${orig.tokens.out} → lean ${lean.tokens.out} tok  (${(lean.tokens.out / orig.tokens.out * 100).toFixed(0)}%)]`);
  out.characters.push({ ...c, svg: orig, lean });
}
const sumO = out.characters.reduce((n, c) => n + c.svg.tokens.out, 0);
const sumL = out.characters.reduce((n, c) => n + c.lean.tokens.out, 0);
console.log(`\nSVG orig out ${sumO} (avg ${Math.round(sumO / out.characters.length)}) · lean out ${sumL} (avg ${Math.round(sumL / out.characters.length)}) — lean is ${(sumL / sumO).toFixed(2)}× the original`);
out.summary = { sumO, sumL, count: out.characters.length };
writeFileSync(join(__dir, 'results-lean.json'), JSON.stringify(out, null, 2));
console.log(`wrote results-lean.json`);
