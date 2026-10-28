/**
 * API-GW-11 — CORS for the v2 HTTP functions, with the preflight answer
 * cached (docs/specs/api-gateway.md).
 *
 * The platform's `cors` option runs the `cors` middleware with no `maxAge`, so
 * the browser keeps a preflight for ~5 s and nearly every send paid an extra
 * round trip to us-central1 before its POST. `onRequestV2` (httpV2.ts) takes
 * that option off and wraps the handler with this instead. Pure: no firebase
 * imports, so the unit test drives it with fake req/res.
 */
import cors = require("cors");
import type { Request, Response } from "express";

/** Two hours: Chrome's cap. WebKit caps at 10 minutes. */
export const PREFLIGHT_MAX_AGE_S = 7200;

export type CorsOrigin = string | boolean | RegExp | Array<string | RegExp>;

/** A literal origin setting (a params `Expression` is left to the platform). */
export function isLiteralCorsOrigin(value: unknown): value is CorsOrigin {
  return typeof value === "string" || typeof value === "boolean" || value instanceof RegExp || Array.isArray(value);
}

/** Answer the preflight (204, never reaching `handler`) and stamp the allow
 *  headers on every other request, as the platform's middleware did. */
export function withPreflightCors<Req extends Request, Res extends Response>(
  origin: CorsOrigin,
  handler: (req: Req, res: Res) => unknown,
): (req: Req, res: Res) => Promise<void> {
  const middleware = cors({ origin, maxAge: PREFLIGHT_MAX_AGE_S });
  return (req, res) =>
    new Promise<void>((resolve, reject) => {
      res.on("finish", () => resolve());
      middleware(req, res, () => {
        Promise.resolve(handler(req, res)).then(() => resolve(), reject);
      });
    });
}
