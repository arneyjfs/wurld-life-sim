# Cold-boot — data-loading spec

> Canonical contract for how a signed-in user's chat list, contacts, cards, and profile paint on cold-boot. The product target is WhatsApp-feel: instant first paint even on EDGE or fully offline, never a "Loading…" spinner where last-known-good data exists.

Invariants are prefixed `BOOT-HYDRATION-N`; edge cases `BOOT-EDGE-N`. Grep an id to find every test that asserts it.

## Coordinates with

- [message-pipeline.md](./message-pipeline.md) — messages are the one collection that does NOT use the localStorage mirror (size unbounded; rely on Firestore's IndexedDB cache).
- [observability.md](./observability.md) — quota-exceeded events log to Sentry as breadcrumbs.
- [app-check.md](./app-check.md) — `APPCHECK-4` owns the one line App Check adds to the init sequence below. It is non-blocking by contract and, with no reCAPTCHA site key configured (the shipped state), does nothing at all — the `BOOT-INIT-*` sequence is unchanged.

## Domain prefix table

| Prefix | Section | Covers |
|---|---|---|
| `BOOT-HYDRATION-*` | Three-stage hydration | Snapshot hook contract, source priorities, write-through |
| `BOOT-CACHE-*` | Cache layers | The closed list of client cache layers, their one reset signal, stale-key purge |
| `BOOT-INIT-*` | Firebase init order | Fetch guard, `navigator.onLine` spoof, auth init |
| `BOOT-QUOTA-*` | Quota defence | localStorage purge + retry, sign-out hygiene |
| `BOOT-THEME-*` | Pre-paint theme | Synchronous `[data-theme]` set in `index.html` before first paint |
| `BOOT-SHELL-*` | PWA shell delivery | Service-worker navigation precache, offline boot, registration ownership, precache pruning, hosting headers |
| `BOOT-GATE-*` | Version gate | Minimum-version check after first paint, fail-open, blocking "Update required" screen |
| `BOOT-SPLIT-*` | Code splitting | Route-level lazy chunks, offline availability of those chunks, initial-JS budget, Firebase SDKs kept out of the boot set |
| `BOOT-SHARE-*` | Shared subscriptions | One listener per document / query per screen, context providers, render isolation |
| `BOOT-EDGE-*` | Edge cases | Stale schema, slow networks, user switch |

---

## 1. Three-stage hydration — `BOOT-HYDRATION-*`

Every `useCollectionSnapshot` / `useDocSnapshot` hook runs three stages in sequence:

| Stage | Source | Latency | Trigger |
|---|---|---|---|
| 1 | `localStorage` snapshot mirror (`lib/localCache.ts`) | synchronous, < 1ms | `useState` initialiser on mount |
| 2 | Firestore SDK's own IndexedDB cache via `getDocsFromCache` | ms on fast networks, **60–70s on EDGE** (waits for SDK init) | effect post-mount |
| 3 | Live `onSnapshot` subscription | up to 25s for auth + however long the watch stream takes | effect, gated on `authStore.user` being set |

```
mount ── stage 1 (localStorage)         ─────►  ✓ painted in microseconds
            │
            ├── stage 2 (getDocsFromCache)        ─►  no-op if stage 1 already
            │                                        produced data
            │
            └── stage 3 (onSnapshot, gated on auth) ─► overlays fresh server data
                                                    + writes-through to stage 1
```

| ID | Invariant |
|---|---|
| **BOOT-HYDRATION-1** | Stage 1 reads from `localStorage` synchronously in the `useState` initialiser. A returning user with cached data paints in the same frame as mount; no spinner, no FOUC. |
| **BOOT-HYDRATION-2** | Stage 2 (`getDocsFromCache`) runs in an effect after mount. If stage 1 already produced data, stage 2 is a no-op overlay (silent if data matches). |
| **BOOT-HYDRATION-3** | Stage 3 (`onSnapshot`) is gated on `authStore.user` being set. It overlays fresh server data and writes through to stage 1's mirror whenever the mirrored CONTENT changed (BOOT-HYDRATION-12), so the next cold-boot sees the freshest known state. |
| **BOOT-HYDRATION-4** | The mirror is **opt-in via `cacheKey`** on the snapshot hooks (`useDocSnapshot`'s third argument, `useCollectionSnapshot`'s fifth). Hooks that pass a `cacheKey` read it back in the first render and write through on every content emit; hooks that don't are stage-2+3 only. Mirrored rows report `fromCache: true` until the first server emit, so a consumer that needs server confirmation still waits for it. |
| **BOOT-HYDRATION-5** | Bounded collections opt in: `chats:<uid>`, `contacts:<uid>`, `user:<uid>`. Flashcards do not (a deck grows without limit and is not on the first screen; see *Why the chat list mirror landed late*). The single-doc `user:<uid>` mirror is what eliminates the `ProfileSetupScreen` flash for returning users (the profile check in `routes.tsx` runs on first render). |
| **BOOT-HYDRATION-6** | Messages do NOT use the mirror — chat history can run to MB-per-chat and would blow the 5 MB localStorage quota. Messages rely on Firestore's IndexedDB cache (effectively unbounded). |
| **BOOT-HYDRATION-7** | Firestore `Timestamp` round-trips through JSON via `Timestamp.toJSON()` (produces `{ seconds, nanoseconds }`). The `ZTimestamp` Zod schema's `preprocess` step accepts that shape, so mirrored docs parse-back identically to live docs. |
| **BOOT-HYDRATION-9** | A document known ONLY from the app's own un-acked write is **not** resolved data. Until a snapshot arrives from a source other than a pending local write, `useDocSnapshot` stays `loading: true` and reports `data: null` — it does not resolve the SDK's latency-compensated view. Once real data has landed the guard lifts, so optimistic edits still apply in the same frame. **Cause:** `recordLastSeen` stamps `lastSeenAt`/`lastPlatform`/`lastAppVersion` on the user doc at boot; with a cold Firestore cache there is no server copy to merge onto, so the local view is a document containing only those fields. That resolved as `{ loading: false, data: <partial> }`, the onboarding gate (AUTH-GATE-1) read it as a real profile with every field missing, and the user was held on the legal / profile-completion screen for the length of the server round-trip. Timing-dependent — it reproduced on every webkit-mobile `@critical` spec and vanished under instrumentation — which is why the fix belongs at the source and not behind a longer wait. |
| **BOOT-HYDRATION-10** | **No boot-time message reads.** Nothing at app start reads a chat's messages from the server; `CacheWarmer` subscribes to the bounded collections (chats, contacts, flashcards) and primes the in-memory live-tail cache from IndexedDB only (`getDocsFromCache`, free). Message docs reach the device cache through the open chat's live tail and older pages, and through the chat-list preview's one-doc read (BOOT-HYDRATION-11). |
| **BOOT-HYDRATION-11** | The chat-list preview for a chat resolves from that chat's **live tail** when the live tail is live (BOOT-CACHE-5) — its newest doc is the chat's newest message, delivered in the same consistent snapshot as the chat doc's `lastMessageAt` — at zero reads. Otherwise it reads the one newest message (`getDocs … limit(1)`), once per `(viewer, chat, resolved language, lastMessageAt)`. |
| **BOOT-HYDRATION-8** | `bootCache` (`src/lib/bootCache.ts`) persists `onboardingComplete: boolean` alongside `uid` + `hasProfile`. The onboarding gate reads it synchronously before `authStore.ready` to render the app shell for a fully-onboarded returning user with no welcome/permissions/profile flash (AUTH-GATE-2). It is mirrored from the live gate result (AUTH-GATE-3) and reset to `false` on uid change (alongside `hasProfile`). Cross-ref auth-onboarding AUTH-GATE / AUTH-EDGE-4. |
| **BOOT-HYDRATION-12** | **The mirror is written once per doc VERSION, not once per emit.** `writeSnapshotCache` compares the serialised payload against what the key already holds and skips `localStorage.setItem` when they are equal. Metadata-only emits (`hasPendingWrites` flipping, cache→server confirmations of the same data) and a second consumer receiving the same snapshot therefore cost no storage write. The comparison is against the stored value itself, not an in-memory "last written" map, so an external clear (sign-out purge, quota purge, DevTools) is never mistaken for "already written". `setItem` is synchronous I/O on the main thread in every WebView, which is why this matters: the user doc emitted once per mounted `useUserProfile`, and a 50-bubble chat mounted ~100 of them. |
| **BOOT-HYDRATION-13** | **A cache miss is not a deletion.** When the live listener reports `exists() === false` with `metadata.fromCache === true` and no pending write, `useDocSnapshot` keeps the data it already holds (from the stage-1 mirror or an earlier snapshot) and leaves the in-memory doc cache alone. Only a SERVER snapshot (`fromCache: false`) or the app's own pending delete clears known data; with nothing known, the miss still resolves `{ data: null, loading: false }` as before. **Cause:** offline, with the doc absent from the SDK's local cache (the emulator harness's memory cache, or an evicted / recovery-cleared IndexedDB in production), the SDK answers the listener from cache with a non-existent doc. That wiped the `user:<uid>` profile the mirror had just painted, the onboarding gate (AUTH-GATE-1) read the null profile as a first run, and an offline cold boot put a fully-onboarded user on the "Before you start" legal screen, unmounting the chat and composer MSG-ROBUST-2 promises are usable with no network. Caught by `outbox-restart.spec.ts` once the harness could boot offline at all. |
| **BOOT-HYDRATION-14** | **Our own pending writes are not the collection.** While `useCollectionSnapshot` holds rows painted from the mirror (BOOT-HYDRATION-1) and nothing else has landed, a cache emit whose every doc has `hasPendingWrites` is overlaid on those rows by id instead of replacing them, and is written to neither the in-memory cache nor the mirror. The first emit that is not pending-writes-only (cache or server) replaces as normal, **including a server emit the SDK counts as metadata-only**: if the SDK's view already matched the overlaid pending docs, the server ack carries no doc changes, yet it is still the first word on the whole collection, so it replaces the mirrored rows (otherwise a chat deleted elsewhere stayed listed until the next content change). **Cause:** `ensureTutorChat` re-merges the tutor contact at every boot. With no local copy of the other contacts (evicted or recovery-cleared IndexedDB, or the harness's memory cache), the SDK's local view of the query is that one doc, which replaced the mirrored contacts, so every row fell back to `{phone} ~ {name}` until the server answered. Caught by `chatlist-first-frame.spec.ts`, 2026-10-27. Same family as BOOT-HYDRATION-9 and -13. |

---

## 1b. Cache layers — `BOOT-CACHE-*`

Every stale-data bug this app has had (BOOT-HYDRATION-9, the WS-1 "phantom
seed"/"clobber" findings in `useMessages`) was one cache layer disagreeing with
another (audit CPLX-APP-7). The list below is **closed**: a new layer is a spec
change here first, with a line saying what it holds that no existing layer can.

| # | Layer | Where | Holds | Persists | Reset by |
|---|---|---|---|---|---|
| 1 | Firestore SDK cache | IndexedDB (SDK-owned) | every doc the SDK has seen | yes | never by us (SDK) |
| 2 | In-memory snapshot cache | `lib/snapshotCache.ts` | parsed collections (schema x resetKey) with a **live** flag while a server-synced listener holds them (BOOT-CACHE-5), parsed docs (path), **derived** per-view values (`derivedCache(name)` — today only the chat-list preview text) | no (tab lifetime) | `notifyViewerChange` (BOOT-CACHE-3) |
| 3 | localStorage snapshot mirror | `lib/localCache.ts` — `wurld.snap.v1.*` | bounded collections + the user doc (BOOT-HYDRATION-5) and the persisted previews (`previews` key) | yes | sign-out / delete (`purgeAllSnapshotCaches`, BOOT-QUOTA-2) |
| 4 | Boot snapshot | `lib/bootCache.ts` — `wurld.boot.v2` | uid, hasProfile, onboardingComplete | yes | uid change (BOOT-HYDRATION-8) |

Removed 2026-09-30: `lib/syncCache.ts` (`wurld.sync.v2.<uid>`), the per-chat
watermarks behind `CacheWarmer.syncChatMessages` — see BOOT-HYDRATION-10.

Not a data cache and deliberately not listed: the `uiStore.viewSettings`
mirror of the chat doc (CPLX-APP-8), which is being replaced by a
ChatScreen-level provider, and the Zustand UI stores.

| ID | Invariant |
|---|---|
| **BOOT-CACHE-1** | The table above is the complete set of client-side caches of Firestore data. React Query is not a layer (removed, DEAD-7); a module-private `Map` of Firestore-derived data outside `snapshotCache` is a violation — it escapes the reset in BOOT-CACHE-3. |
| **BOOT-CACHE-2** | Derived per-view values (a string computed from a doc, keyed by viewer + inputs) live in `snapshotCache.derivedCache(name, max)` — an LRU by write order — not in a consumer's own module. The consumer keeps its key shape and its persistence rules; the store and its lifecycle are shared. |
| **BOOT-CACHE-3** | There is **one** auth-transition signal for caches: `authStore`'s `onAuthStateChanged` calls `snapshotCache.notifyViewerChange(uid)`. Leaving a signed-in user (sign-out or account switch) clears the doc, collection and derived caches before any listener runs. A cold boot (`null -> uid`) clears nothing — what stage 1 painted is this user's — and `onViewerChange` listeners decide what to re-hydrate (the preview cache restores this viewer's persisted rows and drops everyone else's). No other module registers `onAuthStateChanged` to manage a cache. |
| **BOOT-CACHE-4** | Superseded versions of our own storage keys are purged once at boot (`purgeStaleStorageKeys()` from `main.tsx`): any `wurld.boot.v<N>` other than the current version and any `wurld.snap.v<N>.*` other than the current prefix, and every `wurld.sync.*` key (the retired watermark store). A version bump therefore reclaims the old bytes instead of orphaning them for the life of the install. Only keys under a prefix this spec owns are touched. |
| **BOOT-CACHE-5** | A cached collection is **live** while at least one `useCollectionSnapshot` listener holds it AND that listener's latest emit came from the server (`fromCache === false`); `snapshotCache.readLiveCollection` returns it only then. A cache entry left by an unmounted screen, or one that has only been served from IndexedDB, is never live. This is what lets a reader that needs the *current* state of a query (the chat-list preview, BOOT-HYDRATION-11) use the cache without a read of its own. |
| **BOOT-CACHE-6** | **Only the listener that holds a live entry writes it.** A cache-only read that lands while the entry is live is dropped: `CacheWarmer`'s `getDocsFromCache` prime (BOOT-HYDRATION-10) and a listener's own stage-1 eager cache read that resolves after its first server emit. Both are snapshots of the device cache taken at the moment the read STARTED; on a device (IndexedDB, persistent cache) they take long enough for the live tail to emit newer messages in between, and the late write then put an older array behind the live flag. `readLiveCollection` handed that array to the chat-list preview as current, the preview pinned the previous message as final for the new `lastMessageAt`, and the row lagged one message behind until a restart (CHATLANG-LIST-4, 0.3.1 backlog #7; 2026-10-15). `snapshotCache.writeCollectionCacheUnlessLive` is the one write for non-listener sources. Tests: `snapshotCache.test.ts`, `messageCachePrime.test.ts`, `useCollectionSnapshot.test.ts` (`BOOT-CACHE-6 — …`). |

---

## 2. Firebase init order — `BOOT-INIT-*`

Three boot-time mitigations in `src/lib/firebase.ts` get Firestore's IndexedDB cache reads firing within ~100ms even on EDGE. Without them, a stale cached ID token + popup-redirect-resolver script load + Firestore's blocked async queue stacked to ~70 seconds on slow networks before any data appeared.

| ID | Invariant |
|---|---|
| **BOOT-INIT-1** | `installFetchGuard()` runs at module top, BEFORE `initializeApp` / `initializeAuth`. While the guard is active, any `fetch` whose URL contains `/accounts:lookup` rejects with `TypeError('Failed to fetch')` immediately. Auth maps that to `NETWORK_REQUEST_FAILED` and keeps the cached user (instead of waiting up to 60s for the lookup to time out). Scope: only `/accounts:lookup` is blocked; sign-in paths and token refresh are unaffected. |
| **BOOT-INIT-2** | Auth initialises via `initializeAuth(app, { persistence: [...] })` directly, WITHOUT `browserPopupRedirectResolver`. The default resolver proactively loads `apis.google.com/js/api.js` (~23s timeout on EDGE) to prepare OAuth popup flows we don't use. |
| **BOOT-INIT-3** | `navigator.onLine` is spoofed to `false` at module load (before `initializeFirestore`). With it false, Firestore's connectivity monitor skips opening the watch stream and serves `getDocsFromCache` immediately. The spoof closes when Auth fires (+300ms grace) or a 3s safety timeout — whichever comes first. On restore the code dispatches `'online'` for external listeners (OfflineBar) while suppressing Firestore's `disableNetwork/enableNetwork` nudge listener so it doesn't interrupt in-flight cache reads. |
| **BOOT-INIT-4** | The cached ID token may be stale (1h TTL). Firestore lazy-refreshes it on demand via `securetoken.googleapis.com` *after* the cache reads have painted, so user-visible boot is fast even when the network is still slow. |

### Combined boot order

```
1. installFetchGuard()              // intercepts accounts:lookup
2. initializeApp(config)
2b. initAppCheck(firebaseApp)       // APPCHECK-4: synchronous, returns void,
                                    // no-ops entirely without a site key
3. initializeAuth({ ...no popupRedirectResolver })
4. spoof navigator.onLine = false; dispatch 'offline'
5. onAuthStateChanged(auth, () => restore('auth-ready'))
6. setTimeout(restore, 3000)        // safety net
7. initializeFirestore(...)
```

---

## 2b. Shared subscriptions — `BOOT-SHARE-*`

`useDocSnapshot` and `useCollectionSnapshot` do not dedupe: every hook instance
opens its own `onSnapshot`, parses every emit, and re-renders its component.
That is fine for a screen-level read and ruinous for a per-row one. The rule is
that a document or query the whole screen needs is subscribed ONCE, by a
provider, and read through context. The hooks keep their signatures: under a
matching provider they read the shared value and pass a `null` path to their
own subscription (which then opens nothing); outside one they subscribe as
before, so a component mounted off the tree (a unit test, another screen)
still works.

| ID | Invariant |
|---|---|
| **BOOT-SHARE-1** | **One `chats` query for the signed-in user.** `ChatsProvider` (`src/contexts/ChatsContext.tsx`) is mounted by `AppShell` and owns the single `chats where members array-contains uid` listener (plus its `users/{uid}` read for LANG-SET-3.1). `useChats(uid)` under it — `CacheWarmer`, `Sidebar`, `ChatListScreen`, `ChatScreen`, `useUnreadBadge`, `useChatLanguages`, `ShareTargetScreen` — returns the provider's memoised value and opens no listener. A `uid` that does not match the provider's falls back to its own subscription. |
| **BOOT-SHARE-2** | **The app-icon badge + NOTIF-3 clear sync mount once.** `useUnreadBadge` runs in `AppShell`, not in `ChatListScreen` and `Sidebar` (which were both mounted at `lg:`+ on `/`, doubling every badge write and clear sweep). Side effect, intended: the badge now tracks unread counts on every authenticated screen, not only while a chat list is mounted. |
| **BOOT-SHARE-3** | **One `chats/{id}` and one `users/{me}` listener per open chat, whatever the bubble count.** `ChatScreen` mounts `ViewerProfileProvider` (`users/{me}`) and `ChatDocProvider` (`chats/{id}`) around the whole screen — header, list, composer and sheets. `useUserProfile(me)` and `useChatSettings(id, …)` inside read the providers. So `MessageItem`, `TTSButton` (via `InlineMessageTTS`), `MessageInput`, `ChatHeader`, the typing indicator and `ChatScreen`'s own logic share two listeners. `useFireSetupMilestone` (mounted per bubble) no longer holds a `tutorMemory` listener at all: it reads the tour state once, when a milestone fires (`readTutorSetupState`). Asserted by a listener-count test rendering 50 real `MessageItem`s. |
| **BOOT-SHARE-4** | **Typing presence does not re-render the chat.** `chats/{id}.typing` stays on the chat doc (TYPING-2 pins it there — see typing-indicator.md § Design decisions), but `ChatDocProvider` splits it out: the chat value it shares has `typing` removed and keeps its object identity across any emit whose remaining content is unchanged, and `typing` travels on a separate `ChatTypingContext` read only by `usePeerTyping` / `useTypingIndicator`. A peer's keystroke therefore re-renders the typing indicator's owner, not every bubble, the header and the composer. The decay clock ticks only while a peer is fresh (one timeout at the latest expiry), never on an idle 1 s interval. |
| **BOOT-SHARE-5** | **Bubbles and the header read the view settings from ONE source in ONE render.** `ChatScreen` resolves the chat's effective view settings (MSG-VIEW-7) and publishes them on `ChatViewSettingsContext`; `MessageItem` reads that context. The `uiStore.viewSettings` mirror, which `ChatScreen` copied into in an effect — so bubbles painted one commit after the header — is deleted. Off the chat tree the context yields `DEFAULT_VIEW_SETTINGS`, the mirror's old initial value. |
| **BOOT-SHARE-6** | **The desktop `Sidebar` is not mounted below `lg`.** `AppShell` gates it on `useIsWide()` (`matchMedia('(min-width: 64rem)')`, Tailwind's `lg`) as well as UI-DESKTOP-6's chat-section rule. It used to be mounted and `hidden` by CSS on every phone, running its contacts, profile, preview and avatar lookups for a list nobody could see. |

---

## 3. Quota defence — `BOOT-QUOTA-*`

| ID | Invariant |
|---|---|
| **BOOT-QUOTA-1** | `lib/localCache.ts` wraps `setItem` in try/catch. On `QuotaExceededError` it calls `purgeAllSnapshotCaches()` (clears only `wurld.snap.*` keys; leaves the rest of localStorage alone) and retries the write once. If the retry still fails the write is silently dropped — the running session keeps working, the next cold-boot just loses the fast-paint optimisation. |
| **BOOT-QUOTA-2** | Sign-out calls `purgeAllSnapshotCaches()` alongside the existing `clearBootSnapshot` and `clearChatSyncState`. A different user on the same device starts clean — no stale flash of user A's profile for user B. |
| **BOOT-QUOTA-3** | If a mirrored doc fails `parseDoc` (e.g. the server-side schema changed and the cached entry no longer matches `ZTimestamp` / `ZFlashCard` / `ZUser`), the entry is silently dropped at read time. Same behaviour the Firestore SDK has against schema drift; no regression. |

---

## 3b. Pre-paint theme — `BOOT-THEME-*`

The theme attribute must be on `<html>` BEFORE the first paint, or a
returning user whose preference differs from the CSS default sees a
one-frame flash of the wrong theme on every app open.

| id | invariant |
|---|---|
| **BOOT-THEME-1** | A tiny synchronous inline `<script>` in `index.html` (in `<head>`, right after `<meta charset>`) sets `document.documentElement.dataset.theme` from `localStorage['wurld:theme']` BEFORE first paint — resolving `'system'` via `matchMedia('(prefers-color-scheme: dark)')`, falling back to `'light'` if storage is blocked. It mirrors `src/lib/theme.ts` (`STORAGE_KEY` + `resolveTheme`) exactly; `ThemeContext`'s effect re-applies the SAME value on mount (a no-op, no second flash). Guarded by `src/lib/theme.boot.test.ts`, which executes the real shipped script. |
| **BOOT-THEME-2** | The same script ALSO sets `documentElement.style.background` to the resolved `--color-bg` literal (light `#ffffff`, dark `#11101a`) and `style.colorScheme` to the resolved mode. The attribute alone only selects custom properties; the rule that consumes them (`html { background: var(--color-bg) }`) lives in `globals.css`, which is reached through the JS module graph — so until that stylesheet parses the page paints the UA canvas. `<meta name="color-scheme" content="light dark">` covers the case where the in-app theme matches the OS, but NOT the divergent one: a dark-mode user on a light OS flashed a full-viewport white on every launch. The literals must track `--color-bg`; a test asserts both sides stay in sync. |

Why not the React effect alone: `ThemeContext` reads the stored mode
synchronously but only writes `[data-theme]` inside a `useEffect`, which
runs AFTER React's first commit — one paint too late. `html { background:
var(--color-bg) }` defaults to the light value until the attribute exists,
so a dark-mode user flashed white. The pre-paint script closes that gap;
theme is intentionally NOT part of the `bootCache`/`localCache` hydration
(it needs to apply earlier than any React code runs).

## 3c. PWA shell delivery — `BOOT-SHELL-*`

> Stages 1–3 above describe how *data* paints. This section describes how the
> *app itself* — index.html plus the JS/CSS bundle — reaches the device. All
> three hydration stages are irrelevant until the shell has booted, so the
> shell is the true critical path on a cold start.

**Product target.** Opening the installed PWA is indistinguishable from opening
a native app: the shell paints from local storage with **zero** network
requests on the critical path, online or offline. Version checking happens
*after* the app is interactive, never before.

| ID | Invariant |
|---|---|
| **BOOT-SHELL-1** | The service worker serves **navigation requests** (`request.mode === 'navigate'`) from the precache, cache-first. A cold boot MUST NOT block on a network fetch of `index.html`. This applies to every in-scope URL — `/`, `/chat/<id>`, `/wurlds`, deep links from a push tap — all of which resolve to the single precached shell entry. |
| **BOOT-SHELL-2** | With no network at all, a cold boot renders the app shell and then hydrates from stage 1 / stage 2 (`BOOT-EDGE-2`). "Doesn't load offline" is a **bug**, not a degradation: if the shell is precached, it boots. |
| **BOOT-SHELL-3** | Freshness is the **service-worker update flow**, checked *after* the page is interactive — never before first paint. A new build ships a new SW script whose `install` precaches the new shell AND its hashed assets atomically before going to `waiting`, which raises the existing update prompt (`OBS-UPDATE-1/2/3/4`). The SW MUST NOT revalidate `index.html` independently of its assets: a shell cached out-of-band could reference hashed bundles that generation never precached, which is exactly the offline breakage this section exists to prevent. The page-side registration additionally calls `registration.update()` once, post-`load`, so a throttled browser update check can't leave a device pinned to an old build. |
| **BOOT-SHELL-4** | SW registration is owned by a **boot module** (`src/lib/swRegister.ts`), invoked from `main.tsx`, NOT by a React component. Registration must not be gated behind React mount, providers, routing or auth. It is deferred to the `load` event (or fires immediately if the document already loaded) so the install's precache fetches don't compete with first paint on a first visit. `UpdateAvailableToast` *subscribes* to the registration; it never creates one. **Native exception (OTA-13, [live-updates.md](./live-updates.md)):** in a native shell `registerServiceWorker()` returns `null` at once, before the `load` wait — the shell never registers a worker (Android's WebView would otherwise precache the shell and serve the previous bundle for one launch after every live-update swap or store update), and `unregisterServiceWorkersOnce()` removes any registration and its caches a pre-OTA build left behind, once, before the first live-update check. The shell's files are local and native push is the FCM plugin (NOTIF-8.1), so nothing in BOOT-SHELL-1..3 is lost there. |
| **BOOT-SHELL-5** | Exactly ONE service worker registration exists for the app. `firebase-messaging-sw.js` serves both push and precache duties; `notifications/setup.ts` MUST reuse the boot registration rather than calling `register()` a second time. |
| **BOOT-SHELL-6** | The precache is **build-scoped** (`wurld-precache-<BUILD_ID>`) and pruned on `activate`: caches for other builds are deleted, and entries in the current cache that are absent from the current manifest are removed. The precache can never grow unboundedly across deploys, and a stale asset can never be served after activation. |
| **BOOT-SHELL-7** | The `fetch` handler must not add latency to requests it cannot serve. Only navigations and URLs **present in the precache manifest** are intercepted; every other request (Firestore, Cloud Functions, Storage, cross-origin, non-GET) falls through untouched with no `caches.open()` round-trip. |
| **BOOT-SHELL-8** | Hosting cache headers must not defeat the above: the SW script itself (`/firebase-messaging-sw.js`) is served `no-cache` so update checks always hit the network, and content-hashed assets (`/assets/**`) are served `immutable` so a repeat visit never revalidates them. JS header rules must not overlap — Firebase Hosting applies every matching entry, so a blanket `/**/*.js` alongside a specific rule leaves the effective header ambiguous. |
| **BOOT-SHELL-10** | Content-hashed build output that is deliberately NOT precached is **runtime-cached** cache-first into a build-scoped `wurld-runtime-<id>` cache, pruned by the same `activate` sweep. Scope is narrow by construction — only paths under `/assets/` — so an API response can never land in it, and only `res.ok` bodies are stored (a hashed URL's 404 would otherwise be pinned for the life of the build). This is what lets the 81 per-locale i18n chunks (~8.5 MB, of which a user needs exactly one) leave the precache without losing offline support: the locale in use is cached the first time it loads, and `en` is in the main bundle so there is always a working fallback. |
| **BOOT-SHELL-11** | Precaching is best-effort **except for the shell**, which is mandatory: if `index.html` cannot be fetched (network fault) or comes back non-OK, `install` REJECTS and the generation never reaches `waiting`. Every other manifest entry that fails is skipped and the rest still precache. The asymmetry follows from BOOT-SHELL-6 — the prune is build-scoped, so activating a shell-less generation *deletes the previous generation's working shell on the way in*, taking offline boot away from a user who had it. A rejected install leaves the old worker in control and the browser retries on the next navigation, so the failure costs an update rather than the app. |
| **BOOT-SHELL-9** | Every cache read passes `{ ignoreSearch: true, ignoreVary: true }`. `ignoreVary` is **load-bearing**: precache entries are stored from a bare URL string, so the cached Request carries no `Accept-Encoding`, while every real browser asset request does — and Hosting serves assets with `Vary: Accept-Encoding`. Without it the spec's Vary comparison makes every asset lookup MISS, the handler silently falls through to `fetch()`, and offline the request dies with the asset sitting in the cache. Online the failure is invisible (just a wasted round-trip per asset), which is why it can only be caught by an offline run or a Vary-modelling test. |

**A navigation to a real FILE is never rewritten to the shell.** SPA routes carry
no file extension, so a path that has one (`/THIRD_PARTY_LICENSES.html`, opened
as a plain link from Settings) is served as itself — from the precache if it's
there, otherwise from the network. Without that discriminator the shell
fallback silently replaces such a page with the app.

**Why the previous implementation failed both goals.** The `fetch` handler did
`cache.match(req, { ignoreSearch: true })` against a precache keyed by
`/index.html`. `ignoreSearch` ignores the *query string* only — it does not
rewrite the path — so a navigation to `/` (or `/chat/x`) never matched, fell
through to `fetch(req)`, and Hosting served `index.html` with
`no-cache, no-store, must-revalidate`. Every cold boot therefore paid a full
network round-trip before a single byte of app code ran, and with no network
the navigation failed outright — the app could not open offline even though
its entire bundle was sitting in the precache.


## 3d. Version gate — `BOOT-GATE-*`

> The floor itself (where it lives, how versions compare, the server-side 426)
> is [observability.md](./observability.md) `OBS-VERSION-7..11`. This section
> is when the client checks it and what the user sees.

| ID | Invariant |
|---|---|
| **BOOT-GATE-1** | **The check runs after first paint, before and independent of sign-in, and fails open.** `VersionGate` (mounted at the root of `App`, outside routing and auth) calls `getVersion` once per cold boot with a 5 s timeout and compares `frontendBuild.version` against `minSupportedVersion` (`isBelowFloor`, OBS-VERSION-8). Until the answer arrives the app renders normally — the check is never on the critical path (BOOT-SHELL-3). Offline, a timeout, a non-OK response, a malformed body or a missing floor all leave the app running: **a cold boot with no network always boots** (BOOT-SHELL-2). The gate runs pre-auth so an old build cannot be used to sign up or sign in either. |
| **BOOT-GATE-2** | **Resume re-checks, cheaply.** When the app becomes active again (`useAppActiveStore`) and the last completed check is at least `VERSION_RECHECK_MS` (30 min) old, the check runs again. A long-lived PWA tab or a native app that is only ever resumed would otherwise never see a floor raised after its launch. Short foreground/background flips cost nothing. |
| **BOOT-GATE-3** | **Below a floor, a blocking "Update required" screen replaces the whole app tree** (`data-testid="version-gate-screen"`) — routes, effects and listeners unmount, so the old build stops writing. Copy is translated (`versionGate.*` keys). **Two floors raise it** ([live-updates.md](./live-updates.md) D8): the **bundle floor** (`minSupportedVersion` — this check, or a 426 from any function, OBS-VERSION-11) blocks at once; the **native floor** (`minNative[platform]`, OTA-6 — the live-update runner measures the shell against it and writes `useLiveUpdateStore.nativeFloor`) first shows a dismissible prompt **once per launch** (`data-testid="native-floor-prompt"`, `role="dialog"`: "A newer version of Wurld is available", Update / Later; the dismissal is in memory, never persisted, and the app keeps running underneath), and becomes this blocking screen once `enforceAt` passes (absent `enforceAt` = block at once). A bundle-floor block is never softened to a prompt. The one action depends on the runtime, asked through `appUpdateChannel()` in `lib/capabilities.ts` (never a platform check), and on the device's channel (`useLiveUpdateStore.channel`, else the channel baked into the bundle) — `updateTargetFor()` in `lib/versionFloor.ts`: **`app-store`** (iOS shell) opens **TestFlight** (`itms-beta://`) on the **beta** channel and the App Store listing **`id6818663954`** otherwise, **`play-store`** (Android shell) opens the Play listing on either channel, **`web-reload`** (browser tab and installed PWA) runs `checkForUpdateAndApply` (OBS-UPDATE-5) so a waiting service worker is activated rather than reloading into the same precached build, and reloads if there was nothing to apply. In a live-update runtime a 426 first starts the bounded self-heal (OTA-12 / D9, `reportUpgradeRequired` → `selfHealAfterUpgradeRequired`, once per page load): while it runs the button is disabled and reads **"Updating…"** (`versionGate.updating`); if it fails, the store / TestFlight action returns. There is no dismiss. |

---

## 3d. Code splitting — `BOOT-SPLIT-*`

> The shell (§3c) is the critical path; the size of the JS it has to parse
> before first paint is the other half of that path. Every screen used to ship
> in one ~1.6 MB entry chunk (audit CPLX-APP-16), so a cold WKWebView parsed
> the life-sim engine, the admin panel and the practice planner before it could
> draw the chat list.

| ID | Invariant |
|---|---|
| **BOOT-SPLIT-1** | Screens that are not on the first-paint path are **route-level lazy chunks** (`React.lazy`, declared in `src/lazyScreens.ts`): Wurlds (`LifeOverviewScreen`, `LifeStartScreen`, `LifeScreen`), `AdminScreen`, the practice family (`PracticeHubScreen`, `PracticeStartScreen`, `PracticeScreen`, `ProgressDashboardScreen`), `CardsScreen`, `ChatInfoScreen`, `CreateGroupScreen`, `AddGroupMemberScreen`, `ShareTargetScreen`. The first-paint set stays static: `ChatListScreen`, `ChatScreen` (a push tap boots straight into it), the onboarding/login screens, and the two remaining tabs (`ContactsScreen`, `SettingsScreen`). Exceptions on the auth path (AUTH-ACCOUNT, 2026-10-02): `VerifyPhoneScreen` and `AddEmailScreen` are lazy (each is seen once per account), and the sign-in methods inside `LoginScreen` load through `LazySignInMethods` (its frame paints at once; the methods and the provider code are a chunk) — almost every boot is a signed-in user, and the boot set had no room for them under BOOT-SPLIT-5. `routes.tsx` imports no lazy screen statically, and no other module may import one statically either — a single static importer silently folds the chunk back into the entry. |
| **BOOT-SPLIT-2** | Each nav slot renders its route inside its own `<Suspense fallback={<CenteredSpinner />}>`, so a slot waiting on a chunk never blanks the other slot of a transition (NAV-ANIM-2) or the AppShell chrome. After the app shell mounts, the chunks of the lazy screens a user commonly reaches (cards, practice, chat info, group screens) are **prefetched on idle**, so in practice a navigation finds its chunk already evaluated and the fallback is never seen. Wurlds and Admin are not prefetched (beta- and role-gated). |
| **BOOT-SPLIT-3** | Every lazy chunk is in the service-worker **precache** (it is a hashed `assets/*.js` file, which the `injectManifest` glob covers). A lazy route opened offline for the first time resolves from the precache exactly as the entry chunk does (BOOT-SHELL-2). Only the per-locale chunks under `assets/i18n/` are exempt (BOOT-SHELL-10). |
| **BOOT-SPLIT-4** | A module that is loaded with a dynamic `import()` is **not also imported statically** anywhere in `src/` — the bundler cannot split it, so the dynamic import only adds a round-trip (`INEFFECTIVE_DYNAMIC_IMPORT`). The CI budget step fails the build on that warning. |
| **BOOT-SPLIT-5** | The **initial JS** — the entry chunk plus every chunk `index.html` modulepreloads — has a gzip budget enforced in CI by `scripts/bundle-budget.mjs`, alongside a separate budget for the entry chunk alone. The budgets sit a small margin above the measured size, so a regression that re-inflates the entry fails CI instead of passing under a stale ceiling. |
| **BOOT-SPLIT-6** | **No Life code in the boot set.** Nothing statically reachable from `src/main.tsx` lives under `src/lib/life/` or `src/screens/LifeScreen/`. The app-wide Gemini client (`lib/gemini.ts`) reports each call to a seam, `lib/geminiCallSink.ts` (`emitGeminiCall` / `onGeminiCall`), and the life-sim telemetry buffer subscribes to it when its module loads — the dependency points from Life to the client, never back. Every life caller loads telemetry (via `life/debugLog`) before its first call, so no life call goes unrecorded. Asserted by a static walk of the entry's import graph (`src/lazyScreens.static.test.ts`). |
| **BOOT-SPLIT-7** | **The boot set is a handful of chunks, not dozens.** Only modules in the entry's static graph (Rolldown's `$initial` tag) are grouped, by `build.rollupOptions.output.codeSplitting` in `vite.config.ts`: `vendor-react` (react, react-dom, react-router, scheduler), `vendor-firebase` (firebase, @firebase, idb), `vendor` (every other initial package, Sentry included), `app-core` (the app's own boot modules, which Rolldown keeps in the entry chunk), and `en` on its own (it is globbed as well as statically imported, so inside the entry its glob import would break BOOT-SPLIT-4). Lazy chunks keep the default splitting, so no lazy-screen code rides into a boot chunk. CI fails on more than 8 initial chunks (`--max-initial-chunks`). |
| **BOOT-SPLIT-8** | **Firebase code the first paint never runs is not in the boot set.** `firebase/messaging` (web push) and `firebase/analytics` are loaded with a dynamic `import()` when first used, never imported statically from `src/`. `re2js`, which `@firebase/firestore` >= 12.14 bundles only for the Pipelines `like` / `regex_*` evaluators, is aliased in `vite.config.ts` to a stub (`src/shims/re2js.ts`) that throws; every Firestore call site catches that and returns an error result. The app uses no Pipelines. Asserted by `src/bootVendor.static.test.ts`. |

---

## 4. Edge cases — `BOOT-EDGE-*`

| ID | Edge case |
|---|---|
| **BOOT-EDGE-1** | A user signs out and a different user signs in on the same device. The localStorage mirror is wiped on sign-out (`BOOT-QUOTA-2`). The new user mounts with no stage-1 data; stage 2 catches them via Firestore's IndexedDB cache if previously signed in. |
| **BOOT-EDGE-2** | Cold-boot offline (no network at all). Stage 3 never fires; the user sees stage-1 data and operates against Firestore's IndexedDB cache. Writes queue locally (per-feature outbox specs handle this). |
| **BOOT-EDGE-3** | A returning user has localStorage data but no Firestore IndexedDB cache (e.g. cleared via DevTools). Stage 1 paints instantly; stage 2 misses; stage 3 fires once auth resolves and overwrites stage 1. No spinner. |
| **BOOT-EDGE-5** | A chat never opened on this device, opened offline. Its newest message is in IndexedDB (the preview read it, BOOT-HYDRATION-11), so the chat opens on that message; the rest of its history loads when the device reconnects. This is the price of BOOT-HYDRATION-10 and is accepted — see *Why no boot-time message sync*. |
| **BOOT-EDGE-4** | A new user (no localStorage, no Firestore cache) cold-boots. Stage 1 misses; stage 2 misses; stage 3 paints once it fires. A "Loading…" affordance is acceptable here — it's a first-run cost. |

---

## 5. Design decisions

### Why two caches for the same data?

Firestore already has an IndexedDB cache. We layer a `localStorage` mirror on top for the synchronous-first-paint property: IndexedDB reads are async (effect-time), localStorage reads are synchronous (mount-time). For the profile check in `routes.tsx` that runs on first render, that distinction is the difference between a clean paint and a `ProfileSetupScreen` flash.

The mirror is opt-in (cacheKey) precisely because we DON'T want to mirror messages — chat history is unbounded and would blow the 5 MB localStorage quota. The mirror is for bounded collections only.

### Why no boot-time message sync (2026-09-30, CPLX-APP-5)

`CacheWarmer.syncChatMessages` pre-fetched message history for every chat so a
chat never opened on this device would still open offline. Its cost, per
the repo's own cost model: on first launch `getDocsFromServer(limit 50)` for
**every** chat — 50 x N billed reads that bypass the cache by construction —
and on every later launch `getDocsFromServer(createdAt > watermark)` for every
chat with activity, i.e. **every message received since the last launch was
read a second time**, although the live tail reads the same docs when the chat
is opened and the preview had already read the newest one. First install was
≈ 52N + C + F + 51 reads; it is now ≈ 2N + C + F + 51 (the preview read plus
the live tail of the one chat actually opened), and a warm relaunch drops from
≈ 2 x (new messages) to ≈ (chats with new activity).

What is given up is BOOT-EDGE-5: a chat nobody opened on this device shows only
its newest message when opened offline. Weighed against the alternatives —
background-only sync skipping the open chat still pays the 50N first-install
read and the relaunch double-read for every *other* chat, which is where the
bill was — deleting it is the only option that removes the cost rather than
moving it. No invariant required the sync (it was never specified). Revisit if
offline-first history for unopened chats becomes a product requirement; the
answer then is a bounded, opt-in sync of the top few chats by recency, not all
of them.

### Why the chat list mirror landed late (2026-10-27)

BOOT-HYDRATION-4/5 promised a first-frame chat list from day one, but only `useDocSnapshot` ever implemented the mirror: `useCollectionSnapshot` went straight to `getDocsFromCache`, on the belief that IndexedDB was "fast enough". It isn't fast enough to beat the first paint. On a device the read resolves a beat after the app shell is drawn, so the list visibly popped in on every cold open (owner report, 2026-10-27, iOS native and PWA). CHROME-SPLASH-3 already relied on stage 1 painting inside the first commit, so the fix was to build the mirror, not to hold a splash for Firestore. Holding the splash would have tied every launch to the slowest read and lengthened an offline cold boot.

Flashcards were dropped from the list: a deck grows without limit (each card carries translations and examples) and is not on the launch screen, so the localStorage quota is better spent on chats and contacts. Revisit if the Cards screen ever becomes a launch target.

### Why the preview cache moved into `snapshotCache` (2026-09-30, CPLX-APP-7)

`useLastMessagePreview` kept a module-private `Map`, its own localStorage
persistence and its **own** `onAuthStateChanged` — a fourth auth listener next
to `authStore`, `firebase.ts` and `App.tsx`'s `onIdTokenChanged`. Two listeners
for one event can observe it in either order, which is how a cache ends up
keyed to a uid the rest of the app has already left. The store now lives in
`snapshotCache.derivedCache('previews')` and resets from the one viewer signal
(BOOT-CACHE-3); the key shape, language identity and persistence rules stay in
the hook because they are CHATLANG-LIST-2's business, not the cache's.
Alternative weighed: make previews a `useDocSnapshot` of a synthetic doc — no,
a preview is a function of (message, viewer languages), not a document, and
forcing it through a Zod schema would add a parse per row for nothing.
Revisit if a second derived value appears that needs cross-value invalidation;
`derivedCache` deliberately has none.

### Why three mitigations and not one?

The 70-second cold-boot on EDGE was three independent waits stacked:

```
t=0       app boots
t≈0       getAuth() registers a popup-redirect resolver,
          which proactively loads apis.google.com/js/api.js (script tag)
t≈23s     iframe script load gives up
t≈23s     Auth's _initializeCurrentUser calls accounts:lookup to
          validate the cached ID token
t≈83s     accounts:lookup socket times out
t≈83s     Firestore SDK's async queue unblocks; first getDocsFromCache
          finally runs (queued since ~t=0)
```

Each mitigation kills one wait. Removing any one of `BOOT-INIT-1/2/3` would re-introduce the corresponding stall.

### Trade-offs

- **Two stores for the user profile.** Firestore's IndexedDB cache + a 1 KB localStorage mirror. A stale-on-disk profile could show for a frame before the live snapshot overwrites; harmless.
- **Tied to Zod schema stability.** If a doc shape changes server-side and the cached entry fails `parseDoc`, the entry is silently dropped at read time (`BOOT-QUOTA-3`). No regression.
- **`navigator.onLine` spoof affects external listeners.** Mitigated by dispatching `'online'` events on restore and suppressing Firestore's nudge listener; external code (OfflineBar) reads the dispatched event, not the spoofed property.

### Why providers that the hooks read, rather than new hooks at every call site (BOOT-SHARE)

The alternative was to add `useChatDoc()` / `useViewerProfile()` and rewrite
every consumer to call them. That changes ~40 call sites and every unit test
that mocks `useUserProfile` / `useChatSettings`, and it makes each consumer
decide whether it is "inside a chat". Having the existing hooks consult the
provider keeps call sites and mocks untouched and makes sharing the default for
anything rendered under the screen. The cost is that the sharing is implicit —
a reader of `MessageItem` cannot see it — which is why the listener-count test
exists: it is the thing that fails if a refactor quietly reintroduces a
per-bubble subscription. Revisit if a consumer ever needs a DIFFERENT view of
the same doc than the provider gives (e.g. with `typing`); today only the
typing hooks do, and they have their own context.

Both chat-screen providers sit at `ChatScreen`, not `AppShell`, because the
user doc is small but not free to re-render the whole shell on, and the chat
doc is per-route. `ChatsProvider` sits at `AppShell` because its consumers span
screens (`CacheWarmer`, the sidebar, the list, share-target).

### If we ever want to cache messages or collections

Two questions to answer first:

1. **Is `getDocsFromCache` not fast enough?** With the three boot mitigations it should be. If a new slow path appears, instrument first.
2. **Is the data bounded?** localStorage is ~5 MB total. Chat history can run to MBs per chat × N chats. For unbounded data the answer is IndexedDB (e.g. `idb-keyval`) — quota is gigabytes on most platforms — with the same `readSnapshotCache` / `writeSnapshotCache` API on top.

### Why the boot set is grouped (2026-09-30, BOOT-SPLIT-7)

After the route split (BOOT-SPLIT-1) Rolldown gave every entry module that a lazy chunk also imports a chunk of its own: 55 `modulepreload`s for one cold boot (54 after BOOT-SPLIT-6), each a separate request, cache entry and precache row, with the smallest under 1 kB. Grouping with the `$initial` tag brings the boot set to 6 files (runtime, vendor-react, vendor, vendor-firebase, en, entry) and cuts initial gzip from 535.7 to 516.6 KiB (better compression across bigger files); the entry is 194.9 KiB gzip. Budgets moved to 530 / 205 KiB with an 8-chunk ceiling. Alternatives: one vendor chunk (fewer files, but a React bump would bust the Firebase cache entry too); `manualChunks` (deprecated in Rolldown, and it has no `$initial` tag, so shared lazy code could be pulled into boot). Revisit if a vendor group grows a dependency only lazy screens use — the tag keeps it out today, but a static import from the entry would move it in.

### Why the regex engine is stubbed instead of raising the budget (2026-10-02, BOOT-SPLIT-8)

The firebase JS SDK bump 12.13.0 → 12.19.0 grew `vendor-firebase` from 145.6 to 205.0 kB gzip and initial JS from 522.8 to 580.2 kB, over the 530 kB BOOT-SPLIT-5 budget. 141 kB minified of it was `re2js`, pulled in by Firestore Pipelines, which the app does not use; the rest is Firestore's own growth. Reverting the bump would have kept the app behind on SDK fixes, and raising the budget would have shipped ~57 kB of dead code at every cold boot. Stubbing `re2js` saved 43 kB gzip; deferring analytics and the web push SDK saved 10 kB more, landing at 528.0 kB without touching the budget. Revisit if the app adopts Pipelines (remove the alias and pay the cost), or if a future SDK makes re2js tree-shakable on its own.

### Why the budget was raised for the image viewer (2026-10-03, BOOT-SPLIT-5)

The image-viewer swipe work (IMG-VIEWER-14..16, `384649e5`) took the entry chunk from under 205 to 205.2 KiB gzip (210,113 B against 209,920 B) and initial JS to 529.3 KiB. `ImageViewer` is a static import of boot-set components (`EditableAvatar`, `ContactCard`, `ChatHeader`, `MessageMediaViewer`), so its new slide code (`ViewerPhotoSlides`, `useViewerSlides`) rides in the entry.

**Alternative rejected:** loading the viewer lazily. That would move ~1 KiB out of the boot set, but the first tap on a photo would wait on a chunk fetch and evaluation before the viewer opens. The owner ruled that out: opening a photo must stay instant.

**Decision (owner):** budgets raised to **entry 208 KiB / initial 533 KiB**, the same small margin above the measured size that BOOT-SPLIT-5 asks for. **Revisit** if the entry nears 208 again: look for boot-set code that is not first-paint (as BOOT-SPLIT-8 did) before raising it further.

### Why the budget was raised for 0.3.1 (2026-10-15, BOOT-SPLIT-5)

The 0.3.1 release work took the entry to 214.3 KiB gzip and initial JS to 539.6 KiB, already over 208 / 533. The Sentry coverage sweep (OBS-LABEL / OBS-COVER, PR #77) adds about 3 KiB to the entry: the labelling and reporting helpers are imported by `log.ts` and `errors.ts`, which every boot-set module uses. Measured on the merged tree: **entry 217.3 KiB, initial 542.9 KiB**.

**Alternative rejected for now:** trimming the boot set first. The release was blocked on it and the owner asked for the budget to be raised as the sweep advised.

**Decision (owner, 2026-10-15):** budgets raised to **entry 222 KiB / initial 548 KiB**, about 5 KiB above the measured size as before. **Revisit** before raising again: look for boot-set code that is not first-paint (as BOOT-SPLIT-8 did), starting with the Sentry helpers, which only matter once an error happens.

### Why the budget was raised again (2026-10-20, BOOT-SPLIT-5)

GitHub's runners did not start for several days, so the budget check did not run while the quiz and chat polish PRs (QUIZ-INB-5/6, MSG-BUBBLE-12.16, MSG-VIEW-3) and the XP release (#105) landed on `dev`. A local run of the CI steps found `dev` over budget: entry 233.7 KiB / initial 560.4 KiB before #105, **entry 236.0 / initial 563.9 KiB** after it, and **236.8 / 564.8 KiB** with per-language levels (#107, +0.8 KiB).

**Alternative rejected for now:** code-splitting the chat and quiz code back under 222 / 548 before merging. That would have held CI red with no fix ready, which hides every other regression.

**Decision (owner, 2026-10-20):** budgets raised to **entry 240 KiB / initial 568 KiB**, about 3 KiB above the measured size. **Revisit** before raising again: the quiz card and its builder (QUIZ-*) only matter once a message is sent, and the Sentry helpers only once an error happens; both are candidates for a lazy chunk.
