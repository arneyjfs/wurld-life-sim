import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { canUseHaptics } from './capabilities';

/**
 * Thin wrapper around @capacitor/haptics. Impact calls (tap / medium /
 * heavy) attempt unconditionally and fall through a multi-tier
 * fallback chain so they work across every platform that exposes ANY
 * haptic surface:
 *
 *   1. Capacitor native (iOS + Android in-app)    — real Taptic / vibrator.
 *   2. @capacitor/haptics web adapter (Android PWA Chrome) — uses
 *      navigator.vibrate internally.
 *   3. Direct navigator.vibrate fallback           — covers any browser
 *      where the Capacitor web adapter no-ops but the Vibration API
 *      is otherwise live (some Android browsers).
 *
 * iOS PWA still has no native API — neither Capacitor (no bridge in
 * pure PWA mode) nor navigator.vibrate (WebKit doesn't implement) —
 * so the call lands as a no-op there. That's a platform limit until
 * Apple ships a Web Vibration / Haptics API; nothing in this wrapper
 * can change it.
 *
 * Notification + selection helpers (success / warning / error / selection) gate on
 * `canUseHaptics()` because the Vibration-API fallback can't carry
 * their semantic meaning (success vs warning vs error) — it's just a
 * single buzz.
 */
function tryVibrate(durationMs: number): void {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') {
    return;
  }
  try {
    navigator.vibrate(durationMs);
  } catch {
    /* noop */
  }
}

async function impact(style: ImpactStyle, fallbackMs: number): Promise<void> {
  try {
    await Haptics.impact({ style });
    return;
  } catch {
    /* Capacitor unavailable or web adapter rejected — fall through. */
  }
  tryVibrate(fallbackMs);
}

export const haptics = {
  async tap(): Promise<void> {
    await impact(ImpactStyle.Light, 8);
  },
  async medium(): Promise<void> {
    await impact(ImpactStyle.Medium, 18);
  },
  async heavy(): Promise<void> {
    await impact(ImpactStyle.Heavy, 30);
  },
  async success(): Promise<void> {
    if (!canUseHaptics()) return;
    try {
      await Haptics.notification({ type: NotificationType.Success });
    } catch {
      /* noop */
    }
  },
  async warning(): Promise<void> {
    if (!canUseHaptics()) return;
    try {
      await Haptics.notification({ type: NotificationType.Warning });
    } catch {
      /* noop */
    }
  },
  /** CHROME-HAPTIC-1 — a failed action (send failure, wrong answer). */
  async error(): Promise<void> {
    if (!canUseHaptics()) return;
    try {
      await Haptics.notification({ type: NotificationType.Error });
    } catch {
      /* noop */
    }
  },
  /**
   * CHROME-HAPTIC-1 — the light "tick" of a picker / tab / switch changing
   * value. iOS's UISelectionFeedbackGenerator only fires between
   * selectionStart and selectionEnd, so the three calls go together.
   */
  async selection(): Promise<void> {
    if (!canUseHaptics()) return;
    try {
      await Haptics.selectionStart();
      await Haptics.selectionChanged();
      await Haptics.selectionEnd();
    } catch {
      /* noop */
    }
  },
};
