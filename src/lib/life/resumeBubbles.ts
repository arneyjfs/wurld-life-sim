/**
 * LIFE-FLOW-2 / LIFE-FLOW-5: derive the bubble window + resume chip
 * the player sees when they come back into an existing life world.
 * Reads trailing beat events from the events log + maps them back
 * into Bubble objects the dialogue area (and the WurldResumeScreen's
 * "Moments ago" strip) can render directly.
 *
 * LIFE-BUBBLE-7: beat events persist `complexWords` +
 * `wordTranslations` (ZLifeBeatPayload); rehydrating them here keeps
 * resumed bubbles vocab-tappable. A legacy `swapWords` key (LIFE-LANG-18,
 * retired) on an old event is ignored — only the fields below are copied.
 *
 * Pulled out of LifeScreen so the screen stays focused on UI state.
 */
import type { MessageKey, TParams } from '@/i18n';
import type { StepChoice } from './stepSchema';
import type { LifeEvent } from '@/types/firestore';

export type ResumeBubble = {
  id: string;
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  npcId?: string | null;
  practiceText: string;
  nativeText: string | null;
  complexWords?: string[];
  wordTranslations?: Record<string, string>;
};

export function resumeBubblesFromEvents(
  events: ReadonlyArray<LifeEvent>,
  count = 2,
): ResumeBubble[] {
  return events
    .filter((e) => e.kind === 'beat')
    .slice(-count)
    .map((e, i) => {
      const p = (e.payload ?? {}) as {
        speaker?: 'narrator' | 'npc' | 'user';
        speakerName?: string | null;
        npcId?: string | null;
        practiceText?: string;
        nativeText?: string | null;
        complexWords?: string[];
        wordTranslations?: Record<string, string>;
      };
      return {
        id: `resume-${e.id ?? i}`,
        speaker: p.speaker ?? 'narrator',
        speakerName: p.speakerName ?? null,
        npcId: p.npcId ?? null,
        practiceText: p.practiceText ?? '',
        nativeText: p.nativeText ?? null,
        complexWords: p.complexWords ?? undefined,
        wordTranslations: p.wordTranslations ?? undefined,
      };
    })
    // Keep any beat with content on EITHER channel. LIFE-LANG-8:
    // narrator beats carry their narration in `nativeText` and leave
    // `practiceText` empty, so a practiceText-only gate would drop every
    // narrator beat from the resume window. Truly-blank beats (no text on
    // either side) are still dropped so the surface never renders empty.
    .filter((b) => b.practiceText.length > 0 || (b.nativeText?.length ?? 0) > 0);
}

/** LIFE-FLOW-2: the dialogue seed LifeScreen applies once the player
 *  dismisses the WurldResumeScreen (LIFE-FLOW-5) — last-2 beat
 *  bubbles (or a narrator fallback) + the single '__resume__' chip.
 *  Takes `t` as a plain function so this module stays React-free. */
export function buildResumeSeed(
  events: ReadonlyArray<LifeEvent>,
  t: (key: MessageKey, params?: TParams) => string,
): { bubbles: ResumeBubble[]; choices: StepChoice[] } {
  const beatBubbles = resumeBubblesFromEvents(events);
  const bubbles: ResumeBubble[] =
    beatBubbles.length > 0
      ? beatBubbles
      : [
          {
            id: 'resume',
            speaker: 'narrator',
            practiceText: t('life.resume.prompt.practice'),
            nativeText: t('life.resume.prompt.native'),
          },
        ];
  return {
    bubbles,
    choices: [
      {
        id: '__resume__',
        practiceText: t('life.resume.continue.practice'),
        nativeText: t('life.resume.continue.native'),
      },
    ],
  };
}
