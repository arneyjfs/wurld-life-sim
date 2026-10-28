import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

/**
 * Wurld ESLint config. Encodes the §1 hard rules from the migration plan.
 * Anything machine-checkable lives here; the rest is enforced by PR review.
 */

// Files allowlisted to use Capacitor.isNativePlatform() directly. Every
// other file must go through src/lib/capabilities.ts predicates.
const CAPACITOR_NATIVE_ALLOWLIST = [
  'src/lib/runtime.ts',
  'src/lib/capabilities.ts',
  'src/lib/prefs.ts',
  'src/lib/auth.ts',
  'src/hooks/useKeyboardState.ts',
  'src/lib/splash.ts',
  'src/lib/statusBar.ts',
  'src/notifications/setup.ts',
  'src/notifications/routing.ts',
  'src/App.tsx',
  'src/hooks/useAndroidBackButton.ts',
];

export default defineConfig([
  globalIgnores([
    'dist',
    'ios',
    'android',
    'node_modules',
    '.claude', // harness worktrees + session artifacts — never lint these

    'src/components/ui/**', // shadcn-generated, exempted from many rules
    'public/firebase-messaging-sw.js',
    // Native background-runner (MSG-OUTBOX-13b). Runs in a headless JS engine
    // (not the WebView): no app modules, legitimate console.* for runner-side
    // diagnostics, ES5-style for the JSCore/android-js-engine context. Same
    // category as the SW file above.
    'public/background-runner.js',
    'vite.config.ts', // node-context module
    'eslint.config.js',
    // Playwright E2E fixtures — Node-side, lints itself via its own
    // tooling. firebase-admin types liberally, console output is
    // legitimate test diagnostic.
    'tests/e2e/**',
    // Cloud Functions build output + deps. `functions/src` itself IS linted,
    // by its own block below (Node runtime, not the WebView app).
    'functions/lib/**',
    'functions/node_modules/**',
    // Snapshot of the unmerged wurld-welcome redesign (Astro), kept as
    // reference material only; not part of this app's build.
    'docs/**',
  ]),

  // Base rules — apply to every source file.
  {
    files: ['**/*.{ts,tsx}'],
    // Cloud Functions have their own block (Node globals, no React, no `@/`).
    ignores: ['functions/**'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
      // Pin the TS project root so typescript-eslint doesn't trip over
      // nested repo copies (e.g. .claude/worktrees/* left by background
      // agents) when discovering candidate tsconfig roots.
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // §1 rule 5: no any, no @ts-ignore
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 12,
        },
      ],

      // §1 rule 1: hard file size cap (600 LOC = the limit; counting source
      // lines only, no blanks/comments).
      //
      // Locale files (`src/i18n/locales/*.ts`) get a higher cap below —
      // they're auto-generated key/value tables, not hand-authored code,
      // and the 600-LOC rule exists to push toward decomposition of
      // logic, not to ban a 300-key catalogue.
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],

      // §1 rule 14: setState updater functions where applicable. Cant lint
      // perfectly; warn instead.
      // (no built-in rule covers this; PR review handles edge cases)

      // §1 rule 15: useEffect must have explicit deps array (react-hooks
      // exhaustive-deps elevated to error).
      'react-hooks/exhaustive-deps': 'error',

      // §1 rule 17: no console (use src/lib/log.ts).
      'no-console': 'error',

      // §1 rule 18: absolute imports from @/ only; ban deep relative paths.
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../../*', '../../../*'],
              message:
                'Use the @/ alias for cross-directory imports. Relative imports limited to ./ and ../.',
            },
            {
              group: ['react-native', 'react-native/*', 'expo', 'expo-*', '@expo/*'],
              message:
                '§1 rule 2: no React Native or Expo imports. This is the Capacitor build; use web APIs.',
            },
          ],
          paths: [
            {
              name: 'react-native',
              message: '§1 rule 2: no react-native.',
            },
          ],
        },
      ],

      // §1 rule 4: ban raw Capacitor.isNativePlatform() (allowlisted via override).
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.object.name="Capacitor"][callee.property.name="isNativePlatform"]',
          message:
            '§1 rule 4: do not call Capacitor.isNativePlatform() directly. Use a predicate from src/lib/capabilities.ts (e.g. canUseHaptics(), canUseContacts()) or, only if absolutely required, the runtime helpers in src/lib/runtime.ts.',
        },
        {
          selector:
            'CallExpression[callee.object.name="Capacitor"][callee.property.name="getPlatform"]',
          message:
            '§1 rule 4: do not call Capacitor.getPlatform() directly. Use src/lib/runtime.ts getRuntime() or src/lib/capabilities.ts predicates.',
        },
      ],
    },
  },

  // Cloud Functions (`functions/src`) — Node runtime, deployed from this repo.
  // The §1 rules that are about the WebView app (React hooks, `@/` imports,
  // Capacitor, log.ts) do not apply; the code-shape rules do.
  {
    files: ['functions/src/**/*.ts'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // §1 rule 1: the same 600-LOC cap as the app.
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/ban-ts-comment': [
        'error',
        {
          'ts-ignore': true,
          'ts-expect-error': 'allow-with-description',
          minimumDescriptionLength: 12,
        },
      ],
      // Cloud Logging reads console.* — it is the functions' log API.
      'no-console': 'off',
      // `import X = require("x")` is TypeScript's CommonJS import form.
      '@typescript-eslint/no-require-imports': ['error', { allowAsImport: true }],
      // Findings present when functions/src was first linted (the index.ts
      // split). None has a mechanical fix: typing the Firestore shapes,
      // dropping dead initial values TS inference relies on, and changing
      // emoji regexes all change behaviour or types. Warn so they stay
      // visible; raise to error once each is cleared.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-useless-assignment': 'warn',
      'no-misleading-character-class': 'warn',
    },
  },

  // §1 rule 4: lift the Capacitor restriction for allowlisted files.
  {
    files: CAPACITOR_NATIVE_ALLOWLIST,
    rules: {
      'no-restricted-syntax': 'off',
    },
  },

  // log.ts is the only file allowed to use raw console.
  {
    files: ['src/lib/log.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  // Test files can use any types + skip a few rules.
  {
    files: ['**/*.test.{ts,tsx}', 'src/test/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      'max-lines': 'off',
    },
  },

  // Auto-generated locale files are key/value tables, not logic — the
  // 600-LOC cap is for decomposing hand-written code. Each locale has
  // ~300 strings + a hash sidecar, so ~600 LOC is the natural floor.
  // The catalogue is regenerated via `npm run i18n:regen` from
  // `src/i18n/locales/en.ts` (the source-of-truth — also exempt because
  // it's a data file, not logic).
  {
    files: ['src/i18n/locales/**/*.ts'],
    rules: {
      'max-lines': 'off',
    },
  },

  // §1 rule 3: ban .web.ts / .native.ts filenames. We can't lint a filename
  // shape with ESLint directly; surface this via a script that runs in CI
  // (see scripts/check-filename-rules.mjs added below).
]);
