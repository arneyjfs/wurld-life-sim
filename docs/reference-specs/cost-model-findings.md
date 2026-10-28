# Cost-model findings — errors and inconsistencies log

Everything the costing audit turned up, with current status. Companion to
[cost-model.md](./cost-model.md).

**Re-triaged 2026-08-11 after merging `dev`** (400 commits). The dev branch
independently fixed three of these — the model tiering, the thinking-token
waste, and thinking-token *accounting* — and it moved the numbers a long way:
total simulated spend fell from $16.51/week to **$9.03/week** on identical
traffic. Findings below carry their post-merge status, not their original one.

| ID | Finding | Status |
|---|---|---|
| F1 | Cached input priced at 25%; real rate is 10% | **FIXED** here |
| F2 | TTS records zero output tokens | **FIXED** here |
| F3 | Practice generators burn unconfigured thinking tokens | **RESOLVED by dev** |
| F4 | Translate SIs are 92% of input and 0% cached | **OPEN** — biggest remaining saving |
| F5 | Streamed Explain calls book as `unknown` | **FIXED** here |
| F6 | Dashboard prices every model at flash-lite rates | **FIXED** here |
| F7 | Analysis SI documented as ~4.6K; actually 6,553 | **FIXED** here (docs) |
| F8 | Explicit caches carry an unmodelled hourly charge | **FIXED** here (docs) |
| F9 | `getDynamicThinking` ≡ `getMinimalThinking` on Gemini 3 | **MOSTLY RESOLVED by dev** |
| F10 | `gemini-3-flash-preview` price unverified | **RESOLVED by dev** |

---

## F1 — Cached input priced at 25%; the real rate is 10% — **FIXED**

**Was**: `OBS-SEND-6` and `UsageStatsTab.tsx` (`CACHED_RATE = 0.25`) both
claimed cached input bills at 25% of the fresh rate. Every model this app
sends bills it at **10%** (gemini-3.1-flash-lite $0.25 in / $0.025 cached).
`src/lib/life/geminiPricing.ts` already had it right, so the repo carried two
contradictory rates — and the wrong one was applied to `message_analysis`, the
most-cached category in the app, making the MSG-PIPE-15 context cache look 2.5x
less effective than it is.

**Fix**: `UsageStatsTab` now imports `estimateCallCost` from `geminiPricing.ts`
instead of re-declaring rates. The rate lives in ONE place. OBS-SEND-6 restated
with the verification date and the `rawIn − 0.9·cached` formula.

**Guard**: `UsageStatsTab.test.tsx` — "cached input bills at 10% of the fresh
rate, not 25%" asserts $0.025 and explicitly asserts the old $0.0625 is absent.

---

## F2 — TTS recorded zero output tokens — **FIXED**

**Was**: `recordTokenUsage(uid, "tts_synthesis", ceil(text.length/4), 0, …)`.
Gemini-TTS bills text input **plus audio output at 25 tokens/second**, and
audio output is essentially the whole bill. Recording `0` reported TTS at
roughly **0.3% of its real cost — a ~270x under-report**, the only category
whose dashboard figure was not merely imprecise but meaningless.

**Fix**: `ttsSynth.ts` gains `mp3DurationSeconds` (parses the first CBR frame
header of the returned audio) and `ttsAudioTokens` (duration → tokens at 25/s,
falling back to a words-per-second estimate over the spoken text when the audio
cannot be parsed). The count is derived from **the audio we were returned**,
not from input text length, so it stays honest when the model speaks faster or
slower than the text suggests. It can never return 0.

**Guard**: five cases in `ttsSynth.test.ts`, including "never returns 0, which
is what under-reported TTS ~270x".

---

## F3 — Practice generators burned unconfigured thinking tokens — **RESOLVED by dev**

**Was**: the MC-family generators sent no thinking config, so the model applied
its default. Measured live on `gemini-3-flash-preview`: 920 / 1,025 / **7,605**
thinking tokens across three samples of one slot type, against ~150 tokens of
visible output. 571,305 tokens per simulated week — **10.4% of all spend** —
billed at the preview tier's output rate.

**What dev did**: retired the preview tier (`PRACTICE_GEN_PRIMARY_MODEL` is now
`gemini-3.1-flash-lite`), citing its own measurement — *"the preview tier burns
thinking tokens for no measurable gain (1253 billed output tokens on mc vs 155
on lite)"*. Independently the same conclusion.

**Re-measured after the merge**: **0 thinking tokens** across all 49 calibration
calls. Confirmed, not assumed.

**Residual**: the *mechanism* is still there — no generator passes
`thinkingLevel`, and `geminiGenerate` still resolves an absent knob to
`undefined` rather than defaulting it. Today's model doesn't think at that
default, so it costs nothing; a future model change could silently reintroduce
the waste. Worth a one-line server-side default, but there is no money on the
table right now, so it is not urgent.

**Also fixed by dev**: `tokenAccounting.ts` (OBS-USAGE-2) now folds
`thoughtsTokenCount` into recorded output everywhere. Even when thinking does
happen, it is no longer invisible. That was the accounting half of this finding.

**Not reproduced**: one A/B draw with `thinkingLevel:'minimal'` on
`fill-the-blank` returned a 65,522-token runaway. Four subsequent samples
returned 154–287. Recorded as an observed-once anomaly, not a real failure mode.

---

## F4 — Translate SIs are 92% of pipeline input and 0% cached — **ADDRESSED (MSG-PIPE-25)**

> **Status, 2026-09-30:** implemented as recommended below. Both convert SIs
> take only a mode and are served from one explicit cache per mode
> (`getCachedConvertModel`, `functions/src/gemini/explicitCache.ts`); the
> language mapping is in the user prompt. See `message-pipeline.md`
> MSG-PIPE-25 / 25.2 for the contract and its design record. The measurement below is kept as the reason, and its numbers are the
> PRE-fix week.

**The largest remaining saving in the app, and it grew relatively.** Because
dev cut translation *output* by 5–8x, input now dominates the bill completely.

Measured over the simulated week:

| category | SI tokens | prompt tokens | SI share | cached |
|---|---|---|---|---|
| `message_translation` | 15,970,537 | 1,332,115 | **92%** | **0%** |
| `message_analysis` | 11,729,870 | 788,362 | 94% | 62% |

`message_translation` is 63.6% of all LLM spend. The docstring on
`translateMessageSystemInstruction` asserts *"Gemini caches the
system-instruction prefix across every message in the chat"* — **measurement
says otherwise: cached is 0 on every translate call.** The prefix is not shared,
because the language names appear from line 7 onward.

### Why the obvious fix is wrong

A cache per language triple does **not** work. The SI embeds source, target AND
native-for-annotation, so it is not byte-identical across chats:

- 10 languages → **1,200 distinct SIs** (100 translate-only, 1,000
  translate-and-annotate, 100 annotate-only)
- explicit caches bill **$1.00 per 1M cached tokens per hour**
- 1,200 caches × ~2,275 tokens ⇒ **$1,966/month** in standing storage, to save
  ~$15/month at this scale

That is a 130x own-goal, and it gets worse with more languages (the app ships
80 locales). Anyone implementing "just cache the translate SIs" without this
measurement would make costs dramatically worse.

### The fix that does work

The MSG-PIPE-15 playbook, already proven on the analysis SI: replace concrete
language names with `SOURCE` / `TARGET` / `NATIVE` placeholders and inject the
mapping at the top of the **user prompt**. **81.5% of the SI is already
invariant** — only 15 of 81 lines carry a language name. That collapses 1,200
caches to **one per mode (3)**:

| | value |
|---|---|
| translate SI tokens/week (10 users) | 15,970,537 |
| saving at the 10% cached rate | **$15.40/month** |
| standing storage, 3 caches (734 + 1,983 + 2,228 tokens) | $3.56/month (fixed) |
| net at 10 users | **+$11.84/month** |
| break-even | **3 users** |
| at 1,000 users | saves ~$1,540/month against the same $3.56 |

The keyed cache machinery already exists — dev generalised
`getOrCreateExplicitCache(cacheKey, docPath, si, model)` for the tutor, so
wiring a third caller is small.

### Why it was not done in this pass (historical)

**It is a prompt change to the most quality-sensitive path in the app**, and
the file's own docstring is an explicit warning against casual edits:

> ⚠ These checklists are deliberately SHORT. The analysis prompt was measured
> onto a stability cliff — three separate attempts to strengthen one rule each
> **tripled its error count**, and the new errors landed in buckets the edit
> never mentioned. Adding a line here is a measurable act.

MSG-PIPE-15 records that the same abstraction on the analysis SI *"has a
quality cost on lite models"*, recovered only by a strengthened, emphatic
mapping and verified against the eval. The same risk applies here across three
modes, and MSG-KEY-4 (verbatim annotate-only), MSG-KEY-5 (echo guard) and
MSG-PIPE-16 (prompt-injection fence) all depend on this SI's exact wording.

**Recommended plan** (needs a go-ahead — it spends real money on evals):

1. Baseline `npm run test:prompts -- --suite=convert-translate`,
   `--suite=annotate-only`, `--suite=batch-translate`. Record error counts.
2. Placeholder the 15 language-carrying lines per mode; add the emphatic
   mapping block to the user prompt, modelled on `buildUserMessageAnalysisPrompt`.
3. Re-run all three suites. **Ship only on equal-or-better error counts** —
   this is the gate, not a formality.
4. Route the three mode SIs through `getOrCreateExplicitCache`.
5. Re-run `scripts/cost-sim` and confirm cached% climbs off 0.

---

## F5 — Streamed Explain calls booked as `unknown` — **FIXED**

**Was**: `GeminiStreamRequest` had no `category` field, so `streamGemini` never
sent one, and `geminiStreamV2` defaulted it to `"unknown"`. The entire
ExplainModal surface — main stream and every follow-up — was mislabelled, while
its non-streaming sibling reported correctly, which made it look like a gap in
Explain usage rather than a bug.

**Fix**: `category` added to `GeminiStreamRequest`; `ExplainModal` sends
`explain` / `explain_practice` / `explain_followup`. The server now also passes
`model: streamModelUsed` to `recordTokenUsage`, tracked across the one-shot
fallback swap so a stream that degraded to `MODELS.fallback` is priced at that
tier rather than the default.

---

## F6 — Dashboard priced every model at flash-lite rates — **FIXED**

**Was**: `PRICE_PER_M_IN = 0.25 / PRICE_PER_M_OUT = 1.5` applied to all usage.
Models on other tiers were under-reported — `gemini-3.5-flash` ($1.50/$9.00) by
**6x on output**.

**Fix**: `estimateCategoryCost` prices each category from its `categoriesByModel`
breakdown via `rateFor()`, and adds back any remainder recorded without a model
so a per-category total never silently falls below the sum of its parts.
Per-user rows still price at the default tier — there is no per-model split per
user — and now say so in a comment; they rank users by spend, they do not
reconcile.

**Impact note**: this matters less for the surfaces in the costing scope than
it did before the merge, because everything in scope now runs on flash-lite,
which is what the constants encoded. It still matters for life-sim, which uses
`gemini-3.5-flash-lite` and `gemini-3.5-flash`.

---

## F7 — Analysis SI documented as ~4.6K tokens — **FIXED (docs)**

Measured **6,553 tokens** (`countTokens`, 2026-08-11) — 42% larger than
MSG-PIPE-15 claimed. `send-observability.md` separately carried "~4.1K in/call",
older still and now smaller than the SI alone, which is impossible. Both
restated with dates; the stale figure is retired rather than left to mislead,
and both now point at `docs/reports/cost-sim/REPORT.txt` for current numbers.

---

## F8 — Explicit caches carry an unmodelled hourly charge — **FIXED (docs)**

Gemini bills explicit caches **$1.00 per 1M cached tokens per hour** on top of
the discounted read rate. The analysis cache holds 6,553 tokens continuously:
**$4.72/month**, a fixed cost that exists at zero users and appears in no
per-user model. Now documented in MSG-PIPE-15, and it is the load-bearing
number in F4's design — it is precisely why per-language-pair caching loses.

---

## F9 — `getDynamicThinking` ≡ `getMinimalThinking` on Gemini 3 — **MOSTLY RESOLVED by dev**

Both return `{ thinkingLevel: "minimal" }` for any `gemini-3*` model; they
differ only on 2.x. Dev converted the tutor and every fallback construction to
`getMinimalThinking` explicitly, with a comment naming the hazard: a 2.x
fallback would otherwise be asked for an UNBOUNDED budget (`-1`) on the one path
that only runs when the primary is already degraded.

**Residual**: one caller remains on `getDynamicThinking`
(`geminiGenerate`'s tutor-translate path, `functions/src/index.ts`). Harmless
while it points at a Gemini 3 model; it would diverge on a fallback. Cosmetic —
either collapse the two functions or document that they converge.

---

## F10 — `gemini-3-flash-preview` price unverified — **RESOLVED by dev**

The preview tier was retired on 2026-07-25 in favour of `gemini-3.1-flash-lite`,
on measured evidence: equal-or-better quality at ~6x lower cost across four
prompt suites. Nothing in scope routes to an unpriced model any more —
confirmed by the post-merge calibration, where all 49 calls ran on
`gemini-3.1-flash-lite` with zero fallbacks.

---

## Lever analysis — what to do AFTER the translate-SI cache

Measured 2026-08-11 with live calls, once the cache in F4 was agreed. Recorded
here because the obvious follow-ups are worth far less than they look, and the
one that is worth most is not on anyone's list.

All figures are the measured week ($9.03 baseline, 1,790 messages, 6.2 translate
jobs/message).

| scenario | week total | cut |
|---|---|---|
| baseline | $9.03 | — |
| drop `<reflect>` only | $7.70 | 15% |
| **cache translate SIs only (F4)** | **$5.44** | **40%** |
| merge fan-out only | $5.92 | 34% |
| merge + cache | $5.02 | 44% |
| merge + cache + drop `<reflect>` | $4.98 | 45% |

### Removing `<reflect>` — not worth it

On the happy path the emitted block is literally `<reflect>ok</reflect>` =
**8 tokens**, 5.3% of output. The bulk is in the SI: the R1–R6 checklist (269
tokens) plus the self-heal policy that exists to support it (166), together
**19.4% of the SI**.

That reads as a 15% cut *only because the SI is uncached today*. Once F4 lands,
removing it is worth **one percentage point** — the cache has already made those
tokens nearly free. Against that: `<reflect>` is the mechanism MSG-KEY-4's
verbatim guarantee and MSG-KEY-5's echo guard rely on, in a file whose docstring
records three previous rule edits each **tripling** its error count. Do not trade
a measured quality mechanism for ~$0.01/user/month.

### Merging the per-language fan-out into one call

A live multi-target prompt on a 17-job message: input 26,690 → **2,633**
(−90%), output 1,366 → 1,447 (+6%), cost $0.0087 → **$0.0028** (−68%), and it
emitted 17/17 target blocks correctly across three runs. So the mechanism works.

But merge and cache are **substitutes, not complements** — both attack "paying
for the SI N times". Naively summed they save $6.71; together they actually save
$4.02, so **$2.69 is overlap**. On top of the cache, merging is worth 4 points.

**The real prize is infra**, which the cache does nothing for:

| | now | merged |
|---|---|---|
| Cloud Run invocations/month | 62,816 | 23,091 |
| Firestore writes per message | 31 | 10 |
| infra $/month (10 users) | $4.43 | $2.97 |

All-in on top of the cache: ~$0.34/user/month.

⚠️ **Merging contradicts MSG-PIPE-5** — *"One failed translation never blocks
the others or the finalize stage."* A merged call is all-or-nothing. It also
breaks per-key re-roll (MSG-KEY-4/5 re-roll ONE key, not all 17), the per-job
single-flight machinery (MSG-PIPE-12), and it serialises latency so the last
reader waits for every target rather than their own. **A hybrid keeps most of
the win**: batch 4–5 targets per call, and retry a failed batch rather than a
failed key. That is a spec change either way — MSG-PIPE-5 has to be amended
before this ships, not after.

### The biggest remaining lever: the fan-out COUNT

Both of the above change how translations are *packaged*. Neither changes how
many are *produced*. Every member key is translated on every message whether
anyone reads it or not. Translating lazily — on read, or only for
recently-active members — is close to linear (with the F4 cache applied):

| share of members translated for | jobs/msg | free user, chat $/mo |
|---|---|---|
| 100% (today) | 6.2 | $1.72 |
| 60% | 3.7 | $1.35 |
| 40% | 2.5 | **$1.16** |
| 25% | 1.5 | $1.02 |

100% → 40% saves **$0.56/user/month** — more than merge and `<reflect>`
combined, and the only lever that scales with group size, which is where the
cost actually lives. Costs: a shimmer on first open for a cold reader
(MSG-STATE-8 already defines that window), and care around notifications — a
push preview cannot carry a translation that has not been generated yet.

**Recommended order: F4 cache → lazy fan-out → batched merge → never touch
`<reflect>`.**
