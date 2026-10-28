/**
 * LIFE-NPC-8: work out who a newly-introduced NPC actually IS, before their
 * avatar and profile are generated.
 *
 * THE BUG THIS EXISTS FOR. A beat introduced "Madame Roux, ta fleuriste" who
 * hands the player a changed script; the profile that rendered under her
 * portrait called her "your formidable vocal coach and mentor". Not a race —
 * the trace has the beats at 13:14:00 and the description at 13:14:40, forty
 * seconds later. The profile call simply never received a role: `commitNode`'s
 * beat-promotion path called `promoteOrTouchNpc` and `kickoffNpcAssets` with a
 * name and nothing else, so `buildNpcProfilePrompt` emitted no `<role>` at all
 * while its own system instruction says "Ground the profile in <role> and
 * <worldVibe>". Given a French name and "theatrical espionage" the model
 * invented a plausible theatre role, which is the only thing it could do.
 *
 * LIFE-NPC-6 fixed exactly this on the SCENE path ("carry the key-NPC's role
 * onto the row as its `relationship` … Was dropped before") and did not reach
 * the beat path, which is how most NPCs are actually born.
 *
 * TWO OUTPUTS, because they have different consumers and different lengths:
 *   `relationship` is the avatar card's role row (LIFE-NPC-7) — it must stay
 *   SHORT, so a whole archetype sentence cannot go there.
 *   `archetype` is the fuller line handed to the profile and avatar prompts,
 *   where more context is strictly better.
 *
 * PRECEDENCE, most-specific first:
 *   1. The turn's own `introduces[]` note — authored by the model that just
 *      wrote the scene, so it describes this character as they appear NOW.
 *   2. The saga's `keyArchetypes` — authoritative and stable for the recurring
 *      cast. For Madame Roux this reads "The Handler" / "Madame Roux, a florist
 *      who delivers coded scripts and sharp critiques of Jimothée's
 *      performance", which is precisely the line that was missing.
 *   3. Nothing, and the caller keeps today's behaviour.
 */
import type { StepIntroduction } from './stepSchema';

export type ResolvedNpcRole = {
  /** Short label for the avatar card's role row (`ZLifeNpc.relationship`). */
  relationship: string | null;
  /** Fuller sentence for the profile + avatar prompts. May repeat the name. */
  archetype: string | null;
};

const EMPTY: ResolvedNpcRole = { relationship: null, archetype: null };

/** Card role rows are one line. Anything longer is prompt material, not a label. */
const MAX_RELATIONSHIP_CHARS = 48;

function norm(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Does this archetype describe this NPC?
 *
 * The saga schema is `{ role, description }` with the character's NAME buried
 * in the description prose — there is no name field to match on, so this is a
 * substring test by construction. Full name only, deliberately: matching a
 * single token would tie "Julian" to any archetype mentioning "Julian's
 * dressing room", and a wrong archetype is worse than none because it renders
 * with total confidence.
 */
function describesNpc(archetypeText: string, name: string): boolean {
  const n = norm(name);
  return n.length > 2 && norm(archetypeText).includes(n);
}

export function resolveNpcRole(input: {
  npcId: string;
  name: string;
  introduces?: readonly StepIntroduction[] | null;
  keyArchetypes?: readonly { role: string; description: string }[] | null;
}): ResolvedNpcRole {
  const name = input.name?.trim();
  if (!name) return EMPTY;

  // 1. This turn's own declaration.
  const intro = (input.introduces ?? []).find(
    (i) =>
      i.kind === 'character' &&
      ((i.id && i.id === input.npcId) || norm(i.name) === norm(name)),
  );
  const introNote = intro?.note?.trim() || null;

  // 2. The saga's recurring cast.
  const archetype = (input.keyArchetypes ?? []).find(
    (a) => describesNpc(a.description, name) || describesNpc(a.role, name),
  );

  // The label and the sentence come from ONE field on a cast row (`known`), so
  // joining them unconditionally produced "The Handler — Madame Roux, The
  // Handler". Emit the role only when it adds something the sentence does not,
  // and tolerate an empty role (a `known` too long to be a card label supplies
  // the description alone) rather than prefixing a bare " — ".
  const archetypeLine = archetype
    ? [
        archetype.description.includes(archetype.role.trim()) ? '' : archetype.role.trim(),
        archetype.description.trim(),
      ]
        .filter(Boolean)
        .join(' — ')
    : null;

  // The card label prefers whichever short thing we have; the archetype's
  // `role` ("The Handler") is already a label, whereas its description is a
  // sentence.
  const relationship =
    (introNote && introNote.length <= MAX_RELATIONSHIP_CHARS ? introNote : null) ??
    (archetype?.role.trim() || null) ??
    null;

  // Prompts get everything available, most specific first.
  const archetypeForPrompt =
    [introNote, archetypeLine].filter(Boolean).join(' ').trim() || null;

  return {
    relationship,
    archetype: archetypeForPrompt,
  };
}
