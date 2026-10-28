import { useMemo, useState } from 'react';
import { Users } from 'lucide-react';
import { GradientSurface } from '@/components/ui/GradientSurface';
import { cn } from '@/lib/cn';
import { markLoaded, wasLoaded } from '@/lib/imageLoadCache';

type Props = {
  /** Photo URL to render. Falls back to a gradient + initial / group icon
   *  if missing or if the image fails to load (broken URL, expired token,
   *  offline-cache miss). */
  photoUrl?: string | null;
  /**
   * Inline base64 LQIP (`data:image/jpeg;base64,…`) shipped on the parent
   * doc (user.tinyImage / chat.groupPhotoTinyImage). When supplied, the
   * avatar paints this immediately as a blurred underlay before `photoUrl`
   * resolves — no flash from gradient → photo. Falls through silently when
   * absent (legacy users without the field stay in the gradient fallback
   * until the photo loads).
   */
  tinyImage?: string | null;
  /** Used to derive the initial + (legacy) gradient seed fallback. */
  name: string;
  /**
   * Stable id used to seed the fallback gradient — uid for 1:1 / own
   * profile, chatId for groups. Preferred over `name` hashing because
   * the user's own profile may render before `name` resolves (would
   * collapse to a constant seed → flat gradient), and renaming a user
   * or group otherwise rotates their gradient. Falls back to `name`
   * hashing when omitted for backwards compatibility.
   */
  seedId?: string;
  /** Show a "group" placeholder (Lucide Users icon) instead of initials. */
  isGroup?: boolean;
  /** Diameter in px. Default 40. */
  size?: number;
  className?: string;
};

/**
 * Round avatar. Three render modes, in priority order:
 *   1. photoUrl successfully loads → the image
 *   2. photoUrl errored / no photoUrl + isGroup → gradient + Users icon
 *   3. photoUrl errored / no photoUrl + !isGroup → gradient + initials
 */
export function Avatar({
  photoUrl,
  tinyImage,
  name,
  seedId,
  isGroup,
  size = 40,
  className,
}: Props) {
  const initial = useMemo(() => deriveInitial(name), [name]);
  const [imgError, setImgError] = useState(false);
  // Initialise `imgLoaded=true` if we've already successfully rendered
  // THIS url before. Stops the blurred-tinyImage underlay from flashing
  // when an Avatar remounts on navigation (chat list → chat → back is
  // the common path that re-mounts every row's `<img>`).
  const [imgLoaded, setImgLoaded] = useState(() => wasLoaded(photoUrl));
  const dim = `${size}px`;
  const showImage = !!photoUrl && !imgError;
  // LQIP blur scales with the avatar diameter: the inline tinyImage is ~24px
  // regardless of display size, so a bigger avatar shows bigger source-pixels
  // and needs more blur to read as a soft placeholder rather than a pixel grid.
  // (The earlier "the upsample is soft enough, blur is redundant" assumption was
  // wrong — the 24px pixels are clearly visible.)
  const lqipBlurPx = Math.max(2, Math.round(size / 10));

  const fallback = isGroup ? (
    <Users
      aria-hidden
      size={Math.round(size * 0.5)}
      strokeWidth={2}
      className="text-white drop-shadow-sm"
    />
  ) : (
    <span
      className="text-white font-semibold drop-shadow-sm"
      style={{ fontSize: size * 0.42 }}
    >
      {initial}
    </span>
  );
  // THEME-8: the tutor (the app itself) wears the canonical brand gradient.
  // Literal rather than TUTOR_UID: lib/tutor pulls in Firestore, too heavy here.
  const seedKey = seedId === 'wurld-tutor-agent'
    ? undefined
    : seedId
    ? (isGroup ? `group:${seedId}` : `user:${seedId}`)
    : (isGroup ? `group:${name || 'group'}` : name || 'user');

  if (showImage) {
    // Backdrop is ALWAYS rendered underneath the photoUrl <img> — it's
    // either the inline base64 tinyImage (no network) or the gradient +
    // initials/icon fallback. The `<img>` paints on top, so:
    //   - Cached photo decodes on first frame → user sees the full
    //     image; the backdrop never visibly appears.
    //   - Cold-cache load → backdrop shows immediately, photo paints
    //     over it as the network resolves.
    //   - Remount with photo in the imageLoadCache → photo renders
    //     instantly on first frame too (decoded image stays in the
    //     browser's intra-document cache); the backdrop is hidden
    //     beneath without ever being visible.
    // Previously the backdrop was conditionally hidden when
    // imgLoaded=true. That left a transparent gap during the decode
    // frame on remount, which read as a "flash" against the page bg.
    // Keeping the backdrop mounted at all times closes that gap.
    return (
      <span
        className={cn(
          'relative rounded-full overflow-hidden block flex-shrink-0',
          className,
        )}
        // `transform: translateZ(0)` forces this element onto its own
        // compositor layer. WebKit's iOS Safari has a known rendering
        // class of bug: when a child has `filter: blur()` (which
        // itself triggers compositor-layer promotion on the CHILD),
        // and the parent has `overflow: hidden + border-radius` but
        // is NOT a compositor layer, the parent's clip FAILS to
        // contain the child's blurred output. The result: the LQIP
        // <img>'s blur halo escapes the rounded-full box and shows
        // beyond the avatar circle. Promoting the parent makes WebKit
        // honour the clip before compositing the child — which is what
        // lets the LQIP below carry its blur filter (the soft halo
        // stays clipped to the rounded-full box).
        style={{ width: dim, height: dim, transform: 'translateZ(0)' }}
      >
        {tinyImage ? (
          <img
            src={tinyImage}
            alt=""
            aria-hidden="true"
            // Blur the LQIP so it reads as a soft placeholder, not a visible
            // 24px pixel grid. scale(1.1) over-fills so the blur's soft
            // transparent edge doesn't leave a faint ring inside the circle.
            // The parent's translateZ(0) (see its style comment) keeps the blur
            // clipped to the rounded-full box on WebKit.
            style={{ filter: `blur(${lqipBlurPx}px)`, transform: 'scale(1.1)' }}
            className="absolute inset-0 w-full h-full object-cover"
          />
        ) : (
          <GradientSurface
            seedKey={seedKey}
            className="absolute inset-0 w-full h-full flex items-center justify-center"
          >
            {fallback}
          </GradientSurface>
        )}
        <img
          src={photoUrl ?? undefined}
          alt=""
          width={size}
          height={size}
          // `decoding="sync"` asks the browser to decode the image on
          // the SAME paint cycle as the surrounding layout. For an
          // already-cached image (same URL → HTTP + decoded cache
          // hit) this lets the photo show up on the first frame,
          // covering the backdrop before the user notices it.
          decoding="sync"
          loading={imgLoaded ? 'eager' : 'lazy'}
          onError={() => setImgError(true)}
          onLoad={() => {
            setImgLoaded(true);
            markLoaded(photoUrl);
          }}
          className="relative w-full h-full object-cover"
        />
      </span>
    );
  }

  return (
    <GradientSurface
      seedKey={seedKey}
      className={cn('rounded-full flex items-center justify-center flex-shrink-0', className)}
      style={{ width: dim, height: dim }}
    >
      {fallback}
    </GradientSurface>
  );
}

function deriveInitial(name: string): string {
  // CONTACTS-NAME-3 — a non-contact label is `{phone} ~ {displayName}`; its
  // initials come from the name half, never `+~`.
  const tilde = (name || '').lastIndexOf(' ~ ');
  const trimmed = (tilde >= 0 ? name.slice(tilde + 3) : name || '').trim();
  if (!trimmed) return 'W';
  // Take the first character of each whitespace-separated chunk, up to 2.
  const parts = trimmed.split(/\s+/).slice(0, 2);
  return parts
    .map((p) => Array.from(p)[0] ?? '')
    .join('')
    .toUpperCase();
}
