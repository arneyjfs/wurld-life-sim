import { useSyncExternalStore } from 'react';
import {
  getKeyboardServerSnapshot,
  getKeyboardSnapshot,
  subscribeKeyboard,
  type KeyboardState,
} from '@/lib/keyboardController';

export type { KeyboardState };

/**
 * Live keyboard state. A thin `useSyncExternalStore` subscriber over the
 * singleton in `src/lib/keyboardController.ts` — COMP-KB-15 requires exactly
 * one writer of `--kb-h`, so this hook reads and never writes.
 *
 * Mount it anywhere you need to branch on `visible` / `height`; mounting it in
 * several places is free (N subscribers, one controller). Elements that only
 * need to RIDE the keyboard don't need the hook at all — the `.pb-keyboard`
 * utility reads `--kb-h` directly (COMP-KB-3).
 *
 * The detection contract — source precedence, focus gating, baseline
 * self-healing, reset points — lives in the controller and in
 * docs/specs/composer.md §4 (COMP-KB-15..19).
 */
export function useKeyboardState(): KeyboardState {
  return useSyncExternalStore(
    subscribeKeyboard,
    getKeyboardSnapshot,
    getKeyboardServerSnapshot,
  );
}
