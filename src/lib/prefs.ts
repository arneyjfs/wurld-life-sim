import { Preferences } from '@capacitor/preferences';
import { Capacitor } from '@capacitor/core';

/**
 * Unified key/value persistence.
 *   - Native (iOS/Android): @capacitor/preferences — uses platform secure
 *     storage (UserDefaults / SharedPreferences). Survives app updates and
 *     OS reboots.
 *   - Web/PWA: localStorage. Browsers can clear under storage pressure but
 *     in practice this is durable enough for theme / lang prefs / draft text.
 *
 * Values are stringified by the caller; this layer does not enforce a schema.
 */

const useNative = Capacitor.isNativePlatform();

export const prefs = {
  async get(key: string): Promise<string | null> {
    if (useNative) {
      const { value } = await Preferences.get({ key });
      return value;
    }
    return localStorage.getItem(key);
  },
  async set(key: string, value: string): Promise<void> {
    if (useNative) {
      await Preferences.set({ key, value });
      return;
    }
    localStorage.setItem(key, value);
  },
  async remove(key: string): Promise<void> {
    if (useNative) {
      await Preferences.remove({ key });
      return;
    }
    localStorage.removeItem(key);
  },
  async clear(): Promise<void> {
    if (useNative) {
      await Preferences.clear();
      return;
    }
    localStorage.clear();
  },
};
