# Avatar generation: SVG vs pixel-matrix

Compares the current NPC/player avatar generator (Ghibli-style **SVG** portraits,
`src/lib/life/prompts/npcAvatar.ts`) against a **pixel-matrix** alternative — the
model emits a tiny colour grid we render as pixel art. Hypothesis: the matrix is
cheaper to emit and reads as cuter, while still reflecting personality (a witch
vs an office worker).

Measures three things the owner asked for:
1. **Token cost** — output tokens per gen (input is ~identical; the SI differs).
2. **Output quality** — how good the portrait looks (rendered PNGs).
3. **"Character"** — how well the output reflects the role/personality.

## Run

```bash
# 1. Generate both ways for every test character (real Gemini).
GEMINI_API_KEY=... node tests/experiments/avatar-svg-vs-pixel/run.mjs
#    (optional: one character → ... run.mjs witch)

# 2. Render results.json → comparison.png (needs Playwright from tests/e2e).
cd tests/e2e && node ../experiments/avatar-svg-vs-pixel/render.mjs
```

- `GEMINI_API_KEY` — an AI Studio key in a SEPARATE dev project, NOT the app
  key (keeps prod `tokenUsage` telemetry clean — see `tests/prompts/README.md`).
- `AVATAR_MODEL` (optional) — defaults to `gemini-3-flash-preview` (the current
  `LIFE_NPC_AVATAR_MODEL`).

## Files

- `prompts.mjs` — the current SVG SI (verbatim), the new pixel SI, prompt
  builder, and the 6-character test cast (witch / office worker / fisherman /
  child / knight / punk — spread across age, style, personality).
- `run.mjs` — generates both ways per character, records output + token usage.
- `render.mjs` — renders each portrait big (96px) and at the real 32px chat slot.
- `results.json` / `comparison.png` — outputs (gitignored-ish; regenerate).
