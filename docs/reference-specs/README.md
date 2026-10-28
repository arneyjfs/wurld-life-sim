# Reference specs (snapshots from Wurld)

Copies of Wurld app specs and docs as of 2026-10-28 (`arneyjfs/wurld-app`, dev
`49d795d0`), kept because the life sim code and `life-sim.md` cite them. They are
**not maintained here**; the live versions are in the Wurld repo. If you change
behaviour they describe in this repo, move the relevant part into `docs/specs/`
and own it there.

| File | Why it is here |
|---|---|
| app-architecture.md | Wurld's module map; the shared `src/lib` / `src/components` layout came from it. |
| conventions.md | Coding rules this code was written to (600-line cap, `@/` imports, no `Platform.OS`, capability checks). |
| api-gateway.md | `API-GW-*`: the `api` function the client calls. |
| explain.md | `EXPLAIN-*`: the Explain modal opened from life bubbles and graded answers. |
| tts.md | `TTS-*`: speak buttons on bubbles and word cards. |
| i18n.md | `I18N-*`: catalogue + regen workflow for the UI strings. |
| cold-boot.md | `BOOT-*`: Firebase init order, snapshot caches, code splitting. |
| observability.md | `OBS-*`: logging, Sentry, telemetry conventions. |
| navigation.md | `NAV-*`: back = hierarchy (`navHierarchy.ts`). |
| cost-model.md, cost-model-findings.md | Cost per prompt, including the life prompts. |
