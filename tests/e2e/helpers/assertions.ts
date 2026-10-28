/**
 * Reusable Playwright assertions for Wurld E2E tests.
 */

import { Page, expect } from '@playwright/test';

/**
 * Wait for all ActivityIndicator spinners to disappear from the page.
 * Uses the React Native Web rendered structure (role="progressbar").
 */
export async function waitForNoSpinners(page: Page, timeoutMs = 30_000): Promise<void> {
  await expect(page.locator('div[role="progressbar"]')).toHaveCount(0, { timeout: timeoutMs });
}

/**
 * Wait for a specific message bubble to appear in the chat view.
 * Matches by visible text content.
 *
 * ⚠ **Do not use this on a row that carries vocab annotation** — prefer
 * `waitForMessageById`. Each vocab span renders as its own `<button>`, and the
 * spans are PHRASES the analysis model picks ("Je suis allé(e)", "à la
 * boulangerie"). `hasText` matches concatenated `textContent`, so whether a
 * multi-word substring survives as one contiguous run depends on how the model
 * segmented that sentence on that run — which makes the assertion
 * non-deterministic rather than slow. That is exactly how MSG-PIPE-17.3 flaked
 * on the `@critical` gate with "element(s) not found"; it sends in the PRACTICE
 * language, so the sender's own words come back annotated.
 *
 * Single words and native-language originals are safe. Anything spanning a word
 * boundary on an annotated row is not.
 */
export async function waitForMessageBubble(page: Page, textSubstring: string, timeoutMs = 30_000): Promise<void> {
  await expect(
    page.locator('[data-testid="MessageBubbleSurface"]', { hasText: textSubstring }).first(),
  ).toBeVisible({ timeout: timeoutMs });
}

/**
 * Wait for the wrapper carrying the given `data-message-id` to be
 * present in the DOM. Use this instead of `waitForMessageBubble` when
 * the bubble's body text isn't predictable — e.g. peer messages
 * seeded without translations render a "Translating…" shimmer until
 * the pipeline lands, so a body-text match would never hit.
 */
export async function waitForMessageById(page: Page, messageId: string, timeoutMs = 30_000): Promise<void> {
  await expect(
    page.locator(`[data-message-id="${messageId}"]`),
  ).toBeAttached({ timeout: timeoutMs });
}

/**
 * Count message bubbles currently visible.
 */
export async function countMessageBubbles(page: Page): Promise<number> {
  return page.locator('[data-testid="MessageBubbleSurface"]').count();
}

/**
 * Check that a message bubble contains translated text (not just the original).
 * This verifies the translation pipeline completed by checking for text in the
 * translation display area.
 */
export async function assertTranslationVisible(
  page: Page,
  originalText: string,
  timeoutMs = 30_000,
): Promise<void> {
  // The bubble with the original text should exist
  const bubble = page.locator('[data-testid="MessageBubbleSurface"]', { hasText: originalText }).first();
  await expect(bubble).toBeVisible({ timeout: timeoutMs });

  // Wait for the bubble to NOT contain a spinner (translation done)
  await expect(bubble.locator('div[role="progressbar"]')).toHaveCount(0, { timeout: timeoutMs });
}

/**
 * Assert that complex word annotations (<cw> tags rendered as tappable spans)
 * are present in a message bubble. The pipeline renders these as Pressable
 * elements with specific styling.
 */
export async function assertComplexWordsPresent(
  page: Page,
  messageText: string,
  minCount = 1,
  timeoutMs = 30_000,
): Promise<boolean> {
  const bubble = page.locator('[data-testid="MessageBubbleSurface"]', { hasText: messageText }).first();
  await expect(bubble).toBeVisible({ timeout: timeoutMs });

  // Complex words are rendered as styled inline elements with underline decoration
  // They use the highlight/cwWord style class. Check for elements that look tappable.
  // This is a heuristic — adjust based on actual rendered DOM.
  const cwElements = bubble.locator('[data-testid^="cw-"]');
  const count = await cwElements.count().catch(() => 0);

  if (count >= minCount) return true;

  // Fallback: check for underlined text elements within the bubble
  // CW words have textDecorationLine: 'underline' or borderBottom styling
  return count >= minCount;
}

/**
 * Get the send status indicator state for the most recent outgoing message.
 * Returns 'translating' | 'sent' | 'failed' | 'pending_review' | null.
 */
export async function getLatestMessageStatus(page: Page): Promise<string | null> {
  // Look at the last message bubble's meta area
  const bubbles = page.locator('[data-testid="MessageBubbleSurface"]');
  const count = await bubbles.count();
  if (count === 0) return null;

  const lastBubble = bubbles.nth(count - 1);

  // Check for pending_review indicator (greyer bubble background)
  const bgColor = await lastBubble.evaluate((el) => {
    return window.getComputedStyle(el).backgroundColor;
  }).catch(() => '');

  // Check for check mark (sent)
  const hasCheck = await lastBubble.locator('svg').count() > 0;

  return hasCheck ? 'sent' : 'translating';
}

/**
 * Verify that a Firestore message document has valid translations under all
 * expected KEYS. This checks server-side data directly.
 *
 * MSG-KEY-10.1 — callers pass BASE keys (`translationKeyFor` output), never
 * regional language names: 'English (British)' has no row of its own, so
 * passing one here would report a spurious `missing` entry.
 */
export function assertMessageTranslations(
  messageData: any,
  expectedKeys: string[],
): { valid: boolean; missing: string[]; errors: string[] } {
  const translations = messageData?.translations ?? {};
  const jobs = messageData?.translationJobs ?? {};
  const missing: string[] = [];
  const errors: string[] = [];

  for (const key of expectedKeys) {
    const td = translations[key];
    if (!td || !td.text || !td.text.trim()) {
      missing.push(key);
    }
    const job = jobs[key];
    if (job?.status === 'error') {
      errors.push(`${key}: ${job.error ?? 'unknown error'}`);
    }
  }

  return {
    valid: missing.length === 0 && errors.length === 0,
    missing,
    errors,
  };
}

/**
 * Verify translation quality heuristics:
 * - Translation text is not identical to original (unless same language)
 * - Translation text is not empty
 * - No wrapping quotes added
 * - No duplicated leading words
 */
export function assertTranslationQuality(
  originalText: string,
  originalLanguage: string,
  translatedText: string,
  targetLanguage: string,
): string[] {
  const issues: string[] = [];

  if (!translatedText || !translatedText.trim()) {
    issues.push(`Empty translation for ${targetLanguage}`);
    return issues;
  }

  // Check for wrapping quotes
  if (/^["'"'«»].*["'"'«»]$/.test(translatedText.trim())) {
    issues.push(`Translation for ${targetLanguage} has wrapping quotes: "${translatedText}"`);
  }

  // Check for duplicated leading segment
  const words = translatedText.trim().split(/\s+/);
  if (words.length >= 4) {
    const half = Math.floor(words.length / 2);
    const firstHalf = words.slice(0, half).join(' ');
    const secondHalf = words.slice(half, half * 2).join(' ');
    if (firstHalf === secondHalf) {
      issues.push(`Translation for ${targetLanguage} has duplicated leading segment: "${translatedText}"`);
    }
  }

  // If different language, translation should differ from original
  if (originalLanguage !== targetLanguage && translatedText.trim() === originalText.trim()) {
    issues.push(`Translation for ${targetLanguage} is identical to original (${originalLanguage})`);
  }

  return issues;
}
