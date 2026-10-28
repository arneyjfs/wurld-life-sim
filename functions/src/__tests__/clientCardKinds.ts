/**
 * PRACTICE-OWN-10 — a re-export of the CLIENT's card-kind list so the two can
 * be asserted against each other.
 *
 * Moving the selector's response schema server-side created a SECOND copy of
 * this list: the server needs it for the schema's `enum` and for the spec
 * validator, the client still needs it for `ZIntelligentCard`'s `z.enum` and
 * for the TipCard renderer, and `functions/` is a separate TS build that
 * cannot import across with the `@/` alias.
 *
 * The drift is not symmetrical, which is why it is worth a test rather than a
 * comment: a kind added on the SERVER and not the client makes the model emit
 * a value the client's Zod parse then REJECTS — the whole selector response is
 * discarded and the session silently falls back, for a change that looked like
 * it only touched a schema.
 */
export { CARD_KINDS } from "../../../src/lib/practiceCardSelector/schemas";
