/**
 * Navigation hierarchy — NAV-PARENT-* (docs/specs/navigation.md).
 *
 * `resolveParent(pathname)` returns the PARENT route a "back" action should go
 * to, derived PURELY from the current path string — never from history. This is
 * what makes back deterministic:
 *  - circular routes can't trap you (chat-media → image-viewer → go-to-message
 *    → chat, then back → chat LIST, because the resolver only sees `/chat/:id`
 *    and returns `/`, regardless of how you arrived); and
 *  - a cold deep-link (push notification → `/chat/:id` onto an empty history)
 *    still has a real parent, so back can NEVER land on a blank page
 *    (NAV-BACK-EMPTY-1).
 *
 * The map mirrors the route tree in `src/routes.tsx`. Rules are ordered
 * most-specific first; the first match wins. Unknown paths fall back to `/`
 * (the app root) so back is always defined. `/` itself returns null (root —
 * back is a no-op / app-minimise on native).
 */

type Rule = { re: RegExp; parent: string | ((m: RegExpMatchArray) => string) };

/**
 * NAV-PARENT-3 — the paths that render the contact screen (CONTACTS-VIEW-1),
 * as a regex source. The edit / add-contact forms nest under any of them.
 */
const CONTACT_SCREEN_SRC = [
  '/chat/[^/]+/member/[^/]+',
  '/contacts/view/[^/]+',
  '/profile/[^/]+',
].join('|');

// Ordered: deepest / most-specific first. Trailing-slash tolerant.
const RULES: Rule[] = [
  // NAV-PARENT-3 — the forms a contact screen opens are nested UNDER it, so
  // back (and save) return to the screen they came from. The contact screens:
  // a group member or a 1:1's View contact (`/chat/:id/member/:uid`), a
  // Contacts-list entry (`/contacts/view/:contactId`) and the legacy
  // `/profile/:uid`. (The 1:1 chat info stopped being one: CONTACTS-VIEW-6.) Checked FIRST: each is a strict extension
  // of a path the rules below also match.
  { re: new RegExp(`^(${CONTACT_SCREEN_SRC})/(?:edit/[^/]+|add-contact)/?$`), parent: (m) => m[1] ?? '/' },
  // NAV-PARENT-3 — the chat's own add-contact prompt (CONTACTS-RECIP-1).
  { re: /^\/chat\/([^/]+)\/add-contact\/?$/, parent: (m) => `/chat/${m[1]}` },
  // NAV-PARENT-3 — a member's contact screen belongs to the chat info it was
  // opened from (a group's member row, or a 1:1's View contact — CONTACTS-VIEW-6). It used to be `/profile/:uid` (parent `/`), whose
  // URL could not say where it came from — so back went to the chat list.
  { re: /^\/chat\/([^/]+)\/member\/[^/]+\/?$/, parent: (m) => `/chat/${m[1]}/info` },

  // Chat thread + its sub-screens.
  { re: /^\/chat\/([^/]+)\/add-member\/?$/, parent: (m) => `/chat/${m[1]}/info` },
  { re: /^\/chat\/([^/]+)\/info\/?$/, parent: (m) => `/chat/${m[1]}` },
  { re: /^\/chat\/[^/]+\/?$/, parent: '/' },

  // Contacts.
  { re: /^\/contacts\/view\/[^/]+\/?$/, parent: '/contacts' },
  { re: /^\/contacts\/(?:add|new-group)\/?$/, parent: '/contacts' },
  { re: /^\/contacts\/edit\/[^/]+\/?$/, parent: '/contacts' },
  { re: /^\/contacts\/?$/, parent: '/' },

  // Cards + practice. PRACTICE-HUB-9 (owner, beta 0.3.1): a lesson and the
  // custom builder back out to the Practice page (the hub), which backs to the
  // deck. They used to skip the hub and land on the deck.
  // NAV-PRACTICE-1 — the hub is the Practice tab's root (2026-10-24; it
  // backed to the deck while Practice lived inside Cards).
  { re: /^\/cards\/practice\/hub\/?$/, parent: '/' },
  { re: /^\/cards\/practice\/start\/?$/, parent: '/cards/practice/hub' },
  { re: /^\/cards\/practice\/?$/, parent: '/cards/practice/hub' },
  { re: /^\/cards\/progress\/?$/, parent: '/cards/practice/hub' },
  { re: /^\/cards\/?$/, parent: '/' },

  // Wurlds (branded URL; code stays `life*`). Literal children BEFORE the
  // :worldId catch-all (else "start" / "overview" would match the dynamic
  // segment).
  { re: /^\/wurlds\/start\/?$/, parent: '/wurlds' },
  // NAV-ANIM-8: `/wurlds` is the overview itself now; the old path is a
  // redirect and keeps its parent so a deep link still ranks sanely.
  { re: /^\/wurlds\/?$/, parent: '/' },
  { re: /^\/wurlds\/overview\/?$/, parent: '/' },
  { re: /^\/wurlds\/[^/]+\/?$/, parent: '/wurlds' },

  // Other top-level hubs / leaves.
  { re: /^\/profile\/[^/]+\/?$/, parent: '/' },
  // `/admin` is a SETTINGS sub-page, not a top-level hub: the only way in is
  // the admin row on the settings screen. It used to resolve to `/`, while
  // both of its header arrows were hard-coded `<Link to="/settings">` — so the
  // arrow and the Android hardware back went to DIFFERENT screens from the
  // same page, and `parentChain('/admin')` skipped the screen the user
  // actually came from. Corrected 2026-09-20 with NAV-BACK-2.
  { re: /^\/admin\/?$/, parent: '/settings' },
  // NAV-PARENT-4 / TIPS-SETTINGS-1 — the tips page opened from Settings is a
  // Settings sub-page; opened from the chat-list row it hangs off the root.
  { re: /^\/settings\/tips\/?$/, parent: '/settings' },
  // THEME-9 — the bubble tuner, opened from the Admin card's beta section.
  { re: /^\/settings\/theme-tuner\/?$/, parent: '/settings' },
  { re: /^\/tips\/?$/, parent: '/' },
  { re: /^\/(?:settings|share)\/?$/, parent: '/' },
];

/**
 * NAV-PARENT-4 — the ONE query marker back reads. A learning tip's Try it
 * opens its feature with `from=tips` (or `from=settings-tips`), and back from
 * that screen returns to the tips page it came from. Every other query is
 * ignored, so back stays a pure function of the URL, never of history.
 */
const TIPS_RETURN: Record<string, string> = {
  tips: '/tips',
  'settings-tips': '/settings/tips',
};

function tipsReturnOf(url: string): string | null {
  const q = url.indexOf('?');
  if (q < 0) return null;
  const query = url.slice(q + 1).split('#')[0] ?? '';
  const from = new URLSearchParams(query).get('from');
  return from ? (TIPS_RETURN[from] ?? null) : null;
}

/** Strip query/hash; empty → `/`. */
function normalise(pathname: string): string {
  return pathname.split(/[?#]/)[0] || '/';
}

/**
 * The parent route for `pathname`, or `null` at the root (`/`).
 * Query/hash are ignored. Unknown paths → `/`.
 */
export function resolveParent(pathname: string): string | null {
  const tipsReturn = tipsReturnOf(pathname);
  const path = normalise(pathname);
  if (tipsReturn && path !== tipsReturn) return tipsReturn;
  if (path === '/' || path === '') return null;
  for (const { re, parent } of RULES) {
    const m = path.match(re);
    if (m) return typeof parent === 'function' ? parent(m) : parent;
  }
  // Unknown route → app root. Back is always defined; never a blank page.
  return '/';
}

/**
 * NAV-STACK-1 — the full ancestor chain for `pathname`, root FIRST.
 *
 *   parentChain('/chat/A/info') → ['/', '/chat/A', '/chat/A/info']
 *   parentChain('/')           → ['/']
 *
 * This is the shape `window.history` must have while that path is showing.
 * Everything else in `NAV-STACK-*` is defined against it: the stack grows by
 * one going down the chain, shrinks by one coming up, and a depth is just an
 * index into it.
 *
 * ⚠ CYCLE GUARD, and it is not theoretical. `resolveParent` is a hand-ordered
 * rule list that returns `/` for anything unmatched (NAV-PARENT-2); one
 * mis-ordered rule mapping a path to itself, or to a descendant, would spin
 * this loop forever and hang the app at boot — on the seeding path, before
 * anything has rendered, which is the worst possible place to hang. A visited
 * set makes that a truncated chain instead of a frozen tab.
 */
export function parentChain(pathname: string): string[] {
  const chain: string[] = [];
  const seen = new Set<string>();
  // NAV-PARENT-4 — the first step reads the full URL (its tips marker); every
  // ancestor is a bare path, which is all `resolveParent` returns.
  const first = normalise(pathname);
  seen.add(first);
  chain.push(first);
  let cur: string | null = resolveParent(pathname);
  while (cur !== null && !seen.has(cur)) {
    seen.add(cur);
    chain.push(cur);
    cur = resolveParent(cur);
  }
  return chain.reverse();
}

// ---------------------------------------------------------------------------
// NAV-ANIM-7 — the app's top-level SECTIONS, in order.
// ---------------------------------------------------------------------------

/**
 * The ordered list of top-level destinations, left to right as the tab bar
 * (and the desktop nav rail) present them.
 *
 * Two things read it:
 *  - `useNavDirection` (NAV-ANIM-1 rule c) gives a PEER navigation its
 *    direction by comparing section indices, so moving right along the bar
 *    slides in from the right and moving left slides in from the left.
 *  - `components/nav/navTabs.ts` builds `NAV_TABS` from it, so the bar cannot
 *    declare an order or a membership rule that disagrees with the animation.
 *    (The tabs' icons, labels and beta flags stay over there — this module is
 *    in `lib/` and holds no React.)
 *
 * Membership is by SECTION, not by exact route: `/chat/:id` is in chats,
 * `/cards/practice/start` is in cards. A route belonging to no section
 * (`/admin`, `/share`, `/profile/:uid`) reports `-1`, which the direction
 * rules treat as "unrankable" and fall through on.
 */
/** NAV-PRACTICE-1 — the paths the Practice tab owns. */
function isPracticePath(p: string): boolean {
  return p === '/cards/practice' || p.startsWith('/cards/practice/') || p === '/cards/progress';
}

export const NAV_SECTIONS = [
  // `/` matches EXACTLY, plus the chat threads it owns. A `startsWith('/')`
  // test would swallow every route in the app and make every peer move
  // unrankable.
  // NAV-PARENT-4 — `/tips` (the chat-list row's page) belongs to chats too.
  { id: 'chats', to: '/', match: (p: string) => p === '/' || p === '/tips' || p.startsWith('/chat/') },
  { id: 'contacts', to: '/contacts', match: (p: string) => p.startsWith('/contacts') },
  { id: 'cards', to: '/cards', match: (p: string) => p.startsWith('/cards') && !isPracticePath(p) },
  // NAV-PRACTICE-1 — Practice is its own tab; its URLs stayed under /cards.
  { id: 'practice', to: '/cards/practice/hub', match: (p: string) => isPracticePath(p) },
  { id: 'wurlds', to: '/wurlds', match: (p: string) => p.startsWith('/wurlds') },
  { id: 'settings', to: '/settings', match: (p: string) => p.startsWith('/settings') },
] as const;

export type NavSectionId = (typeof NAV_SECTIONS)[number]['id'];

/** Index of `pathname`'s section in `NAV_SECTIONS`, or `-1` if it has none. */
export function resolveSectionIndex(pathname: string): number {
  const path = withoutTrailingSlash(normalise(pathname));
  return NAV_SECTIONS.findIndex((s) => s.match(path));
}

/** Id of `pathname`'s section, or `null` if it has none. */
export function resolveSectionId(pathname: string): NavSectionId | null {
  return NAV_SECTIONS[resolveSectionIndex(pathname)]?.id ?? null;
}

/** `/contacts/` → `/contacts`; `/` stays `/`. */
function withoutTrailingSlash(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
}
