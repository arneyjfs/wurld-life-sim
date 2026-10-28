import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/**
 * Build provenance as compile-time constants (typed in src/vite-env.d.ts,
 * read by src/lib/buildInfo.ts). Trimmed from the Wurld app's config: no PWA,
 * no Sentry source-map upload, no test-map recorder, no FCM service worker.
 * See docs/porting-notes.md for what was dropped and how to add it back.
 */
function resolveBuildInfo(mode: string) {
  const pkg = JSON.parse(
    readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf8'),
  ) as { version: string };
  let gitSha = 'unknown';
  try {
    gitSha = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    // Not a git checkout (e.g. a tarball build); keep 'unknown'.
  }
  return {
    version: pkg.version,
    gitSha,
    buildTime: new Date().toISOString(),
    channel: mode === 'production' ? 'prod' : mode,
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const buildInfo = resolveBuildInfo(mode);
  return {
    define: {
      __APP_VERSION__: JSON.stringify(buildInfo.version),
      __GIT_SHA__: JSON.stringify(buildInfo.gitSha),
      __BUILD_TIME__: JSON.stringify(buildInfo.buildTime),
      __BUILD_CHANNEL__: JSON.stringify(buildInfo.channel),
    },
    // Same-origin proxy to the Cloud Functions so LAN / phone testing against
    // `vite dev` does not trip CORS (src/lib/config.ts uses `/__functions` in dev).
    server: {
      host: true,
      proxy: env.VITE_FUNCTIONS_URL
        ? {
            '/__functions': {
              target: env.VITE_FUNCTIONS_URL,
              changeOrigin: true,
              secure: true,
              rewrite: (p) => p.replace(/^\/__functions/, ''),
            },
          }
        : undefined,
    },
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Locale catalogues are lazy-loaded per language (src/i18n/store.ts).
          chunkFileNames: (chunk) => {
            const ids = chunk.moduleIds;
            const match =
              ids.length === 1
                ? /[/\\]src[/\\]i18n[/\\]locales[/\\]([^/\\]+)\.ts$/.exec(ids[0]!)
                : null;
            return match && match[1] !== 'en'
              ? 'assets/i18n/[name]-[hash].js'
              : 'assets/[name]-[hash].js';
          },
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, 'src'),
        // Firestore >= 12.14 bundles re2js for Pipelines regex evaluators,
        // which this app never calls.
        re2js: path.resolve(import.meta.dirname, 'src/shims/re2js.ts'),
      },
    },
  };
});
