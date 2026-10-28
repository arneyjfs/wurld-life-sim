/**
 * LIFE-WORLD-*: world overview — the entry point for /life.
 *
 * Two shapes:
 *  - Empty state (no worlds yet) renders a landing hero with
 *    example worlds the player COULD live in (LifeOverviewEmpty).
 *    Sample cards tap-through to onboarding.
 *  - Populated state lists the player's worlds in cards, with a
 *    "+ Start a new world" CTA and a small "how worlds work"
 *    explainer beneath. Per-world delete sits in each card's menu.
 *
 * Spec: docs/specs/life-sim.md §10.6 (LIFE-WORLD-*).
 */
import { useState } from 'react';
import { Plus, Loader, Flame } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useT } from '@/i18n';
import { useAuthStore } from '@/store/authStore';
import { useLifeWorlds } from '@/hooks/useLifeWorlds';
import { useUserProfile } from '@/hooks/useUserProfile';
import { currentStreak, readStreakState } from '@/lib/streak';
import { CenteredSpinner } from '@/components/CenteredSpinner';
import { WorldCard } from './WorldCard';
import { LifeOverviewEmpty } from './LifeOverviewEmpty';
import { LifeOverviewExplainer } from './LifeOverviewExplainer';
import { settleWithTimeout } from '@/lib/life/deleteTimeout';
import { deleteLifeWorld, setLastSeenWorld } from '@/lib/life/world';
import { useUIStore } from '@/store/uiStore';
import * as log from '@/lib/log';

const MAX_WORLDS = 5;

export function LifeOverviewScreen() {
  const t = useT();
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const pushToast = useUIStore((s) => s.pushToast);
  const worlds = useLifeWorlds(user?.uid ?? null);
  const profile = useUserProfile(user?.uid ?? null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // LIFE-STREAK-4: the GLOBAL engagement streak (practice session OR wurld
  // chapter). Read from the reactive user doc + derived for TODAY so it
  // decays to 0 once a full day is missed. Shown ONLY here, in the overview
  // header — never per-card, never inside a wurld.
  const streak = currentStreak(readStreakState(profile.data));

  if (!user) return <CenteredSpinner />;
  const list = worlds.data;
  const canCreate = list.length < MAX_WORLDS;

  async function handleDelete(worldId: string) {
    if (!user || deletingId) return;
    setDeletingId(worldId);
    // LIFE-WORLD-11: BOUNDED wait. `deleteLifeWorld` ends in `batch.commit()`,
    // which Firestore resolves only on SERVER ack — the local write lands
    // immediately, but on a degraded connection the await can pend forever, and
    // a `finally` is only as reliable as the promise it hangs off. That is what
    // left the card faded until an app restart, with no error to report because
    // nothing ever rejected.
    let deleteErr: unknown = null;
    const outcome = await settleWithTimeout(
      deleteLifeWorld(user.uid, worldId).catch((err: unknown) => {
        deleteErr = err;
        throw err;
      }),
    );
    setDeletingId(null);
    if (outcome === 'failed') {
      log.error(deleteErr, { action: 'lifeWorldDelete' }); // OBS-COVER-7
      pushToast({ kind: 'error', message: t('life.overview.deleteFailed') });
    } else if (outcome === 'timeout') {
      // NOT cancelled — it stays queued in Firestore's offline layer and
      // completes when the connection recovers. The UI just stops claiming it
      // is still working.
      log.warn('life.overview.delete-timeout', { worldId });
      pushToast({ kind: 'error', message: t('life.overview.deleteSlow') });
    }
  }

  function handleOpen(worldId: string) {
    if (!user) return;
    void setLastSeenWorld(user.uid, worldId).catch(() => undefined);
    navigate(`/wurlds/${worldId}`);
  }

  const loading = worlds.loading && list.length === 0;
  const empty = !loading && list.length === 0;

  return (
    <div
      className="flex-1 min-h-0 flex flex-col bg-(--color-bg)"
      data-testid="LifeOverviewScreen"
    >
      {/* LIFE-WORLD-10 — a TAB-ROOT header, matching ChatList / Contacts /
          Cards: big title over a muted subtitle inside the page measure, with
          the right-hand affordance on the title's row. No back arrow — this is
          where the Wurlds tab lands, not a child screen (hardware back is
          still defined via resolveParent, NAV-PARENT-1). */}
      <header className="pt-safe-top pb-3 bg-(--color-bg)">
        <div className="page-measure px-4 pt-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold">{t('life.overview.title')}</h1>
            <p className="text-sm text-(--color-fg-muted) mt-0.5">
              {t('life.overview.subtitle')}
            </p>
          </div>
          {streak > 0 ? (
            <span
              data-testid="LifeOverview-StreakBadge"
              title={t('life.streak.title', { count: streak })}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold text-amber-600 bg-amber-100 shrink-0"
            >
              <Flame size={14} />
              {streak}
            </span>
          ) : null}
        </div>
      </header>

      <div className="flex-1 min-h-0 overflow-y-auto pb-[max(var(--spacing-safe-bottom),1rem)]">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-(--color-fg-muted)">
            <Loader size={16} className="animate-spin" />
          </div>
        ) : empty ? (
          <LifeOverviewEmpty />
        ) : (
          <div className="flex flex-col gap-3 pt-3 page-measure px-4">
            {list.map((w) => (
              <WorldCard
                key={w.id}
                world={w}
                onOpen={() => handleOpen(w.id)}
                onDelete={() => void handleDelete(w.id)}
                deleting={deletingId === w.id}
              />
            ))}
          </div>
        )}

        <div className="mt-4 page-measure px-4">
          <button
            type="button"
            data-testid="LifeOverview-Create"
            onClick={() => canCreate && navigate('/wurlds/start')}
            disabled={!canCreate}
            className="w-full py-3 rounded-2xl border border-dashed border-(--color-border) text-sm font-semibold text-(--color-fg) flex items-center justify-center gap-2 hover:bg-(--color-bg-hover) disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Plus size={16} />
            {empty
              ? t('life.overview.createFirst')
              : canCreate
                ? t('life.overview.create')
                : t('life.overview.maxReached', { max: MAX_WORLDS })}
          </button>
        </div>

        {!empty && !loading && <LifeOverviewExplainer />}
      </div>
    </div>
  );
}
