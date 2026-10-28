/**
 * DEVCON-CON-7 — the log.ts → buffer bridge.
 *
 * REPORTED 2026-08-03: on the deployed beta build the network tab worked and
 * the console tab was empty. The interceptor was fine; `log.ts` simply never
 * calls `console.*` off dev, so there was nothing to intercept.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { mirrorToDevConsole } from './mirror';
import { useDevConsoleStore } from './devConsoleStore';

const rows = () => useDevConsoleStore.getState().consoleEntries;

describe('mirrorToDevConsole', () => {
  beforeEach(() => {
    useDevConsoleStore.getState().clear();
    useDevConsoleStore.getState().setConsolePatch(null);
  });

  it('DEVCON-CON-7 — drops everything while the panel is off', () => {
    // The gate is `consolePatch`, not a flag read: capture being installed IS
    // the developer having asked for this. One store read when off.
    mirrorToDevConsole('info', 'a line nobody asked for');
    expect(rows()).toHaveLength(0);
  });

  it('DEVCON-CON-7 — records once capture is installed', () => {
    useDevConsoleStore.getState().setConsolePatch({ uninstall: () => {} });
    mirrorToDevConsole('info', 'saga ready');
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.text).toContain('saga ready');
    expect(rows()[0]!.level).toBe('info');
  });

  it('DEVCON-CON-7 — carries the level through', () => {
    useDevConsoleStore.getState().setConsolePatch({ uninstall: () => {} });
    mirrorToDevConsole('warn', 'w');
    mirrorToDevConsole('error', 'e');
    expect(rows().map((r) => r.level)).toEqual(['warn', 'error']);
  });

  it('DEVCON-REDACT-* — goes through the same redactor as the console patch', () => {
    // App logs carry request URLs, so a key CAN reach this buffer. The point of
    // the assertion is that the mirror does not bypass `redact` on its way in.
    useDevConsoleStore.getState().setConsolePatch({ uninstall: () => {} });
    mirrorToDevConsole('info', 'GET /x?key=AIzaSyA1234567890abcdefghijklmnopqrstuv');
    expect(rows()[0]!.text).not.toContain('AIzaSyA1234567890abcdefghijklmnopqrstuv');
  });

  it('never throws — a logger that can fail is worse than no logger', () => {
    useDevConsoleStore.getState().setConsolePatch({ uninstall: () => {} });
    expect(() => mirrorToDevConsole('info', '')).not.toThrow();
  });
});
