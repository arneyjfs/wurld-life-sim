import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: {
    env: 'dev',
    firebase: {},
    functionsUrl: 'https://us-central1-test.cloudfunctions.net',
    sentryDsn: undefined,
  },
}));

vi.mock('./firebase', () => ({
  auth: { currentUser: { getIdToken: async () => 'tok' } },
}));

import { generateGemini, streamGemini } from './gemini';

beforeEach(() => {
  vi.unstubAllGlobals();
});

const rejectFetch = (thrown: unknown) => {
  vi.stubGlobal('fetch', vi.fn(async () => {
    throw thrown;
  }));
};

async function drain(gen: AsyncGenerator<string>): Promise<void> {
  for await (const _chunk of gen) {
    /* consume */
  }
}

describe('OBS-LABEL-8 — generateGemini wraps network failures', () => {
  it('OBS-LABEL-8 — a fetch TypeError becomes network/offline with functionName geminiGenerate', async () => {
    rejectFetch(new TypeError('Failed to fetch'));
    await expect(generateGemini({ prompt: 'x' })).rejects.toMatchObject({
      code: 'network/offline',
      functionName: 'geminiGenerate',
    });
  });

  it('OBS-LABEL-8 — the 45 s abort becomes network/timeout with functionName geminiGenerate', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })));
      const p = generateGemini({ prompt: 'x' });
      const assertion = expect(p).rejects.toMatchObject({ code: 'network/timeout', functionName: 'geminiGenerate' });
      await vi.advanceTimersByTimeAsync(45_000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it('OBS-LABEL-7 — a non-OK response carries functionName and httpStatus', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, url: '', text: async () => '' })));
    await expect(generateGemini({ prompt: 'x' })).rejects.toMatchObject({
      code: 'pipeline/failed',
      functionName: 'geminiGenerate',
      httpStatus: 503,
    });
  });
});

describe('OBS-LABEL-8 — streamGemini wraps network failures', () => {
  it('OBS-LABEL-8 — a fetch TypeError becomes network/offline with functionName geminiStreamV2', async () => {
    rejectFetch(new TypeError('Load failed'));
    await expect(drain(streamGemini({ prompt: 'x' }))).rejects.toMatchObject({
      code: 'network/offline',
      functionName: 'geminiStreamV2',
    });
  });

  it('OBS-LABEL-8 — an abort becomes network/timeout and keeps the AbortError name', async () => {
    rejectFetch(new DOMException('aborted', 'AbortError'));
    await expect(drain(streamGemini({ prompt: 'x' }))).rejects.toMatchObject({
      code: 'network/timeout',
      functionName: 'geminiStreamV2',
      name: 'AbortError',
    });
  });
});
