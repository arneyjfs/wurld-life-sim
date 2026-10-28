/**
 * Parts+params runner: the model picks parts (tiny JSON) → assemble; if it
 * signals fallback OR names an unknown option, draw the lean SVG instead.
 * Records which path + the output tokens for each.
 *   GEMINI_API_KEY=... node run-parts.mjs
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildPrompt, CHARACTERS } from './prompts.mjs';
import { PARAMS_SI, LEAN_SVG_SI } from './gen-prompt.mjs';
import { assembleAvatar } from './assemble.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) { console.error('ERROR: GEMINI_API_KEY not set.'); process.exit(1); }
const MODEL = process.env.AVATAR_MODEL || 'gemini-3-flash-preview';
const __dir = dirname(fileURLToPath(import.meta.url));

async function gen(si, prompt, mime) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = { systemInstruction: { parts: [{ text: si }] }, contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 1, responseMimeType: mime } };
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
const strip = (raw) => { const t = raw.trim(); if (!t.startsWith('```')) return t; const l = t.split('\n'); l.shift(); if (l.at(-1)?.startsWith('```')) l.pop(); return l.join('\n').trim(); };

const out = { model: MODEL, characters: [] };
for (const c of CHARACTERS) {
  process.stdout.write(`${c.key}: params…`);
  const pr = await gen(PARAMS_SI, buildPrompt(c), 'application/json');
  let params = null;
  try { params = JSON.parse(pr.text); } catch { params = { fallback: true }; }

  let svg, path, fb = null;
  if (params?.fallback) {
    const lean = await gen(LEAN_SVG_SI, buildPrompt(c), 'text/plain');
    svg = lean.text; path = 'fallback:model'; fb = lean.tokens;
  } else {
    const asm = assembleAvatar(params);
    if (asm.svg) { svg = asm.svg; path = 'parts'; }
    else {
      process.stdout.write(` (invalid: ${asm.errors.join(',')}) lean…`);
      const lean = await gen(LEAN_SVG_SI, buildPrompt(c), 'text/plain');
      svg = lean.text; path = 'fallback:invalid'; fb = lean.tokens;
    }
  }
  const effOut = pr.tokens.out + (fb?.out ?? 0);
  console.log(` ${path}  [params out ${pr.tokens.out}${fb ? ` + lean ${fb.out}` : ''} = ${effOut} tok]`);
  out.characters.push({ ...c, params, svg, path, paramsTokens: pr.tokens, fbTokens: fb, effOut });
}

const eff = out.characters.reduce((n, c) => n + c.effOut, 0);
const parts = out.characters.filter((c) => c.path === 'parts').length;
console.log(`\n${parts}/${out.characters.length} via parts · effective output total ${eff} (avg ${Math.round(eff / out.characters.length)} tok)`);
out.summary = { eff, count: out.characters.length, partsCount: parts };
writeFileSync(join(__dir, 'results-parts.json'), JSON.stringify(out, null, 2));
console.log('wrote results-parts.json');
