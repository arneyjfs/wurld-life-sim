/**
 * LIFE-UI-1 (A): the SVG backdrop region that fills the available height
 * of LifeScreen. Renders an inline SVG via `dangerouslySetInnerHTML`
 * so Gemini-generated markup with `<animate>` elements works the same
 * as a hand-drawn fallback.
 *
 * The stage owns WHAT IS PAINTED, which is not always the `svg` prop:
 * `useLifeBackdrop` swaps in the bundled silhouette the moment a render
 * starts, and painting that verbatim blanks the player's backdrop for the
 * several seconds a Gemini SVG takes. LIFE-BACKDROP-15 holds the outgoing
 * backdrop instead and cross-fades; LIFE-BACKDROP-16 replaces the pre-first-backdrop
 * silhouette with the planet placeholder. The decision itself lives in
 * `backdropStageState.ts` as a pure reducer.
 *
 * Spec: docs/specs/life-sim.md §6.
 */
import type { TimeOfDay } from '@/types/lifeState';
import { memo, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/cn';
import { backdropBleedColor } from '@/lib/life/backdropBleed';
import {
  SCENE_FADE_MS,
  initialStageState,
  namespaceSvgIds,
  nextStageState,
} from './backdropStageState';

type Props = {
  /** LIFE-TIME-1: the world clock, re-skinning the cached SVG. */
  timeOfDay?: TimeOfDay;
  /** Raw inline SVG markup as resolved by `useLifeBackdrop`. May be a bundled
   *  placeholder silhouette — the stage decides whether to paint it. */
  svg: string;
  /** Display label shown in the location ribbon (e.g. "your apartment").
   *  Suppressed while the LIFE-BACKDROP-16 planet is up. */
  locationLabel?: string;
  /** LIFE-BACKDROP-26 — the same place in the system language. Present ⇒ the
   *  ribbon becomes a button that reveals this for a moment on tap. Absent ⇒
   *  no affordance at all, rather than a button that does nothing. */
  locationLabelNative?: string;
  /** Decorative — no semantic content per the WCAG decision (the
   *  backdrop's role is atmospheric, the dialogue carries the meaning). */
  className?: string;
  /** LIFE-BACKDROP-17 — true while a render is in flight. Distinguishes the
   *  generating window from a terminal failure, which emit identical bytes. */
  generating?: boolean;
};

/* LIFE-BACKDROP-12: the <svg> element box is sized to the SQUARE itself —
   height-led, clamped by the container's smaller side — rather than being
   stretched to the whole stage. That matters for more than layout: an outer
   <svg>'s default overflow:hidden clips at the ELEMENT box, NOT the viewBox,
   so any geometry the model draws outside 0..1000 paints out into the
   surround unless the element box IS the canvas.

   Sized with min(100cqw,100cqh) against a size container, NOT
   `aspect-square h-full w-auto max-w-full` — that earlier attempt silently
   failed, because `aspect-ratio` is ignored once height is definite, so
   max-width clamped the width and left the box full-height. Symptom: on a
   tall phone the box stayed 200x433, the drawing pinned correctly inside it,
   but stray geometry still painted into the band below the square.

   Centred horizontally, flush to the top so the slack falls below the backdrop
   where the option chips render. */
const LAYER_CLASS =
  // `life-backdrop-layer` is the LIFE-TIME-1 re-skin target — see globals.css.
  'life-backdrop-layer absolute inset-0 [container-type:size] [&>svg]:block [&>svg]:mx-auto [&>svg]:[width:min(100cqw,100cqh)] [&>svg]:[height:min(100cqw,100cqh)]';

/** LIFE-BACKDROP-26: how long the native label stays up. Long enough to read a
 *  place name without hunting for it; short enough that the ribbon is back to
 *  being the story's own words before the next beat lands. */
export const RIBBON_REVEAL_MS = 2500;

const RIBBON_CLASS =
  'absolute top-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-(--color-bg)/80 backdrop-blur-sm text-xs font-medium text-(--color-fg) border border-(--color-border)/50';

function BackdropStageImpl({
  svg,
  locationLabel,
  locationLabelNative,
  className,
  generating = true,
  timeOfDay,
}: Props) {
  // Adjusting state during render (React's documented prop-change pattern)
  // rather than in an effect: an effect would paint the raw prop for one
  // frame first, which is the silhouette flash LIFE-BACKDROP-15 removes.
  const [stage, setStage] = useState(() => initialStageState(svg, generating));
  // Keyed on BOTH: a terminal failure changes `generating` without changing
  // `svg` (the silhouette was already the in-flight placeholder's value), so
  // watching the svg alone would never notice the transition that matters.
  const [seen, setSeen] = useState({ svg, generating });
  if (seen.svg !== svg || seen.generating !== generating) {
    setSeen({ svg, generating });
    setStage((prev) => nextStageState(prev, svg, generating));
  }
  const { current, previous, placeholder, swapId } = stage;

  // Drop the outgoing layer once the fade has finished. Timer rather than
  // `animationend` so it also fires under `prefers-reduced-motion`, where
  // the animation is disabled and the event never comes — otherwise the old
  // backdrop's markup (and its ids) would live in the DOM forever.
  useEffect(() => {
    if (previous === null) return;
    const timer = window.setTimeout(() => {
      setStage((prev) =>
        prev.previous === null ? prev : { ...prev, previous: null },
      );
    }, SCENE_FADE_MS);
    return () => window.clearTimeout(timer);
  }, [previous, swapId]);

  /* Backdrops are square + contain-fit + top-anchored (LIFE-UI-7), so the
     slack collects in side strips on a wide desktop and in a band below
     the backdrop on a phone — the band the option chips sit over.
     LIFE-BACKDROP-12 paints that with the backdrop's declared flat colour.
     Read off what is PAINTED, not off the prop: during a render the prop
     is the silhouette, and following it would flip the surround colour
     while the held backdrop is still on screen. */
  const bleed = useMemo(() => backdropBleedColor(current), [current]);

  /* LIFE-BACKDROP-26 — tap-to-reveal on the location ribbon.
     The affordance exists only when there is something to reveal: no native
     label, or one that reads the same as the practice label, and the ribbon
     stays an inert <div>. A button that does nothing when pressed is a worse
     answer than no button, because the player learns the wrong thing from it. */
  const native = locationLabelNative?.trim() ?? '';
  const canReveal = native !== '' && native !== (locationLabel?.trim() ?? '');
  // A COUNTER, not a boolean. A second tap while the native is already up has
  // to RESTART the countdown, and a boolean that is already `true` changes
  // nothing, so the effect never re-runs and the original timer reverts the
  // ribbon mid-read. Bumping the count changes the dep every time.
  const [revealTap, setRevealTap] = useState(0);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    const timer = window.setTimeout(() => setRevealed(false), RIBBON_REVEAL_MS);
    return () => window.clearTimeout(timer);
  }, [revealed, revealTap]);

  // Arriving somewhere new drops a reveal that is still up — otherwise the
  // harbour's ribbon shows the English for the café the player just left.
  // Adjusted DURING RENDER, the same documented prop-change pattern the
  // `seen` state above uses: in an effect it would paint one frame of the new
  // place under the old place's translation, which is the exact wrong thing.
  const [seenPlace, setSeenPlace] = useState(locationLabel);
  if (seenPlace !== locationLabel) {
    setSeenPlace(locationLabel);
    setRevealed(false);
  }

  // LIFE-BACKDROP-15: the outgoing copy's ids are prefixed so the two mounted
  // SVGs cannot resolve each other's `url(#…)` during the fade.
  const outgoing = useMemo(
    () =>
      previous === null
        ? null
        : namespaceSvgIds(previous, `lifebackdrop-prev${swapId}-`),
    [previous, swapId],
  );

  return (
    <div
      className={cn(
        'relative flex-1 min-h-0 overflow-hidden bg-(--color-bg)',
        className,
      )}
      style={bleed ? { backgroundColor: bleed } : undefined}
      data-testid="LifeScreen-BackdropStage"
      // LIFE-TIME-1: the re-skin hook. The backdrop SI's rule 12
      // (`functions/src/prompts/lifeBackdrop.ts`) has always
      // told the generator to tag `sky` / `lighting` / `lamp` / `shadow`
      // classes "so the app can re-skin one SVG for morning / midday / evening
      // / night", and `backdropDescriptor` keeps time OUT of the cache key on
      // exactly that promise. Nothing ever set the attribute, so every cached
      // SVG has carried the hooks and none of them were ever pulled.
      data-time={timeOfDay ?? undefined}
    >
      {/* Outgoing first in DOM order so the incoming layer stacks over it
          without needing an explicit z-index. */}
      {outgoing !== null && (
        <div
          key={`out-${swapId}`}
          data-testid="LifeScreen-BackdropLayer-Outgoing"
          className={LAYER_CLASS}
          dangerouslySetInnerHTML={{ __html: outgoing }}
          aria-hidden
        />
      )}
      <div
        key={`in-${swapId}`}
        data-testid="LifeScreen-BackdropLayer"
        className={cn(LAYER_CLASS, previous !== null && 'life-backdrop-fade-in')}
        dangerouslySetInnerHTML={{ __html: current }}
        aria-hidden
      />
      {/* LIFE-BACKDROP-16: no location text over the planet — the world has no
          location yet, and the "Building your wurld…" pill is the only thing
          on the stage that is true at that moment. */}
      {locationLabel && !placeholder && (
        canReveal ? (
          <button
            type="button"
            // The native text IS the label: a screen-reader user has no use for
            // "tap to translate" on a control whose whole output is the string
            // the button would announce anyway.
            aria-label={native}
            onClick={() => {
              setRevealTap((n) => n + 1);
              setRevealed(true);
            }}
            className={cn(RIBBON_CLASS, 'transition-colors active:bg-(--color-bg)')}
            data-testid="LifeScreen-LocationRibbon"
          >
            {revealed ? native : locationLabel}
          </button>
        ) : (
          <div className={RIBBON_CLASS} data-testid="LifeScreen-LocationRibbon">
            {locationLabel}
          </div>
        )
      )}
    </div>
  );
}

/**
 * Memoized: `LifeScreen` re-renders on every engine transition AND every
 * Firestore snapshot (~2-3× per turn as beats commit), but the backdrop only
 * changes on a location move. The `svg` string is referentially stable across
 * those re-renders (held in `useLifeBackdrop` state), so a shallow-prop memo
 * skips the `dangerouslySetInnerHTML` subtree reconciliation on every
 * unrelated re-render. (Rendering audit.)
 */
export const BackdropStage = memo(BackdropStageImpl);
