# Architecture

Top-level system shape — module map and Cloud Function inventory. Per-surface invariants, state machines, and design decisions live in [docs/specs/](specs/). This file is the map, not the contract.

## Module map

```
src/
  lib/                                ← pure helpers + Cloud Function wrappers
    runtime.ts            ← detect web / pwa-installed / native-ios / native-android
    capabilities.ts       ← canUseX() predicates — gate features through these
    endpoints.ts          ← Registry of every Cloud Function we call.
                            CallableName: onCall functions (Firebase SDK).
                            RequestName: onRequest v2 (raw fetch + bearer).
    config.ts             ← Typed env loader; validates on boot.
    log.ts / sentry.ts    ← Structured logging + crash telemetry.
                            See specs/observability.md.
    errors.ts             ← AppError + toUserMessage().

    chatService.ts        ← Send / edit / retry / reaction / typing / unread.
                            Send routes through processMessagePipeline.
                            See specs/message-pipeline.md (MSG-PIPE-*, MSG-STATE-*).
    pipeline.ts           ← processMessagePipeline + retryPipeline wrappers.
                            acceptCorrection / dismissReview Firestore updates.
    languageKeys.ts       ← {practice}Annotated{Native} key resolution.
    vocabTags.ts          ← tokenizeVocab — alternation regex w/ word boundaries.
                            Multi-word phrases match as single segments.
    tts.ts                ← synthesizeSpeech + playTTS one-shot + prefetch cache.
    tutor.ts              ← TUTOR_UID, ensureTutorChat, requestTutorReply.
                            See specs/wurld-tutor.md.
    flashcards.ts         ← addFlashCard with dedup. SM-2 SRS helpers
                            (computeNext, applyReview, recordAttempt).
                            See specs/practice-mode.md §9 for the save flow.
    topics.ts             ← Gemini-classified flashcard topics. /topics
                            global collection.
    translationFeedback.ts ← submitTranslationFeedback wrapper.
    gemini.ts             ← streamGemini SSE + generateGemini non-stream.
    keyboardInset.ts      ← Drives --kb-h from Capacitor Keyboard events.
    haptics.ts            ← Vibration / Capacitor Haptics gated via capabilities.
    localCache.ts         ← localStorage snapshot mirror for cold-boot.
                            See specs/cold-boot.md.

  i18n/                   ← UI localisation (en source of truth + 80 generated locales).
                            See specs/i18n.md.

  hooks/
    firestore/            ← useDocSnapshot, useCollectionSnapshot, useFirestoreMutation
                            (three-stage hydration — see specs/cold-boot.md)
    useAuthStore.ts       ← Firebase Auth state in Zustand
    useChatSettings       ← Per-chat read-modify of practiceLanguages / view settings
    useUserProfile        ← /users/{uid} doc subscription
    useKeyboardState      ← visualViewport-based KB inset (used by chat layout)
    useLongPress          ← Pointer-event long-press detector (450ms default)
    useSwipeActions       ← Pointer-event swipe with onSwipeRight/Left
    useMessages           ← Paginated messages-subcollection subscription
    useChats              ← User's chat list

  components/
    AppShell.tsx          ← Two-pane on lg (Sidebar + main), single on narrow
    Toaster / OfflineBar / UpdateAvailableToast / ErrorBoundary
    LanguagePicker        ← Used by ProfileSetup + ChatHeader
    MessageInput/         ← Composer + reply preview + image picker + edit
                            See specs/composer.md.
    Message/              ← Decomposed chat bubble:
      MessageBubble       ← Pure render. Bubble + reactions are siblings now
      MessageItem         ← Wraps MessageBubble with gesture handlers + status
      MessageActionsMenu  ← Long-press menu (phase animations, overlap layout)
      ReactionStrip       ← Pills hang off bubble bottom edge (relative z-10)
                            See specs/reactions.md.
      WordPopover         ← Inline word translation + save-to-flashcards
      ReplyPreview        ← Sender / practice / native rows
      CorrectionCard / NaturalAlternativeCard / UnreadableReviewCard
      AnnotatedText       ← Plain-text + tokenizeVocab underlines
      MessageStatus       ← Sending / Translating / Read / retry chip
      TranslationFeedbackModal
    Image/                ← ChatImage, EditableAvatar, CircleCropModal
                            See specs/image-messages.md.
    Chat/BubbleStack/ChatScroll/  ← The chat scroll ENGINE — the most
                            complex subsystem in the app. ChatScroll.tsx:
                            imperative column-reverse FLAT-LIST scroller
                            (commit classifier, unified ResizeObserver,
                            landing lock, scrollToEnd / scrollToIndex handle).
                            crGeometry.ts: pure column-reverse sign-flip math.
                            useScrollTopWriter / useJsMomentum: single write
                            path + JS inertia. NOT virtualised — renders every
                            loaded item; windowing is spec'd but UNSHIPPED
                            (chat-scroll.md SCROLL-WIN). Hosted by
                            screens/ChatScreen/MessageList.
                            (Dir name is historical: the BubbleStack wrapper it
                            once held was deleted 2026-06-19; only ChatScroll
                            remains — directory rename pending.)

  screens/
    ChatListScreen
    ChatScreen
    ChatScreen/
      ChatHeader          ← Practice-language picker fires backfill
      MessageList         ← Host policy for the scroller: day grouping +
                            date separators, scroll-affordance chips,
                            jump-to-message flow. Drives the ChatScroll
                            engine (components/Chat/… below), NOT a renderer
                            itself. See specs/chat-scroll.md.
    ContactsScreen / AddContactScreen / CreateGroupScreen
    CardsScreen + PracticeScreen + Practice/*
                            See specs/cards-screen.md, specs/practice-mode.md.
    SettingsScreen + Settings/*
    AdminScreen + Admin/*
    ProfileSetupScreen
    LoginScreen
    ShareTargetScreen     ← /share chat picker for content shared INTO Wurld.
                            Intake: hooks/useShareIntake + lib/shareIntake
                            (web SW inbox / native ShareInbox plugin).
                            See specs/share-target.md.

  store/                  ← Zustand
    authStore / uiStore / draftStore / pendingNavStore / betaFlagsStore /
    languageRecentsStore

  styles/globals.css      ← Tailwind 4 @theme, semantic colors, .pb-keyboard
                            utility, heart-burst keyframe.
```

## Cloud Functions modules

`functions/src/index.ts` is only the **re-export surface**: it names every
deployed function and defines none, so the deployed names never depend on the
file layout (verified by diffing `Object.keys(require('./functions/lib/index.js'))`
before and after the split). Handlers live in a module per surface; the
pipeline machinery they share lives in `pipeline/`.

```
functions/src/
  index.ts                 ← re-exports only (+ `import "./pipeline/propagation"`
                             for the billing-runtime registration)
  httpV2.ts                ← `onRequestV2`: the version-floored v2 factory every
                             v2 handler uses (OBS-VERSION-10). Only getVersion,
                             deleteAccount, billingDeletionCheck and
                             liveUpdatePolicy call the raw `onRequestV2Unversioned`.
  versionEndpoint.ts       ← getVersion. At src/ depth on purpose: it reads
                             ../package.json and buildInfo.json relative to lib/.
  liveUpdate/resolver.ts   ← pure: live-update channel resolution + policy
                             normalisation (live-updates.md D5, OTA-16).
  endpoints/
    liveUpdate.ts          ← liveUpdatePolicy (raw factory: floor-exempt,
                             verifyAuth + LIMIT-1) and adminSetChannel
                             (onRequestV2 + requireAdmin, audited).
    send.ts                ← processMessagePipeline (+ __testables)
    review.ts              ← clarifyMessageReview, resolveMessageReview
    pipelineTriggers.ts    ← dispatchMessageSideEffects, onMessagePipelineUpdate,
                             pipelineFailsafeScan, messagePipelineRetry,
                             onMessageDeletedForEveryone
    backfill.ts            ← chatTranslationsBackfill
    gemini.ts              ← geminiGenerate, geminiStreamV2
    tutor.ts / tutorTurns.ts ← tutorRespond / its setup + action turn handlers
    topics.ts              ← onTopicCreate
    tts.ts                 ← synthesizeSpeech, listStandardVoices
    uploads.ts             ← getUploadUrl, processUploadedImage, finalizeVideoUpload
    chats.ts               ← clearChatNotifications, submitTranslationFeedback, deleteChat
    languageRequest.ts     ← requestChatLanguage (LANG-LEARNWITH-22)
    contacts.ts            ← resolveContacts
    userTriggers.ts        ← syncUserLanguageChange, onUserProfileMirror,
                             syncProfileMirror, resyncLanguageTargets,
                             syncChatLanguageTargets
    plans.ts               ← onUserCreated, startTrial,
                             adminGrantPlus, adminRevokePlus, trialExpiryWarningScan
    account.ts             ← billingDeletionCheck, deleteAccount, cascadeDeleteUserData
    admin.ts               ← requireAdmin + dashboard / traces / stats endpoints
    adminPractice.ts       ← getPracticeEventStats
    broadcast.ts           ← adminBroadcast, adminBroadcastDelete
  pipeline/                ← shared send-pipeline machinery (no deployed functions)
    shared.ts              ← pipeline constants, STAGE_LABELS, context reads
    analyze.ts             ← analyzeUserMessage (the unified analysis call)
    analyzeAndPrime.ts     ← trigger-side analysis under the analyze lease
    analysisResult.ts / chatTargets.ts / constants.ts (pure)
    languageTargets.ts     ← ensureChatLanguageTargets
    jobClaims.ts           ← translation-job claims, heartbeats, fenced commits
    translate.ts / translateBatch.ts ← single-target / batched translation
    runJobs.ts             ← runPipelineJobs (+ multi-target convert)
    finalize.ts            ← finalizePipelineState (MSG-PIPE-28.4)
    sideEffects.ts         ← chat summary, unread counts, notifications
    propagation.ts         ← language / plan change propagation; registers
                             billing/runtime's applyBillingChange at load
    backfill.ts            ← runBackfillForChat (the backfill core)
    traces.ts / logWrite.ts
  billing/                 ← Stripe / Apple / Google handlers + pure billing logic
                             (re-exported with `export * from`)
  tutorCompact.ts          ← tutorCompact (re-exported)
```

The functions test project cannot import `index.ts` (it mounts
firebase-functions, sharp and the whole pipeline), so static tests read the
source as text through `functions/src/__tests__/helpers/serverSource.ts`:
`readServerSource()` joins these modules in their old `index.ts` order, and
`readServerModule(path)` reads one. A module that takes over code from another
belongs in its `SERVER_SOURCE_FILES` list. `functions/src` is linted by its own
block in `eslint.config.js` (Node globals, the 600-LOC cap; `any`,
`no-useless-assignment` and `no-misleading-character-class` warn until cleared).
Over the cap with a documented exception: `endpoints/send.ts` (the
~1,340-line `processMessagePipeline` handler) and `prompts/serverPromptSpec.ts`.

## Cloud Function inventory

Registry: [src/lib/endpoints.ts](../src/lib/endpoints.ts) (every URL versioned; no string-concat at call sites). Summary by purpose:

- **`api` — the warm hot-path gateway** ([api-gateway.md](specs/api-gateway.md)): one gen2 `onRequest` (512 MiB, 120 s, concurrency 80, `minInstances` from `API_MIN_INSTANCES`: 1 on beta, 0 on prod) that serves `api/<name>` for `processMessagePipeline`, `geminiGenerate`, `geminiStreamV2`, `tutorRespond`, `synthesizeSpeech` and `resolveContacts` by calling those exports themselves (`functions/src/endpoints/api.ts`, routing in `functions/src/apiRouter.ts`, per-request scope in `functions/src/requestScope.ts`). Clients reach those six only through `api` (API-GW-7). The standalone functions listed below stay deployed for older builds until the API-GW-8 checkpoint.

- **Send**: `processMessagePipeline` (POST, onRequest v1).
- **Retry full message**: `messagePipelineRetry` (POST, onRequest v1).
- **Retry single language**: client updates `translationErrors.{lang}` field; backend `onMessagePipelineUpdate` trigger picks up.
- **Backfill on practice-language change / chat open**: `chatTranslationsBackfill` (POST, onRequest v1). 30s per-chat cooldown.
- **Explain stream**: `geminiStreamV2` (SSE, onRequest v2). 30s stall-detect aborts.
- **Generate**: `geminiGenerate` (Callable). Used by topic classification + practice generator.
- **Analysis cache keep-warm**: `analysisCacheKeepWarm` (v1 `pubsub.schedule`, every 20 minutes) prewarms the Luna send-analysis SI in OpenAI's cache on the tier the send uses, only where analysis routes to OpenAI (message-pipeline.md MSG-PIPE-31.14). Logic in `openai/keepWarm.ts`.
- **TTS**: `synthesizeSpeech` (Callable). Returns base64 MP3.
- **Tutor**: `tutorRespond` (onRequest v2).
- **Feedback**: `submitTranslationFeedback` (onRequest v2).
- **Profiles / contact lookup** ([profiles.md](specs/profiles.md)): `resolveContacts` (POST, onRequest v2, `verifyAuth` + LIMIT-1; `{ phones: string[] }` ≤ 500 E.164 entries → `{ matches: { [phone]: { uid, displayName } } }`, matched phones only — PROF-4); `onUserProfileMirror` (Firestore trigger on `users/{uid}`, projects the six display fields into `profiles/{uid}` and deletes the profile with the user doc — PROF-2; pure projection in `functions/src/profiles.ts`); `syncProfileMirror` (POST, onRequest v2, `verifyAuth` + LIMIT-1, no body — the trigger's HTTP twin, called by the owner's client when its own profile lags its user doc; the only profile writer in beta, where the trigger watches `wurld-beta`'s empty database — PROF-2.1). Backfill: `scripts/migrate-profiles.mjs` (PROF-6).
- **0.3.1 compat-removal migration** (message-pipeline.md MSG-KEY-10.6.2): `scripts/migrate-0.3.1-cleanup.mjs` — one Admin-SDK sweep over `users/*` (+ `flashcards`, `lifeWorlds`), `chats/*` and `chats/*/messages/*` that settles every legacy shape the 2026-09-29 server no longer reads (translation-key aliases, swap fields, flat image fields, `viewMode`, flashcard aliases, life-world defaults, `pipeline.sender*` pins, image-only `pipeline` objects, job `mode`). Pure `plan*` projections in the script (tested in `scripts/migrate-0.3.1-cleanup.test.mjs`), key logic reused from `scripts/lib/translationKeyMigration.mjs`. `--dry-run` default, `--apply`, `--audit` (exit 1 while anything legacy remains). `functions/src/translationAliases.ts` was deleted with it.
- **Admin**: `getAdminDashboard` + `adminBroadcast` / `adminBroadcastDelete` + traces / stats endpoints (`getAdminPipelineTraces`, `getAdminTraceDetail`, `getAdminPipelineStats`, `getAdminUsageStats`, `getPracticeEventStats`). There is no `manageAdmin` endpoint: the admin set is `users/{uid}.isAdmin`, written with the Admin SDK (SEC-FN-5).
- **Live updates** ([live-updates.md](specs/live-updates.md)): `liveUpdatePolicy` (POST, raw `onRequestV2Unversioned` — exempt from the version floor so a below-floor shell can self-heal, OTA-12 — `verifyAuth` + LIMIT-1; `{ platform, nativeBuild, deviceChannel, bundleVersion }` → `{ channel, policy }`, the channel resolved `channelOverride ?? (betaOptIn ? beta : deviceChannel)` and the levers read fresh from `config/liveUpdate.<channel>`, OTA-9/OTA-16); `adminSetChannel` (POST, onRequest v2, `requireAdmin`, audited — the only writer of `users/{uid}.channelOverride`, ADMIN-CHANNEL-2). Standalone, not routed through `api` (API-GW-9). The bundles themselves are static hosting files (`/live/manifest.json`, `/live/bundles/*.zip`) published by `scripts/release/live-bundle.mjs` inside the deploy scripts.
- **Billing** ([billing.md](specs/billing.md)): `adminGrantPlus` / `adminRevokePlus` (POST, onRequest v2, `requireAdmin`, audited in `billingAudit` — BILL-ADMIN-1/2); `adminSetPlan` moves any user between regular and lifetime Plus via manual grants (BILL-ADMIN-3, ADMIN-PLAN-4/5); `billingDeletionCheck` (POST/GET, onRequest v2, verified caller — BILL-DEL-3); `deleteAccount` stops billing before its cascade (409 `apple_subscription_active` without `acknowledgeAppleBilling`, 502 when a Stripe/Google cancel fails — BILL-DEL-3/5) and tombstones grants after it (BILL-DEL-4). Pure logic in `functions/src/billing/` (`grants.ts`, `admin.ts`, `cancellers.ts`, `accountToken.ts`), Firestore I/O in `billing/store.ts`, and the seam per-source handlers call without importing `index.ts` in `billing/runtime.ts` (`applyBillingChange` → project → propagate → drain). Client twin of the account token: `src/lib/accountToken.ts`. Scripts: `scripts/grant-plus.mjs`, `scripts/archive/migrate-grandfathered-to-grants.mjs` (BILL-ADMIN-4 — applied 2026-09-28, kept for provenance).
- **Billing — Stripe (web)** ([billing.md](specs/billing.md)): `stripeCreateCheckout` (POST, onRequest v2, verified caller, `{returnTo}` on our origins → `{url, id}`; 409 `already_entitled {sources}` on a live grant from another source or a live Stripe grant in this deployment's Stripe mode (BILL-STRIPE-1.1), 400 `bad_return_to`, 429, 500 `price_not_configured`, 502 `stripe_error` — BILL-STRIPE-1, BILL-MANAGE-2), `stripeCreatePortal` (POST, verified caller, `{returnTo}` → `{url}`; 404 `no_customer` — BILL-STRIPE-5) and `stripeWebhook` (POST, unauthenticated, `Stripe-Signature` over the raw body, 400 `bad_signature` with no write — BILL-STRIPE-3) in `billing/stripeHandlers.ts`, which also registers the Stripe deletion canceller (`subscriptions.cancel`, immediate — BILL-DEL-1) and exports `reconcileStripeGrant` (the Stripe `refresh` for `billingReconcile` — BILL-RECON-1). Pure mapping: `stripeMapping.ts`; lazy SDK client: `stripeClient.ts`; emulator-only fake: `stripeFake.ts` (`_stripeFake_*`). Secrets: `STRIPE_SECRET_KEY` (Checkout, Portal, webhook, `deleteAccount`, reconcile), `STRIPE_WEBHOOK_SECRET` (webhook). Customer map: `billingCustomers/{uid}` (`stripeCustomerId` live / `stripeTestCustomerId` test). Client: `src/lib/billing/webCheckout.ts`, return state `src/hooks/useWebCheckoutReturn.ts` (BILL-STRIPE-7).
- **Billing — Apple / Google / reconcile** ([billing.md](specs/billing.md)): `appleSyncTransaction` (POST, onRequest v2, verified caller, `{signedTransactions[]}` → re-read via App Store Server API → `apple_<originalTransactionId>` grant — BILL-APPLE-2) and `appleNotifications` (POST, unauthenticated, Server Notifications V2 `signedPayload` — BILL-APPLE-3) in `billing/appleHandlers.ts`; `googleSyncPurchase` (POST, onRequest v2, verified caller, `{purchaseToken, productId}` → `subscriptionsv2.get` → `google_<purchaseToken>` grant → project → acknowledge — BILL-GOOGLE-2), `googleRtdn` (POST, Pub/Sub push with OIDC — BILL-GOOGLE-3), the Google deletion canceller (`subscriptionsv2.cancel`, registered at import — BILL-DEL-2) and `billingReconcile` (v1 `pubsub.schedule`, daily 04:17 UTC, all store/Stripe grants live or expired ≤ 7 days — BILL-RECON-1/2) in `billing/googleHandlers.ts`. Pure mapping: `appleMapping.ts`, `googleMapping.ts`, `reconcile.ts`; per-source logic with the store injected: `appleCore.ts`, `googleCore.ts`; I/O seams: `appleClient.ts` / `googleClient.ts` (real) and `appleFake.ts` / `googleFake.ts` (emulator only, BILL-SEC-5, seeded through `_billingEmulatorFakes/*`); shared checks: `appleGoogleStore.ts`. Apple public root CAs: `functions/certs/apple/*.cer`. Secrets: `APPLE_IAP_KEY`, `APPLE_IAP_KEY_ID`, `APPLE_IAP_ISSUER_ID`, `APPLE_APP_APPLE_ID` (Apple functions + reconcile), `GOOGLE_RTDN_AUDIENCE`, `GOOGLE_RTDN_PUSH_SA` (`googleRtdn`); Play API auth is the runtime service account (ADC).

**Broadcast** (`adminBroadcast`, POST): sends a "Wurld Dev Team 📢" message from
`BROADCAST_SENDER_UID` into a 1:1 chat with each targeted user. Wire contract is
`{ message, photoURL?, includeUids?, excludeUids?, filters? }` — the admin UI
([src/screens/Admin/BroadcastTab.tsx](../src/screens/Admin/BroadcastTab.tsx))
MUST send `message`/`photoURL` (not `text`/`photoUrl`, the porting-bug shape that
400s with "Missing message text or photo"). Per recipient it seeds the native +
annotated-practice translation jobs from the recipient's profile and runs them
**inline** (`getAnnotatedTranslation`) before marking the message `sent` — see
[translation-job-topology.md](architecture/translation-job-topology.md). ⚠️ The
recipient loop is **sequential** with an inline LLM call per user under a 300s
function timeout, so a broadcast to a large "all users" segment can time out
mid-run (partial send); batch/concurrency is a known follow-up. Broadcast
bubbles are **read-only** (no reply — MSG-REPLY-7) and render markdown
**headings** (`## …`, opt-in — MSG-BUBBLE-MD), unlike normal chat bubbles.
Detection is shared: `isBroadcastMessage(msg)` in `src/lib/broadcast.ts`.

See the per-feature specs for how each function is invoked, retried, and gated.
