/**
 * MSG-VIEW-7 / LIFE-LANG-3 — the shared view-settings sheet.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-VIEW-7.
 *
 * The sheet is the same component on both surfaces, so the tests that matter
 * are the ones about what it SAYS (real language names, never the words
 * "practice"/"native") and what it does to the model — plus the fact that the
 * chat-only rows are absent unless a caller passes them.
 */
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ViewSettingsSheet } from './ViewSettingsSheet';
import { DEFAULT_VIEW_SETTINGS, type ViewSettings } from '@/lib/viewSettings';

function setup(settings: Partial<ViewSettings> = {}, chatExtras?: React.ReactNode) {
  const onChange = vi.fn();
  render(
    <ViewSettingsSheet
      open
      onClose={() => {}}
      settings={{ ...DEFAULT_VIEW_SETTINGS, ...settings }}
      onChange={onChange}
      practiceLanguage="French"
      nativeLanguage="English (British)"
      chatExtras={chatExtras}
    />,
  );
  return { onChange, user: userEvent.setup() };
}

describe('MSG-VIEW-7 — view settings sheet', () => {
  it('MSG-VIEW-7.3 — labels are the real language names, plus the ORDER', () => {
    // ⚠ The bare names ("French"/"English") did not say the setting picks an
    // ORDER. `first` does, and it is the whole addition — a role-led variant
    // ("Practice first (French)") was tried the same day and reverted: it put
    // our jargon back in the copy to disambiguate one ADJACENT sentence, which
    // is fixed in that sentence instead (MSG-VIEW-7.11).
    //
    // ⚠ Anchored, not substring-matched. The previous assertions here were
    // `toHaveTextContent('French')`, which "Practice first (French)" satisfies
    // — so the whole suite stayed green through a change that contradicted the
    // rule. Substring matches cannot pin a label's shape.
    setup();
    expect(screen.getByTestId('ViewSettings-primary-practice').textContent)
      .toMatch(/^French first/);
    expect(screen.getByTestId('ViewSettings-primary-native').textContent)
      .toMatch(/^English first/);
    const group = screen.getByTestId('ViewSettings-primary-group');
    expect(group.textContent).not.toMatch(/\bpractice\b/i);
    expect(group.textContent).not.toMatch(/\bnative\b/i);
  });

  it('MSG-VIEW-7.3 — the group is headed by what it sets', () => {
    setup();
    expect(screen.getByTestId('ViewSettings-primary-heading')).toHaveTextContent(
      /^reading language$/i,
    );
  });

  it('MSG-VIEW-7.10 — the sheet does NOT set languages, and says where they are set', () => {
    // The life sim passes no link and must not grow one — it has no
    // `/chat/:id/info` to point at.
    setup();
    expect(screen.queryByTestId('ChatHeaderMenu-language-row')).not.toBeInTheDocument();
  });

  it('drops the parenthetical qualifier — "English (British)" reads as "English"', () => {
    setup();
    expect(screen.getByTestId('ViewSettings-primary-native')).not.toHaveTextContent('(British)');
  });

  it('every option carries a description row', () => {
    setup();
    for (const v of ['practice', 'native'] as const) {
      const row = screen.getByTestId(`ViewSettings-primary-${v}`);
      // label + description = more than one line of text
      expect(row.textContent!.length).toBeGreaterThan(12);
    }
  });

  it('MSG-VIEW-7.12 — the sheet offers exactly two main-row options', () => {
    setup();
    const group = screen.getByTestId('ViewSettings-primary-group');
    const radios = within(group).getAllByRole('radio');
    expect(radios.map((r) => r.getAttribute('data-testid'))).toEqual([
      'ViewSettings-primary-practice',
      'ViewSettings-primary-native',
    ]);
    expect(radios.filter((r) => r.getAttribute('aria-checked') === 'true')).toHaveLength(1);
    expect(screen.queryByTestId('ViewSettings-primary-mixed')).toBeNull();
    expect(screen.queryByTestId('ViewSettings-mixed-second')).toBeNull();
    expect(screen.queryByTestId('ViewSettings-mixed-second-change')).toBeNull();
    expect(group.textContent).not.toMatch(/mixed/i);
  });

  it('selecting an option changes only the primary', async () => {
    const { onChange, user } = setup({ primary: 'practice', secondRow: false });
    await user.click(screen.getByTestId('ViewSettings-primary-native'));
    expect(onChange).toHaveBeenCalledWith({ primary: 'native', secondRow: false });
  });

  describe('the second-row toggle', () => {
    it('is a switch reflecting the current state', () => {
      setup({ secondRow: false });
      expect(screen.getByTestId('ViewSettings-second-row')).toHaveAttribute('aria-checked', 'false');
    });

    it('names the language that WOULD show, so the label is never abstract', () => {
      setup({ primary: 'practice', secondRow: true });
      expect(screen.getByTestId('ViewSettings-second-row')).toHaveTextContent('English');
    });

    it('names PRACTICE when native is the main row — the second row is the inverse', () => {
      setup({ primary: 'native', secondRow: true });
      expect(screen.getByTestId('ViewSettings-second-row')).toHaveTextContent('French');
    });

    it('MSG-VIEW-7.4 — its eye matches the header eye: open when on, closed when off', () => {
      // The row and the header eye are one state, so they must also LOOK like
      // one state. A permanently-open eye beside an off switch says the
      // opposite of what the switch says.
      const { unmount } = render(
        <ViewSettingsSheet
          open
          onClose={() => {}}
          settings={{ ...DEFAULT_VIEW_SETTINGS, secondRow: true }}
          onChange={vi.fn()}
          practiceLanguage="French"
          nativeLanguage="English"
        />,
      );
      expect(
        screen.getByTestId('ViewSettings-second-row-icon'),
      ).toHaveAttribute('data-open', 'true');
      unmount();

      setup({ secondRow: false });
      expect(
        screen.getByTestId('ViewSettings-second-row-icon'),
      ).toHaveAttribute('data-open', 'false');
    });

    it('toggles only the second row', async () => {
      const { onChange, user } = setup({ primary: 'native', secondRow: true });
      await user.click(screen.getByTestId('ViewSettings-second-row'));
      expect(onChange).toHaveBeenCalledWith({ primary: 'native', secondRow: false });
    });
  });

  describe('chat-only rows', () => {
    it('are absent when the caller passes none (the life-sim case)', () => {
      setup();
      expect(screen.queryByTestId('chat-extras')).toBeNull();
    });

    it('render below the toggle when the caller passes them (the chat case)', () => {
      setup({}, <div data-testid="chat-extras">extras</div>);
      expect(screen.getByTestId('chat-extras')).toBeInTheDocument();
    });
  });
});
