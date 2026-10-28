import { afterEach, describe, expect, it, vi } from 'vitest';

const cfg = vi.hoisted(() => ({ e2eTest: false }));
vi.mock('@/lib/config', () => ({ config: cfg }));

import {
  MAX_VIDEO_DURATION_S,
  clampTrimWindow,
  stripTimestamps,
  videoCodecs,
  videoTargetDimensions,
} from '@/lib/videoTranscode';
import { canTranscodeVideo } from '@/lib/capabilities';

afterEach(() => {
  cfg.e2eTest = false;
});

function expectFits(d: { width: number; height: number }) {
  expect(d.width % 2).toBe(0);
  expect(d.height % 2).toBe(0);
  expect(Math.min(d.width, d.height)).toBeLessThanOrEqual(720);
  expect(Math.max(d.width, d.height)).toBeLessThanOrEqual(1280);
}

describe('videoTargetDimensions', () => {
  it('VID-ENC-1 — 1920×1080 landscape → 1280×720', () => {
    expect(videoTargetDimensions(1920, 1080)).toEqual({ width: 1280, height: 720 });
  });

  it('VID-ENC-1 — 1080×1920 portrait → 720×1280', () => {
    expect(videoTargetDimensions(1080, 1920)).toEqual({ width: 720, height: 1280 });
  });

  it('VID-ENC-1 — 1080×2288 tall portrait is bound by the 1280 long edge', () => {
    const d = videoTargetDimensions(1080, 2288);
    expect(d.height).toBe(1280);
    expect(Math.abs(d.width - 604)).toBeLessThanOrEqual(2);
    expectFits(d);
  });

  it('VID-ENC-1 — 3840×2160 (4K) → 1280×720', () => {
    expect(videoTargetDimensions(3840, 2160)).toEqual({ width: 1280, height: 720 });
  });

  it('VID-ENC-1 — 640×360 is never upscaled', () => {
    expect(videoTargetDimensions(640, 360)).toEqual({ width: 640, height: 360 });
  });

  it('VID-ENC-1 — odd inputs yield even sides', () => {
    for (const [w, h] of [
      [641, 361],
      [1919, 1081],
      [333, 999],
      [1081, 2289],
    ] as const) {
      const d = videoTargetDimensions(w, h);
      expectFits(d);
      expect(d.width).toBeLessThanOrEqual(w);
      expect(d.height).toBeLessThanOrEqual(h);
    }
  });
});

describe('clampTrimWindow', () => {
  it('VID-LIMIT-1 — cap is 60 s', () => {
    expect(MAX_VIDEO_DURATION_S).toBe(60);
  });

  it('VID-LIMIT-1 — a short source is sent whole', () => {
    expect(clampTrimWindow(12.5, 0)).toEqual({ start: 0, end: 12.5 });
  });

  it('VID-LIMIT-1 — a long source defaults to the first 60 s', () => {
    expect(clampTrimWindow(173, 0)).toEqual({ start: 0, end: 60 });
  });

  it('VID-TRIM-1 — a moved window keeps its 60 s length', () => {
    expect(clampTrimWindow(173, 50)).toEqual({ start: 50, end: 110 });
  });

  it('VID-TRIM-1 — a window near the end is cut at the source end', () => {
    expect(clampTrimWindow(90, 70)).toEqual({ start: 70, end: 90 });
  });

  it('VID-TRIM-1 — negative / NaN start clamps to 0', () => {
    expect(clampTrimWindow(90, -5)).toEqual({ start: 0, end: 60 });
    expect(clampTrimWindow(90, Number.NaN)).toEqual({ start: 0, end: 60 });
  });

  it('VID-TRIM-1 — start past the end clamps to just before the end', () => {
    const w = clampTrimWindow(30, 45);
    expect(w.start).toBeCloseTo(29.9, 5);
    expect(w.end).toBe(30);
  });

  it('VID-TRIM-1 — a custom cap is honoured', () => {
    expect(clampTrimWindow(100, 10, 15)).toEqual({ start: 10, end: 25 });
  });

  it('VID-TRIM-1 — a bad duration yields an empty window', () => {
    expect(clampTrimWindow(Number.NaN, 0)).toEqual({ start: 0, end: 0 });
    expect(clampTrimWindow(-1, 0)).toEqual({ start: 0, end: 0 });
  });
});

describe('videoCodecs', () => {
  it('VID-ENC-1 — production targets H.264 + AAC', () => {
    expect(videoCodecs()).toEqual({ video: 'avc', audio: 'aac' });
  });

  it('VID-ENC-4 — e2eTest switches to VP9 + Opus, nothing else', () => {
    cfg.e2eTest = true;
    expect(videoCodecs()).toEqual({ video: 'vp9', audio: 'opus' });
  });
});

describe('canTranscodeVideo', () => {
  it('VID-ENC-3 — false in jsdom (no WebCodecs) without throwing', async () => {
    await expect(canTranscodeVideo()).resolves.toBe(false);
    // Memoised: a second call answers the same.
    await expect(canTranscodeVideo()).resolves.toBe(false);
  });
});

describe('stripTimestamps', () => {
  it('VID-TRIM-2 — frames spread across the whole source, one per slice centre', () => {
    expect(stripTimestamps(0, 60, 6)).toEqual([5, 15, 25, 35, 45, 55]);
  });
  it('VID-TRIM-2 — offset by the first timestamp', () => {
    expect(stripTimestamps(1, 10, 2)).toEqual([3.5, 8.5]);
  });
  it('VID-TRIM-2 — junk input yields no/zero timestamps rather than NaN', () => {
    expect(stripTimestamps(0, 10, 0)).toEqual([]);
    expect(stripTimestamps(NaN, NaN, 2)).toEqual([0, 0]);
  });
});
