import { describe, expect, it } from 'vitest';
import type { ErrorEvent } from '@sentry/react';
import { AppError } from './errors';
import {
  applyDeviceModelTag,
  collapseRouteIds,
  isExpectedError,
  isLocalHostname,
  labelTags,
  markWrapperFramesNotInApp,
  resolveSentryEnvironment,
} from './sentryLabels';

describe('OBS-LABEL-3 — local development never reports as beta or prod', () => {
  const web = { isDevBuild: false, isNative: false };

  it('OBS-LABEL-3 — a deployed beta build on its own host reports beta', () => {
    expect(resolveSentryEnvironment({ ...web, configEnv: 'beta', hostname: 'beta.wurld.chat' })).toBe('beta');
  });

  it('OBS-LABEL-3 — a deployed prod build reports prod', () => {
    expect(resolveSentryEnvironment({ ...web, configEnv: 'prod', hostname: 'app.wurld.chat' })).toBe('prod');
  });

  it('OBS-LABEL-3 — a dev-server build reports dev whatever VITE_ENV says', () => {
    expect(resolveSentryEnvironment({ configEnv: 'beta', isDevBuild: true, isNative: false, hostname: 'app.wurld.chat' })).toBe('dev');
    expect(resolveSentryEnvironment({ configEnv: 'prod', isDevBuild: true, isNative: true, hostname: 'localhost' })).toBe('dev');
  });

  it('OBS-LABEL-3 — a beta build served from localhost / 127.* / a LAN address reports dev', () => {
    for (const hostname of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.20.3.4', '[::1]', 'mac.local']) {
      expect(resolveSentryEnvironment({ ...web, configEnv: 'beta', hostname })).toBe('dev');
    }
  });

  it('OBS-LABEL-3 — a native shell is never dev on hostname alone (capacitor://localhost is the shell origin)', () => {
    expect(resolveSentryEnvironment({ configEnv: 'prod', isDevBuild: false, isNative: true, hostname: 'localhost' })).toBe('prod');
  });

  it('OBS-LABEL-3 — isLocalHostname leaves public hosts and 172.32+ alone', () => {
    expect(isLocalHostname('wurld.chat')).toBe(false);
    expect(isLocalHostname('172.32.0.1')).toBe(false);
    expect(isLocalHostname('')).toBe(false);
    expect(isLocalHostname(undefined)).toBe(false);
  });
});

describe('OBS-LABEL-4/5 — labelTags', () => {
  it('OBS-LABEL-4 — tags code and original_code', () => {
    const e = Object.assign(new Error('x'), { code: 'unavailable' });
    const tags = labelTags(new AppError('unknown', 'x', e, { originalCode: 'unavailable' }), undefined);
    expect(tags).toMatchObject({ code: 'unknown', original_code: 'unavailable' });
  });

  it('OBS-LABEL-5 — triage context keys become snake_case tags', () => {
    const tags = labelTags(new AppError('unknown'), {
      action: 'sendMessage',
      surface: 'chat',
      functionName: 'tutorRespond',
      httpStatus: 503,
      serverError: 'model_overloaded',
      provider: 'apple',
      method: 'google',
      flow: 'link',
      unrelated: 'not a tag',
    });
    expect(tags).toEqual({
      code: 'unknown',
      action: 'sendMessage',
      surface: 'chat',
      function: 'tutorRespond',
      http_status: '503',
      server_error: 'model_overloaded',
      provider: 'apple',
      method: 'google',
      flow: 'link',
    });
  });

  it('OBS-LABEL-5 — HTTP fields on the AppError itself become tags when the context lacks them', () => {
    const err = new AppError('server/unavailable', 'callHttp deleteChat 503', undefined, {
      functionName: 'deleteChat',
      httpStatus: 503,
      serverError: 'internal',
    });
    expect(labelTags(err, { action: 'deleteChat' })).toMatchObject({
      function: 'deleteChat',
      http_status: '503',
      server_error: 'internal',
    });
  });

  it('OBS-LABEL-5 — non-primitive context values are not tags', () => {
    const tags = labelTags(new AppError('unknown'), { action: { nested: true } as unknown as string });
    expect(tags.action).toBeUndefined();
  });
});

describe('OBS-LABEL-10 — expected outcomes are not errors', () => {
  it.each([
    'auth/cancelled',
    'feature/requires-plan',
    'chat/paused',
    'chat/tutor-requires-plan',
    'auth/wrong-credentials',
    'auth/invalid-email',
    'auth/weak-password',
    'auth/invalid-code',
    'auth/email-in-use',
    'auth/invalid-phone',
  ] as const)('OBS-LABEL-10 — %s is expected', (code) => {
    expect(isExpectedError(new AppError(code))).toBe(true);
  });

  it.each(['auth/too-many-requests', 'pipeline/failed', 'server/unavailable', 'unknown', 'network/offline'] as const)(
    'OBS-LABEL-10 — %s is reported',
    (code) => {
      expect(isExpectedError(new AppError(code))).toBe(false);
    },
  );

  it('OBS-LABEL-10 — a raw Firebase cancel / user-input code is expected through originalCode', () => {
    expect(isExpectedError(new AppError('unknown', 'x', undefined, { originalCode: 'auth/popup-closed-by-user' }))).toBe(true);
    expect(isExpectedError(new AppError('unknown', 'x', undefined, { originalCode: 'auth/wrong-password' }))).toBe(true);
    expect(isExpectedError(new AppError('unknown', 'x', undefined, { originalCode: 'auth/too-many-requests' }))).toBe(false);
  });
});

describe('OBS-LABEL-11 — route ids collapse to :id', () => {
  it.each([
    ['/chat/abc123XYZ', '/chat/:id'],
    ['/chat/u1_u2/info', '/chat/:id/info'],
    ['/chat/c1/member/someUid/edit/k9', '/chat/:id/member/:id/edit/:id'],
    ['/profile/Xy7aB2cD3eF4gH5iJ6kL7mN8oP9q/add-contact', '/profile/:id/add-contact'],
    ['/contacts/view/v1/edit/c2', '/contacts/view/:id/edit/:id'],
    ['/wurlds/paris', '/wurlds/:id'],
    ['/chat/tutor', '/chat/tutor'],
    ['/wurlds/overview', '/wurlds/overview'],
    ['/settings/about', '/settings/about'],
    ['/', '/'],
    ['/practice/a8Fh2kLm9Qr3StUv4WxY', '/practice/:id'],
  ])('OBS-LABEL-11 — %s → %s', (input, expected) => {
    expect(collapseRouteIds(input)).toBe(expected);
  });
});

describe('OBS-LABEL-6 — wrapper frames are not the culprit', () => {
  it('OBS-LABEL-6 — log.ts and errors.ts frames are in_app false, the caller stays in_app', () => {
    const event = {
      exception: {
        values: [
          {
            type: 'TypeError',
            stacktrace: {
              frames: [
                { filename: 'http://localhost:5173/src/screens/ChatScreen.tsx', in_app: true },
                { filename: 'http://localhost:5173/src/lib/log.ts?t=1', in_app: true },
                { filename: 'app:///src/lib/errors.ts', in_app: true },
                { abs_path: '/src/lib/logger.ts', in_app: true },
              ],
            },
          },
        ],
      },
    } as unknown as ErrorEvent;
    const out = markWrapperFramesNotInApp(event);
    const frames = out.exception!.values![0]!.stacktrace!.frames!;
    expect(frames.map((f) => f.in_app)).toEqual([true, false, false, true]);
  });

  it('OBS-LABEL-6 — an event with no stack passes through', () => {
    const event = { message: 'x' } as ErrorEvent;
    expect(markWrapperFramesNotInApp(event)).toBe(event);
  });
});

describe('OBS-LABEL-2 — device_model tag', () => {
  it('OBS-LABEL-2 — copies the native device context model into a tag', () => {
    const event = { contexts: { device: { model: 'iPhone16,2', manufacturer: 'Apple' } } } as unknown as ErrorEvent;
    expect(applyDeviceModelTag(event).tags).toMatchObject({ device_model: 'iPhone16,2' });
  });

  it('OBS-LABEL-2 — no device context leaves tags alone', () => {
    const event = { tags: { a: 'b' } } as unknown as ErrorEvent;
    expect(applyDeviceModelTag(event).tags).toEqual({ a: 'b' });
  });
});
