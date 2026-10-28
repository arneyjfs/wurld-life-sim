import { describe, expect, it, vi } from 'vitest';

vi.mock('./config', () => ({
  config: {
    env: 'dev',
    firebase: { apiKey: 'k', authDomain: 'a', projectId: 'p', storageBucket: 's', messagingSenderId: 'm', appId: 'app' },
    functionsUrl: 'https://us-central1-test.cloudfunctions.net',
  },
}));
vi.mock('./firebase', () => ({ firebaseApp: {}, auth: { currentUser: null } }));
vi.mock('firebase/functions', () => ({
  getFunctions: () => ({}),
  httpsCallable: () => async () => ({ data: { audioContent: '' } }),
}));

describe('audioContentToBlobUrl', () => {
  it('decodes base64 MP3 into a Blob URL with audio/mpeg', async () => {
    const { audioContentToBlobUrl } = await import('./tts');
    // Stub URL.createObjectURL — happy-dom doesn't ship a real one by default.
    const created: Blob[] = [];
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => {
      created.push(b);
      return 'blob:test';
    };
    try {
      // base64 of "abc" => "YWJj"
      const url = audioContentToBlobUrl('YWJj');
      expect(url).toBe('blob:test');
      expect(created).toHaveLength(1);
      expect(created[0]!.type).toBe('audio/mpeg');
      expect(created[0]!.size).toBe(3);
    } finally {
      URL.createObjectURL = origCreate;
    }
  });

  it('honours an explicit mimeType for the blob', async () => {
    const { audioContentToBlobUrl } = await import('./tts');
    const created: Blob[] = [];
    const orig = URL.createObjectURL;
    URL.createObjectURL = (b: Blob) => {
      created.push(b);
      return 'blob:test';
    };
    try {
      audioContentToBlobUrl('YWJj', 'audio/wav');
      expect(created[0]!.type).toBe('audio/wav');
    } finally {
      URL.createObjectURL = orig;
    }
  });
});

describe('TTS-CACHE-1 — cacheKey', () => {
  it('keys by (languageCode, voice, speechSpeed, text) — no per-surface mode term (DEAD-14)', async () => {
    const { cacheKey } = await import('./tts');
    const key = cacheKey({ text: 'bonjour', languageCode: 'fr-FR', voiceGender: 'FEMALE' });
    // The retired `preload` split (`::natural::` / `::learner::`) is gone: a
    // clip pre-warmed by practice serves an on-demand tap of the same text.
    expect(key).toBe('fr-FR::FEMALE::3::bonjour');
    expect(key).not.toMatch(/::(natural|learner)::/);
  });

  it('folds speechSpeed into the key on EVERY surface (TTS-SPEED-1)', async () => {
    const { cacheKey } = await import('./tts');
    const base = { text: 'hi', languageCode: 'en-US' };
    // speechSpeed varies the audio everywhere now → distinct keys, on-demand...
    expect(cacheKey({ ...base, speechSpeed: 1 })).not.toBe(
      cacheKey({ ...base, speechSpeed: 4 }),
    );
    // ...and with an explicit voice.
    expect(cacheKey({ ...base, speechSpeed: 1, voiceGender: 'MALE' })).not.toBe(
      cacheKey({ ...base, speechSpeed: 4, voiceGender: 'MALE' }),
    );
    // Unset speed defaults to 3 (natural) so undefined and 3 share a clip.
    expect(cacheKey({ ...base })).toBe(cacheKey({ ...base, speechSpeed: 3 }));
  });

  it('separates by voice gender and language', async () => {
    const { cacheKey } = await import('./tts');
    const a = cacheKey({ text: 'x', languageCode: 'fr-FR', voiceGender: 'MALE' });
    const b = cacheKey({ text: 'x', languageCode: 'fr-FR', voiceGender: 'FEMALE' });
    const c = cacheKey({ text: 'x', languageCode: 'es-ES', voiceGender: 'MALE' });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });
});

/**
 * TTS-CACHE-4 — a prefetch already IN FLIGHT is not re-issued.
 *
 * `prefetchTTS` skipped only what was already CACHED, so two calls for the same
 * clip before the first resolves both hit the paid endpoint. The rolling
 * practice window hid how much that mattered — it re-prefetched the same three
 * questions on every advance — and `TTS-PREWARM-1` widening that window to
 * "every listen question as soon as it is generated" makes the effect re-run on
 * every streamed arrival, which would multiply it.
 */
describe('TTS-CACHE-4 — prefetchTTS de-duplicates in-flight requests', () => {
  const req = (text: string) => ({
    text, languageCode: 'fr-FR', speechSpeed: 3,
    voiceGender: 'FEMALE' as const,
  });

  it('issues ONE call when the same clip is asked for twice before it lands', async () => {
    vi.resetModules();
    const calls: unknown[] = [];
    vi.doMock('./endpoints', () => ({
      callHttp: async (...a: unknown[]) => {
        calls.push(a);
        await new Promise((r) => setTimeout(r, 20));
        return { audioContent: 'YWJj', mimeType: 'audio/mpeg' };
      },
    }));
    const { prefetchTTS } = await import('./tts');
    prefetchTTS(req('Bonjour'));
    prefetchTTS(req('Bonjour'));
    prefetchTTS(req('Bonjour'));
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(1);
  });

  it('still issues a SECOND call for a different clip', async () => {
    vi.resetModules();
    const calls: unknown[] = [];
    vi.doMock('./endpoints', () => ({
      callHttp: async (...a: unknown[]) => {
        calls.push(a);
        await new Promise((r) => setTimeout(r, 20));
        return { audioContent: 'YWJj', mimeType: 'audio/mpeg' };
      },
    }));
    const { prefetchTTS } = await import('./tts');
    prefetchTTS(req('Bonjour'));
    prefetchTTS(req('Bonsoir'));
    await new Promise((r) => setTimeout(r, 60));
    expect(calls).toHaveLength(2);
  });

  it('a FAILED prefetch clears its in-flight slot, so a retry can happen', async () => {
    // The trap in an in-flight set: never clearing on rejection would make one
    // transient failure permanent for the session.
    vi.resetModules();
    let n = 0;
    vi.doMock('./endpoints', () => ({
      callHttp: async () => {
        n += 1;
        throw new Error('boom');
      },
    }));
    const { prefetchTTS } = await import('./tts');
    prefetchTTS(req('Bonjour'));
    await new Promise((r) => setTimeout(r, 20));
    prefetchTTS(req('Bonjour'));
    await new Promise((r) => setTimeout(r, 20));
    expect(n).toBe(2);
  });
});

/**
 * TTS-CACHE-4 (playback half) — autoplay WAITS for the prewarm already in the
 * air rather than racing it with a second synthesis.
 *
 * Owner, 2026-08-07: *"it starts playing as soon as the TTS lands."* The
 * prewarm fires when the question is generated and the card mounts a moment
 * later, so the mount lands INSIDE the synthesis window nearly every time —
 * exactly where the cache is still empty and a naive `playTTS` starts its own
 * paid call beside the one already running.
 */
describe('TTS-CACHE-4 — playTTS joins an in-flight prefetch', () => {
  const req = { text: 'Salut', languageCode: 'fr-FR', speechSpeed: 3, voiceGender: 'FEMALE' as const };

  it('does NOT start a second synthesis for a clip already being prewarmed', async () => {
    vi.resetModules();
    let n = 0;
    vi.doMock('./endpoints', () => ({
      callHttp: async () => {
        n += 1;
        await new Promise((r) => setTimeout(r, 30));
        return { audioContent: 'YWJj', mimeType: 'audio/mpeg' };
      },
    }));
    const orig = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:test';
    try {
      const { prefetchTTS, playTTS } = await import('./tts');
      prefetchTTS(req);
      // Mount happens while the prewarm is still in the air.
      await playTTS(req, { key: 'q1' }).catch(() => {});
      expect(n).toBe(1);
    } finally {
      URL.createObjectURL = orig;
    }
  });

  /**
   * The stale-call guard used to be `currentKey !== opts.key`, which cannot
   * tell two calls for the SAME key apart — and the toggle guard above it
   * needs `currentAudio` to already exist, which it does not during synthesis.
   * So both calls ran to completion and both constructed an `Audio`. The first
   * was orphaned the instant the second assigned `currentAudio`, leaving a clip
   * that `stopPlayback()` / `nextQuestion()` / unmount could no longer reach.
   *
   * Reachable on every listen question: `TTSButton`'s autoplay effect depends
   * on `speechSpeed`, which flips when the async profile resolves — mid
   * synthesis on a cold open. On a listen question the audio IS the question,
   * so two overlapping clips make it unanswerable.
   */
  it('TTS-CACHE-4 — two concurrent calls for the SAME key leave exactly one Audio playing', async () => {
    vi.resetModules();
    vi.doMock('./endpoints', () => ({
      callHttp: async () => {
        await new Promise((r) => setTimeout(r, 30));
        return { audioContent: 'YWJj', mimeType: 'audio/mpeg' };
      },
    }));
    const origCreate = URL.createObjectURL;
    URL.createObjectURL = () => 'blob:test';

    // Record every Audio built, and whether it was asked to play.
    const built: Array<{ played: boolean; paused: boolean }> = [];
    const OrigAudio = globalThis.Audio;
    class FakeAudio {
      paused = true;
      src = '';
      private readonly rec: { played: boolean; paused: boolean };
      constructor() {
        this.rec = { played: false, paused: true };
        built.push(this.rec);
      }
      addEventListener(): void {}
      removeEventListener(): void {}
      play(): Promise<void> {
        this.paused = false;
        this.rec.played = true;
        this.rec.paused = false;
        return Promise.resolve();
      }
      pause(): void {
        this.paused = true;
        this.rec.paused = true;
      }
    }
    globalThis.Audio = FakeAudio as unknown as typeof Audio;

    try {
      const { playTTS, stopPlayback } = await import('./tts');
      // Two calls for the SAME key, both entering while the cache is empty —
      // the autoplay-effect-refires window.
      const a = playTTS({ ...req }, { key: 'q1' }).catch(() => {});
      const b = playTTS({ ...req }, { key: 'q1' }).catch(() => {});
      await Promise.all([a, b]);

      const playing = built.filter((x) => x.played && !x.paused);
      expect(playing.length, 'exactly one clip may be playing for one key').toBe(1);

      // And the survivor must still be reachable — an orphan is worse than a
      // duplicate, because nothing can stop it.
      stopPlayback();
      expect(
        built.filter((x) => x.played && !x.paused),
        'stopPlayback() must silence every clip it started',
      ).toEqual([]);
    } finally {
      URL.createObjectURL = origCreate;
      globalThis.Audio = OrigAudio;
    }
  });
});

/**
 * DEAD-14 (2026-09-29) — the TTS request carries no legacy hints.
 *
 * The server no longer reads `difficulty` or `preload` (pace comes from
 * `speechSpeed`, TTS-SPEED-1; every surface is flash-primary, TTS-ENGINE-2),
 * so the client stops sending them. This pins the wire shape so neither field
 * creeps back in through a "harmless" spread.
 */
describe('DEAD-14 — synthesizeSpeech request body has no difficulty / preload', () => {
  it('sends exactly text + languageCode + speed + voice fields', async () => {
    vi.resetModules();
    const bodies: Array<Record<string, unknown>> = [];
    vi.doMock('./endpoints', () => ({
      callHttp: async (_name: string, body: Record<string, unknown>) => {
        bodies.push(body);
        return { audioContent: 'YWJj', mimeType: 'audio/mpeg' };
      },
    }));
    const { synthesizeSpeech } = await import('./tts');
    await synthesizeSpeech({
      text: 'Bonjour', languageCode: 'fr-FR', speechSpeed: 2, voiceGender: 'FEMALE', voiceName: 'Kore',
    });
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).not.toHaveProperty('difficulty');
    expect(bodies[0]).not.toHaveProperty('preload');
    expect(Object.keys(bodies[0]!).sort()).toEqual(
      ['languageCode', 'speechSpeed', 'text', 'voiceGender', 'voiceName'],
    );
  });
});
