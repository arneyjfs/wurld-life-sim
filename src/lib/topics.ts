import { collection, doc, getDocs, orderBy, query, runTransaction } from 'firebase/firestore';
import { db } from './firebase';
import { isCardCancelled } from './flashcards';
import { generateGemini } from './gemini';
// SRV-PROMPT-1 — the prompt, the user prompt and the response schema live in
// `functions/src/prompts/topicClassify.ts`. `OTHER_TOPIC` is a wire constant,
// not prompt text: the client must accept it in the response (TOPIC-SET-5).
import { OTHER_TOPIC } from './prompts/topicClassify';
import * as log from './log';

/**
 * Flashcard topic taxonomy — see docs/specs/topics.md.
 *
 * Topics live in a GLOBAL collection (`/topics/{id}`) shared across all
 * users. A doc WITH a non-empty `description` is a **theme** — the closed,
 * owner-curated set the classifier chooses from (TOPIC-SET-1). A doc
 * without one is a legacy topic, kept only so old cards still show a label.
 *
 * The client READS `/topics` only. It never creates, updates or deletes a
 * topic doc (TOPIC-SET-2, enforced by `firestore.rules`); the owner's admin
 * scripts own the set.
 *
 * Cache layer is lightweight (an in-memory list filled on first use)
 * because the set is short and classifies are infrequent.
 */

const topicsCol = () => collection(db, 'topics');

/**
 * In-memory topic cache row. Carries the `translations` map so the
 * UI's `getTopicLabel` lookup is a single map read, and the
 * `description` so `getThemes` can tell a theme from a legacy topic.
 */
type Topic = {
  id: string;
  name: string;
  description?: string;
  translations?: Record<string, string>;
};
export type Theme = { name: string; description: string };
let topicCache: Topic[] | null = null;

/** Test-only: drop the in-memory topic cache so the next read re-fetches
 *  from Firestore. Underscore-prefixed per the project convention for
 *  hatches that exist solely for unit tests. */
export function _resetTopicCacheForTest(): void {
  topicCache = null;
}

async function loadTopics(): Promise<Topic[]> {
  if (topicCache) return topicCache;
  try {
    const snap = await getDocs(query(topicsCol(), orderBy('name', 'asc')));
    topicCache = snap.docs.map((d) => {
      const data = d.data() as { name?: unknown; description?: unknown; translations?: unknown };
      // Translations are a plain map<string,string>; defensive read in
      // case a doc was hand-edited or schema drift snuck in.
      const rawTranslations =
        data.translations && typeof data.translations === 'object'
          ? (data.translations as Record<string, unknown>)
          : null;
      const translations = rawTranslations
        ? (Object.fromEntries(
            Object.entries(rawTranslations).filter(
              ([, v]) => typeof v === 'string' && v.length > 0,
            ),
          ) as Record<string, string>)
        : undefined;
      return {
        id: d.id,
        name: String(data.name ?? ''),
        description: typeof data.description === 'string' ? data.description : undefined,
        translations,
      };
    });
    return topicCache;
  } catch (err) {
    log.warn('loadTopics failed', { err });
    return [];
  }
}

/** Returns the full Topic row (id + name + description + translations) for
 *  every doc in `/topics`, themes and legacy topics alike. UI consumers use
 *  this to feed `getTopicLabel`. */
export async function getTopics(): Promise<Topic[]> {
  return (await loadTopics()).slice();
}

/** TOPIC-SET-1 — the live theme set: `/topics` docs with a non-empty
 *  description (including `other`). Legacy topics are excluded. */
export async function getThemes(): Promise<Theme[]> {
  const rows = await loadTopics();
  return rows
    .filter((t) => !!t.name && !!t.description && t.description.trim().length > 0)
    .map((t) => ({ name: t.name, description: t.description!.trim() }));
}

/**
 * TOPIC-SET-5..7 — ask Gemini to place a phrase in one of the live themes,
 * or `other`. The server builds the SI (a glossary rendered from the
 * themes' descriptions), the user prompt and the response schema
 * (`{ subject, topic: enum(themes ∪ "other") }`) from the `promptSpec`.
 *
 * Returns `{ topic, subject }` on success. Returns `null` — and logs a
 * warning — when there is no live theme set, on any Gemini / network
 * error, on unparseable output, or on a `topic` outside themes ∪ {other}
 * (TOPIC-SET-6). There is NO `'general'` fallback: a plumbing failure must
 * not look like a classification. The caller writes nothing on null.
 */
export async function classifyFlashCardTopic(
  phrase: string,
  translation: string,
  practiceLanguage?: string,
): Promise<{ topic: string; subject: string } | null> {
  try {
    const themes = (await getThemes()).filter((t) => t.name !== OTHER_TOPIC);
    if (themes.length === 0) {
      log.warn('classifyFlashCardTopic skipped: no live themes in /topics');
      return null;
    }
    const raw = await generateGemini({
      promptSpec: {
        kind: 'topic_classify',
        phrase,
        translation,
        themes,
        // TOPIC-SET-7: the card's language, so French "pain" is bread, not
        // English "pain". Omitted (not '') when unknown.
        ...(practiceLanguage?.trim() ? { practiceLanguage: practiceLanguage.trim() } : {}),
      },
      responseMimeType: 'application/json',
      // Pin temperature low — classification should be stable across
      // semantically-similar inputs.
      temperature: 0.1,
      category: 'topic_classify',
    });
    const result = JSON.parse(raw) as { topic?: unknown; subject?: unknown };
    const picked = typeof result.topic === 'string' ? result.topic.trim().toLowerCase() : '';
    const topic =
      picked === OTHER_TOPIC
        ? OTHER_TOPIC
        : themes.find((t) => t.name.trim().toLowerCase() === picked)?.name;
    if (!topic) {
      log.warn('classifyFlashCardTopic: topic outside the theme set', { topic: result.topic });
      return null;
    }
    const subject = typeof result.subject === 'string' ? result.subject.trim() : '';
    return { topic, subject };
  } catch (err) {
    log.warn('classifyFlashCardTopic failed', { err });
    return null;
  }
}

/**
 * Fire-and-forget: classify a newly-saved flashcard and stamp
 * `{ topic, topicSubject }` back onto the doc. Safe to await OR ignore —
 * a failed classification writes nothing (TOPIC-SET-6) and the card stays
 * unclassified for the recategorisation script (TOPIC-SET-9).
 *
 * Race safety: the user may delete the just-saved card before this
 * resolves. Two guards drop the late write silently:
 *
 *   1. `isCardCancelled(cardId)` — fast in-memory check; flipped by
 *      `deleteFlashcard` and read here right before the write.
 *   2. `runTransaction` + `.exists()` — covers the cross-tab / refresh
 *      case where the in-memory flag isn't set but the doc is gone.
 */
export async function computeAndAssignTopic(opts: {
  uid: string;
  cardId: string;
  phrase: string;
  translation: string;
  /** The card's practice language name; forwarded to the classifier. */
  practiceLanguage?: string;
}): Promise<void> {
  const { uid, cardId, phrase, translation, practiceLanguage } = opts;
  try {
    const result = await classifyFlashCardTopic(phrase, translation, practiceLanguage);
    if (!result) return;
    if (isCardCancelled(cardId)) {
      log.info('computeAndAssignTopic skipped (cancelled before write)', { cardId });
      return;
    }
    const { topic, subject } = result;
    // Transactional write: only stamp the topic if the doc still exists
    // AND hasn't been cancelled — a deleted doc is a no-op rather than a
    // not-found we'd need to tell apart from a real Firestore failure.
    const ref = doc(db, 'users', uid, 'flashcards', cardId);
    try {
      await runTransaction(db, async (tx) => {
        if (isCardCancelled(cardId)) return;
        const snap = await tx.get(ref);
        if (!snap.exists()) return;
        tx.update(ref, { topic, ...(subject ? { topicSubject: subject } : {}) });
      });
    } catch (err) {
      log.warn('computeAndAssignTopic transaction failed', { err, cardId });
    }
  } catch (err) {
    log.warn('computeAndAssignTopic failed', { err });
  }
}
