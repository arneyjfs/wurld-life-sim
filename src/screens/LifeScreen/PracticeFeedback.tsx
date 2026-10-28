/**
 * LIFE-EX-3 visual: in-chip feedback shown after the player answers
 * a graded turn. Replaces the chip grid for ~ until the user taps
 * Continue (or auto-advance if/when we add it).
 *
 * Renders correctness + reveals the correct answer + a Continue
 * button that fires the next lifeStep with practiceOutcome.
 */
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { glossForAnswer } from '@/lib/life/answerGloss';
import { useT } from '@/i18n';

type Props = {
  /** Whether the player's pick was correct. */
  correct: boolean;
  /** What the player picked. */
  picked: { practiceText: string; nativeText: string };
  /** The correct answer (same shape). */
  correctAnswer: { practiceText: string; nativeText: string };
  /** LIFE-LANG-19: the completed line's segmentation. A fill-blank chip carries
   *  `nativeText: ""` BY DESIGN — a gloss on a tappable answer telegraphs it —
   *  so the answer's meaning is read from here instead, after they answer. */
  lineVocab?: Record<string, string> | null;
  /** LIFE-EX-GEN-11: the generator already authored WHY the picked chip is
   *  wrong (`whyWrong` on the chip) — surfaced here as immediate,
   *  error-specific feedback at ZERO model cost, instead of leaving it
   *  discarded and making the player tap "Why?" for a second LLM call. */
  whyWrong?: string | null;
  /** LIFE-LANG-6: the FULL practice sentence — fill-blank = the
   *  completed sentence (blank filled with the correct token),
   *  comprehension = the NPC utterance. Always rendered so the learner
   *  sees the whole line, not just the answer token. */
  sentencePractice: string;
  /** LIFE-LANG-6: the native translation of `sentencePractice`. Always
   *  rendered so the learner sees the sentence's MEANING even for
   *  fill-blank (whose chips carry no native gloss, LIFE-LANG-1). */
  sentenceNative: string;
  /** Callback when the player taps Continue. */
  onContinue: () => void;
  /** Optional callback for the "Why?" affordance — wires to
   *  ExplainModal in Phase D. */
  onExplain?: () => void;
};

export function PracticeFeedback({
  correct,
  picked,
  correctAnswer,
  lineVocab,
  whyWrong,
  sentencePractice,
  sentenceNative,
  onContinue,
  onExplain,
}: Props) {
  // LIFE-LANG-19: the chip's own gloss when it has one (comprehension chips
  // carry a third-person interpretation), otherwise the completed line's
  // segmentation — which is where a fill-blank answer's meaning lives, because
  // its chip is mandated bare.
  const answerGloss =
    correctAnswer.nativeText.trim() || glossForAnswer(lineVocab, correctAnswer.practiceText);

  const t = useT();
  return (
    <div
      className="px-3 pt-2 pb-[max(var(--spacing-safe-bottom),1rem)] bg-(--color-bg) border-t border-(--color-border)"
      data-testid="LifeScreen-PracticeFeedback"
    >
      <div
        className={cn(
          'max-w-md mx-auto rounded-2xl px-4 py-3 flex flex-col gap-2',
          // LIFE-UI-ANIM: the feedback card slides + fades in on mount.
          'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
          correct
            ? 'bg-(--color-success)/10 border border-(--color-success)/30'
            : 'bg-(--color-danger)/10 border border-(--color-danger)/30',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-2 text-sm font-semibold',
            correct ? 'text-(--color-success)' : 'text-(--color-danger)',
          )}
        >
          {correct ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
          <span data-testid="LifeScreen-PracticeFeedback-Verdict">
            {correct
              ? t('life.feedback.correct')
              : t('life.feedback.wrong')}
          </span>
        </div>

        {!correct && (
          <div className="text-[13px] leading-snug">
            <span className="text-(--color-fg-muted)">
              {t('life.feedback.youPicked')}{' '}
            </span>
            <span dir={dirOf(picked.practiceText)} className="font-medium text-(--color-fg)">
              {picked.practiceText}
            </span>
            {picked.nativeText.trim() && (
              <span dir={dirOf(picked.nativeText)} className="text-(--color-fg-muted)"> · {picked.nativeText}</span>
            )}
            {whyWrong?.trim() && (
              <div
                data-testid="LifeScreen-PracticeFeedback-WhyWrong"
                dir={dirOf(whyWrong)}
                className="text-(--color-fg-muted) mt-0.5"
              >
                {whyWrong}
              </div>
            )}
          </div>
        )}

        <div className="text-[13px] leading-snug">
          {/* LIFE-LANG-17: "It means:" PROMISES a gloss, so it only appears
              when there is one. A fill-blank chip is a single token inside a
              sentence and legitimately carries `nativeText: ''` — its meaning
              lives on the full-sentence row below (LIFE-LANG-6). The label used
              to be unconditional while the gloss was conditional, so a correct
              fill-blank rendered "It means: voudrais", asserting that the word
              means itself. The wrong-answer label makes no such claim and is
              unaffected. */}
          {(!correct || answerGloss) && (
            <span className="text-(--color-fg-muted)">
              {correct ? t('life.feedback.meaning') : t('life.feedback.correctAnswer')}{' '}
            </span>
          )}
          <span dir={dirOf(correctAnswer.practiceText)} className="font-medium text-(--color-fg)">
            {correctAnswer.practiceText}
          </span>
          {answerGloss && (
            <span dir={dirOf(answerGloss)} className="text-(--color-fg-muted)">
              {' '}· {answerGloss}
            </span>
          )}
        </div>

        {/* LIFE-LANG-6: ALWAYS reveal the full sentence + its native
            translation. For fill-blank the answer token alone (above)
            never shows the sentence's meaning; for comprehension this is
            the verbatim utterance + its interpretation. */}
        {sentencePractice.trim() && (
          <div
            className="text-[13px] leading-snug border-t border-(--color-border)/40 pt-2"
            data-testid="LifeScreen-PracticeFeedback-FullSentence"
          >
            <span className="text-(--color-fg-muted)">
              {t('life.feedback.fullSentence')}{' '}
            </span>
            <span dir={dirOf(sentencePractice)} className="font-medium text-(--color-fg)">
              {sentencePractice}
            </span>
            {sentenceNative.trim() && (
              <span dir={dirOf(sentenceNative)} className="text-(--color-fg-muted)">
                {' '}· {sentenceNative}
              </span>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 mt-1">
          {onExplain && (
            <button
              type="button"
              onClick={onExplain}
              data-testid="LifeScreen-PracticeFeedback-Why"
              className="px-3 py-1.5 text-xs font-medium rounded-full text-(--color-fg-muted) hover:text-(--color-fg)"
            >
              {t('life.feedback.why')}
            </button>
          )}
          <button
            type="button"
            onClick={onContinue}
            data-testid="LifeScreen-PracticeFeedback-Continue"
            className="px-4 py-2 rounded-full bg-gradient-accent text-white text-sm font-semibold"
          >
            {t('life.feedback.continue')}
          </button>
        </div>
      </div>
    </div>
  );
}
