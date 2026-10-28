import './lib/zodConfig';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initSentry } from './lib/sentry';
import * as log from './lib/log';
import { installKeyboardInset } from './lib/keyboardInset';
import { installTestHooks } from './lib/testHooks';
import { getRuntime } from './lib/runtime';
import App from './App.tsx';
import './styles/globals.css';

/**
 * Standalone boot for Wurlds. Much thinner than the Wurld app's main.tsx: no
 * push, no live updates, no service worker, no splash, no forced sign-out
 * watcher. See docs/porting-notes.md for each piece that was left behind.
 */
// Expose the runtime to CSS: globals.css sizes #root as a full-height flex
// column only under `[data-runtime=...]`, and every life screen depends on it.
document.documentElement.dataset.runtime = getRuntime();
void initSentry();
installKeyboardInset();
installTestHooks();
window.addEventListener('unhandledrejection', (e) => log.error(e.reason, { action: 'unhandledrejection' }));

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
