import { useCallback, useState, type CSSProperties } from 'react';
import { useIsFlipped, useFlippedBubbleStore } from '@/store/flippedBubbleStore';
import { useLifeFlipHintStore } from '@/lib/life/lifeFlipHint';
import { useSwipeActions } from '@/hooks/useSwipeActions';
import {
  flipMotion, flipTransformOrigin, type FlipSpacerSide,
} from '@/components/Message/flipHeight';
import { useFlipHeight } from '@/components/Message/useFlipHeight';
import { prefersReducedMotion } from './nodeEngineGlide';

/** Which edge the bubble is pinned to — decides the flip's rotational centre
 *  (MSG-BUBBLE-12.13). A centred bubble (the narrator) shares its centre
 *  between both faces already, so it needs no correction. */
export type LifeBubbleAnchor = 'left' | 'right' | 'center';

/**
 * LIFE-LANG-16 — chat-style bubble flip for the wurld dialogue.
 *
 * TRUE chat parity (MSG-VIEW-3): the native gloss reveals on a deliberate
 * SWIPE-LEFT and nothing else — no persistent "reveal" button, and NOT on tap.
 * Tap used to flip too, but that diverged from chat muscle memory (a tap in
 * chat does nothing) and made it too easy to reveal the gloss by accident on a
 * reading surface; swipe-only matches chat exactly. The one-time coach-mark
 * (`LifeFlipHint`, `data-variant="swipe"`) already teaches the swipe.
 *
 * `flippable` gates the gesture (a bubble with nothing to reveal never flips).
 * Every successful flip feeds the coach-mark budget (`recordFlip`), so the swipe
 * hint retires once the player has used it.
 */
export function useLifeBubbleFlip(
  bubbleId: string,
  flippable: boolean,
  anchor: LifeBubbleAnchor = 'center',
): {
  flipped: boolean;
  handlers: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
  /** LIFE-LANG-16: live drag state so the bubble FOLLOWS THE FINGER while
   *  swiping (scaleX collapse via `flipProgress`), instead of sitting static
   *  until release. `active` gates the transition — the same wiring the chat
   *  bubble uses (MSG-REPLY-5). */
  state: { dragX: number; flipProgress: number; flipPast: boolean; active: boolean };
  /** LIFE-LANG-16 — the flip transform, built by the SAME helpers the chat
   *  bubble uses so the two surfaces cannot drift apart. Apply to the element
   *  the handlers are on. */
  flipStyle: CSSProperties;
  /** MSG-BUBBLE-12 — the measurement twin's ref. Mounting it starts the turn. */
  twinRef: (node: HTMLElement | null) => void;
  /** True while the twin should be rendered at all. */
  measuring: boolean;
  /** px of blank space to hold beside the bubble. 0 = none. */
  spacerHeight: number;
  /** Which side of the bubble that space goes on (MSG-BUBBLE-12.9). */
  spacerSide: FlipSpacerSide;
} {
  const flipped = useIsFlipped(bubbleId);
  const toggleFlip = useFlippedBubbleStore((s) => s.toggle);
  const recordFlip = useLifeFlipHintStore((s) => s.recordFlip);

  const doFlip = useCallback(() => {
    if (!flippable) return;
    toggleFlip(bubbleId);
    recordFlip();
  }, [bubbleId, flippable, toggleFlip, recordFlip]);

  const swipe = useSwipeActions({
    onFlipToggle: doFlip,
    // No reply gesture in the wurld surface — only the leftward flip.
    enableRight: false,
    enableLeft: flippable,
  });

  // MSG-BUBBLE-12.13 — the bubble's LAYOUT width when the turn started, which
  // pins the flip's rotational centre to the outgoing face. Read off
  // `currentTarget` rather than a ref: the handlers and the transform are on
  // the same element here, and pointerdown fires before any scaleX exists,
  // which is what makes `offsetWidth` the right measurement.
  const [startWidth, setStartWidth] = useState(0);
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      setStartWidth((e.currentTarget as HTMLElement).offsetWidth);
      swipe.handlers.onPointerDown(e);
    },
    [swipe.handlers],
  );

  const { progress, transform, direction } = flipMotion(swipe.state, 0, flipped);
  // MSG-BUBBLE-12 — the SAME height schedule the chat bubble runs. The wurld
  // surface used to animate the bubble's own box instead (a grid-template-rows
  // glide on the gloss row), which is the mechanism 12.8 exists to rule out:
  // the card the finger is on must hold still while the beats around it move.
  const { twinRef, measuring, spacerHeight, spacerSide } =
    useFlipHeight(progress, direction, flipped);
  const turning = swipe.state.active || progress > 0 || swipe.state.flipPast;
  const flipStyle: CSSProperties = prefersReducedMotion()
    ? {}
    : {
      // NOT gated on `active`: MSG-BUBBLE-12.11's release settle runs the turn
      // out AFTER the finger lifts, and dropping the transform on release
      // (which this surface used to do) cuts that off — the card snapped to
      // full width instead of completing its turn.
      transform,
      transition: swipe.state.active ? 'none' : 'transform 180ms cubic-bezier(.2,.7,.2,1)',
      transformOrigin: flipTransformOrigin({
        mine: anchor === 'right',
        // A centred bubble already shares its centre between both faces.
        startWidth: turning && anchor !== 'center' ? startWidth : 0,
      }),
    };

  return {
    flipped,
    handlers: { ...swipe.handlers, onPointerDown },
    state: swipe.state,
    flipStyle,
    twinRef,
    measuring,
    spacerHeight,
    spacerSide,
  };
}

/** What `LifeFlipSurface` needs from the hook. */
export type LifeBubbleFlip = ReturnType<typeof useLifeBubbleFlip>;
