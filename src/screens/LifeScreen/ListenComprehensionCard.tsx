/**
 * LIFE-EX-12: listen-and-answer — a comprehension question rendered as a
 * LISTENING exercise. The NPC's verbatim line is SPOKEN (TTS `autoPlay`) and
 * WITHHELD IN PRINT until the player answers; the chips below are the same
 * interpretations the same `life_graded_question` gen authored.
 *
 * The withholding is the exercise. Printing the utterance and adding a speaker
 * button would just be the `read` variant with audio attached — the player
 * would read it, as everyone does when text is on screen, and nothing about
 * the exercise would have changed. So the line is replaced by a replayable
 * affordance, and only the SPEAKER's name stays visible, because "who is
 * talking to me" is context, not the thing being tested.
 *
 * A pure render variant: the question, the chips, the grading and the
 * post-answer reveal (`utteranceNativeText`, LIFE-LANG-12) are untouched.
 */
import { Ear } from 'lucide-react';
import { TTSButton } from '@/components/TTSButton';
import { useT } from '@/i18n';
import type { PracticePrompt } from '@/lib/life/stepSchema';
import { CardShell } from './PracticePromptCard';

export function ListenComprehensionCard({
  prompt,
  practiceLanguage,
  voiceName,
  playbackKey,
}: {
  prompt: Extract<PracticePrompt, { kind: 'comprehension' }>;
  practiceLanguage?: string;
  /** TTS-VOICE-2: the voice cast for THIS speaker. The whole point of the
   *  variant is that the player hears a person; hearing every character in
   *  their own preferred voice is what this replaces. */
  voiceName?: string;
  /** Stable key so a re-tap on the same question stops/replays. */
  playbackKey: string;
}) {
  const t = useT();
  return (
    <CardShell
      testid="LifeScreen-ListenComprehension"
      eyebrow={
        <span className="flex items-center gap-2">
          <span>{t('life.practice.listenComprehensionEyebrow')}</span>
          <TTSButton
            text={prompt.npcUtterance}
            language={practiceLanguage}
            voiceName={voiceName}
            playbackKey={playbackKey}
            autoPlay
            size={24}
          />
        </span>
      }
    >
      {prompt.speakerName?.trim() && (
        <div
          data-testid="LifeScreen-ListenComprehension-Speaker"
          className="text-xs font-semibold text-(--color-fg-muted) mb-1"
        >
          {t('life.practice.saidBy', { name: prompt.speakerName })}
        </div>
      )}
      {/* Where the utterance would be. A muted placeholder rather than an
          empty gap, so the card keeps the same shape as its `read` twin and
          the chips below do not jump position between variants. */}
      <div
        data-testid="LifeScreen-ListenComprehension-Hidden"
        className="flex items-center gap-2 text-base font-semibold leading-snug text-(--color-fg-muted)"
      >
        <Ear size={18} className="shrink-0 text-(--color-accent)" />
        <span>{t('life.practice.listenComprehensionMasked')}</span>
      </div>
      {prompt.question.trim() && (
        <div className="text-xs text-(--color-fg-muted) mt-1.5 leading-snug">
          {prompt.question}
        </div>
      )}
    </CardShell>
  );
}
