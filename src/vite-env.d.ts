/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

// OBS-VERSION-1: build provenance injected by Vite `define` (see vite.config.ts
// → resolveBuildInfo). Compile-time string constants — read them via
// src/lib/version.ts, never directly in components.
declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;
declare const __BUILD_CHANNEL__: string;
