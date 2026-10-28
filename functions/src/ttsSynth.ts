/**
 * Pure Gemini-TTS request logic (docs/specs/tts.md TTS-ENGINE/STYLE).
 *
 * Extracted from index.ts so the model-order, voice-mapping, and
 * difficulty→style-prompt decisions are unit-testable without importing
 * the firebase-functions runtime. The HTTP/synthesis side (fetch,
 * retry, auth) stays in index.ts and consumes these helpers.
 */

// The two Gemini TTS models on the Cloud Text-to-Speech surface. Same
// synthesize request shape; only `voice.model_name` differs, which is
// what makes fallback a one-field change (TTS-ENGINE-1/2).
export const TTS_MODELS = {
  /** GA, higher quality — the primary on EVERY surface (TTS-ENGINE-2). */
  flash: "gemini-2.5-flash-tts",
  /** Preview — the fallback only, when flash fails (TTS-ENGINE-3). */
  flashLite: "gemini-2.5-flash-lite-preview-tts",
} as const;

/** voiceGender → a fixed clear Gemini voice (TTS-ENGINE-4). Shared
 *  across both models, so the choice survives a fallback. Still the FALLBACK
 *  when a request names no voice, or names one that is not in the table. */
export const TTS_VOICES = { male: "Iapetus", female: "Erinome" } as const;

/**
 * TTS-VOICE-3 — the allowlist for a CLIENT-CHOSEN voice.
 *
 * The client picks per SPEAKER (`src/lib/ttsVoices.ts` — gender from the
 * character sheet, hashed per wurld) and sends the name. This is the reason
 * that is safe: a name off this list never reaches Cloud TTS, so a stale
 * client, a hand-crafted request or a typo degrades to the gendered default
 * instead of erroring the whole call.
 *
 * DUPLICATED from `src/lib/ttsVoices.ts` because functions cannot import from
 * the app build. A unit test over there reads THIS file and asserts the two
 * lists name the same 30 voices, so the copies cannot drift silently.
 */
export const GEMINI_VOICE_NAMES: ReadonlySet<string> = new Set([
  "Achernar", "Achird", "Algenib", "Algieba", "Alnilam", "Aoede",
  "Autonoe", "Callirrhoe", "Charon", "Despina", "Enceladus", "Erinome",
  "Fenrir", "Gacrux", "Iapetus", "Kore", "Laomedeia", "Leda",
  "Orus", "Puck", "Pulcherrima", "Rasalgethi", "Sadachbia", "Sadaltager",
  "Schedar", "Sulafat", "Umbriel", "Vindemiatrix", "Zephyr", "Zubenelgenubi",
]);

/**
 * Model order for a request: flash first, lite as the fallback, on every
 * surface (TTS-ENGINE-2). Same-surface, so the payload is identical across
 * the two attempts.
 */
export function ttsModelOrder(): readonly string[] {
  return [TTS_MODELS.flash, TTS_MODELS.flashLite];
}

/** MALE/male/FEMALE/female → a Gemini voice name; defaults to female. */
export function ttsVoiceForGender(voiceGender: string | undefined): string {
  return (voiceGender ?? "").toUpperCase() === "MALE"
    ? TTS_VOICES.male
    : TTS_VOICES.female;
}

/**
 * TTS-VOICE-3 — resolve the voice for one request.
 *
 * An explicit `voiceName` wins WHEN IT IS IN THE TABLE, so the life sim can
 * cast a character (TTS-VOICE-2); anything else falls back to the gendered
 * default. Deliberately silent about a rejected name: the caller is a
 * possibly-stale client, and a wrong-sounding voice is a far better outcome
 * than a failed synthesis on the one call the player is waiting for.
 */
export function ttsVoiceFor(
  voiceName: string | undefined,
  voiceGender: string | undefined,
): string {
  if (voiceName && GEMINI_VOICE_NAMES.has(voiceName)) return voiceName;
  return ttsVoiceForGender(voiceGender);
}

/**
 * Speech-speed → style prompt (TTS-SPEED-1), INDEPENDENT of difficulty, applied
 * on EVERY surface — chat, practice, explain, life-sim. The scale (1-4):
 *   1 "Clearer" / 2 "Clear"  → progressively clearer, more distinct articulation
 *                              (clarity, NOT slowness — never stilted/dragged);
 *   3 "Natural" (the DEFAULT) → `undefined`, no prompt → full natural native pace
 *                              (a user who never touches the slider pays no extra
 *                              latency and hears the natural voice everywhere);
 *   4 "Fluent"               → fast, very casual native speech with reductions,
 *                              for advanced ears.
 */
export function speechSpeedPrompt(speed: number): string | undefined {
  const n = Math.max(1, Math.min(4, Math.round(speed)));
  switch (n) {
    case 1:
      return "Speak clearly and distinctly with careful articulation, at a natural, easy-to-follow pace — clear and unhurried, but never rushed AND never stilted or artificially slow.";
    case 2:
      return "Speak at a natural pace with clear, well-formed articulation — everyday natural speech, just a touch more careful and distinct than fast casual chatter.";
    case 4:
      return "Speak quickly and very casually, at the fast, flowing pace of a fluent native chatting with a close friend — relaxed, with the natural contractions, elisions and reductions of rapid everyday speech. Never so rushed it becomes unclear.";
    default:
      return undefined; // level 3 — full natural native pace, the default
  }
}

/**
 * Resolve the spoken `text` + optional style `prompt` for a request. The prompt
 * comes from the user's `speechSpeed` pref and is applied on ALL surfaces
 * (TTS-SPEED-1); it is `undefined` at the default speed. Clips the text
 * defensively to the Cloud TTS ~4k-byte cap (TTS-EDGE-5).
 */
export function ttsInputFor(
  text: string,
  speechSpeed: number,
): { text: string; prompt?: string } {
  const spoken = text.length > 4000 ? text.slice(0, 4000) : text;
  const prompt = speechSpeedPrompt(speechSpeed);
  return prompt ? { text: spoken, prompt } : { text: spoken };
}

// ---------------------------------------------------------------------------
// TTS-ENGINE-7 — audio-output token accounting.
//
// Gemini-TTS bills TWO things: text-input tokens and AUDIO-OUTPUT tokens, at
// 25 audio tokens per second of synthesised speech. Audio output is by far the
// larger of the two (at the published rates it is ~400x the per-token input
// price), so recording `0` output — which this path did until now — reported
// TTS at roughly 0.3% of its real cost.
//
// The Cloud TTS `synthesize` response carries no usage metadata, so the token
// count is DERIVED from the audio we were returned. Deriving from the audio
// (not from the input text length) keeps the estimate honest when the model
// speaks faster or slower than the text would suggest.

/** Gemini-TTS audio-token rate: 25 tokens per second of audio. */
export const TTS_AUDIO_TOKENS_PER_SECOND = 25;

const MPEG_BITRATES_V1_L3 = [
  0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0,
] as const;
const MPEG_BITRATES_V2_L3 = [
  0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0,
] as const;
const MPEG_SAMPLE_RATES: Record<number, readonly number[]> = {
  3: [44100, 48000, 32000], // MPEG-1
  2: [22050, 24000, 16000], // MPEG-2
  0: [11025, 12000, 8000], // MPEG-2.5
};

/**
 * Duration of a constant-bitrate MP3, in seconds, from its first frame header.
 *
 * Returns `null` when no frame sync is found in the first 4 KiB (not an MP3,
 * a WAV wrapper, or a truncated body) — the caller then falls back rather than
 * recording a wrong number. CBR is the right assumption here: Cloud TTS emits
 * CBR MP3, and a VBR stream would only skew the estimate, not break it.
 */
export function mp3DurationSeconds(audio: Buffer): number | null {
  const limit = Math.min(audio.length - 4, 4096);
  for (let i = 0; i < limit; i += 1) {
    // Frame sync: 11 set bits.
    if (audio[i] !== 0xff || (audio[i + 1]! & 0xe0) !== 0xe0) continue;
    const versionBits = (audio[i + 1]! >> 3) & 0x03;
    const layerBits = (audio[i + 1]! >> 1) & 0x03;
    if (versionBits === 1 || layerBits !== 0x01) continue; // reserved version / not Layer III
    const bitrateIndex = (audio[i + 2]! >> 4) & 0x0f;
    const sampleRateIndex = (audio[i + 2]! >> 2) & 0x03;
    if (bitrateIndex === 0 || bitrateIndex === 15 || sampleRateIndex === 3) continue;
    const table = versionBits === 3 ? MPEG_BITRATES_V1_L3 : MPEG_BITRATES_V2_L3;
    const kbps = table[bitrateIndex]!;
    const sampleRate = MPEG_SAMPLE_RATES[versionBits]?.[sampleRateIndex];
    if (!kbps || !sampleRate) continue;
    // Audio payload = everything from the first frame on.
    const payloadBytes = audio.length - i;
    return (payloadBytes * 8) / (kbps * 1000);
  }
  return null;
}

/**
 * Billed audio-output tokens for a synthesis response.
 *
 * `base64Audio` is what the Cloud TTS call returned. When the duration cannot
 * be parsed we fall back to a words-per-second estimate over the spoken text —
 * an approximation, but one that is the right ORDER OF MAGNITUDE, which a
 * hard-coded 0 was not.
 */
export function ttsAudioTokens(base64Audio: string, spokenText: string): number {
  let seconds: number | null = null;
  try {
    seconds = mp3DurationSeconds(Buffer.from(base64Audio, "base64"));
  } catch {
    seconds = null;
  }
  if (seconds === null || !Number.isFinite(seconds) || seconds <= 0) {
    // ~2.5 words/second is ordinary conversational pacing.
    const words = spokenText.trim().split(/\s+/).filter(Boolean).length;
    seconds = Math.max(1, words / 2.5);
  }
  return Math.ceil(seconds * TTS_AUDIO_TOKENS_PER_SECOND);
}
