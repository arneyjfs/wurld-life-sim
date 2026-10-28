/**
 * TTS-VOICE-7 — the audio for a graded question starts loading BEFORE the
 * question exists.
 *
 * Extracted from `nodeEngineActions` for the 600-LOC cap, alongside
 * `nodeEngineCardMatch` and `nodeEngineOpening`. Two functions, one subject:
 * making the line the player is about to hear arrive as early as it can, and
 * guaranteeing it is the line they actually get.
 */
import { prefetchTTS } from '@/lib/tts';
import { voiceForSpeaker } from '@/lib/ttsVoices';
import { getSpeechLanguageCode } from '@/lib/languages';
import { lifeDebug } from '@/lib/life/debugLog';
import type { GradedPlan, PracticePrompt } from '@/lib/life/stepSchema';
import type { LifeWorld } from '@/types/firestore';

/**
 * The exact line a listening variant will SPEAK, known at PLAN time.
 *
 *   comprehension  the NPC's `npcUtterance` — what they say, verbatim.
 *   fill-blank     `sentenceContext`, which IS the completed sentence: the
 *                  planner writes the whole line and names the token to blank
 *                  out, so the un-blanked form already exists before the
 *                  generator has built a single chip.
 *
 * The fill-blank half was MISSED on the first pass, on the assumption that a
 * listen-and-fill speaks something only the chips can produce. It does not —
 * it speaks the sentence the plan already wrote. MEASURED over 83 archived
 * fill-blanks: reconstructing the completed sentence from the generated
 * template + correct chip matches `sentenceContext` 96.4% of the time, and
 * every miss is punctuation spacing from the reconstruction, not a different
 * sentence. So the plan's line is not merely close, it is the source the
 * reconstruction was approximating — which is why the card is now handed THIS
 * string to speak rather than rebuilding its own.
 */
export function plannedSpokenLine(plan: GradedPlan): string {
  const line = plan.kind === 'comprehension' ? plan.npcUtterance : plan.sentenceContext;
  return line?.trim() ?? '';
}

/**
 * TTS-VOICE-7 — pre-warm the line the player is about to HEAR.
 *
 * BOTH listening kinds, because both lines are known at plan time — see
 * `plannedSpokenLine`. Warming only the comprehension half was the first
 * pass's mistake, and it left listen-and-fill synthesising on mount.
 *
 * MEASURED: the generator copies the plan's utterance verbatim in 100% of 75
 * archived comprehension questions, and the plan's `sentenceContext` matches
 * the reconstructed fill-blank sentence in 96.4% of 83 — every miss being
 * reconstruction whitespace. `pinPlannedUtterance` and `plannedSpokenLine`
 * together turn "reliably" into "always", by making the plan's line the one
 * that is BOTH warmed and spoken.
 */
export function prefetchPlannedUtterance(
  plan: GradedPlan,
  world: LifeWorld,
  speechSpeed: number | undefined,
): void {
  const text = plannedSpokenLine(plan);
  if (!text) return;
  const languageCode = getSpeechLanguageCode(world.practiceLanguage);
  if (!languageCode) return; // TTS-LANG-1: no speech for this language.
  // TTS-PREF-1: only a comprehension is someone ELSE talking. A fill-blank is
  // the line the PLAYER is about to say, so it keeps their own voice — passing
  // an NPC voice here would put the player's words in someone else's mouth.
  const npcId = plan.kind === 'comprehension' ? plan.npcId?.trim() : undefined;
  const member = npcId ? (world.cast ?? []).find((c) => c.id === npcId) : undefined;
  const gender =
    member?.gender === 'male' || member?.gender === 'female' ? member.gender : null;
  // EVERY field here must match what `TTSButton` will ask for, or this warms a
  // key nothing reads — a prefetch at the wrong speed or in the wrong voice is
  // not a slower prefetch, it is a paid clip nobody ever hears.
  prefetchTTS({
    text,
    languageCode,
    speechSpeed,
    voiceName: npcId
      ? voiceForSpeaker({ worldId: world.id, speakerId: npcId, gender, register: member?.voiceRegister ?? null })
      : undefined,
  });
}

/**
 * TTS-VOICE-7 — the generated utterance IS the planned one.
 *
 * The SI says "copy from plan, do not paraphrase" and nothing checked it, so
 * the pre-warm above would have been correct by luck. The right value is known
 * in code, so this NORMALISES rather than rejects — the same call
 * `applyGradedDirection` makes for speakerName/npcId, and for the same reason:
 * a retry could only reproduce what we already have.
 *
 * Divergence is logged, so if the model ever starts drifting the rate is
 * visible instead of silently costing a wasted synthesis per question.
 */
export function pinPlannedUtterance(
  prompt: PracticePrompt,
  plan: GradedPlan,
): PracticePrompt {
  if (plan.kind !== 'comprehension' || prompt.kind !== 'comprehension') return prompt;
  const planned = plan.npcUtterance?.trim();
  if (!planned || prompt.npcUtterance.trim() === planned) return prompt;
  lifeDebug('STEP', 'graded utterance differed from the plan — pinned', {
    planned: planned.slice(0, 120),
    generated: prompt.npcUtterance.slice(0, 120),
  });
  return { ...prompt, npcUtterance: planned };
}
