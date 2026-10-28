import { callHttp } from './endpoints';

export type TranslationFeedback = {
  chatId: string;
  messageId: string;
  /** 1 = bad, 5 = great. Source uses an unbounded number but only 1..5
   *  ever gets sent. */
  score: number;
  /** Optional free-text comment. */
  comment?: string;
  /** Original-language text the user sent. */
  inputText?: string;
  /** Translation we delivered. */
  outputText?: string;
  inputLanguage?: string;
  outputLanguage?: string;
};

/**
 * Send a translation-quality rating to the `submitTranslationFeedback`
 * Cloud Function. Fire-and-forget from the caller's perspective; failures
 * surface only as a rejected promise so the UI can show a retry chip.
 */
export async function submitTranslationFeedback(
  feedback: TranslationFeedback,
): Promise<void> {
  await callHttp<TranslationFeedback, void>('submitTranslationFeedback', feedback);
}

/**
 * Prefix the AI critic's plain-text comment with the source-app's
 * `[AI review] ` tag. The admin feedback tab (FeedbackTab.tsx) keys off
 * this prefix to distinguish AI-generated reviews from user-submitted
 * ratings. Source parity: components/ExplainModal.tsx:712 in the React-
 * Native app.
 */
export const AI_REVIEW_PREFIX = '[AI review] ';

export function buildAiReviewFeedback(args: {
  chatId: string;
  messageId: string;
  score: number;
  cleanComment: string;
  inputText?: string;
  outputText?: string;
  inputLanguage?: string;
  outputLanguage?: string;
}): TranslationFeedback {
  const { chatId, messageId, score, cleanComment, ...rest } = args;
  return {
    chatId,
    messageId,
    score,
    comment: `${AI_REVIEW_PREFIX}${cleanComment}`,
    inputText: rest.inputText || undefined,
    outputText: rest.outputText || undefined,
    inputLanguage: rest.inputLanguage || undefined,
    outputLanguage: rest.outputLanguage || undefined,
  };
}
