/**
 * SAFETY-REPORT-1 — Report this explanation (docs/specs/safety.md §2).
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/store/uiStore', () => ({
  useUIStore: (sel: (s: { pushToast: () => void }) => unknown) => sel({ pushToast: vi.fn() }),
}));
const callHttp = vi.fn(async () => ({ ok: true, reportId: 'r1' }));
vi.mock('@/lib/endpoints', () => ({ callHttp: (...a: unknown[]) => callHttp(...(a as [])) }));
vi.mock('@/lib/log', () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }));

import { ExplainReport } from './ExplainReport';
import { explanationReportText } from './explanationReportText';

const section = (title: string, body: string) => ({ title, body, vocabItems: [] });

describe('SAFETY-REPORT-1 — Report this explanation', () => {
  it('SAFETY-REPORT-1 — the reported text is the review, the sections, then follow-up answers', () => {
    const text = explanationReportText(
      { original: '', translated: '', complete: true, sections: [section('Grammar', 'uses the past')],
        review: { score: 3, body: 'Mostly right', vocabItems: [], cleanComment: '' } },
      [[section('', 'a follow-up answer')]],
    );
    expect(text).toBe('Mostly right\n\nGrammar\nuses the past\n\na follow-up answer');
  });

  it('SAFETY-REPORT-1 — capped at 4000 characters', () => {
    const text = explanationReportText({ original: '', translated: '', complete: true, review: null, sections: [section('', 'x'.repeat(5000))] }, []);
    expect(text.length).toBe(4000);
  });

  it('SAFETY-REPORT-1 — opens the sheet for target explanation with the text prefilled, AI reasons only', async () => {
    render(<ExplainReport text="the explanation" />);
    fireEvent.click(screen.getByTestId('explain-report'));
    expect((screen.getByTestId('report-ai-text') as HTMLTextAreaElement).value).toBe('the explanation');
    expect(screen.queryByTestId('report-reason-harassment')).toBeNull();
    fireEvent.click(screen.getByTestId('report-reason-ai_wrong').querySelector('input')!);
    fireEvent.click(screen.getByTestId('report-submit'));
    await waitFor(() => expect(callHttp).toHaveBeenCalledWith('reportContent', {
      target: 'explanation', reason: 'ai_wrong', aiText: 'the explanation',
    }));
  });
});
