# Agent context

**Wurlds** is an AI language-learning life simulator: the player lives a generated
story in the language they are learning. It was extracted from the Wurld chat app
(`arneyjfs/wurld-app`) on 2026-10-28 and is a standalone Vite + React 19 + TS
client with a Firebase back end (Auth, Firestore, Storage, Cloud Functions). It is
not deployed and not actively maintained; treat it as a parked product.

Read before touching code:

- [README.md](README.md): what it is, scripts, where things live.
- [docs/specs/life-sim.md](docs/specs/life-sim.md): the contract (`LIFE-*` invariants) and the design decisions. The code is asserted against it.
- [docs/specs/story-architecture.md](docs/specs/story-architecture.md): the story engine.
- [docs/porting-notes.md](docs/porting-notes.md): what was changed to stand alone, and the known gaps.
- [docs/setup.md](docs/setup.md): before anything touching Firebase, deploys or secrets.

## Rules

- **Spec first.** For a behaviour change, read the spec, decide whether the change fits, extends or contradicts an invariant, and update the spec before the code. A contradiction goes to the owner, not around the spec.
- **Tests carry the invariant id** in their name (`LIFE-NODE-4 — ...`) so `git grep` finds them.
- **Never deploy rules from this repo to `wurld-e27d8`** (Wurld's production project). They are project-wide and would replace every Wurld rule. See docs/setup.md §1A.
- **Functions before hosting** on every deploy (the client sends `promptSpec`s only current functions understand).
- **Paid runs need a go-ahead.** `npm run test:playthrough` and `life-flow-real.spec.ts` call real Gemini.
- Coding conventions are Wurld's: [docs/reference-specs/conventions.md](docs/reference-specs/conventions.md) (600-line file cap, `@/` imports, no `console.log` in `src/` — use `src/lib/log.ts`, capability checks rather than platform checks).

## Checks

`npm run typecheck`, `npm run lint`, `npm test`, `npm run test:e2e` (emulator, mocked Gemini; needs Java for the Firestore emulator and `cd tests/e2e && npm install` once).
