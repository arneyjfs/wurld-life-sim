/**
 * NOTIF-17 (docs/specs/notifications.md) — the text a tapped push carries,
 * shown in the chat at once while Firestore catches up. Pure parsing and
 * decisions only; the store is `store/pushPreviewStore.ts`, the tap wiring
 * `notifications/routing.ts`.
 */

import { ZReplyTo, ZTranslationData, type Message } from '@/types/firestore';

/** NOTIF-17.7 — the message as the reader's bubble will show it. */
export type PushBubble = Pick<Message, 'originalText' | 'originalLanguage' | 'translations' | 'replyTo'>;

export type PushPreview = {
  messageId: string;
  senderId: string;
  senderName: string;
  body: string;
  /** NOTIF-17.7 / 17.8 — the message's send time, epoch ms. */
  sentAtMs?: number;
  bubble?: PushBubble;
};

/** NOTIF-17.1 — previews kept per chat (the newest). */
export const PUSH_PREVIEW_MAX = 10;
/** NOTIF-17.3 — while online, a chat's previews expire this long after the tap. */
export const PUSH_PREVIEW_TTL_MS = 30_000;
/** NOTIF-17.10 — the loading row's collapse. */
export const PUSH_PREVIEW_PILL_FADE_MS = 200;
/** NOTIF-17.5 — an absence at least this long gets the connection checked,
 *  or rebuilt at once on a runtime that suspends in the background. */
export const PUSH_TAP_PROBE_FROM_MS = 5_000;
/** NOTIF-17.5 — how long the probe waits for the server before a rebuild. */
export const PUSH_TAP_PROBE_MS = 500;
/** NOTIF-17.4 — "just came back": the absence ended at most this long ago. */
const PUSH_TAP_RECENT_RETURN_MS = 10_000;

type Record_ = Record<string, unknown>;

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function asRecord(v: unknown): Record_ | null {
  return typeof v === 'object' && v !== null ? (v as Record_) : null;
}

/** One preview from a push's data (or a previews-list entry); null when it
 *  lacks a message id or a body. */
function previewOf(raw: unknown): PushPreview | null {
  const d = asRecord(raw);
  if (!d) return null;
  const messageId = str(d.messageId);
  const body = str(d.body);
  if (!messageId || !body) return null;
  const p: PushPreview = {
    messageId,
    senderId: str(d.senderId),
    // NOTIF-14.3 — `senderDisplayName` is the sender alone; `senderName` is the
    // notification title ("Ana in Trip") on a push, the sender on a list entry.
    senderName: str(d.senderDisplayName) || str(d.senderName),
    body,
  };
  const sentAtMs = sentAtOf(d.sentAtMs);
  if (sentAtMs != null) p.sentAtMs = sentAtMs;
  const bubble = bubbleOf(d.bubble);
  if (bubble) p.bubble = bubble;
  return p;
}

function jsonRecord(raw: unknown): Record_ | null {
  if (typeof raw !== 'string') return asRecord(raw);
  try {
    return asRecord(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** NOTIF-17.7 — the push's `bubble` (a JSON string, or the object a list
 *  entry already holds); rows that do not parse are left out. */
function bubbleOf(raw: unknown): PushBubble | null {
  const b = jsonRecord(raw);
  if (!b) return null;
  const translations: PushBubble['translations'] = {};
  for (const [key, row] of Object.entries(asRecord(b.tr) ?? {})) {
    const parsed = ZTranslationData.safeParse(row);
    if (parsed.success) translations[key] = parsed.data;
  }
  const replyTo = ZReplyTo.safeParse(b.rt);
  return {
    originalText: typeof b.o === 'string' ? b.o : '',
    originalLanguage: typeof b.ol === 'string' ? b.ol : '',
    translations,
    ...(replyTo.success ? { replyTo: replyTo.data } : {}),
  };
}

function sentAtOf(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(str(raw) || NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function listOf(raw: unknown): unknown[] {
  if (Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** NOTIF-17.8 — the previews that carry a send time are sorted by it, in
 *  the slots they already hold; the rest keep their place. */
function inSendOrder(list: PushPreview[]): PushPreview[] {
  const slots = list.flatMap((p, i) => (p.sentAtMs != null ? [i] : []));
  const timed = slots.map((i) => list[i]!).sort((a, b) => a.sentAtMs! - b.sentAtMs!);
  const out = [...list];
  slots.forEach((slot, k) => {
    out[slot] = timed[k]!;
  });
  return out;
}

/** Dedupe by message id (a later copy moves to the end), put in send order,
 *  keep the newest MAX. */
export function mergePreviews(...lists: PushPreview[][]): PushPreview[] {
  const byId = new Map<string, PushPreview>();
  for (const list of lists) {
    for (const p of list) {
      byId.delete(p.messageId);
      byId.set(p.messageId, p);
    }
  }
  return inSendOrder([...byId.values()]).slice(-PUSH_PREVIEW_MAX);
}

/**
 * NOTIF-17.1 — a tapped push's data → its chat and previews: the chat's
 * earlier pushes (`previews`, a JSON string from the Android intent or an
 * array from the web SW) first, then the tapped push itself.
 */
export function pushPreviewsFromPayload(data: unknown): { chatId: string | null; previews: PushPreview[] } {
  const d = asRecord(data);
  const chatId = str(d?.chatId) || null;
  if (!d || !chatId) return { chatId, previews: [] };
  const type = str(d.type);
  if (type && type !== 'new_message') return { chatId, previews: [] };
  const earlier = listOf(d.previews).map(previewOf).filter((p): p is PushPreview => p !== null);
  const self = previewOf(d);
  return { chatId, previews: mergePreviews(earlier, self ? [self] : []) };
}

/** NOTIF-17.1 (iOS) — the chat's other pushes still in Notification Centre. */
export function previewsFromDelivered(
  delivered: ReadonlyArray<{ data?: unknown }>,
  chatId: string,
): PushPreview[] {
  const out: PushPreview[] = [];
  for (const n of delivered) {
    const d = asRecord(n?.data);
    if (!d || str(d.chatId) !== chatId) continue;
    const type = str(d.type);
    if (type && type !== 'new_message') continue;
    const p = previewOf(d);
    if (p) out.push(p);
  }
  return out;
}

/**
 * NOTIF-17.4 — how long the page was away at the tap: still hidden, or back
 * within `PUSH_TAP_RECENT_RETURN_MS` from an absence (a tap usually brings
 * the page back just before the tap event lands). 0 otherwise.
 */
export function absenceAtTap(s: {
  hiddenSinceMs: number;
  lastHiddenSpanMs: number;
  lastShownAtMs: number;
  nowMs: number;
}): number {
  if (s.hiddenSinceMs > 0) return s.nowMs - s.hiddenSinceMs;
  if (!s.lastShownAtMs || s.nowMs - s.lastShownAtMs > PUSH_TAP_RECENT_RETURN_MS) return 0;
  return s.lastHiddenSpanMs;
}

export type PushTapReconnect = 'none' | 'probe' | 'nudge';

/** NOTIF-17.5 — leave the connection, check it, or rebuild it at once. */
export function pushTapReconnect(absenceMs: number, suspendsInBackground: boolean): PushTapReconnect {
  if (absenceMs < PUSH_TAP_PROBE_FROM_MS) return 'none';
  return suspendsInBackground ? 'nudge' : 'probe';
}

export type PushTapProbeResult = { rebuilt: boolean; probeMs: number };

/**
 * NOTIF-17.5 — keep the stream when `probe` answers within `timeoutMs`;
 * otherwise (no answer, or an error) `rebuild` it. Resolves after the rebuild.
 */
export async function probeThenRebuild(
  probe: () => Promise<unknown>,
  rebuild: () => Promise<void>,
  timeoutMs: number,
): Promise<PushTapProbeResult> {
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = await Promise.race([
    probe().then(() => true, () => false),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), timeoutMs); }),
  ]);
  clearTimeout(timer);
  const probeMs = Date.now() - startedAt;
  if (alive) return { rebuilt: false, probeMs };
  await rebuild();
  return { rebuilt: true, probeMs };
}
