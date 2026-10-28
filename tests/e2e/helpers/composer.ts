import { expect, type Locator } from '@playwright/test';

/**
 * Send the current composer draft via the Send button — the universal,
 * cross-device send surface (COMP-SEND-1). Use this instead of
 * `input.press('Enter')`: per COMP-SEND-3 the Enter key sends ONLY on
 * desktop-like devices, so pressing it on the `webkit-mobile` project
 * (emulated touch) now just inserts a newline and never sends.
 *
 * Pass the composer textbox locator; the page (and thus the correct
 * per-page composer in a two-window test) is derived from it.
 */
export async function sendComposer(
  input: Locator,
  opts: { enabledTimeout?: number } = {},
): Promise<void> {
  const button = input.page().getByTestId('MessageInput-send');
  // The Send button is disabled (`sending`) until the pipeline RPC returns.
  // On the emulator with REAL Gemini that RPC awaits analyze + per-language
  // translate (processMessagePipeline 4789→4795), i.e. tens of seconds — so a
  // test sending back-to-back needs longer than the 30s default for the PRIOR
  // send to settle before this one fires. Pass `enabledTimeout` in that case.
  await expect(button).toBeEnabled({ timeout: opts.enabledTimeout ?? 30_000 });
  await button.click();
}
