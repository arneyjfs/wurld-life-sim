/**
 * NAV-PARENT-* / NAV-BACK-EMPTY-1 (docs/specs/navigation.md). The parent
 * resolver is the single source of "where does back go" — derived from the
 * path, never history.
 */
import { describe, it, expect } from 'vitest';
import {
  NAV_SECTIONS,
  parentChain,
  resolveParent,
  resolveSectionId,
  resolveSectionIndex,
} from './navHierarchy';

describe('resolveParent — NAV-PARENT', () => {
  it('root has no parent', () => {
    expect(resolveParent('/')).toBeNull();
    expect(resolveParent('')).toBeNull();
  });

  it('chat thread + sub-screens climb the hierarchy', () => {
    expect(resolveParent('/chat/abc')).toBe('/');
    expect(resolveParent('/chat/abc/info')).toBe('/chat/abc');
    expect(resolveParent('/chat/abc/add-member')).toBe('/chat/abc/info');
  });

  it('NAV-PARENT — circular route: from /chat/:id back is the LIST, regardless of arrival path', () => {
    // chat-media → image-viewer → go-to-message lands on /chat/:id; back must
    // resolve to '/', NOT /chat/:id/info (the media gallery it came through).
    expect(resolveParent('/chat/xyz')).toBe('/');
  });

  it('contacts sub-screens back to /contacts; /contacts backs to /', () => {
    expect(resolveParent('/contacts/add')).toBe('/contacts');
    expect(resolveParent('/contacts/new-group')).toBe('/contacts');
    expect(resolveParent('/contacts/edit/c1')).toBe('/contacts');
    expect(resolveParent('/contacts')).toBe('/');
  });

  it('PRACTICE-HUB-9 / NAV-PRACTICE-1 — a session, the builder and progress back to the hub; the hub (a tab) backs to the root', () => {
    expect(resolveParent('/cards/practice')).toBe('/cards/practice/hub');
    expect(resolveParent('/cards/practice?resume=1')).toBe('/cards/practice/hub');
    expect(resolveParent('/cards/practice?intent=food&count=5')).toBe('/cards/practice/hub');
    expect(resolveParent('/cards/practice/hub')).toBe('/');
    expect(resolveParent('/cards/practice/start')).toBe('/cards/practice/hub');
    expect(resolveParent('/cards/progress')).toBe('/cards/practice/hub');
    expect(resolveParent('/cards')).toBe('/');
  });

  it('life: literal children resolve before the :worldId catch-all', () => {
    // NAV-ANIM-8: the overview moved to `/wurlds`, so that is the parent the
    // wurld routes go back to. `/wurlds/overview` survives as a redirect for
    // old links and keeps its own parent so a deep link still ranks sanely.
    expect(resolveParent('/wurlds/start')).toBe('/wurlds');
    expect(resolveParent('/wurlds')).toBe('/');
    expect(resolveParent('/wurlds/overview')).toBe('/');
    expect(resolveParent('/wurlds/world-42')).toBe('/wurlds'); // dynamic worldId
  });

  it('NAV-PARENT-3 — a group member\'s contact screen backs to the group info it was opened from', () => {
    expect(resolveParent('/chat/g1/member/u1')).toBe('/chat/g1/info');
    expect(parentChain('/chat/g1/member/u1')).toEqual(['/', '/chat/g1', '/chat/g1/info', '/chat/g1/member/u1']);
  });

  it('CONTACTS-VIEW-6 / NAV-PARENT-3 — View contact from a 1:1 chat info backs to that info', () => {
    expect(resolveParent('/chat/direct_a_b/member/b')).toBe('/chat/direct_a_b/info');
    // The 1:1 info no longer hosts the contact forms (they nest under the contact screen).
    expect(resolveParent('/chat/direct_a_b/member/b/add-contact')).toBe('/chat/direct_a_b/member/b');
  });

  it('NAV-PARENT-3 — a contact opened from the Contacts list backs to /contacts', () => {
    expect(resolveParent('/contacts/view/c1')).toBe('/contacts');
  });

  it('NAV-PARENT-3 — the chat\'s add-contact form backs to the chat', () => {
    expect(resolveParent('/chat/c1/add-contact')).toBe('/chat/c1');
    expect(resolveParent('/chat/c1/add-contact?phone=%2B44&name=A')).toBe('/chat/c1');
  });

  it.each([
    ['/chat/g1/member/u1', 'member screen'],
    ['/contacts/view/c9', 'contacts-list contact'],
    ['/profile/u1', 'legacy profile'],
  ])('NAV-PARENT-3 — edit + add forms opened from %s (%s) back to it', (screen) => {
    expect(resolveParent(`${screen}/edit/k1`)).toBe(screen);
    expect(resolveParent(`${screen}/add-contact`)).toBe(screen);
  });

  it('NAV-PARENT-3 — the flat routes keep their parents (no regression)', () => {
    expect(resolveParent('/contacts/edit/c1')).toBe('/contacts');
    expect(resolveParent('/contacts/add')).toBe('/contacts');
    expect(resolveParent('/chat/c1/add-member')).toBe('/chat/c1/info');
    // NAV-BACK-CIRCULAR-1 — a chat is still a child of the list only.
    expect(resolveParent('/chat/c1')).toBe('/');
  });

  it('top-level hubs/leaves back to /', () => {
    expect(resolveParent('/profile/u1')).toBe('/');
    expect(resolveParent('/settings')).toBe('/');
    expect(resolveParent('/share')).toBe('/');
  });

  it('NAV-PARENT-1 — /admin is a SETTINGS sub-page, not a top-level hub', () => {
    // The only way in is the admin row on the settings screen
    // (screens/Settings/FooterLinks.tsx). It resolved to `/` while both of its
    // header arrows were hard-coded `<Link to="/settings">`, so the arrow and
    // the Android hardware back left the same page for different screens.
    expect(resolveParent('/admin')).toBe('/settings');
    expect(resolveParent('/admin/')).toBe('/settings');
    // ...and the chain the stack is seeded from (NAV-STACK-4) now contains the
    // screen the user actually came from, rather than skipping it.
    expect(parentChain('/admin')).toEqual(['/', '/settings', '/admin']);
  });

  it('NAV-BACK-EMPTY-1 — an unknown / unmapped path still resolves to a real parent (never null/blank)', () => {
    expect(resolveParent('/some/unknown/deep/path')).toBe('/');
    expect(resolveParent('/garbage')).toBe('/');
  });

  it('ignores query + hash', () => {
    expect(resolveParent('/chat/abc?foo=1#x')).toBe('/');
    expect(resolveParent('/chat/abc/info?from=gallery')).toBe('/chat/abc');
  });

  it('tolerates a trailing slash', () => {
    expect(resolveParent('/chat/abc/info/')).toBe('/chat/abc');
    expect(resolveParent('/contacts/')).toBe('/');
  });
});

/**
 * NAV-ANIM-7 — the ordered section list. It is what gives a PEER navigation a
 * left/right, so it has to rank every top-level destination the tab bar shows,
 * in the same order the bar shows them, and it has to place DEEP routes in
 * their owning section.
 */
describe('NAV-ANIM-7 — resolveSectionIndex / resolveSectionId', () => {
  it('NAV-ANIM-7 / NAV-PRACTICE-1 — sections are ordered chats → contacts → cards → practice → wurlds → settings', () => {
    expect(NAV_SECTIONS.map((s) => s.id)).toEqual([
      'chats',
      'contacts',
      'cards',
      'practice',
      'wurlds',
      'settings',
    ]);
    expect(NAV_SECTIONS.map((s) => s.to)).toEqual([
      '/',
      '/contacts',
      '/cards',
      '/cards/practice/hub',
      '/wurlds',
      '/settings',
    ]);
  });

  it('NAV-ANIM-7 — each section root resolves to its own index', () => {
    NAV_SECTIONS.forEach((section, i) => {
      expect(resolveSectionIndex(section.to), section.to).toBe(i);
    });
  });

  it('NAV-ANIM-7 — a deep route belongs to its section', () => {
    expect(resolveSectionId('/chat/abc')).toBe('chats');
    expect(resolveSectionId('/chat/abc/info')).toBe('chats');
    expect(resolveSectionId('/contacts/add')).toBe('contacts');
    expect(resolveSectionId('/contacts/edit/c1')).toBe('contacts');
    expect(resolveSectionId('/cards/practice/start')).toBe('practice');
    // NAV-PRACTICE-1 — practice owns the hub, the session, the builder and progress; cards keeps the deck.
    expect(resolveSectionId('/cards/practice/hub')).toBe('practice');
    expect(resolveSectionId('/cards/progress')).toBe('practice');
    expect(resolveSectionId('/cards')).toBe('cards');
    expect(resolveSectionId('/wurlds/world-42')).toBe('wurlds');
  });

  it('NAV-ANIM-7 — a route in no section reports -1 / null, it does not fall into chats', () => {
    // `/` matches EXACTLY, never as a prefix — otherwise every path would be
    // in the chats section and no peer move could ever be ranked.
    for (const p of ['/admin', '/share', '/profile/u1', '/garbage']) {
      expect(resolveSectionIndex(p), p).toBe(-1);
      expect(resolveSectionId(p), p).toBeNull();
    }
  });

  it('NAV-ANIM-7 — ignores query + hash and tolerates a trailing slash', () => {
    expect(resolveSectionId('/cards/practice?resume=1')).toBe('practice');
    expect(resolveSectionId('/contacts/')).toBe('contacts');
    expect(resolveSectionIndex('/?foo=1')).toBe(0);
  });
});

describe('NAV-PARENT-4 — the learning-tips return marker', () => {
  it('NAV-PARENT-4 — the tips page climbs to its own parent', () => {
    expect(resolveParent('/tips')).toBe('/');
    expect(resolveParent('/settings/tips')).toBe('/settings');
    // THEME-9 — the bubble tuner is a settings sub-page too.
    expect(resolveParent('/settings/theme-tuner')).toBe('/settings');
  });

  it('NAV-PARENT-4 — `from=tips` sends any screen back to /tips', () => {
    expect(resolveParent('/cards?from=tips')).toBe('/tips');
    expect(resolveParent('/cards?view=flip&from=tips')).toBe('/tips');
    expect(resolveParent('/cards/practice/hub?from=tips')).toBe('/tips');
    expect(resolveParent('/chat/abc?from=tips')).toBe('/tips');
  });

  it('NAV-PARENT-4 — `from=settings-tips` sends it back to /settings/tips', () => {
    expect(resolveParent('/cards/practice/start?from=settings-tips')).toBe('/settings/tips');
  });

  it('NAV-PARENT-4 — every other query is still ignored', () => {
    expect(resolveParent('/cards?view=flip')).toBe('/');
    expect(resolveParent('/cards?from=elsewhere')).toBe('/');
    expect(resolveParent('/chat/abc/info?from=tipsy')).toBe('/chat/abc');
  });

  it('NAV-PARENT-4 — parentChain keeps the marker on the first element only', () => {
    expect(parentChain('/cards?from=tips')).toEqual(['/', '/tips', '/cards']);
    expect(parentChain('/chat/abc?from=settings-tips')).toEqual([
      '/', '/settings', '/settings/tips', '/chat/abc',
    ]);
    expect(parentChain('/settings/tips')).toEqual(['/', '/settings', '/settings/tips']);
  });

  it('NAV-PARENT-4 / NAV-ANIM-7 — /tips is in the chats section, /settings/tips in settings', () => {
    expect(resolveSectionId('/tips')).toBe('chats');
    expect(resolveSectionId('/settings/tips')).toBe('settings');
  });
});
