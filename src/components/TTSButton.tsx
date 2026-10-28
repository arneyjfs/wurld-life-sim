import { Loader, Square, Volume1, Volume2 } from 'lucide-react';
import { speechSpeedFor } from '@/lib/level';
import { useEffect, useState } from 'react';
import {
  playTTS,
  prefetchTTS,
  subscribePlayback,
  type PlaybackState,
} from '@/lib/tts';
import { getSpeechLanguageCode } from '@/lib/languages';
import { useAuthStore } from '@/store/authStore';
import { useUserProfile } from '@/hooks/useUserProfile';
import { cn } from '@/lib/cn';
import * as log from '@/lib/log';
import { useT } from '@/i18n';

type Props = {
  /** Text to speak. */
  text: string;
  /** Practice/native language DISPLAY name. The speech code is resolved
   *  internally; if the language has no Gemini TTS support the button
   *  renders nothing (TTS-BUTTON-3). */
  language?: string;
  /** Explicit voice override. When omitted, defaults to the user's
   *  `voicePreference` (TTS-PREF-1). The Settings preview passes this
   *  explicitly so it can demo BOTH voices regardless of the setting. */
  voiceGender?: 'MALE' | 'FEMALE';
  /** TTS-VOICE-2: an explicit Gemini voice for THIS SPEAKER, overriding the
   *  gendered default. The life sim passes the voice cast for the NPC whose
   *  line this is; every other surface leaves it undefined and keeps the
   *  player's own preference (TTS-PREF-1). */
  voiceName?: string;
  /** Explicit speed override (1-5). When omitted, defaults to the user's
   *  `speechSpeed` pref (TTS-SPEED-1). The Settings preview passes the DRAFT
   *  slider value so you hear the pace change live while dragging. */
  speechSpeed?: number;
  /** Unique playback key (usually a question/message id) so a re-tap on
   *  the SAME button stops, and tapping a different button replaces. */
  playbackKey: string;
  /** Auto-play once on mount + on text change (listen-* questions). */
  autoPlay?: boolean;
  /** Prefetch the clip on mount so the first tap is instant (default true).
   *  Set false for OPTIONAL speak buttons the user usually won't tap — e.g.
   *  non-speech practice questions (multiple-choice / find-the-mistake) — so
   *  they don't cache-warm a paid clip pre-emptively (TTS-SURFACE-1). */
  warmOnMount?: boolean;
  /** Visual variant: `inline` small icon (default), `tile` big CTA, `bare`
   *  an icon with no circle or ring that sits in a line of text
   *  (TTS-BUTTON-5). */
  variant?: 'inline' | 'tile' | 'bare';
  /** Pixel size of the inline button (icon scales with it). */
  size?: number;
  className?: string;
};

/**
 * Canonical TTS speak button (docs/specs/tts.md TTS-BUTTON-*). One
 * component for every inline speak surface — practice prompts, Explain
 * cards, life-sim dialogue, the Settings voice preview.
 *
 * Three visual states, all derived from the global playback singleton
 * keyed to `playbackKey`:
 *   - idle    → speaker icon
 *   - loading → indeterminate spinner ring around the button
 *   - playing → determinate progress ring + a stop (square) glyph;
 *               tap = stop (TTS-BUTTON-2)
 *
 * Renders nothing when the language has no speech support or there's no
 * text (TTS-BUTTON-3). On failure it falls back to idle (TTS-BUTTON-4).
 */
export function TTSButton({
  text,
  language,
  voiceGender,
  voiceName,
  speechSpeed: speechSpeedProp,
  playbackKey,
  autoPlay,
  warmOnMount = true,
  variant = 'inline',
  size = 30,
  className,
}: Props) {
  const t = useT();
  const [state, setState] = useState<PlaybackState>({
    status: 'idle',
    key: null,
    progress: 0,
  });
  // Default the voice to the user's preference (TTS-PREF-1) when the
  // caller didn't force one. Reading it here means no surface has to
  // thread voiceGender down — every speak button uses the right voice.
  const uid = useAuthStore((s) => s.user?.uid ?? null);
  const profile = useUserProfile(uid);
  const resolvedGender: 'MALE' | 'FEMALE' =
    voiceGender ?? (profile.data?.voicePreference === 'male' ? 'MALE' : 'FEMALE');
  // Playback-speed pref (TTS-SPEED-1): explicit prop wins (Settings preview
  // demos the draft speed), else the user's saved pref. Undefined → server/
  // cache default to 3 (natural), so no surface has to thread it.
  const ttsCode = language ? getSpeechLanguageCode(language) : undefined;
  // TTS-SPEED-1.1 — the pace is a learning aid for the language being
  // learnt; the user's own native language always plays at natural pace
  // (any regional variant: en-US text for an en-GB speaker too).
  const nativeCode = profile.data?.nativeLanguage ? getSpeechLanguageCode(profile.data.nativeLanguage) : undefined;
  const isNative = !!ttsCode && !!nativeCode && ttsCode.split('-')[0] === nativeCode.split('-')[0];
  // TTS-SPEED-1.2 — the speed the user chose for THIS clip's language.
  const speechSpeed = speechSpeedProp ?? (isNative ? undefined : speechSpeedFor(profile.data, language));
  const canSpeak = !!ttsCode && !!text;

  useEffect(() => subscribePlayback(setState), []);

  useEffect(() => {
    if (!autoPlay || !canSpeak || !ttsCode) return;
    void playTTS(
      { text, languageCode: ttsCode, speechSpeed, voiceGender: resolvedGender, voiceName },
      { key: playbackKey },
    ).catch((err) => log.warn('tts autoplay failed', { err }));
    // Re-trigger on text change so a new question auto-reads. We key on
    // the `voiceGender` PROP, not `resolvedGender` — re-firing autoplay
    // when the profile loads (and the resolved gender flips) would
    // double-play the same clip. First-play gender is good enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, ttsCode, speechSpeed, voiceGender, voiceName, playbackKey, autoPlay, canSpeak]);

  // Warm the cache on mount when not auto-playing, so the first tap is
  // instant. Skipped when `warmOnMount` is false — optional speak buttons the
  // user rarely taps (non-speech practice questions) must not cache-warm a
  // paid clip pre-emptively (TTS-SURFACE-1); they synthesize on tap instead.
  useEffect(() => {
    if (!canSpeak || !ttsCode || autoPlay || !warmOnMount) return;
    prefetchTTS({ text, languageCode: ttsCode, speechSpeed, voiceGender: resolvedGender, voiceName });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, ttsCode, speechSpeed, voiceGender, voiceName, autoPlay, canSpeak, warmOnMount]);

  if (!canSpeak || !ttsCode) return null; // TTS-BUTTON-3

  const isThisKey = state.key === playbackKey;
  const isLoading = isThisKey && state.status === 'loading';
  const isPlaying = isThisKey && state.status === 'playing';
  const progress = isPlaying ? state.progress : 0;

  function handleTap() {
    if (!ttsCode) return;
    void playTTS(
      { text, languageCode: ttsCode, speechSpeed, voiceGender: resolvedGender, voiceName },
      { key: playbackKey },
    ).catch((err) => log.warn('tts play failed', { err }));
  }

  if (variant === 'tile') {
    return (
      <button
        type="button"
        onClick={handleTap}
        // I18N-EDGE-6 — `explain.playAudio` / `explain.pauseAudio` existed,
        // translated, uncalled. `chat.ttsStop` is new: the button says STOP,
        // not Pause, and reusing the pause string would mis-describe it.
        aria-label={isPlaying ? t('chat.ttsStop') : t('explain.playAudio')}
        className={cn(
          'flex items-center gap-2.5 px-6 py-4 rounded-2xl border transition-colors',
          'border-(--color-border) bg-(--color-bg-elevated) hover:bg-(--color-bg-hover)',
          className,
        )}
      >
        <span className="relative inline-flex items-center justify-center" style={{ width: 30, height: 30 }}>
          <ProgressRing size={30} loading={isLoading} progress={progress} />
          <span className="absolute inset-0 flex items-center justify-center text-(--color-accent)">
            {isPlaying ? (
              <Square size={16} fill="currentColor" />
            ) : (
              <Volume2 size={18} />
            )}
          </span>
        </span>
        <span className="text-sm font-semibold text-(--color-accent)">
          {isPlaying ? 'Playing…' : 'Tap to listen'}
        </span>
      </button>
    );
  }

  if (variant === 'bare') {
    // TTS-BUTTON-5 — the glyph IS the state: speaker → spinner → waves.
    // `size` is the tap target; the glyph is drawn at ~60% of it.
    const glyph = Math.round(size * 0.6);
    return (
      <button
        type="button"
        onClick={handleTap}
        aria-label={isPlaying ? t('chat.ttsStop') : t('chat.actionsReadAloud')}
        aria-busy={isLoading || undefined}
        data-state={isLoading ? 'loading' : isPlaying ? 'playing' : 'idle'}
        className={cn('inline-flex items-center justify-center', className)}
        style={{ width: size, height: size }}
      >
        {isLoading ? (
          <Loader size={glyph} className="animate-spin" />
        ) : isPlaying ? (
          <Volume2 size={glyph} />
        ) : (
          <Volume1 size={glyph} />
        )}
      </button>
    );
  }

  const icon = Math.round(size * 0.5);
  return (
    <button
      type="button"
      onClick={handleTap}
      // I18N-EDGE-6 — see the `variant="cta"` branch above.
      aria-label={isPlaying ? t('chat.ttsStop') : t('chat.actionsReadAloud')}
      className={cn(
        'relative inline-flex items-center justify-center rounded-full text-(--color-fg-muted) hover:text-(--color-fg)',
        className,
      )}
      style={{ width: size, height: size }}
    >
      <ProgressRing size={size} loading={isLoading} progress={progress} />
      <span className="absolute inset-0 flex items-center justify-center">
        {isPlaying ? (
          <Square size={Math.round(icon * 0.8)} fill="currentColor" className="text-(--color-accent)" />
        ) : (
          <Volume2 size={icon} />
        )}
      </span>
    </button>
  );
}

/**
 * The ring around the button. Indeterminate (spinning quarter-arc)
 * while loading; determinate (progress arc) while playing; invisible
 * otherwise. Pure SVG so it scales crisply at any size.
 */
function ProgressRing({
  size,
  loading,
  progress,
}: {
  size: number;
  loading: boolean;
  progress: number;
}) {
  const stroke = Math.max(2, Math.round(size * 0.08));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const showRing = loading || progress > 0;
  // Loading → fixed quarter arc that spins. Playing → arc = progress.
  const dash = loading ? c * 0.25 : c * Math.min(1, Math.max(0, progress));
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('absolute inset-0', loading && 'animate-spin')}
      aria-hidden
    >
      {showRing && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={stroke}
        />
      )}
      {showRing && (
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      )}
    </svg>
  );
}
