/**
 * LIFE-EX-1 / LIFE-EX-4: the header card rendered above the chip
 * grid on a graded turn. Two flavours via the discriminated
 * practicePrompt union:
 *
 *   - fill-blank (outbound): "Complete the sentence" header +
 *     practice-language template with the blank highlighted. The
 *     chips below fill the gap.
 *
 *   - comprehension (inbound): "What did they just say?" header +
 *     the NPC's verbatim utterance highlighted. The chips below
 *     are candidate interpretations.
 *
 * Spec: docs/specs/life-sim.md §10.
 */
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { useT } from '@/i18n';
import type { PracticePrompt } from '@/lib/life/stepSchema';

type Props = {
  prompt: PracticePrompt;
  /** LIFE-EX-8.1 — the player must PRODUCE the answer (type-to-fill) rather
   *  than recognise it among chips.
   *
   *  RETAINED but no longer load-bearing: it existed solely to force the
   *  native anchor on for production, and LIFE-EX-8.2 now shows the anchor
   *  unconditionally. Kept on the props so the two call sites still say which
   *  variant they are — deleting it would lose that at the call site — but
   *  nothing here branches on it any more. */
  production?: boolean;
};

export function PracticePromptCard({ prompt, production: _production = false }: Props) {
  const t = useT();
  if (prompt.kind === 'generation') {
    // LIFE-EX-8.2 — the native line is shown on EVERY fill-blank.
    //
    // It used to be gated on the generator declaring `translation-anchor`,
    // i.e. on its own judgement that the options were interchangeable without
    // it. `context-anchor` meant "the sentence discriminates on its own" and
    // hid the native, which is the richer exercise — when the claim is true.
    //
    // MEASURED 2026-08-05 over 360 context-anchor fill-blanks from 17 stored
    // runs, classifying each wrong chip by the reason the generator itself
    // gave for it: **91% were separated purely by MEANING, with no grammatical
    // cue anywhere in the set.** Which is the exact case the design says
    // requires the translation. Real examples, all `context-anchor`:
    //
    //   "War der ___ heute schon hier?"  — teacher / driver / visitor / DIRECTOR
    //   "Maestro, quiero ___ con el Codex." — to study / to speak / to work
    //
    // Every one of those chips is grammatical and sensible in the sentence.
    // Owner-reported, twice now: *"any word could work and there was no target
    // sentence."* The generator is not judging badly at the margin — it is
    // asserting a discriminator it does not check, which is the same shape as
    // every other self-declared field that turned out to be decorative.
    //
    // So the flag is no longer trusted to hide anything. `completedNativeText`
    // is already REQUIRED on every fill-blank (`runGradedQuestionGenerate`
    // rejects it as missing) and was present on 419 of 419 generated in those
    // runs, so there is nothing to fall back to and nothing to guard.
    //
    // The cost is the ~9% of sets that genuinely turn on form — "Je ___ un
    // café": veux / veut / veulent. Showing "I want a coffee" there does not
    // give the answer away, because the question is the agreement, not the
    // verb. Redundant, not spoiling. `disambiguation` stays on the schema: it
    // still shapes how the GENERATOR builds a set, it is simply no longer
    // allowed to remove the anchor from the player.
    const anchor = prompt.completedNativeText?.trim()
    return (
      <CardShell
        eyebrow={t('life.practice.fillBlankEyebrow')}
        testid="LifeScreen-PracticePrompt-FillBlank"
      >
        {anchor ? (
          <div
            data-testid="LifeScreen-PracticePrompt-Anchor"
            dir={dirOf(anchor)}
            className="text-xs text-(--color-fg-muted) mb-1.5 leading-snug"
          >
            {t('life.practice.sayThis', { text: anchor })}
          </div>
        ) : null}
        <PracticeTextWithBlank text={prompt.practiceText} />
      </CardShell>
    );
  }
  return (
    <CardShell
      eyebrow={t('life.practice.comprehensionEyebrow')}
      testid="LifeScreen-PracticePrompt-Comprehension"
    >
      {prompt.speakerName?.trim() && (
        <div
          data-testid="LifeScreen-PracticePrompt-Speaker"
          className="text-xs font-semibold text-(--color-fg-muted) mb-1"
        >
          {t('life.practice.saidBy', { name: prompt.speakerName })}
        </div>
      )}
      <div dir={dirOf(prompt.npcUtterance)} className="text-base font-semibold leading-snug text-(--color-fg)">
        “{prompt.npcUtterance}”
      </div>
      {prompt.question.trim() && (
        <div className="text-xs text-(--color-fg-muted) mt-1.5 leading-snug">
          {prompt.question}
        </div>
      )}
    </CardShell>
  );
}

/** Shared accent-bordered header shell — reused by the listen-and-fill card
 *  (LIFE-EX-9). `eyebrow` may be a node so a variant can inline an affordance
 *  (e.g. the listen button) beside the label. */
export function CardShell({
  eyebrow,
  testid,
  children,
}: {
  eyebrow: React.ReactNode;
  testid: string;
  children: React.ReactNode;
}) {
  return (
    <div
      data-testid={testid}
      className={cn(
        'mx-auto max-w-md w-full',
        'px-4 py-2.5 rounded-2xl',
        'bg-(--color-bg-elevated) border border-(--color-accent)/30',
        'shadow-[0_2px_8px_-4px_rgba(115,64,245,0.25)]',
        // LIFE-UI-ANIM: the question prompt card slides + fades in on mount.
        'motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-2 motion-safe:duration-200',
      )}
    >
      <div className="text-[10px] font-bold uppercase tracking-wider text-(--color-accent) mb-1">
        {eyebrow}
      </div>
      {children}
    </div>
  );
}

/** Renders a fill-blank sentence, highlighting the `___` token as a
 *  pill-shaped placeholder so the user's eye lands on what they need
 *  to complete. Exported for the listen-and-fill variant (LIFE-EX-9). */
export function PracticeTextWithBlank({ text }: { text: string }) {
  // Split around the FIRST `___` occurrence (extra blanks left
  // untreated — the model is instructed to emit exactly one).
  const idx = text.indexOf('___');
  if (idx === -1) {
    return (
      <div dir={dirOf(text)} className="text-base font-semibold leading-snug text-(--color-fg)">
        {text}
      </div>
    );
  }
  const before = text.slice(0, idx);
  const after = text.slice(idx + 3);
  return (
    <div dir={dirOf(text)} className="text-base font-semibold leading-snug text-(--color-fg)">
      <span>{before}</span>
      <span
        aria-label="blank"
        className="inline-block min-w-[2.5rem] px-2 mx-0.5 rounded-md bg-(--color-accent)/15 text-(--color-accent) align-baseline"
      >
        ___
      </span>
      <span>{after}</span>
    </div>
  );
}
