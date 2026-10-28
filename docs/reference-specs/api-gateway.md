# API gateway spec — the `api` function

One second-generation HTTP Cloud Function, `api`, serves the user-facing hot-path endpoints under one container, so one warm instance keeps all of them fast. Added 2026-10-04 (owner: *"min instances on the beta project set to 1 … happy to pay the 7-8$ a month for quicker start ups"*; then *"message analysis is my priority … but I would like all of them"*).

This is the **desired** state. Discrepancies are bugs.

Invariant ids (`API-GW-N`) are stable — tests grep them.

Coordinates with:

- [message-pipeline.md](./message-pipeline.md) — `processMessagePipeline` (the send + analysis + translation path) is the first route.
- [observability.md](./observability.md) — OBS-VERSION-10: the version floor runs in front of every route.
- [cost-limits.md](./cost-limits.md) — LIMIT-1 / LIMIT-3 stay inside each handler; routing changes none of them.
- [profiles.md](./profiles.md) — PROF-4 / PROF-4.1: `resolveContacts` and its warm-up now land on `api`.
- [app-check.md](./app-check.md) — APPCHECK-6: `verifyAuth` stays the one auth seam; `api` adds no auth path of its own.

---

## §1 Routing (API-GW-1..3)

### API-GW-1 — `api/<name>` runs the export of the same name

`POST {functionsUrl}/api/<name>` (and the CORS preflight `OPTIONS`) runs the deployed HTTP export `<name>` with the same request and response, for exactly these routes:

| Route | Surface |
|---|---|
| `processMessagePipeline` | send, analysis, translation (MSG-PIPE-*) |
| `geminiGenerate` | explain, practice, life, cards, topics (SRV-PROMPT-*) |
| `geminiStreamV2` | streaming explain / practice |
| `tutorRespond` | the tutor (TUTOR-*) |
| `synthesizeSpeech` | spoken audio (TTS-*) |
| `resolveContacts` | phone lookup (PROF-4) |

The route table maps each name to the exported function object itself (`api.ts` imports it), not to a copy of its body. So a route cannot drift from the standalone function: auth (`verifyAuth`), LIMIT-1, LIMIT-3, the paid-feature gates, App Check and the response shapes are the handler's, unchanged.

The route is the **last non-empty path segment** (`/geminiGenerate`, `/api/geminiGenerate` and `/geminiGenerate/` all route to `geminiGenerate`). The query string is not part of the route.

### API-GW-2 — Anything else is a 404

A path whose route is not in the table (including the bare `/api`) answers `404 { error: "Not found" }` and runs no handler.

### API-GW-3 — The version floor runs once, in front of every route

`api` is declared with the floored `onRequestV2` (OBS-VERSION-10), so a below-floor call gets the 426 before routing. The first-generation handlers' own `enforceVersionFloor` call still runs inside (they also serve the standalone exports); the floor read is cached (`VERSION_FLOOR_TTL_MS`), so the second check costs nothing.

---

## §2 Runtime (API-GW-4..6)

### API-GW-4 — One gen2 container sized for the largest route

`api` is a gen2 function with `cpu: 1` and concurrency 80 (the gen2 defaults), `memory: "512MiB"`, `timeoutSeconds: 120`, `cors: ALLOWED_ORIGINS` and `secrets: ["GEMINI_API_KEY", "OPENAI_API_KEY"]`: the union of what its routes need (OpenAI since 2026-10-25: the send route runs routed call categories in-process, MSG-PIPE-31.8). A route's own standalone options (e.g. `resolveContacts`' 256 MiB / 60 s) do not apply when it is called through `api`.

### API-GW-5 — Minimum instances are per project, from `API_MIN_INSTANCES`

`minInstances` is the `defineInt("API_MIN_INSTANCES")` param. Its value is committed per project, so no deploy prompts for it:

| File | Project | Value |
|---|---|---|
| `functions/.env.wurld-beta` | beta | **1** |
| `functions/.env.wurld-e27d8` | prod | **0** |

The `.gitignore` excludes `functions/.env.*` except these two, which hold no secrets. Raising prod is an owner decision. Change the file, then `npm run deploy:prod:functions`.

### API-GW-6 — Handlers reachable from `api` are safe to run concurrently

Up to 80 requests share one Node process. Nothing reachable from a route may keep request-scoped state in module scope (a "current user", a running token total, a per-call logger context). `geminiGenerate` and `processMessagePipeline` ran on first generation, one request per instance, until this change. The 2026-10-04 audit of their call graph (§5) found three holders that assumed that, fixed as below.

The dispatcher runs every route inside `withRequestScope` (`functions/src/requestScope.ts`, an `AsyncLocalStorage`). A holder that finds a scope uses that request's own state. Outside a scope it keeps the process-wide behaviour, which is still correct for the first-generation standalone exports and for triggers.

- **API-GW-6.1 — `keepAlive` / `drainKeepAlive` (MSG-PIPE-14.3) see only the current request's held work.** Before: one process-wide set, so one send's drain waited for every other send's history backfill, and under steady load could run to the timeout. Work kicked from nested async code inside a request belongs to that request.
- **API-GW-6.2 — Trace buffers (MSG-PIPE-28) belong to the request that opened them.** Before: one process-wide map keyed by message id. Two concurrent sends of the same message (a retry with the same `clientId`, two quick edits) shared one buffer, and the losing request's `discardTraceBuffer` dropped the winning request's traces. Inside one request, a second `openTraceBuffer` for the same message is still `false` (`runPipelineJobs` runs inline under the send).
- **API-GW-6.3 — The explicit SI cache de-dups in-flight creates by slot + model + SI digest, not by slot alone (MSG-PIPE-15).** Before: two concurrent calls on one slot asking for different models shared one create, so one ran on a cache, and so a model, it did not ask for. This was already reachable through `geminiStreamV2`, which is gen2 and concurrent today.

Checked and safe (audit, 2026-10-04):

- the version-floor and kill-switch caches: global config, designed for coalescing;
- the LIMIT-1 limiter: Firestore transactions, no memory;
- `languageTargetsMemo`: chat-level data, validated against the caller's chat doc;
- the `langid` / stopword lazy caches: static data;
- the `genAI` / `cacheManager` SDK clients: stateless; `admin.initializeApp` runs once in `firebaseConfig.ts`;
- `resolveContacts`' cold-start log flag: it only affects log accuracy;
- module-level `/g` regexes: used synchronously only.

Nothing in `functions/src` writes `process.env` or `global`, or uses `functions.config()`.

Fire-and-forget writes after the response (`recordTokenUsage`, direct trace writes) behave as they did on gen1. CPU is throttled after the response either way, and they can be lost on scale-down. That is not a new risk.

---

## §3 Clients (API-GW-7..8)

### API-GW-7 — Every client reaches the six routes through `api`

- `endpointUrl(name)` (`src/lib/endpoints.ts`) returns `${functionsUrl}/api/${name}` for the six route names and `${functionsUrl}/${name}` for every other name. `callHttp`, `streamUrl` and the `geminiGenerate` fetch in `src/lib/gemini.ts` all build URLs through it, so no call site names a path.
- The native background runner (`public/background-runner.js`) and the messaging service worker (`public/firebase-messaging-sw.js`) POST `${functionsUrl}/api/processMessagePipeline`.
- Error strings keep the route name (`callHttp geminiGenerate 503`), so `isTerminalSendError` and the `/geminiGenerate (\d{3})/` parsers are unchanged.

### API-GW-8 — The standalone exports stay deployed until old builds are gone

The six standalone functions stay exported and deployed. Two kinds of client still call them by name:

- native builds already in the stores;
- PWA users who have not accepted the update banner yet.

Deleting them is an AFTER-CHECKPOINTS job, gated on the version floor reaching the first release that ships API-GW-7.

`api` must be deployed **before** any client that calls it. The background runner drops a send that gets a 404 (`'drop'`), so a hosting release that ran ahead of its functions would lose queued messages. The functions-first deploy order (CLAUDE.md, *Deployment*) already guarantees this.

---

### API-GW-10 — No endpoint sets a `Connection` response header

`Connection` is hop-by-hop: the platform (Cloud Run's front end, Node's own server) owns connection lifetime. `geminiStreamV2` used to set `Connection: keep-alive` as SSE boilerplate. Behind a client that sends `Connection: close` (the Vite dev proxy does, always), the functions emulator hub trusted that response header and pooled a socket the worker's HTTP parser had already closed; the next request on it within ~5s (a message send right after a "Why?" explanation) was answered by an empty 400 before any handler ran, and the outbox called it terminal (2026-10-20 diagnosis; MSG-OUTBOX-9.2 now retries an empty 400 as defence in depth). Production's front end strips the header, so this was emulator-only, but the header was never needed: Node sets the right value itself. Tested by `functions/src/__tests__/noConnectionHeader.static.test.ts`.

### API-GW-11 — The CORS preflight answer is cached for two hours

Every app origin (`capacitor://localhost`, `https://localhost`, `app.wurld.chat`) is cross-origin to the functions, and every call carries `Authorization` and a JSON body, so the browser sends an `OPTIONS` preflight before the real request unless it holds a cached answer. Without `Access-Control-Max-Age` it keeps that answer for about 5 seconds, so nearly every message send paid a full extra round trip to `us-central1` before its POST left the phone (owner report 2026-10-25: "the client send is about half a second"). Every preflight answer now carries **`Access-Control-Max-Age: 7200`** (`PREFLIGHT_MAX_AGE_S` in `functions/src/preflightCors.ts`):

- **v2 functions (`api` and every `onRequestV2` handler):** `onRequestV2` takes the `cors` option off the options it hands the platform and applies the `cors` middleware itself with `maxAge` (`withPreflightCors`, `functions/src/preflightCors.ts`, wired in `functions/src/httpV2.ts`). The platform's own middleware has no `maxAge` setting and ends the preflight before any handler runs, so it cannot be left in place. Origins and the reflected request headers are unchanged.
- **The hand-rolled gen1 path (`setCors`)** sets the same header.

Two hours is Chrome's cap; WebKit caps the cache at 10 minutes, which still covers a conversation. A cached answer cannot lock out a later client: a request that sends a header or method the cached answer did not allow makes the browser preflight again. Tested by `functions/src/__tests__/preflightCache.test.ts`. No E2E spec can see it: the Functions emulator sets `FIREBASE_DEBUG_FEATURES.enableCors`, which puts the platform's own CORS middleware in front of every handler, v1 and v2, and that middleware answers the preflight first. The check is a `curl -X OPTIONS` against the deployed beta `api` after each deploy that touches this (expect `access-control-max-age: 7200`).

## §4 Out of scope (API-GW-9)

### API-GW-9 — Only user-facing hot-path HTTP endpoints are routed

Not routed, and why:

- **Firestore, Storage, scheduled and task-queue triggers** are not HTTP and cannot be.
- **Webhooks** (`stripeWebhook`, `appleNotifications`, `googleRtdn`) keep their URLs. Those URLs are registered in Stripe, App Store Connect and Pub/Sub, and moving them risks lost payment events.
- **Admin and billing endpoints** are rare enough that a cold start is acceptable, and some of them carry secrets the hot path should not hold.
- **`getVersion`** is version-exempt (OBS-VERSION-10), and `api` is floored.
- **`deleteAccount` / `billingDeletionCheck`** are version-exempt data-rights paths.

Adding a route is a spec change: add it to the API-GW-1 table, the route table in `functions/src/endpoints/api.ts` and `API_ROUTES` in `src/lib/endpoints.ts`.

---

## §5 Design decisions

**One router for the hot path, not one function for everything (2026-10-04).** The owner first asked for min instances = 1 on beta. That setting is per function. Beta has about 55 functions, and roughly 34 of them are gen2 services at about $8/month each idle, so warming all of them would have cost about $270/month. A single router for every endpoint was weighed and rejected (§4). The hot path was split across two first-generation functions (`geminiGenerate`, `processMessagePipeline`) and four gen2 ones. On first generation one instance serves one request, so a min instance helps only the first concurrent call. Moving them behind a gen2 `api` fixes that as well. One idle 1 vCPU / 512 MiB instance at Cloud Run's min-instance rate is about $10/month, the price of warming `resolveContacts` alone.

**Route to the exported function objects, not to extracted handler bodies.** A firebase-functions `onRequest` export is itself an `(req, res)` handler: v1 wraps it with error handling and trace context, v2 adds its CORS middleware. Calling it from `api` runs the exact code the standalone function runs. The alternative was to move each handler body into a shared function. That would have rewritten about 1,500 lines of handler code, and every static test that pins a handler's shape (`httpAuthCoverage`, `versionFloorCoverage`, PROF-4 …) slices the `export const <name> = …` body. Cost: CORS and trace wrapping run twice for a routed call, which is a few microseconds of header writes.

**Concurrency 80 on 512 MiB, not a lower cap (2026-10-04).** The audit suggested capping concurrency at 20–40 until measured, since gen1 gave each send its own 512 MB. We kept the gen2 default.
- The routed work is mostly waiting on Gemini and Firestore over the network, not CPU or memory. `geminiStreamV2` and `tutorRespond` have run at 80 on 512 MiB since they moved to gen2.
- A cap trades memory headroom for more cold starts under a burst, which is the cost this change exists to remove.

Revisit if Cloud Run reports memory-limit restarts or p95 latency climbs with instance load on `api`.

**IAM.** gen2 runs as the compute default service account, not `<project>@appspot`. On `wurld-e27d8`, beta's `736536641148-compute@developer.gserviceaccount.com` already holds `datastore.user`, `firebaseauth.admin` and `firebasecloudmessaging.admin` (checked 2026-10-04), a superset of the gen1 account's grants. So the send path's Firestore writes and FCM pushes work from `api` on beta. Prod's functions run in their own project.

**Request scope through `AsyncLocalStorage`, not by threading a context argument (API-GW-6).** Passing a per-request holder down would have touched every signature between the send handler and `languageTargets.ts` / `traces.ts`. That is dozens of functions, and every trigger that shares them. A scope opened once by the dispatcher keeps the public API of `keepAlive` and the trace buffer unchanged, and falls back to the old behaviour where no scope exists.

**Min instances from a committed per-project param.** The alternatives were a hard-coded number (it would warm prod too, which the owner did not ask for) and branching on `GCLOUD_PROJECT` at load time (it depends on what the CLI sets during discovery). A param is the sanctioned firebase-functions mechanism. The value files are committed so a deploy from a fresh checkout never stops to prompt.

**Revisit when:**
- prod traffic makes cold starts visible to users: set prod to 1;
- the remaining cold start is module load rather than container start: lazy-load per route (PROF-4 design note);
- the version floor passes the first release that calls `api`: delete the standalone six (API-GW-8).
