/**
 * LIFE-LANG-16 — one-time "swipe/tap to flip" coach-mark budget.
 *
 * The wurld dialogue bubbles default to practice-language only (viewMode
 * 'hidden'); the native gloss reveals on a chat-style flip (tap OR swipe-left,
 * no persistent button — see `useLifeBubbleFlip`). Because there is no standing
 * "reveal translation" label, discoverability rides a one-time animated finger
 * (`LifeFlipHint`, reusing the tutor tutorial's swipe pointer) shown on the
 * FIRST FEW occasions, then permanently retired.
 *
 * "First few occasions" = whichever comes first:
 *   - the player has flipped a bubble MAX_FLIPS times (they've learned it), or
 *   - the hint has appeared across MAX_SHOWS wurld sessions (stop nagging a
 *     player who never engages it).
 *
 * Persisted in localStorage so the budget survives reloads — a coach-mark that
 * re-armed every launch would be worse than none.
 */
import { create } from 'zustand';

const KEY = 'wurld:life-flip-hint-v1';
/** Flips after which the player has clearly learned the gesture. */
export const MAX_FLIPS = 2;
/** Distinct sessions the hint may appear in before it retires unengaged. */
export const MAX_SHOWS = 3;

type Persisted = { flips: number; shows: number };

function read(): Persisted {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { flips: 0, shows: 0 };
    const parsed = JSON.parse(raw) as Partial<Persisted>;
    return {
      flips: Number(parsed.flips) || 0,
      shows: Number(parsed.shows) || 0,
    };
  } catch {
    return { flips: 0, shows: 0 };
  }
}

function write(next: Persisted): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* private-mode / quota — the hint just re-arms; harmless. */
  }
}

function dismissed(s: Persisted): boolean {
  return s.flips >= MAX_FLIPS || s.shows >= MAX_SHOWS;
}

type FlipHintState = Persisted & {
  /** Record a successful flip (tap or swipe). Retires the hint at MAX_FLIPS. */
  recordFlip: () => void;
  /** Record that the hint became eligible this session (once per mount).
   *  Retires the hint at MAX_SHOWS. */
  recordShow: () => void;
};

export const useLifeFlipHintStore = create<FlipHintState>((set, get) => ({
  ...read(),
  recordFlip: () => {
    const s = get();
    if (dismissed(s)) return;
    const next = { flips: Math.min(s.flips + 1, MAX_FLIPS), shows: s.shows };
    write(next);
    set(next);
  },
  recordShow: () => {
    const s = get();
    if (dismissed(s)) return;
    const next = { flips: s.flips, shows: Math.min(s.shows + 1, MAX_SHOWS) };
    write(next);
    set(next);
  },
}));

/** Whether the flip coach-mark should still be offered. */
export function useShouldHintFlip(): boolean {
  return useLifeFlipHintStore((s) => !dismissed(s));
}

/** Test-only: reset the persisted budget. */
export function __resetFlipHintForTest(): void {
  write({ flips: 0, shows: 0 });
  useLifeFlipHintStore.setState({ flips: 0, shows: 0 });
}
