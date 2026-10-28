import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Projects: the app (jsdom + React + alias), the app's pure lib/store
// tests (same setup, node environment), and the Cloud Functions (node, no
// React, no DOM setup). All run on `npm test`.
//
// Pre-projects this file ran the app-only suite; the functions/
// tests were orphaned (excluded by `functions/**`). The
// shouldSwapToFallback regression guard for the prod-blocking model-
// deprecation 404 (MSG-PIPE-3 / MSG-ROBUST-4) lives in functions/ and
// must run on every test invocation — hence the workspace split.
//
// Coverage thresholds stay scoped to the app — server-side coverage
// is its own concern and not measured here.
export default defineConfig({
  test: {
    projects: [
      // ── App (src/) ──────────────────────────────────────────────
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': path.resolve(import.meta.dirname, 'src'),
          },
        },
        test: {
          name: 'app',
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          // The playthrough CALIBRATION tests ride here deliberately. They are
          // pure functions over fixtures — no network, no money — and they are
          // what stops the benchmark from silently becoming a rubber stamp. The
          // playthrough itself (`*.play.ts`) spends real money and is excluded.
          include: ['src/**/*.test.{ts,tsx}', 'tests/playthrough/**/*.test.ts'],
          exclude: [
            'node_modules/**',
            'dist/**',
            'tests/e2e/**',
            'ios/**',
            'android/**',
            'functions/**',
            // Run by `app-node` below.
            'src/lib/**/*.test.ts',
            'src/store/**/*.test.ts',
          ],
        },
      },
      // ── App, pure modules (src/lib, src/store) ─────────────────
      // Same alias and setup as `app`, but the NODE environment: most of these
      // never touch the DOM, and building a jsdom window per file was the
      // single largest cost of `npm test` (audit CPLX-APP-15: ~545 s of
      // environment setup against ~115 s of tests). A file here that DOES need
      // the DOM (localStorage, window, document, navigator…) opts back in with
      // a first-line `// @vitest-environment jsdom` pragma — the same
      // mechanism the few node-only tests elsewhere already use.
      {
        plugins: [react()],
        resolve: {
          alias: {
            '@': path.resolve(import.meta.dirname, 'src'),
          },
        },
        test: {
          name: 'app-node',
          environment: 'node',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          include: ['src/lib/**/*.test.ts', 'src/store/**/*.test.ts'],
        },
      },
      // ── Cloud Functions (functions/src/) ───────────────────────
      // Pure Node — no DOM, no React. Tests import lightweight helpers
      // (`tokenSplit`, `pipelineGraphRouting`, `modelFallback`, etc.)
      // — NEVER `./index` directly (it'd pull in firebase-functions +
      // sharp + the whole pipeline graph, slow + brittle to mount in a
      // test runner).
      {
        // ⚠ The `@/` alias is here for ONE reason: the client/server resolver
        // parity harness (`languageResolutionParity.test.ts`) imports the
        // CLIENT resolver into this project on purpose, to run both halves
        // over the same fixtures. Client modules use `@/` freely, so without
        // the alias that harness breaks the moment the resolver gains an
        // import — which is exactly how it broke on 2026-09-22, when
        // `languageResolution` started importing `languageGate` for
        // `isPassthroughChat` (LANG-TX-9) and pulled in `tutor.ts` behind it.
        //
        // It does NOT invite functions code to use `@/`: that alias does not
        // exist in the deployed functions build, so an import written against
        // it would pass here and fail on deploy. `functions/tsconfig.json` is
        // what stops that, and it has no such path mapping.
        resolve: {
          alias: {
            '@': path.resolve(import.meta.dirname, 'src'),
          },
        },
        test: {
          name: 'functions',
          environment: 'node',
          globals: true,
          // Placeholder VITE_* config for the client modules the parity harness
          // imports (src/lib/config.ts throws at load without them).
          setupFiles: ['./src/test/env.ts'],
          include: ['functions/src/**/*.test.ts'],
          exclude: ['functions/node_modules/**', 'functions/lib/**'],
        },
      },
    ],
  },
});
