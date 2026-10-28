/**
 * LIFE-NPC-2: avatar tap target — larger portrait + brief bio.
 *
 * Tapping an avatar in the dialogue area opens this modal showing
 * the SVG at a useful size plus the character's name + role / bio.
 * Used for both NPCs and the player's own character.
 */
import { useOverlayBack } from '@/hooks/useOverlayBack';
import { X, User } from 'lucide-react';
import { useT } from '@/i18n';

export type AvatarModalSubject = {
  /** Display name. */
  name: string;
  /** Avatar URL (data URI or null). When null the modal shows the
   *  initials fallback at the larger size. */
  avatarUrl: string | null;
  /** Short relationship / role line ("Café owner", "Resistance
   *  fighter", "Your character"). Optional — the modal hides this
   *  row when absent. */
  role?: string | null;
  /** LIFE-NPC-7: 1-2 sentence "who they are + how they fit into your
   *  story" blurb. Optional — hidden when absent (legacy NPCs before
   *  the roster sweep backfills them). Rendered ABOVE oneLineMemory. */
  description?: string | null;
  /** Optional accumulated memory ("Met you in chapter 1. Helped you
   *  through the gallery scene."). */
  oneLineMemory?: string | null;
};

export type AvatarModalProps = {
  subject: AvatarModalSubject;
  onClose: () => void;
};

export function AvatarModal({ subject, onClose }: AvatarModalProps) {
  // NAV-OVERLAY-2 — Android back closes this overlay before it leaves the page.
  useOverlayBack(true, onClose);
  const t = useT();
  return (
    <div
      data-testid="LifeScreen-AvatarModal"
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <button
        type="button"
        aria-label={t('common.close')}
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
      />
      <div className="relative w-full max-w-sm rounded-2xl bg-(--color-bg-elevated) border border-(--color-border) shadow-xl p-5 flex flex-col items-center gap-3 animate-in fade-in zoom-in-95 duration-200">
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute top-2 right-2 p-1.5 rounded-full hover:bg-(--color-bg-hover) text-(--color-fg-muted)"
        >
          <X size={16} />
        </button>
        {subject.avatarUrl ? (
          <img
            src={subject.avatarUrl}
            alt=""
            className="w-40 h-40 rounded-full object-cover bg-(--color-bg)"
          />
        ) : (
          <div className="w-40 h-40 rounded-full inline-flex items-center justify-center bg-(--color-bg-hover) text-(--color-fg-muted) text-5xl font-bold">
            {(subject.name.trim()[0] ?? '?').toUpperCase()}
          </div>
        )}
        <div className="text-lg font-semibold text-(--color-fg) text-center">
          {subject.name}
        </div>
        {subject.role && (
          <div className="inline-flex items-center gap-1.5 text-xs text-(--color-fg-muted)">
            <User size={12} />
            <span>{subject.role}</span>
          </div>
        )}
        {subject.description && (
          <p className="text-sm text-(--color-fg-muted) leading-relaxed text-center px-2">
            {subject.description}
          </p>
        )}
        {subject.oneLineMemory && (
          <div className="text-xs text-(--color-fg-muted) leading-relaxed text-center px-2 pt-1 border-t border-(--color-border)/50 w-full">
            {subject.oneLineMemory}
          </div>
        )}
      </div>
    </div>
  );
}
