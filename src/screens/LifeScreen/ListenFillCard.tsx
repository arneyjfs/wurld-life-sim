/**
 * LIFE-EX-9: listen-and-fill — a fill-blank graded turn rendered as a LISTENING
 * exercise. The COMPLETED practice sentence (the template with the correct word
 * substituted) is spoken aloud (TTS `autoPlay`, so it loads + plays the instant
 * the exercise appears — never before, honouring the lazy-TTS stance); the
 * player sees the template with its blank and picks / types the word they HEARD.
 *
 * It is a pure render variant of a normal fill-blank (same one authored
 * `life_graded_question` gen, same chips) — the only additions are the spoken
 * sentence + the "listen" framing. Grading is unchanged.
 */
import { TTSButton } from '@/components/TTSButton';
import { useT } from '@/i18n';
import type { PracticePrompt } from '@/lib/life/stepSchema';
import { CardShell, PracticeTextWithBlank } from './PracticePromptCard';

export function ListenFillCard({
  prompt,
  completedSentence,
  practiceLanguage,
  playbackKey,
}: {
  /** The fill-blank prompt (template with `___`). */
  prompt: Extract<PracticePrompt, { kind: 'generation' }>;
  /** The template with the CORRECT word filled in — what TTS speaks. */
  completedSentence: string;
  practiceLanguage?: string;
  /** Stable key so a re-tap on the same question stops/replays. */
  playbackKey: string;
}) {
  const t = useT();
  return (
    <CardShell
      testid="LifeScreen-ListenFill"
      eyebrow={
        <span className="flex items-center gap-2">
          <span>{t('life.practice.listenFillEyebrow')}</span>
          {/* autoPlay speaks the completed sentence the moment the exercise
              mounts. */}
          <TTSButton
            text={completedSentence}
            language={practiceLanguage}
            playbackKey={playbackKey}
            autoPlay
            size={24}
          />
        </span>
      }
    >
      <PracticeTextWithBlank text={prompt.practiceText} />
      <div className="text-xs text-(--color-fg-muted) mt-1.5 leading-snug">
        {t('life.practice.listenFillHint')}
      </div>
    </CardShell>
  );
}
