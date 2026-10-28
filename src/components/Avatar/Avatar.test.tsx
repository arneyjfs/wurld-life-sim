import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Avatar } from './Avatar';

/**
 * The inline `tinyImage` LQIP underlay must render BLURRED — a ~24px source
 * scaled up to the avatar shows a visible pixel grid otherwise (the reported
 * "I can see each pixel" bug; the blur had been removed as "redundant"). The
 * blur scales with the avatar diameter since bigger avatars show bigger
 * source-pixels.
 */
describe('Avatar — LQIP blur', () => {
  it('blurs the inline tinyImage placeholder', () => {
    const { container } = render(
      <Avatar
        photoUrl="https://cdn/u1.jpg"
        tinyImage="data:image/jpeg;base64,AAA"
        name="Liv"
        size={40}
      />,
    );
    const lqip = container.querySelector('img[aria-hidden="true"]') as HTMLElement | null;
    expect(lqip).not.toBeNull();
    expect(lqip!.style.filter).toMatch(/^blur\(\d+px\)$/);
  });

  it('scales the blur radius with the avatar size', () => {
    const blurOf = (c: HTMLElement) =>
      parseInt(
        (c.querySelector('img[aria-hidden="true"]') as HTMLElement).style.filter.match(
          /blur\((\d+)px\)/,
        )?.[1] ?? '0',
        10,
      );
    const small = render(
      <Avatar photoUrl="https://cdn/a.jpg" tinyImage="data:x" name="A" size={40} />,
    );
    const large = render(
      <Avatar photoUrl="https://cdn/b.jpg" tinyImage="data:x" name="B" size={120} />,
    );
    expect(blurOf(large.container)).toBeGreaterThan(blurOf(small.container));
  });
});

/**
 * An EMPTY photoUrl is not a photoUrl.
 *
 * Caught by the emulator gate on 2026-08-06, as a React console error on the
 * chat specs: *"An empty string ("") was passed to the src attribute. This may
 * cause the browser to download the whole page again over the network."*
 *
 * The component already got this right ONE line up — `showImage` is
 * `!!photoUrl`, which treats `''` as absent — and then rendered
 * `src={photoUrl ?? undefined}`, where `??` guards only `null`/`undefined`.
 * So a stored `photoUrl: ''` (what a never-set or cleared avatar holds in
 * Firestore) hid the image correctly and still emitted `<img src="">`, which
 * per the browsers' own rule re-requests the current document.
 *
 * Two guards on the same value in the same component, disagreeing about what
 * counts as "no photo" — the same shape as LIFE-CAST-4's *"null is a word the
 * model writes into typed fields"*, one layer down in the DOM.
 */
describe('an empty photoUrl never reaches the src attribute', () => {
  const srcAttrs = (c: HTMLElement) =>
    [...c.querySelectorAll('img')].map((i) => i.getAttribute('src'));

  it('renders NO src at all for an empty-string photoUrl', () => {
    const { container } = render(<Avatar photoUrl="" name="Ada" size={40} />);
    expect(srcAttrs(container)).not.toContain('');
  });

  it('same for null and undefined, which already worked', () => {
    const { container: a } = render(<Avatar photoUrl={null} name="Ada" size={40} />);
    expect(srcAttrs(a)).not.toContain('');
    const { container: b } = render(<Avatar name="Ada" size={40} />);
    expect(srcAttrs(b)).not.toContain('');
  });

  it('an empty tinyImage does not render an LQIP with src="" either', () => {
    const { container } = render(<Avatar photoUrl="" tinyImage="" name="Ada" size={40} />);
    expect(srcAttrs(container)).not.toContain('');
  });

  it('a REAL photoUrl is still rendered', () => {
    const { container } = render(
      <Avatar photoUrl="https://example.test/a.jpg" name="Ada" size={40} />,
    );
    expect(srcAttrs(container)).toContain('https://example.test/a.jpg');
  });
});

describe('CONTACTS-NAME-3 — initials', () => {
  it('CONTACTS-NAME-3 — a `{phone} ~ {name}` label takes its initials from the name half', () => {
    const { container } = render(<Avatar name="+447985469138 ~ James Arney" size={40} />);
    expect(container.textContent).toBe('JA');
  });

  it('CONTACTS-NAME-3 — a plain name is unchanged', () => {
    const { container } = render(<Avatar name="Jimbo work" size={40} />);
    expect(container.textContent).toBe('JW');
  });
});
