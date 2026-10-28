import '@testing-library/jest-dom/vitest';
import { vi } from 'vitest';

// Placeholder VITE_* config so `src/lib/config.ts` imports without a
// `.env.local`. Shared with the functions project; see ./env.ts.
import './env';

// Stub Capacitor's native bridge so JS-SDK paths that call
// Capacitor.isNativePlatform() or getPlatform() get a deterministic "web"
// answer in unit tests.
vi.mock('@capacitor/core', async () => {
  return {
    Capacitor: {
      isNativePlatform: () => false,
      getPlatform: () => 'web',
    },
  };
});

// jsdom does not implement ResizeObserver. Components that measure layout
// (MessageActionsMenu lift math, ChatScroll) construct one on mount; a
// no-op stand-in lets them render in unit tests without throwing.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom does not implement matchMedia. Stub a MediaQueryList that reports
// no match for everything (closest to a default desktop browser).
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom does not implement the Pointer Capture API. Anything that opens a
// `BottomSheet` by a real pointer interaction (rather than rendering it already
// `open`) hits its swipe-to-dismiss handlers and throws
// `event.target.setPointerCapture is not a function` — an unhandled error that
// does not fail the test, so it accumulates as noise until somebody stops
// trusting the run. Stubbed as no-ops: the capture semantics are irrelevant in
// jsdom, which has no real pointer to capture.
if (typeof Element !== 'undefined') {
  const proto = Element.prototype as unknown as Record<string, unknown>;
  if (typeof proto.setPointerCapture !== 'function') proto.setPointerCapture = () => {};
  if (typeof proto.releasePointerCapture !== 'function') proto.releasePointerCapture = () => {};
  if (typeof proto.hasPointerCapture !== 'function') proto.hasPointerCapture = () => false;
}
