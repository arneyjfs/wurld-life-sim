/**
 * MSG-PIPE-31.1 — the per-category, per-environment switch naming each
 * category's primary provider.
 *
 * Spec: docs/specs/message-pipeline.md (MSG-PIPE-31).
 *
 * `config/runtime.openai.<env>.<category> === true` makes OpenAI that
 * category's primary on that environment's functions; anything else leaves
 * Gemini primary. The other provider is the fallback either way (routed.ts). Keyed by
 * environment because beta and prod share this Firestore: one `config/runtime`
 * doc is read by both, so a flat flag could not be tried on beta alone.
 *
 * Read with the same TTL / in-flight / failure rules as the LIMIT-3 kill switch
 * on the same doc (`createRuntimeConfigReader`); a failed read answers the last
 * known routing, or Gemini.
 */
import { GEMINI_STUB_ENABLED } from "./geminiStub";
import { createRuntimeConfigReader, PRIME_AT_LOAD, readRuntimeConfigDoc, type RuntimeConfigReader } from "./runtimeConfig";

export type OpenAIRouting = ((category: ProviderCategory) => Promise<boolean>) & { refresh: () => Promise<void> };

/** Call categories that have a measured OpenAI path (MSG-PIPE-31.9). Each is
 *  also a field of the switch: `config/runtime.openai.<env>.<category>`. */
export const PROVIDER_CATEGORIES = [
  "analysis",
  "convert_key",
  "convert_multi",
  "convert_batch",
  "suggest_native",
  "clarify",
  "tutor_reply",
  "tutor_setup",
  "explain",
  "explain_practice",
  "explain_phrase",
  "topic_classify",
  "chat_import_extract",
  "practice_planner",
  "practice_generate",
] as const;

export type ProviderCategory = (typeof PROVIDER_CATEGORIES)[number];

export type OpenAIEnv = "beta" | "prod";

/** `beta` / `prod` for our two functions projects; null (no OpenAI) otherwise.
 *  The emulator runs under the prod project id (`--project wurld-e27d8`), so it
 *  is told apart by `FUNCTIONS_EMULATOR` (MSG-PIPE-31.1a). */
export function openAIEnvForProject(
  projectId: string | undefined,
  env: Record<string, string | undefined> = process.env,
): OpenAIEnv | null {
  if (env.FUNCTIONS_EMULATOR === "true") return null;
  if (projectId === "wurld-beta") return "beta";
  if (projectId === "wurld-e27d8") return "prod";
  return null;
}

/** Whether the doc routes `category` to OpenAI on `env`: the boolean true only. */
export function openAIEnabledIn(
  data: Record<string, unknown> | null | undefined,
  env: OpenAIEnv,
  category: ProviderCategory,
): boolean {
  const openai = data?.openai;
  if (!openai || typeof openai !== "object") return false;
  const forEnv = (openai as Record<string, unknown>)[env];
  if (!forEnv || typeof forEnv !== "object") return false;
  return (forEnv as Record<string, unknown>)[category] === true;
}

/** MSG-PIPE-31.12 — categories whose OpenAI attempt can run in Fast mode
 *  (`service_tier: "priority"`). Each is a field of
 *  `config/runtime.openaiFast.<env>.<category>`. */
export const FAST_CATEGORIES = ["analysis"] as const satisfies readonly ProviderCategory[];

export type FastCategory = (typeof FAST_CATEGORIES)[number];

/** MSG-PIPE-31.12 — whether the doc asks for Fast mode on `env`: the boolean true only. */
export function openAIFastIn(
  data: Record<string, unknown> | null | undefined,
  env: OpenAIEnv,
  category: ProviderCategory,
): boolean {
  const fast = data?.openaiFast;
  if (!fast || typeof fast !== "object") return false;
  const forEnv = (fast as Record<string, unknown>)[env];
  if (!forEnv || typeof forEnv !== "object") return false;
  return (forEnv as Record<string, unknown>)[category] === true;
}

/** Build the switch over an injected reader (unit-tested without Firestore). */
export function createOpenAIRoutingReader(
  read: RuntimeConfigReader,
  opts: { env: OpenAIEnv | null; stub: boolean; ttlMs?: number; now?: () => number; prime?: boolean },
): OpenAIRouting {
  const { env } = opts;
  // The emulator stubs Gemini but not OpenAI: never spend from a test run.
  if (env === null || opts.stub) {
    return Object.assign(async () => false, { refresh: async () => {} });
  }
  const routing = createRuntimeConfigReader(
    read,
    (data) => (category: ProviderCategory) => openAIEnabledIn(data, env, category),
    () => false,
    opts,
  );
  // LIMIT-3.1 — `routing()` answers from memory; it never waits for the read.
  return Object.assign(async (category: ProviderCategory) => (await routing())(category), { refresh: routing.refresh });
}

/** MSG-PIPE-31.12 — the Fast mode switch over an injected reader. */
export function createOpenAIFastReader(
  read: RuntimeConfigReader,
  opts: { env: OpenAIEnv | null; stub: boolean; ttlMs?: number; now?: () => number; prime?: boolean },
): OpenAIRouting {
  const { env } = opts;
  if (env === null || opts.stub) {
    return Object.assign(async () => false, { refresh: async () => {} });
  }
  const fast = createRuntimeConfigReader(
    read,
    (data) => (category: ProviderCategory) => openAIFastIn(data, env, category),
    () => false,
    opts,
  );
  return Object.assign(async (category: ProviderCategory) => (await fast())(category), { refresh: fast.refresh });
}

// Read from the env as `firebaseConfig.RUNTIME_PROJECT` is, without importing
// it: that module initialises the Admin SDK on load.
const ENV = openAIEnvForProject(process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT);

/** MSG-PIPE-31.1a — OpenAI exists, as primary or fallback, only on our two
 *  functions projects and never under the Gemini stub. */
export const OPENAI_AVAILABLE = ENV !== null && !GEMINI_STUB_ENABLED;

/** MSG-PIPE-31.1 — the production switch: true when OpenAI is the primary. */
export const isOpenAIEnabledFor = createOpenAIRoutingReader(readRuntimeConfigDoc, {
  env: ENV,
  stub: GEMINI_STUB_ENABLED,
  prime: PRIME_AT_LOAD,
});

/** MSG-PIPE-31.12 — the production Fast mode switch. */
export const isOpenAIFastFor = createOpenAIFastReader(readRuntimeConfigDoc, {
  env: ENV,
  stub: GEMINI_STUB_ENABLED,
  prime: PRIME_AT_LOAD,
});
