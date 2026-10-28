/**
 * LIFE-NPC-2b — the avatar part library and the prompt that advertises it must
 * name the SAME slots.
 *
 * ── WHY THERE ARE TWO COPIES, AND WHY THIS IS NOT AN EXPIRING GUARD ─────────
 *
 * `SRV-PROMPT-8..13` batch 2 moved the `life_npc_avatar_params` prompt to
 * `functions/src/prompts/lifeAvatarParams.ts`. That prompt renders the LIST OF
 * PART NAMES into its system instruction — "Every \"style\" MUST be one of
 * these exact values" — so the server has to hold the names.
 *
 * `parts.ts` itself CANNOT move. It is not a name list, it is the SVG
 * geometry: `assembleAvatar` composes the portrait on the client from these
 * functions, which is the entire point of LIFE-NPC-2b (~8x cheaper output than
 * having the model draw, one art style across every NPC, no model-authored
 * SVG). The server never draws. So the names exist on both sides.
 *
 * ⚠ UNLIKE the batch-1 gloss guard in `timeOfDay.test.ts`, THIS DUPLICATION
 * HAS NO EXPIRY. That one was temporary — the two copies re-converge when
 * `life_step` migrates in batch 8. This one is structural: the model must be
 * told the legal names, the client must be able to draw them, and those are
 * different artefacts that happen to share a key set. Do not delete this test
 * expecting a later batch to make it redundant; a later batch cannot.
 *
 * The third option — sending `OPTIONS` up in the promptSpec — was REJECTED.
 * The list is interpolated verbatim into the SYSTEM INSTRUCTION, so a client
 * that supplied it could write arbitrary text into the SI through it, which is
 * the proxy this migration exists to close (SRV-PROMPT-12's point, reached from
 * the other direction). Validating it server-side would need the server to hold
 * the table anyway, which is where we already are.
 *
 * ── WHAT DRIFT COSTS ────────────────────────────────────────────────────────
 *
 * Both directions are silent and one is expensive:
 *   • Server lists a name the client cannot draw → `assembleAvatar` returns
 *     `svg: null`, `params-unknown-part` is logged and the call falls back to
 *     the DIRECT DRAW — ~8x the output tokens, on a path that looks like it
 *     worked.
 *   • Client gains a part the server does not list → the model is never told it
 *     exists, so it is never chosen. The library silently narrows.
 * Neither shows up anywhere but the bill and the sameness of the portraits.
 *
 * Read as TEXT rather than imported, exactly as `timeOfDay.test.ts` reads the
 * backdrop prompt: this is the `app` vitest project, the prompt is in the
 * `functions` one, and `no-restricted-imports` bans reaching across with a
 * `../../../../` path. The assertion is over the file's bytes either way.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { OPTIONS } from './parts';

const serverParamsSrc = (): string =>
  readFileSync(
    join(__dirname, '..', '..', '..', '..', 'functions', 'src', 'prompts', 'lifeAvatarParams.ts'),
    'utf8',
  );

/** The server's `AVATAR_PART_OPTIONS`, parsed out of its source. */
function serverOptions(): Record<string, string[]> {
  const block = serverParamsSrc().match(/AVATAR_PART_OPTIONS[^=]*=\s*\{([\s\S]*?)\n\} as const;/);
  expect(block, 'AVATAR_PART_OPTIONS not found server-side').toBeTruthy();
  const out: Record<string, string[]> = {};
  for (const [, key, body] of (block?.[1] ?? '').matchAll(/(\w+):\s*\[([\s\S]*?)\]/g)) {
    // `\w`, not `[A-Za-z]`. Every part name today is letters-only, so the
    // narrower class worked — but a name carrying a digit or an underscore
    // would not have MATCHED, so the parser would silently drop it and the
    // comparison below would report agreement about a part it never saw.
    // Verified: adding `"GHOST_PART"` server-side passed all four tests under
    // the old class and fails under this one. A guard against silent drift must
    // not have a silent failure mode of its own.
    out[key!] = [...(body ?? '').matchAll(/"(\w+)"/g)].map((m) => m[1]!);
  }
  return out;
}

describe('LIFE-NPC-2b — the part library and the server prompt have not drifted', () => {
  it('LIFE-NPC-2b — client and server advertise the same SLOTS', () => {
    // A slot present on one side only is a slot the model is either never told
    // about or told about and cannot have drawn.
    expect(Object.keys(serverOptions()).sort()).toEqual(Object.keys(OPTIONS).sort());
  });

  it('LIFE-NPC-2b — every slot names the same parts, in the same order', () => {
    // Asserted against each other rather than each against a literal: a literal
    // on both sides agrees with nothing. Order is included deliberately — the
    // two lists are only ever edited together, so a reorder on one side means
    // they were not.
    const server = serverOptions();
    for (const [slot, names] of Object.entries(OPTIONS)) {
      expect(server[slot], `slot ${slot} — add the part to BOTH parts.ts and lifeAvatarParams.ts`)
        .toEqual([...names]);
    }
  });

  it('LIFE-NPC-2b — the server table is not empty (a failed parse would pass vacuously)', () => {
    // Without this, a regex that stopped matching would make the two tests
    // above compare {} with {} and report agreement.
    const server = serverOptions();
    expect(Object.keys(server).length).toBeGreaterThanOrEqual(8);
    for (const [slot, names] of Object.entries(server)) {
      expect(names.length, slot).toBeGreaterThan(0);
    }
  });

  it('LIFE-NPC-2b — every advertised part actually renders', () => {
    // The drift that costs money: a name in the prompt that `assembleAvatar`
    // cannot resolve sends the call to the ~8x dearer direct draw. Checked
    // against the LIBRARY rather than against `OPTIONS`, so this still holds if
    // `OPTIONS` itself ever stops being derived from the part tables.
    const server = serverOptions();
    for (const [slot, names] of Object.entries(server)) {
      for (const name of names) {
        expect(
          (OPTIONS as Record<string, readonly string[]>)[slot]?.includes(name),
          `${slot}=${name} is advertised server-side but is not in the part library`,
        ).toBe(true);
      }
    }
  });
});
