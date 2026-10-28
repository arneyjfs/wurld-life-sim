import { useId, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/cn';
import { getLanguageFlag } from '@/lib/languages';
import { useT } from '@/i18n';
import { LangCard } from './SimpleMarkdown';

/**
 * EXPLAIN-ORIG-1/2 — a one-line "Original (French)" row above the language
 * cards, collapsed on every open; expanding shows the original as a LangCard.
 */
export function OriginalDisclosure({
  language,
  text,
  messageId,
  onCopy,
}: {
  language: string;
  text: string;
  messageId: string;
  onCopy: (text: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        data-testid="explain-original-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className="self-start flex items-center gap-1.5 px-2 py-1 -mx-2 rounded-lg text-xs text-(--color-fg-muted) hover:bg-(--color-bg-hover)"
      >
        <span className="text-base leading-none">{getLanguageFlag(language)}</span>
        <span>{t('explain.original', { language })}</span>
        <ChevronDown size={14} className={cn('transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div id={panelId} data-testid="explain-original-panel">
          <LangCard
            flag={getLanguageFlag(language)}
            label={language}
            text={text}
            language={language}
            playbackKey={`explain-${messageId}-original`}
            onCopy={onCopy}
          />
        </div>
      )}
    </div>
  );
}
