/**
 * Shared fixtures for the MSG-KEY-10 (base translation keys) E2E specs:
 *
 *   translation-key-base-sharing.spec.ts
 *   translation-key-script-variants.spec.ts
 *   translation-key-join-reuse.spec.ts
 *   migration-0.3.1-cleanup.spec.ts   (MSG-KEY-10.6.2 — the cleanup sweep)
 *
 * Spec: docs/specs/message-pipeline.md — MSG-KEY-10 (10.1–10.8).
 *
 * ⚠ The key predicates here are written out BY HAND, not imported from
 * `functions/src/translationKeys.ts`. Importing the production table would let
 * a wrong table certify itself: a spec asserting "no regional key was written"
 * with the same function that decides what "regional" means cannot catch the
 * table being wrong. The list below is the MSG-KEY-10.1 merge table, copied
 * from the spec, and it is deliberately dumb.
 */

import { expect, type Page, type Response } from '@playwright/test';
import * as admin from 'firebase-admin';
import type { AuthenticatedUser } from './auth';
import { sendComposer } from './composer';
import { waitForNoSpinners } from './assertions';
import { getAdminFirestore } from './firebase-admin';
import { SPINNER_GONE_TIMEOUT_MS } from './constants';

// ─── Key predicates (MSG-KEY-10.1 table, hand-copied) ───────────────────────

/** Every REGIONAL name that MSG-KEY-10.1 merges into a group key. A name in
 *  this list must never appear as a NEW storage key (only as a 10.5 alias). */
export const REGIONAL_NAMES = [
  'English (American)',
  'English (British)',
  'English (Australian)',
  'English (Indian)',
  'French (Canadian)',
  'Spanish (Mexico)',
] as const;

/** The same names as they appear inside an annotated key (`normaliseLangKeyPart`). */
const REGIONAL_PARTS = /English_(American|British|Australian|Indian)|French_Canadian|Spanish_Mexico/;

/** True when `key` is a pre-MSG-KEY-10 regional key (bare or annotated). */
export function isRegionalKey(key: string): boolean {
  return (REGIONAL_NAMES as readonly string[]).includes(key) || REGIONAL_PARTS.test(key);
}

/** True when a (regional) language NAME belongs to the `English` group. */
export function isEnglishVariant(name: string | undefined | null): boolean {
  return typeof name === 'string' && /^English( \((American|British|Australian|Indian)\))?$/.test(name.trim());
}

// ─── Message-doc readers ────────────────────────────────────────────────────

export type Doc = Record<string, any>;

export const translationsOf = (doc: Doc): Record<string, { text?: string; complexWords?: unknown }> =>
  (doc.translations ?? {}) as Record<string, { text?: string; complexWords?: unknown }>;

export const jobsOf = (doc: Doc): Record<string, Record<string, any>> =>
  (doc.translationJobs ?? {}) as Record<string, Record<string, any>>;

/** `pipeline.traces[].stage`, in order. Traces are written by the pipeline
 *  itself on every path (MSG-ROBUST-7) — the harness runs REAL Gemini, so the
 *  stub's `_e2eLlmCalls` recorder is empty and cannot be used here (see
 *  multi-target-convert.spec.ts). */
export function stages(doc: Doc): string[] {
  const traces = ((doc.pipeline as { traces?: Array<{ stage?: string }> } | undefined)?.traces) ?? [];
  return traces.map((t) => t.stage ?? '');
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every stage label that means "a MODEL call produced text for `key`", per
 * `STAGE_LABELS` in functions/src/index.ts:
 *   translate.K / annotate.K                      — per-key convert
 *   translateMulti.K / annotateMulti.K            — committed by a MSG-PIPE-26 batch
 *   backfillBatch.K                               — backfill batch
 *   {translateOnly|translateAndAnnotate|annotateOnly}.K.backfill — backfill item
 * NOT `translateOnly.K.identityCopy` (no model) and NOT `stripFromExisting.K`.
 */
export function llmStagesForKey(doc: Doc, key: string): string[] {
  const k = escapeRe(key);
  const re = new RegExp(
    `^(?:(?:translate|annotate)(?:Multi)?\\.${k}|backfillBatch\\.${k}|(?:translateOnly|translateAndAnnotate|annotateOnly)\\.${k}\\.backfill)$`,
  );
  return stages(doc).filter((s) => re.test(s));
}

/** Text normalised for "is this the same sentence" comparisons: case, spacing,
 *  punctuation and the markdown emphasis a row renderer may strip. */
export function normaliseText(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[*_`~]/g, '')
    .replace(/[\p{P}\p{S}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A stable snapshot of the three per-key maps, for "nothing changed" checks. */
export function keyMapsSnapshot(doc: Doc): string {
  const sortObj = (o: Record<string, unknown> | undefined) =>
    Object.fromEntries(Object.entries(o ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  return JSON.stringify({
    translations: sortObj(doc.translations),
    translationJobs: sortObj(doc.translationJobs),
    translationErrors: sortObj(doc.translationErrors),
  });
}

export async function readMessage(chatId: string, messageId: string): Promise<Doc> {
  const snap = await getAdminFirestore().doc(`chats/${chatId}/messages/${messageId}`).get();
  return { id: snap.id, ...(snap.data() ?? {}) };
}

// ─── Chat fixtures ──────────────────────────────────────────────────────────

/** A group chat written through the Admin SDK (same shape as
 *  multi-target-convert.spec.ts). The UI path is groups.spec.ts's subject. */
export async function createGroupChat(users: AuthenticatedUser[], name: string, id?: string): Promise<string> {
  const db = getAdminFirestore();
  const ref = id ? db.collection('chats').doc(id) : db.collection('chats').doc();
  await ref.set({
    isGroup: true,
    name,
    members: users.map((u) => u.uid),
    memberNames: Object.fromEntries(users.map((u) => [u.uid, u.displayName])),
    memberPhones: Object.fromEntries(users.map((u) => [u.uid, u.phone])),
    unreadCounts: Object.fromEntries(users.map((u) => [u.uid, 0])),
    lastMessage: '',
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/** Add a member exactly the way the membership fields are shaped in the app.
 *  The `members` change fires `syncChatLanguageTargets` (shouldRecomputeChatTargets). */
export async function addGroupMember(chatId: string, user: AuthenticatedUser): Promise<void> {
  await getAdminFirestore().doc(`chats/${chatId}`).update({
    members: admin.firestore.FieldValue.arrayUnion(user.uid),
    [`memberNames.${user.uid}`]: user.displayName,
    [`memberPhones.${user.uid}`]: user.phone,
    [`unreadCounts.${user.uid}`]: 0,
  });
}

/** Delete a chat's messages and the chat doc. */
export async function deleteChat(chatId: string | null | undefined): Promise<void> {
  if (!chatId) return;
  const db = getAdminFirestore();
  for (;;) {
    const snap = await db.collection(`chats/${chatId}/messages`).limit(400).get();
    if (snap.empty) break;
    const batch = db.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
  await db.doc(`chats/${chatId}`).delete().catch(() => {});
}

// ─── Browser helpers ────────────────────────────────────────────────────────

// Locale-independent: the composer's placeholder is in the USER's UI language
// (a Mandarin-native user sees "用 中文 或 英语 输入…"), so match the row, not the label.
export const composerOf = (page: Page) => page.getByTestId('message-input-row').getByRole('textbox');

export async function openChat(page: Page, chatId: string): Promise<void> {
  await page.goto(`/chat/${encodeURIComponent(chatId)}`);
  await page.waitForLoadState('domcontentloaded');
  await expect(composerOf(page)).toBeVisible({ timeout: 30_000 });
  await waitForNoSpinners(page, SPINNER_GONE_TIMEOUT_MS);
}

/** Type + send via the Send button (COMP-SEND-1). `fill` rather than
 *  per-key typing so CJK text goes in intact. */
export async function sendText(page: Page, text: string): Promise<void> {
  const input = composerOf(page);
  await input.click();
  await input.fill(text);
  await sendComposer(input, { enabledTimeout: 90_000 });
}

export const bubbleOf = (page: Page, messageId: string) =>
  page.locator(`[data-message-id="${messageId}"]`);

/** The visible text of a message's NATIVE row on this page, once rendered. */
export async function nativeRowText(page: Page, messageId: string, timeoutMs = 60_000): Promise<string> {
  const row = bubbleOf(page, messageId).getByTestId('bubble-native-row').first();
  await expect(row).toBeVisible({ timeout: timeoutMs });
  return (await row.innerText()).trim();
}

/** Nothing on the page claims to still be translating: neither the in-bubble
 *  shimmer label nor the status chip beneath a bubble (the indicator has two
 *  homes — see mis-detected-never-stuck.spec.ts). */
export async function expectNothingTranslating(page: Page, timeoutMs = 60_000): Promise<void> {
  await expect(page.getByText(/Translating/)).toHaveCount(0, { timeout: timeoutMs });
  await expect(page.getByTestId('MessageStatusTranslating')).toHaveCount(0, { timeout: timeoutMs });
}

/** Records every `chatTranslationsBackfill` answer this page receives. The
 *  server answers `{ ok, processed, total }` (index.ts, chatTranslationsBackfill). */
export function recordBackfillResponses(page: Page): Array<{ status: number; processed: number | null }> {
  const seen: Array<{ status: number; processed: number | null }> = [];
  page.on('response', (res: Response) => {
    if (!res.url().includes('chatTranslationsBackfill')) return;
    void res
      .json()
      .then((body: { processed?: unknown }) => {
        seen.push({ status: res.status(), processed: typeof body?.processed === 'number' ? body.processed : null });
      })
      .catch(() => seen.push({ status: res.status(), processed: null }));
  });
  return seen;
}
