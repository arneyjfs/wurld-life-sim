/**
 * LANG-TIER-1.1 — the SERVER half of "Explain and practice are Plus".
 *
 * Spec: docs/specs/language-tiers.md §4 (LANG-TIER-1.1), §6 (LANG-SEC-2).
 *
 * ## Why a client-only gate is not a gate
 *
 * `geminiGenerate` and `geminiStreamV2` are client-direct endpoints: any
 * authenticated account can POST a body to them. Before this, the only checks
 * were auth, a rate limit, and a prompt-size cap — so the entire paid feature
 * set was reachable with a token and a `category` string. Hiding a button
 * changes what a user sees; it does not change what an account can spend.
 *
 * ## Why the discriminator is the CATEGORY
 *
 * It is already there, already load-bearing, and already trusted: the server
 * reads `category` to attribute spend (`recordTokenUsage`), to pick a
 * server-owned system instruction, and to decide whether a `promptSpec` is
 * required. A caller CAN lie about it — but a lie costs them the thing the
 * category buys. Claim `topic_classify` to dodge the explain gate and the
 * server builds a topic-classification prompt; the explain prompt is
 * server-owned and unreachable without the category that names it. The lie
 * degrades to "a free user may run a topic classification", which is a free
 * feature.
 *
 * ## ⚠ The list that matters most is the FREE one
 *
 * `topic_classify`, `card_translate` and `chat_import_extract` are how cards
 * get made. LANG-TIER-1.1 keeps making and reviewing cards free, so gating any
 * of them would lock a user out of their own deck from the server side — where
 * no client fix could reach it.
 */
import { describe, expect, it } from "vitest";
import { paidFeatureForCategory, requiresPaidEntitlement } from "./paidFeatureGate";

describe("LANG-TIER-1.1 — explain is a paid category", () => {
  // EXPLAIN-PHRASE-4 — the vocab card's phrase explainer is Explain too.
  it.each(["explain", "explain_practice", "explain_followup", "explain_phrase"])(
    "LANG-TIER-1.1 — %s requires the entitlement",
    (category) => {
      expect(paidFeatureForCategory(category)).toBe("explain");
      expect(requiresPaidEntitlement(category)).toBe(true);
    },
  );
});

describe("LANG-TIER-1.1 — a practice session is a paid category", () => {
  it.each([
    "practice_planner_stream",
    "practice_planner",
    "practice_generation",
    "practice_gen_mc",
    "practice_gen_fb",
    "practice_gen_fm",
    "practice_gen_lf",
    "practice_gen_lw",
    "practice_gen_n2p",
    "practice_gen_p2n",
    "practice_gen_lap",
    "practice_card_selector",
    "practice_verify",
  ])("LANG-TIER-1.1 — %s requires the entitlement", (category) => {
    expect(paidFeatureForCategory(category)).toBe("practice");
    expect(requiresPaidEntitlement(category)).toBe(true);
  });

  it("LANG-TIER-1.1 — a practice category added later is gated by default", () => {
    // The prefix is the rule, not an enumeration. Every generator added since
    // this feature shipped has been `practice_<something>`, and an allowlist
    // would silently leave the next one open.
    expect(requiresPaidEntitlement("practice_gen_something_new")).toBe(true);
  });
});

describe("LANG-TIER-1.1 — making and reviewing cards stays free", () => {
  it.each([
    ["topic classification on a new card", "topic_classify"],
    ["translating a card the user typed", "card_translate"],
    ["extracting cards from a chat", "chat_import_extract"],
  ])("LANG-TIER-1.1 — %s is NOT gated", (_label, category) => {
    expect(paidFeatureForCategory(category)).toBeNull();
    expect(requiresPaidEntitlement(category)).toBe(false);
  });
});

describe("LANG-TIER-1.1 — the gate touches nothing it was not asked to", () => {
  it.each([
    ["the message pipeline", "message_translation"],
    ["message analysis", "message_analysis"],
    ["client translation", "client_translate"],
    ["TTS", "tts_synthesis"],
    ["an unlabelled call", "unknown"],
    ["an empty category", ""],
  ])("LANG-TIER-1.1 — %s is NOT gated here", (_label, category) => {
    expect(requiresPaidEntitlement(category)).toBe(false);
  });

  it("LANG-TIER-1.1 — the TUTOR is left to its own gate", () => {
    // LANG-GATE-4.3 gates `tutorRespond` itself, and LANG-GATE-4.1 carves out
    // onboarding — a setup-active chat is allowed for ANY user. That carve-out
    // cannot be expressed here (this module sees a category, not a chat), so
    // adding `tutor_*` would break onboarding for every unentitled user.
    for (const category of ["tutor_chat", "tutor_action", "tutor_setup", "tutor_compact"]) {
      expect(requiresPaidEntitlement(category)).toBe(false);
    }
  });

  it("LANG-TIER-1.1 — the Wurlds life-sim is not gated by this table", () => {
    // LANG-TIER-1.1 does not list it, and this change is not the place to
    // decide it. Recorded so the omission reads as a decision.
    for (const category of ["life_step", "life_backdrop", "life_graded_question"]) {
      expect(requiresPaidEntitlement(category)).toBe(false);
    }
  });
});

describe("LANG-TIER-1.1 — the matching is exact, and fails OPEN only outward", () => {
  it.each([
    ["a near-miss prefix", "practice"],
    ["a suffix", "my_practice_gen"],
    ["a lookalike", "explaining"],
    ["capitalised", "EXPLAIN"],
  ])("LANG-TIER-1.1 — %s is not a paid category", (_label, category) => {
    // Over-matching is the dangerous direction: a category that gets gated by
    // accident takes a working feature away from paying and free users alike,
    // and does it on the server where no client release can fix it.
    expect(requiresPaidEntitlement(category)).toBe(false);
  });
});
