# Conventions

Coding rules for the repo. Most are machine-enforced (ESLint + tsc + filename-rules) — when in doubt, run the pre-commit hook locally with `npm run lint && npm run typecheck`.

## Hard rules

1. **No file over 600 LOC.** ESLint custom rule. Files over the cap become unmaintainable — split aggressively. If you're nearing 500, split before you push. Applies to `functions/src` too (its own ESLint block: Node globals, `console` allowed as the Cloud Logging API, `any` a warning — see [architecture.md](architecture.md#cloud-functions-modules)).

2. **No `Platform.OS`, no `react-native`, no `expo-*` imports.** `no-restricted-imports`. We have a single WebView runtime — branch on capabilities, not platforms.

3. **No `.web.ts` / `.native.ts` filename splits.** Filename-rules lint job. Same reason.

4. **No `Capacitor.isNativePlatform()` outside the allowlist.** The canonical allowlist is `CAPACITOR_NATIVE_ALLOWLIST` in `eslint.config.js` — keep this list in sync with it. Currently: `lib/runtime.ts`, `lib/capabilities.ts`, `lib/prefs.ts`, `lib/auth.ts`, `lib/splash.ts`, `lib/statusBar.ts`, `hooks/useKeyboardState.ts`, `hooks/useAndroidBackButton.ts`, `notifications/setup.ts`, `notifications/routing.ts`, `App.tsx`. Components ask `canUseX()` from `lib/capabilities.ts`.

5. **No `any`. No new `@ts-ignore` / `@ts-expect-error`** without a linked issue + expiry comment. TS `strict` + `noUncheckedIndexedAccess` stay on.

6. **Every `onSnapshot` lives in a typed hook with explicit unsubscribe.** Pattern: see `hooks/firestore/useDocSnapshot.ts`.

7. **All env config goes through `lib/config.ts`.** No `import.meta.env.VITE_*` direct reads anywhere else.

8. **All cross-runtime gating goes through `lib/capabilities.ts`.** `canUseContacts()`, `canUseNativeCamera()`, etc.

9. **All FCM `data` payload fields are strings.** Number / bool sneaks through → Android silently drops the notification.

10. **Cloud Function URLs are versioned in `lib/endpoints.ts`.** No URL string-concat at call sites. Use `callFunction` (Callable) or `callHttp` (onRequest) — never raw `fetch`.

11. **No business logic in `lib/*` or `services/*` without a Vitest test.** Components are visually tested (Storybook + screenshots).
    `src/lib/**/*.test.ts` and `src/store/**/*.test.ts` run in the `app-node` Vitest project, which uses the **node** environment with no jsdom. A test there that needs `window`, `document`, `localStorage` or `navigator` must make `// @vitest-environment jsdom` its first line. `.tsx` tests and everything else under `src/` stay in the jsdom `app` project. The split is in `vitest.config.ts` (audit CPLX-APP-14/15).

12. **No global mutable singletons except `firebase.ts` and Zustand stores.** No `let cache = ...` at module top level — use refs inside hooks or stores.

13. **Component files render only.** Data fetching in hooks. Side effects only inside `useEffect`.

14. **`setState` takes an updater function whenever the new value depends on previous.** React 19 batches more aggressively; stale closures bite.

15. **No `useEffect` without an explicit dependency array.** No exhaustive-deps disable without an inline justification.

16. **No `<img>` without `width`, `height`, `loading="lazy"`** (except above-the-fold).

17. **No `console.log` in source.** Use `src/lib/log.ts`. ESLint `no-console`.

18. **Imports absolute from `@/`.** Vite alias `@` → `src/`. Banned relative beyond `../`.

19. **Pre-commit runs `tsc --noEmit`, ESLint, and Vitest on the tests related to the staged files** (`vitest related`; the full suite when test config, setup, `package.json` or a `tsconfig` is staged, or with `WURLD_FULL_UNIT=1`). Husky + lint-staged. No bypass — `--no-verify` requires explicit user instruction.

20. **Every PR description ticks the same gates the hooks enforce**: typecheck clean, lint clean, unit tests pass, the relevant spec exists, the required E2E tier ran locally. Template at `.github/PULL_REQUEST_TEMPLATE.md`.

## Naming

- Hooks: `useThing.ts`, export named `useThing`.
- Lib helpers: `lib/topicName.ts`, named exports only.
- Components: PascalCase file, default OR named export (be consistent within a directory).
- Stores: `store/somethingStore.ts`, hook export `useSomethingStore`.

## Patterns

- **Snapshot hook pattern**: subscribe in `useEffect`, return `{ data, loading, error }`. Always clean up. See `useChats.ts`.
- **Firestore mutation pattern**: `await callHttp(...)` for HTTP functions, then optimistic `updateDoc` if needed. Don't write the doc directly when the backend has a function that does it atomically (the pipeline send is the canonical example).
- **Animation pattern**: prefer pure CSS keyframes + `animate-in fade-in` (tailwindcss-animate) for entrance / exit. Use `transition-[grid-template-rows]` `0fr ↔ 1fr` for auto-height animations.
- **Long-press + double-tap coexist**: pass `onClick` to `useLongPress`; it fires only if the press is released before threshold. Track timestamps for double-tap separately.
- **Modal lifecycle**: phase machine (`closed | in-start | open | out`) when you need a close animation. See `MessageActionsMenu`.

## Test selectors

E2E + component tests must stay stable across visual refactors. Prefer in order:

1. **`getByRole({ name: /…/ })`** when the element has a real role + accessible name. Best signal; doubles as an a11y check.
2. **`data-testid`** when no real role applies. Kebab-case, e.g. `data-testid="bubble-status-tick"`. Kept in production builds — the byte cost is trivial and the test stability is worth it.
3. **Never** select on Tailwind class names or computed styles — they change without warning during visual work.

## When you make a non-obvious decision

Append a **Design decisions** section to the relevant spec in `docs/specs/`. One screen of text is fine: the alternatives you weighed, the trade-offs, and the trigger for revisiting. Specs are the WHAT *and* the WHY — one doc per feature is the rule (no separate ADR directory). The future agent who asks "why is it this way?" will thank you.

If a decision is cross-cutting and doesn't fit any single feature spec, look at the infra specs (`cold-boot.md`, `i18n.md`, `observability.md`) for the right home — or start a new infra spec if none fits.
