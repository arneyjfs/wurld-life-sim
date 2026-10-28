import {
  doc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { callHttp } from './endpoints';
import { currentAppLanguageName } from './appLanguage';
import * as log from './log';

/** Synthetic UID for the tutor agent (never collides with real Firebase
 *  UIDs). Mirror of source constants/tutor.ts. */
export const TUTOR_UID = 'wurld-tutor-agent';
export const TUTOR_DISPLAY_NAME = 'Wurld Language Assistant 🤖';

export function isTutorUid(uid: string | undefined | null): boolean {
  return uid === TUTOR_UID;
}

function buildDirectKey(uid1: string, uid2: string): string {
  return [uid1, uid2].sort().join('_');
}

/** Deterministic Firestore doc id for the 1:1 chat between two UIDs.
 *  Two callers with the same pair always resolve to the same doc, so any
 *  concurrent create attempts collapse onto one chat. */
export function directChatId(uid1: string, uid2: string): string {
  return `direct_${buildDirectKey(uid1, uid2)}`;
}

/**
 * Idempotent first-launch tutor bootstrap. Creates (or no-ops) the
 * synthetic tutor contact + the 1:1 chat doc. Returns whether the chat
 * was just created so the caller can drop a welcome message exactly
 * once. Mirror of source services/chatService.ts:1234 ensureTutorChat.
 */
export async function ensureTutorChat(
  uid: string,
  displayName: string,
): Promise<{ chatId: string; isNew: boolean }> {
  const chatId = directChatId(uid, TUTOR_UID);

  // 1. Tutor contact — deterministic id under the user's contacts
  //    sub-collection. setDoc with merge is idempotent.
  await setDoc(
    doc(db, 'users', uid, 'contacts', TUTOR_UID),
    {
      uid: TUTOR_UID,
      name: TUTOR_DISPLAY_NAME,
      phoneNumber: '',
      isOnWurld: true,
      createdAt: serverTimestamp(),
    },
    { merge: true },
  );

  // 2. Chat doc — atomic create-if-not-exists via transaction; isNew is
  //    authoritative across concurrent callers.
  const chatRef = doc(db, 'chats', chatId);
  const isNew = await runTransaction(db, async (tx) => {
    const snap = await tx.get(chatRef);
    if (snap.exists()) return false;
    tx.set(chatRef, {
      isGroup: false,
      members: [uid, TUTOR_UID],
      memberNames: { [uid]: displayName, [TUTOR_UID]: TUTOR_DISPLAY_NAME },
      memberPhones: {},
      unreadCounts: { [uid]: 0, [TUTOR_UID]: 0 },
      directKey: buildDirectKey(uid, TUTOR_UID),
      lastMessage: '',
      lastMessageAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    });
    return true;
  });

  return { chatId, isNew };
}

/**
 * Write a canned tutor-authored message with a deterministic doc id so
 * repeat calls (same chat, same messageId) collapse to a no-op. Returns
 * isNew=true only when this call actually created the doc.
 *
 * No `sendStatus` / `pipeline.state` — these messages are server-
 * authored and never go through processMessagePipeline, so stamping
 * them with `translating` would leave the bubble stuck on a spinner.
 *
 * Retained as a tested primitive; the onboarding flow no longer uses it
 * (the server authors setup messages directly — see `requestSetupTrigger`).
 *
 * ⚠ DO NOT REVIVE THIS FROM THE CLIENT. Since LANG-SEC-1, `firestore.rules`
 * requires `senderId == request.auth.uid` on message create, and this writes
 * `senderId: TUTOR_UID`. It is safe today only because nothing calls it — its
 * own tests mock Firestore and so never meet the rule. A caller added from the
 * client would fail with a permission error at runtime and pass every unit
 * test. Author tutor messages server-side, where the Admin SDK bypasses rules.
 */
export async function writeTutorMessage(
  chatId: string,
  messageId: string,
  text: string,
  language: string,
): Promise<{ messageId: string; isNew: boolean }> {
  const msgRef = doc(db, 'chats', chatId, 'messages', messageId);
  const isNew = await runTransaction(db, async (tx) => {
    const snap = await tx.get(msgRef);
    if (snap.exists()) return false;
    tx.set(msgRef, {
      senderName: TUTOR_DISPLAY_NAME,
      senderId: TUTOR_UID,
      originalText: text,
      originalLanguage: language,
      translations: {},
      createdAt: serverTimestamp(),
      deletedForEveryone: false,
    });
    return true;
  });

  if (isNew) {
    await updateDoc(doc(db, 'chats', chatId), {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
    }).catch(() => {});
  }
  return { messageId, isNew };
}

/** Convenience — ensures the tutor chat + opens the onboarding walkthrough,
 *  suitable for a one-shot post-sign-in bootstrap effect.
 *
 *  On a NEW tutor chat it fires the setup `seed` trigger; the server authors
 *  the bilingual "offer the tour" message (with quick-reply buttons) and
 *  flips `tutorMemory.setup.active` on (TUTOR-SETUP-5). The bubble renders in
 *  the default 'visible' (both-rows) mode like any other tutor message.
 *
 *  Duplicate tutor chats (legacy non-deterministic ids) are merged at the UI
 *  layer by `useChats`' directKey-dedupe pass. Failures are non-fatal.
 *  (The per-sign-in `cleanupLegacyTutorContacts` sweep was deleted 2026-09-29
 *  after the one-off admin sweep — wurld-tutor.md design decisions.)
 *
 *  The chat doc id is deterministic (`direct_<sortedUids>`), so deleting
 *  the chat and signing back in re-creates the SAME chatId with a fresh
 *  walkthrough — by design, it prevents accidental duplicate 1:1 threads.
 */
// Session guard — the "Once" in the name was previously aspirational:
// the App-level caller re-fires on every profile-doc emit (snapshot
// identity changes per emit), and every call here issued a contact
// setDoc with a fresh serverTimestamp — a REAL mutation, which emits,
// which can re-trigger upstream effects. Trace-measured 2026-06-12:
// 58 contacts-listener emits in 2.8s on a single page load, after
// which the Firestore SDK backed off and ALL delivery (including
// incoming chat messages) stalled >25s.
//
// ONE attempt per uid per session, INCLUDING failures: a first
// version of this guard released on throw so the next profile emit
// could retry — under a degraded connection that turned into a
// retry loop issuing a contact WRITE per attempt (54 in one trace),
// starving every other write behind it. A missed welcome from a
// transient failure self-heals on the next page load; a write storm
// doesn't.
const bootstrapAttempted = new Set<string>();

export async function bootstrapTutorChatOnce(opts: {
  uid: string;
  displayName: string;
  nativeLanguage: string;
  practiceLanguage: string;
  difficulty?: number;
}): Promise<{ chatId: string; bootstrapped: boolean }> {
  if (bootstrapAttempted.has(opts.uid)) {
    return { chatId: directChatId(opts.uid, TUTOR_UID), bootstrapped: false };
  }
  bootstrapAttempted.add(opts.uid);
  return bootstrapTutorChatInner(opts);
}

/**
 * Clear the once-per-session bootstrap guard for a uid so the NEXT
 * `bootstrapTutorChatOnce` call re-runs (re-creates the tutor chat + re-seeds
 * the walkthrough). Call this when the user deletes their tutor chat — the
 * deterministic chat id re-creates as a brand-new chat (`isNew`), so the
 * seed fires again. Only the tutor chat triggers this; users who simply keep
 * their existing chat are never re-seeded (TUTOR-SETUP-5).
 */
export function resetTutorBootstrap(uid: string): void {
  bootstrapAttempted.delete(uid);
}

async function bootstrapTutorChatInner(opts: {
  uid: string;
  displayName: string;
  nativeLanguage: string;
  practiceLanguage: string;
  difficulty?: number;
}): Promise<{ chatId: string; bootstrapped: boolean }> {
  const { chatId, isNew } = await ensureTutorChat(opts.uid, opts.displayName);
  if (!isNew) return { chatId, bootstrapped: false };
  // New tutor chat → open the onboarding WALKTHROUGH (TUTOR-SETUP-5). The
  // server authors the bilingual "offer the tour" message + its quick-reply
  // buttons and flips `tutorMemory.setup.active` on. Fire-and-forget: the
  // message lands via the chat's Firestore listener. No viewMode override —
  // new tutor chats open in the default 'visible' (both-rows) mode so the
  // bilingual experience is visible from the first message. This replaces
  // the old native-only welcome + composer-lock onboarding (the composer is
  // now always usable; the tour drives discovery via triggers).
  void requestTutorReply({ chatId, setupTrigger: 'seed' }).catch((err) =>
    log.error(err, { action: 'tutorSetup', setupTrigger: 'seed' }), // OBS-COVER-6
  );
  return { chatId, bootstrapped: true };
}

// ---- Tutor reply pipeline --------------------------------------------------

/**
 * Minimal request shape — the server reads everything else (user
 * message text, language pair, difficulty, pronouns, conversation
 * history, memories) from Firestore itself. See
 * `functions/src/index.ts` tutorRespond and
 * `functions/src/tutorContext.ts`.
 *
 * `userMessageId` doubles as the dedup key: identical inputs (same
 * id) collapse onto a single tutor reply doc via deterministic id +
 * atomic create (TUTOR-INV-5).
 */
/**
 * Setup-mode triggers (TUTOR-SETUP-5). `seed` opens the walkthrough on a
 * new tutor chat with the welcome message; `skip` force-exits it; the rest
 * are step events fired by the UI as the user completes a step
 * (`view_mode_set` / `translation_peeked` / `first_flashcard_added`). The
 * first step (`send_message` → `message_sent`) is completed by the user's
 * first free-text reply, inferred server-side — not a client trigger. Mirror
 * of the server's `TutorSetupTrigger` + the two control values. */
export type ClientSetupTrigger =
  | 'seed'
  | 'skip'
  | 'view_mode_set'
  | 'translation_peeked'
  | 'first_flashcard_added'
  /** TUTOR-SETUP-21 — the panel's "Continue to chat" button. Authors the
   *  handover question; the tour exits after the demo turn that answers it. */
  | 'continue_to_chat';

export type TutorRespondRequest = {
  chatId: string;
  /** Present for a reply to a user message; omitted for a pure setup
   *  trigger (a button tap or a UI event with no user message). */
  userMessageId?: string;
  /** When set, routes the call to the server's setup-mode branch
   *  (TUTOR-SETUP-5). */
  setupTrigger?: ClientSetupTrigger;
  /** The user's app/display language name — the tutor's explain action writes
   *  its prose + glosses in this (TUTOR-ACTION-7). Injected by
   *  `requestTutorReply`; callers don't set it. */
  appLanguage?: string;
};

/**
 * Generate the tutor's reply to a user message. Server writes the reply
 * doc directly into the chat's messages subcollection; this call returns
 * once the reply has been queued (typically the response includes the
 * resulting message id).
 */
export async function requestTutorReply(
  req: TutorRespondRequest,
): Promise<void> {
  // Attach the app language so a tutor explain renders in the user's display
  // language (TUTOR-ACTION-7). Caller-provided value wins if ever set.
  const appLanguage = req.appLanguage ?? currentAppLanguageName();
  await callHttp<TutorRespondRequest, unknown>('tutorRespond', {
    ...req,
    ...(appLanguage ? { appLanguage } : {}),
  });
}

/**
 * Fire a setup-mode trigger (TUTOR-SETUP-5/9). The server authors the next
 * bilingual walkthrough message (or, for `skip`, exits setup with no
 * message). Fire-and-forget: the message lands via the chat's Firestore
 * listener, and the server dedups re-fired triggers on a deterministic doc
 * id, so a double-tap is harmless.
 */
export async function requestSetupTrigger(
  chatId: string,
  setupTrigger: ClientSetupTrigger,
): Promise<void> {
  await requestTutorReply({ chatId, setupTrigger });
}
