# Setting up Firebase for Wurlds

Nothing here is deployed yet. This is everything needed to run Wurlds against a
real Firebase project, in the order you would do it.

## 1. Pick a topology

Wurlds needs Auth, Firestore, Storage and Cloud Functions. There are two ways
to lay that out.

### A. Shared auth with Wurld (recommended if Wurlds ships "under the same organisation")

Wurld accounts sign straight in, and words saved in a wurld land in the same
flashcard deck the Wurld app shows.

- **Auth + Firestore + Storage:** Wurld's production project `wurld-e27d8`.
- **Cloud Functions + Hosting:** a new project, for example `wurlds-<something>`.
  This is the same split Wurld's own beta used (`wurld-beta` functions talking
  to `wurld-e27d8` data).

What it takes:

1. Create the new project and add it to `.firebaserc` (replace `YOUR_FIREBASE_PROJECT_ID`).
2. In `functions/.env.<new-project-id>`, set
   `LIFE_DATA_PROJECT=wurld-e27d8` and
   `LIFE_STORAGE_BUCKET=wurld-e27d8.firebasestorage.app`.
   `functions/src/firebaseConfig.ts` then points the Admin SDK at Wurld's data.
3. Give the new project's functions service account
   (`<project-number>-compute@developer.gserviceaccount.com`, gen2) these roles
   **on `wurld-e27d8`**: `roles/datastore.user` and `roles/storage.objectAdmin`.
   Wurld's beta needed the same grant.
4. **Rules.** Firestore and Storage rules are project-wide, so this repo's
   `firestore.rules` and `storage.rules` must **never** be deployed to
   `wurld-e27d8`; they would replace all of Wurld's rules. Instead, copy the
   `lifeWorlds` / `lifeProfile` block from this repo's `firestore.rules` and
   the `lifeAssets` block from `storage.rules` back into wurld-app's rule
   files, and deploy them from there. Wurld removed both blocks on 2026-10-28
   (they reach prod at its next rules deploy). Until they are back, clients
   get permission errors on every life read.
5. **Auth domain.** Add the Wurlds hosting domain to Authentication → Settings →
   Authorized domains on `wurld-e27d8`.
6. **Account deletion.** The `deleteLifeAccountData` Auth trigger does NOT
   fire here, because Auth lives in another project. Wurld's
   `cascadeDeleteUserData` still deletes `users/{uid}/lifeWorlds`,
   `users/{uid}/lifeProfile` and `lifeAssets/{uid}/` (kept on purpose on
   2026-10-28). If Wurld ever drops that, Wurlds needs another way to clean up.
7. **The phone rule.** Wurld requires a phone number on every account
   (AUTH-ACCOUNT-3); Wurlds does not (see `src/store/authStore.ts`). On a shared
   project, a Google or email account created through Wurlds has no phone, so
   Wurld will treat it as unfinished and ask for one if that person ever opens
   Wurld. Decide whether that is acceptable before launch.

### B. A project of its own

Simplest. A new Firebase project holds everything; nothing is shared with Wurld,
so Wurld accounts and flashcards do not carry over.

1. Create the project; put its id in `.firebaserc`.
2. Enable Authentication → Sign-in method → **Google** and **Email/Password**.
3. Create the Firestore database (Native mode) and the default Storage bucket.
4. Deploy rules and indexes: `npm run deploy:rules`.
5. The `deleteLifeAccountData` trigger cleans up life data when an Auth user is deleted.

## 2. Secrets and function config

Cloud Functions read two secrets. Both must exist before the first deploy,
because `geminiGenerate`, `geminiStreamV2` and `api` declare them:

```bash
firebase functions:secrets:set GEMINI_API_KEY   # Google AI Studio key
firebase functions:secrets:set OPENAI_API_KEY   # any value if you never route to OpenAI
```

Model routing: every prompt runs on Gemini by default. The Wurld app could route
some prompt categories to OpenAI ("Luna") through the Firestore doc
`config/runtime` (`functions/src/providerSwitch.ts`). That switch only turns on
for the project ids `wurld-beta` / `wurld-e27d8`; on any other project it stays
off, so a dummy `OPENAI_API_KEY` is fine.

`functions/.env.<project-id>` (committed, not secret) can also hold:

| Variable | Purpose |
|---|---|
| `LIFE_DATA_PROJECT` | Topology A only: the project that owns Auth / Firestore / Storage. |
| `LIFE_STORAGE_BUCKET` | Topology A only: that project's default bucket. |
| `ALLOWED_ORIGINS_EXTRA` | Comma-separated CORS origins for this app's hosting domains (`functions/src/httpShared.ts`). Without it, only localhost and Wurld's domains are allowed. |
| `API_MIN_INSTANCES` | Warm instances of the `api` function (default 0). |

For the emulator, put the keys in `functions/.secret.local`:

```
GEMINI_API_KEY=...
OPENAI_API_KEY=unused
```

## 3. Client environment

Copy `.env.example` to `.env.local` (gitignored) and fill in the web app config
from Firebase console → Project settings → Your apps → Web app. In topology A
the Firebase values are `wurld-e27d8`'s (same as Wurld's `.env.production`), and
only `VITE_FUNCTIONS_URL` points at the new project.

| Variable | Value |
|---|---|
| `VITE_ENV` | `dev`, `beta` or `prod`. `dev` logs to the console. |
| `VITE_FIREBASE_*` | The web app config. |
| `VITE_FUNCTIONS_URL` | `https://us-central1-<functions-project>.cloudfunctions.net`. In `npm run dev` the client calls `/__functions/...` and Vite proxies it here. |
| `VITE_USE_EMULATORS` | `true` to use the local Emulator Suite (then also set `VITE_FUNCTIONS_URL=http://127.0.0.1:5001/demo-wurlds/us-central1` and `VITE_FIREBASE_PROJECT_ID=demo-wurlds`). |
| `VITE_SENTRY_DSN` | Optional. Empty means no Sentry. |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | Optional, and off by default. See `docs/reference-specs/` and Wurld's `docs/specs/app-check.md`. |
| `VITE_FCM_VAPID_KEY` | Unused here (no push). |

For production builds put the public values in a committed `.env.production`.

## 4. Deploy (order matters)

Functions first, then hosting: the client sends `promptSpec`s that only the
current functions understand, and an older `geminiGenerate` answers
`400 "Missing prompt"` (Wurld's SRV-PROMPT-8..13 lesson).

```bash
npm run deploy:functions
npm run deploy:hosting       # builds, then deploys dist/
npm run deploy:rules         # topology B only, see 1A step 4
```

## 5. Things that are wired but point at Wurld

These came along with shared components and work only against Wurld's back end.
None blocks the life sim; each is a choice to make before launch.

- **Wurld Plus.** `src/lib/entitlement.ts`, `NeedsPlus`, `PlusSheet` and the
  purchase hooks read `users/{uid}.plan` and call Wurld's `stripeCreateCheckout` /
  the native store purchase plugin (`@capgo/native-purchases`). With shared auth, a Wurld Plus member is
  Plus here too. Buying from inside Wurlds does not work (those functions are
  not deployed here). Plus-gated bits in the life flow: the Explain modal's
  follow-ups and extra practice languages in the language picker.
- **Safety reports.** `src/components/Safety/ReportSheet.tsx` calls Wurld's
  `reportContent`.
- **Tutor / chat helpers** in `src/lib/tutor.ts`, `src/lib/translationFeedback.ts`
  are imported for types or shared helpers only.
