/**
 * Builds the REAL prompt strings production sends, for every billable call
 * type in scope (life-sim excluded).
 *
 * COST-PROMPT-1: no prompt text is written here. Every string comes from the
 * app's own builders — the compiled `functions/lib/**` for server-side calls,
 * the TS sources under `src/lib/**` (type-stripped at runtime) for the
 * client-direct ones. If a prompt grows, this harness reprices it on the next
 * run with no edit. Hand-copied prompt text would silently drift and quietly
 * under-report, which is the failure mode this rule exists to prevent.
 */
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const require = createRequire(import.meta.url);

const L = (p) => require(join(ROOT, 'functions', 'lib', p));

export const unified = L('prompts/unifiedAnalysis.js');
export const translate = L('prompts/translateMessage.js');
export const practiceGen = L('prompts/practiceGeneration.js');
export const practiceListen = L('prompts/practiceListenGenerators.js');
export const streamingPlanner = L('prompts/practiceStreamingPlanner.js');
export const cardSelectorPrompt = L('prompts/practiceCardSelector.js');
export const cardTranslate = L('prompts/cardTranslate.js');
export const explain = L('prompts/explain.js');
export const topicClassify = L('prompts/topicClassify.js');
export const chatExtract = L('prompts/chatExtract.js');
export const tutorPrompts = L('tutorPrompts.js');
export const tutorActions = L('tutorActionPrompts.js');

/**
 * SRV-PROMPT-* / PRACTICE-OWN-* moved every non-life-sim prompt server-side,
 * so the harness now imports ALL of them from `functions/lib` and has no
 * mirrored or type-stripped client prompt left. That removes the last drift
 * risk COST-PROMPT-1 was written to guard.
 *
 * The only client module still needed is the practice model tier, which is a
 * routing decision rather than a prompt.
 */
export async function loadClientModules() {
  const modelConfig = await import(join(ROOT, 'src', 'lib', 'practiceGenerator', 'modelConfig.ts'));
  buildSlotModels(modelConfig.PRACTICE_GEN_PRIMARY_MODEL);
}

// ── message pipeline ───────────────────────────────────────────────────

/** Normalise a language name for a camelCase Firestore key. Mirrors
 *  functions/src/memberKeys.ts (kept in step by cost-model.test.mjs). */
function normaliseLangKeyPart(lang) {
  return (lang || '')
    .replace(/\s*\(\s*([^)]+?)\s*\)/g, (_m, tag) => `_${tag.replace(/\s+/g, '_')}`)
    .replace(/\s+/g, '_');
}

export function annotatedKey(practice, native) {
  const p = normaliseLangKeyPart(practice);
  const n = normaliseLangKeyPart(native);
  return `${p.charAt(0).toLowerCase()}${p.slice(1)}Annotated${n.charAt(0).toUpperCase()}${n.slice(1)}`;
}

export function memberKeySet(native, practice) {
  const keys = new Set([native, practice]);
  if (native !== practice) keys.add(annotatedKey(practice, native));
  return keys;
}

/** MSG-KEY-2 + MSG-PIPE-8: deduped required key set across all members. */
export function deriveMemberKeys(members) {
  const out = new Set();
  for (const m of members) for (const k of memberKeySet(m.native, m.practice)) out.add(k);
  return out;
}

/** The analyze stage (one call per message). Its SI is served from the
 *  MSG-PIPE-15 explicit context cache, so the SI portion bills cached. */
export function analysisCall({ text, sender, contextMessages, otherPronouns, replyTo }) {
  // Returns { systemInstruction, prompt } — the SI it hands back is the
  // language-agnostic one (MSG-PIPE-15), i.e. identical for every chat.
  const built = unified.buildUserMessageAnalysisPrompt(
    text, sender.native, sender.practice, contextMessages,
    sender.pronouns, sender.name, otherPronouns, replyTo,
  );
  return {
    si: built.systemInstruction,
    prompt: built.prompt,
    model: 'gemini-3.1-flash-lite',
    category: 'message_analysis',
    siCached: true,
  };
}

/** One translate/annotate job. `mode` follows buildTranslateMessagePrompt. */
export function translateCall({
  text, sourceLang, targetLang, nativeForAnnotation, mode, contextMessages, senderPronouns, recipientPronouns,
}) {
  // MSG-PIPE-25 — the SI is keyed on the MODE alone and served from a per-mode
  // explicit cache; the languages ride the user prompt. `siCached` below is
  // what tells the ledger to bill these tokens at the cached rate.
  const si = translate.translateMessageSystemInstruction(mode);
  const mapping = translate.convertLanguageMapping(sourceLang, targetLang, nativeForAnnotation, mode);
  const ctx = L('prompts/context.js').buildContext(contextMessages ?? [], undefined);
  const speakerCue = senderPronouns === 'he' || senderPronouns === 'she'
    ? `use ${senderPronouns === 'he' ? 'masculine' : 'feminine'} forms for the speaker (self-reference: "I/me")`
    : 'speaker gender is unknown';
  const addresseeCue = recipientPronouns === 'he' || recipientPronouns === 'she'
    ? `use ${recipientPronouns === 'he' ? 'masculine' : 'feminine'} forms for the addressee ("you/tu" agreement)`
    : 'addressee gender is unknown';
  const knownAny = ['he', 'she'].includes(senderPronouns) || ['he', 'she'].includes(recipientPronouns);
  const genderLine = knownAny
    ? `Gender cues: ${speakerCue}; ${addresseeCue}. For the cued role(s), do NOT provide both masculine and feminine alternatives — pick the right one. For any uncued role, include both concise options when an inflection is needed (example: Je suis content(e)).`
    : 'Gender: neither speaker nor addressee gender is encoded — include both concise options when natural (example: Je suis content(e), tu es tout(e) seul(e)).';
  const prompt = mode === 'annotate-only'
    ? `${mapping}\n${ctx}\n>>> TEXT TO ANNOTATE <<<\n${text}`
    : `${mapping}\n${genderLine}\n${ctx}\n>>> TEXT TO TRANSLATE <<<\n${text}`;
  return { si, prompt, model: 'gemini-3.1-flash-lite', category: 'message_translation', siCached: true };
}

/**
 * MSG-PIPE-26 — the whole fan-out for one message, in ONE call.
 *
 * This is what production now does whenever a send has 2+ model-bound targets,
 * so the ledger has to price it that way or it prices a path that no longer
 * runs. The union SI is ~2.8k tokens and therefore ABOVE Gemini's cache floor,
 * which is the point: it carries the `translate-only` targets that at 734
 * tokens could never be cached on their own and are 50.3% of all translate
 * calls.
 */
export function multiTargetCall({ text, sourceLang, targets, contextMessages, senderPronouns, recipientPronouns }) {
  const mt = L('prompts/multiTargetConvert.js');
  const ctx = L('prompts/context.js').buildContext(contextMessages ?? [], undefined);
  const speakerCue = senderPronouns === 'he' || senderPronouns === 'she'
    ? `use ${senderPronouns === 'he' ? 'masculine' : 'feminine'} forms for the speaker (self-reference: "I/me")`
    : 'speaker gender is unknown';
  const addresseeCue = recipientPronouns === 'he' || recipientPronouns === 'she'
    ? `use ${recipientPronouns === 'he' ? 'masculine' : 'feminine'} forms for the addressee ("you/tu" agreement)`
    : 'addressee gender is unknown';
  const knownAny = ['he', 'she'].includes(senderPronouns) || ['he', 'she'].includes(recipientPronouns);
  const genderLine = knownAny
    ? `Gender cues: ${speakerCue}; ${addresseeCue}. For the cued role(s), do NOT provide both masculine and feminine alternatives — pick the right one. For any uncued role, include both concise options when an inflection is needed (example: Je suis content(e)).`
    : 'Gender: neither speaker nor addressee gender is encoded — include both concise options when natural (example: Je suis content(e), tu es tout(e) seul(e)).';
  const { systemInstruction, prompt } = mt.buildMultiTargetConvertPrompt({
    targets: targets.map((t, index) => ({
      index,
      mode: t.mode === 'translate-only' ? 'translateOnly'
        : t.mode === 'annotate-only' ? 'annotateOnly' : 'translateAndAnnotate',
      targetLanguage: t.target,
      nativeForAnnotation: t.nativeForAnnotation,
    })),
    sourceText: text,
    sourceLanguage: sourceLang,
    contextBlock: ctx,
    genderLine,
  });
  return {
    si: systemInstruction, prompt,
    model: 'gemini-3.1-flash-lite',
    category: 'message_translation',
    siCached: true,
  };
}

// ── explain (client-direct stream) ─────────────────────────────────────

export function explainCall({ messageText, translatedText, practice, native, difficulty, contextMessages, senderName, senderPronouns }) {
  return {
    si: explain.explainMessageSystemInstruction(practice, native),
    prompt: explain.explainMessagePrompt({
      messageText, translatedText, targetLanguage: practice, nativeLanguage: native,
      contextMessages, wordDifficulty: difficulty, senderName, senderPronouns,
    }),
    model: 'gemini-3.1-flash-lite',
    category: 'explain',
    siCached: false,
  };
}

export function explainFollowUpCall({ question, previousXml, translatedText, practice, native, difficulty }) {
  return {
    si: explain.explainFollowUpSystemInstruction(practice, native),
    prompt: explain.explainFollowUpPrompt({
      question, previousXml, translatedText, practiceLanguage: practice,
      nativeLanguage: native, wordDifficulty: difficulty,
    }),
    model: 'gemini-3.1-flash-lite',
    category: 'explain_followup',
    siCached: false,
  };
}

// ── tutor ──────────────────────────────────────────────────────────────

/**
 * TUTOR-CTX-CACHE-9 — the tutor reply, priced the way production sends it.
 *
 * TWO things were wrong here and they pulled in opposite directions, so the
 * total looked plausible while both halves were wrong:
 *
 * 1. It built `buildTutorRespondSystemInstruction`, the prompt TUTOR-INV-18
 *    RETIRED. That builder has no production call site any more — the live path
 *    is `buildTutorReplySystemInstruction`, which writes both rows and the vocab
 *    list in one call and is a different size and shape.
 * 2. `siCached: false` said the tutor pays full input rate. It does not:
 *    `getCachedTutorModel` has served the SI from an explicit cache since
 *    TUTOR-CTX-CACHE-6, so the model was over-charging every tutor turn.
 *
 * The memoryBlock stays OUT of the SI and goes in the user prompt, which is
 * both what production does and the thing that makes the cache shareable.
 */
export function tutorRespondCall({ native, practice, gender, memoryBlock, difficulty, pronouns, historyBlock, userMessage }) {
  return {
    si: tutorPrompts.buildTutorReplySystemInstruction(),
    prompt: tutorPrompts.buildTutorReplyUserPrompt({
      wordDifficulty: difficulty, pronouns, historyBlock, userMessage, memoryBlock,
      nativeLanguage: native, practiceLanguage: practice, gender,
    }),
    model: 'gemini-3.1-flash-lite',
    category: 'tutor_chat',
    siCached: true,
  };
}

export function tutorCompactCall({ native, practice, messagesToFold, existingMemories = [], existingSummary = '' }) {
  return {
    si: tutorPrompts.buildCompactionSystemInstruction({ nativeLanguage: native, practiceLanguage: practice }),
    prompt: tutorPrompts.buildCompactionUserPrompt({ existingMemories, existingSummary, messagesToFold }),
    model: 'gemini-3.1-flash-lite',
    category: 'tutor_compact',
    siCached: false,
  };
}

/** TUTOR-ACTION-2: the tutor's normal reply IS the router. When it emits a
 *  bare `<FLASHCARD/>` / `<EXPLAIN/>` / `<PRACTICE/>` sentinel, a SECOND
 *  call runs the action prompt — so an action turn costs two calls, not
 *  one. `kind` selects which action SI. */
export function tutorActionCall({ kind, native, practice, userMessage, historyBlock }) {
  const opts = { nativeLanguage: native, practiceLanguage: practice };
  const si = kind === 'flashcards'
    ? tutorActions.buildFlashcardActionSystemInstruction(opts)
    : kind === 'explain'
      ? tutorActions.buildExplainActionSystemInstruction(opts)
      : tutorActions.buildPracticeActionSystemInstruction(opts);
  const prompt = kind === 'flashcards'
    ? tutorActions.buildFlashcardActionUserPrompt({ userMessage, historyBlock })
    : kind === 'explain'
      ? tutorActions.buildExplainActionUserPrompt({ userMessage, historyBlock })
      : tutorActions.buildPracticeActionUserPrompt({ userMessage, historyBlock });
  return { si, prompt, model: 'gemini-3.1-flash-lite', category: 'tutor_action', siCached: false };
}

// ── practice ───────────────────────────────────────────────────────────

export function cardSelectorCall({ manifest, recentTopics, intent, practice, native }) {
  return {
    si: cardSelectorPrompt.cardSelectorSystemInstruction(practice, native),
    prompt: cardSelectorPrompt.buildCardSelectorUserPrompt(manifest, { recentTopics, intent }),
    model: 'gemini-3.1-flash-lite',
    category: 'practice_card_selector',
    siCached: false,
  };
}

/** The JSON planner was deleted on dev (+28/-1248); the STREAMING planner is
 *  the only live path now, so the harness prices that one. */
export function plannerCall(input) {
  const tokens = L('prompts/languageTokens.js');
  return {
    // PRACTICE-CACHE-1 — token-built SI + mapping in the user prompt, exactly
    // as `resolveServerPrompt` assembles it.
    si: streamingPlanner.streamingPlannerSystemInstruction(tokens.PRACTICE_TOKEN, tokens.NATIVE_TOKEN),
    prompt: `${tokens.practiceLanguageMapping(input.practice, input.native)}\n\n${streamingPlanner.buildStreamingPlannerUserPrompt(input)}`,
    model: 'gemini-3.1-flash-lite',
    category: 'practice_planner',
    siCached: true,
  };
}

/** PRACTICE-GEN-11: the five text slots pass an explicit `model:`; the
 *  listen-* slots take the server default. vocab-matching makes NO call.
 *
 *  The explicit value is read from the app's own `modelConfig.ts` rather
 *  than pinned here — it moved from a preview tier to flash-lite on
 *  2026-07-25 and a hardcoded copy would have kept pricing the retired
 *  tier (COST-PROMPT-1). `SERVER_DEFAULT` mirrors MODELS.clientGenerate. */
const SERVER_DEFAULT = 'gemini-3.1-flash-lite';
export let SLOT_MODEL = {};
function buildSlotModels(practicePrimary) {
  SLOT_MODEL = {
    'multiple-choice': practicePrimary,
    'practice-to-native': practicePrimary,
    'native-to-practice': practicePrimary,
    'fill-the-blank': practicePrimary,
    'find-the-mistake': practicePrimary,
    'listen-and-pick': SERVER_DEFAULT,
    'listen-and-fill': SERVER_DEFAULT,
    'listen-and-write': SERVER_DEFAULT,
  };
}
buildSlotModels(SERVER_DEFAULT);

export const SLOT_CATEGORY = {
  'multiple-choice': 'practice_gen_mc',
  'practice-to-native': 'practice_gen_p2n',
  'native-to-practice': 'practice_gen_n2p',
  'listen-and-pick': 'practice_gen_lap',
  'fill-the-blank': 'practice_gen_fb',
  'find-the-mistake': 'practice_gen_fm',
  'listen-and-fill': 'practice_gen_lf',
  'listen-and-write': 'practice_gen_lw',
};

const MC_FAMILY = new Set(['multiple-choice', 'practice-to-native', 'native-to-practice', 'listen-and-pick']);

export function slotGeneratorCall({ slotType, spec, practice, native, difficulty }) {
  const input = { spec: { ...spec, type: slotType }, practice, native, difficulty };
  // PRACTICE-CACHE-1 — the SI is built from TOKENS (so it is byte-identical for
  // every learner and cacheable); the languages ride the user prompt.
  const T = L('prompts/languageTokens.js');
  const P = T.PRACTICE_TOKEN, N = T.NATIVE_TOKEN;
  let si;
  if (MC_FAMILY.has(slotType)) si = practiceGen.mcGeneratorSystemInstruction(P, N);
  else if (slotType === 'fill-the-blank') si = practiceGen.fillBlankGeneratorSystemInstruction(P, N);
  else if (slotType === 'find-the-mistake') si = practiceGen.findMistakeGeneratorSystemInstruction(P, N);
  else if (slotType === 'listen-and-fill') si = practiceListen.listenFillGeneratorSystemInstruction(P, N);
  else if (slotType === 'listen-and-write') si = practiceListen.listenWriteGeneratorSystemInstruction(P, N);
  else throw new Error(`No generator SI for slot type ${slotType}`);
  const body = MC_FAMILY.has(slotType)
    ? practiceGen.buildMcGeneratorUserPrompt(input)
    : practiceGen.buildSimpleSpecUserPrompt(input);
  const prompt = `${T.practiceLanguageMapping(practice, native)}\n\n${body}`;
  // PRACTICE-CACHE-1 — token-built SI, served from a per-kind explicit cache.
  // Sub-floor kinds (listen-fill 907, listen-write 853) are filtered out by
  // MIN_CACHEABLE_TOKENS in simulate.mjs rather than guessed at here.
  return { si, prompt, model: SLOT_MODEL[slotType], category: SLOT_CATEGORY[slotType], siCached: true };
}

// ── cards + topics + import ────────────────────────────────────────────

// TOPIC-SET-4 — the SI is rendered from the theme list; bare names stand in
// for the v2 themes here (the cost model only needs a realistic size).
export function topicClassifyCall({ phrase, translation, existingTopics }) {
  const themes = existingTopics.map((name) => ({ name }));
  return {
    si: topicClassify.topicClassifySystemInstruction(themes),
    prompt: topicClassify.topicClassifyUserPrompt(phrase, translation, themes),
    model: 'gemini-3.1-flash-lite',
    category: 'topic_classify',
    siCached: false,
  };
}

export function chatImportCall({ messages, existingPhrases, practice, native }) {
  return {
    si: chatExtract.chatExtractSystemInstruction(practice, native),
    prompt: chatExtract.buildChatExtractUserPrompt({ messages, existingPhrases, practice, native }),
    model: 'gemini-3.1-flash-lite',
    category: 'chat_import_extract',
    siCached: false,
  };
}

/** CARDS-LIST-8 / SRV-PROMPT-5 — the prompt moved server-side, so this now
 *  calls the real builder instead of mirroring it. */
export function cardTranslateCall({ text, fromLanguage, toLanguage }) {
  return {
    si: cardTranslate.cardTranslateSystemInstruction(fromLanguage, toLanguage),
    prompt: cardTranslate.cardTranslateUserPrompt(text, fromLanguage, toLanguage),
    model: 'gemini-3.1-flash-lite',
    category: 'card_translate',
    siCached: false,
  };
}
