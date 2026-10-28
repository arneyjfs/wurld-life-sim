/**
 * Send-observability query library (OBS-SEND-*).
 *
 * The single source of truth for the Firestore reads that power BOTH the admin
 * dashboard Cloud Functions AND the local `scripts/obs.cjs` cost/anomaly CLI.
 * Each function is a PURE read: it takes a Firestore handle + params and returns
 * a structured result — no HTTP, no admin-gating (that stays in the endpoint
 * wrappers). Read-only; never writes.
 */
import { Timestamp, type Firestore } from "firebase-admin/firestore";
import { parseByModelFieldKey } from "../usageStatsHelpers";

/** The full-prompt/SI/output detail collection (14-day TTL). Single source of
 *  truth for the name — index.ts's recordPipelineTrace writes here. */
export const TRACE_DETAILS_COLLECTION = "pipelineTraceDetails";

export type TokenBucket = { in: number; out: number; count: number; cached: number };
const emptyBucket = (): TokenBucket => ({ in: 0, out: 0, count: 0, cached: 0 });

/**
 * Known token-usage categories, used to SEED the per-category display with a
 * stable set (so the standard categories show even at zero) and to give them
 * canonical ordering. It is NOT a filter: `queryTokenUsage` derives each doc's
 * categories from its own field keys (`categoriesInUsageDoc`) and sums ALL of
 * them toward the totals, so a category missing here is still counted — it just
 * isn't pre-seeded. Keep it roughly current with the recordTokenUsage call
 * sites + client-supplied categories for tidy display, but a gap no longer
 * undercounts.
 */
export const USAGE_CATEGORIES = [
  "message_analysis", "message_translation", "explain", "explain_followup", "explain_practice", "explain_phrase",
  "practice_planner", "practice_planner_stream",
  "practice_gen_mc", "practice_gen_fb", "practice_gen_fm", "practice_gen_lf", "practice_gen_lw",
  "practice_gen_n2p", "practice_gen_p2n", "practice_gen_lap",
  "practice_card_selector", "practice_verify",
  // Tutor LLM calls. `tutor_chat` = the reply/router call; `tutor_action` =
  // the flashcard/explain generator (TUTOR-ACTION-2/3); `tutor_setup` = the
  // onboarding-walkthrough replies; `tutor_compact` = background memory
  // compaction (TUTOR-COMPACT-*).
  "tutor_chat", "tutor_action", "tutor_setup", "tutor_compact", "tutor_message",
  // Life feature (LifeScreen) LLM calls — ALL TWELVE the client actually sends,
  // asserted against the call sites by `__tests__/usageCategories.test.ts`.
  //
  // Corrected 2026-09-18. This block used to list seven, one of which
  // (`life_world_saga`) was a PRE-RENAME name nothing has sent since the saga
  // call became `life_saga` (`src/lib/life/runSagaOpen.ts`), while six real
  // categories were missing entirely. That is not cosmetic: the seed set is what
  // makes a category show in the admin view AT ZERO, so an unseeded category is
  // invisible until it already has traffic — and the reject-code counts
  // (`missing-spec` since 2026-09-29) are read per category, i.e. off exactly
  // the rows that are supposed to be zero.
  //
  // ⚠ `life_scene` is scene CLOSE and `life_scene_gen` is scene OPEN. They look
  // inverted and they are NOT a typo — these are the wire values the client has
  // always sent (`runSceneClose.ts` / `runSceneOpen.ts`). Renaming either one
  // moves its telemetry bucket and orphans every historical doc (SRV-PROMPT-4).
  "life_step", "life_backdrop", "life_bio", "life_world_arc", "life_saga",
  "life_scene", "life_scene_gen", "life_resume_recap",
  "life_npc_profile", "life_npc_avatar", "life_npc_avatar_params",
  "life_graded_question",
  "topic_classify", "session_intent",
  "tts_synthesis", "client_translate", "card_translate", "chat_import_extract", "unknown",
];

export type TokenUsageResult = {
  period: { days: number; startDate: string; endDate: string };
  totals: { tokensIn: number; tokensOut: number; cached: number };
  daily: { date: string; tokensIn: number; tokensOut: number; cached: number }[];
  users: {
    uid: string;
    displayName: string;
    tokensIn: number;
    tokensOut: number;
    byCategory: Record<string, TokenBucket>;
    totalTokens: number;
  }[];
  categories: Record<string, TokenBucket>;
  categoriesByModel: Record<string, Record<string, TokenBucket>>;
  /**
   * MSG-PIPE-22 — what the analysis is actually DOING, not what it costs.
   *
   * NOT a partition: one practice message can be counted in `practice`,
   * `corrected` AND `suggested`. Read it as "of N practice messages, C were
   * corrected and S produced a suggestion" — summing the four gives a number
   * that means nothing.
   *
   * `suggested` counts suggestions that SURVIVED to the user, not flags raised:
   * a `<nat>check</nat>` whose second call returned `<none/>` or a duplicate
   * produced nothing anyone will see.
   */
  sendMix: { native: number; practice: number; corrected: number; suggested: number };
};

/**
 * The token categories present in a single `tokenUsage/{uid}/daily/{date}` doc,
 * derived from its OWN field keys (`${cat}.in|out|count|cached`) rather than a
 * fixed allowlist. This is what keeps a category recorded by any client feature
 * (Life, new practice generators, chat-import, …) from being silently dropped
 * from the admin totals — the previous allowlist-only sum undercounted every
 * category that hadn't been hand-added to USAGE_CATEGORIES. `${cat}.byModel.…`
 * sub-keys are excluded here (the per-(category,model) scan handles them, and
 * every category always has flat keys too, so nothing is missed).
 */
export function categoriesInUsageDoc(d: Record<string, unknown>): string[] {
  const cats = new Set<string>();
  for (const key of Object.keys(d)) {
    if (key.includes(".byModel.")) continue;
    const m = key.match(/^(.+)\.(in|out|count|cached)$/);
    if (m) cats.add(m[1]);
  }
  return [...cats];
}

/**
 * Aggregate `tokenUsage/{uid}/daily/{date}` over the last `days` (1-30, default
 * 7) into daily / per-user / per-category / per-(category,model) buckets, each
 * with cached-token counts. Resolves display names from `users/{uid}`.
 * Category totals are derived per-doc (see `categoriesInUsageDoc`) so no
 * recorded category is ever excluded from the totals / cost.
 */
export async function queryTokenUsage(
  db: Firestore,
  opts: { days?: number } = {},
): Promise<TokenUsageResult> {
  const days = Math.min(Math.max(Number(opts.days) || 7, 1), 30);
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const snap = await db
    .collectionGroup("daily")
    .where("date", ">=", startDate)
    .where("date", "<=", endDate)
    .get();

  const dailyUsage: Record<string, { tokensIn: number; tokensOut: number; cached: number }> = {};
  const userUsage: Record<
    string,
    { tokensIn: number; tokensOut: number; byCategory: Record<string, TokenBucket> }
  > = {};
  const categoryTotals: Record<string, TokenBucket> = {};
  for (const cat of USAGE_CATEGORIES) categoryTotals[cat] = emptyBucket();
  const categoriesByModel: Record<string, Record<string, TokenBucket>> = {};

  let totalIn = 0;
  let totalOut = 0;
  let totalCached = 0;
  const sendMix = { native: 0, practice: 0, corrected: 0, suggested: 0 };

  for (const doc of snap.docs) {
    const d = doc.data();
    const userId = d.userId as string | undefined;
    const date = d.date as string | undefined;
    if (!userId || !date) continue;

    let docIn = 0;
    let docOut = 0;
    let docCached = 0;

    // Same doc, same window, same query — so these cost no extra read and no
    // new index. They are deliberately summed OUTSIDE the category loop: they
    // carry no `.in`/`.out`, so `categoriesInUsageDoc` skips them and they can
    // never leak into the token totals.
    sendMix.native += Number(d["sendMix.native"] ?? 0);
    sendMix.practice += Number(d["sendMix.practice"] ?? 0);
    sendMix.corrected += Number(d["sendMix.corrected"] ?? 0);
    sendMix.suggested += Number(d["sendMix.suggested"] ?? 0);

    // Category-agnostic: sum EVERY category present in this doc (not a fixed
    // allowlist) so newly-added client categories are never silently dropped.
    for (const cat of categoriesInUsageDoc(d)) {
      // Flat dot-notation keys: "category.in" / ".out" / ".count" / ".cached".
      const catIn = Number(d[`${cat}.in`] ?? 0);
      const catOut = Number(d[`${cat}.out`] ?? 0);
      const catCount = Number(d[`${cat}.count`] ?? 0);
      const catCached = Number(d[`${cat}.cached`] ?? 0);
      if (catIn > 0 || catOut > 0) {
        docIn += catIn;
        docOut += catOut;
        docCached += catCached;
        if (!categoryTotals[cat]) categoryTotals[cat] = emptyBucket();
        categoryTotals[cat].in += catIn;
        categoryTotals[cat].out += catOut;
        categoryTotals[cat].count += catCount;
        categoryTotals[cat].cached += catCached;
        if (!userUsage[userId]) userUsage[userId] = { tokensIn: 0, tokensOut: 0, byCategory: {} };
        if (!userUsage[userId].byCategory[cat]) userUsage[userId].byCategory[cat] = emptyBucket();
        userUsage[userId].byCategory[cat].in += catIn;
        userUsage[userId].byCategory[cat].out += catOut;
        userUsage[userId].byCategory[cat].count += catCount;
        userUsage[userId].byCategory[cat].cached += catCached;
      }
    }

    // Per-(category, model) scan — once per doc (O(field-count)).
    for (const fieldKey of Object.keys(d)) {
      const parsed = parseByModelFieldKey(fieldKey);
      if (!parsed) continue;
      const { category: pCat, model: pModel, metric } = parsed;
      if (!categoriesByModel[pCat]) categoriesByModel[pCat] = {};
      if (!categoriesByModel[pCat][pModel]) categoriesByModel[pCat][pModel] = emptyBucket();
      (categoriesByModel[pCat][pModel] as Record<string, number>)[metric] += Number(d[fieldKey] ?? 0);
    }

    totalIn += docIn;
    totalOut += docOut;
    totalCached += docCached;

    if (!dailyUsage[date]) dailyUsage[date] = { tokensIn: 0, tokensOut: 0, cached: 0 };
    dailyUsage[date].tokensIn += docIn;
    dailyUsage[date].tokensOut += docOut;
    dailyUsage[date].cached += docCached;

    if (!userUsage[userId]) userUsage[userId] = { tokensIn: 0, tokensOut: 0, byCategory: {} };
    userUsage[userId].tokensIn += docIn;
    userUsage[userId].tokensOut += docOut;
  }

  const userIds = Object.keys(userUsage);
  const userDocs = await Promise.all(userIds.map((uid) => db.doc(`users/${uid}`).get()));
  const nameMap: Record<string, string> = {};
  for (let i = 0; i < userIds.length; i++) {
    const data = userDocs[i].data();
    nameMap[userIds[i]] = (data?.displayName as string) || userIds[i].slice(0, 8);
  }

  const daily = Object.entries(dailyUsage)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, v]) => ({ date, ...v }));

  const users = Object.entries(userUsage)
    .map(([uid, v]) => ({
      uid,
      displayName: nameMap[uid] ?? uid.slice(0, 8),
      ...v,
      totalTokens: v.tokensIn + v.tokensOut,
    }))
    .sort((a, b) => b.totalTokens - a.totalTokens);

  return {
    period: { days, startDate, endDate },
    totals: { tokensIn: totalIn, tokensOut: totalOut, cached: totalCached },
    daily,
    users,
    categories: categoryTotals,
    categoriesByModel,
    sendMix,
  };
}

// ---- pipeline traces -------------------------------------------------------

export type PipelineTraceItem = {
  chatId: string;
  messageId: string;
  senderName: string;
  senderId: string;
  originalText: string;
  originalLanguage: string;
  isPractice: boolean;
  sendStatus: string;
  createdAtMs: number | null;
  pipeline: {
    state: string | null;
    version: number | null;
    startTimeMs: number | null;
    totalDurationMs: number | null;
    traces: FirebaseFirestore.DocumentData[];
    stageOutputs: Record<string, unknown>;
    clientSendMs: number | null;
    serverReceivedMs: number | null;
    sendPath: string | null;
    sendAttempt: number | null;
    sendUserRetries: number | null;
  };
  analysis: {
    status: string | null;
    detectedLanguage: string | null;
    detectedBucket: string | null;
    error: string | null;
    feedback: unknown;
    resultType: string | null;
  };
  pendingReview: unknown;
  translationJobs: Record<string, FirebaseFirestore.DocumentData>;
  translationCount: number;
};

/** Recent pipeline messages + their trace summaries — per-chat or cross-chat
 *  (collectionGroup). The raw material for cost/anomaly analysis. */
export async function queryPipelineTraces(
  db: Firestore,
  opts: { chatId?: string; limit?: number; before?: number; status?: string } = {},
): Promise<{ items: PipelineTraceItem[]; count: number }> {
  const limit = Math.min(Math.max(Number(opts.limit) || 50, 1), 200);
  const beforeMs = Number(opts.before) || undefined;
  const statusFilter = opts.status;

  const messages: FirebaseFirestore.DocumentData[] = [];
  if (opts.chatId) {
    let q = db
      .collection(`chats/${opts.chatId}/messages`)
      .orderBy("createdAt", "desc")
      .limit(limit);
    if (beforeMs) q = q.where("createdAt", "<", Timestamp.fromMillis(beforeMs));
    const snap = await q.get();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (statusFilter && d.pipeline?.state !== statusFilter) continue;
      messages.push({ chatId: opts.chatId, messageId: doc.id, ...d });
    }
  } else {
    let q = db.collectionGroup("messages").orderBy("createdAt", "desc").limit(limit * 3);
    if (beforeMs) q = q.where("createdAt", "<", Timestamp.fromMillis(beforeMs));
    const snap = await q.get();
    for (const doc of snap.docs) {
      const d = doc.data();
      if (statusFilter && d.pipeline?.state !== statusFilter) continue;
      const pathParts = doc.ref.path.split("/");
      const msgChatId = pathParts.length >= 2 ? pathParts[1] : "";
      messages.push({ chatId: msgChatId, messageId: doc.id, ...d });
      if (messages.length >= limit) break;
    }
  }

  const items = messages.map((m): PipelineTraceItem => {
    const createdAtMs =
      m.createdAt?.toMillis?.() ?? (m.createdAt?._seconds ? m.createdAt._seconds * 1000 : null);
    return {
      chatId: m.chatId,
      messageId: m.messageId,
      senderName: m.senderName ?? "",
      senderId: m.senderId ?? "",
      originalText: (m.originalText ?? "").slice(0, 200),
      originalLanguage: m.originalLanguage ?? "",
      isPractice: m.isPractice ?? false,
      sendStatus: m.sendStatus ?? "",
      createdAtMs,
      pipeline: {
        state: m.pipeline?.state ?? null,
        version: m.pipeline?.version ?? null,
        startTimeMs: m.pipeline?.startTimeMs ?? null,
        totalDurationMs: m.pipeline?.totalDurationMs ?? null,
        traces: m.pipeline?.traces ?? [],
        stageOutputs: m.pipeline?.stageOutputs ?? {},
        clientSendMs: m.pipeline?.clientSendMs ?? null,
        serverReceivedMs: m.pipeline?.serverReceivedMs ?? null,
        // MSG-OUTBOX-14.2
        sendPath: m.pipeline?.sendPath ?? null,
        sendAttempt: m.pipeline?.sendAttempt ?? null,
        sendUserRetries: m.pipeline?.sendUserRetries ?? null,
      },
      analysis: {
        status: m.analysis?.status ?? null,
        detectedLanguage: m.analysis?.detectedLanguage ?? null,
        detectedBucket: m.analysis?.detectedBucket ?? null,
        error: m.analysis?.error ?? null,
        feedback: m.analysis?.feedback ?? null,
        resultType: m.pipeline?.stageOutputs?.analysis?.result_type ?? null,
      },
      pendingReview: m.pendingReview
        ? {
            corrections: m.pendingReview.corrections ?? [],
            correctedText: m.pendingReview.correctedText ?? null,
            isUnreadable: m.pendingReview.isUnreadable ?? false,
            suggestions: m.pendingReview.suggestions ?? [],
            naturalAlternative: m.pendingReview.naturalAlternative
              ? {
                  practiceText: m.pendingReview.naturalAlternative.practiceText ?? "",
                  reasoning: m.pendingReview.naturalAlternative.reasoning ?? "",
                }
              : null,
          }
        : null,
      translationJobs: m.translationJobs ?? {},
      translationCount: Object.keys(m.translations ?? {}).length,
    };
  });

  return { items, count: items.length };
}

// ---- trace details (full prompt + system instruction per stage) ------------

export type TraceDetail = {
  stage: string;
  model: string;
  prompt: string;
  rawOutput: string;
  thinking?: string;
  systemInstruction?: string;
  thinkingLevel?: string;
  thinkingBudget?: number;
  /** MSG-PIPE-31.12 — OpenAI tier answered, on Fast mode attempts. */
  serviceTier?: string;
  tokens: { in: number; out: number; cached?: number } | null;
  durationMs: number;
  startMs: number;
  status: string;
  error: string | null;
  createdAt: number | null;
  expiresAt: number | null;
};

/** Full per-stage prompt + system instruction + raw output for one message
 *  (stage-filtered if given), sorted chronologically. Powers prompt/SI/cache
 *  inspection. */
export async function queryTraceDetails(
  db: Firestore,
  opts: { chatId: string; messageId: string; stage?: string; limit?: number },
): Promise<TraceDetail[]> {
  let q = db
    .collection(TRACE_DETAILS_COLLECTION)
    .where("chatId", "==", opts.chatId)
    .where("messageId", "==", opts.messageId) as FirebaseFirestore.Query;
  if (opts.stage) q = q.where("stage", "==", opts.stage);
  const snap = await q.limit(Math.min(Math.max(Number(opts.limit) || 50, 1), 200)).get();
  return snap.docs
    .sort((a, b) => (a.data().startMs ?? 0) - (b.data().startMs ?? 0))
    .map((doc): TraceDetail => {
      const d = doc.data();
      return {
        stage: d.stage,
        model: d.model,
        prompt: d.prompt,
        rawOutput: d.rawOutput,
        ...(d.thinking ? { thinking: d.thinking } : {}),
        ...(d.systemInstruction ? { systemInstruction: d.systemInstruction } : {}),
        ...(d.thinkingLevel ? { thinkingLevel: d.thinkingLevel } : {}),
        ...(typeof d.thinkingBudget === "number" ? { thinkingBudget: d.thinkingBudget } : {}),
        ...(typeof d.serviceTier === "string" ? { serviceTier: d.serviceTier } : {}),
        tokens: d.tokens ?? null,
        durationMs: d.durationMs,
        startMs: d.startMs,
        status: d.status,
        error: d.error ?? null,
        createdAt: d.createdAt?.toMillis?.() ?? null,
        expiresAt: d.expiresAt?.toMillis?.() ?? null,
      };
    });
}
