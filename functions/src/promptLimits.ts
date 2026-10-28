/**
 * The one byte cap on anything that reaches a Gemini call as input.
 *
 * Extracted from `index.ts` so `prompts/practiceSpec.ts` can apply the SAME
 * number to prompts the SERVER assembles (PRACTICE-OWN-6). Two constants would
 * be two things to keep in step, and the failure mode of them drifting is
 * silent: the endpoint would cap what a client sends while the server-built
 * path — the one that can assemble a far bigger prompt from a small request
 * body — capped at something else.
 *
 * 64 KiB. Chosen against the real traffic rather than as a round number: the
 * largest prompt this project builds is a full practice-planner user prompt at
 * ~4 KiB, and the largest client-sent one is a chat-import extraction at ~50
 * messages. Anything approaching this is a bug or an attempt.
 */
export const MAX_PROMPT_BYTES = 65_536;
