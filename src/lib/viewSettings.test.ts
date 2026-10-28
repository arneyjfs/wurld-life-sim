/**
 * MSG-VIEW-7 — the unified two-row view model.
 *
 * Spec: docs/specs/message-pipeline.md — MSG-VIEW-7;
 * docs/specs/life-sim.md — LIFE-LANG-3.
 *
 * The `viewSettings` block is the ONE stored representation (the legacy
 * `viewMode` / `vocabSwap` pair and the retired Mixed primary were migrated
 * out on 2026-09-29 — MSG-VIEW-7.2 / MSG-VIEW-7.12 are RETIRED). What is
 * worth guarding: every stored block resolves to sane rows, a second row never
 * repeats the row above it, and nothing legacy is read or written.
 */
import { describe, expect, it } from 'vitest';
import { ZStoredViewSettings } from '@/types/firestorePrimitives';
import {
  DEFAULT_VIEW_SETTINGS,
  fromStored,
  resolveViewSettings,
  rowFlags,
  secondRowLanguage,
  toStored,
  type StoredViewSettings,
  type ViewSettings,
} from './viewSettings';

const S = (p: ViewSettings['primary'], secondRow: boolean): ViewSettings =>
  ({ primary: p, secondRow });

describe('MSG-VIEW-7 — view settings model', () => {
  describe('the second row never repeats the main row', () => {
    it('practice on top → native below', () => {
      expect(secondRowLanguage(S('practice', true))).toBe('native');
    });

    it('native on top → practice below', () => {
      expect(secondRowLanguage(S('native', true))).toBe('practice');
    });

    it('the default reads practice on top, native below', () => {
      expect(secondRowLanguage(DEFAULT_VIEW_SETTINGS)).toBe('native');
      expect(DEFAULT_VIEW_SETTINGS).toEqual(S('practice', true));
    });
  });

  describe('fromStored — the block is the only source', () => {
    it('an empty doc gets the default (practice on top, native below)', () => {
      expect(fromStored(undefined)).toEqual(DEFAULT_VIEW_SETTINGS);
      expect(fromStored({})).toEqual(DEFAULT_VIEW_SETTINGS);
    });

    it('a stored block reads back as written', () => {
      expect(fromStored({ viewSettings: { primary: 'native', secondRow: true } })).toEqual(S('native', true));
      expect(fromStored({ viewSettings: { primary: 'practice', secondRow: false } })).toEqual(S('practice', false));
    });

    it('a block with a primary but no secondRow takes the default second row', () => {
      expect(fromStored({ viewSettings: { primary: 'native' } })).toEqual(S('native', true));
    });

    it('DEAD-4 — a legacy viewMode / vocabSwap on the doc is NOT read (retired 2026-09-29)', () => {
      const legacy = { viewMode: 'native-only', vocabSwap: true } as unknown as StoredViewSettings;
      expect(fromStored(legacy)).toEqual(DEFAULT_VIEW_SETTINGS);
    });

    it('DEAD-4 / MSG-VIEW-7.12 — the Zod block rejects the retired Mixed primary outright', () => {
      // No "legacy-pair precedence" and no `mixed` acceptance survive anywhere:
      // the stored schema only knows practice / native, so a stray `mixed`
      // primary fails parse (and the user-doc `.catch(undefined)` then drops
      // the whole block, which `fromStored` resolves to the default).
      expect(ZStoredViewSettings.safeParse({ primary: 'mixed', secondRow: true }).success).toBe(false);
      expect(ZStoredViewSettings.safeParse({ primary: 'practice', secondRow: true }).success).toBe(true);
      expect(ZStoredViewSettings.safeParse({ primary: 'native' }).success).toBe(true);
    });
  });

  describe('round trip', () => {
    const all: ViewSettings[] = [
      S('practice', true), S('practice', false),
      S('native', true), S('native', false),
    ];

    it.each(all)('survives toStored → fromStored: %o', (s) => {
      expect(fromStored(toStored(s))).toEqual(s);
    });

    it('DEAD-4 — toStored writes ONLY the viewSettings block', () => {
      for (const s of all) {
        expect(Object.keys(toStored(s))).toEqual(['viewSettings']);
        expect(Object.keys(toStored(s).viewSettings).sort()).toEqual(['primary', 'secondRow']);
      }
    });
  });

  describe('resolveViewSettings — chat layer over user layer', () => {
    it('falls all the way through to the default when neither layer says anything', () => {
      expect(resolveViewSettings(undefined, undefined)).toEqual(DEFAULT_VIEW_SETTINGS);
      expect(resolveViewSettings({}, {})).toEqual(DEFAULT_VIEW_SETTINGS);
    });

    it('uses the user layer when the chat carries no override', () => {
      expect(
        resolveViewSettings({}, { viewSettings: { primary: 'native', secondRow: true } }),
      ).toEqual(S('native', true));
    });

    it("the chat's own block beats the user's block", () => {
      expect(
        resolveViewSettings(
          { viewSettings: { primary: 'native', secondRow: true } },
          { viewSettings: { primary: 'practice', secondRow: false } },
        ),
      ).toEqual(S('native', true));
    });

    it('does NOT let the user layer leak past a chat-level block', () => {
      expect(
        resolveViewSettings(
          { viewSettings: { primary: 'native', secondRow: false } },
          { viewSettings: { primary: 'practice', secondRow: true } },
        ),
      ).toEqual(S('native', false));
    });

    it('DEAD-4 — a chat-level legacy pair is not an override any more', () => {
      const legacyChat = { viewMode: 'hidden' } as unknown as StoredViewSettings;
      expect(
        resolveViewSettings(legacyChat, { viewSettings: { primary: 'native', secondRow: true } }),
      ).toEqual(S('native', true));
    });
  });

  describe('rowFlags — what the bubble actually renders', () => {
    it('practice + second row = the old `visible`', () => {
      expect(rowFlags(S('practice', true))).toEqual({
        showNative: true, practiceSuppressed: false, showPracticeSecondRow: false,
      });
    });

    it('practice, no second row = the old `hidden`', () => {
      expect(rowFlags(S('practice', false))).toEqual({
        showNative: false, practiceSuppressed: false, showPracticeSecondRow: false,
      });
    });

    it('native, no second row = the old `native-only`', () => {
      expect(rowFlags(S('native', false))).toEqual({
        showNative: true, practiceSuppressed: true, showPracticeSecondRow: false,
      });
    });

    it('native on top WITH the practice row below', () => {
      expect(rowFlags(S('native', true))).toEqual({
        showNative: true, practiceSuppressed: true, showPracticeSecondRow: true,
      });
    });

    it('the eye OFF always means exactly one row, whatever the primary', () => {
      for (const p of ['practice', 'native'] as const) {
        const f = rowFlags(S(p, false));
        expect(f.showPracticeSecondRow).toBe(false);
        expect(f.showNative).toBe(p === 'native');
      }
    });
  });
});

describe('faceSettings — MSG-VIEW-3 (two faces)', () => {
  it('MSG-VIEW-3 — a flip inverts the second row, in either view mode, never adding a third row', async () => {
    const { faceSettings, rowFlags } = await import('./viewSettings');
    const hidden = { primary: 'practice', secondRow: false } as const;
    const shown = { primary: 'practice', secondRow: true } as const;
    expect(rowFlags(faceSettings(hidden, false)).showNative).toBe(false);
    expect(rowFlags(faceSettings(hidden, true)).showNative).toBe(true);
    expect(rowFlags(faceSettings(shown, false)).showNative).toBe(true);
    expect(rowFlags(faceSettings(shown, true)).showNative).toBe(false);
    const nativeShown = { primary: 'native', secondRow: true } as const;
    expect(rowFlags(faceSettings(nativeShown, true)).showPracticeSecondRow).toBe(false);
    expect(rowFlags(faceSettings({ primary: 'native', secondRow: false }, true)).showPracticeSecondRow).toBe(true);
  });
});
