/**
 * OBS-SRV-1..6 (docs/specs/observability.md) — Cloud Functions report to Sentry.
 *
 * - OBS-SRV-1: `@sentry/node`, initialised lazily, once per instance, from the
 *   `SENTRY_DSN` param (`functions/.env.<projectId>`). No DSN, or the emulator
 *   (`FUNCTIONS_EMULATOR === "true"`), ⇒ every helper here is a no-op and the
 *   wrappers call the handler untouched. `environment` from the project id,
 *   `release` = the backend version (`buildInfo.json`, OBS-VERSION-2), tag
 *   `runtime: server`, `sendDefaultPii: false`, `tracesSampleRate: 0`.
 * - OBS-SRV-2: `withSentryHttp(name, handler)` / `withSentryEvent(name, handler)`
 *   wrap every deployed function (pinned by sentryCoverage.static.test.ts).
 * - OBS-SRV-3: `Sentry.flush(2000)` on the error path only — before the
 *   response ends for HTTP, before the promise settles for events.
 * - OBS-SRV-4: `beforeSend` / `beforeBreadcrumb` scrub with `./scrub`.
 * - OBS-SRV-5: `captureServerError(err, ctx)` for explicit captures.
 * - OBS-SRV-7: `captureModelFailure(err, ctx)` for every failed model attempt,
 *   rescued or not.
 *
 * Nesting: `api` (API-GW) runs a route's own deployed export, so a request can
 * pass through two HTTP wrappers. They share ONE per-response state (stored on
 * `res`), the inner (route) name wins the `function` tag, the outer name is kept
 * as `gateway`, and an error is captured once.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/node";
import { readBackendBuildInfo } from "../buildInfo";
import { classifyModelFailure } from "./modelFailure";
import { scrubBreadcrumb, scrubEvent } from "./scrub";

/** OBS-SRV-3 — the flush budget on the error path. */
export const SENTRY_FLUSH_MS = 2000;

type Env = Record<string, string | undefined>;

export interface ServerSentryConfig {
  dsn: string;
  environment: "beta" | "prod" | "dev";
  release: string;
}

/** OBS-SRV-1 — `wurld-beta` → beta, `wurld-e27d8` → prod, anything else → dev. */
export function sentryEnvironmentFor(projectId: string | undefined): ServerSentryConfig["environment"] {
  if (projectId === "wurld-beta") return "beta";
  if (projectId === "wurld-e27d8") return "prod";
  return "dev";
}

/** OBS-SRV-1 — the config, or null when Sentry must stay off (no DSN / emulator). */
export function resolveServerSentryConfig(env: Env = process.env): ServerSentryConfig | null {
  if (env.FUNCTIONS_EMULATOR === "true") return null;
  const dsn = (env.SENTRY_DSN ?? "").trim();
  if (!dsn) return null;
  const projectId = env.GCLOUD_PROJECT || env.GCP_PROJECT || undefined;
  return { dsn, environment: sentryEnvironmentFor(projectId), release: readBackendBuildInfo().version };
}

let initState: "unset" | "on" | "off" = "unset";

function baseOptions(cfg: ServerSentryConfig): Sentry.NodeOptions {
  return {
    dsn: cfg.dsn,
    environment: cfg.environment,
    release: cfg.release,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    initialScope: { tags: { runtime: "server" } },
    // Console breadcrumbs carry formatted log lines (message text, prompts)
    // that the key-based scrubber cannot see into: never send them.
    integrations: (defaults) => defaults.filter((i) => i.name !== "Console"),
    beforeSend: (event) => scrubEvent(event),
    beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
  };
}

/** OBS-SRV-1 — lazy, once per instance. Returns whether Sentry is live. */
export function ensureServerSentry(): boolean {
  if (initState !== "unset") return initState === "on";
  const cfg = resolveServerSentryConfig();
  if (!cfg) {
    initState = "off";
    return false;
  }
  try {
    Sentry.init(baseOptions(cfg));
    initState = "on";
    installConsoleErrorHook();
  } catch (err) {
    // Observability must never take a function down.
    console.error("[sentry] init failed; server errors go to Cloud Logging only", err);
    initState = "off";
  }
  return initState === "on";
}

/** Test seam: initialise with an injected transport, bypassing env lookup. */
export function __initServerSentryForTest(
  cfg: ServerSentryConfig,
  extra: Partial<Sentry.NodeOptions> = {},
): void {
  Sentry.init({ ...baseOptions(cfg), ...extra });
  initState = "on";
  installConsoleErrorHook();
}

/** Test seam: forget the init decision. */
export function __resetServerSentryForTest(): void {
  initState = "unset";
}

// ---------------------------------------------------------------------------
// Per-invocation state
// ---------------------------------------------------------------------------
interface InvocationState {
  tags: Record<string, string>;
  uid?: string;
  /** An event for this invocation was already sent (no second 5xx event). */
  captured: boolean;
  /** Events were queued and not yet flushed (OBS-SRV-3). */
  pendingFlush: boolean;
}

const invocation = new AsyncLocalStorage<InvocationState>();
const RES_STATE = Symbol.for("wurld.sentry.invocation");
const capturedErrors = new WeakSet<object>();

function markCaptured(err: unknown): void {
  if (err && typeof err === "object") capturedErrors.add(err);
  const st = invocation.getStore();
  if (st) {
    st.captured = true;
    st.pendingFlush = true;
  }
}

function alreadyCaptured(err: unknown): boolean {
  return !!err && typeof err === "object" && capturedErrors.has(err);
}

function captureContext(st: InvocationState | undefined, extraTags: Record<string, string> = {}) {
  return {
    tags: { ...(st?.tags ?? {}), ...extraTags },
    ...(st?.uid ? { user: { id: st.uid } } : {}),
  };
}

/** OBS-SRV-3 — bounded flush; never throws. */
async function flushQuietly(): Promise<void> {
  try {
    await Sentry.flush(SENTRY_FLUSH_MS);
  } catch {
    /* a failed flush must not change the function's outcome */
  }
}

/**
 * OBS-SRV-2 — sets `user.id` for the current invocation. Called by
 * `verifyAuth` once the token verified (OBS-LABEL-12: the raw uid on purpose).
 */
export function setSentryUser(uid: string | null | undefined): void {
  if (initState !== "on" || !uid) return;
  const st = invocation.getStore();
  if (st) st.uid = uid;
  Sentry.getIsolationScope().setUser({ id: uid });
}

/**
 * OBS-SRV-5 — explicit capture of a failure the user sees. `ctx` goes to
 * `extra` (scrubbed: chatId / messageId are redacted, uids hashed); string
 * values under `ctx.tags` become tags. No-op without Sentry.
 */
export function captureServerError(
  err: unknown,
  ctx: Record<string, unknown> & { tags?: Record<string, string> } = {},
): void {
  if (initState !== "on") return;
  if (alreadyCaptured(err)) return;
  const { tags, ...extra } = ctx;
  const st = invocation.getStore();
  const context = { ...captureContext(st, tags ?? {}), extra, level: "error" as const };
  if (err instanceof Error) Sentry.captureException(err, context);
  else Sentry.captureMessage(typeof err === "string" ? err : `Non-Error failure: ${safeDescribe(err)}`, context);
  markCaptured(err);
}

/**
 * OBS-SRV-7 — one event per failed model attempt, whether or not a retry, the
 * other provider or the backup model then answers. Grouped by provider +
 * failure class. Does NOT mark the invocation captured (a call that then fails
 * outright still gets its own handler event); does queue the flush, so a
 * successful response waits for it too (OBS-SRV-3). The kill switch is not a
 * failure. No-op without Sentry.
 */
export function captureModelFailure(
  err: unknown,
  ctx: { provider: "gemini" | "openai"; model: string; label: string; category?: string; attempt: number },
): void {
  if (initState !== "on") return;
  if (err instanceof Error && err.name === "GeminiDisabledError") return;
  try {
    const { failureClass, level } = classifyModelFailure(err);
    const st = invocation.getStore();
    const tags: Record<string, string> = {
      provider: ctx.provider,
      model: ctx.model,
      model_stage: ctx.label,
      failure_class: failureClass,
      ...(ctx.category ? { model_category: ctx.category } : {}),
    };
    const context = {
      ...captureContext(st, tags),
      extra: { attempt: ctx.attempt },
      level,
      fingerprint: ["model-failure", ctx.provider, failureClass],
    };
    // A copy, not the Error itself: the SDK refuses a second capture of one
    // object, and the handler must still be able to report it if it throws.
    if (err instanceof Error) Sentry.captureException(copyError(err), context);
    else Sentry.captureMessage(`Model failure: ${safeDescribe(err)}`, context);
    if (st) st.pendingFlush = true;
  } catch {
    /* observability must never change the call's outcome */
  }
}

function copyError(err: Error): Error {
  const copy = new Error(err.message);
  copy.name = err.name;
  if (err.stack) copy.stack = err.stack;
  return copy;
}

function safeDescribe(v: unknown): string {
  if (v && typeof v === "object") {
    const o = v as { code?: unknown; message?: unknown };
    return [o.code, o.message].filter((x) => typeof x === "string" || typeof x === "number").join(" ") || "object";
  }
  return String(v);
}

// ---------------------------------------------------------------------------
// Logged errors inside a wrapped invocation
// ---------------------------------------------------------------------------
/** The Error objects among console.error's arguments: top level, or one level
 *  into a plain-object argument (`console.error("x", { chatId, err })`). */
export function errorsAmong(args: readonly unknown[]): Error[] {
  const out: Error[] = [];
  for (const a of args) {
    if (a instanceof Error) out.push(a);
    else if (a && typeof a === "object" && Object.getPrototypeOf(a) === Object.prototype) {
      for (const v of Object.values(a as Record<string, unknown>)) if (v instanceof Error) out.push(v);
    }
  }
  return out;
}

let consoleHooked = false;

/**
 * OBS-SRV-2 — a handler that catches, logs the Error and answers 500 itself
 * would otherwise yield only a stackless "<fn> responded 500". While a wrapped
 * request/event runs (its InvocationState lives in AsyncLocalStorage, so with
 * gen2 concurrency each request sees only its own), an Error passed to
 * console.error is captured as an exception with that invocation's tags and
 * user. ONLY the Error objects are sent: string args and the formatted log
 * line never leave. Outside a wrapped invocation nothing is captured.
 *
 * The capture runs in a microtask, so an explicit `captureServerError` of the
 * same Error right after the log (with richer tags) wins. The invocation is
 * marked captured synchronously, so a 500 written right after the log does
 * not add a second event.
 */
function installConsoleErrorHook(): void {
  if (consoleHooked) return;
  consoleHooked = true;
  const original = console.error;
  console.error = function sentryConsoleError(...args: unknown[]) {
    try {
      const st = invocation.getStore();
      if (st && initState === "on") {
        const errors = errorsAmong(args).filter((e) => !alreadyCaptured(e));
        if (errors.length > 0) {
          st.captured = true;
          st.pendingFlush = true;
          queueMicrotask(() => {
            for (const e of errors) {
              if (alreadyCaptured(e)) continue;
              Sentry.captureException(e, { level: "error", ...captureContext(st, { source: "console_error" }) });
              capturedErrors.add(e);
            }
          });
        }
      }
    } catch {
      /* the hook must never break logging */
    }
    return original.apply(console, args as []);
  };
}

// ---------------------------------------------------------------------------
// HTTP wrapper
// ---------------------------------------------------------------------------
interface HttpReqLike {
  method?: string;
  headers?: Record<string, string | string[] | undefined>;
}
interface HttpResLike {
  statusCode: number;
  end(...args: unknown[]): unknown;
}

function headerValue(req: HttpReqLike, name: string): string | undefined {
  const v = req.headers?.[name];
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Holds the response's `end` until queued events are flushed (OBS-SRV-3). A 5xx
 * the handler wrote itself (no throw) is captured here. While the flush runs,
 * `headersSent` reads true and a second `end` is ignored, so a handler's
 * `if (!res.headersSent)` fallback cannot start a second response.
 */
function hookEnd(res: HttpResLike, st: InvocationState, fnName: () => string): void {
  const origEnd = res.end;
  let deferred = false;
  res.end = function patchedEnd(this: unknown, ...args: unknown[]) {
    if (deferred) return res;
    if (res.statusCode >= 500 && !st.captured) {
      Sentry.captureMessage(`${fnName()} responded ${res.statusCode}`, {
        level: "error",
        ...captureContext(st, { http_status: String(res.statusCode) }),
        fingerprint: ["http-5xx", fnName(), String(res.statusCode)],
      });
      st.captured = true;
      st.pendingFlush = true;
    }
    if (!st.pendingFlush) return origEnd.apply(res, args);
    deferred = true;
    st.pendingFlush = false;
    Object.defineProperty(res, "headersSent", { configurable: true, get: () => true });
    // One microtask first: an Error logged just before this end is captured in
    // a microtask (installConsoleErrorHook) and must be queued before the flush.
    void Promise.resolve().then(flushQuietly).finally(() => {
      delete (res as { headersSent?: boolean }).headersSent;
      origEnd.apply(res, args);
    });
    return res;
  } as HttpResLike["end"];
}

/**
 * OBS-SRV-2 — wrap an HTTP handler: isolation scope per request, tags
 * `function` / `client_version` / `http_method`, capture a throw (then
 * rethrow, so the existing behaviour produces the response) and any ≥ 500.
 */
export function withSentryHttp<Req extends HttpReqLike, Res extends HttpResLike>(
  name: string,
  handler: (req: Req, res: Res) => unknown,
): (req: Req, res: Res) => Promise<void> {
  return async (req, res) => {
    if (!ensureServerSentry()) {
      await handler(req, res);
      return;
    }
    const holder = res as unknown as { [RES_STATE]?: InvocationState };
    const outer = holder[RES_STATE];
    const st: InvocationState = outer ?? { tags: {}, captured: false, pendingFlush: false };
    if (outer) {
      // Nested (API-GW): the route's own name is the useful one.
      if (outer.tags.function && outer.tags.function !== name) st.tags.gateway = outer.tags.function;
    } else {
      holder[RES_STATE] = st;
      const version = headerValue(req, "x-wurld-version");
      if (version) st.tags.client_version = version;
      if (req.method) st.tags.http_method = req.method;
      hookEnd(res, st, () => st.tags.function ?? name);
    }
    st.tags.function = name;

    await Sentry.withIsolationScope(async (scope) => {
      scope.setTags(st.tags);
      if (st.uid) scope.setUser({ id: st.uid });
      await invocation.run(st, async () => {
        try {
          await handler(req, res);
        } catch (err) {
          if (!alreadyCaptured(err)) {
            Sentry.captureException(err, { level: "error", ...captureContext(st) });
            markCaptured(err);
          }
          if (st.pendingFlush) {
            st.pendingFlush = false;
            await flushQuietly();
          }
          throw err;
        }
      });
    });
  };
}

// ---------------------------------------------------------------------------
// Event wrapper (Firestore triggers, schedules, task queues)
// ---------------------------------------------------------------------------
/**
 * OBS-SRV-2 — wrap a background handler: isolation scope, tag `function`,
 * capture + flush + rethrow a throw; flush explicit captures before settling.
 */
export function withSentryEvent<A extends unknown[], R>(
  name: string,
  handler: (...args: A) => R | Promise<R>,
): (...args: A) => Promise<R> {
  return async (...args: A) => {
    if (!ensureServerSentry()) return handler(...args);
    const st: InvocationState = { tags: { function: name }, captured: false, pendingFlush: false };
    return Sentry.withIsolationScope(async (scope) => {
      scope.setTags(st.tags);
      return invocation.run(st, async () => {
        try {
          return await handler(...args);
        } catch (err) {
          if (!alreadyCaptured(err)) {
            Sentry.captureException(err, { level: "error", ...captureContext(st) });
            markCaptured(err);
          }
          throw err;
        } finally {
          if (st.pendingFlush) {
            st.pendingFlush = false;
            await flushQuietly();
          }
        }
      });
    });
  };
}
