/**
 * TTS-VOICE-1 — the Gemini prebuilt voice table, and who gets which one.
 *
 * ## Where this table came from, because guessing it would be the bug
 *
 * The server shipped with exactly TWO voices (`Iapetus` male, `Erinome`
 * female) and every character in every wurld spoke in one of them, chosen from
 * the *player's* global voice preference rather than from who was talking.
 * Owner, 2026-08-06: *"Gender of tts should be set to match the gender of the
 * speaker, maybe shuffling available voices if possible, not obeying global
 * default gender."*
 *
 * Getting a voice's gender wrong is the exact defect being fixed, so the table
 * is TRANSCRIBED from Google's own documentation, not inferred:
 *
 *   - genders — cloud.google.com/text-to-speech/docs/gemini-tts#voice_options
 *   - characteristics — ai.google.dev/gemini-api/docs/speech-generation
 *
 * Two independent pages, and they agree with the code that was already here:
 * both list `Iapetus` as male and `Erinome` as female, and both give their
 * characteristic as **Clear** — which is what `ttsSynth.ts` had called them
 * ("a fixed clear Gemini voice") since before this file existed. Three sources
 * agreeing on the two voices already in production is the reason to trust the
 * other twenty-eight.
 *
 * The live `texttospeech.googleapis.com/v1/voices` endpoint would be better
 * still, but it refuses API-key auth outright (*"API keys are not supported by
 * this API. Expected OAuth2 access token"*) — see TTS-VOICE-4.
 */

/** A voice's documented gender. Only these two exist in the Gemini table. */
export type VoiceGender = 'male' | 'female';

/**
 * REGISTER — the characteristics above, bucketed into something a character
 * sheet can plausibly ask for. The raw characteristic is kept on every row so
 * the bucketing can be re-cut without re-sourcing the table.
 *
 * Deliberately coarse. A finer set would be a mapping nobody can validate by
 * ear at review time, and the cost of a wrong bucket is a merely-odd voice
 * rather than a wrong-gendered one.
 */
export type VoiceRegister = 'warm' | 'firm' | 'bright' | 'calm' | 'rough';

export type GeminiVoice = {
  name: string;
  gender: VoiceGender;
  /** Google's own one-word description. */
  characteristic: string;
  register: VoiceRegister;
};

/** All 30 prebuilt Gemini TTS voices. Order is the docs' alphabetical order,
 *  which matters: the per-speaker pick hashes into this list, so re-ordering
 *  it silently re-casts every character in every wurld. Append, never insert. */
export const GEMINI_VOICES: readonly GeminiVoice[] = [
  { name: 'Achernar', gender: 'female', characteristic: 'Soft', register: 'calm' },
  { name: 'Achird', gender: 'male', characteristic: 'Friendly', register: 'warm' },
  { name: 'Algenib', gender: 'male', characteristic: 'Gravelly', register: 'rough' },
  { name: 'Algieba', gender: 'male', characteristic: 'Smooth', register: 'calm' },
  { name: 'Alnilam', gender: 'male', characteristic: 'Firm', register: 'firm' },
  { name: 'Aoede', gender: 'female', characteristic: 'Breezy', register: 'bright' },
  { name: 'Autonoe', gender: 'female', characteristic: 'Bright', register: 'bright' },
  { name: 'Callirrhoe', gender: 'female', characteristic: 'Easy-going', register: 'warm' },
  { name: 'Charon', gender: 'male', characteristic: 'Informative', register: 'firm' },
  { name: 'Despina', gender: 'female', characteristic: 'Smooth', register: 'calm' },
  { name: 'Enceladus', gender: 'male', characteristic: 'Breathy', register: 'rough' },
  { name: 'Erinome', gender: 'female', characteristic: 'Clear', register: 'calm' },
  { name: 'Fenrir', gender: 'male', characteristic: 'Excitable', register: 'bright' },
  { name: 'Gacrux', gender: 'female', characteristic: 'Mature', register: 'rough' },
  { name: 'Iapetus', gender: 'male', characteristic: 'Clear', register: 'calm' },
  { name: 'Kore', gender: 'female', characteristic: 'Firm', register: 'firm' },
  { name: 'Laomedeia', gender: 'female', characteristic: 'Upbeat', register: 'bright' },
  { name: 'Leda', gender: 'female', characteristic: 'Youthful', register: 'bright' },
  { name: 'Orus', gender: 'male', characteristic: 'Firm', register: 'firm' },
  { name: 'Puck', gender: 'male', characteristic: 'Upbeat', register: 'bright' },
  { name: 'Pulcherrima', gender: 'female', characteristic: 'Forward', register: 'firm' },
  { name: 'Rasalgethi', gender: 'male', characteristic: 'Informative', register: 'firm' },
  { name: 'Sadachbia', gender: 'male', characteristic: 'Lively', register: 'bright' },
  { name: 'Sadaltager', gender: 'male', characteristic: 'Knowledgeable', register: 'firm' },
  { name: 'Schedar', gender: 'male', characteristic: 'Even', register: 'calm' },
  { name: 'Sulafat', gender: 'female', characteristic: 'Warm', register: 'warm' },
  { name: 'Umbriel', gender: 'male', characteristic: 'Easy-going', register: 'warm' },
  { name: 'Vindemiatrix', gender: 'female', characteristic: 'Gentle', register: 'warm' },
  { name: 'Zephyr', gender: 'female', characteristic: 'Bright', register: 'bright' },
  { name: 'Zubenelgenubi', gender: 'male', characteristic: 'Casual', register: 'warm' },
];

/** The two the server has always used, and still falls back to. */
export const DEFAULT_VOICE: Record<VoiceGender, string> = {
  male: 'Iapetus',
  female: 'Erinome',
};

const VOICE_NAMES = new Set(GEMINI_VOICES.map((v) => v.name));

/** True for a name in the table. The server validates the same way before it
 *  will pass a client-chosen voice to Cloud TTS (TTS-VOICE-3). */
export function isKnownVoice(name: string | null | undefined): boolean {
  return !!name && VOICE_NAMES.has(name);
}

/**
 * FNV-1a. Not a security hash — it only has to spread a handful of ids evenly
 * and, crucially, be STABLE: the same character must get the same voice on
 * every turn, every session and every device, with nothing persisted.
 */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * TTS-VOICE-2 — the voice for ONE speaker.
 *
 * ## What is in the hash, and what is deliberately not
 *
 * IN: `worldId` and `speakerId`. Owner, 2026-08-06: *"hashed for each wurld
 * but not between wurlds as register changes"* — so the same character id in
 * two different wurlds is two different people and may sound different, while
 * within a wurld a character keeps one voice for its whole run.
 *
 * OUT: **`speechSpeed` and difficulty.** Same instruction: *"difficulty/speed
 * should not be part of hash and separate in the prompt so if the user changes
 * mid session it applies."* Speed is a global user setting delivered through
 * the Cloud TTS `prompt` field (TTS-SPEED-1 / TTS-STYLE-3), entirely beside
 * the voice selection — so dragging the speed slider re-synthesises the same
 * character in the same voice at a new pace, and never re-casts them.
 *
 * `register` narrows the pool when the character sheet declares one; an
 * unknown or absent register uses the whole gender pool rather than failing,
 * because a slightly-off register is a much smaller defect than no voice.
 */
export function voiceForSpeaker(input: {
  worldId: string;
  speakerId: string;
  gender: VoiceGender | null | undefined;
  register?: VoiceRegister | null;
}): string {
  const gender = input.gender ?? null;
  // No gender on the character sheet ⇒ nothing to match. Fall back to the
  // player's own preference upstream rather than guessing here; guessing is
  // what this whole invariant exists to stop.
  if (!gender) return '';

  const byGender = GEMINI_VOICES.filter((v) => v.gender === gender);
  const narrowed = input.register
    ? byGender.filter((v) => v.register === input.register)
    : [];
  const pool = narrowed.length > 0 ? narrowed : byGender;
  const idx = hash(`${input.worldId}:${input.speakerId}`) % pool.length;
  return pool[idx]!.name;
}
