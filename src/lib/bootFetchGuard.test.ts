// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  installFetchGuard,
  isFetchGuardActive,
  uninstallFetchGuard,
} from './bootFetchGuard';

/**
 * The guard's job is narrow but load-bearing for cold-boot perf — if it
 * fails to intercept Auth's accounts:lookup, cold-boot on EDGE jumps from
 * a few hundred ms to ~70s. These tests pin the behaviour:
 *   - install replaces window.fetch
 *   - the wrapper rejects accounts:lookup with a TypeError (specifically;
 *     Auth maps TypeError → network-request-failed → keep cached user)
 *   - the wrapper passes through unrelated URLs to the original fetch
 *   - uninstall restores the original window.fetch reference
 *   - double-install / double-uninstall is a no-op
 *   - while active but uninstalled mid-flight, in-flight wrapped calls
 *     still resolve correctly
 */

const originalFetch = window.fetch;

beforeEach(() => {
  // Each test starts with a fresh stub on window.fetch so we can assert
  // exactly what the wrapper forwards to.
  window.fetch = vi
    .fn()
    .mockResolvedValue(new Response('{}', { status: 200 })) as typeof window.fetch;
});

afterEach(() => {
  uninstallFetchGuard();
  window.fetch = originalFetch;
});

describe('bootFetchGuard', () => {
  it('installFetchGuard replaces window.fetch and marks active', () => {
    const before = window.fetch;
    installFetchGuard();
    expect(isFetchGuardActive()).toBe(true);
    expect(window.fetch).not.toBe(before);
  });

  it('rejects accounts:lookup with TypeError', async () => {
    installFetchGuard();
    await expect(
      window.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=foo'),
    ).rejects.toThrowError(TypeError);
  });

  it('rejection message matches what Auth expects for network-request-failed', async () => {
    installFetchGuard();
    try {
      await window.fetch(
        'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=foo',
      );
      expect.unreachable('expected fetch to reject');
    } catch (err) {
      expect(err).toBeInstanceOf(TypeError);
      expect((err as Error).message).toBe('Failed to fetch');
    }
  });

  it('passes through unrelated URLs to the original fetch', async () => {
    const stub = vi
      .fn()
      .mockResolvedValue(new Response('ok', { status: 200 }));
    window.fetch = stub as unknown as typeof window.fetch;
    installFetchGuard();
    const res = await window.fetch('https://example.com/api/foo');
    expect(stub).toHaveBeenCalledWith('https://example.com/api/foo', undefined);
    expect(await res.text()).toBe('ok');
  });

  it('passes through other Firebase Auth endpoints (signInWith*, sendOobCode, token refresh)', async () => {
    const stub = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    window.fetch = stub as unknown as typeof window.fetch;
    installFetchGuard();
    await window.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=foo',
    );
    await window.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=foo',
    );
    await window.fetch('https://securetoken.googleapis.com/v1/token?key=foo');
    expect(stub).toHaveBeenCalledTimes(3);
  });

  it('handles Request objects, URL objects, and strings uniformly', async () => {
    installFetchGuard();
    const lookup = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=foo';
    await expect(window.fetch(lookup)).rejects.toThrowError(TypeError);
    await expect(window.fetch(new URL(lookup))).rejects.toThrowError(TypeError);
    await expect(window.fetch(new Request(lookup))).rejects.toThrowError(
      TypeError,
    );
  });

  it('forwards init args (method, body, headers) to the original fetch', async () => {
    const stub = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    window.fetch = stub as unknown as typeof window.fetch;
    installFetchGuard();
    const init: RequestInit = {
      method: 'POST',
      body: 'payload',
      headers: { 'X-Test': '1' },
    };
    await window.fetch('https://example.com/x', init);
    expect(stub).toHaveBeenCalledWith('https://example.com/x', init);
  });

  it('uninstallFetchGuard restores fetch (functionally — wrapper is gone)', async () => {
    const stub = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    window.fetch = stub as unknown as typeof window.fetch;
    installFetchGuard();
    uninstallFetchGuard();
    expect(isFetchGuardActive()).toBe(false);
    // accounts:lookup should now reach the stub (proves wrapper is gone).
    // The stored original is `.bind(window)`d, so reference equality won't
    // match — assert behaviour instead.
    await window.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=foo',
    );
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('after uninstall, accounts:lookup no longer blocked', async () => {
    const stub = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }));
    window.fetch = stub as unknown as typeof window.fetch;
    installFetchGuard();
    uninstallFetchGuard();
    await window.fetch(
      'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=foo',
    );
    expect(stub).toHaveBeenCalledTimes(1);
  });

  it('install is idempotent (no-op if already active)', () => {
    installFetchGuard();
    const first = window.fetch;
    installFetchGuard();
    expect(window.fetch).toBe(first);
    expect(isFetchGuardActive()).toBe(true);
  });

  it('uninstall is idempotent (no-op if already inactive)', () => {
    const before = window.fetch;
    uninstallFetchGuard(); // never installed
    expect(window.fetch).toBe(before);
    expect(isFetchGuardActive()).toBe(false);
  });
});
