/**
 * LANG-TIER — what a member's ENTITLEMENT lets them do in the UI.
 *
 * Spec: docs/specs/language-tiers.md §4.
 *
 * These are named questions rather than bare calls to `hasProEntitlement`, and
 * the names are the point: at the call site, `canExplain(...)` says which RULE
 * is being applied, where a bare entitlement check would leave the reader to
 * infer it. They are free to diverge later without touching any screen.
 *
 * ## `canCreateGroup` is GONE (2026-09-21)
 *
 * LANG-TIER-2 — "only a subscribed member may create a group" — is RETIRED, at
 * the owner's instruction: a group with nobody entitled is not broken, it is
 * PASSTHROUGH (LANG-FREE-1). The predicate was deleted rather than left behind,
 * because a tier predicate nobody calls is the thing the next reader assumes is
 * still gating something.
 *
 * What replaced it is NOT the same question renamed. `isRoomUnfunded` (below)
 * asks about the whole ROOM rather than about one user, and its answer chooses
 * between two roads (LANG-FREE-13) rather than allowing or refusing one.
 *
 * ## The kill switch is gone (2026-09-16)
 *
 * Both predicates used to take an `{ enabled }` option fed by
 * `VITE_LANG_TIER_ENABLED`, because nothing wrote `plan` and a live gate would
 * have locked out the entire user base. That flag caught one real regression
 * and has been removed now the tier is meant to be live — see the retired
 * LANG-TIER-5 for the backfill prerequisite that replaced it.
 *
 * ## ⚠ Rendering, never enforcement
 *
 * Every answer here decides what to DRAW. The server owns the real ones: a send
 * is refused by the 402 (`evaluateSendGate`) and an out-of-set language is
 * snapped back by `computeChatLanguageTargets`. A client that disagrees with
 * either is a cosmetic bug, not a hole.
 */
import { hasProEntitlement } from './entitlement';

type EntitlementFields = { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown };

/**
 * Will this room be UNFUNDED — nobody in it entitled? LANG-FREE-12 / LANG-FREE-13.
 *
 * `true` means the room does no billable work: no translation, one agreed
 * language for everybody (`chats/{id}.commonLanguage`), and the creation flow
 * FORKS to ask for it. `false` means the room carries a language SET and every
 * member picks their own pair from it independently, exactly as today.
 *
 * ⚠ **A question about the ROOM, which is why it takes a list.** The creator's
 * own tier decides nothing: one entitled member ANYWHERE funds the room, so a
 * free member who invites a subscriber must go straight through. A per-creator
 * predicate — which is what `canCreateGroup` was — gets that case backwards and
 * asks a translating room to agree on one language.
 *
 * ⚠ **It FAILS CLOSED (LANG-SEC-2): unknown reads as unfunded.** A member whose
 * profile could not be read contributes nothing, and a room with no readable
 * member reads unfunded. That is the cheap direction on this surface: a
 * `commonLanguage` on a room that turns out to be funded is a field nothing
 * consults (LANG-FREE-12 confines it to unfunded rooms), whereas skipping the
 * fork leaves a room whose members never agreed what to type.
 *
 * ⚠ But failing closed must not OVERRULE a member we can see — hence `some`
 * rather than "every profile present and none entitled". One entitled member is
 * enough, whatever is unknown about the rest, and callers that can genuinely
 * WAIT for the rest should wait rather than call this early (LANG-TIER-1.1).
 */
export function isRoomUnfunded(
  members: ReadonlyArray<EntitlementFields | null | undefined>,
  nowMs: number,
): boolean {
  return !members.some((m) => hasProEntitlement(m, nowMs));
}

/**
 * May this user pick from the app's whole language list, rather than only from
 * the ones a chat already carries? LANG-SET-3.
 */
export function canChooseAnyLanguage(
  user: { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown } | null | undefined,
  nowMs: number,
): boolean {
  return hasProEntitlement(user, nowMs);
}

/**
 * May this user ask for a message to be explained? LANG-TIER-1.1.
 *
 * Every explain entry point funnels through `ExplainModal`, so this has one
 * consumer today — deliberately, because a gate on the three CALLERS
 * (`ChatScreen`'s long-press menu, `PracticeScreen`'s "Why?", the Wurlds
 * feedback overlay) is a gate with two holes in it.
 */
export function canExplain(
  user: { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown } | null | undefined,
  nowMs: number,
): boolean {
  return hasProEntitlement(user, nowMs);
}

/**
 * May this user START a practice session? LANG-TIER-1.1.
 *
 * ⚠ **This is NOT a question about their cards.** LANG-TIER-1.1 draws the line
 * between the CARD and the SESSION: making a card, editing one, importing from
 * a chat and reading back through the deck are all free, because those are the
 * user's own words saved from their own chats. What this predicate governs is
 * the spaced-repetition session built on top — the scheduling, the generated
 * questions, the LLM work.
 *
 * The name is the guard. `canPractice` would invite exactly the wrong call
 * site, which is `CardsScreen`.
 */
export function canStartPracticeSession(
  user: { plan?: unknown; trialEndsAt?: unknown; planUntil?: unknown } | null | undefined,
  nowMs: number,
): boolean {
  return hasProEntitlement(user, nowMs);
}
