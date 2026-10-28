/**
 * API-GW-6 — per-request scope for state that used to be per-process.
 *
 * Spec: docs/specs/api-gateway.md §2.
 *
 * `keepAlive` (MSG-PIPE-14.3) and the trace buffer (MSG-PIPE-28) were written
 * for gen1, where a process serves one request at a time, so a module-level
 * holder WAS the request's holder. The `api` function is gen2 and serves up to
 * 80 requests in one process; its dispatcher runs each route inside
 * `withRequestScope`, and those holders use the scope's state when there is
 * one. Outside a scope (the gen1 standalone exports, triggers, tests) they keep
 * their process-wide behaviour, which is still correct there.
 *
 * Standalone (no ./index import) so it is unit-testable.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface RequestScope {
  /** MSG-PIPE-14.3 — work this request must finish before it responds. */
  readonly keepAlive: Set<Promise<unknown>>;
  /** MSG-PIPE-28 — trace summaries buffered per `${chatId}/${messageId}`. */
  readonly traceBuffers: Map<string, unknown[]>;
}

const storage = new AsyncLocalStorage<RequestScope>();

/** Run `fn` with a fresh request scope; everything it starts inherits it. */
export function withRequestScope<T>(fn: () => T): T {
  return storage.run({ keepAlive: new Set(), traceBuffers: new Map() }, fn);
}

/** The scope of the request this code runs for, or undefined outside one. */
export function currentRequestScope(): RequestScope | undefined {
  return storage.getStore();
}
