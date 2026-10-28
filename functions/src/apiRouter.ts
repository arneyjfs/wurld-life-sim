/**
 * API-GW-1 / API-GW-2 / API-GW-6 — the routing half of the `api` function.
 *
 * Spec: docs/specs/api-gateway.md.
 *
 * Pure (no firebase imports) so it is unit-testable; `endpoints/api.ts` wires
 * the real exports into `createApiDispatcher`.
 */
import { withRequestScope } from "./requestScope";

/** API-GW-1 — the user-facing hot-path endpoints `api` serves. Adding one is a
 *  spec change (API-GW-9); the client's `API_ROUTES` must match. */
export const API_ROUTE_NAMES = [
  "geminiGenerate",
  "geminiStreamV2",
  "synthesizeSpeech",
] as const;

export type ApiRouteName = (typeof API_ROUTE_NAMES)[number];

const ROUTE_SET: ReadonlySet<string> = new Set(API_ROUTE_NAMES);

/** API-GW-1 — the route is the last non-empty path segment; null if it is not
 *  a route (API-GW-2). Exact match: no prototype keys, no case folding. */
export function apiRouteName(path: string): ApiRouteName | null {
  const last = path.split("/").filter(Boolean).pop() ?? "";
  return ROUTE_SET.has(last) ? (last as ApiRouteName) : null;
}

interface RoutedRequest {
  path: string;
}
interface RoutedResponse {
  status(code: number): { json(body: unknown): unknown };
}

/**
 * API-GW-1 — hand the untouched request to the route's own export, inside a
 * fresh request scope (API-GW-6). API-GW-2 — anything else is a 404 that runs
 * no handler.
 */
export function createApiDispatcher<Req extends RoutedRequest, Res extends RoutedResponse>(
  routes: Record<ApiRouteName, (req: Req, res: Res) => unknown>,
): (req: Req, res: Res) => Promise<void> {
  return async (req, res) => {
    const name = apiRouteName(req.path);
    if (!name) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const handler = routes[name];
    await withRequestScope(() => handler(req, res));
  };
}
