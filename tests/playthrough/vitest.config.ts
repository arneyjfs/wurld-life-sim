/**
 * Playthrough harness config. Separate from `vitest.config.ts` on purpose —
 * these files hit the REAL Gemini API and spend real money, so they must never
 * be picked up by `npm test` or the pre-commit hook.
 *
 *   npx vitest run --config tests/playthrough/vitest.config.ts
 *
 * Env knobs: PLAY_BUDGET (usd ceiling), PLAY_SCENES, PLAY_TURNS.
 */
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(import.meta.dirname, '../../src') },
  },
  test: {
    name: 'playthrough',
    // jsdom, not node. The app is a single WebView runtime and some shipped
    // code branches on DOM availability — `sanitiseSvg` returns null outright
    // when `DOMParser` is undefined, so under `node` EVERY backdrop came back
    // `sanitise-failed` and would have scored as a generation-quality problem.
    // A harness measuring the shipped path has to run where the shipped path runs.
    environment: 'jsdom',
    globals: true,
    // `.play.ts` = a full scored playthrough. `.probe.ts` = a small
    // architecture check (does the shipped path run headlessly?) that costs a
    // fraction of a cent. Both spend real money, so neither is in `npm test`.
    include: ['tests/playthrough/**/*.play.ts', 'tests/playthrough/**/*.probe.ts'],
    // One world at a time: the harness is I/O bound on a rate-limited API and
    // interleaved runs make the cost log unreadable.
    fileParallelism: false,
    testTimeout: 45 * 60_000,
    hookTimeout: 60_000,
  },
});
