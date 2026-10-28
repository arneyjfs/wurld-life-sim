// Trending toward the §1 600-LOC cap. Next extraction candidates:
// <FollowUpComposer/>, <ExplanationSections/>. The CachedExplanation map +
// in-flight-save / saved-phrases module state stay at module top.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Loader, Send, Sparkles, X } from 'lucide-react';
import { addFlashCard, deleteFlashcard } from '@/lib/flashcards';
import { streamGemini } from '@/lib/gemini';
import { CLIENT_TEMPERATURE } from '@/lib/geminiTemperature';
import {
  buildAiReviewFeedback,
  submitTranslationFeedback,
} from '@/lib/translationFeedback';
// SRV-PROMPT-6 — the PARSER and the types, never the prompts. All six prompt
// builders moved to `functions/src/prompts/explain.ts`; this file now sends a
// `promptSpec` and lets the server assemble the text.
import {
  parseExplanationXML,
  type ExplainPracticeQuestion,
  type ParsedExplanation,
  type ParsedSection,
} from '@/lib/explain';
import type { PracticePromptSpec } from '@/lib/practicePromptSpec';
import { useAuthStore } from '@/store/authStore';
import { useUIStore } from '@/store/uiStore';
import { useUserProfile } from '@/hooks/useUserProfile';
import type { Message, Difficulty } from '@/types/firestore';
import { toUserMessage } from '@/lib/errors';
import { cn } from '@/lib/cn';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { CenteredSpinner } from '@/components/CenteredSpinner';
// LANG-TIER-1.1 — explain is Plus-only; see the `entitled` note below.
import { NeedsPlus } from '@/components/NeedsPlus';
import { canExplain } from '@/lib/languageTier';
import { useT } from '@/i18n';
import { Composer } from '@/components/MessageInput/Composer';
import {
  LanguageCards,
  PracticeAnswerCheckCard,
  ReviewCard,
  SectionCard,
  copyText,
} from './SimpleMarkdown';
import { OriginalDisclosure } from './OriginalDisclosure';
import { ExplainReport } from './ExplainReport';
import { explanationReportText } from './explanationReportText';
import { originalDisclosureSource } from './originalDisclosureSource';
import * as log from '@/lib/log';
import { readLanguageRow } from '@/lib/languageKeys';

type Props = {
  open: boolean;
  onClose: () => void;
  /** Chat-mode message (required when `practiceQuestion` is unset). In
   *  practice mode this is null and the practice props below drive the
   *  stream. */
  message: Message | null;
  /** Chat id — empty string is allowed in practice mode (no chat
   *  context to attach AI feedback to). */
  chatId: string;
  practiceLanguage: string;
  nativeLanguage: string;
  /** The translated text (target = native if message was sent in practice, etc.). */
  translatedText: string;
  /** Optional ±2 surrounding messages for context. */
  contextMessages?: { sender: string; text: string }[];
  wordDifficulty?: Difficulty;
  /** PRACTICE-EXPLAIN-2: when set, switches the modal into practice
   *  mode — the stream uses the practice prompt, `LanguageCards` is
   *  suppressed, and the auto-feedback path is skipped. */
  practiceQuestion?: ExplainPracticeQuestion;
  /** User's submitted answer (string). Required when `practiceQuestion`
   *  is set. */
  userAnswer?: string;
  /** Whether the system marked the answer correct. Required when
   *  `practiceQuestion` is set — the LLM uses this to decide whether to
   *  overturn. */
  wasCorrect?: boolean;
  /** PRACTICE-EXPLAIN-4: fired once when a `verdict === 'overturned'`
   *  is parsed for a fresh stream. Re-opens of a cached overturned
   *  explanation do NOT re-fire — the parent's flip is idempotent on
   *  the question id, but the modal only owns the cache key, so we
   *  guard inside. */
  onOverrideCorrect?: () => void;
};

type FollowUpEntry =
  | { kind: 'question'; text: string }
  | { kind: 'answer'; sections: ParsedSection[]; streaming: boolean };

type CachedExplanation = {
  parsed: ParsedExplanation;
  rawXml: string;
  followUps: FollowUpEntry[];
  /** Phrases the user has saved while viewing this explanation. Module-
   *  level so the toggle-state survives close/reopen and the user can't
   *  double-save the same card. */
  savedPhrases: Set<string>;
  /** phrase → cardId map for the saved cards, used to delete on a second
   *  tap of the same save button. Module-level for the same reason. */
  phraseCardIds: Map<string, string>;
};

/**
 * In-memory cache so reopening the modal for the same message restores the
 * full explanation + any follow-up conversation. Keyed by
 * `${messageId}::${practiceLanguage}::${nativeLanguage}::${difficulty}`.
 *
 * LRU-bounded at MAX_CACHE_ENTRIES — on write we delete the oldest key
 * (Map iterates in insertion order). Without a cap every explanation
 * ever opened sat in memory for the lifetime of the tab.
 */
const MAX_CACHE_ENTRIES = 30;
const explanationCache = new Map<string, CachedExplanation>();

function setCacheEntry(key: string, entry: CachedExplanation): void {
  // Refresh insertion order so re-saving an existing entry promotes it
  // to "most recently used".
  explanationCache.delete(key);
  explanationCache.set(key, entry);
  while (explanationCache.size > MAX_CACHE_ENTRIES) {
    const oldest = explanationCache.keys().next().value;
    if (oldest === undefined) break;
    explanationCache.delete(oldest);
  }
}

/**
 * In-flight save guard. Keyed by `${uid}::${phrase}` so two rapid taps —
 * or a tap-then-close-then-reopen-then-tap-again sequence — can't queue
 * two `addFlashCard` writes for the same phrase. We use a module-level
 * Set instead of component state because the modal may unmount mid-save,
 * which would otherwise reset the guard.
 */
const inFlightSaves = new Set<string>();

function inFlightKey(uid: string, phrase: string): string {
  return `${uid}::${phrase}`;
}

function cacheKey(messageId: string, practice: string, native: string, diff: number): string {
  return `${messageId}::${practice}::${native}::${diff}`;
}

function practiceCacheKey(
  q: ExplainPracticeQuestion,
  userAnswer: string,
  practice: string,
  native: string,
  diff: number,
): string {
  // Truncated instruction makes the key human-debuggable; the answer +
  // correctAnswer + practice text are the discriminators.
  const slug = q.instruction.slice(0, 40).replace(/\s+/g, '-');
  return `practice::${q.questionType}::${slug}::${q.correctAnswer}::${userAnswer}::${practice}::${native}::${diff}`;
}

/**
 * Streaming AI explanation overlay. Portal'd, frosted backdrop, scrollable
 * body, follow-up input at bottom. Source: components/ExplainModal.tsx.
 */
export function ExplainModal({
  open,
  onClose,
  message,
  chatId,
  practiceLanguage,
  nativeLanguage,
  translatedText,
  contextMessages,
  wordDifficulty = 2,
  practiceQuestion,
  userAnswer,
  wasCorrect,
  onOverrideCorrect,
}: Props) {
  const t = useT();
  const isPracticeMode = practiceQuestion != null;
  const originalSource = originalDisclosureSource(message, practiceLanguage, nativeLanguage);
  const user = useAuthStore((s) => s.user);
  const profile = useUserProfile(user?.uid ?? null);
  const pushToast = useUIStore((s) => s.pushToast);

  // PRACTICE-EXPLAIN-10: practice cache key folds in the user's answer so
  // re-answering the same question with a different text doesn't restore
  // the previous explanation.
  const key = isPracticeMode && practiceQuestion
    ? practiceCacheKey(
        practiceQuestion,
        userAnswer ?? '',
        practiceLanguage,
        nativeLanguage,
        wordDifficulty,
      )
    : message
      ? cacheKey(message.id, practiceLanguage, nativeLanguage, wordDifficulty)
      : '';

  // Parent components often pass a freshly-built `contextMessages` array
  // on every render. Derive a stable string key from message ids so the
  // streaming effect doesn't re-fire each render. If a parent passes
  // contextMessages without stable ids it'll fall back to the surface
  // text — still better than referential identity.
  const contextKey = useMemo(() => {
    if (!contextMessages) return '';
    return contextMessages.map((m) => `${m.sender}|${m.text}`).join('');
  }, [contextMessages]);

  const [explanation, setExplanation] = useState<ParsedExplanation | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUpEntry[]>([]);
  // savedPhrases mirrors the module-level cache entry so we get re-renders
  // on save/unsave; the source of truth is the cache.
  const [savedPhrases, setSavedPhrases] = useState<Set<string>>(new Set());
  const [savingPhrase, setSavingPhrase] = useState<string | null>(null);
  const [followUpDraft, setFollowUpDraft] = useState('');
  const [submittingFollowUp, setSubmittingFollowUp] = useState(false);
  const rawXmlRef = useRef<string>('');

  // Abort + alive ref for the in-flight follow-up stream. Cleared on modal
  // close (or key change) so a late chunk after abort doesn't write to
  // stale state.
  const followUpAbortRef = useRef<AbortController | null>(null);
  const followUpAliveRef = useRef(true);

  // PRACTICE-EXPLAIN-4: override guard — once the parent has been told
  // "this answer overturned", we must not re-fire even if React strict-
  // mode re-runs the effect. The flag is scoped to the cache key so a
  // fresh answer on the same question (different userAnswer → different
  // key) gets a clean evaluation.
  const overrideFiredRef = useRef<string | null>(null);

  /**
   * LANG-TIER-1.1 — Explain is Plus-only, and this is the client half.
   *
   * ⚠ The gate is HERE, not on the three affordances that open this modal.
   * `ChatScreen`'s long-press menu, `PracticeScreen`'s post-answer "Why?" and
   * the Wurlds feedback overlay all mount this component; a gate on any one of
   * them is a gate with two holes in it, and the third is the one nobody would
   * think to check. One component, one decision.
   *
   * Hiding the menu item was the alternative and was rejected: a feature
   * nobody can see is a feature nobody upgrades for, and the tap is the exact
   * moment the reader has decided they want this. The affordance stays; the
   * modal carries the offer.
   *
   * `null` while the profile loads means "not decided yet" — deciding on an
   * unloaded doc would show the upgrade panel to a paying user on every cold
   * boot, because the predicate fails closed (LANG-SEC-2).
   */
  const [nowAtMount] = useState(() => Date.now());
  const entitled = profile.loading ? null : canExplain(profile.data, nowAtMount);

  function fireOverrideOnce(parsed: ParsedExplanation, k: string) {
    if (!isPracticeMode || !onOverrideCorrect) return;
    if (overrideFiredRef.current === k) return;
    if (parsed.review?.verdict === 'overturned') {
      overrideFiredRef.current = k;
      onOverrideCorrect();
    }
  }

  // ─── Stream the main explanation when the modal opens for a new key ─────
  useEffect(() => {
    if (!open || !key) return;
    // LANG-TIER-1.1 — the assertion that matters is this one, not the panel
    // below: an unentitled viewer must never reach `streamGemini`. `null`
    // (profile still loading) waits rather than spends.
    if (entitled !== true) return;
    // Chat mode requires a message; practice mode requires the practice
    // payload. Either path produces a non-empty key, but we still gate
    // on the inputs the stream call needs.
    if (!isPracticeMode && !message) return;
    if (isPracticeMode && (!practiceQuestion || userAnswer == null)) return;
    const cached = explanationCache.get(key);
    if (cached) {
      // Restore from cache and don't re-stream.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExplanation(cached.parsed);
      setFollowUps(cached.followUps);
      setSavedPhrases(new Set(cached.savedPhrases));
      rawXmlRef.current = cached.rawXml;
      // PRACTICE-EXPLAIN-4: re-opens of a cached overturned explanation
      // do NOT re-fire — the override has already been applied for this
      // key on the original stream.
      return;
    }

    setExplanation(null);
    setFollowUps([]);
    setSavedPhrases(new Set());
    setStreaming(true);
    rawXmlRef.current = '';
    const controller = new AbortController();
    let alive = true;
    let accumulated = '';
    (async () => {
      try {
        // SRV-PROMPT-6 — data, not prose. Two DIFFERENT kinds rather than one
        // with a mode flag: PRACTICE-EXPLAIN-3 is explicit that the chat and
        // practice instructions must not be confused, and a flag is how they
        // would be.
        const promptSpec: PracticePromptSpec = isPracticeMode && practiceQuestion
          ? {
              kind: 'explain_practice',
              practice: practiceLanguage,
              native: nativeLanguage,
              question: practiceQuestion,
              userAnswer: userAnswer ?? '',
              wasCorrect: wasCorrect ?? false,
              wordDifficulty,
            }
          : {
              kind: 'explain',
              practice: practiceLanguage,
              native: nativeLanguage,
              // Read the original-language TRANSLATION field, never
              // message.originalText — the explain prompt must reason about the
              // corrected/identity text the pipeline stored, not a stale stored
              // original (the pipeline copies the message into
              // translations[originalLanguage]).
              originalText:
                readLanguageRow(message!.translations, message!.originalLanguage)?.text ?? translatedText,
              originalLanguage: message!.originalLanguage,
              translatedText,
              contextMessages,
              wordDifficulty,
              senderName: profile.data?.displayName,
              senderPronouns: profile.data?.pronouns,
            };
        for await (const chunk of streamGemini(
          // `thinkingLevel: 'minimal'` disables the reasoning step so the first
          // text token arrives ~1–3s sooner. The explain prompt's XML structure
          // already forces the model to plan via the <review>/<section> shape —
          // extra hidden thinking just delays TTFT.
          //
          // ⚠ THIS WAS `thinkingBudget: 0`, and the note explaining why is now
          // history rather than a constraint: 'minimal' was tried and REJECTED
          // by gemini-2.5-flash, whose only knob was the numeric budget. Every
          // 2.x model has since been retired (404 on generateContent), so the
          // model that forced the workaround no longer answers and the knob it
          // needed is not one the surviving 3.x models take. The server still
          // TRANSLATES a legacy `thinkingBudget: 0` to this same level, so a
          // client running an older bundle keeps the TTFT win rather than
          // silently paying for reasoning it declined.
          // OBS-USAGE — `explain` / `explain_practice` / `explain_followup` were all
          // registered in USAGE_CATEGORIES and all receiving nothing: the server
          // reads `category` off the stream body, but the client's request type
          // had no such field, so every streamed call booked to `unknown`.
          { promptSpec, thinkingLevel: 'minimal', temperature: CLIENT_TEMPERATURE.exposition, category: isPracticeMode ? 'explain_practice' : 'explain' },
          controller.signal,
        )) {
          if (!alive || controller.signal.aborted) return;
          accumulated += chunk;
          const parsed = parseExplanationXML(accumulated);
          if (parsed.sections.length > 0 || parsed.review) {
            setExplanation(parsed);
          }
        }
        if (!alive || controller.signal.aborted) return;
        const final = parseExplanationXML(accumulated);
        setExplanation(final);
        rawXmlRef.current = accumulated;
        setCacheEntry(key, {
          parsed: final,
          rawXml: accumulated,
          followUps: [],
          savedPhrases: new Set(),
          phraseCardIds: new Map(),
        });
        // PRACTICE-EXPLAIN-4: surface verdict overturn to the parent.
        // Idempotent per cache key — guarded inside the helper.
        fireOverrideOnce(final, key);
        // PRACTICE-EXPLAIN-7: chat-mode only — auto-submit the AI
        // critique as translation-quality feedback so the rating
        // surfaces in the admin feedback tab. Practice mode has no
        // chat doc to attach to, so this branch never runs there.
        if (!isPracticeMode && message && final.review && chatId) {
          submitTranslationFeedback(
            buildAiReviewFeedback({
              chatId,
              messageId: message.id,
              score: final.review.score,
              cleanComment: final.review.cleanComment,
              // Original-language translation field, not message.originalText.
              inputText: readLanguageRow(message.translations, message.originalLanguage)?.text ?? translatedText,
              outputText: translatedText,
              inputLanguage: message.originalLanguage,
              outputLanguage: practiceLanguage,
            }),
          ).catch((err) => log.warn('explain auto-feedback failed', { err }));
        }
      } catch (err) {
        if (!alive || controller.signal.aborted) return;
        log.error(err, { action: 'explainMessageStream' });
        pushToast({ kind: 'error', message: toUserMessage(err) });
      } finally {
        if (alive && !controller.signal.aborted) setStreaming(false);
      }
    })();
    return () => {
      alive = false;
      controller.abort();
    };
    // contextKey is the stable derivation of contextMessages (memoized
    // above), so we drop the raw array from the dep list to avoid
    // re-running on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key, entitled, message, translatedText, practiceLanguage, nativeLanguage, contextKey, wordDifficulty, profile.data?.displayName, profile.data?.pronouns, pushToast]);

  // ─── Abort any in-flight follow-up on close / key change ────────────────
  useEffect(() => {
    followUpAliveRef.current = true;
    return () => {
      followUpAliveRef.current = false;
      followUpAbortRef.current?.abort();
      followUpAbortRef.current = null;
    };
  }, [open, key]);

  // Body-scroll lock + Esc-to-close are owned by the BottomSheet (vaul).

  // ─── Save-to-flashcards ─────────────────────────────────────────────────
  // React Compiler handles memoization; no useCallback wrapper.
  const messageId = message?.id ?? null;
  const saveCard = async (phrase: string, translation: string, context = '') => {
    if (!user || savingPhrase === phrase) return;
    const guardKey = inFlightKey(user.uid, phrase);
    if (inFlightSaves.has(guardKey)) return;
    const cacheEntry = key ? explanationCache.get(key) : undefined;
    // Toggle-off path. The cancellation registry in lib/flashcards drops
    // any in-flight topic-classify update for the same card id.
    if (savedPhrases.has(phrase)) {
      const cardId = cacheEntry?.phraseCardIds.get(phrase);
      if (!cardId) {
        // Defensive: no cached id (shouldn't happen). Just clear the
        // visual state so the user can re-save.
        setSavedPhrases((prev) => {
          const next = new Set(prev);
          next.delete(phrase);
          return next;
        });
        return;
      }
      inFlightSaves.add(guardKey);
      setSavingPhrase(phrase);
      try {
        await deleteFlashcard({ uid: user.uid, cardId });
        cacheEntry?.phraseCardIds.delete(phrase);
        cacheEntry?.savedPhrases.delete(phrase);
        setSavedPhrases((prev) => {
          const next = new Set(prev);
          next.delete(phrase);
          return next;
        });
        pushToast({ kind: 'info', message: 'Removed from flashcards' });
      } catch (err) {
        log.error(err, { action: 'explainUnsaveFlashcard' });
        pushToast({ kind: 'error', message: toUserMessage(err) });
      } finally {
        inFlightSaves.delete(guardKey);
        setSavingPhrase((p) => (p === phrase ? null : p));
      }
      return;
    }
    inFlightSaves.add(guardKey);
    setSavingPhrase(phrase);
    try {
      const cardId = await addFlashCard(user.uid, {
        phrase,
        translation,
        context,
        practiceLanguage,
        nativeLanguage,
        sourceMessageId: messageId,
        sourceChatId: chatId,
      });
      // Re-read the cache entry — it may have been evicted while we
      // awaited the network. If so, drop the result silently rather
      // than risking an orphan id.
      const current = key ? explanationCache.get(key) : undefined;
      if (current) {
        current.phraseCardIds.set(phrase, cardId);
        current.savedPhrases.add(phrase);
      }
      setSavedPhrases((prev) => new Set(prev).add(phrase));
      pushToast({ kind: 'success', message: 'Flashcard added' });
    } catch (err) {
      log.error(err, { action: 'explainSaveFlashcard' });
      pushToast({ kind: 'error', message: toUserMessage(err) });
    } finally {
      inFlightSaves.delete(guardKey);
      setSavingPhrase((p) => (p === phrase ? null : p));
    }
  };

  // Plain object — React Compiler auto-memoizes the consumer if it cares.
  const vocabState = { saved: savedPhrases, saving: savingPhrase, onSave: saveCard, speakLanguage: practiceLanguage };

  // ─── Follow-up question handling ────────────────────────────────────────
  async function submitFollowUp() {
    if (!followUpDraft.trim() || submittingFollowUp) return;
    // LANG-TIER-1.1 — the follow-up is a second billed call on the same
    // surface, and it has its own entry point. Unreachable today (the composer
    // is not rendered for an unentitled viewer), and checked anyway: the
    // composer's presence is a layout decision, and this is the spend.
    if (entitled !== true) return;
    const q = followUpDraft.trim();
    setFollowUpDraft('');
    setSubmittingFollowUp(true);

    // Capture the placeholder index from the functional updater. The old
    // code did `followUps.length + 1`, which reads stale state if two
    // follow-ups submit in quick succession (e.g. double-tap on Send).
    let placeholderIdx = -1;
    setFollowUps((prev) => {
      placeholderIdx = prev.length + 1;
      return [
        ...prev,
        { kind: 'question', text: q },
        { kind: 'answer', sections: [], streaming: true },
      ];
    });

    // New AbortController per submit. Aborting the previous one on
    // re-submit isn't quite right (the user might want to fire-and-
    // forget the previous answer), so we only abort on modal
    // close / key change via the cleanup effect above.
    const controller = new AbortController();
    followUpAbortRef.current?.abort();
    followUpAbortRef.current = controller;

    let accumulated = '';
    try {
      const promptSpec: PracticePromptSpec = {
        kind: 'explain_followup',
        practice: practiceLanguage,
        native: nativeLanguage,
        question: q,
        // The model's OWN earlier answer, fed back so it can continue the
        // thread. Carried but not trusted — the server re-validates the shape
        // and the blast radius is this one follow-up.
        previousXml: rawXmlRef.current,
        translatedText,
        wordDifficulty,
      };
      for await (const chunk of streamGemini(
        // thinkingLevel: 'minimal' — see the main-stream call above. Same TTFT win.
        { promptSpec, thinkingLevel: 'minimal', temperature: CLIENT_TEMPERATURE.exposition, category: 'explain_followup' },
        controller.signal,
      )) {
        if (!followUpAliveRef.current || controller.signal.aborted) return;
        accumulated += chunk;
        const parsed = parseExplanationXML(accumulated);
        if (parsed.sections.length > 0) {
          setFollowUps((prev) =>
            prev.map((e, i) =>
              i === placeholderIdx ? { kind: 'answer', sections: parsed.sections, streaming: true } : e,
            ),
          );
        }
      }
      if (!followUpAliveRef.current || controller.signal.aborted) return;
      const finalParsed = parseExplanationXML(accumulated);
      setFollowUps((prev) => {
        const next = prev.map((e, i) =>
          i === placeholderIdx
            ? { kind: 'answer' as const, sections: finalParsed.sections, streaming: false }
            : e,
        );
        // Re-cache after the conversation grows.
        if (key) {
          const cached = explanationCache.get(key);
          if (cached) setCacheEntry(key, { ...cached, followUps: next });
        }
        return next;
      });
    } catch (err) {
      if (!followUpAliveRef.current || controller.signal.aborted) return;
      log.error(err, { action: 'explainFollowUp' });
      pushToast({ kind: 'error', message: toUserMessage(err) });
      setFollowUps((prev) =>
        prev.map((e, i) =>
          i === placeholderIdx
            ? { kind: 'answer' as const, sections: [{ title: 'Error', body: 'Failed to get a response. Please try again.', vocabItems: [] }], streaming: false }
            : e,
        ),
      );
    } finally {
      if (followUpAbortRef.current === controller) followUpAbortRef.current = null;
      if (followUpAliveRef.current && !controller.signal.aborted) {
        setSubmittingFollowUp(false);
      }
    }
  }

  // PRACTICE-EXPLAIN-2: chat mode requires a message; practice mode does
  // not. Allow either, but bail if neither inputs are available so we
  // don't render an empty modal.
  if (!message && !isPracticeMode) return null;

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel={isPracticeMode ? 'Explain answer' : 'Explain message'}
      desktopWidthClass="sm:max-w-2xl"
      zClass="z-[1100]"
      className={cn(
        // Override BottomSheet's default elevated bg with the page bg the
        // original modal used — keeps the inner card surfaces (LanguageCards
        // / SectionCard) reading as elevated against this base.
        'bg-(--color-bg) max-h-[90dvh] pb-0',
      )}
    >
      <div
        data-testid="explain-modal"
        data-mode={isPracticeMode ? 'practice' : 'chat'}
        className="flex flex-col flex-1 min-h-0"
      >
        <header className="flex items-center justify-between px-4 py-3 border-b border-(--color-border)">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Sparkles size={16} className="text-(--color-accent)" />
            {isPracticeMode ? 'Explain answer' : 'Explain'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="p-1.5 rounded-md text-(--color-fg-muted) hover:bg-(--color-bg-hover)"
          >
            <X size={18} />
          </button>
        </header>

        {/* LANG-TIER-1.1 — an unentitled viewer gets the offer where the
            explanation would be. The header and Close stay: this is still
            their modal and they must be able to leave it. `entitled === null`
            (profile loading) falls through to the ordinary body, which shows
            the spinner it already shows — a wall that appears and then
            disappears is worse than a beat of waiting. */}
        {entitled === false ? (
          <NeedsPlus
            testId="explain-needs-plus"
            title={t('explain.needsPlusTitle')}
            body={t('explain.needsPlusBody')}
            className="flex-1 min-h-0"
          />
        ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 flex flex-col gap-3">
          {/* PRACTICE-EXPLAIN-8: LanguageCards is chat-only. Practice
              mode shows the verdict banner instead (rendered below
              once the review parses). */}
          {/* EXPLAIN-ORIG-1..4 — the original, when neither card shows it. */}
          {!isPracticeMode && originalSource && message && (
            <OriginalDisclosure
              language={originalSource.language}
              text={originalSource.text}
              messageId={message.id}
              onCopy={(text) => void copyText(text, pushToast)}
            />
          )}
          {!isPracticeMode && message && (
            <LanguageCards
              practiceLanguage={practiceLanguage}
              nativeLanguage={nativeLanguage}
              practiceText={translatedText}
              // Native card reads the native-language TRANSLATION field, never
              // message.originalText — matches the chat bubble (useMessageTranslation)
              // and the "translation fields only" rule. The pipeline copies the
              // message into translations[nativeLanguage] (identity copy for a
              // native-authored message), so this shows the corrected/identity
              // text, not a stale stored original.
              nativeText={readLanguageRow(message.translations, nativeLanguage)?.text ?? translatedText}
              messageId={message.id}
              wordDifficulty={wordDifficulty}
              onCopy={(text) => void copyText(text, pushToast)}
            />
          )}

          {streaming && !explanation && (
            <CenteredSpinner label="Generating explanation" />
          )}

          {/* PRACTICE-EXPLAIN-9: single combined card carries verdict
              + user's answer + accepted answer + the LLM reasoning.
              Replaces the prior two-card layout (banner + separate
              "Answer check" section). */}
          {isPracticeMode && explanation?.review?.verdict && (
            <PracticeAnswerCheckCard
              verdict={explanation.review.verdict}
              userAnswer={userAnswer ?? ''}
              correctAnswer={practiceQuestion?.correctAnswer ?? ''}
              body={explanation.review.body ?? ''}
              vocab={vocabState}
            />
          )}
          {!isPracticeMode && explanation?.review && (
            <ReviewCard review={explanation.review} vocab={vocabState} />
          )}

          {explanation?.sections.map((section, idx) => (
            <SectionCard key={`s-${idx}`} section={section} vocab={vocabState} />
          ))}

          {followUps.map((entry, idx) =>
            entry.kind === 'question' ? (
              <div key={`q-${idx}`} className="self-end max-w-[80%] px-3 py-1.5 rounded-2xl bg-(--color-bubble-mine) text-(--color-bubble-mine-fg) text-sm">
                {entry.text}
              </div>
            ) : (
              <div key={`a-${idx}`} className="flex flex-col gap-2">
                {entry.streaming && entry.sections.length === 0 && (
                  <div className="flex items-center gap-2 text-sm text-(--color-fg-muted)">
                    <Loader size={14} className="animate-spin" />
                    Thinking…
                  </div>
                )}
                {entry.sections.map((s, si) => (
                  <SectionCard key={`as-${idx}-${si}`} section={s} vocab={vocabState} />
                ))}
              </div>
            ),
          )}
          {/* SAFETY-REPORT-1 — once the explanation has finished streaming. */}
          {explanation && !streaming && (
            <ExplainReport
              text={explanationReportText(explanation, followUps.flatMap((f) => (f.kind === 'answer' ? [f.sections] : [])))}
            />
          )}
        </div>
        )}

        {/* No `pb-keyboard` here — the wrapping BottomSheet's own
            `.pb-keyboard` already handles the kb-h + safe-area
            lift (COMP-IMG-4 / COMP-KB-3). Stacking pb-keyboard on
            BOTH the outer sheet AND this footer was the source of
            the double-compensation bug (composer floated ~safe-
            area-bottom above the keyboard top). */}
        {/* LANG-TIER-1.1 — no composer over an offer. A text box under a
            "this comes with Plus" panel is an invitation to spend money that
            will be refused. */}
        {entitled !== false && (
        <footer className="flex items-end gap-2 px-3 py-2 border-t border-(--color-border) bg-(--color-bg-elevated)">
          <Composer
            value={followUpDraft}
            onChange={setFollowUpDraft}
            onSubmit={() => void submitFollowUp()}
            disabled={submittingFollowUp || streaming}
            placeholder="Ask a follow-up question…"
            ariaLabel="Ask a follow-up question"
            testId="explain-followup-input"
            // The explain modal is height-constrained (max-h-[90dvh] with
            // a scrollable body above); cap the follow-up at 4 rows so
            // the body doesn't get crowded by an over-grown textarea.
            maxRows={4}
          />
          <button
            type="button"
            onClick={() => void submitFollowUp()}
            disabled={!followUpDraft.trim() || submittingFollowUp || streaming}
            aria-label="Send follow-up"
            className={cn(
              'w-10 h-10 rounded-full flex items-center justify-center text-white shrink-0',
              followUpDraft.trim() && !submittingFollowUp && !streaming
                ? 'bg-gradient-accent shadow-[0_4px_12px_-2px_rgba(115,64,245,0.4)]'
                : 'bg-(--color-bg-hover) text-(--color-fg-muted) cursor-default',
            )}
          >
            {submittingFollowUp ? <Loader size={16} className="animate-spin" /> : <Send size={16} />}
          </button>
        </footer>
        )}
      </div>
    </BottomSheet>
  );
}

// Presentational subcomponents (LanguageCards, ReviewCard, SectionCard,
// copyText) live in SimpleMarkdown.tsx to keep this file under the
// 600-LOC cap. They're imported at the top.
