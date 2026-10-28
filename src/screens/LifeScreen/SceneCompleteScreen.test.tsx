import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SceneCompleteScreen } from './SceneCompleteScreen';
import type { PractisedWord } from '@/lib/life/vocabRecap';

const BASE = {
  title: 'The Gallery Show',
  summary: 'Your photos made the wall.',
  tone: 'hopeful',
  stats: {
    gradedCount: 4,
    correctCount: 3,
    generationCount: 2,
    generationCorrect: 2,
    comprehensionCount: 2,
    comprehensionCorrect: 1,
  },
  onClose: () => {},
};

const word = (
  text: string,
  translation: string | null = null,
): PractisedWord => ({ text, translation, correct: true });

describe('SceneCompleteScreen — LIFE-VOCAB-RECAP-2', () => {
  it('LIFE-VOCAB-RECAP-2 — renders the practised-words list with text + gloss', () => {
    render(
      <SceneCompleteScreen
        {...BASE}
        words={[word('voudrais'), word('la boulangerie', 'the bakery')]}
      />,
    );
    expect(screen.getByTestId('LifeScreen-VocabRecap')).toBeInTheDocument();
    // LIFE-VOCAB-RECAP-6: the heading covers graded AND met-in-the-story
    // words, since the list now carries both; the per-row marker is what
    // distinguishes them.
    expect(screen.getByText('Words from today')).toBeInTheDocument();
    expect(screen.getAllByTestId('LifeScreen-VocabRecap-Row')).toHaveLength(2);
    expect(screen.getByText('voudrais')).toBeInTheDocument();
    // LIFE-VOCAB-RECAP-4: the gloss is now a sibling span inside the row's
    // primary line rather than its own chip text node.
    expect(screen.getByText('the bakery')).toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-2 — empty list renders no recap section', () => {
    render(<SceneCompleteScreen {...BASE} words={[]} />);
    expect(screen.queryByTestId('LifeScreen-VocabRecap')).not.toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-4 — every word is listed; there is NO cap', () => {
    // The chip list capped at 12 with a "+3 more" chip. That cap is gone on
    // purpose: rows are saveable now, and a word the player cannot reach is a
    // word they cannot keep. Truncating a results list also hides exactly the
    // thing a summary exists to show.
    const words = Array.from({ length: 15 }, (_, i) => word(`mot-${i}`));
    render(<SceneCompleteScreen {...BASE} words={words} />);
    expect(screen.getAllByTestId('LifeScreen-VocabRecap-Row')).toHaveLength(15);
    expect(screen.queryByTestId('LifeScreen-VocabRecap-More')).not.toBeInTheDocument();
  });

  it('LIFE-VOCAB-RECAP-4 — the row carries its graded outcome', () => {
    render(
      <SceneCompleteScreen
        {...BASE}
        words={[
          { text: 'voudrais', translation: 'would like', correct: true },
          { text: 'quand même', translation: 'even so', correct: false },
          { text: 'tablier', translation: 'apron', correct: null },
        ]}
      />,
    );
    const rows = screen.getAllByTestId('LifeScreen-VocabRecap-Row');
    // null = met in the story but never tested; it must not claim either
    // outcome.
    expect(rows.map((r) => r.getAttribute('data-correct'))).toEqual([
      'true',
      'false',
      'untested',
    ]);
  });

  it('LIFE-SCENE-25 — a resolved scene is a SCENE, not a day', () => {
    // It said "Day complete" until 2026-08, when a scene stopped being a day.
    // Several scenes now run in one sitting, so that fired three times an
    // evening — and the teaser under it invited the player back tomorrow while
    // they were plainly still playing.
    render(<SceneCompleteScreen {...BASE} words={[]} />);
    expect(screen.getByText('Scene complete')).toBeInTheDocument();
    expect(screen.queryByText('Day complete')).not.toBeInTheDocument();
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-Tomorrow'),
    ).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-SceneComplete-Tomorrow')).not.toHaveTextContent(
      /tomorrow/i,
    );
  });

  it('LIFE-DAY-1 — no continuation teaser when the CHAPTER is ending too', () => {
    // The chapter screen follows immediately with "Continue your wurld".
    // Closing the story down one beat before offering to carry on contradicts
    // itself.
    render(<SceneCompleteScreen {...BASE} words={[]} chapterAlsoEnding />);
    expect(screen.getByText('Scene complete')).toBeInTheDocument();
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-Tomorrow'),
    ).not.toBeInTheDocument();
  });

  it('LIFE-DAY-3 — offers a practice session built from the words you missed', () => {
    const onPractiseMissed = vi.fn();
    render(
      <SceneCompleteScreen
        {...BASE}
        practiceLanguage="French"
        onPractiseMissed={onPractiseMissed}
        words={[
          { text: 'tablier', translation: 'apron', correct: false },
          { text: 'voudrais', translation: 'would like', correct: true },
        ]}
      />,
    );
    const cta = screen.getByTestId('LifeScreen-SceneComplete-PractiseMissed');
    expect(cta).toHaveTextContent('Practise the one you missed');
    fireEvent.click(cta);
    const href = onPractiseMissed.mock.calls[0]![0] as string;
    expect(href).toContain('/cards/practice?');
    expect(href).toContain('count=1');
    // URLSearchParams, not decodeURIComponent: the value is form-encoded, so
    // spaces come back as '+' and only the parser undoes that.
    const intent = new URLSearchParams(href.split('?')[1]).get('intent')!;
    expect(intent).toContain('tablier (apron)');
    // The word they got RIGHT must not be in the session.
    expect(intent).not.toContain('voudrais');
  });

  it('LIFE-DAY-3 — no mistakes, no CTA', () => {
    // An empty "practise your mistakes" session is worse than no button.
    render(
      <SceneCompleteScreen
        {...BASE}
        words={[{ text: 'voudrais', translation: 'would like', correct: true }]}
      />,
    );
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-PractiseMissed'),
    ).not.toBeInTheDocument();
  });
});

/**
 * LIFE-DAY-4 — when the day's scene ALSO concludes the chapter, this screen
 * is the only thing standing between the player and the chapter summary.
 * Sending them "home" leaves the larger milestone somewhere they have no
 * reason to look, so the button leads there instead and a banner says why.
 */
describe('LIFE-DAY-4 — the day that also ends the chapter', () => {
  it('sends the player to the chapter summary instead of home', () => {
    render(<SceneCompleteScreen {...BASE} words={[]} chapterAlsoEnding />);
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-Return').textContent,
    ).toMatch(/chapter summary/i);
  });

  it('marks the chapter ending with its own celebration', () => {
    render(<SceneCompleteScreen {...BASE} words={[]} chapterAlsoEnding />);
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-ChapterEnd'),
    ).toBeInTheDocument();
  });

  it('an ordinary day does NOT offer the chapter summary, and has no chapter banner', () => {
    render(<SceneCompleteScreen {...BASE} words={[]} />);
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-Return').textContent,
    ).not.toMatch(/chapter summary/i);
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-ChapterEnd'),
    ).toBeNull();
  });
});

/**
 * LIFE-SCENE-31 — the card leads with what the WORLD recorded.
 *
 * REPLACES the LIFE-SCENE-28 block that used to live here, which asserted the
 * practice-language `outcomeLine` and its system-language twin. That line is
 * the resolution BEAT, and LIFE-SCENE-30 already parks this overlay behind a
 * chip so the player reads it in the story first — so the summary slot was
 * spent re-showing a sentence they had finished reading one screen earlier.
 *
 * What belongs here is the line `runSceneClose` wrote: the compacted record
 * every later turn reads back as history, so the card and the story cannot
 * disagree about what happened. It is system-language by construction (the
 * close reasons in the system language), which is why the gloss LIFE-SCENE-28
 * added is not needed — this line is already readable.
 */
describe('SceneCompleteScreen — LIFE-SCENE-31', () => {
  it("leads with the world's record", () => {
    render(
      <SceneCompleteScreen
        {...BASE}
        summary="You settled the account with Mathieu and kept the upper plot."
        words={[]}
      />,
    );
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-Summary'),
    ).toHaveTextContent('You settled the account with Mathieu and kept the upper plot.');
  });

  it('holds the slot with a placeholder while the close is still in flight', () => {
    // The close is a separate generation kicked off by the resolving turn. It
    // usually lands before the player promotes the chip; when it has not, the
    // card must not jump or render an empty rule.
    render(<SceneCompleteScreen {...BASE} summary={null} words={[]} />);
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-SummaryPending'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-Summary'),
    ).toBeNull();
  });

  it('treats a whitespace-only summary as still pending', () => {
    render(<SceneCompleteScreen {...BASE} summary="   " words={[]} />);
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-Summary'),
    ).toBeNull();
  });

  it('no longer shows the resolution beat — the player just read it', () => {
    const { container } = render(
      <SceneCompleteScreen {...BASE} summary="The account is settled." words={[]} />,
    );
    expect(
      container.querySelector('[data-testid="LifeScreen-SceneComplete-Outcome"]'),
    ).toBeNull();
  });
});

/**
 * LIFE-SCENE-29 — the single CTA said "Return home" and then called
 * `continueTurn()`. It resumed the story, which is the opposite of what it
 * promised. Two buttons now, each saying what it actually does.
 */
describe('SceneCompleteScreen — LIFE-SCENE-29', () => {
  it('the primary CTA says it CONTINUES the story, because that is what it does', () => {
    const onClose = vi.fn();
    render(
      <SceneCompleteScreen
        {...BASE}
        onClose={onClose}
        onReturnToWurlds={vi.fn()}
        words={[]}
      />,
    );
    const cta = screen.getByTestId('LifeScreen-SceneComplete-Return');
    expect(cta).toHaveTextContent('Continue the story');
    // The old copy is the actual defect — assert it is gone, not merely that
    // the new copy is present.
    expect(cta).not.toHaveTextContent(/return home/i);
    fireEvent.click(cta);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a SECOND button leaves the wurld, and it is the one that says so', () => {
    const onClose = vi.fn();
    const onReturnToWurlds = vi.fn();
    render(
      <SceneCompleteScreen
        {...BASE}
        onClose={onClose}
        onReturnToWurlds={onReturnToWurlds}
        words={[]}
      />,
    );
    const exit = screen.getByTestId('LifeScreen-SceneComplete-ReturnToWurlds');
    expect(exit).toHaveTextContent('Return to Wurlds home');
    fireEvent.click(exit);
    expect(onReturnToWurlds).toHaveBeenCalledTimes(1);
    // …and it did NOT also resume the story.
    expect(onClose).not.toHaveBeenCalled();
  });

  it('the chapter-ending path keeps ONE button — the chapter screen owns the exit', () => {
    // Offering "return to Wurlds" here would skip the chapter summary that
    // follows immediately, which is the larger of the two milestones.
    render(
      <SceneCompleteScreen
        {...BASE}
        chapterAlsoEnding
        onReturnToWurlds={vi.fn()}
        words={[]}
      />,
    );
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-Return'),
    ).toHaveTextContent(/chapter summary/i);
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-ReturnToWurlds'),
    ).toBeNull();
  });

  it('renders one button when the caller supplies no exit handler', () => {
    render(<SceneCompleteScreen {...BASE} words={[]} />);
    expect(
      screen.queryByTestId('LifeScreen-SceneComplete-ReturnToWurlds'),
    ).toBeNull();
  });

  it('both buttons go inert while a close is in flight', () => {
    render(
      <SceneCompleteScreen
        {...BASE}
        onReturnToWurlds={vi.fn()}
        closing
        words={[]}
      />,
    );
    expect(screen.getByTestId('LifeScreen-SceneComplete-Return')).toBeDisabled();
    expect(
      screen.getByTestId('LifeScreen-SceneComplete-ReturnToWurlds'),
    ).toBeDisabled();
  });
});

/**
 * LIFE-DAY-6 — the per-type cells are SCORES, not tallies.
 *
 * "6 fill-blank · 4 comprehension · 70% accuracy" reads the same for a player
 * who aced one type and missed the other as for one who was evenly mediocre.
 */
describe('SceneCompleteScreen — LIFE-DAY-6', () => {
  it('renders each exercise type as correct/total, not a bare count', () => {
    render(
      <SceneCompleteScreen
        {...BASE}
        stats={{
          gradedCount: 5,
          correctCount: 2,
          generationCount: 3,
          generationCorrect: 2,
          comprehensionCount: 2,
          comprehensionCorrect: 0,
        }}
        words={[]}
      />,
    );
    expect(screen.getByTestId('LifeScreen-SceneComplete-FillBlank')).toHaveTextContent('2/3');
    expect(screen.getByTestId('LifeScreen-SceneComplete-Comprehension')).toHaveTextContent(
      '0/2',
    );
  });

  it('keeps the day-wide accuracy alongside the two fractions', () => {
    // Two fractions do not read as a day's result at a glance; the per-type
    // scores ADD to the grid rather than replacing the headline.
    render(
      <SceneCompleteScreen
        {...BASE}
        stats={{
          gradedCount: 5,
          correctCount: 2,
          generationCount: 3,
          generationCorrect: 2,
          comprehensionCount: 2,
          comprehensionCorrect: 0,
        }}
        words={[]}
      />,
    );
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('renders 0/0 for a type the day never asked, rather than hiding the cell', () => {
    // A day with no comprehension questions is a fact about the day worth
    // seeing, and a grid whose cells come and go is harder to read.
    render(
      <SceneCompleteScreen
        {...BASE}
        stats={{
          gradedCount: 3,
          correctCount: 3,
          generationCount: 3,
          generationCorrect: 3,
          comprehensionCount: 0,
          comprehensionCorrect: 0,
        }}
        words={[]}
      />,
    );
    expect(screen.getByTestId('LifeScreen-SceneComplete-Comprehension')).toHaveTextContent(
      '0/0',
    );
  });
});

/** LIFE-UI-15 — viewport-anchored, not scene-anchored. This is the one the
 *  owner reported: "the modal is also not vertically centred". */
describe('SceneCompleteScreen — LIFE-UI-15', () => {
  it('is fixed to the viewport, with safe-area padding on both edges', () => {
    render(<SceneCompleteScreen {...BASE} words={[]} />);
    const root = screen.getByTestId('LifeScreen-SceneComplete');
    expect(root.className).toContain('fixed inset-0');
    expect(root.className).not.toContain('absolute');
    expect(root.className).toContain('pt-safe-top');
    expect(root.className).toContain('pb-safe-bottom');
  });
});

/**
 * LIFE-SCENE-31.1 — the summary slot's three states.
 *
 * Reported: *"the what happened section … just hangs indefinitely."* The
 * TIMING was already right — `runSceneClose` starts in the same synchronous
 * block that arms the card-match review, so it has the whole review to land in.
 * What was missing is a terminal state: this slot rendered a pulsing
 * placeholder for `summary === null` unconditionally, and the close has three
 * silent failure modes, so any of them shimmered for ever.
 *
 * A shimmer is a PROMISE that something is coming. These three tests are the
 * contract that it is only shown when something actually is.
 */
describe('LIFE-SCENE-31.1 — the summary reaches a terminal state', () => {
  it('IN FLIGHT: null + not done → the pulsing placeholder', () => {
    render(<SceneCompleteScreen {...BASE} summary={null} words={[]} />);
    expect(screen.getByTestId('LifeScreen-SceneComplete-SummaryPending')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-SceneComplete-SummaryUnavailable'))
      .not.toBeInTheDocument();
  });

  it('THE BUG: null + DONE → a terminal line, never the shimmer', () => {
    render(<SceneCompleteScreen {...BASE} summary={null} summaryDone words={[]} />);
    expect(screen.getByTestId('LifeScreen-SceneComplete-SummaryUnavailable')).toBeInTheDocument();
    expect(screen.queryByTestId('LifeScreen-SceneComplete-SummaryPending'))
      .not.toBeInTheDocument();
  });

  it('LANDED: the record wins over both, done or not', () => {
    render(<SceneCompleteScreen {...BASE} summary="Your photos made the wall." summaryDone words={[]} />);
    expect(screen.getByTestId('LifeScreen-SceneComplete-Summary'))
      .toHaveTextContent('Your photos made the wall.');
    expect(screen.queryByTestId('LifeScreen-SceneComplete-SummaryUnavailable'))
      .not.toBeInTheDocument();
  });

  it('a whitespace-only record is NOT a record — it falls to the terminal line', () => {
    // `cleanText` can yield '' and the engine's fallback can be empty too, so
    // the guard has to be on the trimmed value rather than on nullishness.
    render(<SceneCompleteScreen {...BASE} summary="   " summaryDone words={[]} />);
    expect(screen.getByTestId('LifeScreen-SceneComplete-SummaryUnavailable')).toBeInTheDocument();
  });
});
