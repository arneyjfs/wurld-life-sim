import type { Analytics } from 'firebase/analytics';
import { firebaseApp } from './firebase';
import { config } from './config';

let analyticsPromise: Promise<Analytics | null> | null = null;

function getAnalyticsInstance(): Promise<Analytics | null> {
  if (analyticsPromise) return analyticsPromise;
  if (!config.firebase.measurementId) {
    analyticsPromise = Promise.resolve(null);
    return analyticsPromise;
  }
  // BOOT-SPLIT-8: the SDK loads on first use, not at boot.
  analyticsPromise = import('firebase/analytics')
    .then(async ({ isSupported, getAnalytics }) => ((await isSupported()) ? getAnalytics(firebaseApp) : null))
    .catch(() => null);
  return analyticsPromise;
}

export async function trackEvent(
  name: string,
  params?: Record<string, string | number | boolean>,
): Promise<void> {
  const a = await getAnalyticsInstance();
  if (!a) return;
  const { logEvent } = await import('firebase/analytics');
  logEvent(a, name, params);
}

