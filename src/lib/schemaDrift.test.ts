import { beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

/**
 * OBS-COVER-9 — parseDoc drift goes through `log` (no raw console): the first
 * drift per schema per session is an event, later ones breadcrumbs.
 * Spec: docs/specs/observability.md.
 */
const logMock = vi.hoisted(() => ({ warn: vi.fn(), info: vi.fn(), error: vi.fn() }));
vi.mock('@/lib/log', () => logMock);
vi.mock('./log', () => logMock);

import { parseDoc } from '@/types/firestore';

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  logMock.error.mockReset();
  logMock.warn.mockReset();
});

describe('OBS-COVER-9 — schema drift', () => {
  it('OBS-COVER-9 — the first drift on a schema is one log.error with paths, never ids or values', async () => {
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const schema = z.object({ id: z.string(), name: z.string() });
    expect(parseDoc(schema, 'doc-id-secret', { name: 42 })).toBeNull();
    await vi.waitFor(() => expect(logMock.error).toHaveBeenCalledTimes(1));
    const ctx = logMock.error.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(ctx).toMatchObject({ action: 'parseDoc' });
    expect(String(ctx.issuePaths)).toContain('name');
    expect(JSON.stringify(ctx)).not.toContain('doc-id-secret');
    expect(JSON.stringify(ctx)).not.toContain('42');
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleWarn.mockRestore();
  });

  it('OBS-COVER-9 — later drifts on the same schema are breadcrumbs', async () => {
    const schema = z.object({ id: z.string(), n: z.number() });
    parseDoc(schema, 'a', { n: 'x' });
    parseDoc(schema, 'b', { n: 'y' });
    await vi.waitFor(() => expect(logMock.warn).toHaveBeenCalled());
    await settle();
    expect(logMock.error).toHaveBeenCalledTimes(1);
  });
});
