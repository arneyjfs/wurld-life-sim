/**
 * Assembles an avatar SVG from a params object, composing the part library
 * back-to-front. Returns { svg, errors }: if any slot names an unknown option
 * the svg is null and the caller falls back to the lean direct-SVG draw.
 *
 * Layer order matters — hair/headwear each contribute a BACK mass (behind the
 * head, giving volume + hoods) and a FRONT mass (hairline, brim), so the
 * portrait reads as one drawing rather than stacked stickers.
 */
import {
  bg, faceBase, shade,
  EYES, BROWS, MOUTH, FACIAL_HAIR, HAIR, HEADWEAR, OUTFIT, ACCESSORY,
} from './parts.mjs';

const D = {
  skin: '#f4c9a3', bg: '#efe7f6', hairColor: '#6b4a2f',
  hwColor: '#7c6ff0', outColor: '#cfc7f0',
  hair: 'short', facialHair: 'none', headwear: 'none', outfit: 'plain',
  eyes: 'almond', brows: 'neutral', mouth: 'smile', accessory: 'none',
};

/** A part may return a plain string or { back, front }. */
const split = (v) =>
  typeof v === 'string' || v == null
    ? { back: '', front: v ?? '' }
    : { back: v.back ?? '', front: v.front ?? '' };

export function assembleAvatar(p = {}) {
  const errors = [];
  const need = (lib, name, slot) => {
    if (!(name in lib)) { errors.push(`${slot}=${name}`); return null; }
    return lib[name];
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
  if (errors.length) return { svg: null, errors };

  const hair = split(HAIRf(hairColor));
  const hw = split(HWf(p.headwear?.color ?? D.hwColor));

  const layers = [
    bg(p.bg ?? D.bg),
    hair.back,
    hw.back,
    faceBase(p.skin ?? D.skin),
    OUTf(p.outfit?.color ?? D.outColor),
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
