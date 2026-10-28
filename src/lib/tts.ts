import { callHttp } from './endpoints';
import * as log from './log';

type SynthesizeRequest = {
  /** Raw text to read. Server clips defensively. */
  text: string;
  /** BCP-47 code. Resolve via `languages.ts:getSpeechLanguageCode`. */
  languageCode: string;
  /** TTS playback speed 1-5 (TTS-SPEED-1), independent of difficulty; 3 =
   *  natural. Drives pacing on EVERY surface. Defaults to 3 when unset. */
  speechSpeed?: number;
  /** Voice — derived from the user's `voicePreference` (TTS-PREF-1). */
  voiceGender?: 'MALE' | 'FEMALE';
  /** TTS-VOICE-2: an explicit Gemini voice for THIS SPEAKER, chosen from the
   *  character's own gender rather than the player's preference. The server
   *  validates it against its allowlist and falls back to `voiceGender` on
   *  anything it does not recognise (TTS-VOICE-3). */
  voiceName?: string;
};

type SynthesizeResponse = {
  audioContent: string; // base64-encoded audio
  /** Container mime for the blob (defaults to audio/mpeg). */
  mimeType?: string;
  /** Which Gemini model actually served the request (telemetry). */
  model?: string;
  cached?: boolean;
};

/**
 * Synthesize speech via the `synthesizeSpeech` Cloud Function. Returns a
 * base64 MP3 + cache flag. Caller is responsible for playback; see the
 * `playTTS` helper for a ready-to-use one-shot player.
 *
 * Field names match the source app's request shape
 * (services/tts.ts:401) — `languageCode` not `language`,
 * `voiceGender` not `gender`.
 */
export async function synthesizeSpeech(
  request: SynthesizeRequest,
): Promise<SynthesizeResponse> {
  const safeRequest: SynthesizeRequest = {
    ...request,
    text: request.text.slice(0, 5000),
  };
  // onRequest HTTP function (NOT onCall) — see endpoints.ts history note.
  return callHttp<SynthesizeRequest, SynthesizeResponse>(
    'synthesizeSpeech',
    safeRequest,
  );
}

/** Convert a base64 audio payload to a Blob URL ready for <audio src>. */
export function audioContentToBlobUrl(
  audioContent: string,
  mimeType = 'audio/mpeg',
): string {
  const binary = atob(audioContent);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes.buffer], { type: mimeType });
  return URL.createObjectURL(blob);
}

/**
 * One-shot speech playback. Keyed cache lets repeated reads of the same
 * text return instantly. A module-singleton audio element is used so a
 * second `playTTS` call cancels the first (typical UX for tap-to-read).
 *
 * Returns an unsubscribe-ish object the caller can use to stop early.
 */
type CacheEntry = { blobUrl: string };
const ttsCache = new Map<string, CacheEntry>();
let currentAudio: HTMLAudioElement | null = null;
let currentKey: string | null = null;

/**
 * TTS-CACHE-4 — which `playTTS` call is still the live one.
 *
 * `currentKey` cannot answer that. It identifies the CLIP, so two calls for
 * the SAME key are indistinguishable to it — and the post-await guards were
 * written as `currentKey !== opts.key`, which both such calls pass. The toggle
 * guard does not catch it either: it requires `currentAudio` to already exist,
 * and during synthesis it is null (`stopPlayback()` cleared it), so the whole
 * synthesis window is unguarded.
 *
 * Both then construct an `Audio` and play. The first is orphaned the moment
 * the second assigns `currentAudio`, so `stopPlayback()`, `nextQuestion()` and
 * unmount can only reach the second: two clips play at once and one of them
 * cannot be stopped. On a listen question the audio IS the question, so that
 * makes it unanswerable.
 *
 * A monotonic token fixes what a key cannot: every call takes a number, and
 * only the newest may proceed past an await.
 */
let playSeq = 0;
type PlaybackListener = (state: PlaybackState) => void;
const listeners = new Set<PlaybackListener>();

export type PlaybackState = {
  status: 'idle' | 'loading' | 'playing' | 'error';
  /** Per-call key the caller passed (e.g. messageId), so multiple consumers
   *  can tell which one is currently active. */
  key: string | null;
  /** Playback progress 0–1 while `playing` (drives the button progress
   *  ring, TTS-CACHE-4). 0 when not playing. */
  progress: number;
};

let lastState: PlaybackState = { status: 'idle', key: null, progress: 0 };

function emit(state: PlaybackState): void {
  lastState = state;
  listeners.forEach((fn) => fn(state));
}

export function subscribePlayback(fn: PlaybackListener): () => void {
  listeners.add(fn);
  fn(lastState);
  return () => listeners.delete(fn);
}

export function stopPlayback(): void {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.src = '';
    currentAudio = null;
  }
  currentKey = null;
  emit({ status: 'idle', key: null, progress: 0 });
}

/**
 * Cache key (TTS-CACHE-1): `(languageCode, voice, speechSpeed, text)`.
 * `speechSpeed` varies the audio on EVERY surface (TTS-SPEED-1), so it's
 * always folded in (defaulting to 3 = natural). There is no per-surface
 * `mode` term any more (DEAD-14, 2026-09-29): the server ignores which
 * surface asked (every call is flash-primary, TTS-ENGINE-2), so a clip
 * pre-warmed by practice serves an on-demand tap of the same text at the
 * same speed and voice.
 */
// Exported for unit tests (TTS-CACHE-1). Not part of the public API.
export function cacheKey(req: SynthesizeRequest): string {
  const speed = req.speechSpeed ?? 3;
  // TTS-VOICE-2: the VOICE is part of the key — two characters reading the
  // same line are two different clips. `speechSpeed` is in the key too (it
  // changes the audio) but is NOT part of choosing the voice: changing the
  // speed re-synthesises the same character at a new pace, it does not re-cast
  // them. Those are separate concerns and this is where they visibly part.
  const voice = req.voiceName || req.voiceGender || 'auto';
  return `${req.languageCode}::${voice}::${speed}::${req.text}`;
}

export async function playTTS(
  request: SynthesizeRequest,
  opts: { key: string; signal?: AbortSignal } = { key: 'tts' },
): Promise<void> {
  // If the user tapped the same key while it was already playing, treat
  // it as a stop-toggle.
  if (currentKey === opts.key && currentAudio && !currentAudio.paused) {
    stopPlayback();
    return;
  }
  stopPlayback();
  currentKey = opts.key;
  // Taken AFTER stopPlayback so a call can never invalidate itself.
  const seq = ++playSeq;
  const superseded = (): boolean => opts.signal?.aborted === true || seq !== playSeq;
  emit({ status: 'loading', key: opts.key, progress: 0 });

  let blobUrl: string;
  try {
    const key = cacheKey(request);
    // TTS-CACHE-4: a prewarm for THIS clip may already be in the air. Waiting
    // for it is the difference between "plays the moment the audio lands" and
    // starting a SECOND synthesis of the same line beside it — two paid calls
    // and the slower one wins about half the time. The autoplay path hits this
    // constantly: the question is prewarmed when it generates and the card
    // mounts a moment later, which is exactly the window.
    let cached = ttsCache.get(key);
    if (!cached) {
      const inFlight = ttsInFlight.get(key);
      if (inFlight) {
        await inFlight;
        if (superseded()) return;
        cached = ttsCache.get(key);
      }
    }
    if (cached) {
      blobUrl = cached.blobUrl;
    } else {
      const res = await synthesizeSpeech(request);
      if (superseded()) return;
      blobUrl = audioContentToBlobUrl(res.audioContent, res.mimeType);
      ttsCache.set(key, { blobUrl });
    }
  } catch (err) {
    log.error(err, { action: 'tts.synthesize' });
    emit({ status: 'error', key: opts.key, progress: 0 });
    currentKey = null;
    throw err;
  }

  if (superseded()) return;

  const audio = new Audio(blobUrl);
  currentAudio = audio;
  audio.addEventListener('ended', () => {
    if (currentAudio === audio) {
      currentAudio = null;
      currentKey = null;
      emit({ status: 'idle', key: null, progress: 0 });
    }
  });
  audio.addEventListener('error', () => {
    log.warn('tts.playback error');
    if (currentAudio === audio) {
      currentAudio = null;
      currentKey = null;
      emit({ status: 'error', key: opts.key, progress: 0 });
    }
  });
  // Progress for the button's progress ring (TTS-CACHE-4). `timeupdate`
  // fires ~4x/sec — cheap enough; we clamp to [0,1].
  audio.addEventListener('timeupdate', () => {
    if (currentAudio !== audio || currentKey !== opts.key) return;
    const dur = audio.duration;
    const progress = dur && Number.isFinite(dur) ? Math.min(1, Math.max(0, audio.currentTime / dur)) : 0;
    emit({ status: 'playing', key: opts.key, progress });
  });
  emit({ status: 'playing', key: opts.key, progress: 0 });
  try {
    await audio.play();
  } catch (err) {
    log.error(err, { action: 'tts.play' });
    if (currentAudio === audio) {
      currentAudio = null;
      currentKey = null;
      emit({ status: 'error', key: opts.key, progress: 0 });
    }
  }
}

/** Best-effort prefetch — fire and forget; lands the audio in the cache so
 *  the next `playTTS` for the same key is instant. */
/**
 * TTS-CACHE-4 — clips whose synthesis has been STARTED but has not landed yet.
 *
 * `ttsCache` only knows about finished clips, so two prefetches for the same
 * line inside the synthesis window both paid. That was survivable while the
 * practice prewarm was a 3-question rolling window; `TTS-PREWARM-1` widens it to
 * every listen question as soon as it is generated, so the effect re-runs on
 * every streamed arrival and the duplicates would multiply with the session.
 *
 * Cleared in `finally` — on FAILURE as much as on success. An in-flight set that
 * only cleared on success would turn one transient error into a clip that can
 * never be re-requested for the rest of the session.
 */
const ttsInFlight = new Map<string, Promise<void>>();

export function prefetchTTS(request: SynthesizeRequest): void {
  const key = cacheKey(request);
  if (ttsCache.has(key) || ttsInFlight.has(key)) return;
  const pending = synthesizeSpeech(request)
    .then((res) => {
      const blobUrl = audioContentToBlobUrl(res.audioContent, res.mimeType);
      ttsCache.set(key, { blobUrl });
    })
    .catch((err) => log.warn('tts.prefetch failed', { err }))
    .finally(() => ttsInFlight.delete(key));
  ttsInFlight.set(key, pending);
}
