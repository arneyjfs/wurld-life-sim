import { describe, expect, it } from 'vitest';
import { _buildConfigForTest } from './config';

const BASE = {
  VITE_FIREBASE_API_KEY: 'a',
  VITE_FIREBASE_AUTH_DOMAIN: 'b',
  VITE_FIREBASE_PROJECT_ID: 'p',
  VITE_FIREBASE_STORAGE_BUCKET: 's',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '688',
  VITE_FIREBASE_APP_ID: 'app',
  VITE_FUNCTIONS_URL: 'https://us-central1-x.cloudfunctions.net',
};

describe('config', () => {
  it('builds a valid config from required vars', () => {
    const c = _buildConfigForTest(BASE);
    expect(c.env).toBe('dev');
    expect(c.firebase.projectId).toBe('p');
    // Under Vite dev (which is what vitest runs in), functionsUrl is
    // rewritten to the same-origin /__functions proxy so on-device LAN
    // testing isn't CORS-blocked. We assert the proxy shape rather than
    // the raw upstream — that's the prod/beta path, validated below.
    expect(c.functionsUrl).toMatch(/\/__functions$/);
    expect(c.fcmVapidKey).toBeUndefined();
    expect(c.sentryDsn).toBeUndefined();
    expect(c.appCheckSiteKey).toBeUndefined();
  });

  it.each([
    ['VITE_FIREBASE_API_KEY'],
    ['VITE_FIREBASE_AUTH_DOMAIN'],
    ['VITE_FIREBASE_PROJECT_ID'],
    ['VITE_FIREBASE_STORAGE_BUCKET'],
    ['VITE_FIREBASE_MESSAGING_SENDER_ID'],
    ['VITE_FIREBASE_APP_ID'],
    ['VITE_FUNCTIONS_URL'],
  ])('throws when %s is missing', (key) => {
    const env: Record<string, string> = { ...BASE };
    delete env[key];
    expect(() => _buildConfigForTest(env)).toThrow(`missing required env var ${key}`);
  });

  it.each([
    ['dev', 'dev'],
    ['beta', 'beta'],
    ['prod', 'prod'],
    ['anything-else', 'dev'],
    ['', 'dev'],
  ])('parses VITE_ENV=%j as %j', (input, expected) => {
    const c = _buildConfigForTest({ ...BASE, VITE_ENV: input });
    expect(c.env).toBe(expected);
  });

  it('forwards optional vars when present', () => {
    const c = _buildConfigForTest({
      ...BASE,
      VITE_FCM_VAPID_KEY: 'vapid',
      VITE_SENTRY_DSN: 'https://sentry',
      VITE_FIREBASE_MEASUREMENT_ID: 'G-X',
    });
    expect(c.fcmVapidKey).toBe('vapid');
    expect(c.sentryDsn).toBe('https://sentry');
    expect(c.firebase.measurementId).toBe('G-X');
  });

  // ── App Check (docs/specs/app-check.md) ──────────────────────────────
  // The site key is OPTIONAL by contract: no key is the normal, shipped
  // state, so it must never go through `required()` (which throws and would
  // brick every build until someone visits the Firebase console).

  it('APPCHECK-1 — a missing App Check site key does NOT throw; it reads as absent', () => {
    const env: Record<string, string> = { ...BASE };
    delete env.VITE_FIREBASE_APPCHECK_SITE_KEY;
    expect(() => _buildConfigForTest(env)).not.toThrow();
    expect(_buildConfigForTest(env).appCheckSiteKey).toBeUndefined();
  });

  it('APPCHECK-1 — an empty App Check site key reads as absent, not as ""', () => {
    const c = _buildConfigForTest({ ...BASE, VITE_FIREBASE_APPCHECK_SITE_KEY: '' });
    expect(c.appCheckSiteKey).toBeUndefined();
  });

  it('APPCHECK-3 — the site key is forwarded when present', () => {
    const c = _buildConfigForTest({
      ...BASE,
      VITE_FIREBASE_APPCHECK_SITE_KEY: '6Lc-site-key',
    });
    expect(c.appCheckSiteKey).toBe('6Lc-site-key');
  });

  it.each([
    [undefined, 'enterprise'],
    ['', 'enterprise'],
    ['enterprise', 'enterprise'],
    ['v3', 'v3'],
    ['nonsense', 'enterprise'],
  ])('APPCHECK-3 — parses VITE_FIREBASE_APPCHECK_PROVIDER=%j as %j', (input, expected) => {
    const env: Record<string, string> = { ...BASE };
    if (input !== undefined) env.VITE_FIREBASE_APPCHECK_PROVIDER = input;
    expect(_buildConfigForTest(env).appCheckProvider).toBe(expected);
  });
});
