/**
 * SRV-PROMPT-5 / CARDS-LIST-8 — the card-editor's phrase translator.
 *
 * The two arrow buttons in `CardEditorSheet` translate one short phrase between
 * the native and practice sides of a flashcard. It is the smallest prompt in
 * the app and was the last non-life-sim one still built in the bundle.
 *
 * Small is not the same as unimportant. It is the prompt most likely to need a
 * per-language tweak after release — "return a single word if the input is a
 * single word" is the kind of rule that holds in French and fails in German
 * compounds — and a prompt in the bundle is frozen into any native binary
 * (`capacitor.config.ts` sets `webDir: 'dist'` with no `server.url`), so
 * correcting it would need an App Store review. Here it needs
 * `deploy:prod:functions`.
 *
 * NOT moved: `temperature` and `responseMimeType`. Those are generation
 * parameters the CALL SITE owns and MSG-PIPE-23 requires it to name out loud;
 * they are not prompt text, and hiding them server-side would make the value
 * nobody chose invisible again — which is the whole failure MSG-PIPE-23 exists
 * to prevent.
 *
 * The prose below is byte-identical to the client copy it replaces. It was
 * moved unchanged: this is a relocation, not a prompt edit, and mixing the two
 * would make any output difference impossible to attribute.
 */

export function cardTranslateSystemInstruction(from: string, to: string): string {
  return (
    `You translate a single short phrase or word from ${from} to ${to} for a flashcard. ` +
    `Return ONLY the translated text — no quotes, no labels, no explanation, no source language echo. ` +
    `Preserve register (formal vs casual) and grammatical form. If the input is a single word, return a single word.`
  );
}

export function cardTranslateUserPrompt(text: string, from: string, to: string): string {
  return `Translate this ${from} phrase to ${to}: ${text}`;
}
