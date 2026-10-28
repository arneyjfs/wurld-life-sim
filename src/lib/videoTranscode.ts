/**
 * Client-side video transcode for sending — docs/specs/video-messages.md
 * §1–§4 (VID-PICK-1, VID-LIMIT-1, VID-ENC-1..4, VID-TRIM-1, VID-POSTER-1).
 *
 * Built on `mediabunny` (WebCodecs). This module statically imports
 * mediabunny, so it MUST only ever be reached through a dynamic `import()`
 * (see `canTranscodeVideo()` in `@/lib/capabilities`) — never a static import
 * from main-bundle code — to keep mediabunny in its own lazy chunk.
 */

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSink,
  EncodedPacketSink,
  Conversion,
  ConversionCanceledError,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type InputVideoTrack,
  type WrappedCanvas,
  type VideoCodec,
} from 'mediabunny';
import { config } from '@/lib/config';

/** VID-LIMIT-1 — sent-duration cap in seconds. */
export const MAX_VIDEO_DURATION_S = 60;

/** VID-ENC-1 — output box: short edge ≤ 720 AND long edge ≤ 1280. */
const MAX_SHORT_EDGE = 720;
const MAX_LONG_EDGE = 1280;
const VIDEO_BITRATE = 2_500_000;
const AUDIO_BITRATE = 128_000;

/** VID-POSTER-1 — long-edge cap, matching image-messages' full variant. */
const POSTER_MAX_SIDE = 1600;
/** VID-POSTER-1 — poster frame offset into the sent window. */
const POSTER_OFFSET_S = 0.5;

export type TrimWindow = { start: number; end: number };

/**
 * VID-LIMIT-1 / VID-TRIM-1 — clamp a requested window to the source duration
 * and the cap. A bad duration yields `{0, 0}`; the start is kept at least
 * 0.1 s before the end.
 */
export function clampTrimWindow(
  durationS: number,
  requestedStartS: number,
  maxLenS: number = MAX_VIDEO_DURATION_S,
): TrimWindow {
  const dur = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  const start = Math.min(Math.max(0, requestedStartS || 0), Math.max(0, dur - 0.1));
  const end = Math.min(dur, start + maxLenS);
  return { start, end };
}

/**
 * VID-ENC-1 — output size: fits both a 720 short edge and a 1280 long edge,
 * aspect kept, both sides even (floored so the caps are never exceeded),
 * never upscaled.
 */
export function videoTargetDimensions(w: number, h: number): { width: number; height: number } {
  const evenFloor = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  const short = Math.min(w, h);
  const long = Math.max(w, h);
  const scale = Math.min(1, MAX_SHORT_EDGE / short, MAX_LONG_EDGE / long);
  return { width: evenFloor(w * scale), height: evenFloor(h * scale) };
}

/**
 * VID-ENC-1 / VID-ENC-4 — the codec pair to encode with. Production: H.264 +
 * AAC. Under `config.e2eTest` only (headless Chromium has no H.264/AAC
 * encoder): VP9 + Opus in the same MP4 container.
 */
export function videoCodecs(): { video: VideoCodec; audio: AudioCodec } {
  return config.e2eTest ? { video: 'vp9', audio: 'opus' } : { video: 'avc', audio: 'aac' };
}

/** VID-ENC-4.1 — a WebKit engine (Safari, any iOS browser, Playwright's
 *  WebKit), as opposed to the Chromium family, which also says `AppleWebKit`. */
export function isWebKitEngine(ua: string): boolean {
  return /AppleWebKit/.test(ua) && !/Chrome|Chromium|Edg\//.test(ua);
}

/**
 * VID-ENC-3 — can this runtime encode the `videoCodecs()` pair at 720p?
 * Never throws. Callers should go through `canTranscodeVideo()` in
 * `@/lib/capabilities` (memoised, lazy-loads this module).
 */
export async function canEncodeForSend(): Promise<boolean> {
  if (typeof (globalThis as { VideoEncoder?: unknown }).VideoEncoder === 'undefined') return false;
  // VID-ENC-4.1 — test mode only: Playwright's Linux WebKit crashes the page
  // on `isConfigSupported`, so WebKit specs run with no encoder. Real iOS
  // WebCodecs works, so production always asks.
  if (config.e2eTest && typeof navigator !== 'undefined' && isWebKitEngine(navigator.userAgent)) return false;
  try {
    const { video, audio } = videoCodecs();
    const [v, a] = await Promise.all([
      canEncodeVideo(video, {
        width: 1280,
        height: 720,
        quality: new Quality({ bitrate: VIDEO_BITRATE }),
      }),
      canEncodeAudio(audio, { quality: new Quality({ bitrate: AUDIO_BITRATE }) }),
    ]);
    return v && a;
  } catch {
    return false;
  }
}

export type VideoProbe = { durationS: number; width: number; height: number; canDecode: boolean };

/**
 * VID-PICK-1 — probe a picked file. Returns `canDecode: false` (zeros for the
 * numbers) when the container parses but has no video track, or the track
 * cannot be decoded here. THROWS only when the input is not a readable media
 * container at all (mediabunny cannot parse it) — callers treat both as a
 * rejected pick.
 */
export async function probeVideo(file: Blob): Promise<VideoProbe> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) return { durationS: 0, width: 0, height: 0, canDecode: false };
    const [durationS, canDecode] = await Promise.all([input.computeDuration(), video.canDecode()]);
    return { durationS, width: video.displayWidth, height: video.displayHeight, canDecode };
  } finally {
    input.dispose();
  }
}

export type TranscodeResult = {
  blob: Blob;
  durationMs: number;
  width: number;
  height: number;
  posterBlob: Blob;
};

function abortError(): DOMException {
  return new DOMException('Video transcode cancelled', 'AbortError');
}

async function canvasToJpeg(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<Blob> {
  const blob =
    typeof HTMLCanvasElement !== 'undefined' && canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.85))
      : await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/jpeg', quality: 0.85 });
  if (!blob) throw new Error('Poster encode failed');
  return blob;
}

type KeyTimes = { list: number[] | null };

/**
 * `sink.getCanvas(t)`, falling back to the nearest KEY frame at or before `t`.
 * mediabunny's Matroska `getKeyPacket(t)` only searches the cluster holding
 * `t`, so in a WebM whose clusters don't start on a key frame (MediaRecorder
 * output, e.g. the E2E fixtures) a lookup in such a cluster returns null. The fallback walks the key-frame index once
 * (metadata only; cached in `keys`) and decodes the key frame itself, which
 * `getCanvas` can always find. MP4 sources never take it.
 */
async function canvasAtOrBefore(
  sink: CanvasSink,
  video: InputVideoTrack,
  t: number,
  keys: KeyTimes = { list: null },
): Promise<WrappedCanvas | null> {
  const exact = await sink.getCanvas(t);
  if (exact) return exact;
  if (!keys.list) {
    const packets = new EncodedPacketSink(video);
    const list: number[] = [];
    let key = await packets.getFirstKeyPacket({ metadataOnly: true });
    while (key && list.length < 100_000) {
      list.push(key.timestamp);
      key = await packets.getNextKeyPacket(key, { metadataOnly: true });
    }
    keys.list = list;
  }
  let best: number | null = null;
  for (const k of keys.list) if (k <= t) best = k;
  return best === null ? null : sink.getCanvas(best);
}

/**
 * VID-POSTER-1 — one frame via `CanvasSink` (WebCodecs decode, rotation
 * applied), at trim.start + 0.5 s clamped inside the window. Never a detached
 * `<video>` (it never loads on iOS).
 */
async function capturePoster(input: Input, trim: TrimWindow): Promise<Blob> {
  const video = await input.getPrimaryVideoTrack();
  if (!video) throw new Error('No video track found in this file');
  const w = video.displayWidth;
  const h = video.displayHeight;
  const scale = Math.min(1, POSTER_MAX_SIDE / Math.max(w, h));
  const sink = new CanvasSink(video, {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
    fit: 'fill',
  });
  const first = await video.getFirstTimestamp();
  const windowStart = Math.max(first, trim.start);
  const at = Math.max(windowStart, Math.min(trim.start + POSTER_OFFSET_S, trim.end - 0.001));
  const frame = (await canvasAtOrBefore(sink, video, at)) ?? (await sink.getCanvas(windowStart));
  if (!frame) throw new Error('Could not decode a frame for the poster');
  return canvasToJpeg(frame.canvas);
}

/**
 * VID-REVIEW-1 — the review screen's poster: one frame of the SOURCE, via the
 * same WebCodecs path as the sent poster (VID-POSTER-1), so iOS has something
 * to paint before the user taps play. `trim` picks the frame (window start +
 * 0.5 s); defaults to the first 60 s.
 */
export async function capturePreviewPoster(file: Blob, trim?: TrimWindow): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const window = trim ?? { start: 0, end: MAX_VIDEO_DURATION_S };
    return await capturePoster(input, window);
  } finally {
    input.dispose();
  }
}

/**
 * VID-TRIM-2 — timestamps for `count` strip frames spread across the WHOLE
 * source: the centre of each of `count` equal slices of [first, first+dur).
 */
export function stripTimestamps(firstS: number, durationS: number, count: number): number[] {
  const n = Math.max(0, Math.floor(count));
  const dur = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
  const first = Number.isFinite(firstS) ? firstS : 0;
  return Array.from({ length: n }, (_, i) => first + ((i + 0.5) * dur) / n);
}

/**
 * VID-TRIM-2 frame strip — decodes `count` small frames (`heightPx` tall,
 * width from the display aspect, rotation applied) spread across the whole
 * source through the VID-POSTER-1 path (`CanvasSink`, never a detached
 * `<video>`), yielding each as a JPEG as soon as it is decoded so the strip
 * paints progressively. Frames the decoder cannot produce are skipped.
 * Aborting `signal` (or breaking out of the loop) stops decoding and
 * disposes the input. The caller owns any object URLs it makes.
 */
export async function* extractStripFrames(
  file: Blob,
  count: number,
  heightPx: number,
  signal?: AbortSignal,
): AsyncGenerator<{ index: number; blob: Blob }, void, unknown> {
  if (signal?.aborted) return;
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video || signal?.aborted) return;
    const [first, duration] = await Promise.all([video.getFirstTimestamp(), input.computeDuration()]);
    const h = Math.max(2, Math.round(heightPx));
    const aspect = video.displayHeight > 0 ? video.displayWidth / video.displayHeight : 16 / 9;
    const sink = new CanvasSink(video, { width: Math.max(2, Math.round(h * aspect)), height: h, fit: 'fill', poolSize: 1 });
    const times = stripTimestamps(first, duration - first, count);
    const keys: KeyTimes = { list: null };
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) return;
      const frame = await canvasAtOrBefore(sink, video, times[i]!, keys);
      if (signal?.aborted) return;
      if (!frame) continue;
      // Encoded before the next iteration: the pool of 1 reuses this canvas.
      const blob = await canvasToJpeg(frame.canvas);
      if (signal?.aborted) return;
      yield { index: i, blob };
    }
  } finally {
    input.dispose();
  }
}

/**
 * VID-ENC-1/2, VID-TRIM-1, VID-POSTER-1 — transcode the trim window of
 * `file` to the sent MP4 and capture its poster. Aborting `signal` cancels
 * the conversion; the promise then rejects with a DOMException named
 * 'AbortError' (anything else is a real failure).
 */
export async function transcodeForSend(
  file: Blob,
  trim: TrimWindow,
  opts: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<TranscodeResult> {
  const { onProgress, signal } = opts;
  if (signal?.aborted) throw abortError();
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new Error('No video track found in this file');
    const dims = videoTargetDimensions(video.displayWidth, video.displayHeight);
    const codecs = videoCodecs();
    const target = new BufferTarget();
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target });

    const conversion = await Conversion.init({
      input,
      output,
      trim,
      tracks: 'primary',
      video: {
        codec: codecs.video,
        width: dims.width,
        height: dims.height,
        fit: 'fill',
        quality: new Quality({ bitrate: VIDEO_BITRATE }),
        forceTranscode: true,
      },
      audio: {
        codec: codecs.audio,
        quality: new Quality({ bitrate: AUDIO_BITRATE }),
        forceTranscode: true,
      },
      copy: false,
      showWarnings: false,
    });
    if (!conversion.isValid) {
      const reasons = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`);
      throw new Error(`Video conversion not possible — ${reasons.join('; ') || 'unknown reason'}`);
    }
    if (onProgress) conversion.onProgress = (p) => onProgress(p);

    const onAbort = () => void conversion.cancel();
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      if (signal?.aborted) throw abortError();
      await conversion.execute();
    } catch (err) {
      if (err instanceof ConversionCanceledError || signal?.aborted) throw abortError();
      throw err;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
    if (!target.buffer) throw new Error('Video conversion produced no output');

    const posterBlob = await capturePoster(input, trim);
    if (signal?.aborted) throw abortError();

    return {
      blob: new Blob([target.buffer], { type: 'video/mp4' }),
      durationMs: Math.round((trim.end - trim.start) * 1000),
      width: dims.width,
      height: dims.height,
      posterBlob,
    };
  } finally {
    input.dispose();
  }
}
