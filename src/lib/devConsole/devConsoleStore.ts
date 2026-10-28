import { create } from 'zustand';
import type { CapturePatch, ConsoleEntry, ConsoleLevel, NetworkEntry } from './types';

/**
 * DEVCON-CON-2 / DEVCON-NET-6 — the two bounded ring buffers, plus the
 * bookkeeping for the live global patches.
 *
 * In-memory only: never persisted, never sent anywhere (DEVCON-GATE-4). The
 * patch records live here rather than in module-level `let`s so the only
 * mutable singletons in the feature are Zustand stores (conventions §Patterns
 * rule 12).
 *
 * Spec: docs/specs/dev-console.md §3, §4, §1.
 */

export const CONSOLE_BUFFER_MAX = 300;
export const NETWORK_BUFFER_MAX = 150;

type DevConsoleState = {
  consoleEntries: ConsoleEntry[];
  networkEntries: NetworkEntry[];
  /** Next console `seq`. Keeps rising across evictions so keys never collide. */
  nextSeq: number;
  consolePatch: CapturePatch | null;
  networkPatch: CapturePatch | null;

  pushConsole: (level: ConsoleLevel, text: string) => void;
  startNetwork: (entry: NetworkEntry) => void;
  settleNetwork: (id: string, patch: Partial<NetworkEntry>) => void;
  clear: () => void;
  setConsolePatch: (patch: CapturePatch | null) => void;
  setNetworkPatch: (patch: CapturePatch | null) => void;
};

/** Append + evict-oldest. Always returns a NEW array (DEVCON-EDGE-4). */
function ring<T>(list: T[], entry: T, max: number): T[] {
  const next = [...list, entry];
  return next.length > max ? next.slice(-max) : next;
}

export const useDevConsoleStore = create<DevConsoleState>()((set) => ({
  consoleEntries: [],
  networkEntries: [],
  nextSeq: 1,
  consolePatch: null,
  networkPatch: null,

  pushConsole: (level, text) =>
    set((s) => ({
      consoleEntries: ring(
        s.consoleEntries,
        { seq: s.nextSeq, level, ts: Date.now(), text },
        CONSOLE_BUFFER_MAX,
      ),
      nextSeq: s.nextSeq + 1,
    })),

  startNetwork: (entry) =>
    set((s) => ({
      networkEntries: ring(s.networkEntries, entry, NETWORK_BUFFER_MAX),
    })),

  settleNetwork: (id, patch) =>
    set((s) => {
      let found = false;
      const next = s.networkEntries.map((e) => {
        if (e.id !== id) return e;
        found = true;
        return { ...e, ...patch };
      });
      // An entry evicted before it settled is simply dropped (DEVCON-NET-6).
      return found ? { networkEntries: next } : {};
    }),

  clear: () => set({ consoleEntries: [], networkEntries: [] }),
  setConsolePatch: (patch) => set({ consolePatch: patch }),
  setNetworkPatch: (patch) => set({ networkPatch: patch }),
}));
