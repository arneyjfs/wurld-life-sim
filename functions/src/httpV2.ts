/**
 * The v2 HTTP factory every version-gated handler uses (OBS-VERSION-10).
 * Split out of `index.ts` so the endpoint modules share one wrapper.
 *
 * Moved verbatim out of `index.ts` (audit: index.ts split); `index.ts`
 * re-exports the Cloud Functions defined here under their unchanged names.
 */
import {
  type HttpsOptions,
  type Request as V2Request,
  onRequest as onRequestV2Unversioned,
} from "firebase-functions/v2/https";
import { Response } from "express";
import { withVersionFloor } from "./versionFloor";
import { withSentryHttp } from "./observability/sentry";
import { isLiteralCorsOrigin, withPreflightCors } from "./preflightCors";

// OBS-VERSION-10 — every v2 HTTP handler in this file refuses a call whose
// X-Wurld-Version is below the floor (426) before its body runs. The raw
// factory is `onRequestV2Unversioned`, used ONLY by the exempt handlers
// (getVersion, deleteAccount, billingDeletionCheck); versionFloorCoverage
// .static.test.ts holds the list.
//
// OBS-SRV-2 — and every one reports to Sentry through `withSentryHttp`. The
// deployed name is the FIRST argument because nothing at wrap time knows it
// (a v2 `onRequest` is not told its export name, and `FUNCTION_TARGET` reads
// `api` for a route served through the gateway). sentryCoverage.static.test.ts
// pins that the argument equals the export name. The exempt raw-factory
// handlers wrap their own handler with `withSentryHttp(name, …)`.
//
// API-GW-11 — `cors` is applied here, not by the platform: its middleware has
// no maxAge, so the browser re-sent the preflight before almost every call.
export const onRequestV2 = (
  name: string,
  opts: HttpsOptions,
  handler: (req: V2Request, res: Response) => void | Promise<void>,
) => {
  const { cors: corsOrigin, ...platformOpts } = opts;
  const inner = withSentryHttp(name, withVersionFloor(handler));
  if (!isLiteralCorsOrigin(corsOrigin)) return onRequestV2Unversioned(opts, inner);
  return onRequestV2Unversioned(
    platformOpts,
    withPreflightCors(corsOrigin, inner),
  );
};
