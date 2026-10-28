/**
 * SAFETY-REPORT-3 — send a report to `reportContent`.
 *
 * Spec: docs/specs/safety.md §2.
 */
import { callHttp } from '@/lib/endpoints';
import { AppError } from '@/lib/errors';
import type { ReportReason, ReportTarget } from '@/lib/reportReasons';

export type ReportRequest = {
  target: ReportTarget;
  reason: ReportReason;
  note?: string;
  chatId?: string;
  messageId?: string;
  reportedUid?: string;
  aiText?: string;
};

export async function submitReport(req: ReportRequest): Promise<{ reportId: string }> {
  return callHttp<ReportRequest, { ok: true; reportId: string }>('reportContent', req);
}

/** SAFETY-REPORT-7 — the daily cap answers 429. */
export function isReportLimitError(err: unknown): boolean {
  return err instanceof AppError && err.httpStatus === 429;
}
