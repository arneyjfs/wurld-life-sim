/**
 * Single source of truth for every Firestore document shape the app reads or
 * writes. Zod schemas double as runtime validators (used by typed snapshot
 * hooks in src/hooks/firestore) and as type sources via z.infer.
 *
 * Documented to match the source app's prod schema; field defaults / coercion
 * absorb noise from older docs and partial writes.
 */

import { z } from 'zod';
// LIFE-ONBOARD-12: extracted when this file hit its 600-line cap. Imported so
// the schemas below can still reference it, and re-exported so every existing
// `from '@/types/firestore'` import site is unchanged.
import { ZWorldSeedKey, type WorldSeedKey } from './worldSeedKeys';

export { ZWorldSeedKey, type WorldSeedKey };
// The life-sim world cluster (ZLifeWorld and everything that hangs off it) was
// lifted into ./lifeFirestore for the same 600-line cap. Re-exported wholesale
// so every existing `from '@/types/firestore'` import site is unchanged.
export * from './lifeFirestore';
// The leaf scalars both this file and ./lifeFirestore build on live in
// ./firestorePrimitives — a shared leaf so the re-export above does not close a
// module cycle through schemas that evaluate at import time. See that file's
// header. Re-exported here too, so no import site changed.
import {
  ZDifficulty,
  ZStoredViewSettings,
  ZTimestamp,
} from './firestorePrimitives';
export {
  ZDifficulty,
  type Difficulty,
  ZStoredViewSettings,
  ZTimestamp,
} from './firestorePrimitives';
import { ZTutorAction } from './tutorAction';
export { ZTutorAction, type TutorAction } from './tutorAction';

// ---------- users ----------

/** TTS speech speed (TTS-SPEED-1): a CLARITY scale, independent of difficulty.
 *  4 = natural native pace (default, the top); 1-3 are progressively clearer. */
export const ZSpeechSpeed = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]);

/** Pronouns. Source: state/AppState.tsx:195. */
export const ZPronouns = z.enum(['he', 'she', 'other', '']);
export type Pronouns = z.infer<typeof ZPronouns>;

/** Preferred TTS voice gender. Drives the spoken voice everywhere AND
 *  the tutor's gender (persona + translation gender agreement). See
 *  docs/specs/tts.md TTS-PREF-1/4. */
export const ZVoicePreference = z.enum(['male', 'female']);
export type VoicePreference = z.infer<typeof ZVoicePreference>;

export const ZUser = z.object({
  // The doc id IS the uid (`users/{uid}`); parseDoc injects it as `id`, and user
  // docs are written only via writeUserSetting (which never stores a redundant
  // `uid` field), so uid is derived SOLELY from the doc id in the `.transform`
  // below. A uid-less doc MUST still parse, else the onboarding gate wedges on
  // accept-legal (AUTH-PROFILE-9).
  id: z.string().optional(),
  phoneNumber: z.string().optional(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  thumbUrl: z.string().optional(),
  /** Inline base64 LQIP for the profile photo (`data:image/jpeg;base64,…`).
   *  Stamped by `uploadImage()` (lib/imageUpload.ts) so the avatar can paint
   *  instantly before `thumbUrl` / `photoURL` resolve. Legacy users without
   *  this field render the normal fallback gradient + initial — no crash. */
  tinyImage: z.string().optional(),
  /** SAFETY-BLOCK-1 — the uids this user has blocked. Owner-only (PROF-3);
   *  written by `setBlock`. */
  blockedUids: z.array(z.string()).optional(),
  nativeLanguage: z.string().optional(),
  learningLanguage: z.string().optional(),
  /** LANG-TX-4 — the ACCOUNT-wide translation switch, and the default the
   *  per-chat entry at `chats/{id}.translationEnabled[uid]` cascades from.
   *
   *  ⚠ ABSENT MEANS ON. Every account in the database is in that state, which
   *  is what makes the field need no migration — and what makes reading it as
   *  `?? false` anywhere a way to turn the whole product off on deploy.
   *
   *  `.catch(undefined)` for the same reason `viewSettings` carries it: a
   *  drifted value must degrade to "unset" rather than fail the whole doc
   *  parse and take the user's profile with it. */
  translationEnabled: z.boolean().optional().catch(undefined),
  /** MSG-VIEW-7 — the two-row view model; the global default. Per-chat
   *  override at `chats/{chatId}.viewSettings[uid]` takes precedence when
   *  present. Written by the "Update defaults" action on the chat header
   *  menu. `.catch(undefined)` so a drifted stored value degrades to "unset"
   *  (the app falls back to its default) instead of failing the WHOLE doc
   *  parse — `parseDoc` returns null on any failure, which would otherwise
   *  silently drop the entire user profile (the "[parseDoc] schema drift"
   *  console warning + the user vanishing from the admin recipient list). */
  viewSettings: ZStoredViewSettings.optional().catch(undefined),
  /** 1 = Total Beginner … 7 = Advanced. Drives complex-word highlighting + explanation depth. */
  difficulty: ZDifficulty.optional(),
  /** TTS playback speed (TTS-SPEED-1), independent of difficulty; 3 when unset. */
  speechSpeed: ZSpeechSpeed.optional(),
  /** XP-LANG-1 — the level of each practice language, keyed by
   *  `practiceStatsKey(language)`. Read ONLY through `levelFor`
   *  (src/lib/level.ts), which falls back to `difficulty` and drops a drifted
   *  entry; loose here so one bad entry never fails the profile parse. */
  levels: z.record(z.string(), z.unknown()).optional().catch(undefined),
  /** TTS-SPEED-1.2 — speech speed per practice language, same key; read
   *  through `speechSpeedFor`, which falls back to `speechSpeed`. */
  speechSpeeds: z.record(z.string(), z.unknown()).optional().catch(undefined),
  /** QUIZ-FREQ-1 — chat quiz frequency: 0 = off, else one in N eligible
   *  sends. Unset reads as 5. Read through `readQuizFrequency`, which also
   *  absorbs a drifted value, hence the loose type here. */
  chatQuizEvery: z.number().optional().catch(undefined),
  /** Personal pronouns. Empty string = "prefer not to say" — same as 'other' but distinguished in source. */
  pronouns: ZPronouns.optional(),
  /** Preferred TTS voice gender (TTS-PREF-1). Also sets the tutor's
   *  gender (TTS-PREF-4). Defaults to 'female' when unset. */
  voicePreference: ZVoicePreference.optional(),
  /** 'native' | 'practice'. Source: state/AppState.tsx:191. */
  notificationLanguage: z.enum(['native', 'practice']).optional(),
  /** Plan tier — what this user PAYS for. ⚠ Not what the gates read: since
   *  LANG-TRIAL-1 they ask `hasProEntitlement` (src/lib/entitlement.ts), which
   *  folds in the trial below. */
  plan: z.enum(['free', 'pro']).optional(),
  /** LANG-TRIAL-2 — when this user's free trial ends. Written once, server-only,
   *  never cleared; entitlement is computed against the clock. */
  trialEndsAt: ZTimestamp.optional(),
  /** BILL-ENT-2 — the clock bound on `plan`, written by the billing projection
   *  (server-only, BILL-ENT-6). ABSENT or `null` = unbounded (grandfathered /
   *  lifetime). ⚠ No `.catch()`: a drifted value must NOT silently become
   *  "absent", because absent means lifetime Plus. */
  planUntil: ZTimestamp.nullable().optional(),
  /** BILL-ENT-1 — sorted distinct sources of the live grants
   *  ('apple' | 'google' | 'stripe' | 'manual' | 'promo'). Routing only
   *  (BILL-MANAGE-3); never an entitlement input. */
  planSources: z.array(z.string()).optional().catch(undefined),
  /** BILL-ENT-4 — when the grants were last projected onto this doc. Absent =
   *  never projected (a grandfathered account the projector leaves alone). */
  planProjectedAt: ZTimestamp.optional().catch(undefined),
  fcmTokens: z.array(z.string()).optional(),
  /** NOTIF-7.1 — the subset of `fcmTokens` a native client declared; the
   *  only tokens NOTIF-4.1's silent clear may target. */
  nativeFcmTokens: z.array(z.string()).optional(),
  /** NOTIF-14.3 — the subset an Android build declared; the server sends
   *  these the data-only push the native service draws (sender photo). */
  androidFcmTokens: z.array(z.string()).optional(),
  /** Server-set admin flag. Gates the Admin Dashboard surface in
   *  FooterLinks + the `/admin` route. The Cloud Functions are the real
   *  authority (every admin endpoint re-verifies via `requireAdmin`);
   *  this field is only used to hide the UI surface from non-admins so
   *  they don't see a button that errors when tapped. */
  isAdmin: z.boolean().optional(),
  // Legal acceptance (AUTH-LEGAL-2): versions compared against live `config/legal`.
  acceptedTermsVersion: z.number().optional(),
  acceptedPrivacyVersion: z.number().optional(),
  acceptedLegalAt: ZTimestamp.optional(),
  // AUTH-LEGAL-10 — when the user confirmed they are 18 or over (ticked the
  // Terms row). A record only: never gates anything.
  ageConfirmedAt: ZTimestamp.optional(),
  createdAt: ZTimestamp.optional(),
  updatedAt: ZTimestamp.optional(),
  // Last-seen capture (USERS-DASH-1) — written debounced on app boot by
  // userPresence.recordLastSeen. lastSeenAt is client epoch ms (not a server
  // Timestamp); lastPlatform is the runtime.getRuntime() value.
  lastSeenAt: z.number().optional(),
  lastPlatform: z.string().optional(),
  lastAppVersion: z.string().optional(),
  // GLOBAL engagement streak (LIFE-STREAK-1): `count` = consecutive local-TZ
  // days with a completed practice session OR wurld chapter; `lastDay` = local
  // YYYY-MM-DD of the most recent completion. Written by `recordStreakCompletion`
  // (src/lib/streak.ts). Append-only, optional — absent ⇒ no streak yet.
  streak: z.object({ count: z.number(), lastDay: z.string() }).optional(),
}).transform(({ id, ...u }) => ({ ...u, uid: id ?? '' }));
export type User = z.infer<typeof ZUser>;

// ---------- profiles (public mirror of a user's display fields) ----------

/**
 * PROF-1 — `profiles/{uid}` carries the six display fields, `plusUntil`
 * (PROF-7) and nothing else. No phone number, no tokens, no raw plan / trial
 * fields, no admin flag. PROF-2 —
 * written only by the server mirror (`onUserProfileMirror`); clients never
 * write it. PROF-3 — this is the ONLY doc a signed-in user may read about
 * another user; `users/{uid}` is owner-only.
 *
 * Every cross-user display read (`useUserProfiles`, `useOtherUserProfile`,
 * `lookupUserByUid`) parses with this schema, so a field that is not here is
 * not readable about somebody else by construction.
 */
export const ZProfile = z.object({
  id: z.string().optional(),
  displayName: z.string().optional(),
  photoURL: z.string().optional(),
  thumbUrl: z.string().optional(),
  tinyImage: z.string().optional(),
  nativeLanguage: z.string().optional(),
  learningLanguage: z.string().optional(),
  /** PROF-7 — absent: not on Plus; `null`: on Plus with no end; else epoch ms
   *  the entitlement ends. Read it through `profileEntitlement`. */
  plusUntil: z.number().nullable().optional(),
  updatedAt: ZTimestamp.optional(),
});
export type Profile = z.infer<typeof ZProfile>;

// ---------- messages ----------

export const ZTranslationData = z.object({
  text: z.string(),
  complexWords: z.array(z.string()).optional(),
  wordTranslations: z.record(z.string(), z.string()).optional(),
  annotatedPractice: z.string().optional(),
});
export type TranslationData = z.infer<typeof ZTranslationData>;

export const ZCorrectionItem = z.object({
  original: z.string(),
  suggestion: z.string(),
  reasoning: z.string(),
});
export type CorrectionItem = z.infer<typeof ZCorrectionItem>;

export const ZNaturalAlternative = z.object({
  practiceText: z.string(),
  practiceTranslation: ZTranslationData,
  nativeTranslation: ZTranslationData,
  reasoning: z.string(),
});
export type NaturalAlternative = z.infer<typeof ZNaturalAlternative>;

export const ZPendingReview = z.object({
  isUnreadable: z.boolean().optional(),
  unclearDescription: z.string().optional(),
  suggestions: z
    .array(
      z.object({
        text: z.string(),
        translation: z.string(),
        // Vocab annotations parsed from the original LLM-emitted
        // <practice>...<vocab>...</vocab>...</practice> block.
        // Optional + nullable because pre-fix suggestions saved
        // without them are still valid docs in Firestore. When the
        // user picks a suggestion these seed `translations[practice]`
        // with the same annotated payload shape the bubble already
        // knows how to render — underlines + tap-to-define carry
        // over to the sent message.
        complexWords: z.array(z.string()).optional(),
        wordTranslations: z.record(z.string(), z.string()).optional(),
      }),
    )
    .optional(),
  suggestionsPending: z.boolean().optional(),
  suggestionsAttempted: z.boolean().optional(),
  suggestionsFailed: z.boolean().optional(),
  corrections: z.array(ZCorrectionItem),
  correctedText: z.string().optional(),
  correctedPracticeTranslation: ZTranslationData.optional(),
  correctedNativeTranslation: ZTranslationData.optional(),
  naturalAlternative: ZNaturalAlternative.nullable().optional(),
  /**
   * MSG-REVIEW-CLARIFY-4 — the answer to "did you mean something else?".
   * The sender described what they actually meant and the model rebuilt the
   * sentence from that description, so there is no fixes list to render
   * alongside it (there were no discrete fixes — see MSG-REVIEW-CLARIFY-4).
   * REPLACED on each round, never accumulated (MSG-REVIEW-CLARIFY-6).
   */
  clarified: z
    .object({
      /** What the user typed, e.g. "I meant tall not fat". Kept so a second
       *  round can show it and so the trace explains the rewrite. */
      note: z.string(),
      /** The rebuilt practice-language sentence. */
      text: z.string(),
      practiceTranslation: ZTranslationData,
      nativeTranslation: ZTranslationData,
    })
    .nullable()
    .optional(),
  /**
   * MSG-REVIEW-CLARIFY-9 — the completed clarify rounds, OLDEST FIRST, capped
   * server-side at the last 5 (`CLARIFY_HISTORY_TURNS`). `clarified` is the
   * one variant on offer and is REPLACED each round; this is the record that
   * makes the NEXT round iterative, and it is the only field that accumulates.
   * Server-written and server-read (the client posts only its note). Optional
   * + additive: a review already in flight when this shipped parses unchanged.
   *
   * (Written on ONE line deliberately: this file is at its 600-code-line cap,
   * and the cap counts code, not comments. The next field added here has to
   * decompose something first — `lifeFirestore.ts` is the precedent.)
   */
  clarifyHistory: z.array(z.object({ note: z.string(), text: z.string() })).optional(),
  /** MSG-REVIEW-CLARIFY-7 — a clarify call is in flight; the dock shimmers
   *  its section and disables the affordance. */
  clarifyPending: z.boolean().optional(),
  /** MSG-REVIEW-CLARIFY-7 — the last clarify call failed or came back
   *  unusable. Every pre-existing option stays; the section offers a retry. */
  clarifyFailed: z.boolean().optional(),
});
export type PendingReview = z.infer<typeof ZPendingReview>;

export const ZSendStatus = z.enum([
  'sending',
  'translating',
  'pending_review',
  'sent',
  'failed',
  'cancelled',
]);
export type SendStatus = z.infer<typeof ZSendStatus>;

export const ZPipelineState = z.enum([
  'awaiting_analysis',
  'queued',
  'analyzing',
  'awaiting_sender_decision',
  'sender_resolved',
  'translating',
  'annotating',
  'done',
  'partial_failed',
  'analysis_failed',
  'failed',
  'cancelled',
]);
export type PipelineState = z.infer<typeof ZPipelineState>;

/**
 * Outcome the user picked at the review dock. Persisted on the message
 * doc so the admin waterfall can attribute each pending-review to a
 * specific user choice without conflating "thinking time" with system
 * processing time. See plan §"Waterfall stats".
 *
 *   corrected                  — user accepted the pipeline's correction
 *   suggested                  — user accepted the natural alternative
 *   kept_original              — user sent the original text as-is
 *                                (a new doc is created via skipSenderReview;
 *                                this one is marked `cancelled` +
 *                                `replacedBy: <newDocId>`)
 *   edited                     — user cancelled to type a tweak; a new doc
 *                                is the eventual send
 *   dismissed_unclear          — user dismissed an unreadable review
 *                                without picking a suggestion
 *   picked_unclear_suggestion  — user picked one of the unreadable
 *                                guesses; the doc adopts that text
 */
export const ZAnalysisResolution = z.object({
  outcome: z.enum([
    'corrected',
    'suggested',
    'kept_original',
    'edited',
    'dismissed_unclear',
    'picked_unclear_suggestion',
    // MSG-REVIEW-CLARIFY-5 — the sender described what they meant and sent
    // the model's rebuild of it.
    'clarified',
  ]),
  resolvedAt: ZTimestamp.optional(),
});
export type AnalysisResolution = z.infer<typeof ZAnalysisResolution>;

export const ZReplyTo = z.object({
  id: z.string(),
  senderName: z.string(),
  senderUid: z.string().optional(),
  /** The original-language text (the practice line in the bubble preview). */
  text: z.string().optional(),
  /** Optional translation (native gloss) for the bubble's third preview line. */
  translation: z.string().optional(),
  /** Carried over from the replied-to message when it had an image, so
   *  the reply preview can render a tiny thumb. */
  imageUrl: z.string().optional(),
  thumbUrl: z.string().optional(),
  /** Inline base64 LQIP carried from the replied-to message so the reply
   *  preview can render its tiny thumb without any network. */
  tinyImage: z.string().optional(),
  /** VID-RENDER-2 / VID-RENDER-3 — the replied-to message is a video. The
   *  image refs above are then its POSTER (VID-SCHEMA-1); the stream URL is
   *  never snapshotted. Absent ⇒ photo / text (older payloads). */
  isVideo: z.boolean().optional(),
  /** Duration of the replied-to video, for the ▶ badge. */
  durationMs: z.number().optional(),
});
export type ReplyTo = z.infer<typeof ZReplyTo>;

/**
 * Single image attachment within a multi-image message. The full message
 * carries an array of these in `images`; legacy single-image messages
 * have undefined `images` and use the flat top-level `imageUrl` /
 * `imageWidth` / etc. fields instead. Always read images via
 * `getMessageImages(msg)` so render code doesn't have to branch on the
 * legacy shape.
 */
export const ZImageAttachment = z.object({
  /** Full-res image URL (≤1600px long edge). */
  url: z.string(),
  /** Optional ≤200px thumbnail used by the grid / carousel. */
  thumbUrl: z.string().optional(),
  /** Inline base64 LQIP (`data:image/jpeg;base64,…`). */
  tinyImage: z.string().optional(),
  /** Pixel width of the source image, when known. Drives the bubble's
   *  per-cell aspect ratio so the grid doesn't flash 1:1 → real-ar. */
  width: z.number().optional(),
  /** Pixel height of the source image, when known. */
  height: z.number().optional(),
  /** VID-SCHEMA-1 — `'video'` on video items (the writer always stamps it);
   *  absent ⇒ image. For a video item the fields above are its POSTER. */
  kind: z.enum(['image', 'video']).optional(),
  /** VID-SCHEMA-1 — the MP4 stream URL (video items only). */
  videoUrl: z.string().optional(),
  /** VID-SCHEMA-1 — sent (post-trim) duration in ms (video items only). */
  durationMs: z.number().optional(),
  /** VID-SCHEMA-1 — stream size in bytes (video items only). */
  sizeBytes: z.number().optional(),
});
export type ImageAttachment = z.infer<typeof ZImageAttachment>;

/** A video item as the writer produces it (VID-SCHEMA-1). */
export type VideoAttachment = ImageAttachment & { kind: 'video'; videoUrl: string };

/** True for a playable video item. Readers stay tolerant: no `kind` ⇒ image. */
export function isVideoAttachment(a: ImageAttachment): a is VideoAttachment {
  return a.kind === 'video' && typeof a.videoUrl === 'string';
}

export const ZMessage = z.object({
  id: z.string(),
  senderName: z.string(),
  senderId: z.string().optional(),
  originalText: z.string(),
  originalLanguage: z.string(),
  translations: z.record(z.string(), ZTranslationData).default({}),
  translationErrors: z.record(z.string(), z.boolean()).optional(),
  createdAt: ZTimestamp.nullable().optional(),
  deletedForEveryone: z.boolean().optional(),
  editedAt: ZTimestamp.optional(),
  isPractice: z.boolean().optional(),
  /** XP-DATA-8 — XP this message earned its SENDER (writing XP, XP-EARN-3/4,
   *  or quiz XP, XP-EARN-1/2). Server-written; only the sender's own bubble
   *  reads it (XP-UI-1). */
  senderXp: z.number().optional().catch(undefined),
  sendStatus: ZSendStatus.optional(),
  /** SAFETY-BLOCK-6 — CLIENT-ONLY, on an outbox placeholder whose send was
   *  refused across a block (409). Never stored. */
  notDelivered: z.boolean().optional(),
  pendingReview: ZPendingReview.optional(),
  /** Denormalised "carries one or more images" gate, used by `useChatMedia`
   *  to filter the Media gallery query server-side
   *  (`where('hasImage','==',true)`). Written together with `images[]`. */
  hasImage: z.boolean().optional(),
  /**
   * Image / video attachments — the ONE place media lives on a message
   * (the flat `imageUrl` / `thumbUrl` / `tinyImage` / `imageWidth` /
   * `imageHeight` mirror was migrated into `images[0]` on 2026-09-29).
   * Read via `getMessageImages(msg)`. Max 10 (composer + outbox enforce).
   */
  images: z.array(ZImageAttachment).optional(),
  replyTo: ZReplyTo.optional(),
  reactions: z.record(z.string(), z.array(z.string())).optional(),
  /**
   * Pipeline state map — the authoritative record of where the
   * server-side processing is. The same map carries other fields
   * (version, updatedAt, history, stageOutputs, metrics, etc) but
   * the client only needs `state` for failsafe / merge gating;
   * the admin trace shape reads the rest via its own type.
   */
  // `blockedForRecipients`: set on sender-review messages so recipients
  // don't see them yet (the sender is still deciding); the client filters
  // them out of the recipient's list (avoids a misleading "translating"
  // shimmer while no work is in flight for them).
  pipeline: z.object({ state: ZPipelineState.optional(), blockedForRecipients: z.boolean().optional(), untranslatable: z.boolean().optional() }).passthrough().optional(),
  /** TUTOR-INV-27.1 — the send handler will start the tutor's reply to this message itself. */
  tutorReply: z.literal('server').optional(),
  /** The sender-side analysis, nested as the server writes it
   *  (`analysis.detectedLanguage` etc.). MSG-REVIEW-RESOLVE-4 reads the
   *  detected language to re-send "Send original" in the message's own
   *  language. (Was two flat fields nothing ever wrote.) */
  analysis: z
    .object({
      // MSG-REVIEW-RESOLVE-4.2 — `.catch(undefined)` on each: a drifted
      // diagnostic field must never fail the whole message (WURLD-PROD-1K).
      status: z.string().optional().catch(undefined),
      detectedLanguage: z.string().optional().catch(undefined),
      detectedBucket: z.enum(['native', 'practice', 'unreadable']).optional().catch(undefined),
    })
    .passthrough()
    .optional(),
  /** User's resolution of the pending review (corrected / suggested /
   *  kept_original / edited / dismissed_unclear / picked_unclear_suggestion).
   *  Co-exists with `pendingReview` — the dock gates on
   *  `pendingReview && !analysisResolution` so resolved docs stop showing
   *  the dock while keeping the analysis trail for admin queries. */
  analysisResolution: ZAnalysisResolution.optional(),
  /** Set on the cancelled doc (kept_original / edited path) to point at
   *  the follow-up message that actually sends. Admin waterfall joins
   *  on this to attribute the analysis stage to the user's chosen send. */
  replacedBy: z.string().optional(),
  /** Inverse pointer: set on the follow-up doc to identify the
   *  pending-review parent. Used by admin queries that drill from a
   *  send-original / edit-send back to the originating analysis. */
  replacedFrom: z.string().optional(),
  complexWords: z.array(z.string()).optional(),
  /** TUTOR-ACTION-5: structured tutor action → renders a centered card. */
  action: ZTutorAction.optional(),
  /** LANG-LEARNWITH-23 — a server-written system row. Rendered from the
   *  viewer's own i18n strings, never from `originalText`. An unknown kind
   *  parses to undefined and the doc falls back to its plain bubble. */
  system: z
    .object({
      kind: z.literal('languageRequest'),
      uid: z.string(),
      language: z.string(),
      // LANG-LEARNWITH-28 — absent means the member's own language.
      role: z.enum(['native', 'practice']).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
  clientId: z.string().optional(),
  // Client-only, never persisted to Firestore — the image-outbox merge
  // layer stamps this on optimistic placeholders so the bubble can
  // render an actual upload-percentage ring instead of a spinning
  // indeterminate one. Server-confirmed docs omit it entirely and the
  // ChatImage overlay falls back to its indeterminate spinner / hidden
  // states based on `images[0].url.startsWith('blob:')`.
  uploadProgress: z.number().optional(),
});
export type Message = z.infer<typeof ZMessage>;

// ---------- tutorMemory ----------

/**
 * Per-chat tutor memory document at `chats/{chatId}/tutorMemory/main`.
 *
 * Spec: docs/specs/wurld-tutor.md — TUTOR-MEM-1.
 *
 * One tutor chat per user → this doc IS that user's lifetime tutor
 * memory. The server initialises it on first read (all fields default
 * to the schema's empty values). Subsequent writes come from the
 * compaction Cloud Function (TUTOR-COMPACT-*, Phase 5).
 *
 * The schema is read both server-side (Cloud Functions, via the Zod
 * import in `functions/src/index.ts`) and client-side (if/when the
 * UI ever surfaces "what does the tutor remember?" — not in scope
 * yet, but the schema is shared so any future client-side reader gets
 * the same shape contract).
 */
export const ZTutorMemory = z.object({
  /** Short factual / preference strings extracted from prior turns.
   *  Append-only; latest beats earlier on contradiction (TUTOR-MEM-4). */
  memories: z.array(z.string()).default([]),
  /** Single-paragraph summary of the conversation arc up to
   *  `lastCompactedMessageId`. Replaced on every compaction. */
  summary: z.string().default(''),
  /** The newest message id (inclusive) that has been folded into the
   *  summary + memories. Messages newer than this stay in the
   *  uncompressed recent window. `null` before the first compaction. */
  lastCompactedMessageId: z.string().nullable().default(null),
  /** Monotonically-increasing compaction count. Used as the Gemini
   *  cache-key disambiguator (TUTOR-INV-8) so a fresh compaction
   *  invalidates the prior implicit-cache prefix exactly once. */
  compactCount: z.number().int().nonnegative().default(0),
  /** Mutex flag. Set by `tutorRespond` when it enqueues a compaction
   *  job; cleared by the compaction Cloud Function on completion
   *  (success or terminal failure). Prevents duplicate queued jobs. */
  pendingCompact: z.boolean().default(false),
  /** Server timestamps for traceability — not load-bearing. */
  updatedAt: ZTimestamp.optional(),
});
export type TutorMemory = z.infer<typeof ZTutorMemory>;

// ---------- chats ----------

export const ZChat = z.object({
  id: z.string(),
  isGroup: z.boolean(),
  members: z.array(z.string()),
  memberNames: z.record(z.string(), z.string()).optional(),
  memberPhones: z.record(z.string(), z.string()).optional(),
  /** Per-member avatar cache so 1:1 chat-list rows can paint the LQIP +
   *  thumbnail without a separate `users/{uid}` fetch on cold load.
   *  Mirrors how `memberNames` denormalises display names onto the chat
   *  doc; same write trigger points (chat-create + avatar-upload
   *  fan-out). Older 1:1 chats that predate the field gracefully fall
   *  back to the user-profile lookup. */
  memberAvatars: z
    .record(
      z.string(),
      z.object({
        thumbUrl: z.string().optional(),
        tinyImage: z.string().optional(),
      }),
    )
    .optional(),
  lastMessage: z.string().optional(),
  lastMessageAt: ZTimestamp.nullable().optional(),
  /** CHATLANG-LIST-3 — bumped when a delete / cancel rewrites `lastMessage`
   *  without moving `lastMessageAt`; part of the chat-list preview cache key. */
  lastMessageRev: z.number().optional(),
  /** SAFETY-BLOCK-8.1 — who sent `lastMessage`; server-written. */
  lastMessageSenderId: z.string().optional(),
  unreadCounts: z.record(z.string(), z.number()).optional(),
  directKey: z.string().nullable().optional(),
  /** Per-chat PRACTICE override, `{ [uid]: language }`. Sparse: an absent key
   *  means "no override", and the member's global `learningLanguage` applies. */
  practiceLanguages: z.record(z.string(), z.string()).optional(),
  /** Per-chat READING override, `{ [uid]: language }` — LANG-RESOLVE-6. The
   *  exact mirror of `practiceLanguages`: same shape, same ownership (a member
   *  may write only their own key), same cleanup on leave and on account
   *  deletion, same absent-means-no-override reading.
   *
   *  ⚠ Sparse ON PURPOSE. Defaulting the key at chat-create time would freeze
   *  each chat at whatever the profile said that day, and a later global
   *  language change would stop propagating into it — the LANG-PROP-1 bug,
   *  reintroduced one chat at a time. */
  readingLanguages: z.record(z.string(), z.string()).optional(),
  /**
   * LANG-FREE-12 — the ONE language of a room with no entitled member.
   *
   * ⚠ **Not a fourth member of the family above, and the difference is the
   * whole point.** The three maps are per-UID because `LANG-TIER-4` says
   * nobody sets anybody else's. This is a single value for the ROOM, written
   * by the admin, and it is the one deliberate exception to that rule.
   *
   * The reason the exception exists: with nobody entitled there is no
   * translation, so the members' languages stop being independent — they
   * become one shared decision about what everybody types. A room where each
   * member sets their own and nothing translates is a room whose members
   * cannot read each other.
   *
   * ⚠ **Consulted ONLY while the room is unfunded** (`LANG-FREE-15`). The
   * moment any member is entitled the room has a language SET and every member
   * picks their own pair from it again; this field stops being read and is NOT
   * deleted, so it is still here if the funding lapses. Nothing overwrites a
   * member's own saved pair (`LANG-RESOLVE-6`), which is what lets that
   * round-trip be lossless.
   *
   * ⚠ `firestore.rules` enforces ADMIN-ONLY on the write but CANNOT enforce
   * the unfunded half — that would need every member's user doc, which is N
   * reads on the hot update path. The tier condition is the client's.
   */
  commonLanguage: z.string().optional(),
  /** LANG-TX-2 — the per-chat TRANSLATION SWITCH, `{ [uid]: boolean }`.
   *
   *  The third member of the same family as the two maps above, and sparse in
   *  the same way for the same reason: an ABSENT key means "follow the
   *  account-wide default" (`users/{uid}.translationEnabled`, itself defaulting
   *  to ON), never "off". There is no migration, so every chat in the database
   *  is in exactly the absent state.
   *
   *  ⚠ Per-UID rather than one flag for the room. It decides whether a
   *  member's languages are rendered at all, and LANG-TIER-4 says nobody sets
   *  anybody else's — one member switching off must not take the room's French
   *  away from somebody who needs it. `firestore.rules` constrains the write
   *  to the caller's own key, exactly as it does the two maps above. */
  translationEnabled: z.record(z.string(), z.boolean()).optional(),
  /** Server-derived per-member targets (MSG-KEY-8). The client reads ONLY the
   *  pronouns, to colour send-hint prompt context (MSG-PIPE-21) — the rest is
   *  the server's own shape, so it stays deliberately loose. */
  /**
   * The server's authoritative per-member language answer, written by
   * `computeChatLanguageTargets` on every send. Under LANG-SET these are the
   * SNAPPED values — a free member's pair constrained to the chat's paid
   * language set — so they are what the pipeline actually rendered, and the
   * client resolves against them rather than re-deriving (LANG-RESOLVE-1).
   *
   * Previously only `pronouns` was declared, with everything else arriving
   * through `.passthrough()`. That typed the languages as `unknown`, so every
   * reader either cast or open-coded its own cascade — which is most of how
   * six copies of the resolution rule came to exist.
   */
  memberLanguageTargetsV2: z.record(z.string(), z.object({
    nativeLanguage: z.string().optional(),
    practiceLanguage: z.string().optional(),
    notificationLanguage: z.enum(['native', 'practice']).optional(),
    difficulty: z.number().optional(),
    pronouns: z.string().optional(),
  }).passthrough()).optional(),
  /**
   * LANG-GATE-7 — the server's advisory answer to "would a send right now be
   * rejected". Server-written (blocked for clients in `firestore.rules`) and
   * READ-ONLY here: it decides what the composer area renders, never whether a
   * send is permitted. The 402 from the pipeline is the actual gate.
   *
   * `paused` already folds in whether the gate is armed at all, so the client
   * never has to know about the server's kill switch — while the gate is off
   * this is always `false` and every chat renders exactly as it does today.
   * Absent on every chat that has not been recomputed since this shipped,
   * which reads as "not paused" and is the correct default.
   */
  languageGate: z.object({
    paused: z.boolean(),
    hasSubscriber: z.boolean().optional(),
    /**
     * LANG-RESOLVE-7 — the chat's language set (LANG-SET-1), in the server's
     * own SNAP ORDER. `languages[0]` is what an out-of-set reading language
     * snaps onto, so this is not a display list and must not be re-sorted.
     *
     * ⚠ Three states, none interchangeable: absent is UNKNOWN (a chat not
     * recomputed since this shipped — consumers fall back to what shipped
     * before), `[]` is KNOWN EMPTY (nobody entitled, so no constraint), and a
     * non-empty array is the constraint. Read it through
     * `publishedLanguageSet`, never directly — this schema is `.passthrough()`
     * over a partly client-writable doc, so the type is a claim about the
     * shape rather than a guarantee of it.
     */
    languages: z.array(z.string()).optional(),
    /**
     * PROF-5 — the members whose `hasProEntitlement` was true when the server
     * last recomputed this gate. The ONLY source of "is member X entitled" on
     * the client: nothing reads another user's `plan` / `trialEndsAt` /
     * `planUntil` (their user doc is owner-only, PROF-3). Absent on a chat not
     * recomputed since this shipped, which consumers read as nobody entitled
     * (fail closed, LANG-SEC-2). The caller's OWN entitlement still comes from
     * their own user doc.
     */
    entitledUids: z.array(z.string()).optional(),
  }).passthrough().optional(),
  /** MSG-VIEW-7 — per-user two-row view override for this chat. When unset
   *  for a uid, the client falls back to `users/{uid}.viewSettings` then the
   *  app default (see `resolveViewSettings`). Written by the per-chat toggles
   *  in ChatHeaderMenu; cleared in bulk by "Update defaults". */
  viewSettings: z.record(z.string(), ZStoredViewSettings).optional(),
  /** Tutor-chat-only. Set to true for a uid the first time they enable
   *  language features on the tutor chat (either via the welcome CTA or
   *  the header menu). Used to gate the message composer — new users
   *  can't send anything until they've engaged with the translation
   *  toggle once. Stays true forever once set, even if they later turn
   *  translations off again. */
  tutorComposerUnlocked: z.record(z.string(), z.boolean()).optional(),
  name: z.string().optional(),
  adminUids: z.array(z.string()).optional(),
  createdBy: z.string().optional(),
  groupPhotoURL: z.string().optional(),
  /** ≤200px thumbnail of the group photo (for chat-list rows + header). */
  groupPhotoThumbUrl: z.string().optional(),
  /** Inline base64 LQIP of the group photo. Same lifecycle as User.tinyImage. */
  groupPhotoTinyImage: z.string().optional(),
  isBroadcast: z.boolean().optional(),
  /** Map of uid → last-typing timestamp. Reader treats anything within ~6s as "currently typing". */
  typing: z.record(z.string(), ZTimestamp).optional(),
  /** Map of uid → last-read timestamp. Drives the read receipt under own messages. */
  lastReadAt: z.record(z.string(), ZTimestamp).optional(),
  /** Server-derived rendering targets (LANG-TX-1). The client reads only
   *  whether it is EMPTY — translation off for every member — so a send there
   *  does not claim analysis (MSG-PIPE-21.6.2). */
  translationTargetsV2: z.record(z.string(), z.unknown()).optional(),
});
export type Chat = z.infer<typeof ZChat>;

// ---------- topics (global taxonomy) ----------

/**
 * Topic doc — lives in the global `/topics/{id}` collection. `name` is
 * the canonical English-lowercase form ("food", "travel") used by the
 * classifier + matching. `translations` is a per-BCP-47-code display
 * map written by the `onTopicCreate` Cloud Function shortly after the
 * topic is first created — see `functions/src/index.ts`. Missing
 * translations fall back through (exact locale → base lang → English
 * → capitalised name) on the client via `getTopicLabel`.
 *
 * The map is optional because:
 *   - Pre-existing topics created before the translation pipeline
 *     landed don't have it (a one-shot backfill script fills these in).
 *   - The Cloud Function fires async; there's a sub-second window
 *     where a brand-new topic doc has no translations yet.
 *
 * Values: short human-readable display strings (e.g.
 *   `translations: { es: "Comida", fr: "Nourriture", "zh-CN": "食物" }`).
 */
export const ZTopic = z.object({
  id: z.string(),
  name: z.string(),
  /** TOPIC-SET-1: present and non-empty on a THEME (the closed set the
   *  classifier picks from); absent on a legacy topic. Rendered into the
   *  classifier's SI (TOPIC-SET-4). */
  description: z.string().optional(),
  translations: z.record(z.string(), z.string()).optional(),
});
export type Topic = z.infer<typeof ZTopic>;

// ---------- contacts ----------

export const ZContact = z.object({
  id: z.string(),
  uid: z.string(),
  name: z.string(),
  phoneNumber: z.string(),
  isOnWurld: z.boolean().optional(),
  createdAt: ZTimestamp.optional(),
});
export type Contact = z.infer<typeof ZContact>;

// ---------- flashcards ----------

/**
 * Flashcard schema. Canonical field names only — the pre-cutover aliases
 * (`front` / `back` / `language` / `lastReviewed`) were renamed on every doc
 * by the 2026-09-29 migration and are no longer read.
 */
export const ZFlashCard = z.object({
  id: z.string(),
  /** The practice-language phrase shown on the card front. */
  phrase: z.string().optional(),
  /** The native-language translation shown on the card back. */
  translation: z.string().optional(),
  /** Sentence-level context the phrase appeared in (optional, from ExplainModal). */
  context: z.string().optional(),
  /** Language the user is learning. */
  practiceLanguage: z.string().optional(),
  /** User's native language at save time. */
  nativeLanguage: z.string().optional(),
  /** Topic / category — a theme name or "other" (TOPIC-SET-5), or a legacy
   *  topic name on older cards. Assigned async by the classifier. */
  topic: z.string().optional(),
  /** TOPIC-SET-5: 1–3 English words naming what the card is about, stamped
   *  by the classifier alongside `topic` for the manual sweep (TOPIC-SET-10). */
  topicSubject: z.string().optional(),
  /** Source tag list (e.g. ['grammar', 'idiom']). */
  tags: z.array(z.string()).optional(),
  /** Source-message / source-chat backlinks. */
  sourceMessageId: z.string().nullable().optional(),
  sourceChatId: z.string().nullable().optional(),
  /** Owner uid mirrored on the doc body (source sets this). */
  userId: z.string().optional(),
  /** Simple counter-based progress — source has no SM-2. */
  correctCount: z.number().optional(),
  incorrectCount: z.number().optional(),
  /** SM-2 fields used by lib/flashcards.ts. Optional because legacy
   *  cards saved before SM-2 won't have them. */
  interval: z.number().optional(),
  ease: z.number().optional(),
  reps: z.number().optional(),
  lapses: z.number().optional(),
  nextReviewAt: ZTimestamp.optional(),
  /** Source-side schema version stamp. */
  schemaVersion: z.number().optional(),
  createdAt: ZTimestamp.optional(),
  lastReviewedAt: ZTimestamp.optional(),
  /** CARDS-ARCHIVE-1: lifecycle status. `active` (default when unset) =
   *  in regular rotation. `archived` = learnt; excluded from practice
   *  sessions by default, only included when the user explicitly asks
   *  via the "Review archived cards" custom-prompt chip. */
  cardStatus: z.enum(['active', 'archived']).optional(),
  /** CARDS-ARCHIVE-2: rolling streak of distinct days on which this
   *  card was answered correctly (and never wrong since the streak
   *  began). Auto-archive at 5 — see `recordAttempt`. Reset to 0 on
   *  any incorrect answer. Manual toggling never touches this field. */
  consecutiveCorrectDays: z.number().optional(),
  /** CARDS-ARCHIVE-3: when the card moved to `archived` (manual or
   *  auto). Read by the cards-page Archived section header so it can
   *  list "moved here on …". */
  archivedAt: ZTimestamp.optional(),
});
export type FlashCard = z.infer<typeof ZFlashCard>;

/** The two sides of a card, with `''` standing in for an absent side. */
export function cardSides(c: FlashCard): { phrase: string; translation: string } {
  return {
    phrase: c.phrase ?? '',
    translation: c.translation ?? '',
  };
}

// ---------- practice events ----------

/**
 * The PracticeQuestion union in `lib/sessionBuilder.ts` shares this exact
 * tag set. We keep them in sync by hand — both files are small and this
 * runtime validator wants a closed enum so an unknown questionType from
 * a future migration is rejected at parse time rather than being silently
 * coerced. If `QuestionType` over there gains a new variant, add it here
 * too (and to the admin-side bucketing in `getPracticeEventStats`).
 */
export const ZPracticeQuestionType = z.enum([
  'multiple-choice',
  'native-to-practice',
  'listen-and-pick',
  'listen-and-write',
  'vocab-matching',
  'fill-the-blank',
  'find-the-mistake',
  'listen-and-fill',
  // QUIZ-DATA-4 — chat-quiz only. Event types, never generator types: the
  // planner's own enum (`practiceGenerator/schemas.ts`) does not list them.
  'word-order',
  'listen-and-order',
]);
export type PracticeQuestionType = z.infer<typeof ZPracticeQuestionType>;

/**
 * Per-question analytics row. Written by the client to
 * `users/{uid}/practiceEvents/{eventId}` after each answered question
 * (see `lib/practiceEvents.ts`). The admin dashboard reads the
 * collection-group aggregate via the `getPracticeEventStats` cloud
 * function — owner-only writes, admin-only reads.
 *
 * Required fields stay minimal so a malformed legacy doc still parses
 * the useful columns. `tokensUsed` is reserved for the (future) case
 * where a question's generation traces back through Gemini and we want
 * to bill the cost against that specific event — today the practice
 * generator runs against the local card pool so tokensUsed is 0 / unset.
 */
export const ZPracticeEvent = z.object({
  id: z.string().optional(),
  uid: z.string(),
  questionType: ZPracticeQuestionType,
  correct: z.boolean(),
  createdAt: ZTimestamp,
  /** Stamp identifying a single practice session. Useful when slicing
   *  the dashboard "questions per session" later. */
  sessionId: z.string().optional(),
  /** QUIZ-DATA-1 — where the question was asked. Absent = a practice session. */
  source: z.enum(['chat-quiz']).optional(),
  /** Backing flashcard id if the question maps 1:1 to a card. Matching
   *  questions cover multiple cards so this is omitted. */
  cardId: z.string().optional(),
  topic: z.string().optional(),
  practiceLanguage: z.string().optional(),
  nativeLanguage: z.string().optional(),
  /** Gemini tokens spent generating THIS question, if any. Reserved
   *  for future LLM-backed question types. */
  tokensUsed: z.number().nonnegative().optional(),
  /** PRACTICE-EXPLAIN-6: true on the SECOND row written when the user
   *  taps Explain on a wrong answer and the LLM overturns the verdict
   *  ("question was ambiguous"). The original `correct: false` row
   *  stays — admin sees both attempts. Older rows without the field
   *  count as `overturned: false`. */
  overturned: z.boolean().optional(),
  /** PRACTICE-EXPLAIN-5: on the overturn row, the user's original
   *  answer that the LLM just overruled. Makes the override row
   *  self-describing for admin queries that filter on `overturned: true`
   *  without needing to JOIN against the original wrong-attempt row. */
  userAnswer: z.string().optional(),
  /** PRACTICE-EXPLAIN-5: on the overturn row, the answer the system
   *  marked as correct. Pairs with `userAnswer`. */
  correctAnswer: z.string().optional(),
});
export type PracticeEvent = z.infer<typeof ZPracticeEvent>;

// ---------- practice sessions + rolling stats ----------

/**
 * One row per question inside a completed session, persisted as part of
 * the parent {@link ZPracticeSession} doc. Mirrors the source app's
 * `SessionQuestionResult`. Kept inside the session doc (not as a sub-
 * collection) because we only need it to render the post-session summary
 * + admin replays; the live `practiceEvents` collection is the row-level
 * analytics stream.
 */
export const ZPracticeSessionResult = z.object({
  questionId: z.string(),
  cardId: z.string().optional(),
  questionType: ZPracticeQuestionType,
  topic: z.string().optional(),
  correct: z.boolean(),
  skipped: z.boolean(),
  userAnswer: z.string().optional(),
  correctAnswer: z.string().optional(),
});
export type PracticeSessionResult = z.infer<typeof ZPracticeSessionResult>;

/**
 * Completed practice session log. Written once at the end of every
 * session (best-effort; offline writes drop). Path:
 *   `users/{uid}/practiceSessions/{sessionId}`
 *
 * `sessionId` is the same value stamped on each `practiceEvents` row in
 * the live telemetry stream, so admin queries can join the two.
 *
 * `topicFocus` / `customPrompt` are the user's customization choices
 * captured at session-start; surfacing them in the summary lets the user
 * see "this session was set to focus on past tense" alongside the score.
 */
export const ZPracticeSession = z.object({
  id: z.string(),
  uid: z.string(),
  language: z.string(),
  nativeLanguage: z.string().optional(),
  difficulty: ZDifficulty.optional(),
  questionCount: z.number(),
  correctCount: z.number(),
  skippedCount: z.number(),
  topicFocus: z.string().optional(),
  customPrompt: z.string().optional(),
  results: z.array(ZPracticeSessionResult),
  startedAt: ZTimestamp.optional(),
  completedAt: ZTimestamp.optional(),
});
export type PracticeSession = z.infer<typeof ZPracticeSession>;

/**
 * Per-topic / per-question-type score tally. Kept tiny so the rolling
 * stats doc stays cheap to read at session start.
 */
export const ZScoreTally = z.object({
  correct: z.number(),
  total: z.number(),
});
export type ScoreTally = z.infer<typeof ZScoreTally>;

/**
 * Rolling per-language aggregate. Read by the planner at session start
 * to know which topics the user has been struggling with + what was
 * tested recently (anti-repetition). Updated transactionally at the end
 * of every session — see `lib/practiceStats.ts`.
 *
 * Path: `users/{uid}/practiceStats/{languageOrSafeKey}`. The doc key is
 * `language.replace(/\W+/g, '_').toLowerCase()` to keep Firestore-safe
 * (handles "English (British)" etc).
 *
 * `recentSessionTopics`: last 10 topicFocus values. Used to deprioritize
 *   topics the user has hammered recently.
 * `recentCardIds`: last ~50 cards seen across the most recent sessions.
 *   Used to deprioritize exact-card repeats.
 * `topicScores` / `challengeScores`: cumulative accuracy by topic and
 *   question-type bucket. Surfaced to the planner as "user is at 45%
 *   on food, prioritize" / etc.
 *
 * All fields optional so a brand-new user reads `undefined` and the
 * planner falls back to a clean-slate session.
 */
/**
 * XP-DATA-1 — the `xp` field of `users/{uid}/practiceStats/{languageKey}`.
 * Every map is sparse and keyed by level ("1".."7") or UTC date. Written only
 * by the server's award transaction (functions/src/xp.ts); see docs/specs/xp.md.
 */
export const ZXpState = z.object({
  /** XP-DATA-2 — every XP earned in this language; never goes down. */
  total: z.number().catch(0),
  /** XP-DATA-2 — XP earned while at each level. Sums to `total`. */
  byLevel: z.record(z.string(), z.number()).optional().catch(undefined),
  /** XP-DATA-3 — last 30 graded outcomes per level, '1' right / '0' wrong. */
  recent: z.record(z.string(), z.string()).optional().catch(undefined),
  /** XP-DATA-3.1 — practice-language messages sent at each level (XP-LEVEL-9). */
  written: z.record(z.string(), z.number()).optional().catch(undefined),
  /** XP-DATA-3 — last 30 UTC days: `{ total, write }`. */
  daily: z
    .record(z.string(), z.object({ total: z.number().catch(0), write: z.number().catch(0) }))
    .optional()
    .catch(undefined),
  /** XP-LEVEL-1/4 — `byLevel[L]` needed before level L is ready (default 500). */
  nextOfferAt: z.record(z.string(), z.number()).optional().catch(undefined),
  /** XP-LEVEL-3 — level L passes the threshold AND the accuracy gate. */
  ready: z.record(z.string(), z.boolean()).optional().catch(undefined),
  updatedAt: ZTimestamp.optional().catch(undefined),
});
export type XpState = z.infer<typeof ZXpState>;

export const ZPracticeStats = z.object({
  uid: z.string(),
  language: z.string(),
  topicScores: z.record(z.string(), ZScoreTally).optional(),
  challengeScores: z.record(z.string(), ZScoreTally).optional(),
  recentSessionTopics: z.array(z.string()).optional(),
  recentCardIds: z.array(z.string()).optional(),
  totalSessions: z.number().optional(),
  totalQuestions: z.number().optional(),
  totalCorrect: z.number().optional(),
  lastSessionAt: ZTimestamp.optional(),
  /** XP-DATA-1 — engagement XP for this language. Server-only (XP-DATA-5):
   *  the client reads it and never writes it. `.catch(undefined)` so a drifted
   *  value degrades to "no XP yet" instead of failing the whole stats parse. */
  xp: ZXpState.optional().catch(undefined),
});
export type PracticeStats = z.infer<typeof ZPracticeStats>;

/**
 * Firestore-safe doc id derived from a language label. Lowercases,
 * collapses non-word chars to underscore. "English (British)" → "english_british_".
 */
export function practiceStatsKey(language: string): string {
  return language.toLowerCase().replace(/\W+/g, '_').replace(/^_+|_+$/g, '') || 'default';
}

// ---------- helpers ----------

/** Parse a Firestore doc + id into a typed schema. Logs Sentry on schema
 * drift but returns null instead of throwing (so a malformed doc doesn't
 * crash the entire list query). */
export function parseDoc<T extends z.ZodTypeAny>(
  schema: T,
  id: string,
  raw: unknown,
): z.infer<T> | null {
  const merged =
    typeof raw === 'object' && raw !== null ? { id, ...(raw as object) } : { id };
  const result = schema.safeParse(merged);
  if (result.success) return result.data;
  // OBS-COVER-9 — through `log`, not the console. Imported lazily: a static
  // `log` import here is a cycle (tests mock config → firebase → these types).
  const issues = result.error.issues.slice(0, 5).map((i) => ({ path: i.path.join('.'), code: i.code }));
  const sample = Object.keys(raw && typeof raw === 'object' ? raw : {}).slice(0, 20);
  void import('@/lib/schemaDrift')
    .then((m) => m.reportSchemaDrift(schema, { issues, sample }))
    .catch(() => undefined);
  return null;
}
