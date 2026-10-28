/**
 * Which Gemini models a CLIENT may ask for, and what happens when it asks for
 * something else.
 *
 * ── THE HOLE THIS CLOSES ────────────────────────────────────────────────────
 *
 * `index.ts` held `type GeminiModel = "a" | "b" | …` — a hand-written union,
 * erased at compile time. Both client-facing endpoints read `req.body` with a
 * bare `as` cast, so `model` arrived as an UNCHECKED STRING and travelled
 * straight into `genAI.getGenerativeModel({ model })`. The comment above
 * `MODELS` stated the consequence without treating it as one: *"Client-direct
 * endpoints honour any `model` field the client passes."*
 *
 * So any authenticated caller could name any model the project key can reach
 * and run it on this project's quota at `MAX_REQUESTS_PER_MINUTE`. Entitlement
 * does not bound it either: `paidFeatureForCategory` gates `explain_*` and
 * `practice_*` and nothing else, so `life_*`, `topic_classify`,
 * `card_translate`, `chat_import_extract` and — per `SRV-PROMPT-8` — any
 * unrecognised category reach the model with no plan check at all.
 *
 * ⚠ **This is a COST hole, not a prompt hole, and no prompt migration closes
 * it.** `SRV-PROMPT-1..15` bound what a caller can make the app SAY; they say
 * nothing about what the app is billed to say it on. Closing it is also the
 * one mitigation available BEFORE `SRV-PROMPT-8`'s default-deny lands, because
 * it caps the blast radius of the open proxy while the proxy stays open.
 *
 * ── WHY THE LIST AND THE TYPE ARE ONE ARTEFACT ──────────────────────────────
 *
 * Deriving `GeminiModel` from the array means adding a model is a single edit
 * and the runtime guard cannot fall behind the type. A second hand-maintained
 * list is how this class of guard rots: `MODELS` below would point at a model
 * the allowlist had never heard of, and the endpoint would quietly serve the
 * default instead of the model the app asked for.
 */

/**
 * Every model any call site in this project may run.
 *
 * ⚠ **2.x IS GONE, and it was not a tidy-up — it was RETIRED under us.** Probed
 * against the live API on 2026-09-18: `gemini-2.5-flash` (which was
 * `MODELS.fallback`), `gemini-2.5-flash-lite` and `gemini-2.0-flash` all answer
 * `404 — "no longer available to new users"` on `generateContent`.
 * `gemini-2.5-pro` still serves. So the slot `robustGenerate` swaps to when a
 * primary 503s or is retired had itself become a retired id: the rescue path
 * turned a transient failure into a hard one, after paying for the extra
 * attempt. `index.ts`'s own comment had anticipated exactly that — *"A model id
 * has been retired before"* — and then it happened to the fallback.
 *
 * ⚠ `ListModels` STILL LISTS `gemini-2.5-flash`. A health check built on the
 * listing would have reported the fallback healthy while every call 404'd, so
 * "is it in the catalogue" is not the question to ask of a model id.
 *
 * ⚠ **Every model here is 3.x, and that is now load-bearing rather than
 * incidental** — see `resolveClientThinking` below and
 * `modelAllowlist.test.ts`, which asserts it. The 2.x/3.x thinking-knob split
 * that ran through this codebase existed only to serve models that no longer
 * answer.
 */
export const CLIENT_SELECTABLE_MODELS = [
  "gemini-3.1-flash-lite",
  "gemini-3.5-flash-lite",
  "gemini-3-flash-preview",
  // The fallback slot. Google's own deprecation notice names this as the
  // successor to `gemini-2.5-flash`, and it preserves that slot's ORIGINAL
  // choice of a flash rather than a flash-lite: the point of the fallback is to
  // be unlike the primary, and every primary here is a lite.
  "gemini-3.6-flash",
] as const;

export type GeminiModel = (typeof CLIENT_SELECTABLE_MODELS)[number];

const ALLOWED: ReadonlySet<string> = new Set(CLIENT_SELECTABLE_MODELS);

export function isSelectableModel(v: unknown): v is GeminiModel {
  return typeof v === "string" && ALLOWED.has(v);
}

/** The categorical thinking knob, which is the ONLY one 3.x takes. */
export const THINKING_LEVELS = ["minimal", "low", "medium", "high"] as const;
export type GeminiThinkingLevel = (typeof THINKING_LEVELS)[number];

const LEVELS: ReadonlySet<string> = new Set(THINKING_LEVELS);

/**
 * What a CALLER may ask us to spend on reasoning.
 *
 * ── WHY THIS EXISTS AT ALL ──────────────────────────────────────────────────
 *
 * `thinkingLevel` and `thinkingBudget` came off `req.body` with a bare `typeof`
 * check — no enum, no clamp — on both client-facing endpoints. `thinkingBudget:
 * -1` means UNBOUNDED and was accepted (measured: ~900 thinking tokens on a
 * prompt that needs none), so a caller could raise our per-call bill at will.
 * Same family as the model field (`SRV-PROMPT-16`): these knobs bound what we
 * are BILLED, and no prompt migration touches them.
 *
 * ── WHY IT ALWAYS RETURNS A LEVEL, AND NEVER `undefined` ────────────────────
 *
 * Sending NO thinking config does not mean "cheap" — it means "the model's own
 * default", and that default is per-model. MEASURED on one prompt:
 * `gemini-3.1-flash-lite` spends **0** thinking tokens with no config, but
 * `gemini-3.6-flash` — the fallback — spends **874** (4× the total tokens of an
 * explicit `minimal`). So "ignore what the caller sent" is a COST REGRESSION on
 * exactly the path that only runs when something has already gone wrong.
 * Answering `minimal` instead is a no-op on every primary (whose default is
 * already 0) and a saving everywhere else, and it matches what
 * `getDynamicThinking` already returns for 3.x.
 *
 * ── THE LEGACY BUDGET ───────────────────────────────────────────────────────
 *
 * `thinkingBudget` was the 2.x knob. It was translated (`0` → `minimal`) for
 * the deployed 0.2.x clients; since 2026-09-29 every client is ≥ 0.3.0 and
 * sends `thinkingLevel` only, so the body field is no longer read at all. A
 * caller sending it gets the same answer as a caller sending nothing.
 */
export function resolveClientThinking(
  rawLevel: unknown,
  category: string,
  warn: (msg: string) => void = console.warn,
): { thinkingLevel: GeminiThinkingLevel } {
  if (typeof rawLevel === "string") {
    if (LEVELS.has(rawLevel)) return { thinkingLevel: rawLevel as GeminiThinkingLevel };
    warn(`[gemini] unsupported thinkingLevel ignored category=${category} level=${rawLevel.slice(0, 40)} → minimal`);
    return { thinkingLevel: "minimal" };
  }
  return { thinkingLevel: "minimal" };
}

/**
 * The caller's `model`, or the endpoint's default when it is absent or not one
 * this project serves.
 *
 * ⚠ **NEUTRALISE, NOT REJECT** — and not for the usual silent-fallback reason.
 * A 400 here would reproduce the functions-before-hosting asymmetry exactly: a
 * client bundle naming a model newer than the deployed functions would fail
 * EVERY call until the two met, turning a routine deploy-ordering mistake into
 * an outage. Falling back keeps that client working on the default, and the
 * warn going non-zero is how the drift gets noticed.
 *
 * The category rides in the log because the two causes look different there: an
 * unsupported model on ONE category is a client bug, and the same model across
 * all of them is somebody probing.
 */
export function resolveClientModel(
  raw: unknown,
  fallback: GeminiModel,
  category: string,
  warn: (msg: string) => void = console.warn,
): GeminiModel {
  if (raw === undefined || raw === null) return fallback;
  if (isSelectableModel(raw)) return raw;
  warn(
    `[gemini] unsupported model ignored category=${category} model=${String(raw).slice(0, 80)} → ${fallback}`,
  );
  return fallback;
}
