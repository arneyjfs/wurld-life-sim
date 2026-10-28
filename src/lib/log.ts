import { sentry, scrubRecord } from './sentry';
import { trackEvent } from './analytics';
import { toAppError } from './errors';
import { config } from './config';
import { isExpectedError, labelTags } from './sentryLabels';
import { formatLogArgs } from './devConsole/format';
import { mirrorToDevConsole } from './devConsole/mirror';

type LogPayload = Record<string, unknown> | undefined;

/**
 * DEVCON-CON-7 — feed the in-app dev console.
 *
 * On a DEPLOYED build (`env !== 'dev'`) nothing below ever calls `console.*`,
 * so `consoleCapture`'s interceptor had nothing to intercept and the panel's
 * console tab was permanently empty while its network tab worked — reported
 * 2026-08-03. Beta is precisely where the panel is useful, since that is where
 * there is no Web Inspector attached.
 *
 * In DEV this stands down: the `console.*` call below is already captured, and
 * mirroring as well would double every line.
 */
function mirror(level: 'info' | 'warn' | 'error', msg: string, data?: LogPayload): void {
  if (config.env === 'dev') return;
  mirrorToDevConsole(level, formatLogArgs(data === undefined ? [msg] : [msg, data]));
}

function logToConsole(level: 'info' | 'warn' | 'error', msg: string, data?: LogPayload) {
  // The ONLY allowed direct console use. ESLint `no-console` is permitted in
  // this file via override. We use the un-scrubbed `data` here because dev
  // logs are local-only and full fidelity is useful when debugging.
  const tag = `[${level}]`;
  if (data === undefined) {
    if (level === 'error') console.error(tag, msg);
    else if (level === 'warn') console.warn(tag, msg);
    else console.log(tag, msg);
  } else {
    if (level === 'error') console.error(tag, msg, data);
    else if (level === 'warn') console.warn(tag, msg, data);
    else console.log(tag, msg, data);
  }
}

/** Structured info log. Dev: console.log. Beta/prod: Sentry breadcrumb. */
export function info(msg: string, data?: LogPayload): void {
  if (config.env === 'dev') logToConsole('info', msg, data);
  mirror('info', msg, data);
  // Defence-in-depth: scrub PII before handing to Sentry. The SDK's
  // beforeBreadcrumb hook also scrubs, but doing it here means a
  // mis-configured Sentry (no hooks) still can't leak.
  sentry.addBreadcrumb({
    category: 'app',
    level: 'info',
    message: msg,
    data: scrubRecord(data),
  });
}

/** Structured warn. Dev: console.warn. Beta/prod: Sentry breadcrumb. */
export function warn(msg: string, data?: LogPayload): void {
  if (config.env === 'dev') logToConsole('warn', msg, data);
  mirror('warn', msg, data);
  sentry.addBreadcrumb({
    category: 'app',
    level: 'warning',
    message: msg,
    data: scrubRecord(data),
  });
}

/**
 * Error log. Dev: console.error. Beta/prod: Sentry captureException.
 * Pass the raw thrown value as the first arg; we coerce to AppError, which
 * keeps the original's name and `.code` (OBS-LABEL-4).
 *
 * `context` is run through {@link scrubRecord} before being attached as
 * Sentry `extra`. Its triage keys (`action`, `surface`, `functionName`,
 * `httpStatus`, `serverError`, `provider`, `method`, `flow`, `route`) are ALSO
 * set as tags, with `code` and `original_code` (OBS-LABEL-4/5). Every call
 * site passes `action`.
 *
 * OBS-LABEL-10 — an expected outcome (a cancel, the plan gate, user-input
 * validation; the list is `EXPECTED_ERROR_CODES` in `sentryLabels.ts`) is a
 * breadcrumb, not an event, so call sites can report every catch without
 * filtering.
 */
export function error(err: unknown, context?: LogPayload): void {
  const appErr = toAppError(err);
  const summary = `${appErr.code}: ${appErr.message}`;
  const expected = isExpectedError(appErr);
  const level = expected ? 'info' : 'error';
  if (config.env === 'dev') logToConsole(level, summary, context);
  mirror(level, summary, context);
  const tags = labelTags(appErr, context);
  if (expected) {
    sentry.addBreadcrumb({
      category: 'expected',
      level: 'info',
      message: `expected ${appErr.code}${appErr.originalCode ? ` (${appErr.originalCode})` : ''}`,
      data: scrubRecord({ ...context, ...tags }),
    });
    return;
  }
  sentry.captureException(appErr, {
    extra: scrubRecord(context),
    tags,
  });
}

/**
 * A deliberate diagnostic measurement: one Sentry message at level `info`,
 * searchable by its tags. Dev: console. The one sanctioned exception to OBS-8
 * (no performance metrics); today only NOTIF-17.6's push-tap timing uses it.
 */
export function diagnostic(
  msg: string,
  tags: Record<string, string>,
  extra?: LogPayload,
): void {
  if (config.env === 'dev') logToConsole('info', msg, { ...tags, ...extra });
  mirror('info', msg, { ...tags, ...extra });
  sentry.captureMessage(msg, { level: 'info', tags, extra: scrubRecord(extra) });
}

/** Fire-and-forget Firebase Analytics event. */
export function event(
  name: string,
  params?: Record<string, string | number | boolean>,
): void {
  void trackEvent(name, params);
  sentry.addBreadcrumb({ category: 'event', level: 'info', message: name, data: params });
}

/** Tag the current Sentry scope with the signed-in user (or clear). */
export function setUser(uid: string | null): void {
  if (uid) sentry.setUser({ id: uid });
  else sentry.setUser(null);
}
