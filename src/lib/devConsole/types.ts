/**
 * Shared shapes for the on-device dev console.
 * Spec: docs/specs/dev-console.md.
 */

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug';

/** DEVCON-CON-3 — one captured console call (already formatted + redacted). */
export type ConsoleEntry = {
  /** Monotonically increasing across evictions — used as the React key. */
  seq: number;
  level: ConsoleLevel;
  /** Epoch ms. */
  ts: number;
  text: string;
};

/** DEVCON-NET-2 — one captured request. Updated in place when it settles. */
export type NetworkEntry = {
  id: string;
  transport: 'fetch' | 'xhr';
  method: string;
  url: string;
  startedAt: number;
  durationMs: number | null;
  /** `0` for a transport failure; `null` while pending. */
  status: number | null;
  ok: boolean | null;
  pending: boolean;
  requestBody: string | null;
  responseBody: string | null;
  /** Lower-cased header names; credential values already redacted. */
  requestHeaders: Record<string, string>;
  error: string | null;
};

/** A live global patch. Calling `uninstall` restores exactly what was found. */
export type CapturePatch = {
  uninstall: () => void;
};
