/**
 * Direct Gemini caller for the headless playthrough harness.
 *
 * Deliberately bypasses the Cloud Function wrapper: the harness drives the REAL
 * prompt builders from `src/lib/life/prompts/**` against the REAL model, but
 * needs no Firebase auth, no emulator and no browser. What it measures is the
 * only thing that matters here — what the model does when handed our prompts.
 *
 * Reads `GEMINI_API_KEY` from the repo-root `.env.local` (gitignored),
 * exactly as `tests/prompts/_shared/gemini_call.py` does.
 *
 * COST IS TRACKED AND ENFORCED. Every call's token usage is accumulated and
 * priced; `assertBudget` throws once the run exceeds its ceiling, so a runaway
 * loop cannot quietly spend real money.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * Repo root, resolved without `__dirname`.
 *
 * This file is loaded two ways: by vitest (which transpiles to a CJS-ish module
 * where `__dirname` exists) and by `tsx` for the `rescore` / `rejudge` CLIs,
 * where it is genuine ESM and `__dirname` is not defined. It used to be
 * `path.resolve(__dirname, '../..')`, so every CLI that reached the transport
 * died on `ReferenceError: __dirname is not defined in ES module scope`.
 *
 * `process.cwd()` is correct for both: every entry point runs from the repo
 * root (npm scripts, vitest, and the CLIs as documented). The env var wins
 * anyway, so the file read is a local-dev convenience, not a load-bearing path.
 */
const ROOT = process.cwd();

function apiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv) return fromEnv;
  const envFile = path.join(ROOT, '.env.local');
  const raw = fs.readFileSync(envFile, 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY not found in .env.local');
  return line.slice('GEMINI_API_KEY='.length).trim();
}

/** gemini-3.1-flash-lite list price per 1M tokens, USD. Used only to keep the
 *  harness honest about spend — an order-of-magnitude guard, not billing. */
const PRICE_IN_PER_M = 0.1;
const PRICE_OUT_PER_M = 0.4;

export type Usage = { inTokens: number; outTokens: number; calls: number };
const usage: Usage = { inTokens: 0, outTokens: 0, calls: 0 };

export function totals(): Usage & { usd: number } {
  return {
    ...usage,
    usd:
      (usage.inTokens / 1e6) * PRICE_IN_PER_M +
      (usage.outTokens / 1e6) * PRICE_OUT_PER_M,
  };
}

export function assertBudget(ceilingUsd: number): void {
  const { usd } = totals();
  if (usd > ceilingUsd) {
    throw new Error(
      `playthrough budget exceeded: $${usd.toFixed(3)} > $${ceilingUsd.toFixed(2)} after ${usage.calls} calls`,
    );
  }
}

export type CallOpts = {
  systemInstruction: string;
  prompt: string;
  model?: string;
  temperature?: number;
  responseSchema?: unknown;
  label: string;
};

/** One generation. Retries transport failures the way the app does — this
 *  container's egress to generativelanguage.googleapis.com is intermittent, and
 *  a dropped socket says nothing about the prompt under test. */
export async function callGemini(opts: CallOpts): Promise<string> {
  const model = opts.model ?? 'gemini-3.1-flash-lite';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey()}`;
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: opts.systemInstruction }] },
    contents: [{ role: 'user', parts: [{ text: opts.prompt }] }],
    generationConfig: {
      temperature: opts.temperature ?? 0.95,
      responseMimeType: 'application/json',
      ...(opts.responseSchema ? { responseSchema: opts.responseSchema } : {}),
    },
  };

  const backoffs = [500, 1500, 4000];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= backoffs.length; attempt += 1) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`${opts.label}: HTTP ${res.status} ${txt.slice(0, 300)}`);
      }
      const json = (await res.json()) as {
        candidates?: { content?: { parts?: { text?: string }[] } }[];
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      usage.calls += 1;
      usage.inTokens += json.usageMetadata?.promptTokenCount ?? 0;
      usage.outTokens += json.usageMetadata?.candidatesTokenCount ?? 0;
      const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
      if (!text.trim()) throw new Error(`${opts.label}: empty response`);
      return text;
    } catch (err) {
      lastErr = err;
      if (attempt === backoffs.length) break;
      await new Promise((r) => setTimeout(r, backoffs[attempt]!));
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}
