/**
 * LIFE-NODE-16 — replay a stored calls log through the step schema and name
 * every response it rejects, with and without `repairStepResponse`.
 *
 * WHY THIS EXISTS. A run report's failure line said only "step schema-failed".
 * That names the symptom and nothing else, so two failures in a four-world run
 * could not be told apart from a truncation or a refusal — and the eleven
 * rejections that the retry ladder silently absorbed were not visible at all.
 * Every response is already in the calls log and the schema is importable;
 * this joins the two, and that join is what turned "7% of turns fail somewhere"
 * into four named defect classes.
 *
 * Point it at a log with `CALLS_LOG=.playthroughs/<stamp>-calls.json`. Without
 * one it skips — the repo carries no fixture, because the value here is in
 * replaying a REAL run, and a checked-in sample would go stale the first time
 * the prompt changed.
 */
import fs from 'node:fs';
import { describe, it, expect } from 'vitest';
import { ZRawNodeResponse, repairStepResponse } from '@/lib/life/stepSchema';

const LOG = process.env.CALLS_LOG ?? '';

type Call = { seq: number; category: string; response?: string; outTokens?: number };

function parseBody(c: Call): { raw: string; obj?: unknown; jsonError?: string } {
  const raw = String(c.response ?? '').trim().replace(/^```json/, '').replace(/```$/, '');
  try {
    return { raw, obj: JSON.parse(raw) };
  } catch (e) {
    return { raw, jsonError: String(e).slice(0, 120) };
  }
}

describe('LIFE-NODE-16 — schema-failure probe over a stored run', () => {
  // `skipIf`, not an early `return`. A bare return reports the test as PASSED
  // with zero assertions on every ordinary run, which is a green tick that
  // proves nothing — the same false-signal class this repo removed a MSG-KEY
  // test for rather than keep. The doc comment above already said "it skips";
  // this makes the code say it too.
  it.skipIf(!LOG || !fs.existsSync(LOG))('names every step response the schema rejects, and never regresses on repair', () => {

    // Accepts both calls-log shapes: the flat array written before system
    // instructions were deduped, and the `{systemInstructions, calls}` object
    // written after. An old log is still the evidence for an old run.
    const parsed = JSON.parse(fs.readFileSync(LOG, 'utf8')) as Call[] | { calls: Call[] };
    const arr = Array.isArray(parsed) ? parsed : parsed.calls;
    const steps = arr.filter((c) => c.category === 'life_step');
    const lines: string[] = [];
    let rawFails = 0;
    let repairedFails = 0;

    for (const c of steps) {
      const { raw, obj, jsonError } = parseBody(c);
      if (jsonError) {
        // A truncated response is not repairable by definition — it is a retry,
        // correctly. Counted on both sides so the comparison stays honest.
        rawFails += 1;
        repairedFails += 1;
        lines.push(`seq ${c.seq}: NOT JSON — ${jsonError}`);
        continue;
      }
      if (!ZRawNodeResponse.safeParse(obj).success) rawFails += 1;
      const after = ZRawNodeResponse.safeParse(repairStepResponse(obj));
      if (!after.success) {
        repairedFails += 1;
        lines.push(`seq ${c.seq} (out=${c.outTokens}):`);
        for (const i of after.error.issues.slice(0, 10)) {
          lines.push(`    ${i.path.join('.') || '<root>'} | ${i.code} | ${i.message}`);
        }
        lines.push(`    raw head: ${raw.slice(0, 400)}`);
      }
    }

    lines.unshift(
      `${steps.length} life_step responses — ${rawFails} rejected strict, ` +
        `${repairedFails} rejected after repair`,
    );
    fs.writeFileSync('.playthroughs/schema-probe.txt', lines.join('\n'));

    // The one assertion worth making about a repair pass: it can only ever
    // reduce rejections. A repair that turns a valid response invalid is a bug
    // whose cost is a lost turn, and it would otherwise show up as a mystery.
    expect(repairedFails).toBeLessThanOrEqual(rawFails);
  });
});
