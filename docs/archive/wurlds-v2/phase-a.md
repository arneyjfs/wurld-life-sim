# Phase A — Wurlds rebrand (i18n values only)

**Goal.** Rebrand all user-facing "world / life" copy on the `/life` surface to the product brand **"Wurlds" / "wurld(s)"** by changing i18n **values** in `src/i18n/locales/en.ts` only. i18n keys, routes (`/life`), Firestore paths, code identifiers, testids, and invariant ids are NOT renamed — zero code churn outside the catalogue, one E2E copy-assertion fix, one new unit-test file, one new E2E test. The 80 non-English locale regen is explicitly deferred (a follow-up command recorded in *Ordered steps* step 9 — not a step of this phase).

**Invariant ids covered:** `LIFE-UI-8` (new — minted by this phase; verified free: `git grep LIFE-UI-8` has zero hits today, and no other Wurlds-v2 phase pins it).

## Contradictions

None that block. Three plan-vs-source corrections, resolved here (source wins, intent kept):

1. **Four keys missing from the plan's "known list".** The plan's rule is *"Every `life.*` value containing world(s) → wurld(s)"*; its enumerated list missed four values that contain "world": `life.debug.empty`, `life.onboard.language.label`, `life.onboard.language.hint`, `life.onboard.seed.chip.surprise.hint`. All four are included below (edits E10, E29, E30, E34).
2. **Spec copy-quote drift.** `docs/specs/life-sim.md` quotes the realism nudge as "…flashcards **can** appear naturally…" but the shipped value says "**will** appear naturally". The spec-quote edits below align the quote to the actual (new) value. This accepts the existing one-word implementation drift as spec text — copy intent is identical.
3. **Phase A had no invariant id in the plan.** The repo test convention (docs/specs/README.md) requires every invariant-asserting test description to start with an invariant id. This doc mints **LIFE-UI-8** (next free number in the `LIFE-UI-*` section, which today ends at LIFE-UI-7) to carry the brand-naming contract.

## Read first

- `docs/plans/wurlds-v2/00-approved-plan.md` — "Context" + "Phase A — Wurlds rebrand".
- `docs/specs/life-sim.md` — §0 intro + invariant-id prefix table (top), §3 `LIFE-ONBOARD-*`, §6 `LIFE-SCENE-7`, §8 `LIFE-UI-*`, §10.6 `LIFE-WORLD-*`, §10.7 `LIFE-WORLD-ARC-*`.
- `docs/specs/README.md` — "Naming convention" section (invariant-id test convention). The `LIFE-*` prefix row already lists `UI`; **no README change is needed** (no new prefix is introduced by this phase).
- `docs/specs/i18n.md` — the locale-regen workflow, plus the `__sourceHashes` mechanism documented in the `src/i18n/locales/en.ts` file-header comment and `scripts/generate-locales.mjs` (top-of-file comment): every non-English locale stores a sha256-12 hash of the English source string in a bottom-of-file `__sourceHashes` block, and the deferred `npm run i18n:regen` detects the changed keys by hash mismatch — which is why editing `en.ts` values alone is safe.
- Source files you will touch: `src/i18n/locales/en.ts`, `tests/e2e/specs/life-flow.spec.ts`. New file: `src/i18n/wurldsRebrand.test.ts`.

## Old value → new value table (every key changed; 35 total)

Rules applied: (a) "world/worlds" → "wurld/wurlds" in every `life.*` value plus the two named non-`life.*` keys; (b) the four "life/lives"-flavoured values named by the plan change to "wurld"; (c) all other uses of "life/lives/live" inside values are narrative and stay (full keep-list in *Out of scope*). `{placeholders}`, `\'` escapes, `…` (U+2026), and `—` (U+2014) characters are preserved byte-for-byte.

| # | Key | Old value | New value |
|---|---|---|---|
| E1 | `settings.beta.lifeSimBeta.label` | `Life sim (beta)` | `Wurlds (beta)` |
| E2 | `tabBar.life` | `Life` | `Wurlds` |
| E3 | `life.title` | `Life` | `Wurlds` |
| E4 | `life.buildingWorld` | `Building your world…` | `Building your wurld…` |
| E5 | `life.arcComplete.continue` | `Continue your life` | `Continue your wurld` |
| E6 | `life.menu.label` | `World options` | `Wurld options` |
| E7 | `life.menu.deleteRestart` | `Delete this world` | `Delete this wurld` |
| E8 | `life.menu.deleteConfirm.title` | `Delete this world?` | `Delete this wurld?` |
| E9 | `life.menu.deleteConfirm.confirm` | `Delete world` | `Delete wurld` |
| E10 | `life.debug.empty` | `No life-sim events yet. They'll show up here as the world unfolds.` | `No life-sim events yet. They'll show up here as the wurld unfolds.` |
| E11 | `life.overview.title` | `Your other lives` | `Your Other Wurlds` |
| E12 | `life.overview.create` | `Start a new world` | `Start a new wurld` |
| E13 | `life.overview.createFirst` | `Start your first world` | `Start your first wurld` |
| E14 | `life.overview.maxReached` | `You can run up to {max} worlds at once` | `You can run up to {max} wurlds at once` |
| E15 | `life.overview.cardMenu` | `World options` | `Wurld options` |
| E16 | `life.overview.cardDelete` | `Delete world` | `Delete wurld` |
| E17 | `life.overview.empty.eyebrow` | `A second life` | `A second wurld` |
| E18 | `life.overview.empty.title` | `Step into a world that speaks your practice language.` | `Step into a wurld that speaks your practice language.` |
| E19 | `life.overview.empty.samplesHint` | `These are sketches of what's possible. Your own world is whatever you want it to be.` | `These are sketches of what's possible. Your own wurld is whatever you want it to be.` |
| E20 | `life.overview.explainer.title` | `How worlds work` | `How wurlds work` |
| E21 | `life.overview.explainer.chapters` | `Each world unfolds in chapters — multi-campaign story arcs that thread your character's life across sessions.` | `Each wurld unfolds in chapters — multi-campaign story arcs that thread your character's life across sessions.` |
| E22 | `life.overview.explainer.parallel` | `Run up to five worlds in parallel — different languages, different lives.` | `Run up to five wurlds in parallel — different languages, different lives.` |
| E23 | `life.overview.setting.surprise` | `A surprise world` | `A surprise wurld` |
| E24 | `life.overview.setting.manual` | `A world of your own` | `A wurld of your own` |
| E25 | `life.overview.deleteConfirm.title` | `Delete {name}'s world?` | `Delete {name}'s wurld?` |
| E26 | `life.overview.deleteConfirm.body` | `This wipes the character, all events, NPCs, scenes, and any active or archived campaign for this world. Your flashcards stay safe. There is no undo.` | `This wipes the character, all events, NPCs, scenes, and any active or archived campaign for this wurld. Your flashcards stay safe. There is no undo.` |
| E27 | `life.onboard.title` | `A second life` | `A second wurld` |
| E28 | `life.onboard.subtitle` | `Step into a world in {language}. The story is yours.` | `Step into a wurld in {language}. The story is yours.` |
| E29 | `life.onboard.language.label` | `Which language should people speak in this world?` | `Which language should people speak in this wurld?` |
| E30 | `life.onboard.language.hint` | `Languages are set per world — switching later means starting a new one.` | `Languages are set per wurld — switching later means starting a new one.` |
| E31 | `life.onboard.seed.label` | `Pick a world` | `Pick a wurld` |
| E32 | `life.onboard.seed.realism` | `The more your world overlaps with your real life, the more your saved flashcards will appear naturally. A medieval kingdom won't easily test office vocabulary.` | `The more your wurld overlaps with your real life, the more your saved flashcards will appear naturally. A medieval kingdom won't easily test office vocabulary.` |
| E33 | `life.onboard.seed.chip.frontier_colony.hint` | `A new world to settle` | `A new wurld to settle` |
| E34 | `life.onboard.seed.chip.surprise.hint` | `A random world, picked for you` | `A random wurld, picked for you` |
| E35 | `life.onboard.creating` | `Creating your world…` | `Creating your wurld…` |

## Spec changes

All edits target `docs/specs/life-sim.md`. **No edit to `docs/specs/README.md`** — the `LIFE-*` prefix row already includes `UI` and no new prefix is introduced.

For every edit: run `grep -F -c '<ANCHOR>' docs/specs/life-sim.md` first; it must print `1`.

### S1 — prefix table: LIFE-UI row mentions brand naming

ANCHOR (verify unique):

```
| `LIFE-UI-*` | Screen layout | Scene-first composition, action bar, chip grid, free-text gating |
```

Replace the whole line with:

```
| `LIFE-UI-*` | Screen layout | Scene-first composition, action bar, chip grid, free-text gating, brand naming (Wurlds) |
```

### S2 — prefix table: "Continue your life" flow → "Continue your wurld" flow

ANCHOR (verify unique):

```
| `LIFE-WORLD-ARC-*` | World arcs (chapters) | Chapter through-lines spanning multiple campaigns; chapter completion; "Continue your life" flow |
```

Replace the whole line with:

```
| `LIFE-WORLD-ARC-*` | World arcs (chapters) | Chapter through-lines spanning multiple campaigns; chapter completion; "Continue your wurld" flow |
```

### S3 — new invariant LIFE-UI-8 (insert AFTER the LIFE-UI-7 row, §8 table)

ANCHOR (verify unique — this is the existing LIFE-UI-7 row; insert the new row on the next line):

```
| **LIFE-UI-7** | On orientation change OR window resize the SceneStage rescales its SVG via `preserveAspectRatio="xMidYMid slice"` (cover-fit). The DialogueArea + ActionBar redo their layout but don't trigger a scene-regen. |
```

Insert immediately after that line:

```
| **LIFE-UI-8** | **Brand naming (Wurlds).** User-facing copy brands this surface "Wurlds" / "wurld(s)": tab label (`tabBar.life`) = "Wurlds"; overview title (`life.overview.title`) = "Your Other Wurlds"; beta-flag label (`settings.beta.lifeSimBeta.label`) = "Wurlds (beta)"; and no `life.*` i18n VALUE contains the standalone word "world(s)". Narrative uses of "life/lives" inside values (e.g. "Your name in this life", "different lives") remain. The rebrand is copy-only: i18n KEYS, routes (`/life`), Firestore paths, code identifiers, and invariant ids keep the `life` naming. |
```

### S4 — LIFE-ONBOARD-3 realism-nudge quote

ANCHOR (verify unique):

```
The more your world overlaps with your real life, the more your saved flashcards can appear naturally.
```

Replace with:

```
The more your wurld overlaps with your real life, the more your saved flashcards will appear naturally.
```

(Note the deliberate `can` → `will`: aligns the spec quote with the actual shipped copy — see *Contradictions* #2.)

### S5 — LIFE-ONBOARD-6 placeholder quote

ANCHOR (verify unique):

```
shows the "building world…" placeholder
```

Replace with:

```
shows the "Building your wurld…" placeholder
```

### S6 — LIFE-SCENE-7 placeholder quote

ANCHOR (verify unique):

```
| **LIFE-SCENE-7** | "Building world…" placeholder:
```

Replace with:

```
| **LIFE-SCENE-7** | "Building your wurld…" placeholder:
```

### S7 — LIFE-WORLD-2 CTA quote

ANCHOR (verify unique):

```
"+ Start a new world" CTA
```

Replace with:

```
"+ Start a new wurld" CTA
```

### S8 — LIFE-WORLD-5 menu-item quote

ANCHOR (verify unique):

```
"Delete this world" (with a confirm modal
```

Replace with:

```
"Delete this wurld" (with a confirm modal
```

### S9 — LIFE-WORLD-ARC-6 CTA quote

ANCHOR (verify unique):

```
**Continue your life** fires
```

Replace with:

```
**Continue your wurld** fires
```

### S10 — §18 "Existing tests" table: register the LIFE-UI-8 tests

ANCHOR (verify unique):

```
| TBD: `tests/e2e/specs/life-flow.spec.ts` (Phase B+) | End-to-end onboarding → first beat → user response → next beat |
```

Insert immediately after that line:

```
| `src/i18n/wurldsRebrand.test.ts` + `tests/e2e/specs/life-flow.spec.ts` (rebrand test) | LIFE-UI-8 — brand strings exact; no `life.*` value contains "world(s)"; rebranded copy renders on the overview |
```

## Ordered steps

1. **Spec edits** — apply S1–S10 to `docs/specs/life-sim.md` exactly as written above (grep-check each anchor first).
2. **Write the unit test** — create `src/i18n/wurldsRebrand.test.ts` with the complete contents from *Tests* below.
3. **Run it and confirm it FAILS** — `npx vitest run src/i18n/wurldsRebrand.test.ts`. Both tests must be red (values are still the old copy). If either passes at this point, STOP: you mistyped an expected value — fix the test to match this doc, not the implementation.
4. **E2E edits** — apply T2 and T3 (below) to `tests/e2e/specs/life-flow.spec.ts`. Do NOT run the E2E yet; both edits assert copy that does not exist until step 5.
5. **Catalogue edits** — apply E1–E35 to `src/i18n/locales/en.ts` exactly as written below.
6. **Unit suite green** — `npx vitest run src/i18n/wurldsRebrand.test.ts` (now passes), then the full `npm test`.
7. **Static gates** — `npm run typecheck` and `npm run lint`, both clean.
8. **E2E green** — run `tests/e2e/specs/life-flow.spec.ts` per *Verify*; open every screenshot the run produced (Read tool on the PNGs under the run's output dir) and check the rebranded copy renders without layout regressions (the tab label "Wurlds" is 2 characters wider than "Life"; the overview `h1` and onboarding hero must not wrap oddly at 414 px width).
9. **Do NOT run `npm run i18n:regen`.** Follow-up (user-triggered, separate session): `npm run i18n:regen` re-translates exactly the 35 changed keys across the 80 locales via `__sourceHashes` mismatch. Costs cents. Not part of this phase.

## Catalogue edits (E1–E35) — `src/i18n/locales/en.ts`

Every edit is a single-line replacement. Each ANCHOR line is unique in the file because each i18n key appears exactly once as a key (pre-verified; if an Edit reports a non-unique match, run `grep -F -c "'<key>':" src/i18n/locales/en.ts` → `1` — keep the surrounding quote and colon, because a bare key can be a substring of another key: `life.overview.create` is a prefix of `life.overview.createFirst`). Preserve the two-space indent, the `\'` escapes, `…`, `—`, and the trailing comma exactly as shown.

**E1** — ANCHOR (verify unique):
```ts
  'settings.beta.lifeSimBeta.label': 'Life sim (beta)',
```
Replace with:
```ts
  'settings.beta.lifeSimBeta.label': 'Wurlds (beta)',
```

**E2** — ANCHOR (verify unique):
```ts
  'tabBar.life': 'Life',
```
Replace with:
```ts
  'tabBar.life': 'Wurlds',
```

**E3** — ANCHOR (verify unique):
```ts
  'life.title': 'Life',
```
Replace with:
```ts
  'life.title': 'Wurlds',
```

**E4** — ANCHOR (verify unique):
```ts
  'life.buildingWorld': 'Building your world…',
```
Replace with:
```ts
  'life.buildingWorld': 'Building your wurld…',
```

**E5** — ANCHOR (verify unique):
```ts
  'life.arcComplete.continue': 'Continue your life',
```
Replace with:
```ts
  'life.arcComplete.continue': 'Continue your wurld',
```

**E6** — ANCHOR (verify unique):
```ts
  'life.menu.label': 'World options',
```
Replace with:
```ts
  'life.menu.label': 'Wurld options',
```

**E7** — ANCHOR (verify unique):
```ts
  'life.menu.deleteRestart': 'Delete this world',
```
Replace with:
```ts
  'life.menu.deleteRestart': 'Delete this wurld',
```

**E8** — ANCHOR (verify unique):
```ts
  'life.menu.deleteConfirm.title': 'Delete this world?',
```
Replace with:
```ts
  'life.menu.deleteConfirm.title': 'Delete this wurld?',
```

**E9** — ANCHOR (verify unique):
```ts
  'life.menu.deleteConfirm.confirm': 'Delete world',
```
Replace with:
```ts
  'life.menu.deleteConfirm.confirm': 'Delete wurld',
```

**E10** — ANCHOR (verify unique):
```ts
  'life.debug.empty': 'No life-sim events yet. They\'ll show up here as the world unfolds.',
```
Replace with:
```ts
  'life.debug.empty': 'No life-sim events yet. They\'ll show up here as the wurld unfolds.',
```

**E11** — ANCHOR (verify unique):
```ts
  'life.overview.title': 'Your other lives',
```
Replace with:
```ts
  'life.overview.title': 'Your Other Wurlds',
```

**E12** — ANCHOR (verify unique):
```ts
  'life.overview.create': 'Start a new world',
```
Replace with:
```ts
  'life.overview.create': 'Start a new wurld',
```

**E13** — ANCHOR (verify unique):
```ts
  'life.overview.createFirst': 'Start your first world',
```
Replace with:
```ts
  'life.overview.createFirst': 'Start your first wurld',
```

**E14** — ANCHOR (verify unique):
```ts
  'life.overview.maxReached': 'You can run up to {max} worlds at once',
```
Replace with:
```ts
  'life.overview.maxReached': 'You can run up to {max} wurlds at once',
```

**E15** — ANCHOR (verify unique):
```ts
  'life.overview.cardMenu': 'World options',
```
Replace with:
```ts
  'life.overview.cardMenu': 'Wurld options',
```

**E16** — ANCHOR (verify unique):
```ts
  'life.overview.cardDelete': 'Delete world',
```
Replace with:
```ts
  'life.overview.cardDelete': 'Delete wurld',
```

**E17** — ANCHOR (verify unique):
```ts
  'life.overview.empty.eyebrow': 'A second life',
```
Replace with:
```ts
  'life.overview.empty.eyebrow': 'A second wurld',
```

**E18** — ANCHOR (verify unique):
```ts
  'life.overview.empty.title': 'Step into a world that speaks your practice language.',
```
Replace with:
```ts
  'life.overview.empty.title': 'Step into a wurld that speaks your practice language.',
```

**E19** — ANCHOR (verify unique):
```ts
  'life.overview.empty.samplesHint': 'These are sketches of what\'s possible. Your own world is whatever you want it to be.',
```
Replace with:
```ts
  'life.overview.empty.samplesHint': 'These are sketches of what\'s possible. Your own wurld is whatever you want it to be.',
```

**E20** — ANCHOR (verify unique):
```ts
  'life.overview.explainer.title': 'How worlds work',
```
Replace with:
```ts
  'life.overview.explainer.title': 'How wurlds work',
```

**E21** — ANCHOR (verify unique):
```ts
  'life.overview.explainer.chapters': 'Each world unfolds in chapters — multi-campaign story arcs that thread your character\'s life across sessions.',
```
Replace with:
```ts
  'life.overview.explainer.chapters': 'Each wurld unfolds in chapters — multi-campaign story arcs that thread your character\'s life across sessions.',
```

**E22** — ANCHOR (verify unique):
```ts
  'life.overview.explainer.parallel': 'Run up to five worlds in parallel — different languages, different lives.',
```
Replace with:
```ts
  'life.overview.explainer.parallel': 'Run up to five wurlds in parallel — different languages, different lives.',
```

**E23** — ANCHOR (verify unique):
```ts
  'life.overview.setting.surprise': 'A surprise world',
```
Replace with:
```ts
  'life.overview.setting.surprise': 'A surprise wurld',
```

**E24** — ANCHOR (verify unique):
```ts
  'life.overview.setting.manual': 'A world of your own',
```
Replace with:
```ts
  'life.overview.setting.manual': 'A wurld of your own',
```

**E25** — ANCHOR (verify unique):
```ts
  'life.overview.deleteConfirm.title': 'Delete {name}\'s world?',
```
Replace with:
```ts
  'life.overview.deleteConfirm.title': 'Delete {name}\'s wurld?',
```

**E26** — ANCHOR (verify unique):
```ts
  'life.overview.deleteConfirm.body': 'This wipes the character, all events, NPCs, scenes, and any active or archived campaign for this world. Your flashcards stay safe. There is no undo.',
```
Replace with:
```ts
  'life.overview.deleteConfirm.body': 'This wipes the character, all events, NPCs, scenes, and any active or archived campaign for this wurld. Your flashcards stay safe. There is no undo.',
```

**E27** — ANCHOR (verify unique):
```ts
  'life.onboard.title': 'A second life',
```
Replace with:
```ts
  'life.onboard.title': 'A second wurld',
```

**E28** — ANCHOR (verify unique):
```ts
  'life.onboard.subtitle': 'Step into a world in {language}. The story is yours.',
```
Replace with:
```ts
  'life.onboard.subtitle': 'Step into a wurld in {language}. The story is yours.',
```

**E29** — ANCHOR (verify unique):
```ts
  'life.onboard.language.label': 'Which language should people speak in this world?',
```
Replace with:
```ts
  'life.onboard.language.label': 'Which language should people speak in this wurld?',
```

**E30** — ANCHOR (verify unique):
```ts
  'life.onboard.language.hint': 'Languages are set per world — switching later means starting a new one.',
```
Replace with:
```ts
  'life.onboard.language.hint': 'Languages are set per wurld — switching later means starting a new one.',
```

**E31** — ANCHOR (verify unique):
```ts
  'life.onboard.seed.label': 'Pick a world',
```
Replace with:
```ts
  'life.onboard.seed.label': 'Pick a wurld',
```

**E32** — ANCHOR (verify unique):
```ts
  'life.onboard.seed.realism': 'The more your world overlaps with your real life, the more your saved flashcards will appear naturally. A medieval kingdom won\'t easily test office vocabulary.',
```
Replace with:
```ts
  'life.onboard.seed.realism': 'The more your wurld overlaps with your real life, the more your saved flashcards will appear naturally. A medieval kingdom won\'t easily test office vocabulary.',
```

**E33** — ANCHOR (verify unique):
```ts
  'life.onboard.seed.chip.frontier_colony.hint': 'A new world to settle',
```
Replace with:
```ts
  'life.onboard.seed.chip.frontier_colony.hint': 'A new wurld to settle',
```

**E34** — ANCHOR (verify unique):
```ts
  'life.onboard.seed.chip.surprise.hint': 'A random world, picked for you',
```
Replace with:
```ts
  'life.onboard.seed.chip.surprise.hint': 'A random wurld, picked for you',
```

**E35** — ANCHOR (verify unique):
```ts
  'life.onboard.creating': 'Creating your world…',
```
Replace with:
```ts
  'life.onboard.creating': 'Creating your wurld…',
```

## Tests

### T1 — NEW unit test: `src/i18n/wurldsRebrand.test.ts`

Complete file contents (create verbatim; the `…` inside the expected string for `life.buildingWorld` is U+2026, copy it exactly):

```ts
/**
 * LIFE-UI-8 — Wurlds rebrand (wurlds-v2 Phase A).
 *
 * The /life surface is branded "Wurlds" in user-facing copy while
 * i18n keys, routes, and code identifiers keep the `life` naming.
 * These tests pin the marquee brand strings and enforce that no
 * `life.*` VALUE still contains the word "world(s)" — the brand
 * spelling is "wurld(s)".
 *
 * Spec: docs/specs/life-sim.md §8 LIFE-UI-8.
 */
import { describe, expect, it } from 'vitest';
import en from './locales/en';

describe('LIFE-UI-8 — Wurlds rebrand (en catalogue values)', () => {
  it('LIFE-UI-8 — marquee brand strings are exact', () => {
    expect(en['tabBar.life']).toBe('Wurlds');
    expect(en['life.title']).toBe('Wurlds');
    expect(en['life.overview.title']).toBe('Your Other Wurlds');
    expect(en['settings.beta.lifeSimBeta.label']).toBe('Wurlds (beta)');
    expect(en['life.overview.empty.eyebrow']).toBe('A second wurld');
    expect(en['life.onboard.title']).toBe('A second wurld');
    expect(en['life.arcComplete.continue']).toBe('Continue your wurld');
    expect(en['life.buildingWorld']).toBe('Building your wurld…');
    expect(en['life.overview.create']).toBe('Start a new wurld');
    expect(en['life.overview.createFirst']).toBe('Start your first wurld');
  });

  it('LIFE-UI-8 — no life.* value contains the standalone word "world(s)"', () => {
    const offenders = Object.entries(en)
      .filter(([key]) => key.startsWith('life.'))
      .filter(([, value]) => /\bworlds?\b/i.test(value))
      .map(([key]) => key);
    expect(offenders).toEqual([]);
  });
});
```

Notes for the implementer: `en` is the default export of `src/i18n/locales/en.ts`, typed `Messages` (`Record<MessageKey, string>`) — `Object.entries(en)` yields `[string, string][]` with no cast, and the literal-key indexing (`en['tabBar.life']`) typechecks because those literals are members of `MessageKey`. No `any`, no `@ts-ignore`. This mirrors the existing import style in `src/i18n/i18n.test.ts` (`import en from './locales/en';`).

### T2 — EDIT `tests/e2e/specs/life-flow.spec.ts`: fix the broken copy assertion

The onboarding-title assertion hardcodes the old value and breaks when E27 lands.

ANCHOR (verify unique — the string `A second life` appears exactly once in this file):

```ts
    // No worlds yet → empty-state. Tap "+ Start a new world" to
    // enter onboarding.
    await page.getByTestId('LifeOverview-Create').click();
    await page.waitForURL((url) => url.pathname === '/life/start', { timeout: 10_000 });
    await expect(page.getByText('A second life')).toBeVisible({ timeout: 10_000 });
```

Replace with:

```ts
    // No worlds yet → empty-state. Tap "+ Start a new wurld" to
    // enter onboarding.
    await page.getByTestId('LifeOverview-Create').click();
    await page.waitForURL((url) => url.pathname === '/life/start', { timeout: 10_000 });
    await expect(page.getByText('A second wurld')).toBeVisible({ timeout: 10_000 });
```

### T3 — EDIT `tests/e2e/specs/life-flow.spec.ts`: append the LIFE-UI-8 post-condition test

Appended as the LAST test inside the existing `test.describe.serial('life-sim flow (mocked Gemini)', …)` block. It runs after the earlier tests have created a world, so the overview is in its populated state. `@standard` tier (the plan's tier for all wurlds-v2 E2E; note this file already runs under `test:e2e:standard`, which is `--grep-invert @full`). Tag placement follows the repo's combined-tag convention — tier tag first, then invariant id (`test('@standard CONTACTS-RECIP-1/4 — …')` in `tests/e2e/specs/contacts-add-back.spec.ts:205` is the reference example). It asserts the POST-CONDITION — the rebranded copy is in the rendered DOM and the old brand is not — not merely that components mount.

ANCHOR (verify unique — `resume-prompt` appears exactly once; this is the tail of the last test plus the describe/file closers):

```ts
    await captureBeat(page, testInfo, 'resume-prompt');
  });
});
```

Replace with:

```ts
    await captureBeat(page, testInfo, 'resume-prompt');
  });

  test('@standard LIFE-UI-8 — rebrand copy renders: Wurlds tab + overview', async ({}, testInfo) => {
    // Enable the lifeSimBeta flag so the Wurlds tab renders. Seed the
    // zustand-persist record BEFORE the app boots (addInitScript runs
    // before every subsequent navigation's scripts). This is the same
    // JSON shape the app's own ?betaFlag URL hook writes
    // (src/lib/testHooks.ts) — seeding directly avoids that hook's
    // mid-boot location.reload(), which can abort page.goto with an
    // interrupted-navigation error (installTestHooks() runs at module
    // top of src/main.tsx, i.e. before the load event).
    await page.addInitScript(() => {
      localStorage.setItem(
        'wurld-beta-flags',
        JSON.stringify({ state: { flags: { lifeSimBeta: true } }, version: 0 }),
      );
    });
    await page.goto('/life/overview');
    await page.waitForURL((url) => url.pathname === '/life/overview', {
      timeout: 10_000,
    });

    // POST-CONDITION (LIFE-UI-8): the rebranded copy is in the DOM.
    await expect(page.getByText('Your Other Wurlds')).toBeVisible({
      timeout: 10_000,
    });
    await expect(
      page.getByRole('link', { name: 'Wurlds', exact: true }),
    ).toBeVisible();
    // Populated overview (a world exists from the onboarding test):
    // the create CTA + explainer carry the rebranded copy too.
    await expect(page.getByTestId('LifeOverview-Create')).toContainText(
      'Start a new wurld',
    );
    await expect(page.getByText('How wurlds work')).toBeVisible();
    // The old brand never renders on this surface.
    await expect(page.getByText('Your other lives')).toHaveCount(0);
    await captureBeat(page, testInfo, 'rebrand-overview');
  });
});
```

Why this works (pre-verified against source, do not re-derive): all routes render inside `AppShell` (`src/routes.tsx:91`), which mounts `<TabBar />` on `/life/overview` (that route is not in AppShell's `hideTabBar` list); this spec's own browser context is 414×896 so the `lg:hidden` tab bar IS visible; the "Wurlds" tab is gated on the `lifeSimBeta` beta flag (`src/components/TabBar.tsx:42`), which the seeded localStorage record enables — `{ state: { flags: { lifeSimBeta: true } }, version: 0 }` under the key `wurld-beta-flags` is exactly the shape `zustand/persist` rehydrates (store `name: 'wurld-beta-flags'`, default version 0 — `src/store/betaFlagsStore.ts`) and byte-identical to what the app's own `?betaFlag=` hook writes (`src/lib/testHooks.ts`); `addInitScript` runs before the `page.goto` that follows, so the flag exists before first paint and no reload is involved; the tab's accessible name is its `<span>` label text, so `getByRole('link', { name: 'Wurlds', exact: true })` matches only the tab (the `h1` "Your Other Wurlds" is not a link and `exact: true` prevents substring collisions); the create button shows `life.overview.create` ("Start a new wurld") because one world exists and the cap (5) is not hit; `LifeOverviewExplainer` renders `life.overview.explainer.title` only in the populated state. Firebase auth persists across the `goto` (IndexedDB, same context), so the user from the earlier serial tests is still signed in.

## Verify

Run from `/Users/jamesarney/wurld`, in this order:

```bash
# Step 3 gate — MUST FAIL before E1–E35 land:
npx vitest run src/i18n/wurldsRebrand.test.ts

# After E1–E35 (steps 6–7) — all clean:
npx vitest run src/i18n/wurldsRebrand.test.ts
npm test
npm run typecheck
npm run lint

# Step 8 — E2E (real Firebase + mocked Gemini; dev server auto-starts
# on port 5187 via the Playwright webServer config):
cd tests/e2e && npx playwright test specs/life-flow.spec.ts --project=chromium
```

Then open every PNG the E2E run captured with the Read tool and visually confirm: tab label "Wurlds" not truncated, overview `h1` "Your Other Wurlds" on one line at 414 px, onboarding hero "A second wurld" rendered, no dark-mode regressions. The PNGs land at `<repo-root>/screenshots/<run-id>/life-flow/<beat>.png` where `<run-id>` is a timestamp unless you set `RUN_ID=<x>` on the playwright command (`tests/e2e/helpers/screenshots.ts`); the beats for this spec are `onboard`, `opening-beat`, `comprehension-active`, `comprehension-feedback`, `comprehension-resolved`, `fill-blank-active`, `fill-blank-feedback`, `fill-blank-resolved`, `resume-prompt`, plus the new `rebrand-overview`.

Sanity greps after all edits (each must print its `OK-…` line; any other output means a leftover occurrence):

```bash
grep -c "world" src/i18n/locales/en.ts | grep -vx 0 || echo OK-no-world-left-in-en
git grep -c "A second life" -- tests/ || echo OK-e2e-updated
```

(The first grep is valid because pre-change the ONLY lines in the whole of `en.ts` containing "world" — values, keys, or comments — are the 28 world-flavoured value lines this phase edits (E4, E6–E10, E12–E16, E18–E26, E28–E35); verified with `grep -in "world" src/i18n/locales/en.ts`. The remaining "World" occurrences post-edit are capital-W key names like `life.buildingWorld`, which the case-sensitive lowercase grep deliberately ignores.)

## Out of scope — do NOT touch

- **The 80 non-English locale files** (`src/i18n/locales/*.ts` other than `en.ts`). Regen is deferred; their `__sourceHashes` blocks make the later `npm run i18n:regen` pick up exactly these 35 keys. Follow-up command only, never a step in this phase.
- **i18n KEY names** (`life.buildingWorld` stays `life.buildingWorld`), **routes** (`/life`, `/life/overview`, `/life/start`, `/life/:worldId`), **testids** (`LifeOverview-Create` etc.), **code identifiers** (`LifeScreen`, `lifeWorld`, `MAX_WORLDS`, …), **Firestore paths**, **invariant ids**.
- `src/store/betaFlagsStore.ts` — the hardcoded `label: 'Life sim (beta)'` / `description` on the `lifeSimBeta` entry is a never-rendering fallback: `BetaFlagsSection.tsx` maps the flag to `settings.beta.lifeSimBeta.label` in `FLAG_I18N`, and `def.label` renders only for keys missing from that map. Leave it.
- `settings.beta.lifeSimBeta.description` — plan scopes the settings change to the label only; "life simulator" in the description is a feature description, not brand copy. Leave it.
- Values that keep "life/lives/live" deliberately (narrative register, per the plan's closed list): `life.onboard.name.label` ("Your name in this life"), `life.onboard.seed.manual.placeholder` ("kind of life you want to live"), `life.overview.empty.couldBe` ("You could be living…"), `life.overview.explainer.chapters` ("your character's life" — E21 changes only "world"), `life.overview.explainer.parallel` ("different lives" — E22 changes only "worlds"), `life.onboard.seed.realism` ("your real life" — E32 changes only "world"), `life.streak.title` ("keep it alive"). Also `life.wipBadge.label` / `life.wipBadge.title` (dead keys — referenced nowhere in `src/`; leave the values as-is, do not delete the keys) and `life.debug.title` ("Life-sim debug logs" — internal debug overlay naming; E10 changes only "world" in `life.debug.empty`).
- **Code comments** that quote old copy (`src/lib/life/campaignLifecycle.ts:322`, `src/lib/life/prompts/worldArc.ts:6`, `src/lib/life/runWorldArcGenerate.ts:3`, `src/screens/LifeScreen/WorldArcCompleteScreen.tsx:11`, `src/screens/LifeScreen/LifeOverviewScreen.tsx` header comment, `src/screens/LifeScreen/LifeOverviewExplainer.tsx:2`; `tests/e2e/specs/life-flow.spec.ts:187` is the ONE comment updated, as part of T2). Comments are not user-facing; leave the rest.
- `src/screens/LifeScreen/overviewSamples.ts:48` — "edge of the known world" is in-fiction sample-premise text (and a pre-existing hardcoded-English i18n gap on that file). Out of this phase; surfaced to the manager in the phase report.
- **Prompt files** (`src/lib/life/prompts/*.ts`) — "life simulator" phrasing addressed to the MODEL is not user-facing copy. Any prompt change would trigger the `@prompts` obligation; none is made here.
- `docs/specs/life-sim.md` prose beyond S1–S10 (the spec may keep calling the feature "life sim" internally; LIFE-UI-8 explicitly permits internal `life` naming).
- Everything in later phases: no schema, hook, screen, or engine changes (Phases B–H).
