# Wurlds: the Wurld life sim

Wurlds is an AI language-learning life simulator. The player lives a story in the
language they are learning: a generated world with a saga, chapters and scenes,
recurring characters with memories, a Gemini-drawn SVG backdrop behind every
beat, and graded exercises woven into the dialogue. Words tapped in the story
save to the same flashcard deck as the Wurld chat app.

It was built inside the Wurld app (`arneyjfs/wurld-app`) behind the
`lifeSimBeta` flag, and was moved here on **2026-10-28** when the owner decided
not to ship it in Wurld. This repo is a standalone, runnable app: a Vite +
React 19 + TypeScript client and a Firebase back end (Auth, Firestore, Storage,
Cloud Functions). It has not been deployed anywhere.

## Status

- The client typechecks, lints, builds and passes its unit suite (~4,600 tests).
- The Cloud Functions build and pass their tests.
- The life E2E specs run against the Firebase Emulator Suite with mocked Gemini.
- Not deployed. No Firebase project is configured yet: see [docs/setup.md](docs/setup.md).
- The code is a snapshot of Wurld's `dev` branch at commit `49d795d0`. It is not
  maintained and not kept in sync with Wurld.

## Quick start (local, no cloud project needed)

```bash
nvm use                       # Node 22
npm install
npm --prefix functions install
(cd tests/e2e && npm install) # Playwright + firebase-tools for the emulator

# Emulators (Auth, Firestore, Functions, Storage) under the demo project id.
# Life prompts call real Gemini, so put a key in functions/.secret.local first:
#   GEMINI_API_KEY=...
npm run emulators

# In another terminal: point the client at the emulators.
cp .env.example .env.local    # then set VITE_USE_EMULATORS=true and the values in docs/setup.md
npm run dev                   # http://localhost:5173/wurlds
```

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server. `/__functions/*` proxies to `VITE_FUNCTIONS_URL`. |
| `npm run build` | Typecheck + production build into `dist/`. |
| `npm run typecheck` | Client, tests and Cloud Functions. |
| `npm run lint` | ESLint (client + functions). |
| `npm test` | Vitest: client (jsdom + node) and functions. |
| `npm run test:e2e` | Builds functions, boots the emulators, runs the Playwright life specs. Add `E2E_ARGS="--project=chromium"` to run one browser. |
| `npm run test:playthrough` | The paid benchmark harness: plays whole worlds against real Gemini and scores them. Spends money; see `tests/playthrough/`. |
| `npm run emulators` | Start the Emulator Suite for manual testing. |
| `npm run deploy:functions` / `deploy:rules` / `deploy:hosting` / `deploy` | Firebase deploys to the project in `.firebaserc`. Read docs/setup.md first. |

## Where things live

| Path | What |
|---|---|
| `src/screens/LifeScreen/` | Every life screen: overview, onboarding, the world screen (stage, dialogue, action bar), chapter and scene completion, debug overlay. |
| `src/lib/life/` | The engine: node step engine, scene and saga generators, graded questions, backdrops, NPCs, canon, goal ladder, telemetry. No React. |
| `src/types/life*.ts` | Zod schemas for every life Firestore doc. |
| `src/hooks/useLife*.ts` | Firestore snapshot hooks for worlds, events, NPCs, scenes and backdrops. |
| `src/components/`, `src/lib/`, `src/i18n/` | The parts of Wurld the life screens use: bubbles, Explain modal, TTS, word popover, flashcards, i18n (81 locales), Firebase init. |
| `src/screens/SignIn/` | Minimal sign-in (Google, email). |
| `functions/src/prompts/life*.ts` | The server-owned life prompts. The client sends a `promptSpec`; the server builds the prompt. |
| `functions/src/endpoints/` | `api` gateway, `geminiGenerate` / `geminiStreamV2`, TTS, account-deletion cleanup. |
| `tests/e2e/` | Playwright specs for the life flow, on the emulator. |
| `tests/playthrough/` | The real-Gemini benchmark harness (rubric, judge, seeds). |
| `docs/` | Specs, design history, marketing copy. Start at [docs/README.md](docs/README.md). |
