/**
 * Cloud Functions entry point for the Wurlds life sim.
 *
 * Extracted from the Wurld app (arneyjfs/wurld-app, 2026-10-28). Only the
 * functions the life sim calls are exported:
 *
 * - `geminiGenerate` / `geminiStreamV2`: the generic model proxy. Every life
 *   prompt goes through it as a server-owned `promptSpec` kind (`life_step`,
 *   `life_saga`, `life_scene_gen`, ... see `prompts/serverPromptSpec.ts`), plus
 *   the Explain modal's `explain*` kinds.
 * - `synthesizeSpeech` / `listStandardVoices`: TTS for dialogue bubbles and
 *   word cards.
 * - `api`: the single gateway the client actually calls (`/api/<name>`, the
 *   Wurld API-GW-* design); it dispatches to the three handlers above.
 * - `deleteLifeAccountData`: wipes a user's life data when their Auth record
 *   is deleted (the Wurld app's `cascadeDeleteUserData` did this before).
 *
 * Exported by NAME so the deployed function names never depend on file layout.
 */
export { geminiGenerate, geminiStreamV2 } from "./endpoints/gemini";
export { synthesizeSpeech, listStandardVoices } from "./endpoints/tts";
export { deleteLifeAccountData } from "./endpoints/account";
export { api } from "./endpoints/api";
