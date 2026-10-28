import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { PlaybackState } from '@/lib/tts';

/**
 * Spec: docs/specs/tts.md TTS-BUTTON-*. The button gates on speech
 * support, drives its icon from the playback singleton, and plays with
 * the user's preferred voice.
 */

const playTTS = vi.fn((..._a: unknown[]): Promise<void> => Promise.resolve());
const prefetchTTS = vi.fn((..._a: unknown[]): void => undefined);
let emit: ((s: PlaybackState) => void) | null = null;

vi.mock('@/lib/tts', () => ({
  playTTS: (...a: unknown[]) => playTTS(...a),
  prefetchTTS: (...a: unknown[]) => prefetchTTS(...a),
  subscribePlayback: (fn: (s: PlaybackState) => void) => {
    emit = fn;
    fn({ status: 'idle', key: null, progress: 0 });
    return () => {
      emit = null;
    };
  },
}));

// Speech supported for 'French', unsupported for 'Irish (Gaeilge)'.
vi.mock('@/lib/languages', () => ({
  getSpeechLanguageCode: (name: string) =>
    name === 'French' ? 'fr-FR' : name.startsWith('English') ? (name.includes('US') ? 'en-US' : 'en-GB') : undefined,
}));

vi.mock('@/store/authStore', () => ({
  useAuthStore: (sel: (s: { user: { uid: string } }) => unknown) =>
    sel({ user: { uid: 'u1' } }),
}));

let voicePreference: 'male' | 'female' = 'male';
let speechSpeed: number | undefined;
vi.mock('@/hooks/useUserProfile', () => ({
  useUserProfile: () => ({ data: { voicePreference, speechSpeed, nativeLanguage: 'English (British)' } }),
}));

import { TTSButton } from './TTSButton';

beforeEach(() => {
  playTTS.mockClear();
  prefetchTTS.mockClear();
  voicePreference = 'male';
  speechSpeed = undefined;
});

describe('TTS-BUTTON-3 — gating', () => {
  it('renders nothing when the language has no speech support', () => {
    const { container } = render(
      <TTSButton text="dia dhuit" language="Irish (Gaeilge)" playbackKey="k" />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders nothing when there is no text', () => {
    const { container } = render(
      <TTSButton text="" language="French" playbackKey="k" />,
    );
    expect(container.querySelector('button')).toBeNull();
  });

  it('renders a speak button for a supported language', () => {
    render(<TTSButton text="bonjour" language="French" playbackKey="k" />);
    expect(screen.getByRole('button', { name: /read aloud/i })).toBeInTheDocument();
  });
});

describe('TTS-BUTTON-2 / TTS-PREF-1 — playback + voice', () => {
  it('tapping plays with the resolved (preference) voice and key', () => {
    render(<TTSButton text="bonjour" language="French" playbackKey="msg:1" />);
    fireEvent.click(screen.getByRole('button'));
    expect(playTTS).toHaveBeenCalledTimes(1);
    const [req, opts] = playTTS.mock.calls[0]!;
    expect(req).toMatchObject({ languageCode: 'fr-FR', voiceGender: 'MALE' });
    expect(opts).toMatchObject({ key: 'msg:1' });
  });

  it('an explicit voiceGender overrides the preference (settings preview)', () => {
    render(
      <TTSButton text="bonjour" language="French" voiceGender="FEMALE" playbackKey="k" />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(playTTS.mock.calls[0]![0]).toMatchObject({ voiceGender: 'FEMALE' });
  });

  it('shows the Stop affordance while THIS key is playing', () => {
    render(<TTSButton text="bonjour" language="French" playbackKey="k" />);
    expect(screen.getByRole('button', { name: /read aloud/i })).toBeInTheDocument();
    act(() => emit?.({ status: 'playing', key: 'k', progress: 0.4 }));
    expect(screen.getByRole('button', { name: /stop/i })).toBeInTheDocument();
  });

  it('autoPlay fires playTTS on mount; non-autoPlay prefetches instead', () => {
    const { unmount } = render(
      <TTSButton text="bonjour" language="French" playbackKey="k" autoPlay />,
    );
    expect(playTTS).toHaveBeenCalledTimes(1);
    expect(prefetchTTS).not.toHaveBeenCalled();
    unmount();
    playTTS.mockClear();
    render(<TTSButton text="salut" language="French" playbackKey="k2" />);
    expect(prefetchTTS).toHaveBeenCalledTimes(1);
    expect(playTTS).not.toHaveBeenCalled();
  });
});

describe('TTS-SPEED-1.1 — the native language always plays at natural pace', () => {
  const spoken = () => (playTTS.mock.calls.at(-1)![0] as { speechSpeed?: number }).speechSpeed;

  it('TTS-SPEED-1.1 — the practice language uses the speechSpeed pref', () => {
    speechSpeed = 1;
    render(<TTSButton text="bonjour" language="French" playbackKey="k" />);
    fireEvent.click(screen.getByRole('button'));
    expect(spoken()).toBe(1);
  });

  it('TTS-SPEED-1.1 — the native language ignores it (any regional variant)', () => {
    speechSpeed = 1;
    render(<TTSButton text="hello" language="English (US)" playbackKey="k" />);
    fireEvent.click(screen.getByRole('button'));
    expect(spoken()).toBeUndefined();
  });

  it('TTS-SPEED-1.1 — an explicit speechSpeed prop still wins (the Settings preview)', () => {
    render(<TTSButton text="hello" language="English (British)" playbackKey="k" speechSpeed={2} />);
    fireEvent.click(screen.getByRole('button'));
    expect(spoken()).toBe(2);
  });
});

describe('TTS-BUTTON-5 — the bare variant', () => {
  const bare = () => render(<TTSButton text="bonjour" language="French" playbackKey="vocab:1" variant="bare" size={24} />);

  it('TTS-BUTTON-5 — idle: a bare speaker, no ring, no circle', () => {
    const { container } = bare();
    const btn = screen.getByRole('button', { name: /read aloud/i });
    expect(btn).toHaveAttribute('data-state', 'idle');
    expect(btn.className).not.toMatch(/rounded-full/);
    // The default variant's ProgressRing is an svg with circles; the bare one
    // draws only the glyph.
    expect(container.querySelectorAll('circle')).toHaveLength(0);
  });

  it('TTS-BUTTON-5 — loading: a spinning glyph replaces the speaker', () => {
    bare();
    act(() => emit?.({ status: 'loading', key: 'vocab:1', progress: 0 }));
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-state', 'loading');
    expect(btn.querySelector('.animate-spin')).not.toBeNull();
    // The spoked Loader, as on the card's save button, not Loader2's arc.
    const cls = btn.querySelector('.animate-spin')!.getAttribute('class') ?? '';
    expect(cls).toMatch(/lucide-loader\b/);
    expect(cls).not.toMatch(/loader-circle|loader-2/);
  });

  it('TTS-BUTTON-5 — playing: speaker with waves, labelled Stop, and a tap toggles', () => {
    bare();
    act(() => emit?.({ status: 'playing', key: 'vocab:1', progress: 0.4 }));
    const btn = screen.getByRole('button', { name: /stop/i });
    expect(btn).toHaveAttribute('data-state', 'playing');
    fireEvent.click(btn);
    expect(playTTS).toHaveBeenCalledTimes(1);
  });

  it('TTS-BUTTON-5 — another key playing leaves this one idle', () => {
    bare();
    act(() => emit?.({ status: 'playing', key: 'msg:9', progress: 0.4 }));
    expect(screen.getByRole('button')).toHaveAttribute('data-state', 'idle');
  });
});
