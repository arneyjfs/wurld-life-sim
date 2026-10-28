/**
 * COMP-IMG-8 (docs/specs/composer.md) — images pasted into the chat composer.
 *
 * A registry, like `composerFocus`: `ImagePickerButton` owns the review, so it
 * registers the handler while it is mounted and enabled; the chat `Composer`
 * delivers to it. With nothing registered, the paste is left to the browser.
 */

let handler: ((files: File[]) => void) | null = null;

export function registerComposerImagePaste(fn: ((files: File[]) => void) | null): void {
  handler = fn;
}

/** True when a handler took the files (the caller then swallows the paste). */
export function deliverComposerImagePaste(files: File[]): boolean {
  if (!handler || files.length === 0) return false;
  handler(files);
  return true;
}

/** The pasted image files, in clipboard order. Images only: clipboards don't
 *  carry video content, and text is left to the browser. */
export function imageFilesFrom(data: DataTransfer | null | undefined): File[] {
  const out: File[] = [];
  for (const item of Array.from(data?.items ?? [])) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue;
    const file = item.getAsFile();
    if (file) out.push(file);
  }
  return out;
}
