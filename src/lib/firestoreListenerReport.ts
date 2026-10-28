import * as log from './log';

/**
 * OBS-COVER-5 — a snapshot listener error whose code is not transient reaches
 * Sentry once per (query label, code) per session, labelled by collection
 * names only (no document ids). Transient codes stay breadcrumbs.
 */

/** Codes a re-attach heals by itself (the listener hooks retry on these). */
export const TRANSIENT_LISTENER_CODES: ReadonlySet<string> = new Set([
  'unavailable',
  'cancelled',
  'deadline-exceeded',
]);

/** `chats/abc/messages/xyz` → `chats/messages`: collection names, never ids. */
export function collectionLabelOfPath(path: string): string {
  const segs = path.split('/').filter(Boolean);
  return segs.filter((_, i) => i % 2 === 0).join('/') || 'unknown';
}

type QueryLike = {
  path?: unknown;
  _query?: {
    path?: { segments?: unknown; canonicalString?: () => string };
    collectionGroup?: unknown;
  };
};

/**
 * Best-effort label for a Firestore `Query`. A `CollectionReference` has a
 * public `path`; a derived query only exposes its path internally, so this
 * reads `_query` defensively and answers `unknown` if the SDK changes shape.
 */
export function queryLabel(query: unknown): string {
  const q = (query ?? {}) as QueryLike;
  if (typeof q.path === 'string') return collectionLabelOfPath(q.path);
  const inner = q._query;
  const group = inner?.collectionGroup;
  try {
    const p = inner?.path;
    const raw = typeof p?.canonicalString === 'function'
      ? p.canonicalString()
      : Array.isArray(p?.segments) ? (p.segments as unknown[]).join('/') : '';
    const base = raw ? collectionLabelOfPath(raw) : '';
    if (typeof group === 'string' && group) return base && base !== 'unknown' ? `${base}/*${group}` : `*${group}`;
    return base || 'unknown';
  } catch {
    return 'unknown';
  }
}

const reported = new Set<string>();

/** Test-only. */
export function _resetListenerReportsForTests(): void {
  reported.clear();
}

export function reportListenerError(
  err: unknown,
  { label, hook }: { label: string; hook: 'useCollectionSnapshot' | 'useDocSnapshot' },
): void {
  const code = err && typeof err === 'object' && 'code' in err ? String((err as { code?: unknown }).code) : 'unknown';
  if (TRANSIENT_LISTENER_CODES.has(code)) {
    log.warn(`[${hook}] listener error (transient)`, { code, collection: label });
    return;
  }
  const key = `${hook}:${label}:${code}`;
  if (reported.has(key)) {
    log.warn(`[${hook}] listener error (already reported)`, { code, collection: label });
    return;
  }
  reported.add(key);
  log.error(err, { action: 'firestoreListen', surface: hook, collection: label, firestoreCode: code });
}
