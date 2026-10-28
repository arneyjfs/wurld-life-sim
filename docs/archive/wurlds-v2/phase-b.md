# Phase B — Scene thumbnail on WurldCard

**Goal.** The overview screen's world card (`WorldCard.tsx`, rendered by `LifeOverviewScreen.tsx`) gains a scene-thumbnail banner at the top of its tap target: the world's most-recently-persisted scene SVG. Resolution is **read-only reuse** — sync localStorage scene-cache hit first, async Firestore `svgInline` mirror second, bundled silhouette third, and `null` (no banner at all) for fresh worlds that have no `currentScene` descriptor. **Zero LLM calls**: the thumbnail path never invokes `generateScene` or any other Gemini path. One new hook (`src/screens/LifeScreen/useWorldThumbnail.ts`), one component edit (`WorldCard.tsx`), one new spec invariant.

**Invariant covered:** `LIFE-WORLD-9` (pinned by the cross-phase contract in `docs/plans/wurlds-v2/00-approved-plan.md` — do NOT renumber).

## Contradictions

None that block implementation. Three plan-vs-source drifts, resolved here (source wins on detail, plan wins on intent):

1. **`[&>svg]:object-cover` (plan §Phase B) is a CSS no-op on inline `<svg>` roots.** SVG scaling is governed by `preserveAspectRatio` — `sanitiseSvg` defaults it to `"xMidYMid slice"` on every generated scene that doesn't declare one, and every fallback silhouette hard-codes it. The shipped pattern (`SceneStage.tsx` line 40) is `[&>svg]:w-full [&>svg]:h-full [&>svg]:block`. This doc uses the `SceneStage` pattern. Cover-fit intent is preserved.
2. **`LIFE-WORLD-7` / `LIFE-WORLD-8` do not exist** — the spec's §10.6 table currently ends at `LIFE-WORLD-6`. `LIFE-WORLD-9` therefore does not collide; it leaves an intentional gap (the Wurlds-v2 plan pinned phase→id assignments across parallel phase docs). The spec edit below records the gap so a future reader doesn't backfill 7/8.
3. **The plan's Verification section says "extend `tests/e2e/specs/life-flow.spec.ts`".** That file is a `describe.serial` mocked-Gemini FLOW (onboard → graded turns → resume) whose fixture queues and accumulated world state would be corrupted by an overview detour, and whose `installLifeMock` fixture-consumption model conflicts with this phase's "zero Gemini calls" post-condition. This doc creates a NEW spec file `tests/e2e/specs/life-overview-thumbnail.spec.ts` instead (admin-seeded worlds, gemini-route counter asserting zero calls). Intent preserved: one `@standard` E2E asserting the post-condition.

Decisions made here that the plan left open (do not re-decide): (a) while the async Firestore read is in flight the hook shows the silhouette, so banner presence is deterministic on `currentScene` presence and never pops in on network timing; (b) a Firestore hit re-seeds the localStorage cache via `writeSceneCache` (mirrors `useLifeScene` step 2a); (c) the card's absolute-positioned 3-dot menu button gets a translucent chip background only when a banner is present, so the icon stays legible over artwork; (d) no re-sanitisation on read — persisted SVGs were sanitised at generation time and `SceneStage` renders them un-resanitised already (same trust model, owner-only Firestore rules); (e) the reused `readPersistentScene` internally bumps the scene doc's `lastVisitedAt` (best-effort fire-and-forget `updateDoc`, pre-existing behaviour) — this does not violate the read-only contract, which is about generation (zero LLM) and scene-data creation. Do NOT "fix" or fork that function.

## Read first

Read all of these before editing anything. All paths relative to the repo root `/Users/jamesarney/wurld`.

Spec:
- `docs/specs/life-sim.md` — §10.6 "Multi-world model — LIFE-WORLD-*" (the table you are extending), §6 "Scene rendering — LIFE-SCENE-*" (cache-key + fallback contracts you are reusing), §18 "Existing tests" (the table you are extending).
- `docs/specs/README.md` — "Naming convention" section (test descriptions must start with the invariant id). The `LIFE-*` prefix row already exists in the prefix table and already lists `WORLD` — **no README.md change is needed in this phase**.
- `docs/conventions.md` — "Test selectors" + hard rules 5 (no `any`), 17 (no `console.log`), 18 (`@/` imports).

Source (read-only reuse — none of these are edited):
- `src/screens/LifeScreen/LifeOverviewScreen.tsx` — how `WorldCard` is rendered (`world`, `onOpen`, `onDelete`, `deleting` props; uid comes from `useAuthStore`, NOT from props).
- `src/screens/LifeScreen/sceneDescriptorForLife.ts` — `descriptorFromWorld(world)` (returns `null` when `world.currentScene` is absent).
- `src/hooks/useLifeScene.ts` — the shipped sync-cache → Firestore-fallback → silhouette resolution pattern the new hook mirrors (MINUS the generation step).
- `src/lib/life/sceneCache.ts` — `readSceneCache(d, worldId)` / `writeSceneCache(d, worldId, svg)` (localStorage, sync).
- `src/lib/life/scenes.ts` — `readPersistentScene(uid, worldId, d)` (async; reads `svgInline` from `users/{uid}/lifeWorlds/{worldId}/scenes/{docId}`), `sceneDocId` (`::` → `__`).
- `src/lib/life/sceneDescriptor.ts` — `SceneDescriptor`, `descriptorCacheKey`, `pickFallback`.
- `src/lib/life/fallbackScenes.ts` — `getFallbackScene(key)` silhouette library.
- `src/screens/LifeScreen/SceneStage.tsx` — the `dangerouslySetInnerHTML` SVG render pattern (lines 39-43).
- `src/screens/LifeScreen/WorldCard.tsx` — the file you edit.

Test harness:
- `tests/e2e/specs/life-flow.spec.ts` — provision/sign-in/cleanup pattern (do NOT edit this file).
- `tests/e2e/helpers/auth.ts`, `tests/e2e/helpers/firebase-admin.ts`, `tests/e2e/helpers/screenshots.ts` — `provisionTestUser`, `signInBrowser`, `getAdminFirestore`, `cleanupTestUsers`, `captureBeat`.
- `src/components/Contacts/AddContactBanner.test.tsx` — the mock pattern the unit tests below follow.

## Spec changes

Two edits to `docs/specs/life-sim.md`. No edit to `docs/specs/README.md` (the `LIFE-*` prefix row already covers `WORLD`).

### Spec edit 1 — add LIFE-WORLD-9 to the §10.6 table

ANCHOR (verify unique — `grep -F -c 'Bio generation + chapter-1 worldArc generation fire in parallel non-blocking' docs/specs/life-sim.md` must print `1`). Insert **immediately after** this line (the `LIFE-WORLD-6` table row, currently the last row of the §10.6 table):

```
| **LIFE-WORLD-6** | Onboarding (`/life/start`) creates ONE new world per submission: mints a `worldId`, calls `createLifeWorld({uid, worldId, ...})`, navigates to `/life/{worldId}`. Bio generation + chapter-1 worldArc generation fire in parallel non-blocking — their results land on the world doc within a few seconds. The lifeStep engine reads bio + worldArc when present; absence is non-fatal. |
```

Insert this exact block (one table row, then a blank line, then a note paragraph):

```markdown
| **LIFE-WORLD-9** | The overview `WorldCard` renders a scene-thumbnail banner at the top of its tap target: the world's most-recently-persisted scene SVG, resolved READ-ONLY via `useWorldThumbnail(world)`. Resolution order: (1) sync localStorage scene-cache hit (`readSceneCache(descriptorFromWorld(world), world.id)`); (2) async Firestore mirror (`readPersistentScene(uid, world.id, descriptor)` — a hit also re-seeds the local cache via `writeSceneCache`); (3) the bundled fallback silhouette for the descriptor's category (`getFallbackScene(pickFallback(descriptor))`), shown immediately while (2) is in flight and kept on miss. Thumbnail resolution NEVER calls `generateScene` or any other Gemini path — zero LLM cost from the overview. A world with no `currentScene` descriptor (fresh world) resolves to `null` and renders NO banner — the card keeps its compact text-only layout, so banner presence is deterministic on `currentScene` presence, never on network timing. |

> `LIFE-WORLD-7` / `LIFE-WORLD-8` are intentionally unallocated — the Wurlds-v2 plan (`docs/plans/wurlds-v2/`) pinned phase→invariant-id assignments across parallel phase docs (Phase B = `LIFE-WORLD-9`). Do not backfill 7/8 without checking that plan.
```

### Spec edit 2 — register the Phase B tests in §18

ANCHOR (verify unique — `grep -F -c 'End-to-end onboarding → first beat → user response → next beat' docs/specs/life-sim.md` must print `1`). Insert **immediately after** this line:

```
| TBD: `tests/e2e/specs/life-flow.spec.ts` (Phase B+) | End-to-end onboarding → first beat → user response → next beat |
```

Insert this exact block (one table row):

```markdown
| `src/screens/LifeScreen/useWorldThumbnail.test.tsx` + `src/screens/LifeScreen/WorldCard.test.tsx` + `tests/e2e/specs/life-overview-thumbnail.spec.ts` (Wurlds-v2 Phase B) | LIFE-WORLD-9 — read-only thumbnail resolution ladder, no-banner-for-fresh-worlds, zero-Gemini post-condition |
```

## Ordered steps

Execute strictly in this order (spec → failing tests → implementation → green). Run every `grep -F -c` uniqueness check before applying its edit; each must print exactly `1`. If any prints something else, STOP and report — the source has drifted from this doc.

1. **Spec edits.** Apply Spec edit 1 and Spec edit 2 above to `docs/specs/life-sim.md`.
2. **Author the three test files** exactly as given in the *Tests* section below:
   - `src/screens/LifeScreen/useWorldThumbnail.test.tsx` (new file)
   - `src/screens/LifeScreen/WorldCard.test.tsx` (new file)
   - `tests/e2e/specs/life-overview-thumbnail.spec.ts` (new file)
3. **Confirm the unit tests FAIL** (red-first gate):
   ```bash
   npx vitest run src/screens/LifeScreen/useWorldThumbnail.test.tsx src/screens/LifeScreen/WorldCard.test.tsx
   ```
   Expected failure modes: `useWorldThumbnail.test.tsx` fails to load with an unresolved-module error for `./useWorldThumbnail` (the hook does not exist yet). `WorldCard.test.tsx` most likely runs (the hook is factory-mocked, and `WorldCard` does not import it until Edit 2b): its first test ('banner renders the resolved SVG markup inside the tap target') fails with a `LifeOverview-WorldCard-Thumb` testid-not-found assertion, while the fresh-world test AND the card-body test pass (the card-body test asserts only pre-existing DOM — the `LifeOverview-WorldCard` testid and the 'Marc' text). One failing test satisfies the red gate. If instead the whole `WorldCard.test.tsx` file fails to collect (some vitest versions eagerly resolve a `vi.mock` path even when unimported), that ALSO counts as red — either shape satisfies this gate. Do NOT create a stub hook to make the errors nicer; proceed to step 4.
4. **Confirm the E2E FAILS** (red-first gate; needs network + the E2E web server, which Playwright auto-spawns on port 5187):
   ```bash
   cd tests/e2e && npx playwright test life-overview-thumbnail.spec.ts; cd ../..
   ```
   Expected failure mode: `LifeOverview-WorldCard-Thumb` never becomes visible (timeout). The two seeded cards themselves SHOULD appear — if they don't, fix the seeding before proceeding.
5. **Create the new hook** `src/screens/LifeScreen/useWorldThumbnail.ts` — complete file contents in Edit 1 below.
6. **Edit `src/screens/LifeScreen/WorldCard.tsx`** — Edits 2a-2e below, in order.
7. **Run to green**: the commands in *Verify* below. Iterate on the implementation (not the tests) until green; if a test seems wrong, re-read LIFE-WORLD-9 as written in step 1 before touching it — the spec's intent decides.

---

### Edit 1 — NEW FILE `src/screens/LifeScreen/useWorldThumbnail.ts`

Complete contents, ready to paste (this is the whole file):

```ts
/**
 * LIFE-WORLD-9: read-only scene thumbnail for the overview WorldCard.
 *
 * Resolves the world's most-recently-persisted scene SVG WITHOUT ever
 * triggering generation (zero Gemini calls — the overview must stay
 * free). Resolution ladder:
 *   1. `descriptorFromWorld(world)` — null for fresh worlds → no banner.
 *   2. Sync localStorage cache hit (`readSceneCache`).
 *   3. Bundled fallback silhouette immediately, then the async
 *      Firestore mirror (`readPersistentScene`) swaps in if it hits —
 *      and re-seeds the local cache so the next render (and the
 *      LifeScreen open) is a sync hit.
 *
 * Same ladder as `useLifeScene` (src/hooks/useLifeScene.ts) MINUS the
 * generation step. Persisted SVGs were sanitised at generation time
 * (see src/lib/life/sanitizeSvg.ts) — no re-sanitisation on read,
 * matching SceneStage.
 *
 * Spec: docs/specs/life-sim.md §10.6 (LIFE-WORLD-9).
 */
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/store/authStore';
import { getFallbackScene } from '@/lib/life/fallbackScenes';
import { pickFallback } from '@/lib/life/sceneDescriptor';
import { readSceneCache, writeSceneCache } from '@/lib/life/sceneCache';
import { readPersistentScene } from '@/lib/life/scenes';
import type { LifeWorld } from '@/types/firestore';
import { descriptorFromWorld } from './sceneDescriptorForLife';

export function useWorldThumbnail(world: LifeWorld): { svg: string | null } {
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const descriptor = descriptorFromWorld(world);

  // Lazy initializer so a sync cache hit (or the silhouette) paints on
  // the very first frame — no banner pop-in after mount. Cards are
  // keyed by world.id in the overview list, so mount-time init is
  // per-world; the effect below handles post-mount descriptor changes.
  const [svg, setSvg] = useState<string | null>(() => {
    if (!descriptor) return null;
    return (
      readSceneCache(descriptor, world.id) ??
      getFallbackScene(pickFallback(descriptor))
    );
  });

  // Same setState-in-effect shape as useLifeScene: the cache lookup is
  // sync but the Firestore fallback isn't, and both feed one state.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!descriptor) {
      setSvg(null);
      return;
    }
    // 1. Sync localStorage hit — done; never touch the network.
    const cached = readSceneCache(descriptor, world.id);
    if (cached) {
      setSvg(cached);
      return;
    }
    // 2. Silhouette while (and in case) the Firestore read misses —
    //    banner presence stays deterministic on descriptor presence.
    setSvg(getFallbackScene(pickFallback(descriptor)));
    if (!uid) return;
    let cancelled = false;
    void (async () => {
      const persisted = await readPersistentScene(uid, world.id, descriptor);
      if (cancelled || !persisted) return;
      // Re-seed the local cache so subsequent renders are sync hits.
      writeSceneCache(descriptor, world.id, persisted);
      setSvg(persisted);
    })();
    return () => {
      cancelled = true;
    };
    // descriptor is rebuilt every render by descriptorFromWorld — depend
    // on its identity-bearing fields instead of the object (same pattern
    // + justification as useLifeScene).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [descriptor?.locationType, descriptor?.vibe, descriptor?.persistent, descriptor?.label, world.id, uid]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { svg };
}
```

### Edit 2 — `src/screens/LifeScreen/WorldCard.tsx`

Five edits, top-to-bottom. Apply in order.

#### Edit 2a — header comment (also fixes the stale `§1.5` spec reference)

ANCHOR (verify unique — `grep -F -c 'a single world card on the overview screen' src/screens/LifeScreen/WorldCard.tsx` must print `1`). Replace this entire block:

```tsx
/**
 * LIFE-WORLD-*: a single world card on the overview screen.
 *
 * Renders: character name, current location label, practice
 * language, session-day streak, and a chapter-status line driven by
 * `currentArc`. Tap → open the world. Three-dot menu offers Delete.
 *
 * Spec: docs/specs/life-sim.md §1.5 (LIFE-WORLD-*).
 */
```

with:

```tsx
/**
 * LIFE-WORLD-*: a single world card on the overview screen.
 *
 * Renders: scene-thumbnail banner (LIFE-WORLD-9 — read-only reuse of
 * the world's persisted scene SVG, absent for fresh worlds), character
 * name, current location label, practice language, session-day streak,
 * and a chapter-status line driven by `currentArc`. Tap → open the
 * world. Three-dot menu offers Delete.
 *
 * Spec: docs/specs/life-sim.md §10.6 (LIFE-WORLD-*).
 */
```

#### Edit 2b — import the hook

ANCHOR (verify unique — `grep -F -c "import { cn } from '@/lib/cn';" src/screens/LifeScreen/WorldCard.tsx` must print `1`). Replace:

```tsx
import { cn } from '@/lib/cn';
```

with:

```tsx
import { cn } from '@/lib/cn';
import { useWorldThumbnail } from './useWorldThumbnail';
```

#### Edit 2c — call the hook

ANCHOR (verify unique — `grep -F -c "const teaser = world.saga?.playerFacingTeaser?.trim() ?? '';" src/screens/LifeScreen/WorldCard.tsx` must print `1`). Replace:

```tsx
  const teaser = world.saga?.playerFacingTeaser?.trim() ?? '';
```

with:

```tsx
  const teaser = world.saga?.playerFacingTeaser?.trim() ?? '';
  const { svg: thumbSvg } = useWorldThumbnail(world);
```

#### Edit 2d — banner + padded content wrapper (the main tap-target button)

The button's `p-4` moves onto an inner wrapper `div` so the banner can bleed edge-to-edge. ANCHOR (verify unique — this is the ENTIRE current button block; check with `grep -F -c 'className="w-full text-left p-4 flex flex-col gap-1.5 hover:bg-(--color-bg-hover) active:scale-[0.99] transition disabled:opacity-50"' src/screens/LifeScreen/WorldCard.tsx` → must print `1`). Replace this entire block:

```tsx
      <button
        type="button"
        onClick={onOpen}
        disabled={!!deleting}
        className="w-full text-left p-4 flex flex-col gap-1.5 hover:bg-(--color-bg-hover) active:scale-[0.99] transition disabled:opacity-50"
      >
        {/* Title row: saga title (falls back to setting label until the
            saga lands) + meta. Reserve 2rem on the right so the
            absolute-positioned 3-dot menu doesn't overlap the chip. */}
        <div className="flex items-center justify-between gap-2 pr-8">
          <div className="text-base font-semibold text-gradient-accent truncate">
            {world.saga?.title?.trim() || describeSetting(world, t)}
          </div>
          <div className="flex items-center gap-1 text-xs font-semibold text-(--color-fg-muted) shrink-0">
            {world.sessionDayCount && world.sessionDayCount > 0 ? (
              <span
                title={t('life.streak.title', { count: world.sessionDayCount })}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-amber-600 bg-amber-100"
              >
                <Flame size={12} />
                {world.sessionDayCount}
              </span>
            ) : null}
            <span>{world.practiceLanguage}</span>
          </div>
        </div>
        {/* Character row: who the player is playing in this world. */}
        <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted) truncate">
          <User size={11} className="text-(--color-fg-muted) shrink-0" />
          <span className="truncate">{world.characterName}</span>
        </div>
        {/* Location with pin icon, only when set. */}
        {world.currentLocationLabel && (
          <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted) truncate">
            <MapPin size={11} className="text-(--color-fg-muted) shrink-0" />
            <span className="truncate">{world.currentLocationLabel}</span>
          </div>
        )}
        {/* Story line: the saga's spoiler-safe teaser. The main hook
            the player sees for the world. Line-clamped so the card
            doesn't blow out when the teaser is 3 sentences. Falls back
            to a stub when the saga is still being generated. */}
        <div className="mt-1 inline-flex items-start gap-1.5 text-xs text-(--color-fg)">
          <BookOpen size={11} className="text-(--color-accent) mt-0.5 shrink-0" />
          <span className="leading-snug line-clamp-3">
            {teaser || t('life.overview.story.pending')}
          </span>
        </div>
      </button>
```

with:

```tsx
      <button
        type="button"
        onClick={onOpen}
        disabled={!!deleting}
        className="w-full text-left flex flex-col hover:bg-(--color-bg-hover) active:scale-[0.99] transition disabled:opacity-50"
      >
        {/* LIFE-WORLD-9: scene-thumbnail banner. Read-only reuse of the
            world's persisted scene SVG — never triggers generation.
            null (fresh world, no currentScene) → no banner at all; the
            card stays compact. Decorative (aria-hidden): the text rows
            below carry the meaning, same as SceneStage. */}
        {thumbSvg !== null && (
          <div
            data-testid="LifeOverview-WorldCard-Thumb"
            aria-hidden
            className="relative h-24 w-full shrink-0 overflow-hidden rounded-t-2xl"
          >
            <div
              className="absolute inset-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:block"
              dangerouslySetInnerHTML={{ __html: thumbSvg }}
            />
            {/* Bottom scrim so the artwork fades cleanly into the card
                content below and the title row reads against a calm
                edge in both themes. */}
            <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-black/25 to-transparent" />
          </div>
        )}
        <div className="p-4 flex flex-col gap-1.5">
          {/* Title row: saga title (falls back to setting label until the
              saga lands) + meta. Reserve 2rem on the right so the
              absolute-positioned 3-dot menu doesn't overlap the chip. */}
          <div className="flex items-center justify-between gap-2 pr-8">
            <div className="text-base font-semibold text-gradient-accent truncate">
              {world.saga?.title?.trim() || describeSetting(world, t)}
            </div>
            <div className="flex items-center gap-1 text-xs font-semibold text-(--color-fg-muted) shrink-0">
              {world.sessionDayCount && world.sessionDayCount > 0 ? (
                <span
                  title={t('life.streak.title', { count: world.sessionDayCount })}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-amber-600 bg-amber-100"
                >
                  <Flame size={12} />
                  {world.sessionDayCount}
                </span>
              ) : null}
              <span>{world.practiceLanguage}</span>
            </div>
          </div>
          {/* Character row: who the player is playing in this world. */}
          <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted) truncate">
            <User size={11} className="text-(--color-fg-muted) shrink-0" />
            <span className="truncate">{world.characterName}</span>
          </div>
          {/* Location with pin icon, only when set. */}
          {world.currentLocationLabel && (
            <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted) truncate">
              <MapPin size={11} className="text-(--color-fg-muted) shrink-0" />
              <span className="truncate">{world.currentLocationLabel}</span>
            </div>
          )}
          {/* Story line: the saga's spoiler-safe teaser. The main hook
              the player sees for the world. Line-clamped so the card
              doesn't blow out when the teaser is 3 sentences. Falls back
              to a stub when the saga is still being generated. */}
          <div className="mt-1 inline-flex items-start gap-1.5 text-xs text-(--color-fg)">
            <BookOpen size={11} className="text-(--color-accent) mt-0.5 shrink-0" />
            <span className="leading-snug line-clamp-3">
              {teaser || t('life.overview.story.pending')}
            </span>
          </div>
        </div>
      </button>
```

#### Edit 2e — 3-dot menu button contrast over the banner

ANCHOR (verify unique — the bare `className` line appears TWICE in the file (the confirm-dialog close button reuses it), so the anchor MUST include the `<MoreVertical …>` line; check with `grep -F -c '<MoreVertical size={16} />' src/screens/LifeScreen/WorldCard.tsx` → must print `1`). Replace:

```tsx
        className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)"
      >
        <MoreVertical size={16} />
      </button>
```

with:

```tsx
        className={cn(
          'absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)',
          // Over the thumbnail banner the muted icon can vanish into the
          // artwork — give it a translucent chip for contrast.
          thumbSvg !== null && 'bg-(--color-bg)/70 backdrop-blur-sm text-(--color-fg)',
        )}
      >
        <MoreVertical size={16} />
      </button>
```

Note: `cn` is already imported in this file — Edit 2b adds nothing for this.

**Test-selector casing:** the new testid is `LifeOverview-WorldCard-Thumb` — PascalCase-dash, deliberately NOT the kebab-case shown in `docs/conventions.md`'s example. The whole Life surface already uses this casing (`LifeOverview-WorldCard`, `LifeOverview-WorldCard-Menu`, `LifeScreen-SceneStage`), and the E2E below scopes via `.getByTestId('LifeOverview-WorldCard').filter(...)` — sibling-id consistency wins. Do not "fix" the casing.

**i18n:** this phase adds NO user-visible strings (the banner is decorative, `aria-hidden`). Do NOT touch `src/i18n/locales/en.ts` or any locale file.

**LOC check:** `WorldCard.tsx` grows from 272 to ~300 lines — well under the 600-LOC cap. No extraction needed.

## Tests

Three new files. Every `it(...)` description starts with the invariant id (repo convention — `git grep LIFE-WORLD-9` must land on all of them).

### Test file 1 — NEW FILE `src/screens/LifeScreen/useWorldThumbnail.test.tsx`

Complete contents, ready to paste:

```tsx
/**
 * LIFE-WORLD-9 — useWorldThumbnail resolution ladder.
 *
 * Real modules: sceneCache (localStorage in jsdom), fallbackScenes,
 * sceneDescriptor, sceneDescriptorForLife. Mocked: authStore (uid) and
 * lib/life/scenes (Firestore — keeps @/lib/firebase out of the test).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LifeWorld } from '@/types/firestore';
import { getFallbackScene } from '@/lib/life/fallbackScenes';
import { pickFallback } from '@/lib/life/sceneDescriptor';
import { readSceneCache, writeSceneCache } from '@/lib/life/sceneCache';

// --- Controllable mock state ---------------------------------------------
let uidValue: string | null = 'u1';
vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { uid: string } | null }) => unknown) =>
    sel({ user: uidValue ? { uid: uidValue } : null }),
}));

const readPersistentSceneMock = vi.fn<
  (uid: string, worldId: string, d: unknown) => Promise<string | null>
>(async () => null);
vi.mock('@/lib/life/scenes', () => ({
  readPersistentScene: (uid: string, worldId: string, d: unknown) =>
    readPersistentSceneMock(uid, worldId, d),
}));

import { useWorldThumbnail } from './useWorldThumbnail';

// --- Fixtures --------------------------------------------------------------
const CURRENT_SCENE = {
  locationType: 'cafe',
  vibe: 'modern_city',
  persistent: true,
  label: 'Cafe Lumiere',
};

function world(over: Partial<LifeWorld> = {}): LifeWorld {
  return {
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    ...over,
  };
}

const CACHED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#0c0c0c"/></svg>';
const REMOTE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#123456"/></svg>';
const SILHOUETTE = getFallbackScene(pickFallback(CURRENT_SCENE));

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('LIFE-WORLD-9 — useWorldThumbnail', () => {
  beforeEach(() => {
    localStorage.clear();
    uidValue = 'u1';
    readPersistentSceneMock.mockReset();
    readPersistentSceneMock.mockResolvedValue(null);
  });

  it('LIFE-WORLD-9 — fresh world (no currentScene) resolves to null; no reads fired', async () => {
    const { result } = renderHook(() => useWorldThumbnail(world()));
    expect(result.current.svg).toBeNull();
    await flush();
    expect(result.current.svg).toBeNull();
    expect(readPersistentSceneMock).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-9 — sync localStorage hit renders on first frame; Firestore read skipped', async () => {
    writeSceneCache(CURRENT_SCENE, 'w1', CACHED_SVG);
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentScene: CURRENT_SCENE })),
    );
    expect(result.current.svg).toBe(CACHED_SVG);
    await flush();
    expect(result.current.svg).toBe(CACHED_SVG);
    expect(readPersistentSceneMock).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-9 — cache miss: silhouette immediately, persisted SVG swaps in and re-seeds the cache', async () => {
    readPersistentSceneMock.mockResolvedValue(REMOTE_SVG);
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentScene: CURRENT_SCENE })),
    );
    // Silhouette from the very first frame — no blank banner state.
    expect(result.current.svg).toBe(SILHOUETTE);
    await waitFor(() => expect(result.current.svg).toBe(REMOTE_SVG));
    expect(readPersistentSceneMock).toHaveBeenCalledWith(
      'u1',
      'w1',
      expect.objectContaining({ label: 'Cafe Lumiere' }),
    );
    // Re-seed: the next render is a sync hit.
    expect(readSceneCache(CURRENT_SCENE, 'w1')).toBe(REMOTE_SVG);
  });

  it('LIFE-WORLD-9 — cache miss + Firestore miss: silhouette stays; exactly one read, zero retries', async () => {
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentScene: CURRENT_SCENE })),
    );
    expect(result.current.svg).toBe(SILHOUETTE);
    await flush();
    expect(readPersistentSceneMock).toHaveBeenCalledTimes(1);
    expect(result.current.svg).toBe(SILHOUETTE);
  });

  it('LIFE-WORLD-9 — signed-out (no uid): async read skipped, silhouette renders', async () => {
    uidValue = null;
    const { result } = renderHook(() =>
      useWorldThumbnail(world({ currentScene: CURRENT_SCENE })),
    );
    expect(result.current.svg).toBe(SILHOUETTE);
    await flush();
    expect(readPersistentSceneMock).not.toHaveBeenCalled();
  });

  it('LIFE-WORLD-9 — hook source never references a generation path (read-only reuse guard)', () => {
    // __dirname + join is the repo's established static-test pattern
    // (src/lib/__tests__/no-bare-model-literals.static.test.ts) — do
    // NOT use import.meta.url here (URL-scheme varies by transform).
    const src = readFileSync(join(__dirname, 'useWorldThumbnail.ts'), 'utf8');
    expect(src).not.toMatch(
      /generateScene|generateGemini|geminiGenerate|runLifeStep|callHttp|callFunction/,
    );
  });
});
```

### Test file 2 — NEW FILE `src/screens/LifeScreen/WorldCard.test.tsx`

Complete contents, ready to paste:

```tsx
/**
 * LIFE-WORLD-9 — WorldCard scene-thumbnail banner render contract.
 *
 * The hook is mocked (its ladder is covered by
 * useWorldThumbnail.test.tsx); these tests pin the DOM contract:
 * banner present ⇔ svg non-null, and the banner carries the SVG bytes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LifeWorld } from '@/types/firestore';

// --- Controllable mock state ---------------------------------------------
let thumbValue: string | null = null;
vi.mock('./useWorldThumbnail', () => ({
  useWorldThumbnail: () => ({ svg: thumbValue }),
}));
vi.mock('@/i18n', () => ({
  useT: () => (key: string, vars?: Record<string, string | number>) =>
    vars ? `${key}:${Object.values(vars).join(',')}` : key,
}));

import { WorldCard } from './WorldCard';

function world(over: Partial<LifeWorld> = {}): LifeWorld {
  return {
    id: 'w1',
    characterName: 'Marc',
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    ...over,
  };
}

const THUMB_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800"><rect width="1200" height="800" fill="#123456"/></svg>';

describe('LIFE-WORLD-9 — WorldCard thumbnail banner', () => {
  beforeEach(() => {
    thumbValue = null;
  });

  it('LIFE-WORLD-9 — banner renders the resolved SVG markup inside the tap target', () => {
    thumbValue = THUMB_SVG;
    render(<WorldCard world={world()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    const banner = screen.getByTestId('LifeOverview-WorldCard-Thumb');
    expect(banner.querySelector('svg')).not.toBeNull();
    expect(banner.innerHTML).toContain('fill="#123456"');
    // The banner is decorative — it must be aria-hidden.
    expect(banner.getAttribute('aria-hidden')).toBe('true');
  });

  it('LIFE-WORLD-9 — no banner when the thumbnail is null (fresh world stays compact)', () => {
    thumbValue = null;
    render(<WorldCard world={world()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByTestId('LifeOverview-WorldCard-Thumb')).toBeNull();
  });

  it('LIFE-WORLD-9 — card body (character row + card container) still renders alongside the banner', () => {
    thumbValue = THUMB_SVG;
    render(<WorldCard world={world()} onOpen={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByTestId('LifeOverview-WorldCard')).toBeInTheDocument();
    expect(screen.getByText('Marc')).toBeInTheDocument();
  });
});
```

### Test file 3 — NEW FILE `tests/e2e/specs/life-overview-thumbnail.spec.ts`

Tier: `@standard` (no `@full`/`@critical` tag needed for the standard run — `test:e2e:standard` is `--grep-invert @full` — but the title carries `@standard` for grep-ability, matching `backfill-stuck-recovery.spec.ts`). This spec asserts the POST-CONDITIONS, not the affordance: (1) the persisted Firestore `svgInline` bytes actually render in the banner on a fresh browser context (localStorage empty → exercises the async path end-to-end), (2) a fresh world renders no banner, (3) **zero** Gemini requests fire (`geminiGenerate` AND `geminiStreamV2` — the only two Gemini endpoints in `src/lib/gemini.ts`).

Complete contents, ready to paste:

```ts
/**
 * E2E: LIFE-WORLD-9 — overview WurldCard scene thumbnail (@standard).
 *
 * Seeds two worlds via the admin SDK (no onboarding, no Gemini):
 *   - THUMB world: has currentScene + a persisted scene doc whose
 *     svgInline carries a distinctive fill. Fresh browser context ⇒
 *     localStorage is empty ⇒ the banner can only come from the
 *     Firestore mirror — the exact post-condition under test.
 *   - FRESH world: no currentScene ⇒ the card must stay bannerless.
 *
 * Every Gemini request (geminiGenerate + geminiStreamV2) is
 * intercepted and counted; the run must end with ZERO calls
 * (thumbnail is read-only reuse).
 *
 * Phone prefix: +1000062_A.
 */
import {
  test,
  expect,
  type BrowserContext,
  type Page,
  type Route,
} from '@playwright/test';
import {
  provisionTestUser,
  signInBrowser,
  type AuthenticatedUser,
} from '../helpers/auth';
import { cleanupTestUsers, getAdminFirestore } from '../helpers/firebase-admin';
import { captureBeat } from '../helpers/screenshots';

const USER_A = {
  phone: process.env.TEST_PHONE_LIFE_THUMB || '+10000620001',
  displayName: 'Life Thumb',
  nativeLanguage: 'English (British)',
  practiceLanguage: 'French',
  difficulty: 3,
};

const THUMB_WORLD_ID = 'w-e2e-thumb';
const FRESH_WORLD_ID = 'w-e2e-fresh';

/** Distinctive fill so the assertion proves the banner shows THIS
 *  persisted SVG, not a bundled fallback silhouette. */
const SEEDED_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="800" fill="#123456"/></svg>';

let userA: AuthenticatedUser;
let context: BrowserContext;
let page: Page;
const geminiCalls: string[] = [];

async function wipeWorlds(uid: string): Promise<void> {
  const db = getAdminFirestore();
  const worlds = await db.collection(`users/${uid}/lifeWorlds`).get();
  for (const w of worlds.docs) {
    for (const sub of ['scenes', 'events', 'npcs', 'campaigns']) {
      const docs = await w.ref.collection(sub).get();
      const batch = db.batch();
      docs.forEach((d) => batch.delete(d.ref));
      if (!docs.empty) await batch.commit();
    }
    await w.ref.delete();
  }
}

/** Minimal ZLifeWorld-valid doc. updatedAt is REQUIRED — the overview
 *  query is orderBy('updatedAt','desc') and Firestore excludes docs
 *  missing the orderBy field. */
function worldDoc(id: string, characterName: string, updatedAt: Date) {
  return {
    id,
    characterName,
    practiceLanguage: 'French',
    nativeLanguage: 'English (British)',
    difficulty: 3,
    worldSeedKey: 'city_life',
    rollingSummary: '',
    createdAt: updatedAt,
    updatedAt,
  };
}

test.describe.serial('@standard LIFE-WORLD-9 — overview scene thumbnail', () => {
  test.beforeAll(async ({ browser }) => {
    userA = await provisionTestUser(USER_A);
    await wipeWorlds(userA.uid);
    const db = getAdminFirestore();

    // World WITH a persisted scene. label 'Cafe Lumiere' →
    // descriptorCacheKey 'cafe_lumiere' (lowercase, spaces→_, ASCII
    // only) → sceneDocId 'cafe_lumiere' (no '::' to rewrite). The
    // scene doc id below MUST stay in sync with the label.
    await db.doc(`users/${userA.uid}/lifeWorlds/${THUMB_WORLD_ID}`).set({
      ...worldDoc(THUMB_WORLD_ID, 'Thumb Hero', new Date('2026-07-14T12:00:00Z')),
      currentScene: {
        locationType: 'cafe',
        vibe: 'modern_city',
        persistent: true,
        label: 'Cafe Lumiere',
      },
    });
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${THUMB_WORLD_ID}/scenes/cafe_lumiere`)
      .set({
        id: 'cafe_lumiere',
        descriptor: 'cafe_lumiere',
        svgInline: SEEDED_SVG,
        locationLabel: 'Cafe Lumiere',
        createdAt: new Date(),
        lastVisitedAt: new Date(),
      });

    // Fresh world: no currentScene → the card must stay bannerless.
    await db
      .doc(`users/${userA.uid}/lifeWorlds/${FRESH_WORLD_ID}`)
      .set(worldDoc(FRESH_WORLD_ID, 'Fresh Face', new Date('2026-07-14T11:00:00Z')));

    context = await browser.newContext({
      viewport: { width: 414, height: 896 },
    });
    // ZERO-GEN GUARD: count every Gemini request. None may fire —
    // fulfilling with 500 makes an accidental call loud. Both
    // endpoints (generate + stream) are covered; the glob matches the
    // Vite same-origin proxy path (/__functions/<name>) AND the direct
    // cloudfunctions.net URL.
    const countGemini = async (route: Route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as {
        category?: string;
      };
      geminiCalls.push(body.category ?? 'unknown');
      await route.fulfill({
        status: 500,
        contentType: 'text/plain',
        body: 'life-overview-thumbnail: unexpected Gemini call',
      });
    };
    await context.route('**/geminiGenerate', countGemini);
    await context.route('**/geminiStreamV2', countGemini);
    page = await context.newPage();
  });

  test.afterAll(async () => {
    await context?.close();
    if (userA) await wipeWorlds(userA.uid);
    await cleanupTestUsers(userA?.uid);
  });

  test('LIFE-WORLD-9 — persisted scene renders as the card banner; fresh world stays compact; zero Gemini calls', async ({}, testInfo) => {
    await signInBrowser(page, userA);
    await page.goto('/life');
    await page.waitForLoadState('domcontentloaded');
    // LIFE-WORLD-3: /life always lands on the overview.
    await page.waitForURL((url) => url.pathname === '/life/overview', {
      timeout: 10_000,
    });

    const thumbCard = page
      .getByTestId('LifeOverview-WorldCard')
      .filter({ hasText: 'Thumb Hero' });
    const freshCard = page
      .getByTestId('LifeOverview-WorldCard')
      .filter({ hasText: 'Fresh Face' });
    await expect(thumbCard).toBeVisible({ timeout: 15_000 });
    await expect(freshCard).toBeVisible();

    // POST-CONDITION 1: the banner contains the PERSISTED SVG bytes
    // (distinctive fill) — proof the Firestore svgInline path resolved,
    // not merely that a banner div exists.
    const banner = thumbCard.getByTestId('LifeOverview-WorldCard-Thumb');
    await expect(banner.locator('svg')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => banner.innerHTML(), { timeout: 15_000 })
      .toContain('#123456');

    // POST-CONDITION 2: fresh world → no banner element at all.
    await expect(
      freshCard.getByTestId('LifeOverview-WorldCard-Thumb'),
    ).toHaveCount(0);

    await captureBeat(page, testInfo, 'overview-thumbnails');

    // POST-CONDITION 3: zero Gemini traffic from the overview.
    expect(geminiCalls).toEqual([]);
  });
});
```

## Verify

Run from the repo root, in this order. All must be green before commit.

```bash
# 1. Scoped unit/component tests (the new ones)
npx vitest run src/screens/LifeScreen/useWorldThumbnail.test.tsx src/screens/LifeScreen/WorldCard.test.tsx

# 2. Full unit suite (screens/ touched → full run per the obligations matrix)
npm test

# 3. Typecheck
npm run typecheck

# 4. Lint the touched files
npx eslint src/screens/LifeScreen/useWorldThumbnail.ts src/screens/LifeScreen/WorldCard.tsx src/screens/LifeScreen/useWorldThumbnail.test.tsx src/screens/LifeScreen/WorldCard.test.tsx

# 5. The Phase B E2E spec (Playwright auto-spawns the web server on port 5187;
#    needs network + Firebase admin credentials, same harness life-flow uses)
cd tests/e2e && npx playwright test life-overview-thumbnail.spec.ts; cd ../..
```

After step 5, open the captured screenshot(s) under `screenshots/<run-id>/life-overview-thumbnail/` (the `overview-thumbnails` beat; `<run-id>` is the timestamped directory `captureBeat` creates at the repo root's `screenshots/`) with the Read tool and visually confirm: the Thumb Hero card shows a solid banner with the scrim, the Fresh Face card is compact with no banner, the 3-dot icon is legible over the banner, and nothing is misaligned in either card. Do not skip this — passing assertions are not a visual review.

Do NOT run `npm run test:e2e:critical` (prod smoke) and do NOT run the `@critical` emulator gate for this phase — Phase B does not touch the send/receive/pipeline path. `npm run test:prompts` is not required — no prompt files are touched.

## Out of scope

Do NOT touch any of the following in this phase. If a change there seems necessary, STOP and report instead of editing:

- `src/screens/LifeScreen/LifeOverviewScreen.tsx`, `LifeOverviewEmpty.tsx`, `LifeOverviewExplainer.tsx`, `overviewSamples.ts` — the sample/empty-state cards do NOT get thumbnails.
- `src/hooks/useLifeScene.ts`, `src/screens/LifeScreen/SceneStage.tsx` — patterns are copied FROM these, never edited.
- `src/lib/life/sceneCache.ts`, `scenes.ts`, `fallbackScenes.ts`, `sceneDescriptor.ts`, `sanitizeSvg.ts`, `generateScene.ts` — read-only reuse.
- `src/screens/LifeScreen/sceneDescriptorForLife.ts` — imported as-is.
- `src/types/firestore.ts` — no schema change in Phase B (Phases C/D/E/F own their own `ZLifeWorld`/`ZStepChoice` changes).
- `src/i18n/locales/en.ts` and all other locale files — no new strings (Phase A owns the wurlds copy rebrand; do not fold it in here).
- `tests/e2e/specs/life-flow.spec.ts` / `life-flow-real.spec.ts` / `tests/e2e/helpers/lifeMock.ts` — the flow suite stays untouched; this phase ships its own spec file.
- `docs/specs/README.md` — the `LIFE-*` prefix row already covers `WORLD`; no edit.
- Anything under `functions/` — zero backend changes.
- Resume recap (`WurldResumeScreen`), viewMode toggle, vocab taps, node engine — Phases C/D/E/F respectively; do not anticipate their code even where it would be convenient.
