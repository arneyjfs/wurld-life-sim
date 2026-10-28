/**
 * DEVCON-CON-2 / DEVCON-NET-6 / DEVCON-GATE-4 / DEVCON-EDGE-4 — the two
 * bounded ring buffers. Unbounded growth on a long session is the leak
 * these invariants exist to prevent.
 *
 * Spec: docs/specs/dev-console.md §3, §4, §1.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  CONSOLE_BUFFER_MAX,
  NETWORK_BUFFER_MAX,
  useDevConsoleStore,
} from './devConsoleStore';
import type { NetworkEntry } from './types';

function netEntry(id: string): NetworkEntry {
  return {
    id,
    transport: 'fetch',
    method: 'POST',
    url: `https://fn.example/${id}`,
    startedAt: 0,
    durationMs: null,
    status: null,
    ok: null,
    pending: true,
    requestBody: null,
    responseBody: null,
    requestHeaders: {},
    error: null,
  };
}

beforeEach(() => {
  useDevConsoleStore.getState().clear();
});

describe('DEVCON-CON-2 — console ring buffer', () => {
  it('DEVCON-CON-2 — caps at 300 entries, evicting oldest first', () => {
    expect(CONSOLE_BUFFER_MAX).toBe(300);
    const { pushConsole } = useDevConsoleStore.getState();
    for (let i = 0; i < CONSOLE_BUFFER_MAX + 5; i += 1) pushConsole('log', `line ${i}`);
    const entries = useDevConsoleStore.getState().consoleEntries;
    expect(entries).toHaveLength(CONSOLE_BUFFER_MAX);
    expect(entries[0]?.text).toBe('line 5');
    expect(entries[entries.length - 1]?.text).toBe('line 304');
  });

  it('DEVCON-CON-3 — entries carry seq, level and a timestamp', () => {
    useDevConsoleStore.getState().pushConsole('warn', 'careful');
    const e = useDevConsoleStore.getState().consoleEntries[0];
    expect(e?.level).toBe('warn');
    expect(e?.text).toBe('careful');
    expect(typeof e?.ts).toBe('number');
    expect(typeof e?.seq).toBe('number');
  });

  it('DEVCON-EDGE-4 — seq keeps increasing across an eviction (keys never collide)', () => {
    const { pushConsole } = useDevConsoleStore.getState();
    for (let i = 0; i < CONSOLE_BUFFER_MAX + 10; i += 1) pushConsole('log', `x${i}`);
    const seqs = useDevConsoleStore.getState().consoleEntries.map((e) => e.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
    for (let i = 1; i < seqs.length; i += 1) {
      expect(seqs[i]!).toBeGreaterThan(seqs[i - 1]!);
    }
  });

  it('DEVCON-EDGE-4 — each push hands React a NEW array reference', () => {
    const { pushConsole } = useDevConsoleStore.getState();
    pushConsole('log', 'a');
    const first = useDevConsoleStore.getState().consoleEntries;
    pushConsole('log', 'b');
    const second = useDevConsoleStore.getState().consoleEntries;
    expect(second).not.toBe(first);
  });
});

describe('DEVCON-NET-6 — network ring buffer', () => {
  it('DEVCON-NET-6 — caps at 150 entries, evicting oldest first', () => {
    expect(NETWORK_BUFFER_MAX).toBe(150);
    const { startNetwork } = useDevConsoleStore.getState();
    for (let i = 0; i < NETWORK_BUFFER_MAX + 3; i += 1) startNetwork(netEntry(`r${i}`));
    const entries = useDevConsoleStore.getState().networkEntries;
    expect(entries).toHaveLength(NETWORK_BUFFER_MAX);
    expect(entries[0]?.id).toBe('r3');
  });

  it('DEVCON-NET-2 — settle updates the entry in place, never appends a second row', () => {
    const { startNetwork, settleNetwork } = useDevConsoleStore.getState();
    startNetwork(netEntry('a'));
    settleNetwork('a', { status: 200, ok: true, pending: false, durationMs: 42 });
    const entries = useDevConsoleStore.getState().networkEntries;
    expect(entries).toHaveLength(1);
    expect(entries[0]?.status).toBe(200);
    expect(entries[0]?.pending).toBe(false);
    expect(entries[0]?.durationMs).toBe(42);
  });

  it('DEVCON-NET-6 — settling an evicted id is a silent no-op', () => {
    const { startNetwork, settleNetwork } = useDevConsoleStore.getState();
    startNetwork(netEntry('a'));
    expect(() => settleNetwork('missing', { status: 500 })).not.toThrow();
    expect(useDevConsoleStore.getState().networkEntries).toHaveLength(1);
  });
});

describe('DEVCON-GATE-4 — clear() drops both buffers', () => {
  it('DEVCON-GATE-4 — captured traffic does not survive the flag being turned off', () => {
    const s = useDevConsoleStore.getState();
    s.pushConsole('log', 'secretish message text');
    s.startNetwork(netEntry('a'));
    s.clear();
    expect(useDevConsoleStore.getState().consoleEntries).toEqual([]);
    expect(useDevConsoleStore.getState().networkEntries).toEqual([]);
  });
});
