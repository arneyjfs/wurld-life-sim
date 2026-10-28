/**
 * MSG-VIEW-7 / LIFE-LANG-3 — the unified two-row view model shared by the
 * chat screen and the life sim.
 *
 * The old model was a single 3-valued `viewMode` (`visible` / `hidden` /
 * `native-only`). It could not express NATIVE as the main row with the
 * practice row underneath it — `native-only` suppressed the practice row
 * entirely — so the model is two-dimensional: ONE choice of what the main row
 * says, and ONE independent switch for whether a second row shows at all.
 *
 *   primary     what the MAIN row renders — practice / native
 *   secondRow   the eye. Shows or hides the second row. Nothing else. The
 *               second row's language is always the inverse of primary,
 *               because a row that repeats the row above it is not a row.
 *
 * PERSISTENCE. The ONE stored representation is the `viewSettings` block.
 * The legacy `viewMode` field, the retired Mixed primary (`'mixed'` /
 * `mixedSecond`, MSG-VIEW-7.12) and the `vocabSwap` boolean were migrated
 * out of every document on 2026-09-29; nothing reads or writes them.
 */

export type PrimaryRow = 'practice' | 'native';
export type SecondRowLanguage = 'native' | 'practice';

export type ViewSettings = {
  primary: PrimaryRow;
  /** The eye. True = the second row renders. */
  secondRow: boolean;
};

/** What the stored shape looks like in Firestore (user doc or per-chat map). */
export type StoredViewSettings = {
  viewSettings?: {
    primary?: PrimaryRow;
    secondRow?: boolean;
  };
};

/** What `toStored` writes. */
export type WrittenViewSettings = {
  viewSettings: { primary: PrimaryRow; secondRow: boolean };
};

export const DEFAULT_VIEW_SETTINGS: ViewSettings = {
  primary: 'practice',
  secondRow: true,
};

/**
 * The second row's language. Derived, never stored: a second row showing the
 * same language as the main row is not a second row, so `practice` implies
 * `native` below and vice versa.
 */
export function secondRowLanguage(s: ViewSettings): SecondRowLanguage {
  return s.primary === 'native' ? 'practice' : 'native';
}

/**
 * Read the model from a stored doc: the `viewSettings` block when it carries
 * a primary, else `DEFAULT_VIEW_SETTINGS`.
 */
export function fromStored(stored: StoredViewSettings | undefined): ViewSettings {
  const v = stored?.viewSettings;
  if (v?.primary) {
    return {
      primary: v.primary,
      secondRow: v.secondRow ?? DEFAULT_VIEW_SETTINGS.secondRow,
    };
  }
  return { ...DEFAULT_VIEW_SETTINGS };
}

/**
 * Resolve the effective settings from the two persistence layers: the per-chat
 * override (`chats/{id}.viewSettings[uid]`) and the user-global default
 * (`users/{uid}.viewSettings`).
 *
 *   1. The chat's own `viewSettings` block — the whole answer. Nothing from
 *      the user layer leaks past it.
 *   2. The user layer.
 */
export function resolveViewSettings(
  chat: StoredViewSettings | undefined,
  user: StoredViewSettings | undefined,
): ViewSettings {
  if (chat?.viewSettings?.primary) return fromStored(chat);
  return fromStored(user);
}

/** The stored representation of a model. */
export function toStored(s: ViewSettings): WrittenViewSettings {
  return {
    viewSettings: { primary: s.primary, secondRow: s.secondRow },
  };
}

/**
 * The render-facing flags the bubble/beat components consume.
 */
export type RowFlags = {
  /** The native row renders (as main row when `practiceSuppressed`). */
  showNative: boolean;
  /** Native is the MAIN row; the practice row is not the primary. */
  practiceSuppressed: boolean;
  /** MSG-VIEW-7: practice renders as the SECOND row, beneath native.
   *  No legacy state produced this, which is why it is its own flag. */
  showPracticeSecondRow: boolean;
};

/**
 * MSG-VIEW-3 — the face a bubble shows: the view mode's default, or with a
 * flip the other one (the second row inverted). Never a third row.
 */
export function faceSettings(s: ViewSettings, flipped: boolean): ViewSettings {
  return flipped ? { ...s, secondRow: !s.secondRow } : s;
}

export function rowFlags(s: ViewSettings): RowFlags {
  const native = s.primary === 'native';
  return {
    showNative: native || s.secondRow,
    practiceSuppressed: native,
    showPracticeSecondRow: native && s.secondRow,
  };
}
