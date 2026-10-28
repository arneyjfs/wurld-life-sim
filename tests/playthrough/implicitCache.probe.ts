/**
 * LIFE-CTX-17 PROBE — does the implicit cache see our system instruction?
 *
 *   npx vitest run --config tests/playthrough/vitest.config.ts implicitCache.probe
 *
 * ── WHY ─────────────────────────────────────────────────────────────────────
 *
 * `life_step` is the single biggest line on the bill: 95 of 158 calls in a
 * three-world playthrough, 22,240 input tokens each against 694 output — 32:1,
 * so it is an INPUT cost problem, not an output one. Regressing inTokens on
 * prompt length across those 95 calls puts the fixed part at 18,031 tokens
 * (0.264 tokens/char × 74,140 SI chars ≈ 19.5k, same number within noise):
 *
 *     inTokens ≈ 18,031 + 0.2636 × promptChars      (n=95, prompt 10.6k–19k chars)
 *
 * 81% of every life_step request is the SAME 74,140 characters as the request
 * before it. Within one world the SI is byte-identical on every turn — 3
 * distinct SIs across 95 calls, one per world, because it interpolates only
 * (practiceLanguage, nativeLanguage, systemLanguage, difficulty).
 *
 * That is the ideal shape for a prefix cache, and cached tokens bill at 10%.
 * So the question worth real money is simply: DOES IT HIT? Two claims are on
 * the table and they contradict each other:
 *
 *   - `explicitSiCache.ts` says life_step gets nothing, and pushes the fix
 *     towards an EXPLICIT cache (which fragments per language-pair×difficulty
 *     and costs storage rent).
 *   - The v2 engine branch says the fix is to stop sending `systemInstruction:`
 *     and append everything to `contents:` instead.
 *
 * Neither was measured. Both are cheap to test, and the answer decides whether
 * COST-1 is a one-line change, a keying change, or a request-shape change.
 *
 * ── WHAT IT DOES ────────────────────────────────────────────────────────────
 *
 * Replays REAL archived life_step turns (same SI, consecutive prompts, same
 * model) back-to-back against real Gemini and reads `cachedContentTokenCount`
 * off each response. Three arms, identical token volume, differing only in
 * where the constant 74k characters are placed:
 *
 *   A  systemInstruction: {parts:[SI]}          — what we ship today
 *   B  contents: [user SI, model ack, user prompt] — the v2 shape
 *   C  contents: [user SI + "\n" + prompt]      — one turn, SI as prefix
 *
 * Arms run in sequence. The SI text is identical across all three, so a later
 * arm CAN inherit an earlier arm's warm cache — and if it does, that is itself
 * the answer: it means placement does not participate in the cache key.
 *
 * Read turns 2..N, not turn 1. Turn 1 is only cold on the very first run of a
 * fresh window; on a repeat run it hits a cache the previous run left warm, so
 * a non-zero turn 1 says nothing either way.
 *
 * ── RESULT, 2026-08-09 (LIFE-CTX-17) ────────────────────────────────────────
 *
 * All three arms cached 16,305–16,312 tokens — a spread of SEVEN tokens, 0.03%
 * — steady-state 75.6% each. Placement is irrelevant, and the shipped shape was
 * already getting the discount. Both claims above are refuted.
 *
 * Spends real money (~$0.03 at flash-lite list). Never in `npm test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const ARCHIVE = '2026-08-07T11-53-49-840Z-calls.json';
/** Turns per arm. 1 warm-up + 3 measured is enough to see a hit or its absence;
 *  every extra turn is ~22k billed input tokens. */
const TURNS = 4;
const MODEL = 'gemini-3.1-flash-lite';

function apiKey(): string {
  const fromEnv = process.env.GEMINI_API_KEY;
  if (fromEnv) return fromEnv;
  const raw = fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8');
  const line = raw.split('\n').find((l) => l.startsWith('GEMINI_API_KEY='));
  if (!line) throw new Error('GEMINI_API_KEY not found in .env.local');
  return line.slice('GEMINI_API_KEY='.length).trim();
}

type Archive = {
  systemInstructions: Record<string, string>;
  calls: { category: string; systemInstructionRef: string; prompt: string; inTokens: number }[];
};

type Sample = { turn: number; promptTokens: number; cached: number; total: number };

/** One raw generateContent, returning only the usage numbers this probe reads.
 *  Output is capped hard: we are measuring the INPUT accounting, and a full
 *  step response is ~700 tokens of story we would throw away. */
async function usageOf(
  body: Record<string, unknown>,
): Promise<Omit<Sample, 'turn'>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey()}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 400)}`);
  const json = (await res.json()) as {
    usageMetadata?: {
      promptTokenCount?: number;
      cachedContentTokenCount?: number;
      totalTokenCount?: number;
    };
  };
  const u = json.usageMetadata ?? {};
  return {
    promptTokens: u.promptTokenCount ?? 0,
    cached: u.cachedContentTokenCount ?? 0,
    total: u.totalTokenCount ?? 0,
  };
}

const generationConfig = {
  temperature: 0.95,
  responseMimeType: 'application/json',
  maxOutputTokens: 64,
  thinkingConfig: { thinkingLevel: 'minimal' },
};

/** Arm A — exactly the request `geminiGenerate` builds today. */
const armA = (si: string, prompt: string) => ({
  systemInstruction: { parts: [{ text: si }] },
  contents: [{ role: 'user', parts: [{ text: prompt }] }],
  generationConfig,
});

/** Arm B — the v2 shape: no systemInstruction, the constant block is the first
 *  user turn of an append-only conversation. */
const armB = (si: string, prompt: string) => ({
  contents: [
    { role: 'user', parts: [{ text: si }] },
    { role: 'model', parts: [{ text: 'Understood.' }] },
    { role: 'user', parts: [{ text: prompt }] },
  ],
  generationConfig,
});

/** Arm C — one user turn, constant block first. The cheapest possible change
 *  if placement turns out to matter but conversation structure does not. */
const armC = (si: string, prompt: string) => ({
  contents: [{ role: 'user', parts: [{ text: `${si}\n\n${prompt}` }] }],
  generationConfig,
});

describe('LIFE-CTX-17 — where the constant 74k characters have to sit to be cached', () => {
  it(
    'reports cachedContentTokenCount per turn for three request shapes',
    async () => {
      const archive = JSON.parse(
        fs.readFileSync(path.join(ROOT, '.playthroughs', ARCHIVE), 'utf8'),
      ) as Archive;

      // One world's consecutive life_step turns: same SI, growing prompt. That
      // is the real sequence a player generates, which is what the cache sees.
      const steps = archive.calls.filter((c) => c.category === 'life_step');
      const ref = steps[0]!.systemInstructionRef;
      const world = steps.filter((c) => c.systemInstructionRef === ref).slice(0, TURNS);
      const si = archive.systemInstructions[ref]!;
      expect(world.length).toBe(TURNS);

      // eslint-disable-next-line no-console
      console.log(
        `\nSI ${si.length} chars · ${world.length} turns · archived input ${world.map((c) => c.inTokens).join('/')}`,
      );

      const arms: [string, (si: string, p: string) => Record<string, unknown>][] = [
        ['A  systemInstruction:', armA],
        ['B  contents[user SI, ack, prompt]', armB],
        ['C  contents[user SI+prompt]', armC],
      ];

      const results: Record<string, Sample[]> = {};
      for (const [name, build] of arms) {
        const samples: Sample[] = [];
        for (let i = 0; i < world.length; i += 1) {
          const u = await usageOf(build(si, world[i]!.prompt));
          samples.push({ turn: i + 1, ...u });
          // eslint-disable-next-line no-console
          console.log(
            `${name.padEnd(34)} turn ${i + 1}  prompt=${String(u.promptTokens).padStart(6)}  cached=${String(u.cached).padStart(6)}  (${((u.cached / Math.max(1, u.promptTokens)) * 100).toFixed(1)}%)`,
          );
        }
        results[name] = samples;
      }

      // eslint-disable-next-line no-console
      console.log('\n── steady state (turns 2..N, the only ones a cache can serve) ──');
      for (const [name, samples] of Object.entries(results)) {
        const tail = samples.slice(1);
        const inTok = tail.reduce((s, x) => s + x.promptTokens, 0);
        const cached = tail.reduce((s, x) => s + x.cached, 0);
        // Cached input bills at 10% of the uncached rate.
        const billed = inTok - cached * 0.9;
        // eslint-disable-next-line no-console
        console.log(
          `${name.padEnd(34)} cached ${((cached / Math.max(1, inTok)) * 100).toFixed(1)}%  →  billed-equivalent ${(billed / tail.length).toFixed(0)} tok/turn (was ${(inTok / tail.length).toFixed(0)})`,
        );
      }

      // The probe's job is to REPORT. The only thing it asserts is that it
      // actually reached the model — a silent zero from a failed call would
      // read exactly like "the cache never hits", which is the conclusion this
      // is meant to establish or refute.
      for (const samples of Object.values(results)) {
        for (const s of samples) expect(s.promptTokens).toBeGreaterThan(10_000);
      }
    },
    15 * 60_000,
  );
});

/**
 * LIFE-CTX-18 PROBE — how long the implicit cache survives between turns.
 *
 * The placement probe above fires its turns ~600ms apart, which is not how the
 * app is used. A player reads two beats, weighs three chips, sometimes answers
 * a graded question — 20 to 90 seconds a turn, and they put the phone down.
 * Google documents implicit caching as automatic and best-effort but does NOT
 * document the retention window, so the hit rate the probe above measured is an
 * UPPER BOUND on what real play gets, not the real number.
 *
 * This is the fork in the road for COST-1, and both branches are actionable:
 *
 *   - If the cache survives a normal inter-turn gap, life_step is ALREADY ~76%
 *     cached in production and there is nothing to buy. COST-1 closes.
 *   - If it dies inside a minute, an EXPLICIT cache (declared 1h TTL, storage
 *     rent) is worth its keying complexity, because it converts a best-effort
 *     hit into a contractual one.
 *
 * An escalating ladder, because that is the shape of the real risk: every call
 * re-warms the cache, so each gap is measured from the previous turn exactly as
 * a played chain would be. The FIRST gap that returns cached=0 is the answer.
 *
 * ~22 minutes of mostly sleeping, ~$0.01. Run it in the background.
 */
const GAPS_SECONDS = [30, 120, 300, 900];

describe('LIFE-CTX-18 — how far apart two turns can be and still share a cache', () => {
  it(
    'walks an escalating inter-turn gap and reports where the hit rate falls off',
    async () => {
      const archive = JSON.parse(
        fs.readFileSync(path.join(ROOT, '.playthroughs', ARCHIVE), 'utf8'),
      ) as Archive;
      const steps = archive.calls.filter((c) => c.category === 'life_step');
      const ref = steps[0]!.systemInstructionRef;
      const world = steps.filter((c) => c.systemInstructionRef === ref);
      const si = archive.systemInstructions[ref]!;

      // A DIFFERENT prompt each turn, as in real play: the cache must be
      // hitting on the constant SI prefix, not on a repeated whole request.
      const turnPrompt = (i: number) => world[i % world.length]!.prompt;

      // eslint-disable-next-line no-console
      console.log(`\n── implicit-cache decay · SI ${si.length} chars ──`);
      const warm = await usageOf(armA(si, turnPrompt(0)));
      // eslint-disable-next-line no-console
      console.log(`t=0      (warm-up)   prompt=${warm.promptTokens}  cached=${warm.cached}`);

      const rows: { gap: number; cached: number; promptTokens: number }[] = [];
      for (let i = 0; i < GAPS_SECONDS.length; i += 1) {
        const gap = GAPS_SECONDS[i]!;
        await new Promise((r) => setTimeout(r, gap * 1000));
        const u = await usageOf(armA(si, turnPrompt(i + 1)));
        rows.push({ gap, ...u });
        // eslint-disable-next-line no-console
        console.log(
          `+${String(gap).padStart(4)}s  prompt=${String(u.promptTokens).padStart(6)}  cached=${String(u.cached).padStart(6)}  (${((u.cached / Math.max(1, u.promptTokens)) * 100).toFixed(1)}%)`,
        );
      }

      const firstMiss = rows.find((r) => r.cached === 0);
      // eslint-disable-next-line no-console
      console.log(
        firstMiss
          ? `\n→ cache is GONE by a ${firstMiss.gap}s gap. Explicit caching buys the difference.`
          : `\n→ cache survived every gap up to ${GAPS_SECONDS.at(-1)}s. Real play is already cached.`,
      );

      for (const r of rows) expect(r.promptTokens).toBeGreaterThan(10_000);
    },
    40 * 60_000,
  );
});
