import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorldArcCompleteScreen } from './WorldArcCompleteScreen';
import type { WorldArc } from '@/types/firestore';
import type { PractisedWord } from '@/lib/life/vocabRecap';

const ARC: WorldArc = {
  chapterNumber: 2,
  premise: 'Prove yourself at the gallery.',
  playerTeaser: 'Prove yourself at the gallery.',
  themes: [],
  status: 'completed',
  recurringNpcIds: [],
  completedSceneMemories: [],
};

const BASE = {
  arc: ARC,
  stats: { campaignsCompleted: 3, gradedCount: 12, correctCount: 9 },
  recurringNpcNames: ['Sophie'],
  keyWords: [] as PractisedWord[],
  generatingNext: false,
  onContinue: () => {},
  onPause: () => {},
};

describe('WorldArcCompleteScreen — LIFE-VOCAB-RECAP-2', () => {
  it('LIFE-DAY-2 — recaps the DAYS the chapter was made of', () => {
    // One row per resolved scene, from the arc's own memories — the thing
    // the day screen cannot show, and what a chapter recap is actually for.
    const arc = {
      ...ARC,
      completedSceneMemories: [
        { sceneId: 'c1', title: 'The Usher', endingKey: 'k1', summary: 'You found the door.', keyMomentsForArc: [] },
        { sceneId: 'c2', title: 'The Gallery', endingKey: 'k2', summary: 'Sophie said yes.', keyMomentsForArc: [] },
      ],
    };
    render(<WorldArcCompleteScreen {...BASE} arc={arc} />);
    expect(screen.getAllByTestId('LifeScreen-WorldArcComplete-Day')).toHaveLength(2);
    expect(screen.getByText('The Usher')).toBeInTheDocument();
    expect(screen.getByText(/Sophie said yes\./)).toBeInTheDocument();
  });

  /**
   * LIFE-SCENE-35 — the day list is BILINGUAL.
   *
   * LIFE-SCENE-28 made both completion cards bilingual and reasoned that the
   * arc's persistence record could stay single-language because nobody read
   * it. LIFE-SCENE-31 then made that record the chapter card's LEAD content
   * and dropped the bilingual blockquote above it — so the premise of the
   * carve-out stopped being true in the same commit that relied on it, and no
   * test noticed because neither invariant's own assertions changed.
   */
  it('LIFE-SCENE-35 — each day shows the practice line AND its native twin', () => {
    const arc = {
      ...ARC,
      completedSceneMemories: [
        {
          sceneId: 'c1',
          title: 'La Cour des Pétales',
          endingKey: 'k1',
          summary: 'Rémy a refusé de te remettre la lettre.',
          summaryNative: 'Rémy refused to hand you the letter.',
          keyMomentsForArc: [],
        },
      ],
    };
    render(<WorldArcCompleteScreen {...BASE} arc={arc} />);
    expect(screen.getByText(/Rémy a refusé de te remettre la lettre\./)).toBeInTheDocument();
    expect(
      screen.getByTestId('LifeScreen-WorldArcComplete-DayNative'),
    ).toHaveTextContent('Rémy refused to hand you the letter.');
  });

  it('LIFE-SCENE-35 — a legacy memory with no twin renders ONE line, not an empty row', () => {
    // Every chapter recorded before this shipped. A blank second row is worse
    // than none: it reads as a translation that failed.
    const arc = {
      ...ARC,
      completedSceneMemories: [
        { sceneId: 'c1', title: 'The Usher', endingKey: 'k1', summary: 'You found the door.', keyMomentsForArc: [] },
      ],
    };
    render(<WorldArcCompleteScreen {...BASE} arc={arc} />);
    expect(screen.queryByTestId('LifeScreen-WorldArcComplete-DayNative')).toBeNull();
  });

  it('LIFE-SCENE-35 — a whitespace-only twin counts as absent', () => {
    const arc = {
      ...ARC,
      completedSceneMemories: [
        { sceneId: 'c1', title: 'T', endingKey: 'k', summary: 'S', summaryNative: '   ', keyMomentsForArc: [] },
      ],
    };
    render(<WorldArcCompleteScreen {...BASE} arc={arc} />);
    expect(screen.queryByTestId('LifeScreen-WorldArcComplete-DayNative')).toBeNull();
  });

  it('LIFE-DAY-2 — does NOT restate the day screen practised-words list', () => {
    // The day screen showed these already, WITH save buttons. Repeating them
    // one modal later gave the player the same rows and a second set of save
    // buttons that knew nothing about the first.
    render(<WorldArcCompleteScreen {...BASE} />);
    expect(screen.queryByTestId('LifeScreen-VocabRecap')).not.toBeInTheDocument();
  });

  it('LIFE-DAY-2 — looks forward to the next chapter', () => {
    render(<WorldArcCompleteScreen {...BASE} />);
    expect(
      screen.getByTestId('LifeScreen-WorldArcComplete-NextTeaser'),
    ).toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-4 — STORY vocab is saveable too, even though it was never graded', () => {
    // The key-words list is ungraded by construction — those words were met in
    // the narrative, not tested — but "was it quizzed?" has nothing to do with
    // "is it worth keeping". Rendering it as reference-only chips made a whole
    // chapter's vocabulary unsaveable.
    render(
      <WorldArcCompleteScreen
        {...BASE}
        keyWords={[{ text: 'le tablier', translation: 'the apron', correct: null }]}
        uid="u1"
        practiceLanguage="French"
        nativeLanguage="English"
      />,
    );
    const rows = screen.getAllByTestId('LifeScreen-KeyWords-Row');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.getAttribute('data-correct')).toBe('untested');
    // The save affordance is what makes it more than a list.
    expect(within(rows[0]!).getByRole('button')).toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-3 — renders the chapter KEY WORDS list under its own heading', () => {
    const keyWords: PractisedWord[] = [
      { text: 'le tableau', translation: 'the painting', correct: null },
    ];
    render(<WorldArcCompleteScreen {...BASE} keyWords={keyWords} />);
    expect(screen.getByTestId('LifeScreen-KeyWords')).toBeInTheDocument();
    expect(screen.getByText('Key words this chapter')).toBeInTheDocument();
    expect(screen.getByText('le tableau')).toBeInTheDocument();
  });
});

/** LIFE-UI-15 — viewport-anchored, not scene-anchored. See WorldIntroScreen. */
describe('WorldArcCompleteScreen — LIFE-UI-15', () => {
  it('is fixed to the viewport, with safe-area padding on both edges', () => {
    render(<WorldArcCompleteScreen {...BASE} />);
    const root = screen.getByTestId('LifeScreen-WorldArcComplete');
    expect(root.className).toContain('fixed inset-0');
    expect(root.className).not.toContain('absolute');
    expect(root.className).toContain('pt-safe-top');
    expect(root.className).toContain('pb-safe-bottom');
  });
});

/**
 * LIFE-SCENE-31 — the chapter card leads with its RECORD.
 *
 * REPLACES the LIFE-SCENE-28 block here, which asserted the resolving scene's
 * practice line and its gloss. The day list below it was always the better
 * answer to "what was this chapter": it is one line per resolved scene, drawn
 * from the arc's own memories, and it is what a chapter recap is FOR. It just
 * sat under a single beat of the last day.
 *
 * The beat is gone for the same reason as on the scene screen — LIFE-SCENE-30
 * parks these overlays behind a chip so the player reads the resolution in the
 * story first, which made re-showing it here a second look at a sentence they
 * had just finished.
 */
describe('WorldArcCompleteScreen — LIFE-SCENE-31', () => {
  it('leads with the chapter record and no longer shows the resolution beat', () => {
    const arc = {
      ...ARC,
      completedSceneMemories: [
        { sceneId: 'c1', title: 'The Usher', endingKey: 'k1', summary: 'You found the door.', keyMomentsForArc: [] },
      ],
    };
    const { container } = render(<WorldArcCompleteScreen {...BASE} arc={arc} />);
    expect(
      screen.getByTestId('LifeScreen-WorldArcComplete-Days'),
    ).toBeInTheDocument();
    expect(
      container.querySelector('[data-testid="LifeScreen-WorldArcComplete-Outcome"]'),
    ).toBeNull();
  });
});
