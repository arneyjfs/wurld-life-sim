/**
 * SRV-PROMPT-8..13 batch 2 — the escaping shared by the three NPC prompts.
 *
 * WHY THIS IS ONE MODULE AND NOT THREE COPIES. The client had it three times,
 * once per prompt file, and moving it that way would have carried the
 * duplication across the wire with the prose. It is not prompt TEXT — it is the
 * boundary between the data and the instruction in prompts whose every input
 * (`name`, `role`, `archetype`, `worldVibe`, `sagaPremise`) is model-authored
 * world state. Three copies of that boundary is three places for one of them to
 * stop escaping something.
 *
 * `&` first, always: escaping it after `<` would re-escape the `&` in `&lt;`.
 */

/** Escape a value that lands between tags (`<role>…</role>`). */
export function escapeText(s: string): string {
  return s.replace(/[&<>]/g, (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : "&gt;"));
}

/** Escape a value that lands inside an attribute (`name="…"`). */
export function escapeAttr(s: string): string {
  return escapeText(s).replace(/"/g, "&quot;");
}

/**
 * The `<character>` / `<role>` / `<worldVibe>` preamble all three NPC prompts
 * open with, in that order.
 *
 * An ABSENT role omits the tag entirely rather than rendering `<role></role>`.
 * That is LIFE-NPC-8's shape: "no role known" and "the role is the empty
 * string" are different prompts, and the SI branches on the first
 * ("If NEITHER <archetype> NOR <role> is present…").
 */
export function npcCharacterBlocks(input: {
  name: string;
  role?: string | null;
  worldVibe: string;
}): string[] {
  const parts: string[] = [`<character name="${escapeAttr(input.name)}"/>`];
  if (input.role) parts.push(`<role>${escapeText(input.role)}</role>`);
  parts.push(`<worldVibe>${escapeText(input.worldVibe)}</worldVibe>`);
  return parts;
}
