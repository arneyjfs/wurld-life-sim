import type { ParsedExplanation, ParsedSection } from '@/lib/explain';

const AI_TEXT_MAX = 4000;

/** SAFETY-REPORT-1 — the explanation as the user saw it: the review, every
 *  section, then any follow-up answers. Capped at the server's 4000. */
export function explanationReportText(explanation: ParsedExplanation | null, answers: ParsedSection[][]): string {
  const parts: string[] = [];
  if (explanation?.review) parts.push(explanation.review.body || explanation.review.cleanComment);
  for (const s of [...(explanation?.sections ?? []), ...answers.flat()]) {
    parts.push(s.title ? `${s.title}\n${s.body}` : s.body);
  }
  return parts.filter((p) => p && p.trim()).join('\n\n').slice(0, AI_TEXT_MAX);
}

