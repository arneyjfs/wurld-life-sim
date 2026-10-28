/**
 * Runs the avatar experiment: for each test character, generate a portrait BOTH
 * ways (current SVG prompt, new pixel-matrix prompt) with real Gemini, and
 * record the output + token usage. Writes results.json for render.mjs.
 *
 *   GEMINI_API_KEY=... node run.mjs            # all characters
 *   GEMINI_API_KEY=... node run.mjs witch      # one character
 *
 * Uses a SEPARATE dev key (AI Studio, non-prod project) — never the app key
 * (keeps prod tokenUsage telemetry clean; see tests/prompts/README.md).
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SVG_SI, PIXEL_SI, buildPrompt, CHARACTERS } from './prompts.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.error('ERROR: GEMINI_API_KEY not set (AI Studio dev key, NOT the app key).');
  process.exit(1);
}
const MODEL = process.env.AVATAR_MODEL || 'gemini-3-flash-preview';
const __dir = dirname(fileURLToPath(import.meta.url));

const only = process.argv.slice(2);
const cast = only.length ? CHARACTERS.filter((c) => only.includes(c.key)) : CHARACTERS;

async function gen(si, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${KEY}`;
  const body = {
    systemInstruction: { parts: [{ text: si }] },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 1, responseMimeType: 'text/plain' },
  };
  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text();
        throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
      }
      const json = await res.json();
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
      const u = json.usageMetadata ?? {};
      return {
        text: strip(text),
        tokens: {
          in: u.promptTokenCount ?? 0,
          out: u.candidatesTokenCount ?? 0,
          total: u.totalTokenCount ?? 0,
        },
      };
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  throw lastErr;
}

function strip(raw) {
  const t = raw.trim();
  if (!t.startsWith('```')) return t;
  const lines = t.split('\n');
  lines.shift();
  if (lines[lines.length - 1]?.startsWith('```')) lines.pop();
  return lines.join('\n').trim();
}

const results = { model: MODEL, generatedAt: new Date().toISOString(), characters: [] };
for (const c of cast) {
  const prompt = buildPrompt(c);
  process.stdout.write(`${c.key}: svg…`);
  const svg = await gen(SVG_SI, prompt);
  process.stdout.write(` pixel…`);
  const pixel = await gen(PIXEL_SI, prompt);
  console.log(
    ` done  [svg out ${svg.tokens.out} tok · pixel out ${pixel.tokens.out} tok]`,
  );
  results.characters.push({ ...c, svg, pixel });
}

// Token summary.
const sum = (fn) => results.characters.reduce((n, c) => n + fn(c), 0);
const svgOut = sum((c) => c.svg.tokens.out);
const pixOut = sum((c) => c.pixel.tokens.out);
const svgIn = sum((c) => c.svg.tokens.in);
const pixIn = sum((c) => c.pixel.tokens.in);
console.log('\n──────── token totals (%d characters) ────────', results.characters.length);
console.log(`SVG   : in ${svgIn}  out ${svgOut}  (avg out ${Math.round(svgOut / results.characters.length)})`);
console.log(`PIXEL : in ${pixIn}  out ${pixOut}  (avg out ${Math.round(pixOut / results.characters.length)})`);
console.log(`output tokens: pixel is ${(pixOut / svgOut).toFixed(2)}× the SVG (lower = cheaper)`);

results.summary = { svgIn, svgOut, pixIn, pixOut, count: results.characters.length };
const out = join(__dir, 'results.json');
writeFileSync(out, JSON.stringify(results, null, 2));
console.log(`\nwrote ${out}`);
