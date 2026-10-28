/**
 * LIFE-SCENE-31.1 / LIFE-SCENE-32 / LIFE-ARCH-4 — the scene close, lifted out
 * of `nodeEngineActions` so that file stays under the 600-LOC cap.
 *
 * It is one self-contained job with one caller (`applyTurnSignals`'s
 * `resolvingNow` branch), and it owns the whole of the close's I/O: the
 * generation, the two world writes, and the single report back to the screen.
 * Nothing here touches the turn machine — no phase, no nonce, no refs — which
 * is why it can leave.
 */
import * as log from '@/lib/log';
import { lifeDebug } from '@/lib/life/debugLog';
import { runSceneClose } from '@/lib/life/runSceneClose';
import { frontsNeedingSign } from '@/lib/life/fronts';
import { updateLifeWorld } from '@/lib/life/world';
import { updateActiveScene } from '@/lib/life/scene';
import { buildSceneLog } from '@/lib/life/sceneLog';
import { applyLadderDelta, EMPTY_LADDER, worldFactsFor } from '@/lib/life/goalLadder';
import { ladderDeltaFromVerdict } from '@/lib/life/sceneCloseObjective';
import { lifeDebug as goalDebug } from '@/lib/life/debugLog';
import type { LifeEvent, LifeNpc, LifeWorld, SceneOutline } from '@/types/firestore';

/**
 * LIFE-SCENE-31.1 — a hung close must still end.
 *
 * `runSceneClose` has its own transport retry, but nothing bounds the total: a
 * request that never settles leaves the summary slot waiting on a promise that
 * will not resolve, which is indistinguishable to the player from the failure
 * modes the `finally` below catches.
 *
 * 25s is chosen against the thing it competes with rather than as a round
 * number: the card-match review it runs behind takes a player the better part
 * of a minute, so a close still in flight at 25s has already lost the race it
 * was started early to win, and waiting longer only postpones the placeholder.
 * Rejects rather than resolving to a sentinel, so the one `catch` handles a
 * timeout and a throw identically.
 */
export const SCENE_CLOSE_TIMEOUT_MS = 25_000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('scene-close timed out')), SCENE_CLOSE_TIMEOUT_MS),
    ),
  ]);
}

export type CloseResolvedSceneArgs = {
  uid: string;
  world: LifeWorld;
  /** `computeReplanPlan(...).outlineForReplan` — the scene as it stands now. */
  outline: SceneOutline;
  /** The WHOLE scene's events (LIFE-ARCH-2.2), not the render window. */
  events: LifeEvent[];
  /** LIFE-GOAL-11: the roster, so a re-minted objective's need resolves
   *  against real people rather than against nothing. */
  npcs: ReadonlyArray<LifeNpc>;
  /** `signal.resolved` — the beat that ended the scene. Used ONLY as the
   *  fallback record when the close produces none. */
  resolved: { outcomeLine?: string; outcomeLineNative?: string } | null | undefined;
  /** LIFE-SCENE-31.1: called EXACTLY ONCE, on every path including failure. */
  onSummary: (historyLine: string | null) => void;
};

/**
 * LIFE-ARCH-4 — `sceneClose` REPLACES `sceneReplan` on this trigger.
 *
 * The replan saw only the outline and the last dozen events, so it could only
 * erode the plan it was handed: measured in production rewriting the premise to
 * describe what had just happened and narrowing the endings 3 → 2 → 1 until the
 * scene was about nothing. The close sees the whole world and writes STATE —
 * one line of history, clock deltas under the budget, cast deltas, new canon —
 * rather than a revised plan. Nothing it produces is a future.
 *
 * LIFE-SCENE-31.1 — THE SUMMARY SLOT MUST REACH A TERMINAL STATE.
 *
 * Reported: the scene card's "what happened" hangs indefinitely. The TIMING was
 * already right — this is kicked off from the same synchronous block that arms
 * the card-match review, so it has the whole review to land in (LIFE-SCENE-32).
 * What was missing is that it had THREE silent dead ends, against a card that
 * renders `summary === null` as a pulsing placeholder with no terminal state,
 * so any of them shimmered for ever:
 *
 *   · `runSceneClose` returns `failed` (threw, or came back unparseable)
 *   · it returns ok with an EMPTY history line
 *   · anything in here throws — `updateLifeWorld`, `updateActiveScene`
 *
 * Every one of those used to `return` without telling the screen. The report
 * now comes out of a `finally`, and a failure falls back to the resolution
 * line, which is at least TRUE about how the scene ended.
 *
 * Never rejects — the caller stores it in `replanRef` and nothing awaits it.
 */
export async function closeResolvedScene({
  uid,
  world,
  outline,
  events,
  npcs,
  resolved,
  onSummary,
}: CloseResolvedSceneArgs): Promise<void> {
  const fallback = (resolved?.outcomeLineNative || resolved?.outcomeLine || '').trim();
  let landed = '';
  try {
    const closed = await withTimeout(
      runSceneClose({
        // LIFE-ARCH-2.2: the WHOLE scene, with speakers attached. This used to
        // read `recent` (the last twelve events) and drop the speaker off every
        // line, so the close model wrote a whole scene's history from its final
        // third with no idea who had said any of it. Measured: a history line
        // wrong about both the character and the place, written into permanent
        // world memory.
        sceneLog: buildSceneLog(events),
        subject: outline.subject ?? outline.premise,
        atStake: outline.premise,
        cast: world.cast ?? [],
        fronts: world.fronts ?? [],
        realistic: world.worldMode === 'realistic',
        requestedSignIds: frontsNeedingSign(world.fronts ?? []).map((f) => f.id),
        // LIFE-FRONT-8.1: the sign this SCENE was asked for and delivered,
        // recorded at open. Passing null here (as this did between phases 2 and
        // 3) makes every front read as unattended, so `driftUnattended` fires on
        // all of them every close.
        signOf: outline.signOf ?? null,
        // LIFE-GOAL-11: the close is the only caller that has read the whole
        // scene, so it is the one that can say whether the objective survived
        // it. Until this, the objective could only end if the mid-turn STEP
        // model volunteered an optional field — and an objective about a
        // failing pylon therefore followed the player into a scene about
        // somebody else's ledgers.
        objective: world.goalLadder?.objective
          ? { id: world.goalLadder.objective.id, text: world.goalLadder.objective.text }
          : null,
      }),
    );
    if (closed.kind !== 'ok') return;

    // LIFE-GOAL-11: apply the verdict through the SAME reducer the step path
    // uses, so there is one set of rules about what may happen to an objective.
    // Freeing the slot here is what lets `<goalDirective state="none">` mint a
    // fresh one on the next turn — the regeneration the player was missing.
    const ladderBefore = {
      ...EMPTY_LADDER,
      ...(world.goalLadder ?? {}),
      done: world.goalLadder?.done ?? [],
      dayIndex: world.goalLadder?.dayIndex ?? 0,
    };
    const ladderAfter = applyLadderDelta(
      ladderBefore,
      ladderDeltaFromVerdict(closed.objectiveVerdict, closed.objectiveBecause),
      worldFactsFor(world, npcs),
      { newId: `obj-close-${ladderBefore.done.length}` },
    );
    const ladderMoved = ladderAfter.objective?.id !== ladderBefore.objective?.id;
    goalDebug('GOAL', ladderMoved ? 'close ended the objective' : 'close left it standing', {
      verdict: closed.objectiveVerdict,
      because: closed.objectiveBecause,
      was: ladderBefore.objective?.text ?? null,
      now: ladderAfter.objective?.text ?? null,
    });

    await updateLifeWorld(uid, world.id, {
      fronts: closed.fronts,
      cast: closed.cast,
      ...(closed.situation ? { situation: closed.situation } : {}),
      ...(ladderMoved ? { goalLadder: ladderAfter } : {}),
      sagaHistory: [...(world.sagaHistory ?? []), closed.historyLine].filter(Boolean),
    });
    // Assigned HERE rather than at the response, so LIFE-SCENE-31's rule
    // survives a failed write: the card shows the world's record only once the
    // world actually holds it, and falls back to the resolution line otherwise.
    landed = closed.historyLine.trim();
    await updateActiveScene(uid, world.id, { turnsSinceReplan: 0 });

    // LIFE-FRONT-5: the saga's top pressure resolving is detected by integer
    // comparison, never self-reported. Surfaced for now; the closeout flow is
    // the next phase.
    if (closed.sagaResolved) {
      lifeDebug('SCENE-CLOSE', `LIFE-FRONT-5: saga front ${closed.sagaResolved}`, {
        resolution: closed.sagaResolved,
      });
    }
  } catch (e) {
    log.warn('life.scene.close-failed', { error: String(e) });
  } finally {
    // LIFE-SCENE-31: the world's own record when there is one — reported AFTER
    // the write above so what the screen shows and what the world stored cannot
    // disagree. Otherwise the resolution beat; and `null` when there is not even
    // that, which the card renders as a terminal row rather than a placeholder
    // it will never replace.
    onSummary(landed || fallback || null);
  }
}
