/**
 * Gemini-mock helper for /life E2E tests (node-engine era).
 *
 * Intercepts the geminiGenerate Cloud Function endpoint and matches
 * on the request body's `category`:
 *   - life_step            → next fixture from `steps` (JSON,
 *                            ZRawNodeResponse shape: node + options
 *                            with lookahead previews). An entry may
 *                            carry `delayMs` to hold the response —
 *                            used to assert the instant-cached-
 *                            advance + skeleton phases.
 *   - life_graded_question → next fixture from `gradedQuestions`
 *                            ({ practicePrompt, choices }).
 *   - life_scene           → next fixture from `scenes` (SVG text).
 *   - life_resume_recap    → next fixture from `resumeRecaps`
 *                            (LIFE-FLOW-5, Phase C — kept verbatim).
 *   - any other life_*     → 500 (deterministic: background bio /
 *                            saga / arc gen fail fast — the app
 *                            tolerates those failures — instead of
 *                            burning real Gemini in a mocked spec).
 *   - anything else        → falls through to the real network.
 *
 * Queues run out → 500 with a descriptive body (used deliberately by
 * the options-failed ladder test).
 */
import type { Page, Route } from '@playwright/test';
// SRV-PROMPT-13 — VALUE imports, and STATIC ones on purpose; see
// `stepPromptOf` below for what they are for and why the dynamic form does
// not work here.
import { buildLifeStepPrompt } from '../../../functions/src/prompts/lifeStep';
import { renderStepRetryHint } from '../../../functions/src/prompts/lifeStepViolations';
import type {
  PracticePrompt,
  RawNodeResponseInput,
  StepChoice,
} from '../../../src/lib/life/stepSchema';

export type GradedQuestionFixture = {
  practicePrompt: PracticePrompt;
  choices: StepChoice[];
};

/** LIFE-FLOW-5 (Phase C): fixture for `life_resume_recap` calls
 *  (fired on world exit). Omit when the spec never exits a world.
 *  LIFE-LANG-8: the recap is a SINGLE system-language paragraph. */
export type LifeResumeRecapFixture = {
  text: string;
};

export type StepFixture =
  | RawNodeResponseInput
  | { response: RawNodeResponseInput; delayMs: number };

export type LifeMockFixtures = {
  steps: StepFixture[];
  scenes: string[];
  gradedQuestions?: GradedQuestionFixture[];
  resumeRecaps?: LifeResumeRecapFixture[];
};

const MINIMAL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice"><rect width="1200" height="800" fill="#bde0fe"/><rect y="500" width="1200" height="300" fill="#c8b896"/><circle cx="600" cy="400" r="80" fill="#fff2c9"/></svg>`;

export function minimalBackdropSvg(): string {
  return MINIMAL_SVG;
}

function envelope(text: string): { status: number; contentType: string; body: string } {
  // The geminiGenerate Cloud Function wraps every response as
  // { text: "..." }; lib/gemini.ts reads .text. Mirror that.
  return {
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text }),
  };
}

/** Counters for what the mock actually served. `stepCalls` is the one that
 *  matters for LIFE-EX-PLAN-5: the saving IS the call that does not happen, so
 *  a spec can only assert it by counting. */
export type LifeMockHandle = {
  stepCalls: () => number;
  gradedCalls: () => number;
  /** Every `life_step` PROMPT the app sent, in order.
   *
   *  LIFE-GRID-4/5 can only be asserted here. The required-type rotation and
   *  the cross-turn action memory are inputs to the model, so nothing about
   *  them reaches the DOM — a spec that checked the rendered chips would be
   *  asserting the FIXTURE, not the wiring. What the app SENT is the
   *  post-condition. */
  prompts: () => string[];
};

/** A valid `sagaOpen` response. See the routing note below for why this one
 *  generator gets a fixture rather than a 400. */
export const SAGA_OPEN_FIXTURE = {
  universe: {
    setting: 'Lyon, a few streets around one square',
    era: 'now',
    laws: ['Nothing supernatural happens here.'],
    places: ['la place', 'le marché', "l'immeuble"],
    figures: [],
  },
  title: 'Une vie à Lyon',
  titleNative: 'A Life in Lyon',
  // LIFE-ARCH-8. Distinctive on purpose: the post-condition in life-flow
  // asserts THIS string reached Firestore, which is the seam the defect lived
  // in — the generator returned a teaser and the write dropped it.
  playerFacingTeaser:
    'A third-floor flat with unreliable heating, and neighbours who have not introduced themselves yet.',
  tone: 'warm slice-of-life',
  situation:
    'Alice has been in the flat three weeks. The heating is unreliable and the neighbours are still strangers.',
  principals: [
    {
      id: 'sophie',
      name: 'Sophie',
      known: 'the neighbour on the floor below',
      voice: 'quick, warm, teases',
      standing: 1,
      wants: 'someone to share the Saturday market run with',
      nextMove: 'knocks about the lunch she keeps suggesting',
      ties: [],
    },
  ],
  regulars: [
    {
      id: 'le-gardien',
      name: 'Bernard',
      known: 'the building caretaker',
      voice: 'flat, unhurried, never explains twice',
      standing: 0,
      routine: 'sweeps the entry at eight and complains about the bins',
      ties: [],
    },
  ],
  front: {
    id: 'the-heating',
    name: 'the heating',
    driverId: 'le-gardien',
    agenda: 'the building’s heating is failing one flat at a time',
    kind: 'decay',
    clock: { size: 8, consequence: 'the flat becomes unliveable by winter' },
  },
};

/**
 * SRV-PROMPT-13 — THE MOCK MOVES WITH THE PROMPT, and this is the third seam it
 * has had to move through.
 *
 * This handler used to record `body.prompt` and the specs grep it — for
 * `<turn kind="choice">`, for `<recentActions>`, for the `actionType` that had
 * to survive a whole round trip. Since SRV-PROMPT-8..13 batch 8 the client
 * sends `prompt: ''` plus a `promptSpec`, so recording the body would store the
 * EMPTY STRING and every one of those assertions would pass or fail for a
 * reason unrelated to what it claims to check — the `LIFE-BACKDROP-30` failure
 * in its third costume (after `transport.ts`'s system instruction and its
 * response schema).
 *
 * So the spec is BUILT here, exactly as `resolveServerPrompt` builds it, and
 * the built bytes are what the specs read. `tests/e2e/` runs in node, so it can
 * import `functions/src/prompts/` directly — the same trick `transport.ts`
 * uses, and for the same reason.
 *
 * THE IMPORT IS STATIC, AND HAS TO BE. The first cut used `await import()`
 * inside this function, to keep the cost off specs that never build a step.
 * Under Playwright that silently fails: `tests/e2e` is `"type": "commonjs"`,
 * so Playwright compiles this file to CJS and leaves the dynamic `import()`
 * as a NATIVE one — which skips Playwright's own `.ts` require hook and lands
 * in Node 22's type-stripping loader instead. That strips the types and then
 * evaluates `lifeStep.ts` as CommonJS (its nearest package.json is
 * `functions/`, which is commonjs), so its own ESM `import` lines throw
 * `SyntaxError: Cannot use import statement outside a module`. A static import
 * compiles to `require()`, goes through Playwright's hook, and transforms the
 * whole `functions/src/prompts/` graph the way the rest of the suite is
 * transformed. The modules are pure string-building — no firebase-admin, no
 * network — so importing them eagerly costs nothing worth saving.
 */
function stepPromptOf(body: {
  prompt?: string;
  promptSpec?: Record<string, unknown>;
}): string {
  const spec = body.promptSpec;
  // A legacy caller still sending prose is recorded as it always was — that
  // path is still served (SRV-PROMPT-2) and a spec should not be assumed.
  if (!spec) return body.prompt ?? '';
  // EVERY remaining branch returns a SELF-DESCRIBING MARKER rather than ''.
  // The first cut of this helper fell back to `body.prompt ?? ''` for any
  // surprise, and when the build did surprise it the spec failed with
  // `Received string: ""` — which names neither the cause nor even the layer.
  // A marker costs nothing, can never satisfy an assertion by accident, and
  // puts the reason in the diff Playwright already prints.
  if (spec.kind !== 'life_step') {
    return `[[lifeMock: promptSpec.kind=${String(spec.kind)}, expected life_step]]`;
  }
  try {
    const input = spec as unknown as Parameters<
      typeof buildLifeStepPrompt
    >[0] & {
      retry?: Parameters<typeof renderStepRetryHint>[0];
    };
    return buildLifeStepPrompt({
      ...input,
      // SRV-PROMPT-12 — the codes become the block the server appends. Without
      // this the mock would record a prompt with the retry silently missing,
      // which is the half a spec is least likely to notice.
      retryHint: renderStepRetryHint(input.retry ?? []),
    });
  } catch (err) {
    // Swallowing is deliberate: THROWING here leaves the route unfulfilled, so
    // the app hangs on a 45s transport timeout and the spec fails on a stalled
    // beat instead of on the real cause.
    return `[[lifeMock: buildLifeStepPrompt threw: ${String(err)}]]`;
  }
}

export async function installLifeMock(
  page: Page,
  fixtures: LifeMockFixtures,
): Promise<LifeMockHandle> {
  let stepCalls = 0;
  let gradedCalls = 0;
  const stepPrompts: string[] = [];
  const stepQueue = [...fixtures.steps];
  const gradedQueue = [...(fixtures.gradedQuestions ?? [])];
  const backdropQueue = [...fixtures.scenes];
  const recapQueue = [...(fixtures.resumeRecaps ?? [])];

  await page.route('**/geminiGenerate', async (route: Route) => {
    const body = JSON.parse(route.request().postData() ?? '{}') as {
      category?: string;
      prompt?: string;
      promptSpec?: Record<string, unknown>;
    };
    if (body.category === 'life_step') {
      stepCalls += 1;
      stepPrompts.push(stepPromptOf(body));
      const next = stepQueue.shift();
      if (!next) {
        // 400, NOT 500 — and this is load-bearing since LIFE-NODE-14 shipped
        // the transport retry ladder. `isTransientGenError` correctly treats
        // any 5xx as worth another go, so a 500 here made a STARVED FIXTURE
        // QUEUE look like a busy server: every exhausted queue burned two
        // retries and ~1.6s of backoff before the spec saw its failure. That
        // is wrong on both counts — it is not transient (the next attempt hits
        // the same empty array), and the delay destabilised the serial block
        // by shifting every downstream test's timing.
        //
        // A 400 says what is actually true: the request cannot be served as
        // asked, because the test author queued no fixture for it. The ladder
        // does not retry 4xx (bar 429), so exhaustion is once again the
        // fail-fast, deterministic signal the specs are written against.
        await route.fulfill({
          status: 400,
          contentType: 'text/plain',
          body: 'lifeMock: step fixture queue empty',
        });
        return;
      }
      const entry =
        'response' in next && 'delayMs' in next
          ? next
          : { response: next as RawNodeResponseInput, delayMs: 0 };
      if (entry.delayMs > 0) {
        await new Promise((r) => setTimeout(r, entry.delayMs));
      }
      await route.fulfill(envelope(JSON.stringify(entry.response)));
      return;
    }
    if (body.category === 'life_graded_question') {
      gradedCalls += 1;
      const next = gradedQueue.shift();
      if (!next) {
        await route.fulfill({
          status: 400,
          contentType: 'text/plain',
          body: 'lifeMock: graded-question fixture queue empty',
        });
        return;
      }
      await route.fulfill(envelope(JSON.stringify(next)));
      return;
    }
    if (body.category === 'life_backdrop') {
      const next = backdropQueue.shift() ?? MINIMAL_SVG;
      await route.fulfill(envelope(next));
      return;
    }
    if (body.category === 'life_resume_recap') {
      const next = recapQueue.shift();
      if (!next) {
        await route.fulfill({
          status: 400,
          contentType: 'text/plain',
          body: 'lifeMock: resumeRecap fixture queue empty',
        });
        return;
      }
      await route.fulfill(envelope(JSON.stringify(next)));
      return;
    }
    if (body.category === 'life_saga') {
      // LIFE-ARCH-3: `sagaOpen` has NO fallback, and world creation now BLOCKS
      // on it — a world that cannot be opened is not created at all. So this
      // can no longer 400 like the other generators: doing so deletes the world
      // the spec just asked for, and every downstream assertion loses its
      // subject. The fixture is deliberately minimal but VALID against what
      // `runSagaOpen` actually requires — a non-empty cast, and a front that
      // passes the slow-opening rule (non-threat, clock >= 8).
      await route.fulfill(envelope(JSON.stringify(SAGA_OPEN_FIXTURE)));
      return;
    }
    if (typeof body.category === 'string' && body.category.startsWith('life_')) {
      // bio / arc / compact / avatar — fail fast and deterministically in
      // mocked specs.
      //
      // 400, NOT 500 — see the note on the step queue above.
      await route.fulfill({
        status: 400,
        contentType: 'text/plain',
        body: `lifeMock: no handler for ${body.category}`,
      });
      return;
    }
    await route.fallback();
  });

  return {
    stepCalls: () => stepCalls,
    gradedCalls: () => gradedCalls,
    prompts: () => [...stepPrompts],
  };
}
