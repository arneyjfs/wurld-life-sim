import { describe, expect, it, vi } from 'vitest';
import {
  PUSH_PREVIEW_MAX,
  previewsFromDelivered,
  pushPreviewsFromPayload,
  absenceAtTap,
  probeThenRebuild,
  pushTapReconnect,
} from './pushPreview';

const tapped = {
  type: 'new_message',
  chatId: 'c1',
  messageId: 'm3',
  senderId: 'u2',
  senderName: 'Ana in Trip',
  senderDisplayName: 'Ana',
  body: 'Hola',
};

describe('NOTIF-17.1 — pushPreviewsFromPayload', () => {
  it('NOTIF-17.1 — the tapped push becomes a preview, sender alone as the name', () => {
    expect(pushPreviewsFromPayload(tapped)).toEqual({
      chatId: 'c1',
      previews: [{ messageId: 'm3', senderId: 'u2', senderName: 'Ana', body: 'Hola' }],
    });
  });

  it('NOTIF-17.1 — an Android/web previews list (JSON string or array) comes first, deduped, tapped last', () => {
    const list = [
      { messageId: 'm1', senderId: 'u2', senderName: 'Ana', body: 'uno' },
      { messageId: 'm3', senderId: 'u2', senderName: 'Ana', body: 'Hola' },
    ];
    const fromString = pushPreviewsFromPayload({ ...tapped, previews: JSON.stringify(list) });
    const fromArray = pushPreviewsFromPayload({ ...tapped, previews: list });
    expect(fromString.previews.map((p) => p.messageId)).toEqual(['m1', 'm3']);
    expect(fromArray).toEqual(fromString);
  });

  it('NOTIF-17.1 — a preview needs a message id and a body; junk is ignored, never thrown', () => {
    expect(pushPreviewsFromPayload({ chatId: 'c1', body: 'no id' }).previews).toEqual([]);
    expect(pushPreviewsFromPayload({ chatId: 'c1', messageId: 'm1' }).previews).toEqual([]);
    expect(pushPreviewsFromPayload({ chatId: 'c1', previews: '{not json' }).previews).toEqual([]);
    expect(pushPreviewsFromPayload({ chatId: 'c1', previews: [null, 3, { messageId: 'x' }] }).previews).toEqual([]);
    expect(pushPreviewsFromPayload(undefined)).toEqual({ chatId: null, previews: [] });
    expect(pushPreviewsFromPayload({ ...tapped, type: 'clear_chat' }).previews).toEqual([]);
  });

  it('NOTIF-17.1 — at most PUSH_PREVIEW_MAX, the newest kept', () => {
    const list = Array.from({ length: PUSH_PREVIEW_MAX + 4 }, (_, i) => ({ messageId: `e${i}`, body: `b${i}` }));
    const out = pushPreviewsFromPayload({ ...tapped, previews: list }).previews;
    expect(out).toHaveLength(PUSH_PREVIEW_MAX);
    expect(out.at(-1)!.messageId).toBe('m3');
  });
});

describe('NOTIF-17.1 — previewsFromDelivered (iOS)', () => {
  it('NOTIF-17.1 — keeps the delivered pushes of this chat only', () => {
    const delivered = [
      { data: { ...tapped, messageId: 'm1', body: 'uno' } },
      { data: { ...tapped, chatId: 'other', messageId: 'z', body: 'no' } },
      { data: { ...tapped, messageId: 'm2', body: 'dos' } },
      { data: undefined },
    ];
    expect(previewsFromDelivered(delivered, 'c1').map((p) => p.messageId)).toEqual(['m1', 'm2']);
  });
});

describe('NOTIF-17.7 — the bubble data rides on each preview', () => {
  const bubble = {
    o: 'Hello',
    ol: 'English',
    tr: { Spanish: { text: 'Hola' }, spanishAnnotatedEnglish: { text: 'Hola', complexWords: ['Hola'], wordTranslations: { Hola: 'Hi' } } },
    rt: { id: 'm0', senderName: 'Ana', text: 'Hi' },
  };
  it('NOTIF-17.7 — sentAtMs and the bubble (JSON string or object) are parsed', () => {
    const [p] = pushPreviewsFromPayload({ ...tapped, sentAtMs: '1700', bubble: JSON.stringify(bubble) }).previews;
    expect(p!.sentAtMs).toBe(1700);
    expect(p!.bubble).toEqual({
      originalText: 'Hello',
      originalLanguage: 'English',
      translations: bubble.tr,
      replyTo: { id: 'm0', senderName: 'Ana', text: 'Hi' },
    });
    const [q] = pushPreviewsFromPayload({ ...tapped, previews: [{ ...tapped, messageId: 'm1', bubble }] }).previews;
    expect(q!.bubble?.translations).toEqual(bubble.tr);
  });
  it('NOTIF-17.7 — a bad bubble or time is dropped, the preview kept', () => {
    const [p] = pushPreviewsFromPayload({ ...tapped, sentAtMs: 'soon', bubble: '{oops' }).previews;
    expect(p).toEqual({ messageId: 'm3', senderId: 'u2', senderName: 'Ana', body: 'Hola' });
    const [q] = pushPreviewsFromPayload({ ...tapped, bubble: { o: 'x', tr: { Spanish: { nope: 1 } } } }).previews;
    expect(q!.bubble?.translations).toEqual({});
  });
});

describe('NOTIF-17.8 — previews keep send order', () => {
  it('NOTIF-17.8 — previews with a send time are sorted by it', () => {
    const list = [
      { messageId: 'b', body: 'b', sentAtMs: '20' },
      { messageId: 'a', body: 'a', sentAtMs: '10' },
    ];
    const out = pushPreviewsFromPayload({ ...tapped, sentAtMs: '15', previews: list }).previews;
    expect(out.map((p) => p.messageId)).toEqual(['a', 'm3', 'b']);
  });
  it('NOTIF-17.8 — previews without one keep their place', () => {
    const list = [
      { messageId: 'b', body: 'b', sentAtMs: '20' },
      { messageId: 'x', body: 'x' },
      { messageId: 'a', body: 'a', sentAtMs: '10' },
    ];
    const out = pushPreviewsFromPayload({ ...tapped, previews: list }).previews;
    expect(out.map((p) => p.messageId)).toEqual(['a', 'x', 'b', 'm3']);
  });
  it('NOTIF-17.8 — the newest by send time survive the cap', () => {
    const list = Array.from({ length: PUSH_PREVIEW_MAX + 2 }, (_, i) => ({ messageId: `e${i}`, body: 'b', sentAtMs: String(100 - i) }));
    const out = pushPreviewsFromPayload({ ...tapped, sentAtMs: '1000', previews: list }).previews;
    expect(out).toHaveLength(PUSH_PREVIEW_MAX);
    expect(out.map((p) => p.messageId)).not.toContain(`e${PUSH_PREVIEW_MAX + 1}`);
    expect(out.at(-1)!.messageId).toBe('m3');
  });
});

describe('NOTIF-17.4 — absenceAtTap', () => {
  const now = 1_000_000;
  it('NOTIF-17.4 — still hidden: the time since it was hidden', () => {
    expect(absenceAtTap({ hiddenSinceMs: now - 30_000, lastHiddenSpanMs: 0, lastShownAtMs: 0, nowMs: now })).toBe(30_000);
  });
  it('NOTIF-17.4 — just came back: the absence that just ended', () => {
    expect(absenceAtTap({ hiddenSinceMs: 0, lastHiddenSpanMs: 120_000, lastShownAtMs: now - 2_000, nowMs: now })).toBe(120_000);
  });
  it('NOTIF-17.4 — back a while ago, or never away: no absence', () => {
    expect(absenceAtTap({ hiddenSinceMs: 0, lastHiddenSpanMs: 120_000, lastShownAtMs: now - 60_000, nowMs: now })).toBe(0);
    expect(absenceAtTap({ hiddenSinceMs: 0, lastHiddenSpanMs: 0, lastShownAtMs: 0, nowMs: now })).toBe(0);
  });
});

describe('NOTIF-17.5 — pushTapReconnect', () => {
  it('NOTIF-17.5 — under 5 s nothing is touched, on any runtime', () => {
    expect(pushTapReconnect(4_999, true)).toBe('none');
    expect(pushTapReconnect(4_999, false)).toBe('none');
  });
  it('NOTIF-17.5 — a runtime that suspends rebuilds at once from 5 s, without a probe', () => {
    expect(pushTapReconnect(5_000, true)).toBe('nudge');
    expect(pushTapReconnect(29_999, true)).toBe('nudge');
    expect(pushTapReconnect(5 * 3_600_000, true)).toBe('nudge');
  });
  it('NOTIF-17.5 — every other runtime probes at any absence of 5 s or more', () => {
    expect(pushTapReconnect(5_000, false)).toBe('probe');
    expect(pushTapReconnect(5 * 3_600_000, false)).toBe('probe');
  });
});

describe('NOTIF-17.5 — probeThenRebuild', () => {
  it('NOTIF-17.5 — an answer within the window keeps the stream', async () => {
    const rebuild = vi.fn(async () => {});
    const r = await probeThenRebuild(async () => {}, rebuild, 500);
    expect(r.rebuilt).toBe(false);
    expect(rebuild).not.toHaveBeenCalled();
  });
  it('NOTIF-17.5 — no answer within the window rebuilds', async () => {
    vi.useFakeTimers();
    try {
      const rebuild = vi.fn(async () => {});
      const p = probeThenRebuild(() => new Promise(() => {}), rebuild, 500);
      await vi.advanceTimersByTimeAsync(499);
      expect(rebuild).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      const r = await p;
      expect(r.rebuilt).toBe(true);
      expect(rebuild).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
  it('NOTIF-17.5 — a failed probe rebuilds', async () => {
    const rebuild = vi.fn(async () => {});
    const r = await probeThenRebuild(async () => { throw new Error('offline'); }, rebuild, 500);
    expect(r.rebuilt).toBe(true);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });
});
