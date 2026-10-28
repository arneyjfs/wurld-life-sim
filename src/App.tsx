import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { AppRoutes } from './routes';
import { useAuthStore } from './store/authStore';
import { useUserProfile } from './hooks/useUserProfile';
import { initI18n } from './i18n';
import * as log from './lib/log';

/** App-wide effects: Sentry user + UI locale follow the signed-in profile. */
function GlobalEffects() {
  const user = useAuthStore((s) => s.user);
  const profile = useUserProfile(user?.uid ?? null);

  useEffect(() => {
    void initI18n({ nativeLanguageHint: profile.data?.nativeLanguage ?? null });
  }, [profile.data?.nativeLanguage]);

  useEffect(() => {
    log.setUser(user?.uid ?? null);
  }, [user]);

  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <GlobalEffects />
      <AppRoutes />
    </BrowserRouter>
  );
}
