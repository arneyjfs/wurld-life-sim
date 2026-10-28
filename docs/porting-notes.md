# Porting notes: how this repo was cut out of Wurld

On 2026-10-28 the life sim was extracted from `arneyjfs/wurld-app` (branch `dev`,
commit `49d795d0`) and removed from Wurld in the same change. This page records
what came across, what was changed to make it stand alone, and what was left
behind, so nobody has to go back to the Wurld repo to find out.

## How the file set was chosen

1. Everything that was life-only: `src/screens/LifeScreen/`, `src/lib/life/`,
   `src/types/life*.ts`, `src/hooks/useLife*.ts`, `functions/src/prompts/life*.ts`,
   the life server tests (`functions/src/__tests__/life*`, the golden-parity
   tests and fixtures), `tests/playthrough/`, `tests/experiments/avatar-svg-vs-pixel/`,
   the life E2E specs and `tests/e2e/helpers/lifeMock.ts`,
   `scripts/measure/fixtures/life_*.txt`.
2. Plus the import closure of the three route screens (`LifeOverviewScreen`,
   `LifeStartScreen`, `LifeScreen`) and of the `geminiGenerate` + TTS endpoints,
   computed with an esbuild metafile, then topped up from `tsc` errors for
   type-only imports. That is why shared Wurld modules (bubbles, Explain modal,
   word popover, TTS, flashcards, i18n, Firebase init, Plus gating) are here.
3. Unit tests that sit next to any copied file came too. A few that asserted
   Wurld-wide things (chat send errors, theme files, the practice matching
   question) were dropped rather than dragging chat code in.

All 81 i18n catalogues were copied whole, so the catalogue still carries Wurld's
chat strings. Pruning them is safe but was not needed to run.

## Changes made to stand alone

| Area | Wurld | Here |
|---|---|---|
| Shell | `main.tsx` + `App.tsx` with push, live updates, service worker, splash, outbox drains, tutor bootstrap, AppShell with tabs and nav transitions | Thin `main.tsx` / `App.tsx` / `routes.tsx`: auth gate → `/wurlds`, `/wurlds/start`, `/wurlds/:worldId`. The `#root` flex column and `data-runtime` attribute are kept because every life screen's layout depends on them. |
| Beta gate | `/wurlds*` behind `lifeSimBeta` (`BetaRouteGate`, NAV-BETA-1) | No gate. `tests/e2e/helpers/betaFlags.ts` still seeds the flag; it is harmless. |
| Sign-in | Phone OTP + Google + Apple + email, account linking, legal acceptance, onboarding | `src/screens/SignIn/SignInScreen.tsx`: Google popup and email/password. No onboarding: `LifeStartScreen` falls back to English native / French practice when the user doc has no languages. |
| Phone requirement | AUTH-ACCOUNT-3: an account with no phone is `pendingUser`, invisible to the app | Any signed-in user is the app user (`src/store/authStore.ts`). |
| Functions entry | ~60 exports | `api`, `geminiGenerate`, `geminiStreamV2`, `synthesizeSpeech`, `listStandardVoices`, `deleteLifeAccountData`. |
| API gateway | `api` routes 6 hot-path names (API-GW-*) | `api` routes `geminiGenerate`, `geminiStreamV2`, `synthesizeSpeech`; client `API_ROUTES` matches. |
| Admin SDK project | `firebaseConfig.ts` hard-coded `wurld-beta` → `wurld-e27d8` | `LIFE_DATA_PROJECT` / `LIFE_STORAGE_BUCKET` env (docs/setup.md). |
| CORS | Wurld domains + localhost | Same, plus `ALLOWED_ORIGINS_EXTRA`. |
| Account deletion | `cascadeDeleteUserData` inside `deleteAccount` | `deleteLifeAccountData` Auth `onDelete` trigger. |
| Rules | Life blocks inside Wurld's full rules | Standalone `firestore.rules` / `storage.rules` with only users, flashcards and life paths. |
| Vite config | PWA, Sentry upload, test-map recorder, FCM SW token replacement | React + Tailwind + build constants + dev proxy. |
| E2E | Wurld harness, project id `wurld-e27d8` | Same harness trimmed to the life specs, project id `demo-wurlds`, placeholder web config so a clean clone boots. The `__testSignIn` hook lives in a slim `src/lib/testHooks.ts`. |
| Tests | `vitest.config.ts` also ran the cost-sim harness | Cost-sim project removed; `scripts/cost-sim/` kept as reference (it needs a Wurld functions build). |

## Left behind on purpose

- Push notifications, the chat outbox, image/video upload, contacts, groups,
  tutor chat, practice mode, chat quiz, XP, admin dashboard, billing back end.
- Capacitor native projects (`ios/`, `android/`). The client still uses
  `@capacitor/*` web fallbacks and `canUseX()` capability checks, so wrapping it
  later is a matter of adding `capacitor.config.ts` and the platforms.
- PWA / service worker.
- The global engagement streak (`LIFE-STREAK-*`): its writer for practice sessions
  lived in Wurld's practice screen. `src/lib/streak.ts` is still here and the
  overview still shows it; only wurld-chapter completions advance it now.

## Known gaps

- `life-flow-real.spec.ts` needs `functions/.secret.local` with a real
  `GEMINI_API_KEY`; it skips without one. It was not run during the extraction.
- The playthrough harness (`npm run test:playthrough`) spends real money and was
  not run.
- Plus purchase, safety reports and translation feedback call Wurld functions
  that are not deployed here (docs/setup.md §5).
- Specs and code comments still cite Wurld-wide invariant ids (`MSG-*`,
  `PRACTICE-*`, `TTS-*`, `BOOT-*`, ...). The specs those come from are in
  `docs/reference-specs/` as of the extraction date, or in Wurld's git history.
