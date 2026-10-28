import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Composer } from './Composer';

/** Stub matchMedia so `prefersEnterToSend()` resolves deterministically. */
function setDesktop(isDesktop: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: isDesktop,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

describe('COMP-SEND-3 — device-aware Enter semantics', () => {
  afterEach(() => vi.restoreAllMocks());

  it('desktop (hover + fine pointer): Enter sends; Shift+Enter does not', () => {
    setDesktop(true);
    const onSubmit = vi.fn();
    render(<Composer value="hi" onChange={() => {}} onSubmit={onSubmit} testId="composer" />);
    const ta = screen.getByTestId('composer');

    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled(); // Shift+Enter = newline

    fireEvent.keyDown(ta, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1); // Enter = send
  });

  it('touch device (no hover / coarse pointer): Enter is a newline, never a send', () => {
    setDesktop(false);
    const onSubmit = vi.fn();
    render(<Composer value="hi" onChange={() => {}} onSubmit={onSubmit} testId="composer" />);

    fireEvent.keyDown(screen.getByTestId('composer'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('desktop: empty/whitespace draft does not send on Enter', () => {
    setDesktop(true);
    const onSubmit = vi.fn();
    render(<Composer value="   " onChange={() => {}} onSubmit={onSubmit} testId="composer" />);

    fireEvent.keyDown(screen.getByTestId('composer'), { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('TUTOR-SETUP-12 — setup pointer target hugs the input box', () => {
  afterEach(() => vi.restoreAllMocks());

  it('puts data-setup-target on the input-box wrapper (the textarea is inside it)', () => {
    render(
      <Composer
        value="hi"
        onChange={() => {}}
        onSubmit={() => {}}
        testId="composer"
        setupTarget="composer"
      />,
    );
    const target = document.querySelector('[data-setup-target="composer"]');
    const textarea = screen.getByTestId('composer');
    // The ring target is the rounded input pill — the textarea lives inside it,
    // NOT the full composer row (attach + input + send buttons).
    expect(target).not.toBeNull();
    expect(target).toContainElement(textarea);
    expect(target!.tagName).toBe('DIV');
  });

  it('omits data-setup-target when setupTarget is not passed (modal/explain composers)', () => {
    render(<Composer value="hi" onChange={() => {}} onSubmit={() => {}} testId="composer" />);
    expect(document.querySelector('[data-setup-target]')).toBeNull();
  });
});
