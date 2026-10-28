import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  deliverComposerImagePaste,
  imageFilesFrom,
  registerComposerImagePaste,
} from './composerImagePaste';

/** A DataTransfer-shaped clipboard: jsdom has no real DataTransfer. */
function clip(entries: Array<{ kind: 'file' | 'string'; type: string; file?: File }>) {
  return {
    items: entries.map((e) => ({ kind: e.kind, type: e.type, getAsFile: () => e.file ?? null })),
  } as unknown as DataTransfer;
}
const png = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' });
const mp4 = new File([new Uint8Array([1])], 'clip.mp4', { type: 'video/mp4' });

describe('COMP-IMG-8 — composer image paste registry', () => {
  afterEach(() => registerComposerImagePaste(null));

  it('COMP-IMG-8 — picks out image files, in order', () => {
    const jpg = new File([new Uint8Array([1])], 'b.jpg', { type: 'image/jpeg' });
    expect(imageFilesFrom(clip([{ kind: 'file', type: 'image/png', file: png }, { kind: 'file', type: 'image/jpeg', file: jpg }]))).toEqual([png, jpg]);
  });

  it('COMP-IMG-8 — ignores text, and video (images only)', () => {
    expect(imageFilesFrom(clip([{ kind: 'string', type: 'text/plain' }]))).toEqual([]);
    expect(imageFilesFrom(clip([{ kind: 'file', type: 'video/mp4', file: mp4 }]))).toEqual([]);
    expect(imageFilesFrom(null)).toEqual([]);
  });

  it('COMP-IMG-8 — images win over text on a mixed clipboard', () => {
    expect(imageFilesFrom(clip([{ kind: 'string', type: 'text/html' }, { kind: 'file', type: 'image/png', file: png }]))).toEqual([png]);
  });

  it('COMP-IMG-8 — delivers to the registered handler; unhandled when none is registered', () => {
    expect(deliverComposerImagePaste([png])).toBe(false);
    const fn = vi.fn();
    registerComposerImagePaste(fn);
    expect(deliverComposerImagePaste([png])).toBe(true);
    expect(fn).toHaveBeenCalledWith([png]);
    registerComposerImagePaste(null);
    expect(deliverComposerImagePaste([png])).toBe(false);
  });
});
