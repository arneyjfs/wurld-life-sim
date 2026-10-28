/**
 * LIFE-SCENE-2 — whose scene this is, decided in code.
 *
 * Spec: docs/specs/story-architecture.md §3.
 *
 * THE DEFECT THIS FIXES. The third headless playthrough's village world read
 * back as ten history lines that were all the same line:
 *
 *   1. …learned he is seriously considering selling his bakery due to failing health.
 *   3. …his failing health is forcing him to abandon his bakery work…
 *   5. …as he confirmed his decision to close the shop.
 *   7. …confirmed the community's awareness of Pierre's failing health…
 *   8. …Pierre is physically unable to continue baking…
 *   9. …Pierre intends to close the bakery permanently…
 *
 * Nothing was escalating — signal 1 passed — and every scene drew on old canon,
 * so signal 4 passed too. The world simply had ONE subject, rediscovered ten
 * times. The cause is structural: the front's driver is the most salient person
 * in the planner's context, so the planner picks them, every time, forever.
 *
 * The fix is the mechanism that already works one level down. `requiredTypeForTurn`
 * rotates the option grid because a model handed the same context produces the
 * same shape; this rotates the SCENE the same way and for the same reason. Every
 * (n+1)th scene belongs to nobody's ambition at all — a world where every scene
 * advances somebody's agenda is a world with no ordinary days in it, and the
 * ordinary days are what make the others land.
 *
 * ── SRV-PROMPT-8..13 batch 4: WHAT LEFT THIS FILE, AND WHAT DID NOT ─────────
 *
 * `renderSceneFocus` and `renderRecentSubjects` were PROMPT TEXT with exactly
 * one non-test consumer — `prompts/sceneOpen.ts` — so when that prompt moved
 * server-side they moved WHOLE rather than being duplicated (SRV-PROMPT-3).
 * They now live in `functions/src/prompts/lifeSceneOpen.ts`, and their
 * assertions moved with them to
 * `functions/src/__tests__/lifeSceneOpen.test.ts`. There is no parity guard for
 * them and no expiry, because there is no second copy.
 *
 * `focusForScene` stayed, and the split is the point: the ROTATION is engine
 * arithmetic over `sceneCount` and the live cast, it is what makes a replay
 * reproducible in a bug report, and `runSceneOpen` logs its result. It sends
 * the DECISION — `{castId, name}` or `null` — and the server renders the
 * wording. Same shape as `needSign` and `ironyAvailable`: decided in code
 * because each is a rule a model can satisfy by doing nothing, rendered on the
 * server because the wording is the part a `deploy:prod:functions` should be
 * able to correct.
 */
import type { CastMember } from '@/types/lifeState';

/**
 * How many recent scene subjects a world KEEPS. Six is two full rotations at
 * three principals — enough to see a loop forming.
 *
 * ⚠ THIS IS A SPLIT ARTEFACT, AND ITS DUPLICATION DOES NOT EXPIRE. The number
 * does two different jobs for two different readers:
 *
 *   - HERE it is a STORAGE cap. `startScene` writes
 *     `recentSubjects: [...old, subject].slice(-RECENT_SUBJECTS_WINDOW)` to the
 *     world doc, so this is what the client persists.
 *   - SERVER-SIDE (`functions/src/prompts/lifeSceneOpen.ts`) it is a RENDER
 *     window: how many of the subjects it is sent reach `<alreadyBeenAbout>`.
 *
 * It was nearly MOVED with `renderRecentSubjects` on the reading that it was
 * prompt text. It is not — a Firestore write cap never migrates — so the two
 * copies are permanent, the way `avatar/parts.ts` is and unlike batch 1's gloss
 * tables. `tests/playthrough/serverPromptParity.test.ts` asserts they agree and
 * carries NO expiry.
 *
 * Drift is silent in both directions and wrong in both: a store smaller than
 * the window means the planner can never see the loop the window was sized for,
 * and a store larger than it means the world carries rows nothing reads.
 */
export const RECENT_SUBJECTS_WINDOW = 6;

export type SceneFocus = { castId: string; name: string } | null;

/**
 * Whose ambition this scene turns on, or `null` for an ordinary day.
 *
 * Deterministic in the scene index, so a replay of the same world produces the
 * same rotation and the choice is reproducible in a bug report.
 */
export function focusForScene(sceneIndex: number, cast: readonly CastMember[]): SceneFocus {
  const principals = cast.filter((c) => c.tier === 'principal');
  if (principals.length === 0) return null;
  const slots = principals.length + 1; // + the ordinary day
  const i = Math.abs(Math.trunc(sceneIndex)) % slots;
  const p = principals[i];
  return p ? { castId: p.id, name: p.name } : null;
}
