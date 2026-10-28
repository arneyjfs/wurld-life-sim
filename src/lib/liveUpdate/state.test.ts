import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * OTA-8 / OTA-9 / OTA-12 / OTA-13 / D4 — the live-update state in Capacitor
 * Preferences (docs/specs/live-updates.md §3c "State in Capacitor
 * Preferences"). Preferences live in UserDefaults / SharedPreferences, so
 * they survive bundle swaps AND store updates — which is why the entries that
 * must outlive `resetWhenUpdate` (failed versions, the self-heal attempt)
 * carry the native build.
 */

const prefs = vi.hoisted(() => ({
  store: new Map<string, string>(),
  get: vi.fn(async ({ key }: { key: string }) => ({ value: prefs.store.get(key) ?? null })),
  set: vi.fn(async ({ key, value }: { key: string; value: string }) => {
    prefs.store.set(key, value);
  }),
  remove: vi.fn(async ({ key }: { key: string }) => {
    prefs.store.delete(key);
  }),
}));
vi.mock('@capacitor/preferences', () => ({
  Preferences: { get: prefs.get, set: prefs.set, remove: prefs.remove },
}));

import {
  OTA_KEYS,
  addFailedVersion,
  clearPendingBundle,
  getCachedChannel,
  getFailedVersions,
  getLastCheckAt,
  getPendingBundle,
  getSelfHealAttempted,
  getSwUnregistered,
  setCachedChannel,
  setLastCheckAt,
  setPendingBundle,
  setSelfHealAttempted,
  setSwUnregistered,
} from './state';

beforeEach(() => {
  prefs.store.clear();
  vi.clearAllMocks();
});

describe('§3c — the Preferences keys are the documented ones', () => {
  it('§3c — every key is namespaced wurld.ota.*', () => {
    expect(OTA_KEYS).toEqual({
      channel: 'wurld.ota.channel',
      // D5 — the store build's channel (the built-in bundle's), the policy's
      // `deviceChannel`; the running bundle's channel is the pin once swapped.
      builtinChannel: 'wurld.ota.builtinChannel',
      failedVersions: 'wurld.ota.failedVersions',
      lastCheckAt: 'wurld.ota.lastCheckAt',
      pendingBundleId: 'wurld.ota.pendingBundleId',
      selfHealAttempted: 'wurld.ota.selfHealAttempted',
      swUnregistered: 'wurld.ota.swUnregistered',
    });
  });
});

describe('OTA-9 — channel', () => {
  it('OTA-9 — null until cached; round-trips beta/prod', async () => {
    expect(await getCachedChannel()).toBeNull();
    await setCachedChannel('prod');
    expect(prefs.store.get('wurld.ota.channel')).toBe('prod');
    expect(await getCachedChannel()).toBe('prod');
  });

  it('OTA-9 — an unknown stored value reads as null (never a third channel)', async () => {
    prefs.store.set('wurld.ota.channel', 'staging');
    expect(await getCachedChannel()).toBeNull();
  });
});

describe('OTA-8 — failedVersions keyed by native build', () => {
  it('OTA-8 — empty until something fails; append dedupes on (version, nativeBuild)', async () => {
    expect(await getFailedVersions()).toEqual([]);
    await addFailedVersion({ version: '0.3.2', nativeBuild: 10 });
    await addFailedVersion({ version: '0.3.2', nativeBuild: 10 });
    await addFailedVersion({ version: '0.3.2', nativeBuild: 11 });
    expect(await getFailedVersions()).toEqual([
      { version: '0.3.2', nativeBuild: 10 },
      { version: '0.3.2', nativeBuild: 11 },
    ]);
    expect(JSON.parse(prefs.store.get('wurld.ota.failedVersions') ?? '')).toEqual([
      { version: '0.3.2', nativeBuild: 10 },
      { version: '0.3.2', nativeBuild: 11 },
    ]);
  });

  it('OTA-8 — malformed JSON reads as empty rather than throwing into the boot path', async () => {
    prefs.store.set('wurld.ota.failedVersions', '{not json');
    expect(await getFailedVersions()).toEqual([]);
    prefs.store.set('wurld.ota.failedVersions', JSON.stringify([{ version: 1 }, { version: 'ok', nativeBuild: 2 }]));
    expect(await getFailedVersions()).toEqual([{ version: 'ok', nativeBuild: 2 }]);
  });

  it('OTA-8 — the list is bounded (oldest entries drop first)', async () => {
    for (let i = 0; i < 40; i += 1) await addFailedVersion({ version: `v${i}`, nativeBuild: 1 });
    const list = await getFailedVersions();
    expect(list.length).toBeLessThanOrEqual(20);
    expect(list[list.length - 1]).toEqual({ version: 'v39', nativeBuild: 1 });
  });
});

describe('BOOT-GATE-2 cadence / D4 timing — timestamps', () => {
  it('lastCheckAt round-trips as a number and is null when unset or garbage', async () => {
    expect(await getLastCheckAt()).toBeNull();
    await setLastCheckAt(1_700_000_000_000);
    expect(await getLastCheckAt()).toBe(1_700_000_000_000);
    prefs.store.set('wurld.ota.lastCheckAt', 'soon');
    expect(await getLastCheckAt()).toBeNull();
  });

});

describe('D4 — pendingBundleId', () => {
  it('D4 — a downloaded bundle is stored as { id, version } plus its provenance', async () => {
    expect(await getPendingBundle()).toBeNull();
    await setPendingBundle({ id: 'b-1', version: '0.3.2', channel: 'beta', builtAt: '2026-10-07T08:35:34Z' });
    expect(JSON.parse(prefs.store.get('wurld.ota.pendingBundleId') ?? '')).toEqual({
      id: 'b-1',
      version: '0.3.2',
      channel: 'beta',
      builtAt: '2026-10-07T08:35:34Z',
    });
    expect(await getPendingBundle()).toEqual({
      id: 'b-1',
      version: '0.3.2',
      channel: 'beta',
      builtAt: '2026-10-07T08:35:34Z',
    });
  });

  it('OTA-7 — a reset is stored as { id: "builtin" }', async () => {
    await setPendingBundle({ id: 'builtin' });
    expect(JSON.parse(prefs.store.get('wurld.ota.pendingBundleId') ?? '')).toEqual({ id: 'builtin' });
    expect(await getPendingBundle()).toEqual({ id: 'builtin' });
  });

  it('D4 — clear removes the key; malformed content reads as null', async () => {
    await setPendingBundle({ id: 'b-1', version: '0.3.2' });
    await clearPendingBundle();
    expect(prefs.store.has('wurld.ota.pendingBundleId')).toBe(false);
    expect(await getPendingBundle()).toBeNull();
    prefs.store.set('wurld.ota.pendingBundleId', '"b-1"');
    expect(await getPendingBundle()).toBeNull();
    prefs.store.set('wurld.ota.pendingBundleId', JSON.stringify({ version: 'no id' }));
    expect(await getPendingBundle()).toBeNull();
  });
});

describe('OTA-12 — selfHealAttempted', () => {
  it('OTA-12 — one attempt record, keyed by manifest version AND native build', async () => {
    expect(await getSelfHealAttempted()).toBeNull();
    await setSelfHealAttempted({ version: '0.3.2', nativeBuild: 10 });
    expect(await getSelfHealAttempted()).toEqual({ version: '0.3.2', nativeBuild: 10 });
    await setSelfHealAttempted({ version: '0.3.3', nativeBuild: 10 });
    expect(await getSelfHealAttempted()).toEqual({ version: '0.3.3', nativeBuild: 10 });
  });
});

describe('OTA-13 — swUnregistered', () => {
  it("OTA-13 — false until the one-time cleanup ran; the flag is the literal '1'", async () => {
    expect(await getSwUnregistered()).toBe(false);
    await setSwUnregistered();
    expect(prefs.store.get('wurld.ota.swUnregistered')).toBe('1');
    expect(await getSwUnregistered()).toBe(true);
  });
});
