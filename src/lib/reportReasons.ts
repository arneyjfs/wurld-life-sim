/**
 * SAFETY-REPORT-2 — which reasons the report sheet offers for each target.
 *
 * Spec: docs/specs/safety.md §2. Pure and import-free so the server's table
 * (`functions/src/safetyReports.ts`) can be pinned against it
 * (`functions/src/__tests__/reportReasonsParity.test.ts`).
 */
export type ReportTarget = 'message' | 'user' | 'explanation' | 'ai';

export type ReportReason =
  | 'harassment' | 'hate' | 'sexual' | 'violence' | 'spam'
  | 'impersonation' | 'ai_offensive' | 'ai_wrong' | 'other';

const PERSON: ReportReason[] = ['harassment', 'hate', 'sexual', 'violence', 'spam'];
const AI: ReportReason[] = ['ai_offensive', 'ai_wrong'];

/** Everything the server accepts per target. */
export const REPORT_REASONS_BY_TARGET: Record<ReportTarget, readonly ReportReason[]> = {
  message: [...PERSON, ...AI, 'other'],
  user: [...PERSON, 'impersonation', 'other'],
  explanation: [...AI, 'other'],
  ai: [...AI, 'other'],
};

/**
 * What the sheet shows. A message is reported as a person's content AND as
 * AI output (its translation) when a person sent it; as AI output only when it
 * is the viewer's own (Report translation) or the tutor's / Wurld team's.
 */
export function reasonsFor(target: ReportTarget, opts: { aiOnly?: boolean } = {}): readonly ReportReason[] {
  if (target === 'message' && opts.aiOnly) return [...AI, 'other'];
  return REPORT_REASONS_BY_TARGET[target];
}

export const REPORT_NOTE_MAX = 1000;
