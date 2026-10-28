/**
 * LANG-TIER-1.1 — which client-direct Gemini calls require the paid
 * entitlement.
 *
 * Spec: docs/specs/language-tiers.md §4 (LANG-TIER-1.1), §6 (LANG-SEC-2).
 *
 * ## Why this exists at all
 *
 * `geminiGenerate` and `geminiStreamV2` are reachable by any authenticated
 * account with a POST. Their only checks were auth, a per-uid rate limit and a
 * prompt-size cap — so "Explain is Plus" and "practice is Plus" were true of
 * the buttons and false of the endpoints. Hiding a button changes what a user
 * SEES; it does not change what an account can spend. LANG-SEC-0 makes the
 * general form of that argument about Firestore writes; this is the same
 * argument about the model proxy.
 *
 * ## Why the discriminator is the CATEGORY
 *
 * It is already there, already trusted, and already load-bearing: the server
 * reads `category` to attribute spend (`recordTokenUsage`), to substitute a
 * server-owned system instruction (`serverOwnedSystemInstruction`), and to
 * decide whether a `promptSpec` is REQUIRED (`resolveServerPrompt`,
 * PRACTICE-OWN-5).
 *
 * A caller can of course lie about it. The lie costs them the thing the
 * category buys: the explain and practice prompts are server-owned
 * (SRV-PROMPT-6, PRACTICE-OWN-*) and are assembled only under their own
 * category, and a `practice_*` category without a valid spec is already a 400.
 * So "claim `topic_classify` to dodge the explain gate" degrades to "run a
 * topic classification", which is a free feature.
 *
 * ⚠ It does NOT close the general shape — an authenticated account can still
 * POST an arbitrary `prompt` with no category and get a completion. That
 * predates this module and is not something a category check can fix; it is
 * recorded here so the next reader does not mistake this gate for one.
 *
 * ## ⚠ The list that matters most is the one that is NOT here
 *
 * `topic_classify`, `card_translate` and `chat_import_extract` are how cards
 * get MADE. LANG-TIER-1.1 keeps making and reviewing cards free, so gating any
 * of them would lock a user out of their own deck from the server side — where
 * no client release could reach it. The deck is the user's own words; the line
 * is drawn at the session built on top of it.
 *
 * ## ⚠ The tutor is deliberately absent
 *
 * `tutor_*` is gated by `tutorRespond` itself (LANG-GATE-4.3), and it needs a
 * carve-out this module cannot express: LANG-GATE-4.1 allows a tutor send from
 * ANY user while `tutorMemory.setup.active` is true, because the onboarding
 * walkthrough requires the user to send and gating it would leave anyone
 * without a trial unable to learn how the product works. That decision needs
 * the CHAT; this module only ever sees a category string. Adding `tutor_*`
 * here would break onboarding.
 *
 * ## No firebase-admin import
 *
 * Pure, like `entitlement.ts` and `memberKeys.ts`, so the vitest `functions`
 * project can import it directly. The user-doc read and the 402 live at the
 * two endpoint call sites in `index.ts`.
 */

/** The two paid surfaces this module knows about. */
export type PaidFeature = "explain" | "practice";

/**
 * The explain categories, exactly as the client sends them
 * (`ExplainModal.tsx`) and as `USAGE_CATEGORIES` registers them.
 *
 * Enumerated rather than prefix-matched: `explain` itself has no separator, so
 * a prefix rule would have to be `startsWith("explain")` and would swallow any
 * future `explainer_*` telemetry bucket that had nothing to do with the
 * feature. Three strings is not a maintenance burden.
 */
const EXPLAIN_CATEGORIES: ReadonlySet<string> = new Set([
  "explain",
  "explain_practice",
  "explain_followup",
  // EXPLAIN-PHRASE-4 — the vocab card's phrase explainer.
  "explain_phrase",
]);

/**
 * Practice is a PREFIX, matching `isPracticeCategory` in
 * `prompts/serverPromptSpec.ts` (which is not exported, hence the second
 * copy — the rule is the same and both sides are pinned by tests).
 *
 * A prefix rather than a list because the practice namespace grows: there are
 * thirteen `practice_*` categories today and every generator added since the
 * feature shipped has been one. An allowlist would leave the next one open, and
 * open is the failure direction that costs money.
 */
const PRACTICE_PREFIX = "practice_";

/**
 * Which paid feature does this telemetry category belong to, if any?
 *
 * `null` means "not a gated surface" — which is most of them, including the
 * whole message pipeline, TTS, and every card-creation call.
 */
export function paidFeatureForCategory(category: unknown): PaidFeature | null {
  if (typeof category !== "string") return null;
  if (EXPLAIN_CATEGORIES.has(category)) return "explain";
  if (category.startsWith(PRACTICE_PREFIX)) return "practice";
  return null;
}

/** Convenience predicate for the endpoint call sites. */
export function requiresPaidEntitlement(category: unknown): boolean {
  return paidFeatureForCategory(category) !== null;
}

/**
 * The 402 body. Shaped like `enforceSendGate`'s so a client has one place to
 * learn what a payment-required answer from this API looks like.
 *
 * 402 rather than 403 for the reason LANG-GATE-6 gives: the caller IS
 * authorised, the feature is not available to them, and the request will fail
 * identically until somebody's billing changes. 403 invites a token refresh
 * and a retry; 402 does not.
 */
export function paidFeatureDenial(feature: PaidFeature): {
  error: string;
  reason: string;
} {
  return {
    error: "This feature requires Plus",
    reason: `${feature}_requires_plan`,
  };
}
