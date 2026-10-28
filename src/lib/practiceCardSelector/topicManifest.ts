/**
 * Per-topic deck manifest for the card-selector LLM.
 *
 * Summarises the user's deck for the FIRST stage of the new two-LLM
 * practice build (PRACTICE-PLAN-1): card selector reads this manifest
 * + the user's overall stats and picks ~3× target cards in the topics
 * worth focusing on. The manifest is INTENTIONALLY compact — the LLM
 * sees aggregates per topic (count, accuracy mean/std, recency, due),
 * not the full card list, so the prompt cost stays roughly constant as
 * the deck grows.
 *
 * Pure helper. No Firestore reads, no React, no side effects — the
 * caller (PracticeScreen build effect) does the I/O.
 */
import type { FlashCard, PracticeStats } from '@/types/firestore';

/** Recency buckets in days. */
const RECENCY_FRESH_DAYS = 7;
const RECENCY_RECENT_DAYS = 30;

/** PRACTICE-MANIFEST-1: the manifest the card selector LLM consumes. */
export type TopicManifest = {
  /** Total cards considered (after the language filter). */
  totalCards: number;
  /** The practice language this manifest is scoped to. */
  language: string;
  /** Overall correct/total over the rolling stats window. Null if no
   *  attempts logged yet — the selector treats null as "cold-start". */
  overallAccuracy: number | null;
  /** Cards whose nextReviewAt is in the past (or unset). Aggregate
   *  number, not the ids — the selector uses it as a "how much SRS
   *  debt does this user carry" signal across the whole deck. */
  dueCount: number;
  /** Per-topic summaries — sorted by `count` descending. The selector
   *  PICKs from this list when there's no user-imposed topic filter,
   *  or ALLOCATEs across `topicFilter` when one is set. */
  perTopic: TopicSummary[];
  /** When the caller has pre-selected topics (PracticeStartScreen multi-
   *  select chips), they appear here. Empty array means "no constraint —
   *  the selector is free to PICK any topic". */
  topicFilter: string[];
};

export type TopicSummary = {
  /** Canonical English topic key (matches FlashCard.topic + the topic
   *  registry). UI localises at render time. */
  name: string;
  /** Cards tagged with this topic, after the manifest's language filter. */
  count: number;
  /** Mean accuracy across the topic's cards' lifetime attempts. Null
   *  when no card in the topic has any attempts yet. */
  accuracyMean: number | null;
  /** Population standard deviation of the per-card accuracies. Null
   *  when count < 2 or no attempts logged. */
  accuracyStd: number | null;
  /** Card-count breakdown by `createdAt` recency. Cards without
   *  `createdAt` (legacy / mid-flight writes) fall into `older`. */
  recency: {
    fresh: number;
    recent: number;
    older: number;
  };
  /** Cards in this topic with nextReviewAt in the past or unset. */
  dueCount: number;
};

export type BuildManifestOpts = {
  /** Full deck slice the user owns (already loaded by useFlashcards). */
  cards: FlashCard[];
  /** Per-language rolling stats doc, if any. May be null for new users. */
  stats: PracticeStats | null;
  /** Practice language to scope the manifest to. Cards in other
   *  languages are EXCLUDED from the manifest entirely. */
  language: string;
  /** Optional topic filter from the start screen. Empty = no constraint. */
  topicFilter?: string[];
  /** Pinned "now" for deterministic recency + due math (tests pass this
   *  explicitly). Defaults to `Date.now()` at call time. */
  now?: number;
};

/**
 * Build the manifest the card-selector LLM consumes (PRACTICE-PLAN-2).
 *
 * The output is a STRUCTURAL summary — small enough to embed in a
 * prompt at any deck size. Topics with zero matching cards are dropped.
 * The `perTopic` list is sorted by count descending so the selector
 * can read the deck's centre of gravity from the top.
 */
export function buildTopicManifest(opts: BuildManifestOpts): TopicManifest {
  const now = opts.now ?? Date.now();
  // CARDS-ARCHIVE-5: archived cards are excluded from the manifest by
  // default. Caller (PracticeScreen) only includes them when the user
  // explicitly asked via the "Review archived cards" custom-prompt
  // chip, in which case it un-filters the pool before calling here.
  const cardsInLang = opts.cards.filter(
    (c) =>
      c.practiceLanguage === opts.language &&
      c.cardStatus !== 'archived',
  );

  const freshCutoff = now - RECENCY_FRESH_DAYS * 24 * 60 * 60 * 1000;
  const recentCutoff = now - RECENCY_RECENT_DAYS * 24 * 60 * 60 * 1000;

  // Bucket cards by topic. Cards without a topic land in '__untagged__'
  // so they STILL appear in the manifest — the selector needs to know
  // they exist even if it can't easily theme around them.
  const byTopic = new Map<string, FlashCard[]>();
  for (const c of cardsInLang) {
    const key = c.topic && c.topic.trim() ? c.topic : '__untagged__';
    const arr = byTopic.get(key);
    if (arr) arr.push(c);
    else byTopic.set(key, [c]);
  }

  const perTopic: TopicSummary[] = Array.from(byTopic.entries()).map(
    ([name, cards]) => {
      // Per-card accuracies (null when zero attempts on that card).
      const accs: number[] = [];
      let fresh = 0;
      let recent = 0;
      let older = 0;
      let due = 0;
      for (const c of cards) {
        const correct = c.correctCount ?? 0;
        const incorrect = c.incorrectCount ?? 0;
        const total = correct + incorrect;
        if (total > 0) accs.push(correct / total);

        const createdMs = c.createdAt?.toMillis() ?? null;
        if (createdMs === null) older += 1;
        else if (createdMs >= freshCutoff) fresh += 1;
        else if (createdMs >= recentCutoff) recent += 1;
        else older += 1;

        const nextMs = c.nextReviewAt?.toMillis() ?? null;
        if (nextMs === null || nextMs <= now) due += 1;
      }
      const mean = accs.length === 0 ? null : accs.reduce((s, v) => s + v, 0) / accs.length;
      let std: number | null = null;
      if (mean !== null && accs.length >= 2) {
        const variance =
          accs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / accs.length;
        std = Math.sqrt(variance);
      }
      return {
        name,
        count: cards.length,
        accuracyMean: mean,
        accuracyStd: std,
        recency: { fresh, recent, older },
        dueCount: due,
      };
    },
  );
  // Centre-of-gravity ordering: largest topics first, ties broken by name
  // so the manifest is stable across renders.
  perTopic.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));

  // Overall accuracy comes from the rolling stats doc if present —
  // that's the authoritative cross-session window the planner already
  // trusts. Otherwise fall back to a card-level recompute so cold-start
  // users still see a number.
  let overallAccuracy: number | null = null;
  if (opts.stats && (opts.stats.totalSessions ?? 0) > 0) {
    const ts = opts.stats.topicScores ?? {};
    let totalCorrect = 0;
    let totalAttempts = 0;
    for (const tally of Object.values(ts)) {
      totalCorrect += tally.correct;
      totalAttempts += tally.total;
    }
    if (totalAttempts > 0) overallAccuracy = totalCorrect / totalAttempts;
  }
  if (overallAccuracy === null) {
    let totalCorrect = 0;
    let totalAttempts = 0;
    for (const c of cardsInLang) {
      totalCorrect += c.correctCount ?? 0;
      totalAttempts += (c.correctCount ?? 0) + (c.incorrectCount ?? 0);
    }
    if (totalAttempts > 0) overallAccuracy = totalCorrect / totalAttempts;
  }

  const totalDue = perTopic.reduce((s, t) => s + t.dueCount, 0);

  return {
    totalCards: cardsInLang.length,
    language: opts.language,
    overallAccuracy,
    dueCount: totalDue,
    perTopic,
    topicFilter: opts.topicFilter ?? [],
  };
}
