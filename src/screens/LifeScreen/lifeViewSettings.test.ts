import { describe, expect, it } from 'vitest';
import { LIFE_DEFAULT_VIEW_SETTINGS, lifeViewSettings } from '@/screens/LifeScreen/lifeViewSettings';

describe('LIFE-LANG-3 — a wurld view settings', () => {
  it('LIFE-LANG-3 — an empty world reads as practice-only (life default)', () => {
    expect(lifeViewSettings({})).toEqual({ primary: 'practice', secondRow: false });
    expect(LIFE_DEFAULT_VIEW_SETTINGS).toEqual({ primary: 'practice', secondRow: false });
  });

  it('LIFE-LANG-3 — the stored block wins', () => {
    expect(
      lifeViewSettings({ viewSettings: { primary: 'native', secondRow: true } }),
    ).toEqual({ primary: 'native', secondRow: true });
  });

  it('LIFE-LANG-3 — a block with no primary reads as the LIFE default, not chat\'s', () => {
    expect(lifeViewSettings({ viewSettings: { secondRow: true } })).toEqual({
      primary: 'practice',
      secondRow: false,
    });
  });
});
