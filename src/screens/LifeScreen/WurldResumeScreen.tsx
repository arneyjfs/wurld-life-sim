/**
 * LIFE-FLOW-5 (wurlds-v2 Phase C): "Previously, in this wurld…" —
 * the overlay a player sees when re-entering a world whose event log
 * is non-empty.
 *
 * Mirrors WorldIntroScreen's overlay pattern (fresh worlds keep THAT
 * screen; resumed worlds get this one). Assembled ENTIRELY from
 * stored data — zero LLM on the resume path:
 *   - header: saga title + tone;
 *   - "The story": saga.playerFacingTeaser (the card description);
 *   - "Chapter N": currentArc.premise;
 *   - "Previously": resumeRecap.text, else rollingSummary;
 *   - "Moments ago": the last ≤3 beat events as mini-bubbles;
 *   - "Continue" CTA → onContinue releases the resume-seeding gate.
 * Every section hides when its stored datum is absent — a degenerate
 * world still shows header + CTA (never a broken section).
 *
 * Spec: docs/specs/life-sim.md LIFE-FLOW-5.
 */
import { History } from 'lucide-react';
import type { ReactNode } from 'react';
import { useT } from '@/i18n';
import {
  resumeBubblesFromEvents,
  type ResumeBubble,
} from '@/lib/life/resumeBubbles';
import type { LifeEvent, LifeWorld } from '@/types/firestore';

export type WurldResumeScreenProps = {
  world: LifeWorld;
  /** Event window, OLDEST → NEWEST (LifeScreen's useLifeEvents). */
  events: LifeEvent[];
  onContinue: () => void;
};

export function WurldResumeScreen({
  world,
  events,
  onContinue,
}: WurldResumeScreenProps) {
  const t = useT();
  const title = world.saga?.title?.trim() || world.characterName;
  const tone = world.saga?.tone?.trim() ?? '';
  const teaser = world.saga?.playerFacingTeaser?.trim() ?? '';
  // LIFE-WORLD-ARC-REGISTER: the "this chapter" line is PLAYER-facing, so it
  // shows the spoiler-safe playerTeaser, falling back to the planner premise
  // only for legacy arcs authored before the register split.
  const premise =
    world.currentArc?.playerTeaser?.trim() || world.currentArc?.premise?.trim() || '';
  const recapStored = world.resumeRecap?.text.trim() ?? '';
  // WS1-C (LIFE-MEM-2): prefer the generated recap, then the durable
  // <storySoFar> spine (terse factual lines).
  const storyLogJoined = (world.storyLog?.entries ?? []).join(' ').trim();
  const recap = recapStored || storyLogJoined;
  const moments = resumeBubblesFromEvents(events, 3);
  return (
    <div
      data-testid="LifeScreen-WurldResume"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-(--z-life-overlay) flex items-center justify-center p-4 pb-safe-bottom pt-safe-top bg-(--color-bg)/85 backdrop-blur-sm animate-in fade-in duration-300"
    >
      <div className="max-w-md w-full max-h-full overflow-y-auto rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-6 flex flex-col gap-4 animate-in slide-in-from-bottom-4 duration-300">
        <div className="flex items-center gap-1.5 text-(--color-fg-muted) text-[11px] uppercase font-semibold tracking-wider">
          <History size={12} className="text-(--color-accent)" />
          <span>{t('life.resume.eyebrow')}</span>
        </div>
        <div>
          <h2 className="text-2xl font-semibold leading-tight text-gradient-accent">
            {title}
          </h2>
          {tone.length > 0 && (
            <p className="mt-1 text-xs italic text-(--color-fg-muted)">{tone}</p>
          )}
        </div>
        {teaser.length > 0 && (
          <div>
            <SectionLabel>{t('life.resume.story')}</SectionLabel>
            <p className="mt-1 text-sm text-(--color-fg) leading-relaxed">
              {teaser}
            </p>
          </div>
        )}
        {world.currentArc && premise.length > 0 && (
          <div data-testid="LifeScreen-WurldResume-Chapter">
            <SectionLabel>
              {t('life.resume.chapter', {
                number: world.currentArc.chapterNumber,
              })}
            </SectionLabel>
            <p className="mt-1 text-sm text-(--color-fg) leading-relaxed">
              {premise}
            </p>
          </div>
        )}
        {recap.length > 0 && (
          <div data-testid="LifeScreen-WurldResume-Recap">
            <SectionLabel>{t('life.resume.previously')}</SectionLabel>
            <p className="mt-1 text-sm text-(--color-fg) leading-relaxed whitespace-pre-line">
              {recap}
            </p>
          </div>
        )}
        {moments.length > 0 && (
          <div data-testid="LifeScreen-WurldResume-Moments">
            <SectionLabel>{t('life.resume.momentsAgo')}</SectionLabel>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {moments.map((m) => (
                <MomentBubble key={m.id} moment={m} />
              ))}
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={onContinue}
          data-testid="LifeScreen-WurldResume-Continue"
          className="mt-2 w-full shrink-0 py-3 rounded-full text-sm font-semibold bg-gradient-accent text-white"
        >
          {t('life.resume.continue')}
        </button>
      </div>
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="text-[10px] uppercase font-semibold tracking-wider text-(--color-fg-muted)">
      {children}
    </div>
  );
}

function MomentBubble({ moment }: { moment: ResumeBubble }) {
  if (moment.speaker === 'narrator') {
    // LIFE-LANG-8: narration lives in the system language (nativeText);
    // practiceText is empty on narrator beats.
    return (
      <div className="self-center px-3 text-center text-xs italic text-(--color-fg-muted)">
        {moment.nativeText || moment.practiceText}
      </div>
    );
  }
  // LIFE-LANG-8: npc/user beats carry practiceText (target language) as the
  // primary line + a system-language gloss in nativeText. Show the gloss as a
  // compact secondary line beneath the practice text — matching DialogueArea's
  // bilingual treatment (muted on the flat NPC bubble; white/80 on the gradient
  // user bubble). Rendered only when nativeText is present + non-empty.
  const gloss = moment.nativeText?.trim() ? moment.nativeText : null;
  if (moment.speaker === 'user') {
    return (
      <div className="self-end max-w-[85%] rounded-2xl rounded-br-md bg-(--color-bubble-mine) px-3 py-2 text-xs text-(--color-bubble-mine-fg)">
        {moment.practiceText}
        {gloss ? (
          <div
            data-testid="LifeScreen-WurldResume-MomentGloss"
            className="mt-0.5 text-[11px] leading-snug text-(--color-bubble-mine-fg)/80"
          >
            {gloss}
          </div>
        ) : null}
      </div>
    );
  }
  return (
    <div className="self-start max-w-[85%] rounded-2xl rounded-bl-md bg-(--color-bg-hover) border border-(--color-border)/50 px-3 py-2 text-xs text-(--color-fg)">
      {moment.speakerName ? (
        <span className="block text-[10px] font-semibold text-(--color-fg-muted)">
          {moment.speakerName}
        </span>
      ) : null}
      {moment.practiceText}
      {gloss ? (
        <div
          data-testid="LifeScreen-WurldResume-MomentGloss"
          className="mt-0.5 text-[11px] leading-snug text-(--color-fg-muted)"
        >
          {gloss}
        </div>
      ) : null}
    </div>
  );
}
