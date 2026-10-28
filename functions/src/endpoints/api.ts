/**
 * API-GW — `api`, the one gen2 function that serves the user-facing hot-path
 * endpoints, so one warm instance keeps all of them fast.
 *
 * Spec: docs/specs/api-gateway.md.
 *
 * `POST api/<name>` runs the deployed export `<name>` itself (API-GW-1) — the
 * same function object the standalone deployment runs, so a route cannot drift
 * from it. The version floor runs once in front of every route (API-GW-3);
 * every route runs in its own request scope (API-GW-6). The standalone exports
 * stay deployed for clients that still call them by name (API-GW-8).
 */
import { defineInt } from "firebase-functions/params";
import { onRequestV2 } from "../httpV2";
import { ALLOWED_ORIGINS } from "../httpShared";
import { createApiDispatcher } from "../apiRouter";
import { geminiGenerate, geminiStreamV2 } from "./gemini";
import { synthesizeSpeech } from "./tts";

// API-GW-5 — from the committed `functions/.env` (0), overridable per project
// in `functions/.env.<projectId>`. It must be set in a file: the CLI prompts
// for it otherwise, which hangs `emulators:exec`.
const API_MIN_INSTANCES = defineInt("API_MIN_INSTANCES", {
  default: 0,
  description: "Warm instances of the api function (docs/specs/api-gateway.md API-GW-5).",
});

// API-GW-4 — sized for the largest route; the gen2 defaults (cpu 1,
// concurrency 80) are what API-GW-6 was audited for.
export const api = onRequestV2(
  "api",
  {
    timeoutSeconds: 120,
    memory: "512MiB",
    cors: ALLOWED_ORIGINS,
    secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"],
    minInstances: API_MIN_INSTANCES,
  },
  createApiDispatcher({
    geminiGenerate,
    geminiStreamV2,
    synthesizeSpeech,
  }),
);
