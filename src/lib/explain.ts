/**
 * XML parsing and types for the ExplainModal streaming pipeline.
 *
 * SRV-PROMPT-6 — the PROMPTS left. All three system instructions, all three
 * user-prompt builders and the `difficultyLevelGuide` ladder now live in
 * `functions/src/prompts/explain.ts` and are built there from a `promptSpec`.
 * They were the last non-life-sim prompts compiled into the app bundle, where
 * `capacitor.config.ts`'s frozen `webDir: 'dist'` means a correction needs an
 * App Store review rather than `deploy:prod:functions`. Explain has no
 * prompt-eval suite, so the move was made byte-identical and verified as such
 * rather than tidied on the way past.
 *
 * The PARSER stays, and that is a decision rather than a leftover. It reads the
 * model's OUTPUT rather than instructing it, and `ExplainModal` runs it on
 * every streamed chunk to render a partial `<explanation>` as it arrives — a
 * round trip per chunk would defeat the streaming this surface exists for.
 */

export type VocabItem = {
  phrase: string;
  translation: string;
  explanation?: string;
};

export type ParsedReview = {
  score: number;
  verdict?: 'correct' | 'incorrect' | 'overturned';
  body: string;
  vocabItems: VocabItem[];
  cleanComment: string;
};

export type ParsedSection = {
  title: string;
  body: string;
  vocabItems: VocabItem[];
};

export type ParsedExplanation = {
  original: string;
  translated: string;
  review: ParsedReview | null;
  sections: ParsedSection[];
  complete: boolean;
};

export type ExplainPracticeQuestion = {
  questionType: string;
  /** Native-language task cue. */
  instruction: string;
  /** Practice-language content the user sees (post-vocab-tag-strip). */
  practiceText?: string;
  /** MC family option list — omitted for non-MC types. */
  options?: string[];
  correctAnswer: string;
  /** Author's existing explanation (if any) — gives the LLM extra context. */
  explanation?: string;
  /** Vocab-matching pairs — passed instead of `options` for matching slots. */
  matchingPairs?: { left: string[]; right: string[] };
};

// ───── XML parser ─────────────────────────────────────────────────────────

/** EXPLAIN-PHRASE-3.5 — a model that writes HTML emphasis anyway gets markdown,
 *  which the renderer shows as emphasis, instead of raw tags on screen. */
function htmlEmphasisToMarkdown(s: string): string {
  return s
    .replace(/<(strong|b)>([\s\S]*?)<\/\1>/gi, '**$2**')
    .replace(/<(em|i)>([\s\S]*?)<\/\1>/gi, '*$2*');
}

function decodeHTMLEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

/**
 * MSG-PIPE-31.11 — the vocab-tag quirks Luna (OpenAI) was measured to produce,
 * rewritten to the self-closing tag the rest of this parser and the renderer
 * read: `< vocab …/>` (a space after `<`), and the tag written as an element
 * around the word, `<vocab …>word</vocab>` or `<vocab …/>word</vocab>`, whose
 * word is a repeat of the chip and is dropped, and a bare `<vocab …>` that is
 * never closed. The dropped run stops at the
 * next `<` or line break, so a stray `</vocab>` cannot swallow another tag or
 * a paragraph. A well-formed self-closing tag with no stray closer is left
 * byte-for-byte as it was.
 */
function normaliseVocabTags(body: string): string {
  return body
    .replace(/<\s+vocab\b/g, '<vocab')
    .replace(/<vocab\s([^>]*?)\s*\/?>[^<\n]*<\/\s*vocab\s*>/g, (_m, attrs: string) => `<vocab ${attrs.trim()} />`)
    .replace(/<vocab\s([^>]*[^/\s>])\s*>/g, (_m, attrs: string) => `<vocab ${attrs.trim()} />`);
}

function extractVocabItems(raw: string): { cleanBody: string; vocabItems: VocabItem[] } {
  const body = normaliseVocabTags(raw);
  const vocabItems: VocabItem[] = [];
  const vocabRe = /<vocab\s([^>]*?)\/>/g;
  let m: RegExpExecArray | null;
  while ((m = vocabRe.exec(body)) !== null) {
    const attrs = m[1] ?? '';
    const phrase = attrs.match(/phrase="([^"]*)"/)?.[1] ?? '';
    const translation = attrs.match(/translation="([^"]*)"/)?.[1] ?? '';
    const explanation = attrs.match(/explanation="([^"]*)"/)?.[1] ?? '';
    if (phrase) {
      vocabItems.push({
        phrase: decodeHTMLEntities(phrase),
        translation: decodeHTMLEntities(translation),
        explanation: explanation ? decodeHTMLEntities(explanation) : undefined,
      });
    }
  }
  // Keep <vocab/> tags inline so the renderer can place chips where they sit
  // in the prose. Just normalise excessive blank lines.
  return { cleanBody: body.replace(/\n{3,}/g, '\n\n').trim(), vocabItems };
}

export function parseExplanationXML(raw: string): ParsedExplanation {
  const originalMatch = raw.match(/<original>([\s\S]*?)<\/original>/);
  const translatedMatch = raw.match(/<translated>([\s\S]*?)<\/translated>/);

  let review: ParsedReview | null = null;
  const reviewMatch = raw.match(/<review\s+([^>]*)>([\s\S]*?)<\/review>/);
  if (reviewMatch) {
    const attrs = reviewMatch[1] ?? '';
    const score = Math.max(
      0,
      Math.min(5, parseInt(attrs.match(/score="(\d)"/)?.[1] ?? '0', 10)),
    );
    const verdictRaw = attrs.match(/verdict="([^"]*)"/)?.[1];
    const verdict =
      verdictRaw === 'correct' || verdictRaw === 'incorrect' || verdictRaw === 'overturned'
        ? verdictRaw
        : undefined;
    const rawBody = htmlEmphasisToMarkdown(decodeHTMLEntities((reviewMatch[2] ?? '').trim()));
    const { cleanBody, vocabItems } = extractVocabItems(rawBody);
    const cleanComment = cleanBody
      .replace(/<vocab\s[^>]*?\/>/g, (tag) => tag.match(/phrase="([^"]*)"/)?.[1] ?? '')
      .trim();
    review = { score, verdict, body: cleanBody, vocabItems, cleanComment };
  }

  const sections: ParsedSection[] = [];
  const sectionRe = /<section\s+title="([^"]*)">([\s\S]*?)<\/section>/g;
  let match: RegExpExecArray | null;
  while ((match = sectionRe.exec(raw)) !== null) {
    const rawBody = htmlEmphasisToMarkdown(decodeHTMLEntities((match[2] ?? '').trim()));
    const { cleanBody, vocabItems } = extractVocabItems(rawBody);
    sections.push({
      // A title is plain text: stray tags are dropped, not turned into markdown.
      title: decodeHTMLEntities(match[1] ?? '').replace(/<\/?(strong|b|em|i)>/gi, ''),
      body: cleanBody,
      vocabItems,
    });
  }

  return {
    original: originalMatch?.[1]?.trim() ?? '',
    translated: translatedMatch?.[1]?.trim() ?? '',
    review,
    sections,
    complete: raw.includes('</explanation>'),
  };
}
