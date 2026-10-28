import * as log from './log';

/**
 * OBS-COVER-9 — a Firestore doc that fails its Zod schema (`parseDoc`).
 *
 * The first drift per schema per session is a Sentry event: a drifted doc is
 * silently dropped from the UI, so a deploy that changes a doc shape the
 * client can't read is otherwise invisible. Later drifts on the same schema
 * are breadcrumbs (one listener can re-emit the same bad doc many times).
 * Only field paths, Zod issue codes and key names are sent — no doc ids, no
 * values.
 */
const reportedSchemas = new WeakSet<object>();

export type SchemaDriftDetail = {
  issues: Array<{ path: string; code: string }>;
  sample: string[];
};

export function reportSchemaDrift(schema: object, detail: SchemaDriftDetail): void {
  if (reportedSchemas.has(schema)) {
    log.warn('[parseDoc] schema drift', detail);
    return;
  }
  reportedSchemas.add(schema);
  log.error(new Error('Firestore doc failed its schema'), {
    action: 'parseDoc',
    issuePaths: detail.issues.map((i) => `${i.path}:${i.code}`).join(', '),
    keys: detail.sample.join(','),
  });
}
