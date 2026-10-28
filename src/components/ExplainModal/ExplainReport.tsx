import { useState } from 'react';
import { Flag } from 'lucide-react';
import { useT } from '@/i18n';
import { ReportSheet, type ReportSubject } from '@/components/Safety/ReportSheet';

/** SAFETY-REPORT-1 — "Report this explanation" (`explain-report`), target
 *  `explanation`, with the text shown prefilled. */
export function ExplainReport({ text }: { text: string }) {
  const t = useT();
  const [subject, setSubject] = useState<ReportSubject | null>(null);
  return (
    <>
      <button
        type="button"
        data-testid="explain-report"
        onClick={() => setSubject({ target: 'explanation', aiText: text })}
        className="self-start flex items-center gap-1.5 px-1 py-1 text-xs text-(--color-fg-muted) hover:text-(--color-fg)"
      >
        <Flag size={12} aria-hidden />
        {t('safety.reportExplanation')}
      </button>
      <ReportSheet subject={subject} onClose={() => setSubject(null)} />
    </>
  );
}
