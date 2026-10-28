/**
 * Firebase Admin SDK helpers for E2E test setup/teardown.
 *
 * Uses the Admin SDK to:
 * - Create/delete test users in Firebase Auth
 * - Generate custom auth tokens (bypass phone auth + reCAPTCHA in tests)
 * - Read/write/clean Firestore documents for assertions and teardown
 */

import * as admin from 'firebase-admin';
import path from 'path';
import { readFileSync } from 'fs';
import { FIREBASE_PROJECT_ID } from './constants';
import { identityToolkitSignInUrl } from './harnessTarget';

/** The shipped legal versions (DEFAULT_LEGAL_CONFIG), read from the source so
 *  the E2E suite follows every bump without a second edit. */
export const SHIPPED_LEGAL = (() => {
  const src = readFileSync(path.resolve(__dirname, '../../../src/lib/legalConfig.ts'), 'utf8');
  const block = src.slice(src.indexOf('DEFAULT_LEGAL_CONFIG'));
  const num = (k: string) => {
    const m = new RegExp(`${k}:\\s*(\\d+)`).exec(block);
    if (!m) throw new Error(`SHIPPED_LEGAL: ${k} not found in src/lib/legalConfig.ts`);
    return Number(m[1]);
  };
  return { termsVersion: num('termsVersion'), privacyVersion: num('privacyVersion') };
})();

// Singleton — initialise once per test process
let _app: admin.app.App | null = null;

function getApp(): admin.app.App {
  if (_app) return _app;

  // Resolve GOOGLE_APPLICATION_CREDENTIALS relative to tests/e2e/ dir
  const credPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (credPath && !path.isAbsolute(credPath)) {
    process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, '..', credPath);
  }

  _app = admin.initializeApp({
    projectId: FIREBASE_PROJECT_ID,
  });
  return _app;
}

export function getAdminAuth(): admin.auth.Auth {
  return getApp().auth();
}

export function getAdminFirestore(): admin.firestore.Firestore {
  return getApp().firestore();
}

// ─── Auth helpers ────────────────────────────────────────────────────────────

/**
 * Create a test user in Firebase Auth (or return existing).
 * Returns the UID.
 */
export async function ensureTestUser(phoneNumber: string): Promise<string> {
  const auth = getAdminAuth();
  let uid: string;
  try {
    uid = (await auth.getUserByPhoneNumber(phoneNumber)).uid;
  } catch (err: any) {
    if (err.code !== 'auth/user-not-found') throw err;
    uid = (await auth.createUser({ phoneNumber })).uid;
  }
  await ensureEmailMethod(uid, phoneNumber);
  return uid;
}

/** The email the harness gives a pool user, derived from its phone. */
export function testEmailFor(phoneNumber: string): string {
  return `e2e${phoneNumber.replace(/\D/g, '')}@e2e.wurld.test`;
}
export const TEST_PASSWORD = 'e2e-password-1';

/**
 * AUTH-ACCOUNT-1 — every account the app runs as has a phone AND an email
 * method; a phone-only account is held on the add-email screen
 * (AUTH-ACCOUNT-5). So every pool user gets an email + password. Idempotent.
 */
export async function ensureEmailMethod(uid: string, phoneNumber: string): Promise<void> {
  const auth = getAdminAuth();
  const user = await auth.getUser(uid);
  if (user.providerData.some((p) => ['password', 'google.com', 'apple.com'].includes(p.providerId))) return;
  await auth.updateUser(uid, { email: testEmailFor(phoneNumber), password: TEST_PASSWORD });
}

/** A migrated account: phone + email/password (a fresh user). */
export async function provisionedEmailUser(phoneNumber: string): Promise<{ uid: string; email: string }> {
  const uid = await createPhoneOnlyUser(phoneNumber);
  await ensureEmailMethod(uid, phoneNumber);
  return { uid, email: testEmailFor(phoneNumber) };
}

/**
 * AUTH-ACCOUNT-5 / -6 — a pre-2026-10 account: phone only, no email method.
 * Creates it fresh (any existing user with that phone is deleted first).
 */
export async function createPhoneOnlyUser(phoneNumber: string): Promise<string> {
  const auth = getAdminAuth();
  try {
    const existing = await auth.getUserByPhoneNumber(phoneNumber);
    await auth.deleteUser(existing.uid);
  } catch (err: any) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
  return (await auth.createUser({ phoneNumber })).uid;
}

/**
 * Generate a custom auth token for a test user.
 * The browser can call `signInWithCustomToken(auth, token)` to authenticate
 * without going through phone auth + reCAPTCHA.
 */
export async function createCustomToken(uid: string): Promise<string> {
  return getAdminAuth().createCustomToken(uid);
}

/**
 * Delete a test user from Firebase Auth.
 */
export async function deleteTestUser(uid: string): Promise<void> {
  try {
    await getAdminAuth().deleteUser(uid);
  } catch (err: any) {
    if (err.code !== 'auth/user-not-found') throw err;
  }
}

/**
 * Exchange a custom token for an actual Firebase ID token.
 * Uses the Firebase Auth REST API (signInWithCustomToken endpoint).
 * Needed for calling authenticated HTTP Cloud Functions directly.
 * Includes retry logic for transient 503 errors.
 */
export async function createIdToken(customToken: string): Promise<string> {
  // HARNESS-PROD-1 — emulator endpoint under `emulators:exec`; the real
  // Identity Toolkit (prod Auth) only with an explicit E2E_ALLOW_PROD=1 and
  // FIREBASE_API_KEY. No built-in key: throws otherwise (audit ENV-12).
  const url = identityToolkitSignInUrl(process.env);

  const maxRetries = 3;
  let lastError: Error | null = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: customToken, returnSecureToken: true }),
    });
    
    if (res.ok) {
      const data = await res.json() as { idToken: string };
      return data.idToken;
    }
    
    const body = await res.text();
    lastError = new Error(`Failed to exchange custom token for ID token: ${res.status} ${body}`);
    
    // Retry on 503 (service unavailable) or 429 (rate limit)
    if ((res.status === 503 || res.status === 429) && attempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff: 1s, 2s, 4s (max 5s)
      console.log(`[createIdToken] Attempt ${attempt} failed with ${res.status}, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
      continue;
    }
    
    throw lastError;
  }
  
  throw lastError ?? new Error('createIdToken failed after retries');
}

// ─── Firestore helpers ───────────────────────────────────────────────────────

/** Wurlds has no public `profiles/{uid}` mirror (that was Wurld's PROF-2
 *  for chat member rows), so there is nothing to mirror. Kept as a no-op so
 *  the provisioning flow reads the same as the Wurld harness it came from. */
async function mirrorProfileDoc(_uid: string): Promise<void> {}

/**
 * Ensure a user profile document exists in Firestore for a test user.
 * Also seeds the matching public `profiles/{uid}` doc (PROF-1/2).
 */
export async function ensureUserProfile(
  uid: string,
  profile: {
    displayName: string;
    nativeLanguage: string;
    learningLanguage: string;
    phoneNumber: string;
    difficulty?: number;
  },
): Promise<void> {
  const db = getAdminFirestore();
  const ref = db.doc(`users/${uid}`);
  // Seed a FULLY-COMPLETE profile so the onboarding gate
  // (auth-onboarding AUTH-PROFILE-1) lets the test user straight into the
  // app. Every required field is set, plus legal acceptance at the shipped
  // default versions (DEFAULT_LEGAL_CONFIG = terms 1 / privacy 1). Specs
  // that want to exercise a gap call `clearUserDocFields` afterwards.
  const complete = {
    // Deliberately NO `uid` field. Production user docs are written only via
    // writeUserSetting, which never stores uid — the doc id IS the uid and
    // ZUser derives it (AUTH-PROFILE-9). Seeding uid here tested a shape that
    // never occurs in prod and masked the onboarding-gate wedge (a uid-less
    // doc failed to parse → null profile → stuck on accept-legal). Keep it
    // absent so the onboarding/legal specs exercise the real doc shape.
    displayName: profile.displayName,
    nativeLanguage: profile.nativeLanguage,
    learningLanguage: profile.learningLanguage,
    phoneNumber: profile.phoneNumber,
    difficulty: profile.difficulty ?? 2,
    pronouns: '', // valid ("prefer not to say"); not a gap
    notificationLanguage: 'practice',
    // 1×1 transparent PNG — satisfies the photo requirement without an upload.
    tinyImage:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    // Must match DEFAULT_LEGAL_CONFIG (src/lib/legalConfig.ts) so a
    // provisioned user isn't legally-stale → routed to accept-legal
    // instead of the app. READ from that file, so a version bump there can
    // never silently send every provisioned user to the legal page.
    acceptedTermsVersion: SHIPPED_LEGAL.termsVersion,
    acceptedPrivacyVersion: SHIPPED_LEGAL.privacyVersion,
    // ⚠ ENTITLEMENT IS SEEDED EXPLICITLY, not inherited from the signup
    // trigger. LANG-TIER-2 gates group creation on `hasPaidEntitlement`
    // (firestore.rules), and LANG-GATE-1 pauses a chat with no entitled member,
    // so a cohort with neither field cannot send or make a group — most of the
    // suite fails, looking exactly like a regression in those rules.
    //
    // Inheriting it from `onUserCreated`'s trial was the tempting version and
    // is non-deterministic: `ensureTestUser` REUSES an auth user found by phone
    // number, so a run that aborted before `afterAll` deleted the cohort leaves
    // accounts whose `trialEndsAt` is over 24 hours old. The next run then
    // reuses them, the trial reads as lapsed, `plan` was never written, and the
    // suite fails on the second run and passes on the first. Reliability
    // principle 3: that is a failure, not a flake.
    //
    // `plan` rather than a fresh trial, deliberately — a stamp cannot go stale
    // mid-run, and a test cohort has no business exercising trial EXPIRY by
    // accident. Specs that want a lapsed or free user say so with
    // `patchUserDoc`, which is legible at the point it matters.
    plan: 'pro',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  const snap = await ref.get();
  if (snap.exists) {
    await ref.update(complete);
  } else {
    await ref.set({
      ...complete,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }
  await mirrorProfileDoc(uid);
}

/** Merge arbitrary fields onto a user doc (onboarding specs). */
export async function patchUserDoc(
  uid: string,
  fields: Record<string, unknown>,
): Promise<void> {
  await getAdminFirestore()
    .doc(`users/${uid}`)
    .set(
      { ...fields, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true },
    );
  await mirrorProfileDoc(uid);
}

/** Delete named fields from a user doc to manufacture a profile gap. */
export async function clearUserDocFields(uid: string, fields: string[]): Promise<void> {
  const patch: Record<string, unknown> = {};
  for (const f of fields) patch[f] = admin.firestore.FieldValue.delete();
  await getAdminFirestore().doc(`users/${uid}`).update(patch);
}

/** Seed / overwrite the live legal config doc (AUTH-LEGAL-1). */
export async function seedLegalConfig(cfg: {
  termsVersion: number;
  privacyVersion: number;
  termsUrl?: string;
  privacyUrl?: string;
}): Promise<void> {
  await getAdminFirestore()
    .doc('config/legal')
    .set(
      {
        termsUrl: 'https://wurld.chat/terms',
        privacyUrl: 'https://wurld.chat/privacy',
        ...cfg,
      },
      { merge: true },
    );
}

export async function deleteLegalConfig(): Promise<void> {
  await getAdminFirestore().doc('config/legal').delete();
}

/**
 * Find a direct chat between two users, if one exists.
 */
export async function findDirectChat(uidA: string, uidB: string): Promise<string | null> {
  const db = getAdminFirestore();
  const directKey = [uidA, uidB].sort().join('_');
  const snap = await db.collection('chats')
    .where('directKey', '==', directKey)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Create a direct (1:1) chat between two users via Admin SDK.
 * This mirrors the structure created by the client's createChatInFirestore().
 */
export async function createDirectChat(
  uidA: string,
  nameA: string,
  phoneA: string,
  uidB: string,
  nameB: string,
  phoneB: string,
): Promise<string> {
  const db = getAdminFirestore();
  const directKey = [uidA, uidB].sort().join('_');
  const ref = await db.collection('chats').add({
    isGroup: false,
    members: [uidA, uidB],
    memberNames: { [uidA]: nameA, [uidB]: nameB },
    memberPhones: { [uidA]: phoneA, [uidB]: phoneB },
    unreadCounts: { [uidA]: 0, [uidB]: 0 },
    directKey,
    lastMessage: '',
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/** The e2e user pool's native language (a REGIONAL name; its rows are seeded
 *  under the base key `translationKeyFor(SEED_NATIVE)` = 'English'). */
const SEED_NATIVE = 'English (British)';

/**
 * Write a seed message into a chat so it appears in the chat list with content.
 * Uses Admin SDK — no pipeline, just a plain Firestore doc.
 */
export async function seedMessage(
  chatId: string,
  senderId: string,
  text: string,
  opts: {
    senderName?: string;
    originalLanguage?: string;
    /** Pre-baked translations map: `{ <Language>: { text } }`.
     *  When omitted, the helper stamps a stub translation for every
     *  practice language a typical scroll spec uses ('Spanish',
     *  'French', 'German') — each translation text is just the
     *  original prefixed with the language tag, e.g. text='hello'
     *  → translations.Spanish.text='[es] hello'.
     *
     *  Why: chat-scroll specs match seeded bubbles by their visible
     *  text. Without a translation, the bubble renders a
     *  "Translating…" shimmer (no body text) and `hasText` matchers
     *  miss. Supplying a stub keeps `text` substring-matchable AND
     *  exercises the translated-bubble layout. */
    translations?: Record<string, { text: string; complexWords?: string[]; wordTranslations?: Record<string, string> }>;
    /** Explicit createdAt (ms since epoch). Backfilled history MUST pass this
     *  with deterministic, SPACED values: 80 `serverTimestamp()`s written in a
     *  tight loop cluster to near-identical times, so the ordering is fragile
     *  and an in-test "now" message can sort INTO the pack rather than cleanly
     *  at the tail — the engine then classifies it CASE 5 ITEM-EDIT (middle
     *  insert) instead of CASE 3 APPEND and skips the tail-insert compensation,
     *  drifting the reading position. Omit for one-off in-test sends (they get
     *  serverTimestamp = now, which is unambiguously newest vs spaced history). */
    createdAtMs?: number;
    /** Write at this id (e.g. the id a test push already carried, NOTIF-17)
     *  instead of an auto id. */
    messageId?: string;
  } = {},
): Promise<string> {
  const db = getAdminFirestore();
  // `senderName` + `originalLanguage` aren't strictly required by Zod
  // (they're z.string().optional()), but several rendering paths
  // assume they exist — without them, specs that screenshot the bubble
  // can see odd states. Default the name to "Test User" and the
  // language to the test users' native ('English (British)') so seeded
  // messages render cleanly.
  //
  // CRITICAL (matches the real pipeline): `useMessageTranslation` now reads
  // TRANSLATION FIELDS ONLY — both the native AND practice rows read
  // `translations[translationKey(language)]` with NO `originalText` fallback.
  // So the message's NATIVE-language key MUST be present (the pipeline writes
  // a same-language identity copy), or the native row resolves empty, the
  // bubble reads as un-translated ("Translating" chip + on-open backfill churn
  // that fights the scroll), and the seeded history never settles.
  //
  // MSG-KEY-10 / DEAD-2 (2026-09-29): the key is the BASE language — the
  // client reads ONLY `translations[translationKey(viewer.nativeLanguage)]`,
  // so for the 'English (British)' test pool that is `English`, never the
  // regional name. A seed keyed 'English (British)' is invisible to the
  // client and renders as a permanent "Translating" shimmer.
  const defaultTranslations: Record<string, { text: string }> = {
    // Native identity copy under the BASE key. Text is the original verbatim
    // (no language prefix — it IS the native rendering).
    [translationKeyFor(SEED_NATIVE)]: { text },
    Spanish: { text: `[es] ${text}` },
    French: { text: `[fr] ${text}` },
    German: { text: `[de] ${text}` },
  };
  const messages = db.collection(`chats/${chatId}/messages`);
  const ref = opts.messageId ? messages.doc(opts.messageId) : messages.doc();
  await ref.set({
    text,
    originalText: text,
    senderId,
    senderName: opts.senderName ?? 'Test User',
    originalLanguage: opts.originalLanguage ?? 'English (British)',
    translations: opts.translations ?? defaultTranslations,
    sendStatus: 'sent',
    // Nested `pipeline.state` — the client's Zod schema dropped the
    // legacy top-level `pipelineState` mirror in favour of the
    // backend-authoritative nested map. Seeds writing the old shape
    // parse as schema-drift and the message is filtered out of the
    // rendered list.
    pipeline: { state: 'done' },
    createdAt:
      opts.createdAtMs != null
        ? admin.firestore.Timestamp.fromMillis(opts.createdAtMs)
        : admin.firestore.FieldValue.serverTimestamp(),
    deletedForEveryone: false,
  });
  // Update the chat's lastMessage so it shows in the chat list
  await db.doc(`chats/${chatId}`).update({
    lastMessage: text,
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/** Mark another member as typing (TYPING-2a) — the write the composer makes. */
export async function setPeerTyping(chatId: string, uid: string): Promise<void> {
  const db = getAdminFirestore();
  await db.doc(`chats/${chatId}`).update({
    [`typing.${uid}`]: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Seed an INCOMING message that is still IN FLIGHT — `sendStatus: 'translating'`
 * with no translations yet, exactly the shape the pipeline writes between the
 * skeleton landing and the analysis completing.
 *
 * Why not `seedMessage`: that helper writes `sendStatus: 'sent'` with
 * pre-baked translations, so there is no in-flight window at all — a typing
 * spec seeded with it would assert against a message that was never pending.
 *
 * Pair with `resolveSeededMessage` to drive the arrival deterministically.
 * The alternative — letting the real Cloud Function pipeline run — re-tests
 * the pipeline (covered elsewhere) and makes the timing of a frame-accurate
 * hand-off assertion depend on a Gemini round-trip.
 */
export async function seedInFlightMessage(
  chatId: string,
  senderId: string,
  text: string,
  opts: {
    senderName?: string;
    originalLanguage?: string;
    /** Explicit createdAt (ms). Pass a backdated value to reproduce the
     *  condition MSG-BUBBLE-8.5 exists for: by the time the pipeline releases a
     *  withheld message, `createdAt` is when the SENDER sent it, which can be
     *  older than the entrance's ~3s age gate. Without backdating, an emulator
     *  round-trip is fast enough that the gate passes anyway and a test of the
     *  forced entrance cannot fail. */
    createdAtMs?: number;
    /** Fixed message id (NOTIF-17 push-tap specs match a pushed id). */
    messageId?: string;
  } = {},
): Promise<string> {
  const db = getAdminFirestore();
  const messages = db.collection(`chats/${chatId}/messages`);
  const ref = opts.messageId ? messages.doc(opts.messageId) : messages.doc();
  await ref.set({
    text,
    originalText: text,
    senderId,
    senderName: opts.senderName ?? 'Test User',
    originalLanguage: opts.originalLanguage ?? 'English (British)',
    translations: {},
    sendStatus: 'translating',
    pipeline: { state: 'analyzing' },
    createdAt:
      opts.createdAtMs != null
        ? admin.firestore.Timestamp.fromMillis(opts.createdAtMs)
        : admin.firestore.FieldValue.serverTimestamp(),
    deletedForEveryone: false,
  });
  return ref.id;
}

/** Land the translations on a `seedInFlightMessage` doc — the arrival. */
export async function resolveSeededMessage(
  chatId: string,
  messageId: string,
  text: string,
  opts: {
    /**
     * Per-language text, merged over the defaults below. The arrival FLIP
     * (MSG-BUBBLE-10) only makes room for itself when the two faces are
     * different HEIGHTS, so a spec measuring that has to be able to land a
     * practice row that wraps to a different number of lines than the
     * sender's own words. Every default here is the same string, which is
     * exactly the case where `flipSpacerHeightAt` opts out.
     */
    translations?: Record<string, string>;
  } = {},
): Promise<void> {
  const db = getAdminFirestore();
  const overrides = Object.fromEntries(
    Object.entries(opts.translations ?? {}).map(([lang, t]) => [lang, { text: t }]),
  );
  await db.doc(`chats/${chatId}/messages/${messageId}`).update({
    // The BASE key only (MSG-KEY-10 / DEAD-2): the native row reads
    // `translations[translationKey(viewer.nativeLanguage)]` with no
    // originalText fallback, and every English variant in the test pool
    // resolves to `English`. A regional key would never be read.
    translations: {
      English: { text },
      Spanish: { text: `[es] ${text}` },
      French: { text: `[fr] ${text}` },
      German: { text: `[de] ${text}` },
      ...overrides,
    },
    sendStatus: 'sent',
    pipeline: { state: 'done' },
  });
}

/**
 * Seed a whole history in ONE Firestore batch (single commit). Use for
 * per-test baseline resets where seeding 80 messages one-await-at-a-time would
 * dominate the runtime. Same doc shape as seedMessage (native identity-copy
 * key + practice translations + pipeline.state='done'), explicit spaced
 * timestamps for deterministic order. Returns the created message ids in input
 * order. Caps at the 500-op batch limit (80 + 1 chat update is well under).
 */
/**
 * MSG-KEY-10.1 — the BASE translation key for a language name, mirrored from
 * `src/lib/translationKeys.ts:translationKey` for the languages the e2e pool
 * uses (the e2e package does not compile app sources). Every regional variant
 * in the pool — 'English (British)', 'English (American)', 'French (Canadian)',
 * 'Spanish (Mexico)' — merges into its bare group key by dropping the
 * parenthesised tag. If the production table ever stops merging one of these,
 * the seeded rows go invisible again ("Translating" shimmer), which is the
 * signal to revisit this mirror.
 */
export function translationKeyFor(language: string): string {
  return (language || '').replace(/\s*\([^)]*\)\s*/g, ' ').trim();
}

/**
 * `{practice}Annotated{Native}` over BASE keys (MSG-KEY-10.2) — mirrored from
 * `src/lib/translationKeys.ts:annotatedKey`, e.g.
 * ('French', 'English (British)') → 'frenchAnnotatedEnglish'. If the real
 * format drifts, the seeded messages go back to reading as INTERIM and the
 * chat-scroll suite starts flaking again, which is the signal.
 */
export function annotatedKeyFor(practiceLanguage: string, nativeLanguage: string): string {
  const norm = (lang: string) => translationKeyFor(lang).replace(/\s+/g, '_');
  const p = norm(practiceLanguage);
  const n = norm(nativeLanguage);
  return `${p.charAt(0).toLowerCase() + p.slice(1)}Annotated${n.charAt(0).toUpperCase() + n.slice(1)}`;
}

/**
 * SCROLL-FIXTURE-1 — seeded messages arrive ANNOTATED, so opening the chat
 * does not kick off a repair.
 *
 * A message whose practice row has no annotated key reads as INTERIM
 * (`practiceSource === 'bare'`), which starts a `chatTranslationsBackfill` on
 * chat open and mounts the MSG-KEY-9.6 "adding vocab…" row on every such
 * bubble — ~15.75px each, arriving ~1.4s in and leaving ~1.8s later. That is a
 * whole-list reflow landing at a time that varies run to run, and whether it
 * falls inside a given test's measurement window is why the same commit
 * produced 0, 2 and 3 chat-scroll failures across three runs of an unchanged
 * tree (2026-08-01).
 *
 * Real chats mostly do not hit this: their messages arrive translated through
 * the pipeline. It is an artefact of seeding raw text, so the fix belongs in
 * the seeder rather than in a wait inside every spec that happens to notice.
 */
const SEED_PRACTICE_LANGS = ['Spanish', 'French', 'German'] as const;

export async function seedMessagesBatch(
  chatId: string,
  items: Array<{
    senderId: string;
    senderName: string;
    text: string;
    createdAtMs: number;
    originalLanguage?: string;
  }>,
): Promise<string[]> {
  const db = getAdminFirestore();
  const batch = db.batch();
  const ids: string[] = [];
  for (const it of items) {
    const ref = db.collection(`chats/${chatId}/messages`).doc();
    ids.push(ref.id);
    batch.set(ref, {
      text: it.text,
      originalText: it.text,
      senderId: it.senderId,
      senderName: it.senderName,
      originalLanguage: it.originalLanguage ?? 'English (British)',
      translations: {
        // BASE key (MSG-KEY-10 / DEAD-2) — see seedMessage.
        [translationKeyFor(SEED_NATIVE)]: { text: it.text },
        Spanish: { text: `[es] ${it.text}` },
        French: { text: `[fr] ${it.text}` },
        German: { text: `[de] ${it.text}` },
        // SCROLL-FIXTURE-1: the annotated keys, so the row is not interim.
        // `practiceSource` only needs `{ text }` to be present under the key —
        // the annotation markup itself is not what the interim test reads.
        ...Object.fromEntries(
          SEED_PRACTICE_LANGS.map((lang) => [
            annotatedKeyFor(lang, SEED_NATIVE),
            { text: `[${lang.slice(0, 2).toLowerCase()}] ${it.text}` },
          ]),
        ),
      },
      sendStatus: 'sent',
      pipeline: { state: 'done' },
      createdAt: admin.firestore.Timestamp.fromMillis(it.createdAtMs),
      deletedForEveryone: false,
    });
  }
  const last = items[items.length - 1];
  if (last) {
    batch.update(db.doc(`chats/${chatId}`), {
      lastMessage: last.text,
      lastMessageAt: admin.firestore.Timestamp.fromMillis(last.createdAtMs),
    });
  }
  await batch.commit();
  return ids;
}

/**
 * Seed a multi-image (or single-image) message directly into Firestore
 * with the multi-image schema (`images: ImageAttachment[]`). Bypasses
 * the upload pipeline — used by E2E specs that need to assert grid /
 * viewer / chat-info-gallery rendering without paying the Storage
 * upload cost. Image URLs can point at any publicly-reachable CDN; the
 * specs typically use a couple of stable placeholder URLs.
 */
export async function seedImagesMessage(
  chatId: string,
  senderId: string,
  imageUrls: string[],
  opts: {
    senderName?: string;
    caption?: string;
    originalLanguage?: string;
    /** Fixed message id (NOTIF-17 push-tap specs match a pushed id). */
    messageId?: string;
    /** Optional per-image dimensions (parallel to imageUrls). When
     *  omitted, the bubble grid pins to its DEFAULT_AR until <img>
     *  onLoad lands the real value. */
    dimensions?: Array<{ width: number; height: number }>;
    /** Optional per-image thumbnail URLs (parallel to imageUrls) —
     *  IMG-GRID-6's srcset needs a second candidate to choose between. */
    thumbUrls?: string[];
    /** Explicit createdAt. Without this the message is stamped with
     *  serverTimestamp() and is therefore the NEWEST in the chat — which
     *  silently defeats any test that means to place an image inside an
     *  OLDER page (chat-scroll's loadOlder+decode test did exactly that, and
     *  its comment claimed the opposite). */
    createdAtMs?: number;
  } = {},
): Promise<string> {
  if (imageUrls.length === 0) throw new Error('seedImagesMessage: no urls');
  const db = getAdminFirestore();
  const images = imageUrls.map((url, i) => {
    const d = opts.dimensions?.[i];
    const thumbUrl = opts.thumbUrls?.[i];
    return {
      url,
      ...(thumbUrl ? { thumbUrl } : {}),
      ...(d ? { width: d.width, height: d.height } : {}),
    };
  });
  // Mirror the canonical write the outbox drain produces (SEC-MSG-3):
  // `images[]` + `hasImage` are the ONLY media fields on the doc (the flat
  // first-image mirror was retired 2026-09-29). Caption (if any) sits in
  // `originalText`.
  const messages = db.collection(`chats/${chatId}/messages`);
  const ref = opts.messageId ? messages.doc(opts.messageId) : messages.doc();
  await ref.set({
    senderId,
    senderName: opts.senderName ?? 'Test User',
    originalText: opts.caption ?? '',
    originalLanguage: opts.originalLanguage ?? 'English',
    translations: {},
    images,
    hasImage: true,
    sendStatus: 'sent',
    pipeline: { state: 'done' },
    createdAt:
      typeof opts.createdAtMs === 'number'
        ? admin.firestore.Timestamp.fromMillis(opts.createdAtMs)
        : admin.firestore.FieldValue.serverTimestamp(),
    deletedForEveryone: false,
  });
  await db.doc(`chats/${chatId}`).update({
    lastMessage:
      images.length > 1 ? `📷 ${images.length} images` : '📷 Image',
    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return ref.id;
}

/**
 * Find or create a direct chat between two users.
 */
export async function ensureDirectChat(
  uidA: string,
  nameA: string,
  phoneA: string,
  uidB: string,
  nameB: string,
  phoneB: string,
): Promise<string> {
  const existing = await findDirectChat(uidA, uidB);
  if (existing) return existing;
  return createDirectChat(uidA, nameA, phoneA, uidB, nameB, phoneB);
}

/**
 * Get a message document from Firestore.
 */
/**
 * Wait until the SERVER has written the chat state a spec depends on, and say
 * what was missing when it does not.
 *
 * ⚠ **Assert your premise, not a symptom of it.** Every language surface in
 * the app hangs off fields only Cloud Functions write — `languageGate` and
 * `memberLanguageTargetsV2`. A spec that waits on the FLAG or the OFFER is
 * waiting on the last link of a four-link chain, so when the server has not
 * computed yet it reports "an element did not appear" after 30s and names
 * neither the link that broke nor the state it was in. Two specs failed
 * exactly that way on 2026-09-22 and both looked like product bugs.
 *
 * `createDirectChat` deliberately writes NO `languageGate`, which is the
 * correct fixture: absent is UNKNOWN, not unfunded, and the client must treat
 * those differently (`publishedLanguageSet`'s three states). The gate arrives
 * when a trigger computes it. This is how a spec waits for that moment.
 */
/**
 * Make a test user genuinely un/entitled.
 *
 * ⚠ **Writing `plan: 'free'` is NOT enough, and that cost two red runs.**
 * `hasProEntitlement` is `plan === 'pro' || trialActive`, and `onUserCreated`
 * stamps a fresh trial on every user the harness provisions — so a user set to
 * `free` stays ENTITLED until their trial is gone, the room keeps
 * `hasSubscriber: true`, nothing snaps, and every downstream surface is
 * correctly silent. The product is right; the fixture was lying.
 *
 * The real Admin toggle expires the trial as part of going free (ADMIN-PLAN-2),
 * so a spec that writes `plan` directly has to do the same thing by hand or it
 * is testing a state the product never produces.
 */
/** The user-doc twin of `waitForChatServerState`. Same reason: a spec that
 *  waits on a SURFACE cannot tell "the control never fired" from "the server
 *  never propagated", and those have opposite fixes. */
export async function waitForUserState(
  uid: string,
  predicate: (user: Record<string, any>) => boolean,
  what: string,
  timeoutMs = 30_000,
): Promise<Record<string, any>> {
  const db = getAdminFirestore();
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, any> | null = null;
  while (Date.now() < deadline) {
    last = ((await db.doc(`users/${uid}`).get()).data() as Record<string, any>) ?? null;
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `waitForUserState: ${what} \u2014 never true within ${timeoutMs}ms.\n`
    + `  plan = ${JSON.stringify(last?.plan ?? null)}\n`
    + `  trialEndsAt = ${JSON.stringify(last?.trialEndsAt ?? null)}`,
  );
}

export async function setTestEntitlement(uid: string, tier: 'free' | 'pro'): Promise<void> {
  const db = getAdminFirestore();
  const ref = db.doc(`users/${uid}`);
  const write = async () => {
    await ref.set(
      {
        plan: tier,
        // ⚠ **BACK-DATED, NOT DELETED, and I had this exactly backwards.**
        // Deleting looks like the stronger move — absent is a value no clock
        // can re-entitle. But `decideTrialEnrolment` refuses with
        // `already_had_trial` when the stamp is PRESENT, whatever its value,
        // and grants one when it is ABSENT. So deleting marks the user as
        // never-trialled, and `startTrial` — which the app calls on BOOT —
        // hands them a fresh 24 hours the moment `signInBrowser` runs. The
        // fixture was undone by the product's own enrolment path, one step
        // after it ran. A stamp in the past is both "not entitled" and
        // "already had their go".
        // ⚠ BOTH tiers get a spent trial stamp, and `pro` needs it as much as
        // `free` does. `adminFreeTrialStamp` back-dates a LIVE trial when you go
        // free and writes nothing when there is none — so a pro user with NO
        // stamp who toggles to free lands on `{plan:'free'}` with the field
        // still absent, and the app's boot-time `startTrial` hands them a
        // fresh 24 hours. A spent stamp means "already had their go" in both
        // directions, which is the only stable fixture.
        trialEndsAt: admin.firestore.Timestamp.fromMillis(Date.now() - 7 * 86_400_000),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true },
    );
  };
  const settled = async (): Promise<boolean> => {
    const u = (await ref.get()).data() as Record<string, any> | undefined;
    if (!u) return false;
    const spent = (u.trialEndsAt?.toMillis?.() ?? Infinity) < Date.now();
    if (tier === 'pro') return u.plan === 'pro' && spent;
    // Settled means: free plan AND a trial that has already run out. A missing
    // stamp is NOT settled — it is the state that invites a fresh grant.
    return u.plan === 'free' && spent;
  };

  // ⚠ **WRITE, VERIFY, RE-WRITE — and the loop is the point.** `onUserCreated`
  // stamps a fresh trial ASYNCHRONOUSLY, so a single write races it: the delete
  // lands, the trigger fires a moment later and puts `trialEndsAt` back, and the
  // user is entitled again with `plan: 'free'` sitting innocently in the doc.
  // Two full E2E runs failed that way, both looking like a product that would
  // not downgrade. Polling until the state HOLDS is the only version that is
  // not a race, because there is no completion signal for that trigger to wait
  // on from out here.
  for (let attempt = 0; attempt < 12; attempt++) {
    await write();
    await new Promise((r) => setTimeout(r, 750));
    if (await settled()) {
      // Confirm it STAYS settled — one quiet read could simply be the gap
      // before the trigger's write lands.
      await new Promise((r) => setTimeout(r, 750));
      if (await settled()) {
        // PROF-7 — other users read this tier from the profile's `plusUntil`.
        await mirrorProfileDoc(uid);
        return;
      }
    }
  }
  const final = (await ref.get()).data() as Record<string, any> | undefined;
  throw new Error(
    `setTestEntitlement(${uid}, ${tier}) never settled: `
    + `plan=${JSON.stringify(final?.plan)} trialEndsAt=${JSON.stringify(final?.trialEndsAt)}`,
  );
}

export async function waitForChatServerState(
  chatId: string,
  predicate: (chat: Record<string, any>) => boolean,
  what: string,
  timeoutMs = 45_000,
): Promise<Record<string, any>> {
  const db = getAdminFirestore();
  const deadline = Date.now() + timeoutMs;
  let last: Record<string, any> | null = null;
  while (Date.now() < deadline) {
    const snap = await db.doc(`chats/${chatId}`).get();
    last = (snap.data() as Record<string, any>) ?? null;
    if (last && predicate(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(
    `waitForChatServerState: ${what} — never true within ${timeoutMs}ms.\n`
    + `  languageGate = ${JSON.stringify(last?.languageGate ?? null)}\n`
    + `  memberLanguageTargetsV2 = ${JSON.stringify(last?.memberLanguageTargetsV2 ?? null)}`,
  );
}

export async function getMessage(chatId: string, messageId: string): Promise<any | null> {
  const db = getAdminFirestore();
  const snap = await db.doc(`chats/${chatId}/messages/${messageId}`).get();
  return snap.exists ? { id: snap.id, ...snap.data() } : null;
}

/**
 * Get the most recent message in a chat.
 */
export async function getLatestMessage(chatId: string): Promise<any | null> {
  const db = getAdminFirestore();
  const snap = await db.collection(`chats/${chatId}/messages`)
    .orderBy('createdAt', 'desc')
    .limit(1)
    .get();
  return snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };
}

/**
 * Poll Firestore until a message appears in the chat (with optional text match).
 * The client-side translateAndCheck pipeline runs before writing, so there's a
 * delay between the UI bubble appearing and the Firestore document existing.
 */
export async function waitForLatestMessage(
  chatId: string,
  expectedText?: string,
  timeoutMs = 30_000,
  pollMs = 1_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await getLatestMessage(chatId);
    if (msg) {
      if (!expectedText || msg.originalText === expectedText) return msg;
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`waitForLatestMessage: no message found in chat ${chatId} within ${timeoutMs}ms`);
}

/**
 * Poll Firestore until a message with a DIFFERENT ID than excludeId appears.
 * Used after "Send corrected/original" which creates a new message.
 */
export async function waitForNewMessage(
  chatId: string,
  excludeId: string,
  timeoutMs = 30_000,
  pollMs = 1_000,
): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = await getLatestMessage(chatId);
    if (msg && msg.id !== excludeId) return msg;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`waitForNewMessage: no new message found in chat ${chatId} within ${timeoutMs}ms`);
}

/**
 * Wait for a Firestore field to reach an expected value (polling).
 */
export async function waitForField(
  docPath: string,
  field: string,
  expected: any,
  timeoutMs = 30_000,
  pollMs = 1_000,
): Promise<any> {
  const db = getAdminFirestore();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const snap = await db.doc(docPath).get();
    const data = snap.data();
    const value = field.split('.').reduce((o: any, k) => o?.[k], data);
    if (value === expected) return data;
    await new Promise((r) => setTimeout(r, pollMs));
  }
  throw new Error(`Timeout: ${docPath}.${field} never reached ${JSON.stringify(expected)} within ${timeoutMs}ms`);
}

/**
 * Wait for a message's pipeline to reach a terminal state.
 * Returns the full message data.
 *
 * The list is every state the pipeline STOPS in, which is not the same as
 * every state a spec is happy with — that judgement belongs to the caller,
 * which has the document in hand. Two were missing, and both cost 45s and a
 * "stuck at state=…" message that named a real state as though it were a
 * hang:
 *
 *   `awaiting_sender_decision` — the analysis is offering the sender a
 *     correction or suggestion and nothing moves without a human. Whether a
 *     message lands here is the MODEL'S judgement about whether the sentence
 *     could be phrased better, so any spec sending free text could hit it;
 *     seen on "Je suis allé à la boulangerie ce matin.", which is correct.
 *   `cancelled` — sticky-terminal, set by finalizeKeepOriginal / finalizeEdit
 *     when the sender answers that dock.
 *
 * A caller that needs a SPECIFIC terminal must assert it (and, if it wants to
 * move the message on from review, poll for the state to change — this helper
 * returns immediately once the state is terminal, so re-calling it after a
 * click returns the pre-click state).
 */
/**
 * `waitForPipelineComplete`, then also wait for the trace flush. MSG-PIPE-28.1:
 * trace summaries land in ONE write AFTER finalize, so `state: done` is
 * visible before `pipeline.traces` is. Use this whenever a test reads traces.
 */
export async function waitForPipelineTraced(
  chatId: string,
  messageId: string,
  timeoutMs = 45_000,
  traceTimeoutMs = 20_000,
): Promise<any> {
  let doc = await waitForPipelineComplete(chatId, messageId, timeoutMs);
  const db = getAdminFirestore();
  const deadline = Date.now() + traceTimeoutMs;
  while (!(doc?.pipeline?.traces?.length) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    const snap = await db.doc(`chats/${chatId}/messages/${messageId}`).get();
    doc = { id: snap.id, ...snap.data() };
  }
  return doc;
}

export async function waitForPipelineComplete(
  chatId: string,
  messageId: string,
  timeoutMs = 45_000,
): Promise<any> {
  const db = getAdminFirestore();
  const docPath = `chats/${chatId}/messages/${messageId}`;
  const deadline = Date.now() + timeoutMs;
  const terminalStates = [
    'done',
    'partial_failed',
    'failed',
    'awaiting_sender_decision',
    'cancelled',
  ];
  while (Date.now() < deadline) {
    const snap = await db.doc(docPath).get();
    const data = snap.data();
    const state = data?.pipeline?.state;
    if (terminalStates.includes(state)) return { id: snap.id, ...data };
    await new Promise((r) => setTimeout(r, 1_000));
  }
  // Return whatever we have for debugging
  const snap = await db.doc(docPath).get();
  throw new Error(
    `Timeout: pipeline for ${docPath} stuck at state="${snap.data()?.pipeline?.state}" after ${timeoutMs}ms`,
  );
}

// ─── Cleanup helpers ─────────────────────────────────────────────────────────

/**
 * Delete all messages in a chat. Chunked under the 500-op batch cap — a
 * REUSED chat (ensureDirectChat returns an existing chat) can accumulate far
 * more than 500 docs across interrupted runs whose `afterAll` cleanup never
 * ran, so a single batch would throw. Exported so seeders can guarantee a
 * clean slate before injecting fresh history.
 */
export async function deleteAllMessages(chatId: string): Promise<void> {
  const db = getAdminFirestore();
  for (;;) {
    const snap = await db.collection(`chats/${chatId}/messages`).limit(450).get();
    if (snap.empty) return;
    const batch = db.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
    if (snap.size < 450) return;
  }
}

/**
 * Set or clear the isAdmin flag on a user's Firestore profile.
 */
export async function setUserAdmin(uid: string, isAdmin: boolean): Promise<void> {
  const db = getAdminFirestore();
  await db.doc(`users/${uid}`).update({
    isAdmin,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Update specific fields on a user's Firestore profile (e.g. language change mid-test).
 */
export async function updateUserProfile(
  uid: string,
  changes: Partial<{
    nativeLanguage: string;
    learningLanguage: string;
    difficulty: number;
  }>,
): Promise<void> {
  const db = getAdminFirestore();
  await db.doc(`users/${uid}`).update({
    ...changes,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await mirrorProfileDoc(uid);
}

type WaterfallStageSpec = string | string[];

/**
 * Validate that pipeline traces contain the expected stages in order.
 * A string entry checks for a single sequential stage.
 * A string[] entry checks that all stages in the group exist and started
 * within parallelThresholdMs of each other (i.e. ran in parallel).
 */
export function assertWaterfallStages(
  traces: Array<{ stage: string; startMs: number; durationMs: number }>,
  expectedStages: WaterfallStageSpec[],
  parallelThresholdMs = 500,
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  let traceIndex = 0;

  // Sort by startMs so assertion order matches chronological execution order,
  // not Firestore arrayUnion insertion order (which can differ for async traces).
  traces = [...traces].sort((a, b) => a.startMs - b.startMs);

  for (const spec of expectedStages) {
    if (typeof spec === 'string') {
      const found = traces.findIndex((t, i) => i >= traceIndex && t.stage === spec);
      if (found === -1) {
        errors.push(`Stage "${spec}" not found in traces (checked from index ${traceIndex})`);
      } else {
        traceIndex = found + 1;
      }
    } else {
      // Parallel group: all must exist and start times must be close
      const stageTraces = spec.map((s) => traces.find((t) => t.stage === s));
      for (let i = 0; i < spec.length; i++) {
        if (!stageTraces[i]) {
          errors.push(`Parallel stage "${spec[i]}" not found in traces`);
        }
      }
      const found = stageTraces.filter(Boolean) as Array<{ stage: string; startMs: number; durationMs: number }>;
      if (found.length >= 2) {
        const minStart = Math.min(...found.map((t) => t.startMs));
        const maxStart = Math.max(...found.map((t) => t.startMs));
        if (maxStart - minStart > parallelThresholdMs) {
          errors.push(
            `Stages [${spec.join(', ')}] expected parallel but startMs spread is ${maxStart - minStart}ms > ${parallelThresholdMs}ms threshold`,
          );
        }
      }
      // Advance past all found stages
      const indices = found.map((t) => traces.indexOf(t)).filter((i) => i >= 0);
      if (indices.length) traceIndex = Math.max(...indices) + 1;
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Clean up all test data for one OR more test users:
 * - Delete their direct chat + messages (only when exactly two uids
 *   are passed — single-user tests have no chat to clean).
 * - Delete contact docs
 * - Delete user profiles
 * - Delete auth users
 *
 * The variadic shape lets single-user specs (e.g. topic-translation)
 * call `cleanupTestUsers(uid)` without supplying a phantom second
 * argument. The previous fixed-arity signature meant a single-uid
 * caller saw `deleteUser(undefined)` and a noisy
 * "uid must be a non-empty string" Admin SDK throw in afterAll.
 */
export async function cleanupTestUsers(...uids: string[]): Promise<void> {
  const db = getAdminFirestore();
  const validUids = uids.filter((u): u is string => typeof u === 'string' && u.length > 0);

  // Direct-chat cleanup only applies when there's a 2-user pair —
  // findDirectChat looks up by directKey which is built from sorted
  // uids. A 1-user test never wrote a direct chat doc.
  if (validUids.length === 2) {
    const [uidA, uidB] = validUids;
    const chatId = await findDirectChat(uidA, uidB);
    if (chatId) {
      await deleteAllMessages(chatId);
      // Delete pipelineTraceDetails subcollection
      const traces = await db.collection(`chats/${chatId}/messages`).get();
      for (const _msgDoc of traces.docs) {
        const tracesSnap = await db.collection(`pipelineTraceDetails`).where('chatId', '==', chatId).get();
        const batch = db.batch();
        tracesSnap.docs.forEach((d) => batch.delete(d.ref));
        if (!tracesSnap.empty) await batch.commit();
      }
      await db.doc(`chats/${chatId}`).delete();
    }
  }

  // Per-user cleanup runs for every uid regardless of pair-ness.
  for (const uid of validUids) {
    const contactsSnap = await db.collection(`users/${uid}/contacts`).get();
    if (!contactsSnap.empty) {
      const batch = db.batch();
      contactsSnap.docs.forEach((doc) => batch.delete(doc.ref));
      await batch.commit();
    }
    await db.doc(`users/${uid}`).delete().catch(() => {});
    // PROF-2 — the mirror's cascade, done here so a run that aborted before the
    // trigger fired leaves no orphan profile behind.
    await db.doc(`profiles/${uid}`).delete().catch(() => {});
    await deleteTestUser(uid);
  }
}
