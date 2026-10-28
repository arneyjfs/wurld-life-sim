// @vitest-environment jsdom
/**
 * copyToClipboard — native plugin → secure async API → synchronous execCommand
 * fallback (the #14 iOS-copy fix). See lib/clipboard.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const writeMock = vi.fn();
const isNativeRuntimeMock = vi.fn();
// jsdom doesn't implement document.execCommand, so install our own.
const execMock = vi.fn<(cmd: string) => boolean>();
(document as unknown as { execCommand: typeof execMock }).execCommand = execMock;

vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: (...a: unknown[]) => writeMock(...a) } }));
vi.mock('./capabilities', () => ({ isNativeRuntime: () => isNativeRuntimeMock() }));

import { copyToClipboard } from './clipboard';

function setSecure(secure: boolean) {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
}
function setAsyncClipboard(writeText: ((t: string) => Promise<void>) | null) {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

beforeEach(() => {
  writeMock.mockReset().mockResolvedValue(undefined);
  isNativeRuntimeMock.mockReset().mockReturnValue(false);
  execMock.mockReset().mockReturnValue(true);
});
afterEach(() => {
  vi.restoreAllMocks();
  setAsyncClipboard(null);
});

describe('copyToClipboard', () => {
  it('native runtime → uses the Capacitor plugin', async () => {
    isNativeRuntimeMock.mockReturnValue(true);
    await copyToClipboard('hi');
    expect(writeMock).toHaveBeenCalledWith({ string: 'hi' });
  });

  it('secure web context → uses the async navigator.clipboard API', async () => {
    setSecure(true);
    const writeText = vi.fn().mockResolvedValue(undefined);
    setAsyncClipboard(writeText);
    await copyToClipboard('hello');
    expect(writeText).toHaveBeenCalledWith('hello');
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('#14 — NON-secure web (iOS dev / WKWebView) → synchronous execCommand fallback', async () => {
    setSecure(false);
    setAsyncClipboard(null); // iOS non-secure: navigator.clipboard absent
    await copyToClipboard('on iOS');
    expect(execMock).toHaveBeenCalledWith('copy');
  });

  it('#14 — secure async API rejecting falls through to execCommand', async () => {
    setSecure(true);
    setAsyncClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    await copyToClipboard('x');
    expect(execMock).toHaveBeenCalledWith('copy');
  });

  it('throws when every tier fails (caller shows an error toast)', async () => {
    setSecure(false);
    setAsyncClipboard(null);
    execMock.mockReturnValue(false);
    await expect(copyToClipboard('x')).rejects.toThrow('clipboard unavailable');
  });

  it('focus-trap-safe — mounts the scratch textarea inside the focused subtree (copy inside vaul/Radix sheets)', async () => {
    setSecure(false);
    setAsyncClipboard(null);
    // Simulate a dialog with a focus trap: the copy button lives inside a
    // container, and that button has focus when the gesture fires.
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    const btn = document.createElement('button');
    dialog.appendChild(btn);
    document.body.appendChild(dialog);
    btn.focus();

    // Capture where the textarea is mounted at execCommand-time — it must be
    // inside the dialog (the trapped region), NOT a child of <body>.
    let parentAtCopy: Element | null = null;
    execMock.mockImplementation(() => {
      parentAtCopy = document.querySelector('textarea')?.parentElement ?? null;
      return true;
    });

    await copyToClipboard('inside a sheet');
    expect(execMock).toHaveBeenCalledWith('copy');
    expect(parentAtCopy).toBe(dialog);
    // Cleaned up + focus restored to the tapped button.
    expect(document.querySelector('textarea')).toBeNull();
    expect(document.activeElement).toBe(btn);

    dialog.remove();
  });
});
