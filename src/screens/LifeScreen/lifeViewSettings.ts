/**
 * LIFE-LANG-3 — a wurld's effective view settings.
 *
 * The stored block wins; absent, the world reads as practice-only — life's
 * default, unlike chat's `DEFAULT_VIEW_SETTINGS`.
 */
import { fromStored, type StoredViewSettings, type ViewSettings } from '@/lib/viewSettings';

/** LIFE-LANG-3 — the life default: practice on top, no second row. */
export const LIFE_DEFAULT_VIEW_SETTINGS: ViewSettings = { primary: 'practice', secondRow: false };

export function lifeViewSettings(world: StoredViewSettings): ViewSettings {
  if (world.viewSettings?.primary) return fromStored(world);
  return { ...LIFE_DEFAULT_VIEW_SETTINGS };
}
