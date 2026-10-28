# Design system (match the app)

The app was **completely restyled** after the split. The marketing site must match the *new* app so `wurld.chat → app.wurld.chat` feels seamless. Ignore the legacy repo's styling entirely.

> Source of truth: `~/wurld/src/styles/globals.css` (Tailwind 4 `@theme` block). Logos: `~/wurld/src/assets/brand/` and `~/wurld/public/`. When in doubt, read those files — values below are a snapshot (captured 2026-06-21) and the app evolves.

## Brand essence

- **Signature element: the gradient.** `linear-gradient(135deg, #7340f5 0%, #db53d7 100%)` (purple → pink). It's on every primary CTA in the app. The marketing site's primary buttons / hero accents should use it.
- **Purple accent** for links and secondary affordances.
- **System fonts**, no web fonts — instant render, native feel.
- Full **light + dark** theming via a `[data-theme="dark"]` attribute on `<html>`.

## Colour tokens

CSS variable names match the app's `@theme`. Copy these into a `tokens.css` for this repo.

### Light (default)

| Token | Value | Use |
|---|---|---|
| `--color-bg` | `#ffffff` | Page background |
| `--color-bg-elevated` | `#ffffff` | Cards / surfaces |
| `--color-bg-hover` | `#f3f4f6` | Hover, subtle fills |
| `--color-border` | `#e6e6ea` | Borders |
| `--color-border-strong` | `#d1d5db` | Stronger borders |
| `--color-fg` | `#111111` | Primary text |
| `--color-fg-muted` | `#6b7280` | Secondary text |
| `--color-fg-subtle` | `#9ca3af` | Tertiary text |
| `--color-accent` | `#9f4dde` | Links, system affordances |
| `--color-accent-hover` | `#8641bb` | Accent hover |
| `--color-gradient-accent-start` | `#7340f5` | Gradient start |
| `--color-gradient-accent-end` | `#db53d7` | Gradient end |
| `--gradient-accent` | `linear-gradient(135deg, #7340f5 0%, #db53d7 100%)` | **Primary CTA fill** |
| `--color-success` | `#0f8a5f` | Success |
| `--color-danger` | `#b00020` | Errors |
| `--color-warning` | `#f59e0b` | Warnings |

### Dark (`[data-theme="dark"]`)

| Token | Value |
|---|---|
| `--color-bg` | `#11101a` |
| `--color-bg-elevated` | `#1a1928` |
| `--color-bg-hover` | `#232234` |
| `--color-border` | `#2a293e` |
| `--color-border-strong` | `#3a3854` |
| `--color-fg` | `#f5f6f8` |
| `--color-fg-muted` | `#a0a4af` |
| `--color-fg-subtle` | `#6b7180` |
| `--color-accent` | `#a78bff` |
| `--color-accent-hover` | `#c1aeff` |
| `--color-success` | `#4ade80` |
| `--color-danger` | `#ff6679` |
| `--color-warning` | `#fbbf24` |

> The gradient (`#7340f5 → #db53d7`) is the same in both themes.

## Page layout

Standardised so every section lines up. Tokens live in `src/styles/tokens.css`.

| Token | Value | Applies to |
|---|---|---|
| `--max-w` | `1080px` | Every section container, the site header, and the footer. With 24px side padding this gives one shared left/right edge down the whole page. |
| `--max-w-narrow` | `720px` | The hero only — a wide centred hero reads badly. |
| `--measure` | `36rem` | Reading measure for running prose (~65 characters at 1rem). |

**Two rules that are easy to get wrong:**

1. **Prose is capped to `--measure` but aligned left, never centred inside its section.** Centring a 36rem column inside a 1080px section pushes its left edge ~48px inward, so its heading stops lining up with every other heading on the page. Use `margin: 0`, not `margin: 0 auto`.
2. **Pricing is the deliberate exception** — its eyebrow, heading and intro are centred, because the two plan cards read as a symmetrical pair and a left-aligned heading over them looks unbalanced. The cards reset to `text-align: left` internally. Don't "fix" this back to match rule 1.
3. **Legal pages set their own 720px** (`terms.astro`, `privacy.astro`) rather than using `--max-w`. That's deliberate — long-form policy text should not run to 1080px. Changing `--max-w` does not affect them.

The Revision and Adventure sections use a `.split`: copy and media side by side above 900px, media alternating sides (card right, phone left), stacking back to copy-then-media below it. DOM order is always copy-first so the mobile stack needs no reordering; only the media-left variant swaps with `order` at the breakpoint.

### Chat bubbles

Verified against `~/wurld/src/styles/globals.css` on **2026-08-05** (app `main` @ `10704ed`). These are a *separate* family from the accent gradient — **a message bubble is a flat colour, never the gradient.** The gradient is for CTAs, chips and toggles only.

| Token | Light | Dark |
|---|---|---|
| `--color-bubble-mine` | `#7e33ac` | `#3d275f` |
| `--color-bubble-mine-fg` | `#ffffff` | `#ffffff` |
| `--color-bubble-mine-underline` | `#c1a0d8` | `#74569b` |
| `--color-bubble-theirs` | `#f3f4f6` (= `--color-bg-hover`) | `#1a1928` |
| `--color-bubble-theirs-fg` | `#1e1e1e` | `#f5f6f8` |
| `--color-bubble-theirs-underline` | `#cdb3dc` | `#7169ad` |

`--color-bubble-mine` is **shared between chat and Wurlds** — the app's `LifeScreen/DialogueArea.tsx` renders the player's bubble with the same token as a chat bubble. Both demos on this site mirror it, using the *light* values because their mock phone screen is always light.

Consumers here: `src/components/demo/DemoBubble.tsx` (chat demo) and `src/components/demo/WurldsDemo.tsx` (Wurlds mockup). Re-check them whenever the app's palette moves; there is no automated sync.

> ⚠️ The comment block above these tokens in the app's `globals.css` still describes an older **teal** bubble scheme. It is stale — trust the token values, not the prose.

## Typography

System stack — no Google Fonts, no `@font-face`:

```css
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
--font-mono: ui-monospace, "SF Mono", Menlo, Monaco, monospace;
```

Custom type sizes the app overrides: `--text-md: 16px`, `--text-xl: 22px`, `--text-2xl: 28px`. Semibold (600) for buttons/CTAs. Use `max(16px, 1em)` on inputs to stop iOS Safari zoom.

## Radii

`--radius-xs: 4px` · `--radius-md: 10px` · `--radius-lg: 14px` · `--radius-xl: 18px`.

## Logos & brand assets

Canonical, current (in the new app):

| File | What | Notes |
|---|---|---|
| `~/wurld/src/assets/brand/wurld-logo-light.svg` | "WURLD" wordmark, **light theme** | Dark ink (`#1f1a23`). For light backgrounds. |
| `~/wurld/src/assets/brand/wurld-logo-dark.svg` | "WURLD" wordmark, **dark theme** | Off-white (`#feffff`). For dark backgrounds. |
| `~/wurld/public/favicon.svg` | Brand icon (gradient mark), 1024² | Favicon / app mark. |
| `~/wurld/public/icon-192.png`, `icon-512.png` | PWA icons | |
| `~/wurld/public/apple-touch-icon.png` (180²) | iOS home-screen icon | |
| `~/wurld/public/icon-maskable-{192,512}.png` | Maskable PWA icons | |
| `~/wurld/public/icons/icon-{48..512}.webp` | WebP icon set | |
| `~/wurld/public/gradient.png` | Raster gradient overlay | |

**Action for this repo:** copy the two wordmark SVGs + `favicon.svg` (+ a couple of PNG icons for OG/social) into `public/brand/`. The current `index.astro` references `/favicon.svg` which does not exist in this repo yet — copying `favicon.svg` over fixes that. Pick the wordmark by theme (swap on `[data-theme]`). The legacy `logo.png`/`logo-w.png` in `~/src/wurld` are **dead** — do not use.

## Theming mechanism (mirror the app)

The app sets `document.documentElement.dataset.theme = 'light' | 'dark'` in a pre-paint inline script in `index.html` (reads `localStorage['wurld:theme']`, falls back to `prefers-color-scheme`) to avoid a flash, then dark tokens apply via the `[data-theme="dark"]` selector. Mirror this: an inline head script in the Astro layout + tokens scoped under `[data-theme="dark"]`. Also set the `theme-color` meta tags (`#ffffff` light / `#0a0a0a` dark).

**As implemented in this repo:** the header toggle is **3-way — automatic / light / dark — defaulting to automatic** (system). `localStorage['wurld:theme']` stores `'system' | 'light' | 'dark'`; the pre-paint script in [Layout.astro](../src/layouts/Layout.astro) resolves it and also sets `data-theme-mode` (used to pick the toggle icon). In automatic mode a `matchMedia` listener keeps `data-theme` in sync with the OS live. `color-scheme` is set per theme in `tokens.css` so native scrollbars/controls follow dark mode, plus a custom scrollbar style. The header's sign-in state is an **auth-aware React island** ([AuthMenu.tsx](../src/components/auth/AuthMenu.tsx)): "Sign in" when signed out; avatar (Firestore `thumbUrl`/`photoURL`, else gradient initial) + name + a dropdown (Manage plan / Sign out) when signed in.

## UI primitives reference

The app uses a shadcn/ui-flavoured setup (`~/wurld/components.json`, "new-york" style, lucide icons, Tailwind 4 via `@tailwindcss/vite`, no `tailwind.config.js` — tokens live in `@theme`). Useful components to mirror visually:

- **Primary CTA** — gradient fill + `box-shadow: 0 4px 12px -2px rgba(115,64,245,0.4)`, white text, rounded, semibold. (`~/wurld/src/components/ui/PrimaryGradientButton.tsx`)
- **Secondary CTA** — gradient *border* + tinted fill. (`SecondaryGradientButton.tsx`)
- **GradientSurface** — gradient bg with per-key `hue-rotate()` for varied avatar tints.

For this repo you don't need the whole library — recreate the button look with the gradient token and the shadow above. If you add Tailwind here, use Tailwind 4 the same way (the `@tailwindcss/vite` plugin works under Astro too) so class names and tokens line up with the app.

## Animations (selected, from the app)

Page transitions ~280ms `cubic-bezier(0.32, 0.72, 0, 1)`; popovers/toasts ~200ms. The marketing demo's own keyframes are listed in [marketing-content.md](marketing-content.md). Everything must respect `prefers-reduced-motion: reduce`.
