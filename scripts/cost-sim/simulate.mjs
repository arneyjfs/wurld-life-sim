/**
 * A simulated week for 10 friends. Emits a full per-call ledger so every
 * token in the totals is traceable to a call, a user and a day.
 *
 * COST-SIM-1: input tokens are counted exactly (tokenizer.mjs) from prompts
 * built by the app's own builders. Output tokens come from calibration.json,
 * measured live per call type. Nothing in the ledger is a round number
 * someone typed in.
 *
 * COST-SIM-2: the week varies deliberately — message volume, language mix,
 * practice load, explain/tutor frequency all move day to day, and chats are
 * reset between scenarios so a language change never triggers a history
 * backfill. Backfill is a real cost; it is EXCLUDED here by construction
 * and reported separately rather than silently averaged in.
 *
 * COST-SIM-3: life-sim / Wurlds is out of scope. No `life_*` category is
 * modelled.
 *
 *   node --experimental-strip-types scripts/cost-sim/simulate.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as CP from './callprompts.mjs';
import { chatLanguageFor } from './chatlang.mjs';
import * as KP from './keyplan.mjs';
import { CHATS, EXPLAIN_FOLLOWUPS, MESSAGES, POPULATION, TUTOR_TURNS, USERS, pickMessage, pickWriteLanguage } from './corpus.mjs';
import { countTokens, flushCache, tokenizerStats } from './tokenizer.mjs';
import { TTS_WORDS_PER_SECOND, callCost, ttsCost } from './pricing.mjs';
import * as FS from './firestore.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CAL = JSON.parse(readFileSync(join(HERE, 'calibration.json'), 'utf8'));

// ── calibration lookup ─────────────────────────────────────────────────

/** Median output+thoughts for every calibration label matching `re`.
 *  Median, not mean: the MC-family thinking distribution has a long right
 *  tail (one 7.6k draw against a ~1k body), and a mean would let a single
 *  outlier set the price of every practice session in the week. The tail
 *  is reported separately in the sensitivity band. */
function calib(re) {
  const rows = CAL.results.filter((r) => re.test(r.label) && !r.error);
  if (!rows.length) throw new Error(`No calibration rows for ${re}`);
  const med = (xs) => {
    const s = [...xs].sort((a, b) => a - b);
    return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
  };
  return {
    out: med(rows.map((r) => r.out)),
    thoughts: med(rows.map((r) => r.thoughts)),
    cached: med(rows.map((r) => r.cached)),
    n: rows.length,
  };
}

const C = {
  analysis: calib(/^analysis\//),
  translateOnly: calib(/^translate\/translate-only\//),
  translateAndAnnotate: calib(/^translate\/translate-and-annotate\//),
  annotateOnly: calib(/^translate\/annotate-only\//),
  explain: calib(/^explain\/SHIPPED/),
  explainFollowUp: calib(/^explain_followup\//),
  tutorChat: calib(/^tutor_chat\/conversational/),
  tutorBail: calib(/^tutor_chat\/(cold|warm)/),
  tutorCompact: calib(/^tutor_compact/),
  tutorActionFlashcards: calib(/^tutor_action\/flashcards/),
  tutorActionExplain: calib(/^tutor_action\/explain/),
  tutorActionPractice: calib(/^tutor_action\/practice/),
  cardSelector: calib(/^practice_card_selector\//),
  planner: calib(/^practice_planner\//),
  topicClassify: calib(/^topic_classify/),
  cardTranslate: calib(/^card_translate/),
  chatImport: calib(/^chat_import_extract/),
};
const SLOT_CAL = {
  'multiple-choice': calib(/^practice_gen\/multiple-choice\/AS-SHIPPED/),
  'practice-to-native': calib(/^practice_gen\/practice-to-native\/AS-SHIPPED/),
  'native-to-practice': calib(/^practice_gen\/native-to-practice\/AS-SHIPPED/),
  'fill-the-blank': calib(/^practice_gen\/fill-the-blank\/AS-SHIPPED/),
  'find-the-mistake': calib(/^practice_gen\/find-the-mistake\/AS-SHIPPED/),
  'listen-and-pick': calib(/^practice_gen\/listen-and-pick\/AS-SHIPPED/),
  'listen-and-fill': calib(/^practice_gen\/listen-and-fill\/AS-SHIPPED/),
  'listen-and-write': calib(/^practice_gen\/listen-and-write\/AS-SHIPPED/),
};

// ── deterministic RNG ──────────────────────────────────────────────────

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(20260811);


const pick = (arr) => arr[Math.floor(rng() * arr.length)];
const between = (lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));

// ── ledger ─────────────────────────────────────────────────────────────

/**
 * COST-POLICY-1 — the FREE-TIER FEATURE POLICY under simulation.
 *
 * Every field defaults to "nothing is withheld", so an unset POLICY reproduces
 * the shipped product exactly and the baseline row of the scenario table is the
 * measured week rather than a re-derivation of it.
 *
 * The policies are all about the FAN-OUT, because that is where a chat message's
 * money goes: one analysis call is fixed per message, and everything else scales
 * with how many DIFFERENT renderings the same sentence has to exist in.
 */
const POLICY = {
  /** 'all' | 'none' | 'cap4' — which chats a user may be in. */
  groups: 'all',
  /** 'per-user' | 'groups' | 'all' — whose language decides the rendering.
   *  'groups' fixes ONE language per group chat (DMs keep per-user keys);
   *  'all' fixes it everywhere. A fixed chat language collapses N member
   *  renderings into 1, which is the single largest lever available. */
  chatLang: 'per-user',
  /** true | false | 'dm-only' — the tappable vocab list. 'dm-only' keeps the
   *  learning product where it is most personal (1:1) and treats group chat as
   *  plain translation, which is also where the fan-out is widest. */
  annotate: true,
  /** false — drop the prior-messages block from the prompts. */
  context: true,
  /** 'full' | 'none' — 'none' skips the analysis call entirely: no correction,
   *  no bilingual rows for the sender, just a translation for the readers. */
  analysis: 'full',
  /** messages per user per MONTH, or null for uncapped. */
  cap: null,
  /** 'sent' | 'received' | 'both' — what the counter counts. */
  capCounts: 'both',
  /** 'all' | 'groups' | 'dm' — which chats count toward it and are gated. */
  capScope: 'all',
  /** 'degrade' | 'block' — what happens once the allowance is spent. */
  capAction: 'degrade',
  /**
   * COST-TIER-15 — EVERY CHAT NEEDS A SUBSCRIBER.
   *
   *   'off'     nobody is required to pay. Today's product.
   *   'groups'  a GROUP with no subscriber cannot send; one-to-one is free and
   *             unlimited (COST-TIER-14).
   *   'all'     a group OR a one-to-one with no subscriber cannot send.
   *
   * Checked before anything is billed or counted, because the state being
   * modelled is "you cannot post here", not "your message arrives
   * untranslated". A blocked chat stops costing anything at all, which is what
   * separates this from every cap policy above it.
   */
  needPaid: 'off',
  /**
   * What a SINGLE-LANGUAGE chat renders in — 'native' (the language most
   * members speak) or 'practice' (the one most are learning). See
   * `chatlang.mjs`; the cost is identical, the product is not.
   *
   * ⚠ Applies to `chatLang` only. Under `tierLang: 'free-shared'` a group
   * carries a PAIR — both a reading language and a practice language, with the
   * vocab row between them — so it takes both modals and this dial does not
   * reach it.
   */
  chatLangSource: 'native',
  /**
   * COST-TIER-17 — the share of PRO members who override their practice
   * language inside a given chat rather than letting it follow their global.
   *
   * This is the one place a subscriber can ADD a language to a room, so it is
   * the only way a group's width grows with conversion. 0 means every
   * subscriber's chat practice follows their global (the default behaviour);
   * 1 means every subscriber diverges. Applied deterministically per
   * (member, chat) so a scenario is reproducible.
   */
  proOverrideRate: 0,
  /** 'off' | 'paid' | 'chat' — COST-TIER-11 / COST-TIER-13. 'paid' constrains a FREE member's native and
   *  practice to the languages the chat's PAID members already use. Nobody
   *  loses a feature; the chat cannot accumulate unpaid-for languages. */
  langSet: 'off',
  /** 'off' | 'free-shared' — COST-TIER-7. 'free-shared' gives FREE members one
   *  shared language per chat while PRO members keep per-user rendering. */
  tierLang: 'off',
  /** 'flat' | 'skewed' — how message volume is distributed across users. */
  activity: 'flat',
  ...JSON.parse(process.env.POLICY ?? '{}'),
};

/**
 * COST-POLICY-11 — how message volume is spread across people.
 *
 * The corpus picks a sender uniformly, which gives ten near-identical users at
 * ~767 sent/month each. That is fine for a total, and actively misleading for
 * an ALLOWANCE: a flat population makes every cap look like it hits everybody,
 * because it does. Real messaging traffic is nothing like flat — a minority
 * writes most of it.
 *
 * `activity: 'skewed'` weights sender selection by 1/rank (Zipf), which puts
 * ~27% of all messages on the single most active person and ~4% on the
 * quietest: a 6.7x spread across the group. Total volume is UNCHANGED, so the
 * baseline cost is unchanged too — only the distribution moves, which is
 * exactly the variable a cap is tuned against.
 *
 * This is a modelling assumption, not a measurement: there is no production
 * telemetry to fit it to yet. Treat the skewed rows as "what a cap does to a
 * realistically uneven population", and re-fit the exponent once real
 * per-user volume exists.
 */
const ACTIVITY_WEIGHT = Object.fromEntries(
  USERS.map((u, i) => [u.id, POLICY.activity === 'skewed' ? 1 / (i + 1) : 1]),
);

/** Pick a sender from a chat's members, weighted by how much they talk. */
function pickSender(members) {
  const total = members.reduce((a, m) => a + (ACTIVITY_WEIGHT[m.id] ?? 1), 0);
  let r = rng() * total;
  for (const m of members) {
    r -= ACTIVITY_WEIGHT[m.id] ?? 1;
    if (r <= 0) return m;
  }
  return members[members.length - 1];
}

/**
 * COST-POLICY-2 — cost is attributed to the user who CAUSED it, not to the
 * sender of the message that happened to trigger it.
 *
 * The distinction is the whole point of this file for a tiering question. One
 * analysis call is caused by the person writing; the convert call's SIZE is
 * caused by the people READING, because each of them adds a target block. So
 * analysis lands on the sender and convert is split across the recipients whose
 * keys it carried — which is exactly what production already does with its
 * token accounting (`splitTokensAcrossMembers`). Billing the whole message to
 * the sender would say a free user in a ten-person group costs nothing, and
 * that is precisely backwards.
 */
const perUser = {};
/**
 * COST-POLICY-12 — the same attribution, split by WHERE it happened.
 *
 * A policy that changes group chats and leaves 1:1s alone cannot be judged from
 * a per-user total: the total moves, and the total alone cannot say whether it
 * moved because groups got cheaper or because the user simply talks less. The
 * three buckets sum to `perUser` exactly (`other` catches practice, tutor,
 * explain, read-aloud and cards, none of which live in a chat), so the split is
 * auditable rather than indicative.
 */
const perUserByKind = {};
let attributionKind = 'other';
function attribute(userIds, usd) {
  if (!userIds.length) return;
  const share = usd / userIds.length;
  for (const id of userIds) {
    perUser[id] = (perUser[id] ?? 0) + share;
    const b = perUserByKind[id] ?? (perUserByKind[id] = { group: 0, dm: 0, other: 0 });
    b[attributionKind] += share;
  }
}

/** Worked examples of the fan-out the policy actually planned, captured from
 *  the live planner rather than reconstructed, so an example cannot describe a
 *  plan the run did not make. Keyed `<chatKind>:<sent|recv>`, and when
 *  TRACE_USER is set only messages that user was part of are eligible — the
 *  point of a trace is one person's own traffic, not the population's. */
const examples = {};
const TRACE_USER = process.env.TRACE_USER || null;
/**
 * Record the first message of each shape the traced user takes part in. The
 * SEND and the RECEIVE cases have to be kept apart: under a fixed chat language
 * the sender's own message may need no call at all while a reader's still does,
 * and one example cannot show both.
 */
function captureExample({ chat, sender, members, allOthers, writeLang, text, jobs, senderOver }) {
  const involved = !TRACE_USER || members.some((m) => m.id === TRACE_USER);
  if (!involved) return;
  const role = TRACE_USER && sender.id !== TRACE_USER ? 'recv' : 'sent';
  const key = `${chat.kind === 'group' ? 'group' : 'dm'}:${role}`;
  if (examples[key]) return;
  examples[key] = {
    chat: chat.id, chatKind: chat.kind, role, members: members.length,
    sender: sender.id, senderNative: sender.native, senderPractice: sender.practice,
    wroteIn: writeLang, text: text.slice(0, 70),
    readers: allOthers.map((m) => ({ id: m.id, native: m.native, practice: m.practice })),
    targets: jobs.map((j) => ({ key: j.key, mode: j.mode, target: j.target, gloss: j.nativeForAnnotation })),
    llmCalls: (POLICY.analysis === 'none' || senderOver ? 0 : 1)
      + (jobs.length >= MULTI_TARGET_MIN ? 1 : jobs.length),
  };
}
/** Per-user traffic, split by chat kind, so "sends 767" can be broken down. */
const traffic2 = {};
function countTraffic(userId, kind, chatKind) {
  const b = traffic2[userId] ?? (traffic2[userId] = { sentGroup: 0, sentDm: 0, recvGroup: 0, recvDm: 0 });
  const suffix = chatKind === 'group' ? 'Group' : 'Dm';
  b[(kind === 'sent' ? 'sent' : 'recv') + suffix] += 1;
}

const ledger = [];
/** Ops are tracked per surface so the free/premium split in report.mjs is
 *  derived from where the work actually happened, not from a proxy like
 *  "share of LLM calls" (chat writes far more per call than practice does). */
const ops = { chat: z(), practice: z(), tutor: z() };
function z() { return { reads: 0, writes: 0, deletes: 0 }; }
const compute = { requests: 0, vcpuSeconds: 0, gibSeconds: 0 };
const errors = [];
/** Traffic profile. The simulation's message-volume and chat-mix assumptions
 *  are the inputs a reader is most likely to want to challenge, so they are
 *  RECORDED rather than left implicit in the DAYS/CHATS tables. */
const traffic = { byChat: {}, bySender: {} };

/**
 * COST-CAL-5: Gemini REFUSES to create an explicit context cache below
 * `min_total_token_count=1024`, so an SI under that floor bills at the full
 * input rate however cacheable the code believes it to be.
 *
 * This is not a rounding detail. The per-message `translate-only` convert SI is
 * **734 tokens** and translate-only is **50.3% of all translate calls** in the
 * simulated week — so a model that credited it with a 90% discount would
 * under-price the single most common LLM call in the app. Measured with
 * `scripts/cost-sim/cachefloor.mjs`, which asks Gemini rather than assuming.
 */
const MIN_CACHEABLE_TOKENS = 1024;

/** MSG-PIPE-26 — production batches at 2+ model-bound targets (MIN_BATCH_TARGETS
 *  in functions/src/multiTargetPlan.ts). Mirrored here so the ledger switches
 *  paths exactly where the server does. */
const MULTI_TARGET_MIN = 2;
/** COST-CAL-6 — measured output ratio of one batched call to the same targets
 *  answered separately (381/410 on a 6-target send, `multi_target_probe.mjs`). */
const MERGED_OUTPUT_FACTOR = 0.93;

/** Record one text-model call. `thoughts` bill at the output rate, so they
 *  are added into `out` for pricing AND kept separately so the report can
 *  show how much of the output bill is invisible reasoning. */
async function bill({ day, userId, tier, call, cal, seconds = 2.5, mode, causedBy }) {
  const [siTok, promptTok] = await Promise.all([countTokens(call.si), countTokens(call.prompt)]);
  const inTok = siTok + promptTok;
  // COST-CAL-4: a call whose SI production serves from an EXPLICIT context
  // cache bills the WHOLE SI at the cached rate, not `cal.cached`.
  //
  // `cal.cached` is what the live calibration observed, and calibration fires
  // bare calls — so it measures the IMPLICIT prefix cache, which covered 62.9%
  // of the analysis SI. Using it here charged production for a discount it does
  // not take. MEASURED with `scripts/cost-sim/cacheprobe.mjs` on
  // gemini-3.1-flash-lite: an explicit cache holding the 6,476-token analysis SI
  // returned cachedContentTokenCount = 6,476 on every call, including calls with
  // a different user prompt — 100.0% coverage, against 62.7% implicit on the
  // same SI. The storage side of that trade is priced separately
  // (`cacheStorageMonthly` in roadmap.mjs); this is only the per-call half.
  const cached = call.siCached && siTok >= MIN_CACHEABLE_TOKENS ? siTok : 0;
  const thoughts = cal.thoughts || 0;
  const out = (cal.out || 0) + thoughts;
  const cost = callCost({ in: inTok, out, cached }, call.model);
  ledger.push({
    day, userId, tier, category: call.category, model: call.model,
    in: inTok, siIn: siTok, promptIn: promptTok, cached, out: cal.out || 0, thoughts,
    ...(mode ? { mode } : {}),
    // COST-POLICY-12's bucket, so a reprice (COST-LUNA-1) can split by surface.
    chatKind: attributionKind,
    usd: cost.totalUsd, uncachedUsd: cost.uncachedTotalUsd,
  });
  attribute(causedBy ?? [userId], cost.totalUsd);
  compute.requests += 1;
  compute.vcpuSeconds += seconds;
  compute.gibSeconds += seconds * 0.5;
}

/** Record one TTS synthesis. Audio-output tokens dominate (25 tok/sec). */
async function billTts({ day, userId, tier, text, model = 'gemini-2.5-flash-tts' }) {
  const textTok = await countTokens(text);
  const words = text.trim().split(/\s+/).length;
  const seconds = Math.max(1.2, words / TTS_WORDS_PER_SECOND);
  const cost = ttsCost(textTok, seconds, model);
  ledger.push({
    day, userId, tier, category: 'tts_synthesis', model,
    in: textTok, siIn: 0, promptIn: textTok, cached: 0,
    out: cost.audioTokens, thoughts: 0, audioSeconds: seconds,
    usd: cost.totalUsd, uncachedUsd: cost.totalUsd,
  });
  compute.requests += 1;
  compute.vcpuSeconds += 3;
  compute.gibSeconds += 1.5;
}

const addOps = (bucket, o) => {
  ops[bucket].reads += o.reads;
  ops[bucket].writes += o.writes;
  ops[bucket].deletes += o.deletes;
};

// ── message pipeline ───────────────────────────────────────────────────

/**
 * Fan-out for one message. Analyze pre-fills the sender's three keys
 * (native bare, practice bare, annotated) as part of its own output, so
 * only the remaining member keys need a translate job.
 */
/**
 * COST-TIER-7 — required keys when free members share one language.
 *
 * Free members contribute exactly one key between them (the modal native of
 * the free cohort, by the same deterministic rule as COST-POLICY-3); pro
 * members contribute their full three. A chat of only free members still gets
 * that one shared key, which is what makes the policy well-defined in a room
 * the anchor rule has not reached.
 */
/**
 * COST-TIER-11 / 16 — the key algebra now lives in `keyplan.mjs`.
 *
 * It was extracted so it can be called directly with a hand-built chat and a
 * named sender, instead of only being observable through a week-long run. Every
 * cost number in this directory reduces to `planTranslateJobs`, which makes it
 * the one piece of logic most worth being able to check by hand;
 * `verify-keyplan.mjs` cross-checks it against an independently written model.
 */
function planTranslateJobs(chatMembers, sender, writeLang, chatKind = 'group', chatId = '') {
  return KP.planTranslateJobs(chatMembers, sender, writeLang, chatKind, chatId, POLICY);
}
const snapMembers = (chatMembers) => KP.snapMembers(chatMembers, POLICY);

async function simulateMessage(args) {
  // COST-POLICY-12 — everything billed inside a message belongs to that chat's
  // kind, and everything billed outside one does not. Setting the bucket here
  // and clearing it on the way out is what makes the three buckets sum to the
  // per-user total: without the reset, the practice session that runs after the
  // last message of the day would be filed under that message's chat.
  attributionKind = args.chat.kind === 'group' ? 'group' : 'dm';
  try {
    return await simulateMessageInner(args);
  } finally {
    attributionKind = 'other';
  }
}

async function simulateMessageInner({ day, chat, sender: rawSender, members, contextMessages, coalesce }) {
  // COST-TIER-11 — everything downstream sees the sender as the CHAT sees them.
  // A free member composing in a practice language the chat does not carry is
  // not a thing the product allows, so the simulation must not model it either.
  const sender = (POLICY.langSet === 'paid' || POLICY.langSet === 'chat')
    ? (snapMembers(members).find((m) => m.id === rawSender.id) ?? rawSender)
    : rawSender;
  const writeLang = pickWriteLanguage(rng, sender, 0.35);
  const text = pickMessage(rng, writeLang);
  const allOthers = members.filter((m) => m.id !== sender.id);

  // COST-TIER-15 — a chat with no subscriber sends NOTHING. Checked before
  // anything is billed or counted, because the product state being modelled is
  // "you cannot post here", not "your message arrives untranslated".
  const gated = POLICY.needPaid === 'all'
    || (POLICY.needPaid === 'groups' && chat.kind === 'group');
  if (gated && !members.some((m) => (m.tier ?? 'pro') === 'pro')) {
    capped.blockedSends += 1;
    return { text: '', writeLang: sender.native, jobCount: 0, blocked: true };
  }

  // COST-POLICY-8 — the allowance, applied where it actually bites.
  const senderOver = overCap(sender.id, 'sent') && inCapScope(chat.kind);
  if (senderOver && POLICY.capAction === 'block') {
    // The message never exists, so nobody receives it either. This is the only
    // policy on the list that removes cost from OTHER people's ledgers.
    // Not counted in traffic2: nobody received it, so counting the send would
    // make the sent and received columns describe different weeks.
    capped.blockedSends += 1;
    return { text, writeLang, jobCount: 0, blocked: true };
  }
  chargeCap(sender.id, 'sent', chat.kind);
  for (const m of allOthers) chargeCap(m.id, 'received', chat.kind);

  // A reader past their allowance stops being a TARGET: they see the original.
  // Their block leaves the batched call, which is where the 68% lives.
  const others = POLICY.cap
    ? allOthers.filter((m) => {
        const out = overCap(m.id, 'received') && inCapScope(chat.kind);
        if (out) capped.degradedReads += 1;
        return !out;
      })
    : allOthers;
  if (senderOver) capped.degradedSends += 1;

  // 1. analyze — one call per message, SI served from the explicit cache.
  //    COST-POLICY-5: caused by the person WRITING (detection, correction, and
  //    their own two rows), so it is attributed to the sender alone. A tier with
  //    `analysis: 'none'` is a pure translation product: the language is still
  //    settled deterministically (MSG-PIPE-24), but nothing is corrected and the
  //    sender gets no bilingual view of their own message.
  if (POLICY.analysis !== 'none' && !senderOver) {
    await bill({
      day, userId: sender.id, tier: 'chat', causedBy: [sender.id],
      call: CP.analysisCall({
        text,
        sender: { native: sender.native, practice: sender.practice, pronouns: sender.pronouns, name: sender.name },
        contextMessages, otherPronouns: others.map((m) => m.pronouns), replyTo: undefined,
      }),
      cal: C.analysis, seconds: 3.2,
    });
  }

  // 2. the convert fan-out. MSG-PIPE-26 — production answers 2+ model-bound
  //    targets in ONE call, so the ledger prices one call, not N.
  const jobs = planTranslateJobs([sender, ...others], sender, writeLang, chat.kind, chat.id);
  countTraffic(sender.id, 'sent', chat.kind);
  for (const m of allOthers) countTraffic(m.id, 'received', chat.kind);
  captureExample({ chat, sender, members, allOthers, writeLang, text, jobs, senderOver });
  // COST-POLICY-2 — the convert's SIZE is set by the readers, so they carry it.
  const readers = others.map((m) => m.id);
  const calFor = (mode) => (mode === 'translate-only' ? C.translateOnly
    : mode === 'annotate-only' ? C.annotateOnly : C.translateAndAnnotate);
  const recipientPronouns = others.length === 1 ? others[0].pronouns : undefined;

  if (jobs.length >= MULTI_TARGET_MIN) {
    /**
     * COST-CAL-6: the batched call's OUTPUT is the SUM of what the same targets
     * produce separately, times a MEASURED factor.
     *
     * Output cannot be carried over unscaled — a batch answering six readers
     * emits six blocks, so its output grows with the target count where its
     * INPUT does not. The factor is measured, not assumed: `multi_target_probe`
     * on a 6-target send returned 381 output tokens against 410 for the same six
     * targets as separate calls, i.e. 0.93. Slightly LESS than the sum, because
     * the blocks share no preamble. Input is measured directly from the real
     * prompt by `bill`, so only this one number is carried.
     */
    const summed = jobs.reduce((a, j) => a + (calFor(j.mode).out || 0), 0);
    const thoughts = jobs.reduce((a, j) => a + (calFor(j.mode).thoughts || 0), 0);
    await bill({
      day, userId: sender.id, tier: 'chat', causedBy: readers,
      call: CP.multiTargetCall({
        text, sourceLang: writeLang,
        targets: jobs.map((j) => ({ mode: j.mode, target: j.target, nativeForAnnotation: j.nativeForAnnotation })),
        contextMessages, senderPronouns: sender.pronouns, recipientPronouns,
      }),
      cal: { out: Math.round(summed * MERGED_OUTPUT_FACTOR), thoughts: Math.round(thoughts * MERGED_OUTPUT_FACTOR) },
      // Measured: a 4-target batch completed in ~1.1s and a 6-target one in
      // ~1.9s against ~2.2s for a single convert. One invocation, not N.
      seconds: 2.6, mode: 'multi-target',
    });
  } else {
    for (const job of jobs) {
      await bill({
        day, userId: sender.id, tier: 'chat', causedBy: readers,
        call: CP.translateCall({
          text, sourceLang: writeLang, targetLang: job.target,
          nativeForAnnotation: job.nativeForAnnotation, mode: job.mode,
          contextMessages, senderPronouns: sender.pronouns, recipientPronouns,
        }),
        cal: calFor(job.mode), seconds: 2.2, mode: job.mode,
      });
    }
  }

  // MSG-PIPE-26 collapses the per-key Cloud Run invocations too, which is the
  // half of the saving that lands on infra rather than on tokens.
  addOps('chat', FS.messageOps({
    // Real membership: a message nobody translated is still written, delivered
    // and read, so the Firestore side of it does not go away with the cap.
    memberCount: members.length,
    translateJobCount: jobs.length >= MULTI_TARGET_MIN ? 1 : jobs.length,
    coalesce,
  }));
  return { text, writeLang, jobCount: jobs.length };
}

// ── practice ───────────────────────────────────────────────────────────

const ALLOWED_TYPES = ['multiple-choice', 'practice-to-native', 'native-to-practice', 'fill-the-blank',
  'find-the-mistake', 'listen-and-pick', 'listen-and-fill', 'listen-and-write', 'vocab-matching'];

/** A 10-slot session: one vocab-matching slot (no LLM call) plus a spread
 *  across the generator types, weighted the way the planner's type guide
 *  pushes it — MC family heaviest, one of each listen type. */
function planSlots() {
  return ['multiple-choice', 'multiple-choice', 'practice-to-native', 'native-to-practice',
    'fill-the-blank', 'find-the-mistake', 'listen-and-pick', 'listen-and-fill',
    'listen-and-write', 'vocab-matching'];
}

const DECK = [
  { id: 'c1', phrase: 'le petit déjeuner', translation: 'breakfast', topic: 'food-drink' },
  { id: 'c2', phrase: 'la gare', translation: 'the station', topic: 'travel' },
  { id: 'c3', phrase: 'une réunion', translation: 'a meeting', topic: 'work' },
  { id: 'c4', phrase: 'faire la queue', translation: 'to queue up', topic: 'daily-life' },
  { id: 'c5', phrase: 'ma belle-sœur', translation: 'my sister-in-law', topic: 'family' },
];

async function simulatePracticeSession({ day, user }) {
  const practice = user.practice;
  const native = user.native;
  const manifest = {
    totalCards: between(30, 70), language: practice, overallAccuracy: 0.72, dueCount: between(5, 20),
    perTopic: [
      { name: 'food-drink', count: 12, accuracy: 0.66, dueCount: 5, lastPracticedDaysAgo: 3 },
      { name: 'travel', count: 10, accuracy: 0.81, dueCount: 2, lastPracticedDaysAgo: 6 },
      { name: 'work', count: 9, accuracy: 0.58, dueCount: 4, lastPracticedDaysAgo: 9 },
      { name: 'daily-life', count: 9, accuracy: 0.77, dueCount: 2, lastPracticedDaysAgo: 1 },
      { name: 'family', count: 8, accuracy: 0.9, dueCount: 1, lastPracticedDaysAgo: 12 },
    ],
    topicFilter: [],
  };

  await bill({
    day, userId: user.id, tier: 'practice',
    call: CP.cardSelectorCall({ manifest, recentTopics: ['travel'], intent: '', practice, native }),
    cal: C.cardSelector, seconds: 2.0,
  });

  await bill({
    day, userId: user.id, tier: 'practice',
    call: CP.plannerCall({
      practice, native, difficulty: 4,
      cards: Array.from({ length: 20 }, (_, i) => ({ ...DECK[i % 5], id: `c${i + 1}` })),
      count: 10, cardCount: 6, genCount: 4, allowedTypes: ALLOWED_TYPES,
      recentCardIds: ['c3', 'c7'], recentTopics: ['travel'],
      strugglingTopics: [{ topic: 'work', accuracy: 0.58, total: 12 }],
      strugglingChallenges: [{ challenge: 'listening', accuracy: 0.42, total: 9 }],
      dueCards: ['c1', 'c4', 'c9', 'c12'], selectedTopics: ['food-drink', 'work'],
    }),
    cal: C.planner, seconds: 4.5,
  });

  const slots = planSlots();
  for (const slotType of slots) {
    if (slotType === 'vocab-matching') continue; // PRACTICE-GEN-3: no call
    await bill({
      day, userId: user.id, tier: 'practice',
      call: CP.slotGeneratorCall({
        slotType,
        spec: { prompt: 'Test the learner on ordering breakfast in a café.', flashcard: pick(DECK) },
        practice, native, difficulty: 4,
      }),
      cal: SLOT_CAL[slotType], seconds: 3.0,
    });
    // TTS for the listen-* slots — one clip each, prefetched.
    if (slotType.startsWith('listen-')) {
      await billTts({
        day, userId: user.id, tier: 'practice',
        text: pickMessage(rng, practice in MESSAGES ? practice : native),
      });
    }
  }
  addOps('practice', FS.practiceSessionOps({ questionCount: slots.length }));
}

// ── tutor ──────────────────────────────────────────────────────────────

async function simulateTutorTurn({ day, user, historyBlock, turnIndex }) {
  const userMessage = pick(TUTOR_TURNS);
  // TUTOR-ACTION-2: the reply IS the router. Action-shaped asks bail with a
  // short sentinel and then cost a SECOND call for the action itself.
  const isActionAsk = /flashcard|quiz|how do I say|why is it/i.test(userMessage);
  await bill({
    day, userId: user.id, tier: 'tutor',
    call: CP.tutorRespondCall({
      native: user.native, practice: user.practice, gender: 'female',
      memoryBlock: turnIndex > 6 ? 'The learner struggles with past tenses and gendered adjectives.' : '',
      difficulty: 4, pronouns: user.pronouns, historyBlock, userMessage,
    }),
    cal: isActionAsk ? C.tutorBail : C.tutorChat, seconds: 2.5,
  });
  if (isActionAsk) {
    const kind = /flashcard/i.test(userMessage) ? 'flashcards' : /quiz/i.test(userMessage) ? 'practice' : 'explain';
    const cal = kind === 'flashcards' ? C.tutorActionFlashcards
      : kind === 'practice' ? C.tutorActionPractice : C.tutorActionExplain;
    await bill({
      day, userId: user.id, tier: 'tutor',
      call: CP.tutorActionCall({
        kind, native: user.native, practice: user.practice, userMessage, historyBlock,
      }),
      cal, seconds: 2.5,
    });
  }
  addOps('tutor', FS.tutorTurnOps());
  return userMessage;
}

// ── the week ───────────────────────────────────────────────────────────

/**
 * Seven days, each a different scenario. Volume, language mix, practice
 * load and feature usage all move so the week averages rather than
 * encoding one arbitrary day. `remix` days reassign practice languages;
 * chats are treated as fresh (no history backfill) per COST-SIM-2.
 */
const DAYS = [
  { name: 'Mon — normal', messages: 220, practicePerUser: [1, 1], explainRate: 0.02, readAloudRate: 0.03, tutorUsers: 2, tutorTurns: [4, 6], remix: false, coalesce: 0.35 },
  { name: 'Tue — busy + remix', messages: 340, practicePerUser: [1, 2], explainRate: 0.03, readAloudRate: 0.03, tutorUsers: 3, tutorTurns: [3, 8], remix: true, coalesce: 0.35 },
  { name: 'Wed — quiet', messages: 120, practicePerUser: [1, 1], explainRate: 0.015, readAloudRate: 0.02, tutorUsers: 1, tutorTurns: [2, 4], remix: false, coalesce: 0.35 },
  { name: 'Thu — normal + remix', messages: 240, practicePerUser: [1, 2], explainRate: 0.025, readAloudRate: 0.03, tutorUsers: 2, tutorTurns: [4, 7], remix: true, coalesce: 0.35 },
  { name: 'Fri — heavy social', messages: 420, practicePerUser: [1, 1], explainRate: 0.02, readAloudRate: 0.02, tutorUsers: 2, tutorTurns: [3, 5], remix: false, coalesce: 0.35 },
  { name: 'Sat — trip planning', messages: 300, practicePerUser: [1, 3], explainRate: 0.04, readAloudRate: 0.04, tutorUsers: 4, tutorTurns: [4, 9], remix: true, coalesce: 0.35 },
  { name: 'Sun — study day', messages: 150, practicePerUser: [2, 3], explainRate: 0.05, readAloudRate: 0.05, tutorUsers: 4, tutorTurns: [5, 10], remix: false, coalesce: 0.35 },
];

/** Alternative practice-language assignments used on `remix` days. Each
 *  keeps the European-overlap property (COST-POP-1) but shifts WHICH
 *  languages overlap, so the week samples several fan-out shapes. */
const REMIXES = [
  { james: 'Spanish', jonas: 'Italian', katrien: 'French', elena: 'Spanish' },
  { sofia: 'French', luca: 'German', ana: 'Italian', piotr: 'German' },
  { yuki: 'French', marie: 'Japanese', james: 'Italian', elena: 'French' },
];

/**
 * COST-POLICY-7 — the chats this tier may use.
 *
 * Volume is PRESERVED and redistributed to the surviving chats, which is the
 * conservative reading: it does not claim that removing group chat also removes
 * the messages. If it does — and group chat plainly drives volume — the saving
 * is larger than the table shows, because both the fan-out AND the message
 * count fall.
 */
const ELIGIBLE_CHATS = CHATS.filter((c) => {
  if (POLICY.groups === 'none') return c.kind !== 'group';
  if (POLICY.groups === 'cap4') return c.members.length <= 4;
  return true;
});

function weightedChat() {
  const pool = ELIGIBLE_CHATS.length ? ELIGIBLE_CHATS : CHATS;
  const total = pool.reduce((a, c) => a + c.weight, 0);
  let r = rng() * total;
  for (const c of pool) {
    r -= c.weight;
    if (r <= 0) return c;
  }
  return pool[0];
}

/**
 * COST-POP-3 — the day's sends, planned PER USER instead of per population.
 *
 * The DAYS table sets a daily total for everybody, which is the wrong handle
 * for a product argument: "the population sends 220 messages on Monday" hides
 * how many people that is and which surface they used, so no claim about a free
 * tier can be checked against it. A population that declares `sendRates` says
 * instead that a free user sends 25 one-to-one messages and 10 group messages a
 * day — a statement someone can agree or disagree with.
 *
 * The weekly rhythm is preserved as a MULTIPLIER rather than replaced: each
 * day's factor is its message count over the week's mean, so the quiet
 * Wednesday and heavy Friday survive and only the level moves.
 *
 * Returns null when the population has no rates, and the caller falls back to
 * the daily-total model — which is what keeps every pre-COST-POP-3 scenario
 * reproducible.
 */
const DAY_MEAN = () => DAYS.reduce((a, d) => a + d.messages, 0) / DAYS.length;
function plannedSends(day, byId) {
  const rates = POPULATION.sendRates;
  if (!rates) return null;
  const factor = day.messages / DAY_MEAN();
  const sends = [];
  for (const u of Object.values(byId)) {
    const r = rates[u.tier] ?? rates.free;
    for (const [kind, perDay] of [['dm', r.dm], ['group', r.group]]) {
      // Chats of this kind the user is IN and the tier may use. A free user
      // with one group sends all of their group traffic into it; a pro user
      // with two splits at random between them.
      const mine = ELIGIBLE_CHATS.filter((c) => c.kind === kind && c.members.includes(u.id));
      if (!mine.length) continue;
      const n = Math.round(perDay * factor);
      for (let i = 0; i < n; i += 1) sends.push({ sender: u.id, chat: pick(mine) });
    }
  }
  // Interleave, so a chat's messages are not delivered as one contiguous block
  // — coalescing (MSG-PIPE Firestore batching) is sensitive to that ordering.
  for (let i = sends.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [sends[i], sends[j]] = [sends[j], sends[i]];
  }
  return sends;
}

/**
 * COST-POLICY-8 — a real per-user ALLOWANCE, not a volume scalar.
 *
 * The first version of this scaled everybody's message count down by
 * cap/767, which quietly assumed the cap changes how much people SEND. It does
 * not. People send what they send; a cap changes what the SERVER does once they
 * pass it. Worse, a volume scalar cannot express the question that actually
 * decides the design — does the counter count messages you SEND or messages
 * you RECEIVE? — because it collapses both into one number.
 *
 * That question is the whole game, measured:
 *
 *   a user SENDS      767 / month   and drives 32% of chat cost (the analysis
 *                                   call, one per message written)
 *   a user RECEIVES 2,356 / month   and drives 68% (their block of the convert
 *                                   fan-out, one per message read)
 *
 * So a send-only counter governs a third of the bill while showing the user a
 * number 3.1x smaller than their real footprint. A counter that counts both is
 * the one that tracks cost.
 *
 * `capAction` decides what happens at the line:
 *   'degrade' — they keep chatting, untranslated. Their own messages stop being
 *               analysed (no corrections, no bilingual row) and other people's
 *               arrive in the original. Nobody else is affected.
 *   'block'   — they cannot send. Strictly cheaper, because the message never
 *               exists and so nobody receives it either, and strictly harsher.
 */
const WEEK_OF_MONTH = 7 / 30;
const CAP_WEEK = POLICY.cap ? POLICY.cap * WEEK_OF_MONTH : Infinity;
const used = {};
const capped = { blockedSends: 0, degradedSends: 0, degradedReads: 0, everCapped: new Set() };

/** Does traffic in this chat count toward the allowance? */
function inCapScope(chatKind) {
  if (!POLICY.cap) return false;
  if (POLICY.capScope === 'groups') return chatKind === 'group';
  if (POLICY.capScope === 'dm') return chatKind !== 'group';
  return true;
}

/**
 * Is this user out of allowance FOR THIS KIND OF EVENT?
 *
 * The gate must match the counter. An earlier cut incremented on sends only but
 * gated both, so a "250 sent" policy quietly stopped the user RECEIVING
 * translations too — which made send-caps look roughly twice as effective as
 * they are, and described a product nobody would ship ("you sent 250 messages,
 * so your friends' messages now arrive in Polish").
 *
 * Counting and gating are the same decision: you spend the allowance on the
 * thing it is denominated in.
 */
function overCap(userId, kind) {
  if (!POLICY.cap) return false;
  const gates = POLICY.capCounts === kind || POLICY.capCounts === 'both';
  if (!gates) return false;
  return (used[userId] ?? 0) >= CAP_WEEK;
}

/** Charge one unit against a user's allowance, if this kind of event counts. */
function chargeCap(userId, kind, chatKind) {
  if (!inCapScope(chatKind)) return;
  const counts = POLICY.capCounts === kind || POLICY.capCounts === 'both';
  if (!counts) return;
  used[userId] = (used[userId] ?? 0) + 1;
  if (used[userId] >= CAP_WEEK) capped.everCapped.add(userId);
}

/**
 * COST-TIER-8 — practice, the tutor, explain, read-aloud and the card tools are
 * PREMIUM surfaces. A free user has the chat and nothing else.
 *
 * This was modelled wrong: the simulation gave every user a daily practice
 * session and put some of them on the tutor regardless of tier, so the
 * anchor-and-friends tables charged a subscription for six people's practice
 * sessions that those people would never have had. In a 1-pro + 6-free group
 * that mis-attribution was 79% of the bill — it made every chat-side lever look
 * feeble, because each one was dividing the 19% that was actually chat.
 *
 * `scenarios.mjs` was never wrong about this: its free-tier figure has always
 * filtered to `tier === 'chat'`. The error was in the network-level scripts,
 * which summed the whole ledger.
 *
 * A population with no `tier` on its users (the legacy fixture) is unaffected —
 * everyone counts as premium there, which is what reproduces its numbers.
 */
const isPremium = (u) => (u.tier ?? 'pro') === 'pro';

async function run() {
  await CP.loadClientModules();
  let remixIndex = 0;

  for (const day of DAYS) {
    const users = USERS.map((u) => ({ ...u }));
    if (day.remix) {
      const remix = REMIXES[remixIndex % REMIXES.length];
      remixIndex += 1;
      for (const u of users) if (remix[u.id]) u.practice = remix[u.id];
    }
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));

    // chat traffic. COST-POP-3: a population with per-user send rates plans the
    // day explicitly (who sends, where); otherwise the legacy daily-total model
    // picks a chat by weight and a sender from its members.
    const planned = plannedSends(day, byId);
    const dayMessages = planned ? planned.length : day.messages;
    for (let i = 0; i < dayMessages; i += 1) {
      const chat = planned ? CHATS.find((c) => c.id === planned[i].chat.id) : weightedChat();
      const members = chat.members.map((id) => byId[id]);
      const sender = planned ? byId[planned[i].sender] : pickSender(members);
      // Two prior messages as context — buildContext clips them.
      const ctx = [
        { sender: pick(members).name, text: pickMessage(rng, sender.native) },
        { sender: pick(members).name, text: pickMessage(rng, sender.native) },
      ];
      const res = await simulateMessage({
        day: day.name, chat, sender, members,
        // COST-POLICY-6 — the prior-messages block. Cheap to drop and it costs
        // the model the thread's referents, so pronouns and follow-ons ("yes,
        // that one") lose their antecedent.
        contextMessages: POLICY.context ? ctx : [],
        coalesce: day.coalesce,
      });
      const tc = traffic.byChat[chat.id] ?? (traffic.byChat[chat.id] = {
        kind: chat.kind, size: chat.members.length, messages: 0, blocked: 0, jobs: 0,
      });
      // A blocked send is an ATTEMPT, not a message — it was never delivered and
      // never billed, so counting it in `messages` deflated every downstream
      // per-message figure (cost/send, jobs/message) for the policies that block.
      // Recorded separately so demand is still visible.
      if (res.blocked) tc.blocked += 1;
      else {
        tc.messages += 1;
        traffic.bySender[sender.id] = (traffic.bySender[sender.id] ?? 0) + 1;
      }
      tc.jobs += res.jobCount;

      // Read-aloud in chat (TTS-ENGINE-2: flash-primary). Charged to the
      // LISTENER, not the sender — it is a per-reader action.
      if (rng() < day.readAloudRate && members.some(isPremium)) {
        const listener = pick(members.filter(isPremium));
        await billTts({
          day: day.name, userId: listener.id, tier: 'read_aloud',
          text: res.text, model: 'gemini-2.5-flash-tts',
        });
      }

      // Explain: occasional, on a message the reader did not write.
      const explainable = members.filter((m) => m.id !== sender.id && isPremium(m));
      if (rng() < day.explainRate && explainable.length) {
        const reader = pick(explainable);
        await bill({
          day: day.name, userId: reader.id, tier: 'explain',
          call: CP.explainCall({
            messageText: res.text, translatedText: pickMessage(rng, reader.practice in MESSAGES ? reader.practice : reader.native),
            practice: reader.practice in MESSAGES ? reader.practice : 'French', native: reader.native,
            difficulty: 4, contextMessages: ctx, senderName: sender.name, senderPronouns: sender.pronouns,
          }),
          cal: C.explain, seconds: 4.0,
        });
        // Very occasional follow-up on an already-open explanation.
        if (rng() < 0.25) {
          await bill({
            day: day.name, userId: reader.id, tier: 'explain',
            call: CP.explainFollowUpCall({
              question: pick(EXPLAIN_FOLLOWUPS),
              previousXml: '<explanation><section><title>Tense</title><body>The passé composé is used here for a completed action.</body></section></explanation>',
              translatedText: res.text,
              practice: reader.practice in MESSAGES ? reader.practice : 'French',
              native: reader.native, difficulty: 4,
            }),
            cal: C.explainFollowUp, seconds: 3.0,
          });
        }
      }
    }

    // chat opens (each user opens a few chats a day)
    for (const u of users) {
      const opens = between(3, 9);
      for (let i = 0; i < opens; i += 1) addOps('chat', FS.chatOpenOps({ windowSize: 30 }));
      void u;
    }

    // practice — every PREMIUM user does at least one session a day
    for (const u of users.filter(isPremium)) {
      const n = between(day.practicePerUser[0], day.practicePerUser[1]);
      for (let s = 0; s < n; s += 1) await simulatePracticeSession({ day: day.name, user: u });
    }

    // tutor — a subset of users hold a conversation
    const tutorUsers = [...users.filter(isPremium)].sort(() => rng() - 0.5).slice(0, day.tutorUsers);
    for (const u of tutorUsers) {
      const turns = between(day.tutorTurns[0], day.tutorTurns[1]);
      const history = [];
      for (let t = 0; t < turns; t += 1) {
        const msg = await simulateTutorTurn({
          day: day.name, user: u, historyBlock: history.join('\n'), turnIndex: t,
        });
        history.push(`User: ${msg}`, 'Tutor: a short helpful answer, roughly two sentences long.');
        if (history.length > 16) history.splice(0, 2);
      }
      // TUTOR-CTX-* compaction fires once a conversation is long enough.
      if (turns >= 6) {
        await bill({
          day: day.name, userId: u.id, tier: 'tutor',
          call: CP.tutorCompactCall({
            native: u.native, practice: u.practice, messagesToFold: history, existingMemories: [], existingSummary: '',
          }),
          cal: C.tutorCompact, seconds: 3.0,
        });
      }
    }

    // cards saved from chat taps → topic classification on new topics,
    // plus the manual card-editor phrase translation (CARDS-LIST-8).
    for (const u of users.filter(isPremium)) {
      const saves = between(0, 4);
      for (let s = 0; s < saves; s += 1) {
        addOps('chat', FS.cardSaveOps());
        if (rng() < 0.3) {
          await bill({
            day: day.name, userId: u.id, tier: 'chat',
            call: CP.topicClassifyCall({
              phrase: 'le petit déjeuner', translation: 'breakfast',
              existingTopics: ['travel', 'work', 'family', 'food-drink'],
            }),
            cal: C.topicClassify, seconds: 1.5,
          });
        }
        if (rng() < 0.2) {
          await bill({
            day: day.name, userId: u.id, tier: 'chat',
            call: CP.cardTranslateCall({
              text: 'faire la queue', fromLanguage: u.practice, toLanguage: u.native,
            }),
            cal: C.cardTranslate, seconds: 1.2,
          });
        }
      }
      // Chat-import extraction: a deliberate, occasional action (a user
      // mines a chat for candidate cards), not something that fires on
      // its own. Rare by construction.
      if (rng() < 0.06) {
        await bill({
          day: day.name, userId: u.id, tier: 'practice',
          call: CP.chatImportCall({
            messages: (MESSAGES[u.practice] ?? MESSAGES.French).map((t, i) => ({ messageId: `m${i}`, text: t })),
            existingPhrases: ['la gare', 'le petit déjeuner'],
            practice: u.practice in MESSAGES ? u.practice : 'French', native: u.native,
          }),
          cal: C.chatImport, seconds: 4.0,
        });
      }
    }

    const dayRows = ledger.filter((l) => l.day === day.name);
    const dayUsd = dayRows.reduce((a, r) => a + r.usd, 0);
    console.log(`${day.name.padEnd(24)} calls=${String(dayRows.length).padStart(5)}  $${dayUsd.toFixed(4)}`);
  }

  flushCache();
  const out = process.env.LEDGER_OUT ?? join(HERE, 'ledger.json');
  writeFileSync(out, JSON.stringify({
    generatedAt: new Date().toISOString(),
    days: DAYS.map((d) => d.name),
    policy: POLICY,
    perUserByKind, traffic2, examples,
    capped: {
      blockedSends: capped.blockedSends,
      degradedSends: capped.degradedSends,
      degradedReads: capped.degradedReads,
      usersEverCapped: capped.everCapped.size,
      used: { ...used },
    },
    ledger, ops, compute, errors, traffic,
    perUser,
    tokenizer: tokenizerStats(),
  }));
  console.log(`\n${out} written — ${ledger.length} calls, tokenizer ${JSON.stringify(tokenizerStats())}`);
}

await run();
