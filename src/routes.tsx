import { Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useParams } from 'react-router-dom';
import { useAuthStore } from './store/authStore';
import { CenteredSpinner } from './components/CenteredSpinner';
import { LifeOverviewScreen, LifeScreen, LifeStartScreen } from './lazyScreens';
import { SignInScreen } from './screens/SignIn/SignInScreen';

/**
 * Key `LifeScreen` by `worldId` so a param-only world switch (a deep link
 * from one wurld to another) remounts it instead of carrying one world's
 * engine state into the next (LIFE-WORLD-*).
 */
function KeyedLifeScreen() {
  const { worldId } = useParams();
  return <LifeScreen key={worldId ?? 'none'} />;
}

/** Signed-out users see the sign-in screen; nothing below reads Firestore
 *  until `user` is set. */
function RequireAuth({ children }: { children: ReactNode }) {
  const ready = useAuthStore((s) => s.ready);
  const user = useAuthStore((s) => s.user);
  const cachedUid = useAuthStore((s) => s.cachedUid);
  if (!ready && cachedUid) return <>{children}</>;
  if (!ready) return <CenteredSpinner />;
  if (!user) return <SignInScreen />;
  return <>{children}</>;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <RequireAuth>
        {/* The same flex column the Wurld AppShell gave every route: the life
            screens size themselves with flex-1 / min-h-0 and overlays use
            absolute inset-0, so they need a parent with a real height. */}
        <main data-overlay-bounds="" className="flex-1 min-w-0 min-h-0 flex flex-col">
        <Routes>
          {/* Branded URL; code identifiers stay `life*` (LIFE-WORLD-*). */}
          <Route path="/wurlds" element={<LifeOverviewScreen />} />
          <Route path="/wurlds/overview" element={<Navigate to="/wurlds" replace />} />
          <Route path="/wurlds/start" element={<LifeStartScreen />} />
          <Route path="/wurlds/:worldId" element={<KeyedLifeScreen />} />
          <Route path="*" element={<Navigate to="/wurlds" replace />} />
        </Routes>
        </main>
      </RequireAuth>
    </Suspense>
  );
}
