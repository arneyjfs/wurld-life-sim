/**
 * LIFE-NPC-2 (v2): assemble an avatar SVG from generator-chosen params.
 *
 * The model returns a tiny JSON naming a part per slot (plus colours); this
 * composes the library back-to-front into a finished portrait. If any slot
 * names an unknown part the result is `null` and the caller falls back to the
 * lean direct-SVG draw — a hallucinated part name can never produce a broken
 * avatar.
 *
 * Layer order matters: hair/headwear each contribute a BACK mass (behind the
 * head) and a FRONT mass, so the portrait reads as one drawing.
 */
import { z } from 'zod';
import {
  bg, faceBase, torso, shade,
  EYES, BROWS, MOUTH, FACIAL_HAIR, HAIR, HEADWEAR, OUTFIT, OUTFIT_BACK, ACCESSORY,
} from './parts';

/** Headwear that ENCLOSES the skull. Hair is suppressed ENTIRELY — a hood that
 *  an afro or a set of dreads bursts out of doesn't read as being worn. */
const ENCLOSING_HEADWEAR = new Set(['hood', 'helmet']);

/** Headwear with a dome/crown that sits on the skull. */
const DOMED_HEADWEAR = new Set([
  'cap', 'beanie', 'bandana', 'strawHat', 'topHat', 'chefHat', 'beret',
  'turban', 'witchHat', 'crown', 'hood', 'helmet',
]);

/** Hairstyles whose FRONT mass rises above the hat line. Under a dome they are
 *  suppressed — otherwise spikes and knots skewer straight through the hat. */
const TALL_HAIR = new Set(['spiky', 'mohawk', 'dreads', 'topKnot']);

const hex = z.string().regex(/^#[0-9a-fA-F]{3,8}$/);
const styled = z.object({ style: z.string(), color: hex.optional() });

/** What the generator returns. Slot NAMES are validated at assemble time (an
 *  unknown name is a fallback signal, not a parse error). */
export const ZAvatarParams = z.object({
  bg: hex.optional(),
  skin: hex.optional(),
  hair: styled.optional(),
  facialHair: styled.optional(),
  eyes: z.string().optional(),
  brows: z.string().optional(),
  mouth: z.string().optional(),
  headwear: styled.optional(),
  outfit: styled.optional(),
  accessory: z.string().optional(),
  /** The generator's explicit "the library can't do this character" signal. */
  fallback: z.boolean().optional(),
});
export type AvatarParams = z.infer<typeof ZAvatarParams>;

const D = {
  skin: '#f4c9a3', bg: '#efe7f6', hairColor: '#6b4a2f',
  hwColor: '#7c6ff0', outColor: '#cfc7f0',
  hair: 'short', facialHair: 'none', headwear: 'none', outfit: 'plain',
  eyes: 'almond', brows: 'neutral', mouth: 'smile', accessory: 'none',
};

export type AssembleResult = { svg: string | null; errors: string[] };

export function assembleAvatar(p: AvatarParams = {}): AssembleResult {
  const errors: string[] = [];
  const need = <T>(lib: Record<string, T>, name: string, slot: string): T | null => {
    const fn = lib[name];
    if (!fn) { errors.push(`${slot}=${name}`); return null; }
    return fn;
  };

  const hairColor = p.hair?.color ?? D.hairColor;
  const HAIRf = need(HAIR, p.hair?.style ?? D.hair, 'hair');
  const FHf = need(FACIAL_HAIR, p.facialHair?.style ?? D.facialHair, 'facialHair');
  const HWf = need(HEADWEAR, p.headwear?.style ?? D.headwear, 'headwear');
  const OUTf = need(OUTFIT, p.outfit?.style ?? D.outfit, 'outfit');
  const EYEf = need(EYES, p.eyes ?? D.eyes, 'eyes');
  const BROWf = need(BROWS, p.brows ?? D.brows, 'brows');
  const MOUTHf = need(MOUTH, p.mouth ?? D.mouth, 'mouth');
  const ACCf = need(ACCESSORY, p.accessory ?? D.accessory, 'accessory');
  if (errors.length || !HAIRf || !FHf || !HWf || !OUTf || !EYEf || !BROWf || !MOUTHf || !ACCf) {
    return { svg: null, errors };
  }

  const skin = p.skin ?? D.skin;
  const outfitName = p.outfit?.style ?? D.outfit;
  const outfitColor = p.outfit?.color ?? D.outColor;
  const hwName = p.headwear?.style ?? D.headwear;
  const hairName = p.hair?.style ?? D.hair;
  const enclosed = ENCLOSING_HEADWEAR.has(hwName);
  const raw = HAIRf(hairColor);
  const hair = enclosed
    ? { back: '', front: '' }
    : { back: raw.back, front: DOMED_HEADWEAR.has(hwName) && TALL_HAIR.has(hairName) ? '' : raw.front };
  const hw = HWf(p.headwear?.color ?? D.hwColor);

  const layers = [
    bg(p.bg ?? D.bg),
    // Garment mass that hangs behind the head (a bunched hood) — drawn before
    // the face so the neck rises OUT of the collar, not behind the garment.
    OUTFIT_BACK[outfitName]?.(outfitColor) ?? '',
    hair.back,
    hw.back,
    faceBase(skin),
    // Bare shoulders in skin, so sleeveless garments expose skin not background.
    torso(skin),
    OUTf(outfitColor, skin),
    hair.front,
    FHf(p.facialHair?.color ?? hairColor),
    BROWf(shade(hairColor, 0.7)),
    EYEf(),
    MOUTHf(),
    hw.front,
    ACCf(),
  ];
  return {
    svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${layers.join('')}</svg>`,
    errors: [],
  };
}
