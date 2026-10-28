/**
 * LIFE-EX-8: type-to-fill input — the player TYPES the missing word for a
 * fill-blank question instead of picking a chip (production practice).
 * Rendered in place of the ActionBar chip grid at intermediate+ levels
 * (`shouldTypeFill`); the typed string is graded against the correct chip.
 */
import { useState } from 'react';
import { useT } from '@/i18n';

export function TypeToFillInput({
  onSubmit,
  practiceLanguage,
}: {
  onSubmit: (typed: string) => void;
  practiceLanguage?: string;
}) {
  const t = useT();
  const [value, setValue] = useState('');
  const trimmed = value.trim();
  const submit = () => {
    if (trimmed) onSubmit(trimmed);
  };
  return (
    <div
      data-testid="LifeScreen-TypeToFill"
      // COMP-KB-14: ride the type-to-fill input above the soft keyboard
      // (`.pb-keyboard` — same driver/util as the chat composer).
      className="px-3 pb-keyboard pt-2 bg-(--color-bg) flex items-center gap-2"
    >
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder={t('life.typeToFill.placeholder')}
        aria-label={t('life.typeToFill.placeholder')}
        autoComplete="off"
        autoCapitalize="off"
        autoCorrect="off"
        spellCheck={false}
        lang={practiceLanguage}
        data-testid="LifeScreen-TypeToFill-Input"
        className="flex-1 min-w-0 px-4 py-3 rounded-full bg-(--color-bg-elevated) border border-(--color-border) text-(--color-fg) text-[15px] outline-none focus:border-(--color-accent)"
      />
      <button
        type="button"
        onClick={submit}
        disabled={!trimmed}
        data-testid="LifeScreen-TypeToFill-Submit"
        className="shrink-0 px-4 py-3 rounded-full text-sm font-semibold bg-gradient-accent text-white disabled:opacity-40"
      >
        {t('life.typeToFill.submit')}
      </button>
    </div>
  );
}
