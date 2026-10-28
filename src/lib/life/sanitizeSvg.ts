/**
 * LIFE-BACKDROP-5: sanitise Gemini's SVG output before we inject it
 * into the DOM via `dangerouslySetInnerHTML`. Conservative
 * allowlist — anything we don't recognise gets stripped.
 *
 * The model usually returns clean SVG, but we treat the output as
 * adversarial: scripts, foreign objects, external references, and
 * unknown elements all get removed before render. If sanitisation
 * fails to find a valid <svg> root, we return null and the caller
 * falls back to the silhouette library (LIFE-BACKDROP-8).
 */

/** Elements the renderer accepts. Anything else is stripped.
 *
 *  LIFE-BACKDROP-23 — written in the SVG spec's camelCase for readability, and
 *  LOWERCASED at construction because the lookup lowercases too. SVG parses as
 *  XML, so `tagName` preserves case: matching `'animateTransform'` against a
 *  camelCase set entry via `.toLowerCase()` never hit, and every camelCase
 *  element — all gradients, clipPath, animateTransform/Motion and the eight
 *  `fe*` primitives — was silently stripped from every generated backdrop. */
const ALLOWED_ELEMENTS = new Set(([
  'svg',
  'g',
  'defs',
  'linearGradient',
  'radialGradient',
  'stop',
  'pattern',
  'clipPath',
  'mask',
  'rect',
  'circle',
  'ellipse',
  'line',
  'polyline',
  'polygon',
  'path',
  'text',
  'tspan',
  'title',
  'desc',
  'animate',
  'animateTransform',
  'animateMotion',
  'set',
  'mpath',
  'use',
  'symbol',
  'filter',
  'feGaussianBlur',
  'feOffset',
  'feMerge',
  'feMergeNode',
  'feColorMatrix',
  'feFlood',
  'feComposite',
  'feBlend',
] as const).map((t) => t.toLowerCase()));

/** Attribute keys outright forbidden anywhere in the tree. */
const BANNED_ATTRS = new Set([
  'onload',
  'onerror',
  'onclick',
  'onmouseover',
  'onmouseout',
  'onmousedown',
  'onmouseup',
  'onkeydown',
  'onkeyup',
  'onkeypress',
  'onfocus',
  'onblur',
  'onbegin',
  'onend',
  'onrepeat',
  'xlink:show',
  'xlink:actuate',
]);

/** Attribute values containing these substrings get stripped. */
const BANNED_VALUE_PREFIXES = ['javascript:', 'data:text/html'];

function isUrlAttribute(name: string): boolean {
  return name === 'href' || name === 'xlink:href' || name === 'src';
}

function isExternalRef(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v.startsWith('#')) return false; // in-document fragment ref — fine
  if (v.startsWith('data:image/')) return false; // inline image — fine
  return true;
}

function bannedValue(value: string): boolean {
  const v = value.trim().toLowerCase();
  return BANNED_VALUE_PREFIXES.some((p) => v.startsWith(p));
}

/** Walks the tree, removing disallowed elements / attrs. Mutates in
 *  place; returns true when the root remains a valid <svg>. */
function sanitiseElement(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  if (!ALLOWED_ELEMENTS.has(tag)) {
    el.remove();
    return false;
  }
  // Sanitise attributes.
  for (const attr of Array.from(el.attributes)) {
    const lowerName = attr.name.toLowerCase();
    if (BANNED_ATTRS.has(lowerName)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (lowerName.startsWith('on')) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (isUrlAttribute(lowerName) && isExternalRef(attr.value)) {
      el.removeAttribute(attr.name);
      continue;
    }
    if (bannedValue(attr.value)) {
      el.removeAttribute(attr.name);
      continue;
    }
  }
  // Recurse into children.
  for (const child of Array.from(el.children)) {
    sanitiseElement(child);
  }
  return true;
}

/**
 * LIFE-BACKDROP-24 — drop a repeated attribute before the XML parser sees it.
 *
 * MEASURED: one backdrop in twenty of a four-world run died on
 * `90:158: duplicate attribute: fill` — the model had written `fill` twice on a
 * single element. XML is strict about that and returns a `<parsererror>` root,
 * so `sanitiseSvg` returned null and the WHOLE backdrop was thrown away; the
 * player got a fallback silhouette for that scene. An HTML parser would have
 * shrugged and taken the first value.
 *
 * Repaired rather than regenerated: it is a deterministic tic with an obvious
 * correct reading (the first value wins, as HTML would do), and a retry costs a
 * whole image generation to fix a duplicated word. Repaired rather than parsed
 * as HTML, too — switching parsers to dodge one error class would change what
 * the sanitiser sees for every other input, and this file treats its input as
 * adversarial on purpose.
 *
 * Deliberately narrow: it rewrites only what is inside a tag's angle brackets,
 * keeps the first occurrence of each attribute name, and touches nothing else.
 */
export function dedupeAttributes(markup: string): string {
  return markup.replace(/<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)(\/?)>/g,
    (whole, tag: string, rawAttrs: string, trailing: string) => {
      // The attribute group matches `/` too, so on `<rect …/>` it swallows the
      // self-close and `trailing` comes back empty. Rebuilding from that
      // produced an UNCLOSED element — a repair that broke the document it was
      // fixing. Take the slash off the attributes rather than trusting the
      // group that could not have it.
      const selfClose = trailing || (/\/\s*$/.test(rawAttrs) ? '/' : '');
      const attrs = rawAttrs.replace(/\/\s*$/, '');
      if (!attrs.trim()) return whole;
      const seen = new Set<string>();
      let out = '';
      const re = /\s+([a-zA-Z_:][\w:.-]*)\s*=\s*("[^"]*"|'[^']*')/g;
      let m: RegExpExecArray | null;
      let dropped = false;
      while ((m = re.exec(attrs)) !== null) {
        const name = m[1]!.toLowerCase();
        if (seen.has(name)) { dropped = true; continue; }
        seen.add(name);
        out += ` ${m[1]!}=${m[2]!}`;
      }
      return dropped ? `<${tag}${out}${selfClose}>` : whole;
    });
}


/**
 * LIFE-BACKDROP-25 — close what the model left open, before the XML parse.
 *
 * MEASURED 2026-08-04: a four-world run lost a backdrop to
 * `21:9: unexpected close tag`. The model had written `<feMerge>`, two
 * `<feMergeNode/>` children, and then `</filter>` — never closing `</feMerge>`.
 * XML is strict about that, so `DOMParser` returned a `<parsererror>` root and
 * 4.9 KB of authored SVG was thrown away for one missing tag. The judge scored
 * that world's BACKDROP-FIT 1: *"the scene at the village fountain has no SVG
 * source defined, rendering it broken."*
 *
 * This is the error recovery every HTML parser implements, applied narrowly: a
 * close tag that is not the innermost open element closes the intervening ones
 * first; a close tag matching nothing open is a stray and is dropped; anything
 * still open at the end is closed.
 *
 * SAME TWO REJECTED ALTERNATIVES AS `dedupeAttributes`. Not "parse as HTML" —
 * switching parsers to dodge one error class changes what the sanitiser sees
 * for every other input, and this file treats its input as adversarial on
 * purpose. Not "retry" — a backdrop is the most expensive generation in the
 * sim, and re-rolling one to supply a missing `</feMerge>` spends an image to
 * fix a typo.
 *
 * ORDERING IS LOAD-BEARING: this runs BEFORE `sanitiseElement`, so the
 * allowlist still decides what survives. Closing a tag is never a way to
 * smuggle an element past it.
 */
export function closeUnclosedElements(markup: string): string {
  const stack: string[] = [];
  let out = '';
  let last = 0;
  // Comments, CDATA, declarations and processing instructions are copied
  // through untouched — a `<g>` inside a comment is not an open element.
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<[!?][^>]*>|<\/([a-zA-Z][\w:.-]*)\s*>|<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup)) !== null) {
    const [whole, closeName, openName, attrs] = m;
    out += markup.slice(last, m.index);
    last = m.index + whole.length;

    if (closeName) {
      const name = closeName;
      const at = stack.lastIndexOf(name);
      if (at === -1) continue; // stray close — drop it
      // Close everything opened inside the element being closed.
      for (let i = stack.length - 1; i > at; i -= 1) out += `</${stack[i]!}>`;
      stack.length = at;
      out += `</${name}>`;
      continue;
    }
    if (openName) {
      out += whole;
      // A self-closing tag opens nothing.
      if (!/\/\s*$/.test(attrs ?? '')) stack.push(openName);
      continue;
    }
    out += whole; // comment / CDATA / declaration
  }
  out += markup.slice(last);
  for (let i = stack.length - 1; i >= 0; i -= 1) out += `</${stack[i]!}>`;
  return out;
}

/** Returns sanitised SVG markup, or `null` when the input doesn't
 *  contain a recognisable <svg> root after stripping. */
export function sanitiseSvg(raw: string): string | null {
  if (typeof DOMParser === 'undefined') return null; // jsdom-less env
  const trimmed = closeUnclosedElements(dedupeAttributes(raw.trim()));
  if (!trimmed) return null;
  // Quick-reject anything that isn't markup-shaped.
  if (!trimmed.includes('<svg')) return null;
  const doc = new DOMParser().parseFromString(trimmed, 'image/svg+xml');
  const root = doc.documentElement;
  // Parser errors come back as a <parsererror> root.
  if (!root || root.nodeName.toLowerCase() !== 'svg') return null;
  sanitiseElement(root);
  // Ensure the viewBox is present so the SVG scales sanely.
  if (!root.getAttribute('viewBox')) {
    // LIFE-BACKDROP-12: square canvas. Legacy 3:2 scenes cached before this
    // carry their own explicit viewBox and are left untouched.
    root.setAttribute('viewBox', '0 0 1000 1000');
  }
  if (!root.getAttribute('preserveAspectRatio')) {
    // LIFE-BACKDROP-12 / LIFE-UI-7: contain-fit, so the whole square is
    // always visible and the surround is painted with the bleed colour.
    // Cover-fit ('slice') left no letterbox because it cropped the
    // scene's edges instead — invisible on 3:2, severe on a tall phone.
    root.setAttribute('preserveAspectRatio', 'xMidYMin meet');
  }
  // Strip width/height so it scales to its container instead of
  // baking in fixed pixels.
  root.removeAttribute('width');
  root.removeAttribute('height');
  return new XMLSerializer().serializeToString(root);
}
