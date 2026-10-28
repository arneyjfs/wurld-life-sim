/**
 * OBS-SRV-7 (docs/specs/observability.md) — the failure class of a failed
 * model attempt, which decides its Sentry grouping and level. Pure, no Sentry.
 *
 * `error` classes are ours to fix (a key, a spending cap, a bad request);
 * `warning` classes are transient provider trouble, reported so their
 * frequency is visible.
 */
export type ModelFailureClass =
  | "missing_key" | "auth" | "spend_limit" | "rate_limit"
  | "timeout" | "server" | "network" | "bad_request" | "other";

export type ModelFailureLevel = "error" | "warning";

const LEVEL: Record<ModelFailureClass, ModelFailureLevel> = {
  missing_key: "error",
  auth: "error",
  spend_limit: "error",
  bad_request: "error",
  rate_limit: "warning",
  timeout: "warning",
  server: "warning",
  network: "warning",
  other: "warning",
};

function statusOf(err: unknown): number | undefined {
  const e = err as { status?: unknown; code?: unknown } | null;
  if (e && typeof e.status === "number") return e.status;
  if (e && typeof e.code === "number" && e.code >= 100 && e.code < 600) return e.code;
  return undefined;
}

function classOf(err: unknown): ModelFailureClass {
  const msg = (err instanceof Error ? err.message : typeof err === "string" ? err : "").toLowerCase();
  const status = statusOf(err) ?? Number(/\b(?:openai |\[)([1-5]\d\d)\b/.exec(msg)?.[1] ?? NaN);
  if (/api_key not set|api_key is not set|api key not valid/.test(msg)) return "missing_key";
  if (status === 401 || status === 403) return "auth";
  if (status === 402 || /spending cap|insufficient_quota|billing|quota/.test(msg) && status === 429) return "spend_limit";
  if (status === 429) return "rate_limit";
  if (/timed out|exceeded \d+ms|deadline/.test(msg) || status === 408 || status === 504) return "timeout";
  if (Number.isFinite(status) && status >= 500) return "server";
  if (/fetch failed|econnreset|socket hang up|network|enotfound|eai_again/.test(msg)) return "network";
  if (Number.isFinite(status) && status >= 400) return "bad_request";
  return "other";
}

export function classifyModelFailure(err: unknown): { failureClass: ModelFailureClass; level: ModelFailureLevel } {
  const failureClass = classOf(err);
  return { failureClass, level: LEVEL[failureClass] };
}
