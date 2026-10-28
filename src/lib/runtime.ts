import { Capacitor } from '@capacitor/core';

export type Runtime = 'native-ios' | 'native-android' | 'pwa-installed' | 'browser';

export function getRuntime(): Runtime {
  if (Capacitor.isNativePlatform()) {
    return Capacitor.getPlatform() === 'ios' ? 'native-ios' : 'native-android';
  }
  const standaloneIOS = (window.navigator as { standalone?: boolean }).standalone === true;
  const standaloneOther =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches;
  if (standaloneIOS || standaloneOther) return 'pwa-installed';
  return 'browser';
}

export const isNative = () => getRuntime().startsWith('native');
export const isInstalledPwa = () => getRuntime() === 'pwa-installed';
export const isPwaOrNative = () => isNative() || isInstalledPwa();
export const isBrowser = () => getRuntime() === 'browser';
