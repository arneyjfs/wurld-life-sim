/**
 * Message-content text direction (MSG-VIEW-4).
 *
 * This is the CONTENT axis — the script of the text a bubble row actually
 * paints — NOT the UI-locale axis (I18N-6, which flips `<html dir>` for the app
 * chrome). A viewer on an English UI can be practicing Arabic, so a bubble row
 * is RTL while the chrome stays LTR. Direction is detected from the displayed
 * text, never from `originalText` (MSG-VIEW-2).
 */

/** Hebrew / Arabic / Syriac / Thaana / NKo / Samaritan / Arabic Presentation
 *  Forms. Built via String.fromCharCode + RegExp so the source file stays ASCII
 *  (no literal RTL glyphs to trip no-irregular-whitespace). */
const RTL_RE = new RegExp(
  '[' +
    String.fromCharCode(0x0590) + '-' + String.fromCharCode(0x05ff) +
    String.fromCharCode(0x0600) + '-' + String.fromCharCode(0x06ff) +
    String.fromCharCode(0x0700) + '-' + String.fromCharCode(0x074f) +
    String.fromCharCode(0x0750) + '-' + String.fromCharCode(0x077f) +
    String.fromCharCode(0xfb50) + '-' + String.fromCharCode(0xfdff) +
    String.fromCharCode(0xfe70) + '-' + String.fromCharCode(0xfeff) +
  ']',
);

/** True iff `s` contains any RTL-script character. */
export function isRtlText(s: string | undefined | null): boolean {
  return !!s && RTL_RE.test(s);
}

export type TextDir = 'rtl' | 'ltr';

/** The base direction for a run of text, from its script. */
export function dirOf(s: string | undefined | null): TextDir {
  return isRtlText(s) ? 'rtl' : 'ltr';
}
