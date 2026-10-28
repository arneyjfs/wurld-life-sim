# Specs

The code is asserted against these, not the other way round. Each spec carries
the contract (invariants) and the design decisions (why). `git grep <ID>` finds
every test that asserts an invariant.

| Spec | Covers | Status |
|---|---|---|
| [life-sim.md](./life-sim.md) | The whole life sim: data model, session lifecycle, onboarding, prompt context and caching, node step engine, backdrops, NPCs, screen layout, two-bubble dialogue, language display, exercises and two-stage graded questions, scenes, multi-world, chapters, streak, vocab recap, failure handling, design decisions, engine comparison, goal ladder. Prefix table at the top. | full (as shipped behind Wurld's `lifeSimBeta`) |
| [story-architecture.md](./story-architecture.md) | The story layer as a state machine: fronts + clocks, two-tier cast, nothing stores a future, the option grid's required-type rotation, the four-prompt cost ladder (`LIFE-ARCH-*`, `LIFE-GRID-*`). | full: engine wired end to end; outstanding `chapterOpen` and succession (LIFE-ARCH-6) |

## Reading them outside Wurld

Both specs were written inside the Wurld app and cite its other surfaces
(`MSG-*`, `PRACTICE-*`, `TTS-*`, `CARDS-*`, `BOOT-*`, `SRV-PROMPT-*`, `API-GW-*` ...).
Paths like `docs/specs/tts.md` mean Wurld's specs. The ones that matter here are
copied, as of 2026-10-28, into [../reference-specs/](../reference-specs/).

Where a Wurld-wide invariant bound both apps (for example the shared flashcard
write path, `PRACTICE-SAVE-3` + `LIFE-BUBBLE-7`), this repo's copy of the code is
now the only one that implements the life half.

## Design history

- [../archive/story-generation-audit.md](../archive/story-generation-audit.md): the audit `story-architecture.md` answers.
- [../archive/wurlds-v2/](../archive/wurlds-v2/): the approved Wurlds v2 plan and its phases A to H (deleted from Wurld on 2026-09-30, restored here from git history).
- [../archive/cost-sim-REPORT.txt](../archive/cost-sim-REPORT.txt): Wurld's cost simulation, which includes the life prompts.
