import { z } from 'zod';

/** Live legal-policy config — Firestore doc `config/legal` (AUTH-LEGAL-1).
 *  Co-located with the legal defaults/state rather than in firestore.ts
 *  to keep all legal-policy concerns in one module. Read via
 *  `useLegalConfig()`; client-read only (never client-writable — see
 *  firestore.rules). */
export const ZLegalConfig = z.object({
  termsVersion: z.number(),
  privacyVersion: z.number(),
  termsUrl: z.string(),
  privacyUrl: z.string(),
});
export type LegalConfig = z.infer<typeof ZLegalConfig>;

/**
 * Legal-policy config: versions + URLs for Terms and Privacy.
 *
 * The live source of truth is the Firestore doc `config/legal`, read via
 * `useLegalConfig()` (AUTH-LEGAL-1). These constants are the shipped
 * fallback used when that doc is absent or hasn't loaded with a default
 * yet, so the onboarding gate always has a baseline to enforce and the
 * app works before the doc exists.
 *
 * The `termsUrl` / `privacyUrl` are the live public documents at
 * `wurld.chat` and are CONSUMED directly — the Settings + acceptance
 * surfaces link out to them (AUTH-LEGAL-6). There is no bundled in-app
 * copy; these URLs are the only place the Terms + Privacy text lives.
 *
 * Bumping a version here (and/or in the live doc) re-gates users into the
 * agreements step (AUTH-LEGAL-3). The versions are mirrored across two
 * sources — these constants and the `config/legal` doc — bump both on a
 * material change to the public documents so existing users re-accept.
 */
// v6 (2026-10-23): minimum age raised from 16 to 18 (the Gemini API / Google
// Cloud generative-AI terms bar apps likely to be used by under-18s); the
// Terms row re-confirms "18 or over" (AUTH-LEGAL-10/10.1). Re-seed
// `config/legal` at terms v6 once the updated wurld.chat/terms page is live.
// v5 (2026-10-22): Terms gain Community standards (zero tolerance, block and
// report, 24-hour review; SAFETY-POLICY-1/2); Privacy says reports are kept as
// moderation records. Re-seed `config/legal` at v5 when the pages go live.
// v4 (2026-09-29): Terms + Privacy cover Wurld Plus (subscriptions, payments,
// billing-record retention, free Plus being withdrawable). The live
// `config/legal` doc is created at v4 when the new wurld.chat pages go live.
// v3 (2026-07-07): Terms + Privacy moved OUT to the live wurld.chat pages
// (external links, no bundled copy). Bumped from v2 so existing users
// re-accept against the now-live documents. When the live `config/legal`
// Firestore doc exists, bump it to match on deploy (re-seed to re-prompt).
// v2 (2026-06-15): first substantive Terms + Privacy (bundled in-app; removed
// in v3). v1: placeholder.
export const DEFAULT_LEGAL_CONFIG: LegalConfig = {
  termsVersion: 6,
  privacyVersion: 5,
  termsUrl: 'https://wurld.chat/terms',
  privacyUrl: 'https://wurld.chat/privacy',
};

/**
 * Resolved state of the legal config for gate consumers.
 *
 * `unknown` means we have never loaded the doc and have no cached copy —
 * the gate must NOT raise agreement gaps in this state (don't gate on a
 * config we haven't seen — AUTH-LEGAL-1). `ready` carries the effective
 * versions/URLs (live doc, cached mirror, or shipped default).
 */
export type LegalConfigState =
  | { status: 'unknown' }
  | ({ status: 'ready' } & LegalConfig);
