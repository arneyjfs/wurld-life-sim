import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ViewSettings } from '@/lib/viewSettings';

// TTSButton transitively imports the Firebase-backed tts lib — stub it
// so this component test stays hermetic.
vi.mock('@/components/TTSButton', () => ({
  TTSButton: () => null,
}));

// LIFE-LANG-16: force reduced-motion so the flip's height glide + scaleX
// flourish resolve INSTANTLY (no lingering DOM during the close animation) —
// the animation is visual-only and covered by screenshot review, while these
// tests assert the reveal LOGIC (gloss present after flip, gone after un-flip).
vi.mock('./nodeEngineGlide', async (importActual) => ({
  ...(await importActual<typeof import('./nodeEngineGlide')>()),
  prefersReducedMotion: () => true,
}));

import { DialogueArea, type Bubble } from './DialogueArea';
import { buildResolvedBubble } from '@/lib/life/resolvedBubble';
import {
  gradedDirection,
  type GradedDirection,
} from '@/lib/life/gradedQuestionEngine';
import { useVocabStore } from '@/store/vocabStore';
import { useFlippedBubbleStore } from '@/store/flippedBubbleStore';
import { __resetFlipHintForTest } from '@/lib/life/lifeFlipHint';
import type { LifeWordSave } from './useLifeWordSave';
// LIFE-NODE-12 — the beat-entrance numbers + the per-speaker direction map.
// `vi.mock` above spreads `importActual`, so these are the REAL values.
import {
  BEAT_STAGGER_MS,
  GLIDE_ENTER_MS,
  GLIDE_ENTER_TRAVEL_PX,
  beatEnterOffsetX,
} from './nodeEngineGlide';

// MSG-BUBBLE-12.12 — the flip's turn CHASES the finger through a rAF driver
// rather than following it, so the face no longer swaps inside the pointer
// event. These tests assert the reveal LOGIC, not the timing, so the harness
// drives the driver to completion synchronously; jsdom's own rAF fires on a
// real timer, which would make every assertion below a race.
let frames: Array<() => void> = [];
let clock = 0;

beforeEach(() => {
  frames = [];
  clock = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: () => void) => frames.push(cb));
  vi.stubGlobal('cancelAnimationFrame', () => undefined);
  vi.stubGlobal('performance', { now: () => clock });
});
afterEach(() => vi.unstubAllGlobals());

/** Run the turn driver until it stops scheduling. */
function settleFlip(max = 120) {
  for (let i = 0; i < max && frames.length > 0; i++) {
    clock += 16;
    const due = frames;
    frames = [];
    act(() => due.forEach((f) => f()));
  }
}

/** Fire a leftward swipe (the chat flip gesture) across an element. */
function swipeLeft(el: Element) {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 200, clientY: 100 });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 130, clientY: 101 });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 130, clientY: 101 });
  settleFlip();
}

const npcBubble: Bubble = {
  id: 'b1',
  speaker: 'npc',
  speakerName: 'Sophie',
  practiceText: 'Bonjour !',
  nativeText: 'Hello!',
};
const userBubble: Bubble = {
  id: 'b2',
  speaker: 'user',
  practiceText: 'Salut Sophie',
  nativeText: 'Hi Sophie',
};
// LIFE-LANG-8 (v2): narration is now the PRACTICE language + gloss + vocab,
// the same one-channel model as dialogue.
const narratorBubble: Bubble = {
  id: 'b3',
  speaker: 'narrator',
  practiceText: 'Le soleil se lève.',
  nativeText: 'The sun rises.',
  complexWords: ['lève'],
  wordTranslations: { lève: 'rises' },
};

/** MSG-VIEW-7: the cases are stated in the three historical view modes and
 *  mapped onto the two-row model the way the redesign defined them, so the
 *  table stays readable ("visible" / "hidden" / "native-only"). */
type LegacyViewMode = 'visible' | 'hidden' | 'native-only';
function vs(viewMode: LegacyViewMode): ViewSettings {
  if (viewMode === 'native-only') return { primary: 'native', secondRow: false };
  return { primary: 'practice', secondRow: viewMode === 'visible' };
}

function renderArea(
  bubbles: Bubble[],
  viewMode: LegacyViewMode,
  hideNativeForUtterance: string | null = null,
) {
  return render(
    <DialogueArea
      bubbles={bubbles}
      characterName="Marc"
      viewSettings={vs(viewMode)}
      hideNativeForUtterance={hideNativeForUtterance}
    />,
  );
}

describe('DialogueArea viewMode (LIFE-LANG-3/4)', () => {
  it('LIFE-LANG-3 — visible shows practice + native on npc/user bubbles', () => {
    renderArea([npcBubble, userBubble], 'visible');
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Bonjour !');
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Hello!');
    expect(screen.getByTestId('LifeScreen-Bubble-user')).toHaveTextContent('Salut Sophie');
    expect(screen.getByTestId('LifeScreen-Bubble-user')).toHaveTextContent('Hi Sophie');
  });

  it('LIFE-LANG-3 — native-only shows ONLY nativeText', () => {
    renderArea([npcBubble, userBubble], 'native-only');
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Hello!');
    expect(npc).not.toHaveTextContent('Bonjour !');
    const user = screen.getByTestId('LifeScreen-Bubble-user');
    expect(user).toHaveTextContent('Hi Sophie');
    expect(user).not.toHaveTextContent('Salut Sophie');
  });

  it('LIFE-LANG-8 (v2) — narrator renders practiceText primary + gloss (visible), like dialogue', () => {
    renderArea([narratorBubble, npcBubble], 'visible');
    const nar = screen.getByTestId('LifeScreen-Bubble-narrator');
    expect(nar).toHaveTextContent('Le soleil se lève.');
    expect(nar).toHaveTextContent('The sun rises.');
  });

  it('LIFE-LANG-3 (v2) — narrator OBEYS viewMode: hidden shows practice only', () => {
    renderArea([narratorBubble, npcBubble], 'hidden');
    const nar = screen.getByTestId('LifeScreen-Bubble-narrator');
    expect(nar).toHaveTextContent('Le soleil se lève.');
    expect(nar).not.toHaveTextContent('The sun rises.');
    // npc obeys viewMode 'hidden' too → practice only.
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Bonjour !');
    expect(npc).not.toHaveTextContent('Hello!');
  });

  it('LIFE-LANG-3 (v2) — narrator native-only shows the gloss', () => {
    renderArea([narratorBubble], 'native-only');
    const nar = screen.getByTestId('LifeScreen-Bubble-narrator');
    expect(nar).toHaveTextContent('The sun rises.');
    expect(nar).not.toHaveTextContent('Le soleil se lève.');
  });

  it('LIFE-LANG-8 (v2) — legacy narrator beat (empty practiceText) falls back to the stored narration', () => {
    renderArea([{ id: 'legacy', speaker: 'narrator', practiceText: '', nativeText: 'The old prose.' }], 'hidden');
    expect(screen.getByTestId('LifeScreen-Bubble-narrator')).toHaveTextContent('The old prose.');
  });

  it('LIFE-LANG-3 — native-only falls back to practiceText when nativeText is missing', () => {
    renderArea([{ ...npcBubble, nativeText: null }], 'native-only');
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Bonjour !');
  });

  it('LIFE-LANG-4 — the comprehension gate outranks native-only: source bubble shows practiceText until flipped', () => {
    renderArea([npcBubble], 'native-only', 'Bonjour !');
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Bonjour !');
    expect(npc).not.toHaveTextContent('Hello!');
    // No reveal button — the gloss reveals on a deliberate SWIPE-LEFT (chat-style).
    expect(screen.queryByTestId('LifeScreen-RevealTranslation')).not.toBeInTheDocument();
    swipeLeft(screen.getByText('Bonjour !'));
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent('Hello!');
  });
});

describe('DialogueArea vocab taps — LIFE-BUBBLE-7', () => {
  const annotatedNpc: Bubble = {
    id: 'v1',
    speaker: 'npc',
    speakerName: 'Sophie',
    practiceText: 'On déjeune ensemble à midi ?',
    nativeText: 'Lunch together at noon?',
    complexWords: ['déjeune'],
    wordTranslations: { 'déjeune': 'have lunch' },
  };
  const annotatedUser: Bubble = {
    id: 'v2',
    speaker: 'user',
    practiceText: 'Je voudrais un café.',
    nativeText: null,
    complexWords: ['voudrais'],
    wordTranslations: { 'voudrais': 'would like' },
  };
  // LIFE-LANG-8 (v2): a narrator beat — narration is the practice language
  // now, annotated with tappable vocab on practiceText.
  const v2Narrator: Bubble = {
    id: 'v3',
    speaker: 'narrator',
    practiceText: 'Tu entres au café.',
    nativeText: 'You enter the café.',
    complexWords: ['entres'],
    wordTranslations: { entres: 'enter' },
  };

  function makeWordSave(): LifeWordSave {
    return { isSaved: () => false, isSaving: () => false, toggleSave: vi.fn() };
  }

  beforeEach(() => {
    useVocabStore.getState().close();
    useFlippedBubbleStore.getState().close();
    __resetFlipHintForTest();
  });

  it('LIFE-LANG-16 — swiping a hidden-mode bubble flips it to reveal the gloss (chat-style, swipe-only, NO label)', () => {
    render(
      <DialogueArea bubbles={[npcBubble]} characterName="Alex" viewSettings={vs('hidden')} />,
    );
    const bubble = screen.getByTestId('LifeScreen-Bubble-npc');
    // hidden: practice only, gloss withheld. There is NO "reveal translation"
    // button — the bubble flips on SWIPE-LEFT only, exactly like a chat bubble
    // (a plain tap does NOT flip it).
    expect(bubble).toHaveTextContent('Bonjour !');
    expect(bubble).not.toHaveTextContent('Hello!');
    expect(screen.queryByTestId('LifeScreen-RevealTranslation')).not.toBeInTheDocument();
    // A plain tap does nothing (swipe-only).
    fireEvent.click(screen.getByText('Bonjour !'));
    expect(bubble).not.toHaveTextContent('Hello!');
    // Swipe-left → the native gloss appears.
    swipeLeft(screen.getByText('Bonjour !'));
    expect(bubble).toHaveTextContent('Hello!');
    // Swipe again → it flips back (hides the gloss).
    swipeLeft(screen.getByText('Bonjour !'));
    expect(bubble).not.toHaveTextContent('Hello!');
  });

  it('LIFE-LANG-16 — visible mode shows the gloss by default (no flip needed, no label)', () => {
    render(
      <DialogueArea bubbles={[npcBubble]} characterName="Alex" viewSettings={vs('visible')} />,
    );
    const bubble = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(bubble).toHaveTextContent('Hello!');
    expect(screen.queryByTestId('LifeScreen-RevealTranslation')).not.toBeInTheDocument();
  });

  it('LIFE-LANG-16 — swipe-left flips a hidden-mode bubble (the chat gesture)', () => {
    render(
      <DialogueArea bubbles={[npcBubble]} characterName="Alex" viewSettings={vs('hidden')} />,
    );
    const bubble = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(bubble).not.toHaveTextContent('Hello!');
    const target = bubble.querySelector('[data-life-flip-target]');
    expect(target).not.toBeNull();
    swipeLeft(target!);
    expect(bubble).toHaveTextContent('Hello!');
  });

  it('LIFE-LANG-16 — a withheld-gloss bubble is a flip-hint target; revealing clears the mark', () => {
    render(
      <DialogueArea bubbles={[npcBubble]} characterName="Alex" viewSettings={vs('hidden')} />,
    );
    const bubble = screen.getByTestId('LifeScreen-Bubble-npc');
    // hidden ⇒ the native gloss is withheld ⇒ this bubble is a hint target.
    expect(bubble.querySelector('[data-life-flip-target]')).not.toBeNull();
    swipeLeft(screen.getByText('Bonjour !'));
    // Gloss now shown → nothing left to reveal → no longer a hint target.
    expect(bubble.querySelector('[data-life-flip-target]')).toBeNull();
  });

  it('LIFE-LANG-16 — visible mode has nothing withheld, so no flip-hint target', () => {
    render(
      <DialogueArea bubbles={[npcBubble]} characterName="Alex" viewSettings={vs('visible')} />,
    );
    const bubble = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(bubble.querySelector('[data-life-flip-target]')).toBeNull();
  });

  it('LIFE-BUBBLE-7 — npc + user bubbles render their complex words as tappable buttons', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc, annotatedUser]}
        characterName="Alex"
        wordSave={makeWordSave()}
      />,
    );
    expect(screen.getByRole('button', { name: 'déjeune' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'voudrais' })).toBeInTheDocument();
  });

  it('LIFE-LANG-8 (v2) — narrator ALWAYS gets tappable vocab (narration is the practice language)', () => {
    render(
      <DialogueArea
        bubbles={[v2Narrator]}
        characterName="Alex"
        practiceLanguage="French"
        wordSave={makeWordSave()}
      />,
    );
    expect(screen.getByRole('button', { name: 'entres' })).toBeInTheDocument();
    // tap opens the popover with the gloss (annotation attaches to practiceText).
    fireEvent.click(screen.getByRole('button', { name: 'entres' }));
    expect(screen.getByText('enter')).toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Bubble-narrator')).toHaveTextContent(
      'Tu entres au café.',
    );
  });

  it('LIFE-BUBBLE-7 — tap opens the popover with the native gloss', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc]}
        characterName="Alex"
        wordSave={makeWordSave()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'déjeune' }));
    expect(screen.getByText('have lunch')).toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — without wordSave the bubbles render plain (no word buttons)', () => {
    render(
      <DialogueArea bubbles={[annotatedNpc, annotatedUser]} characterName="Alex" />,
    );
    expect(
      screen.queryByRole('button', { name: 'déjeune' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'voudrais' }),
    ).not.toBeInTheDocument();
  });

  it('LIFE-BUBBLE-7 — native-only viewMode renders the native primary plain (annotations attach to practiceText)', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc]}
        characterName="Alex"
        viewSettings={vs('native-only')}
        wordSave={makeWordSave()}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'déjeune' }),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId('LifeScreen-Bubble-npc')).toHaveTextContent(
      'Lunch together at noon?',
    );
  });

  it('LIFE-BUBBLE-7 — comprehension-source bubble suppresses vocab taps while its gloss is hidden; reveal re-enables', () => {
    render(
      <DialogueArea
        bubbles={[annotatedNpc]}
        characterName="Alex"
        wordSave={makeWordSave()}
        hideNativeForUtterance={annotatedNpc.practiceText}
      />,
    );
    expect(
      screen.queryByRole('button', { name: 'déjeune' }),
    ).not.toBeInTheDocument();
    // No reveal button — SWIPING the (gated, plain) bubble flips it, which
    // re-enables the vocab taps (the answer is spent).
    expect(screen.queryByTestId('LifeScreen-RevealTranslation')).not.toBeInTheDocument();
    swipeLeft(screen.getByText('On déjeune ensemble à midi ?'));
    expect(screen.getByRole('button', { name: 'déjeune' })).toBeInTheDocument();
  });
});

/**
 * LIFE-LANG-3 (amended) / LIFE-LANG-18 (retired) — the swap-words mixed row
 * was cut. A world doc written before the cut may still store
 * `primary: 'mixed'`; it must read as the default practice row, and no bubble
 * may paint chat's `swap-word` affordance.
 */
describe('LIFE-LANG-3 — no mixed row on the life sim', () => {
  const npc: Bubble = {
    id: 'm1',
    speaker: 'npc',
    speakerName: 'Sophie',
    practiceText: 'Bonjour, mon ami.',
    nativeText: 'Hello, my friend.',
    complexWords: ['bonjour', 'ami'],
    wordTranslations: { bonjour: 'hello', ami: 'friend' },
  };

  it('LIFE-LANG-3 — a line renders the practice row (never a mixed row)', () => {
    const legacy: ViewSettings = { primary: 'practice', secondRow: false };
    render(
      <DialogueArea
        // A stale beat still carrying the retired key must not revive it.
        bubbles={[{ ...npc, swapWords: ['bonjour'] } as unknown as Bubble]}
        characterName="Alex"
        viewSettings={legacy}
        wordSave={{ isSaved: () => false, isSaving: () => false, toggleSave: vi.fn() }}
      />,
    );
    const bubble = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(bubble).toHaveTextContent('Bonjour, mon ami.');
    expect(screen.queryByTestId('swap-word')).toBeNull();
    // LIFE-LANG-10 vocab underlines are untouched by the cut.
    expect(screen.getByRole('button', { name: 'ami' })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// LIFE-EX-DIR-1/4: a graded line lands under exactly ONE speaker, and it is the
// one the engine decided BEFORE the question was generated — never the one the
// generated text happens to read like.
// ---------------------------------------------------------------------------
describe('DialogueArea — graded resolution renders the decided direction (LIFE-EX-DIR-1/4)', () => {
  /** The exact hand-off the engine performs: the direction chosen from the
   *  plan → `buildResolvedBubble` → the bubble handed to this component. */
  function bubbleFor(direction: GradedDirection, promptSource: string): Bubble {
    const r = buildResolvedBubble(
      {
        outcomeKind: direction.speaker === 'player' ? 'generation' : 'comprehension',
        promptSource,
        correctAnswer: { id: 'c1', practiceText: 'veux', nativeText: '', correctness: 'correct' },
        speakerName: direction.speaker === 'npc' ? direction.speakerName : null,
        npcId: direction.speaker === 'npc' ? direction.npcId : null,
      },
      1,
    );
    return {
      id: r.id,
      speaker: r.speaker,
      speakerName: r.speakerName ?? null,
      npcId: r.npcId ?? null,
      practiceText: r.practiceText,
      nativeText: r.nativeText,
    };
  }

  it('LIFE-EX-DIR-1 — a player direction renders as the player, and no NPC bubble exists', () => {
    const dir = gradedDirection({
      kind: 'generation',
      testTarget: 'veux',
      sentenceContext: 'Je veux un café.',
    });
    renderArea([bubbleFor(dir, 'Je ___ un café.')], 'hidden');
    expect(screen.getByTestId('LifeScreen-Bubble-user')).toHaveTextContent('Je veux un café.');
    expect(screen.queryByTestId('LifeScreen-Bubble-npc')).toBeNull();
  });

  it('LIFE-EX-DIR-1 — an npc direction renders under THAT npc, and no user bubble exists', () => {
    const dir = gradedDirection({
      kind: 'comprehension',
      npcUtterance: 'Le train part dans dix minutes.',
      speakerName: 'Sophie',
      npcId: 'sophie-station',
    });
    renderArea([bubbleFor(dir, 'Le train part dans dix minutes.')], 'hidden');
    const npc = screen.getByTestId('LifeScreen-Bubble-npc');
    expect(npc).toHaveTextContent('Le train part dans dix minutes.');
    expect(npc).toHaveTextContent('Sophie');
    expect(screen.queryByTestId('LifeScreen-Bubble-user')).toBeNull();
  });

  it('LIFE-EX-DIR-1 — a line whose TEXT reads as an NPC’s is still the player’s bubble', () => {
    // The reported failure mode, at the render seam: even if a wrong-voice
    // template slipped past the `directionViolations` guard, attribution comes
    // from the direction, so the line can only ever appear as the player's.
    const dir = gradedDirection({
      kind: 'generation',
      testTarget: 'veux',
      sentenceContext: 'Sophie veut un café.',
    });
    renderArea([bubbleFor(dir, 'Sophie ___ un café.')], 'hidden');
    expect(screen.getByTestId('LifeScreen-Bubble-user')).toHaveTextContent('Sophie veux un café.');
    expect(screen.queryByTestId('LifeScreen-Bubble-npc')).toBeNull();
  });

  it('LIFE-EX-DIR-4 — a user bubble ignores stale NPC labels rather than rendering both', () => {
    renderArea(
      [{
        id: 'b-both',
        speaker: 'user',
        speakerName: 'Sophie',
        npcId: 'sophie',
        practiceText: 'Je veux un café.',
      }],
      'hidden',
    );
    const user = screen.getByTestId('LifeScreen-Bubble-user');
    // The only identity on a user bubble is the PLAYER's own avatar (initials
    // of `characterName`); the NPC labels are not read at all.
    expect(user).toHaveTextContent('M');
    expect(user).not.toHaveTextContent('Sophie');
    expect(screen.queryByTestId('LifeScreen-Bubble-npc')).toBeNull();
  });
});

/**
 * LIFE-NODE-12 — the beat entrance travels on BOTH axes, and the horizontal
 * direction is the bubble's own side (docs/specs/life-sim.md §10.46).
 *
 * The direction mapping is the load-bearing half: a beat sliding in from the
 * wrong side reads as the wrong speaker, which is worse than no horizontal
 * motion at all. jsdom runs no animations, so it is asserted as the resolved
 * inline custom property on the rendered container (never a class name —
 * MSG-BUBBLE-8.1) plus the shipped CSS the property feeds.
 */
describe('LIFE-NODE-12 — two-axis beat entrance', () => {
  const CSS = readFileSync(resolve(process.cwd(), 'src/styles/globals.css'), 'utf8');

  /** Brace-matched body of the first block opening at/after `marker`. */
  function blockAfter(marker: string, from = 0): { body: string; end: number } {
    const idx = CSS.indexOf(marker, from);
    expect(idx, `not found in globals.css: ${marker}`).toBeGreaterThan(-1);
    const open = CSS.indexOf('{', idx);
    let depth = 0;
    for (let i = open; i < CSS.length; i++) {
      if (CSS[i] === '{') depth++;
      else if (CSS[i] === '}') {
        depth--;
        if (depth === 0) return { body: CSS.slice(open + 1, i), end: i };
      }
    }
    throw new Error(`unbalanced braces after ${marker}`);
  }

  const squash = (s: string) => s.replace(/\s+/g, ' ').trim();

  /** The `--life-beat-enter-x` the container actually carries. */
  function enterX(testId: string): string {
    const el = screen.getByTestId(testId);
    // The vertical half must survive untouched — the class still drives it.
    expect(el.className).toContain('life-beat-enter');
    return el.style.getPropertyValue('--life-beat-enter-x').trim();
  }

  it('LIFE-NODE-12 — a user (player) beat slides in from the RIGHT', () => {
    renderArea([userBubble], 'hidden');
    expect(enterX('LifeScreen-Bubble-user')).toBe(`${GLIDE_ENTER_TRAVEL_PX}px`);
  });

  it('LIFE-NODE-12 — an npc beat slides in from the LEFT', () => {
    renderArea([npcBubble], 'hidden');
    expect(enterX('LifeScreen-Bubble-npc')).toBe(`-${GLIDE_ENTER_TRAVEL_PX}px`);
  });

  it('LIFE-NODE-12 — a narrator beat is centered, so it has NO horizontal travel', () => {
    renderArea([narratorBubble], 'hidden');
    expect(enterX('LifeScreen-Bubble-narrator')).toBe('0px');
  });

  it('LIFE-NODE-12 — player and npc are OPPOSITE, and neither is the narrator', () => {
    // The mapping stated end-to-end in one assertion: both sides present in a
    // single render, mirrored around the narrator's zero. This is the test that
    // fails if the two are ever swapped.
    renderArea([npcBubble, userBubble], 'hidden');
    const npcX = Number.parseFloat(enterX('LifeScreen-Bubble-npc'));
    const userX = Number.parseFloat(enterX('LifeScreen-Bubble-user'));
    expect(npcX).toBeLessThan(0);
    expect(userX).toBeGreaterThan(0);
    expect(npcX).toBe(-userX);
  });

  it('LIFE-NODE-12 — beatEnterOffsetX maps every speaker, and shares ONE magnitude', () => {
    expect(beatEnterOffsetX('user')).toBe(`${GLIDE_ENTER_TRAVEL_PX}px`);
    expect(beatEnterOffsetX('npc')).toBe(`-${GLIDE_ENTER_TRAVEL_PX}px`);
    expect(beatEnterOffsetX('narrator')).toBe('0px');
  });

  it('LIFE-NODE-12 — the keyframe travels on BOTH axes, the same distance', () => {
    const kf = squash(blockAfter('@keyframes lifeBeatEnter').body);
    // X comes from the per-speaker custom property, defaulting to no travel so
    // an un-styled consumer degrades to the old vertical-only entrance.
    expect(kf).toContain('var(--life-beat-enter-x, 0px)');
    // One magnitude, both axes — a 45° diagonal, not two tuned numbers.
    expect(kf).toContain(
      `translate(var(--life-beat-enter-x, 0px), ${GLIDE_ENTER_TRAVEL_PX}px)`,
    );
  });

  it('LIFE-NODE-12 — the duration is UNCHANGED, so the LIFE-NODE-11 stagger floor still holds', () => {
    const rule = squash(blockAfter('.life-beat-enter {').body);
    expect(rule).toContain(`lifeBeatEnter ${GLIDE_ENTER_MS}ms`);
    // The relationship the pacing pass depends on: a longer entrance would let
    // beat N+1 start rising while beat N is still travelling.
    expect(BEAT_STAGGER_MS).toBeGreaterThanOrEqual(GLIDE_ENTER_MS);
  });

  it('LIFE-NODE-12 — prefers-reduced-motion drops BOTH axes, not just the vertical', () => {
    const reduced = squash(blockAfter('@media (prefers-reduced-motion: reduce)',
      CSS.indexOf('.life-beat-enter {')).body);
    expect(reduced).toContain('lifeBeatFade');
    expect(reduced).not.toContain('translate');
    const fade = squash(blockAfter('@keyframes lifeBeatFade').body);
    expect(fade).not.toContain('transform');
    expect(fade).not.toContain('translate');
  });
});

/**
 * LIFE-NODE-13 — a beat MAKES SPACE for itself.
 *
 * Reported 2026-07-31: "previous messages jump up then the new message glides
 * in". The glide was only ever a transform, so the row reached full height in
 * one frame — the beats above snapped upward — and the bubble then slid into a
 * gap that had already finished opening. Chat has done this correctly since
 * MSG-BUBBLE-8.2 by animating the TRACK separately from the bubble, and the
 * shape ports directly: both are bottom-anchored columns where a new row
 * pushes the earlier ones up.
 *
 * Asserted structurally rather than by animation name — what has to hold is
 * that every beat is wrapped in its own animating track. jsdom computes no
 * animations, so the class IS the observable.
 */
describe('LIFE-NODE-13 — the arriving beat opens its own row', () => {
  it('wraps every beat in a grow track', () => {
    const { container } = renderArea(
      [npcBubble, userBubble],
      'visible',
    );
    const tracks = container.querySelectorAll('.life-beat-grow');
    expect(tracks.length).toBe(2);
  });

  it('the track is the PARENT of the gliding bubble, not the bubble itself', () => {
    // The two motions must be able to run at different durations — that
    // difference is what makes the beat read as arriving rather than growing
    // in place. One element carrying both classes would collapse them onto one
    // timeline and silently undo the fix.
    const { container } = renderArea(
      [npcBubble],
      'visible',
    );
    const track = container.querySelector('.life-beat-grow');
    expect(track).not.toBeNull();
    expect(track!.classList.contains('life-beat-enter')).toBe(false);
    expect(track!.querySelector('.life-beat-enter')).not.toBeNull();
  });
});
