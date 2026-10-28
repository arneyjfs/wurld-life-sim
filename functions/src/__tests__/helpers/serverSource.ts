/**
 * The Cloud Functions source that was ONE file, `index.ts`, until the index.ts
 * split — read as TEXT by the static tests. The functions vitest project
 * cannot import `index.ts` (it mounts firebase-functions, sharp and the whole
 * pipeline), so those tests pin shapes in the source instead.
 *
 * `readServerSource()` joins `index.ts` and every module it was split into, in
 * the order their code appeared in the old file, so a test that pins a shape
 * "somewhere in the server" keeps pinning it wherever the code now lives, and
 * a window between two handlers that used to be adjacent stays adjacent.
 * A test about one handler should read that handler's module directly.
 *
 * Not a test file: imported by `*.test.ts`. New modules that hold code
 * `index.ts` used to hold belong in this list.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Paths relative to `functions/src`, in old-`index.ts` order. */
export const SERVER_SOURCE_FILES = [
  "index.ts",
  "httpV2.ts",
  "endpoints/uploads.ts",
  "endpoints/gemini.ts",
  "pipeline/shared.ts",
  "pipeline/analyze.ts",
  "pipeline/backfill.ts",
  "pipeline/languageTargets.ts",
  "pipeline/sideEffects.ts",
  "pipeline/jobClaims.ts",
  "pipeline/translate.ts",
  "pipeline/translateBatch.ts",
  "pipeline/finalize.ts",
  "pipeline/analyzeAndPrime.ts",
  "pipeline/analyzeClaim.ts",
  "pipeline/runJobs.ts",
  "endpoints/send.ts",
  "pipeline/propagation.ts",
  "endpoints/pipelineTriggers.ts",
  "endpoints/userTriggers.ts",
  "endpoints/plans.ts",
  "endpoints/adminSetPlan.ts",
  "endpoints/backfill.ts",
  "endpoints/chats.ts",
  "endpoints/tts.ts",
  "endpoints/contacts.ts",
  "endpoints/tutorTurns.ts",
  "endpoints/tutor.ts",
  "endpoints/admin.ts",
  "endpoints/account.ts",
  "endpoints/broadcast.ts",
  "endpoints/adminPractice.ts",
  "endpoints/review.ts",
  "versionEndpoint.ts",
  "endpoints/liveUpdate.ts",
  "endpoints/topics.ts",
  "endpoints/api.ts",
] as const;

export const FUNCTIONS_SRC = join(__dirname, "..", "..");

/** One module of the split, by its path under `functions/src`. */
export function readServerModule(rel: (typeof SERVER_SOURCE_FILES)[number]): string {
  return readFileSync(join(FUNCTIONS_SRC, rel), "utf8");
}

/**
 * Every module of the split, joined in old-`index.ts` order.
 *
 * Each module starts with a boundary line shaped like a top-level export, so
 * a window that ends at the next `\nexport ` (the usual way these tests slice
 * one handler) stops at the end of its own module instead of running on into
 * the next one, where unrelated code could satisfy an assertion.
 */
export function readServerSource(): string {
  return SERVER_SOURCE_FILES.map(
    (rel) => `\nexport const __SERVER_MODULE__ = "${rel}";\n` + readFileSync(join(FUNCTIONS_SRC, rel), "utf8"),
  ).join("\n");
}
