// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * COMP-KB-15/16/17/18/19 — the single keyboard controller
 * (docs/specs/composer.md §4), plus the COMP-KB-9/12/13 behaviours migrated
 * from the old `useKeyboardState` hook.
 *
 * The controller is a module singleton, so each test re-imports it fresh via
 * `vi.resetModules()` to get a clean baseline + listener set.
 */

const BASELINE = 800;
const kbH = () => document.documentElement.style.getPropertyValue('--kb-h');

class FakeVisualViewport extends EventTarget {
  height = BASELINE;
  offsetTop = 0;
}

let vv: FakeVisualViewport;

// `log` pulls in Firebase, which this node-environment suite has no use for.
vi.mock('./log', () => ({ info: vi.fn() }));

type Controller = typeof import('./keyboardController');

/** Fresh module instance with listeners installed. */
async function load(): Promise<Controller> {
  vi.resetModules();
  const mod = await import('./keyboardController');
  mod.installKeyboardController();
  return mod;
}

/** Focus a real textarea so COMP-KB-16's input-focus gate is satisfied. */
function focusInput(): HTMLTextAreaElement {
  const ta = document.createElement('textarea');
  document.body.appendChild(ta);
  ta.focus();
  return ta;
}

function resizeTo(height: number) {
  vv.height = height;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  vv.dispatchEvent(new Event('resize'));
}

/** Shrink the viewport by `occluded` px and let the COMP-KB-9 settle commit. */
function openTo(occluded: number) {
  resizeTo(BASELINE - occluded);
  vi.advanceTimersByTime(60); // past SETTLE_MS (50)
}

beforeEach(() => {
  vi.useFakeTimers();
  vv = new FakeVisualViewport();
  (window as unknown as { visualViewport: FakeVisualViewport }).visualViewport = vv;
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: BASELINE });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  document.documentElement.style.removeProperty('--kb-h');
  document.body.innerHTML = '';
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (window as unknown as { visualViewport?: FakeVisualViewport }).visualViewport;
});

describe('COMP-KB-16 — --kb-h is 0 whenever no input-like element has focus', () => {
  it('COMP-KB-16 — a desktop window shrink with nothing focused never reports a keyboard', async () => {
    const kb = await load();
    // The exact repro the user reported: drag the window 300px smaller.
    openTo(300);
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
    expect(kb.getKeyboardSnapshot().height).toBe(0);
  });

  it('COMP-KB-16 — the same shrink WITH a focused textarea is a keyboard', async () => {
    const kb = await load();
    focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');
    expect(kb.getKeyboardSnapshot().visible).toBe(true);
  });

  it('COMP-KB-16 — a focused non-typing input (checkbox) does not count', async () => {
    const kb = await load();
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    document.body.appendChild(cb);
    cb.focus();
    openTo(300);
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
  });

  it('COMP-KB-16 — a focused contenteditable does count', async () => {
    await load();
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    // jsdom does not implement isContentEditable from the attribute alone.
    Object.defineProperty(div, 'isContentEditable', { value: true });
    document.body.appendChild(div);
    div.focus();
    openTo(300);
    expect(kbH()).toBe('300px');
  });

  it('COMP-KB-16 — losing focus without any resize event still collapses the inset', async () => {
    // The stuck-state repro: the focused element is removed from the DOM, so no
    // focusout is delivered and no resize follows. The next measurement must
    // still see "nothing focused" and force 0.
    const kb = await load();
    const ta = focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');

    ta.remove();
    // Any subsequent measurement pass (here: a resume re-sync) must recover.
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(400);
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
  });
});

describe('COMP-KB-17 — the no-keyboard baseline self-heals', () => {
  it('COMP-KB-17 — a permanently smaller viewport does not leave a phantom inset', async () => {
    await load();
    // Window shrunk to 500 with nothing focused → treated as the new baseline.
    openTo(300);
    expect(kbH()).toBe('0px');

    // NOW the user focuses an input at the SAME (smaller) viewport. Under the old
    // max-ever baseline this reported a 300px phantom keyboard forever.
    focusInput();
    vv.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('0px');
  });

  it('COMP-KB-17 — after re-baselining, a real keyboard is still measured correctly', async () => {
    await load();
    resizeTo(500); // window resize, nothing focused → baseline becomes 500
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('0px');

    focusInput();
    resizeTo(200); // keyboard occupies 300 of the new 500-tall viewport
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('300px');
  });

  it('COMP-KB-17 — the baseline still GROWS when the viewport grows', async () => {
    await load();
    resizeTo(900); // e.g. mobile URL bar collapsed → taller viewport
    vi.advanceTimersByTime(60);
    focusInput();
    resizeTo(600);
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('300px');
  });
});

describe('COMP-KB-17 — the baseline never shrinks to a mid-close viewport', () => {
  it('COMP-KB-17 — a resize during the keyboard-close slide does not poison the baseline', async () => {
    await load();
    const ta = focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');

    // Blur. The keyboard begins its ~250ms slide; the viewport is STILL
    // occluded for most of it, and a resize lands in that window with nothing
    // focused. Re-baselining to that height would teach the controller that
    // 500 is the no-keyboard viewport.
    ta.blur();
    vi.advanceTimersByTime(60); // predict-close commits 0
    expect(kbH()).toBe('0px');
    vv.dispatchEvent(new Event('resize')); // still occluded at 500
    vi.advanceTimersByTime(10);

    // Viewport restores, user focuses again, the keyboard opens to the SAME
    // 300px. If the baseline had been poisoned this would compute 0 and the
    // composer would sit behind the keyboard.
    resizeTo(BASELINE);
    vi.advanceTimersByTime(10);
    focusInput();
    resizeTo(BASELINE - 300);
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('300px');
  });

  it('COMP-KB-17 — once the close settles, a genuinely smaller viewport DOES re-baseline', async () => {
    await load();
    const ta = focusInput();
    openTo(300);
    ta.blur();
    vi.advanceTimersByTime(60);

    // Well past the shrink guard, the window is genuinely 500 tall now.
    vi.advanceTimersByTime(500);
    resizeTo(500);
    vi.advanceTimersByTime(10);

    focusInput();
    vv.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('0px'); // 500 IS the no-keyboard height now
  });
});

describe('COMP-KB-16 — the focus backstop covers non-viewport sources', () => {
  it('COMP-KB-16 — a missed hide event is recovered by losing focus (virtual-keyboard source)', async () => {
    // Chromium source: geometrychange is authoritative, but if a hide event is
    // dropped the inset would stay high forever without this backstop.
    const vk = new EventTarget() as EventTarget & {
      overlaysContent: boolean;
      boundingRect: { height: number };
    };
    vk.overlaysContent = false;
    vk.boundingRect = { height: 0 };
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: vk });

    const kb = await load();
    expect(kb.getKeyboardSource()).toBe('virtual-keyboard');

    const ta = focusInput();
    vk.boundingRect = { height: 320 };
    vk.dispatchEvent(new Event('geometrychange'));
    expect(kbH()).toBe('320px');

    // The hide geometrychange never arrives; the input blurs instead.
    ta.blur();
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('0px');

    Reflect.deleteProperty(navigator, 'virtualKeyboard');
  });

  it('COMP-KB-15 — the virtual-keyboard source opts into overlaysContent', async () => {
    const vk = new EventTarget() as EventTarget & {
      overlaysContent: boolean;
      boundingRect: { height: number };
    };
    vk.overlaysContent = false;
    vk.boundingRect = { height: 0 };
    Object.defineProperty(navigator, 'virtualKeyboard', { configurable: true, value: vk });
    await load();
    expect(vk.overlaysContent).toBe(true);
    Reflect.deleteProperty(navigator, 'virtualKeyboard');
  });
});

describe('COMP-KB-19 — reset points', () => {
  it('COMP-KB-19 — refreshKeyboardState re-measures when an input still holds focus', async () => {
    // React runs child effects before parent ones, so a destination screen that
    // autofocuses on mount has already taken focus when the route-change hook
    // fires. A bare "reset only if unfocused" check would be a no-op and carry
    // the previous screen's inset through; re-measuring collapses it.
    const kb = await load();
    focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');

    // New screen mounted + autofocused; its keyboard has not opened yet.
    focusInput();
    vv.height = BASELINE;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: BASELINE });

    kb.refreshKeyboardState('route-change');
    expect(kbH()).toBe('0px');
  });

  it('COMP-KB-19 — refreshKeyboardState resets outright when nothing is focused', async () => {
    const kb = await load();
    focusInput();
    openTo(300);
    document.body.innerHTML = ''; // focused element torn down with the screen
    kb.refreshKeyboardState('route-change');
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
  });
});

describe('COMP-KB-19 — hard reset points', () => {
  it('COMP-KB-19 — resetKeyboardState forces the inset to 0', async () => {
    const kb = await load();
    focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');

    kb.resetKeyboardState('route-change');
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
  });

  it('COMP-KB-19 — pagehide clears a stale inset', async () => {
    await load();
    focusInput();
    openTo(300);
    window.dispatchEvent(new Event('pagehide'));
    expect(kbH()).toBe('0px');
  });

  it('COMP-KB-19 — hiding the document clears a stale inset', async () => {
    await load();
    focusInput();
    openTo(300);
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(kbH()).toBe('0px');
  });
});

describe('COMP-KB-18 — devices with no soft keyboard never report one', () => {
  it('COMP-KB-18 — a fine-pointer, no-touch device ignores viewport math entirely', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((q: string) => ({
      matches: q.includes('pointer: fine') || q.includes('hover: hover'),
      media: q,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }));
    Object.defineProperty(navigator, 'maxTouchPoints', { configurable: true, value: 0 });

    const kb = await load();
    focusInput(); // even WITH focus — a physical keyboard occupies no viewport
    openTo(300);
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
  });
});

describe('COMP-KB-15 — one controller, one writer', () => {
  it('COMP-KB-15 — installing twice does not double-register listeners', async () => {
    const kb = await load();
    const addSpy = vi.spyOn(vv, 'addEventListener');
    kb.installKeyboardController();
    kb.installKeyboardController();
    expect(addSpy).not.toHaveBeenCalled();
  });

  it('COMP-KB-15 — subscribers are notified and the snapshot is identity-stable', async () => {
    const kb = await load();
    const seen: number[] = [];
    const unsub = kb.subscribeKeyboard(() => seen.push(kb.getKeyboardSnapshot().height));

    const before = kb.getKeyboardSnapshot();
    expect(kb.getKeyboardSnapshot()).toBe(before); // no churn without a change

    focusInput();
    openTo(300);
    expect(seen).toContain(300);
    expect(kb.getKeyboardSnapshot()).not.toBe(before);

    unsub();
  });

  it('COMP-KB-15 — unsubscribing one consumer leaves the others working', async () => {
    const kb = await load();
    const a: number[] = [];
    const b: number[] = [];
    const unsubA = kb.subscribeKeyboard(() => a.push(kb.getKeyboardSnapshot().height));
    kb.subscribeKeyboard(() => b.push(kb.getKeyboardSnapshot().height));
    unsubA();

    focusInput();
    openTo(300);
    expect(a).toHaveLength(0);
    expect(b).toContain(300);
  });
});

describe('COMP-KB-9/12/13 — behaviours preserved from the previous implementation', () => {
  it('COMP-KB-9 — the open path settle-debounces so an overshoot is never committed', async () => {
    await load();
    focusInput();
    // iOS reports keyboard+QuickType first (taller), then collapses to keyboard only.
    resizeTo(BASELINE - 345);
    vi.advanceTimersByTime(20); // inside the 50ms settle window
    resizeTo(BASELINE - 300);
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('300px'); // the inflated 345 was never written
  });

  it('COMP-KB-13 — a late accessory bar is captured upward after settle', async () => {
    await load();
    focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');
    // The ~44px accessory bar appears a beat later WITHOUT firing a resize.
    vv.height = BASELINE - 344;
    vi.advanceTimersByTime(200); // past the first confirm re-measure (150ms)
    expect(kbH()).toBe('344px');
  });

  it('COMP-KB-13 — the confirm re-measure never corrects DOWNWARD', async () => {
    await load();
    focusInput();
    openTo(300);
    vv.height = BASELINE - 280;
    vi.advanceTimersByTime(400);
    expect(kbH()).toBe('300px');
  });

  it('COMP-KB-7 — blurring predicts the close without waiting for a resize', async () => {
    await load();
    const ta = focusInput();
    openTo(300);
    expect(kbH()).toBe('300px');

    ta.blur();
    vi.advanceTimersByTime(60); // past PREDICT_CLOSE_MS (50)
    expect(kbH()).toBe('0px');
  });

  it('COMP-KB-7 — bouncing focus between two inputs does not predict a close', async () => {
    await load();
    const a = focusInput();
    openTo(300);
    const b = focusInput();
    a.blur();
    b.focus();
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('300px');
  });

  it('COMP-KB-12 — resume re-syncs a stale kb-h to 0 when the keyboard is down', async () => {
    const kb = await load();
    const ta = focusInput();
    openTo(300);
    expect(kb.getKeyboardSnapshot().visible).toBe(true);

    // Backgrounded → the OS dismissed the keyboard with NO resize event.
    ta.blur();
    vv.height = BASELINE;
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(400);
    expect(kbH()).toBe('0px');
    expect(kb.getKeyboardSnapshot().visible).toBe(false);
  });

  it('COMP-KB-12 — resume with the keyboard genuinely still up keeps kb-h', async () => {
    await load();
    focusInput();
    openTo(300);
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(400);
    expect(kbH()).toBe('300px');
  });

  it('COMP-KB-11 — a bogus innerHeight (2x the viewport) cannot inflate the inset', async () => {
    await load();
    focusInput();
    // Android System WebView transiently reports innerHeight at ~2x the real viewport.
    vv.height = BASELINE;
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: BASELINE * 2 });
    vv.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(60);
    expect(kbH()).toBe('0px');
  });
});

/**
 * COMP-KB-20 — the E2E keyboard-simulation hook.
 *
 * These assert the property the E2E specs depend on: once pinned, NOTHING the
 * controller does moves `--kb-h`. Before the pin existed, the specs wrote the
 * variable directly and a stray `resetKeyboardState` (COMP-KB-19 fires one on
 * every route change) wiped it mid-test — which is why two webkit-mobile specs
 * failed in the full gate and passed alone.
 */
describe('COMP-KB-20 — pinned keyboard simulation', () => {
  it('COMP-KB-20 — a pin writes --kb-h and reports the state as visible', async () => {
    const mod = await load();
    mod.pinKeyboardInsetForTest(320);
    expect(kbH()).toBe('320px');
    expect(mod.getKeyboardSnapshot()).toEqual({ visible: true, height: 320 });
  });

  it('COMP-KB-20 — a pin survives a viewport recompute with nothing focused', async () => {
    const mod = await load();
    mod.pinKeyboardInsetForTest(320);
    // The exact sequence that used to clobber it: no focused input, so
    // COMP-KB-16 would normally force 0.
    resizeTo(BASELINE - 300);
    resizeTo(BASELINE);
    mod.refreshKeyboardState('test');
    expect(kbH()).toBe('320px');
  });

  it('COMP-KB-20 — a pin survives resetKeyboardState (the route-change reset)', async () => {
    const mod = await load();
    mod.pinKeyboardInsetForTest(320);
    mod.resetKeyboardState('route-change');
    expect(kbH()).toBe('320px');
  });

  it('COMP-KB-20 — releasing re-derives from the real sources', async () => {
    const mod = await load();
    mod.pinKeyboardInsetForTest(320);
    mod.pinKeyboardInsetForTest(null);
    // No real keyboard and nothing focused → 0, and the controller is live again.
    expect(kbH()).toBe('0px');
    expect(mod.getKeyboardSnapshot()).toEqual({ visible: false, height: 0 });
  });

  it('COMP-KB-20 — the hook is exposed on window for page.evaluate', async () => {
    const mod = await load();
    const w = window as unknown as { __kb?: (px: number | null) => void };
    expect(typeof w.__kb).toBe('function');
    w.__kb!(240);
    expect(kbH()).toBe('240px');
    mod.pinKeyboardInsetForTest(null);
  });
});
