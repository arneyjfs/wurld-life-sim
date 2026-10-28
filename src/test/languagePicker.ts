/**
 * Find LanguagePicker rows by language NAME, without a role query.
 *
 * ⚠ Why not `getAllByRole('button', { name: /German/ })`: that computes the
 * accessible name of every one of the picker's ~90 buttons, and each name
 * walks the subtree calling jsdom's `getComputedStyle`, which re-runs the
 * cascade of every stylesheet on the page (vaul injects one) per element. It
 * was ~40% of these files' runtime (profiled 2026-09-30) and pushed single
 * tests past vitest's 5 s timeout whenever the machine was loaded. The row's
 * `data-testid` is `language-picker-row-<canonical name>`, which is what the
 * tests mean by "the German row".
 */
const PREFIX = 'language-picker-row-';

/** Every picker row under `container` whose canonical language name matches. */
export function pickerRows(container: ParentNode, language: RegExp): HTMLButtonElement[] {
  return [...container.querySelectorAll<HTMLButtonElement>(`[data-testid^="${PREFIX}"]`)].filter((el) =>
    language.test(el.dataset.testid!.slice(PREFIX.length)),
  );
}

/** The first matching row; throws, naming what was on offer, when none matches. */
export function pickerRow(container: ParentNode, language: RegExp): HTMLButtonElement {
  const rows = pickerRows(container, language);
  if (rows.length === 0) {
    const offered = [...container.querySelectorAll(`[data-testid^="${PREFIX}"]`)].map((el) =>
      el.getAttribute('data-testid')!.slice(PREFIX.length),
    );
    throw new Error(`No language-picker row matches ${language}. Rows: ${offered.join(', ') || '(none)'}`);
  }
  return rows[0]!;
}
