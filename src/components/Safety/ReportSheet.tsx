import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useT, tImperative } from '@/i18n';
import { useLiftFocusedField } from '@/hooks/useLiftFocusedField';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useUIStore } from '@/store/uiStore';
import { reasonsFor, REPORT_NOTE_MAX, type ReportReason, type ReportTarget } from '@/lib/reportReasons';
import { isReportLimitError, submitReport, type ReportRequest } from '@/lib/reports';
import { setBlock } from '@/lib/blocking';
import * as log from '@/lib/log';

export type ReportSubject = {
  target: ReportTarget;
  /** Report translation / an AI message: AI reasons only (SAFETY-REPORT-2). */
  aiOnly?: boolean;
  chatId?: string;
  messageId?: string;
  /** The person, when there is one. Enables "Also block" (SAFETY-REPORT-2). */
  person?: { uid: string; name: string };
  /** Explanation / AI content: the text the user saw (SAFETY-REPORT-3). */
  aiText?: string;
};

/** COMP-KB-22 — the sheet's scroll area, which scrolls its focused field
 *  clear of the keyboard. Its own component so the hook mounts with the
 *  fields (the sheet itself is mounted long before it first opens). */
function LiftScroller({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLiftFocusedField(ref);
  return (
    <div ref={ref} data-lift-scroller className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-3">
      {children}
    </div>
  );
}

const TITLE_KEY = {
  message: 'safety.reportTitleMessage',
  user: 'safety.reportTitleUser',
  explanation: 'safety.reportTitleExplanation',
  ai: 'safety.reportTitleAi',
} as const;

/**
 * SAFETY-REPORT-2 — the one report sheet for every entry point: a reason
 * (required), an optional note, "Also block" for a person, Send.
 * SAFETY-REPORT-9 — a `BottomSheet` (keyboard padding, swipe and Android
 * back), whose focused field is lifted clear of the keyboard.
 */
export function ReportSheet({ subject: openSubject, onClose }: { subject: ReportSubject | null; onClose: () => void }) {
  const t = useT();
  const pushToast = useUIStore((s) => s.pushToast);
  const open = !!openSubject;
  // The last subject stays rendered while the sheet animates out.
  const openKey = openSubject ? JSON.stringify(openSubject) : '';
  const [shownKey, setShownKey] = useState(openKey);
  if (openKey && openKey !== shownKey) setShownKey(openKey);
  const subject = shownKey ? (JSON.parse(shownKey) as ReportSubject) : null;
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState('');
  const [aiText, setAiText] = useState('');
  const [alsoBlock, setAlsoBlock] = useState(false);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  // Reset on (re)open of a different subject. Keyed on the subject's
  // CONTENT: callers build the subject inline, so its identity changes on
  // every parent render (a message snapshot) and must not wipe the form.
  const subjectKey = openKey;
  /* eslint-disable react-hooks/set-state-in-effect -- reset on (re)open */
  useEffect(() => {
    setReason(null);
    setNote('');
    setAiText(subjectKey ? ((JSON.parse(subjectKey) as ReportSubject).aiText ?? '') : '');
    setAlsoBlock(false);
    setSending(false);
    setFailed(null);
  }, [subjectKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (!subject) return null;
  const person = subject.target === 'user' || (subject.target === 'message' && !subject.aiOnly)
    ? subject.person
    : undefined;
  const needsAiText = subject.target === 'explanation' || subject.target === 'ai';
  const canSend = !!reason && !sending && (!needsAiText || aiText.trim().length > 0);

  async function send() {
    if (!canSend || !subject || !reason) return;
    setSending(true);
    setFailed(null);
    // SAFETY-REPORT-2 — the block is written on Submit, independently of the
    // report request: a failed report must not leave the person unblocked.
    if (alsoBlock && person) {
      void setBlock(person.uid, true).catch((err) => {
        log.error(err, { action: 'setBlock', from: 'report' });
        pushToast({ kind: 'error', message: tImperative('safety.blockFailed') });
      });
    }
    const req: ReportRequest = { target: subject.target, reason, note: note.trim() || undefined };
    if (subject.chatId) req.chatId = subject.chatId;
    if (subject.messageId) req.messageId = subject.messageId;
    if (subject.target === 'user' && subject.person) req.reportedUid = subject.person.uid;
    if (needsAiText) req.aiText = aiText.trim();
    try {
      await submitReport(req);
      pushToast({ kind: 'success', message: tImperative('safety.reportThanks') }); // SAFETY-REPORT-5
      onClose();
    } catch (err) {
      log.error(err, { action: 'reportContent', target: subject.target });
      setFailed(isReportLimitError(err) ? tImperative('safety.reportLimit') : tImperative('safety.reportFailed'));
      setSending(false);
    }
  }

  const title = t(TITLE_KEY[subject.target], { name: subject.person?.name ?? '' });

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={title}
      zClass="z-[1200]"
      desktopWidthClass="sm:max-w-sm"
    >
      <div data-testid="report-sheet" className="flex flex-col flex-1 min-h-0">
        <header className="flex items-center justify-between px-4 py-3 border-b border-(--color-border)">
          <h2 className="text-base font-semibold truncate">{title}</h2>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="text-(--color-fg-muted)">
            <X size={20} />
          </button>
        </header>
        <LiftScroller>
          <p className="text-sm font-medium">{t('safety.reportWhy')}</p>
          <div role="radiogroup" className="rounded-xl border border-(--color-border) overflow-hidden">
            {reasonsFor(subject.target, { aiOnly: subject.aiOnly }).map((r, i) => (
              <label
                key={r}
                data-testid={`report-reason-${r}`}
                className={cn(
                  'flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer',
                  i > 0 && 'border-t border-(--color-border)',
                  reason === r && 'bg-(--color-bg-hover)',
                )}
              >
                <input
                  type="radio"
                  name="report-reason"
                  checked={reason === r}
                  onChange={() => setReason(r)}
                  className="accent-(--color-accent)"
                />
                {t(`safety.reason.${r}`)}
              </label>
            ))}
          </div>
          {needsAiText && (
            <textarea
              data-testid="report-ai-text"
              value={aiText}
              onChange={(e) => setAiText(e.target.value)}
              placeholder={t('safety.reportAiText')}
              rows={3}
              maxLength={4000}
              className="w-full rounded-xl border border-(--color-border) bg-(--color-bg-hover) px-3 py-2 text-sm outline-none resize-none"
            />
          )}
          <textarea
            data-testid="report-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={t('safety.reportNote')}
            rows={3}
            maxLength={REPORT_NOTE_MAX}
            className="w-full rounded-xl border border-(--color-border) bg-(--color-bg-hover) px-3 py-2 text-sm outline-none resize-none"
          />
          {person && (
            <label className="flex items-center gap-2 text-sm" data-testid="report-also-block">
              <input
                type="checkbox"
                checked={alsoBlock}
                onChange={(e) => setAlsoBlock(e.target.checked)}
                className="accent-(--color-accent)"
              />
              {t('safety.reportAlsoBlock', { name: person.name })}
            </label>
          )}
          {failed && (
            <p role="alert" data-testid="report-error" className="text-sm text-(--color-danger)">
              {failed}
            </p>
          )}
        </LiftScroller>
        <footer className="px-4 py-3 border-t border-(--color-border)">
          {/* SAFETY-REPORT-2 — what the report shares, pinned above Send so it is always on screen. */}
          <p data-testid="report-share-notice" className="text-xs text-(--color-fg-muted) mb-2">
            {subject.target === 'message'
              ? t('safety.reportShareMessage')
              : subject.target === 'user'
                ? t('safety.reportShareUser', { name: subject.person?.name ?? '' })
                : t('safety.reportShareAi')}
          </p>
          <button
            type="button"
            data-testid="report-submit"
            onClick={() => void send()}
            disabled={!canSend}
            className={cn(
              'w-full py-2.5 rounded-xl font-semibold',
              canSend ? 'bg-(--color-danger) text-white' : 'bg-(--color-bg-hover) text-(--color-fg-muted)',
            )}
          >
            {sending ? t('safety.reportSending') : t('safety.reportSubmit')}
          </button>
        </footer>
      </div>
    </BottomSheet>
  );
}
