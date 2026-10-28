import { useState, type FormEvent } from 'react';
import {
  GoogleAuthProvider,
  browserPopupRedirectResolver,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signInWithPopup,
} from 'firebase/auth';
import { auth } from '@/lib/firebase';
import * as log from '@/lib/log';

/**
 * Minimal sign-in for the standalone app: Google, or email + password.
 *
 * Both are providers the Wurld app already enables on its Auth project, so
 * pointing this app at `wurld-e27d8` (docs/setup.md, "shared auth") lets an
 * existing Wurld account sign straight in with the same Google account or
 * email. Wurld's phone-number step (AUTH-ACCOUNT-3) is NOT required here: see
 * `src/store/authStore.ts` and docs/porting-notes.md.
 *
 * The Wurld app's full login (phone OTP, Apple, account linking, native
 * Capacitor auth) lives in arneyjfs/wurld-app `src/screens/LoginScreen.tsx`
 * if this ever needs to match it.
 */
export function SignInScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'signin' | 'create'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      const code = (err as { code?: string } | null)?.code ?? 'unknown';
      log.warn('signin.failed', { code });
      setError(code.replace(/^auth\//, '').replace(/-/g, ' '));
    } finally {
      setBusy(false);
    }
  };

  const onGoogle = () =>
    run(() => signInWithPopup(auth, new GoogleAuthProvider(), browserPopupRedirectResolver));

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void run(() =>
      mode === 'signin'
        ? signInWithEmailAndPassword(auth, email.trim(), password)
        : createUserWithEmailAndPassword(auth, email.trim(), password),
    );
  };

  return (
    <main className="min-h-dvh flex items-center justify-center bg-(--color-bg) text-(--color-fg) px-4">
      <div className="w-full max-w-sm flex flex-col gap-4">
        <h1 className="text-2xl font-semibold text-center">Wurlds</h1>
        <p className="text-sm text-center text-(--color-fg-muted)">
          Live a story in the language you are learning.
        </p>
        <button
          type="button"
          onClick={() => void onGoogle()}
          disabled={busy}
          className="w-full py-3 rounded-xl bg-(--color-accent) text-(--color-accent-fg) font-medium disabled:opacity-60"
        >
          Continue with Google
        </button>
        <form onSubmit={onSubmit} className="flex flex-col gap-2">
          <input
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-(--color-border) bg-(--color-bg-elevated)"
          />
          <input
            type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-(--color-border) bg-(--color-bg-elevated)"
          />
          <button
            type="submit"
            disabled={busy || !email || !password}
            className="w-full py-3 rounded-xl border border-(--color-border-strong) font-medium disabled:opacity-60"
          >
            {mode === 'signin' ? 'Sign in with email' : 'Create account'}
          </button>
        </form>
        <button
          type="button"
          onClick={() => setMode(mode === 'signin' ? 'create' : 'signin')}
          className="text-sm text-(--color-fg-muted) underline"
        >
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-center text-(--color-danger)">
            {error}
          </p>
        )}
      </div>
    </main>
  );
}
