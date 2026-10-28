# Cost model — spec

What a Wurld user costs to serve, measured rather than estimated, and the
harness that produces the number.

Invariant-id prefix: `COST-`. Harness: [`scripts/cost-sim/`](../../scripts/cost-sim/).
Excludes life-sim / Wurlds by construction (`COST-SIM-3`).

Status: **full** — the harness runs end to end and its output backs the
pricing decision. The rate card needs re-verifying whenever Google moves
prices (`COST-RATE-1`).

---

## 1. Why this exists

Two cost models already lived in the repo and disagreed with each other,
and neither matched the vendor's published rates. Both under- or
over-reported different categories, and one whole category (TTS) was
recorded at roughly 0.3% of its true cost. A pricing decision taken on
either would have been wrong. This spec fixes one measured model and one
place to change it.

Those defects are now fixed (F1/F2/F5/F6 in
[cost-model-findings.md](./cost-model-findings.md)) — the dashboard and this
model read from the same rate table. The harness remains the authority for
what a user costs, because it measures the whole call graph rather than only
the calls that happened to be recorded.

---

## 2. Measurement invariants

| ID | Invariant |
|---|---|
| **COST-TOK-1** | Input token counts are MEASURED via Gemini `countTokens`, never derived from a chars/token ratio. Token density varies ~3x across the scripts the app carries (Latin ~4 chars/tok, Japanese ~1.4), and the message body appears in every one of the N translate prompts for a chat — a ratio would systematically misprice exactly the multi-language dimension under test. `countTokens` is free and non-generative, so it has no billing or OBS-SEND-5 reconciliation impact. |
| **COST-CAL-1** | Output token counts are MEASURED by firing each call type against real Gemini with the exact prompt, model, `generationConfig` and thinking config production uses. Output bills 6x input on flash-lite; an analytic guess that is 2x out moves the whole answer. |
| **COST-CAL-2** | Every calibration row records `thoughtsTokenCount` separately. Thinking tokens bill at the output rate and are the most likely source of a silent under-report — the first run found 571k of them per simulated week on the then-current preview tier. Post-merge that is **0**, and `tokenAccounting.ts` (OBS-USAGE-2) now folds thoughts into recorded output in production too. The invariant stays: a model change can reintroduce them overnight, and a harness that stopped looking would not notice. |
| **COST-CAL-3** | Calibration uses the MEDIAN of repeated samples, not the mean. Output distributions here are heavy-tailed — the retired preview tier produced a 7.6k thinking draw against a ~1k body, and one `fill-the-blank` sample returned a 65k-token runaway that four further samples did not reproduce. A mean lets a single outlier set the price of every session; outliers are reported separately instead of being averaged in. |
| **COST-CAL-4** | A call that production serves from an **explicit** context cache is priced with its WHOLE system instruction at the cached rate — never with the `cachedContentTokenCount` calibration observed. Calibration fires bare calls, so what it observes is the **implicit** prefix cache, and the two are not the same number: measured on `gemini-3.1-flash-lite` (`scripts/cost-sim/cacheprobe.mjs`, 2026-08-12), the 6,476-token analysis SI came back **62.7% implicit** on a warm repeat but **100.0%** through an explicit cache — and 100% held for a call with a different user prompt, so it is the cache working rather than a response memo. Pricing production at the implicit figure charged it for a discount it does not take, and made an optimisation ("get the analysis cache to full coverage") out of something already true. Storage is priced separately (`cacheStorageMonthly`); this invariant governs only the per-call half. |
| **COST-PROMPT-1** | No prompt text is written in the harness. Every string comes from the app's own builders — compiled `functions/lib/**` server-side, type-stripped `src/lib/**` client-side. A hand-copied prompt would drift silently and under-report. The one unavoidable exception (`card_translate`, whose prompt is inline in `translatePhrase.ts` with no exported builder) is mirrored and asserted by `cost-model.test.mjs`. |
| **COST-RATE-1** | Every rate is either verified against the vendor's published pricing page on `RATES_VERIFIED_ON`, or explicitly marked `verified: false` with the reason. An unverified rate is never presented as measured. |
| **COST-REP-1** | The free/premium split is derived from the ledger — every call carries the tier that produced it — so the two always sum to the measured total. A separately-estimated split would drift from the total it is meant to decompose. |

## 3. Simulation invariants

| ID | Invariant |
|---|---|
| **COST-SIM-1** | Nothing in the ledger is a round number someone typed in. Input is counted, output is calibrated. |
| **COST-SIM-2** | The week varies deliberately (volume, language mix, practice load, feature rates) and chats are reset between scenarios so a language change never triggers a history backfill. Backfill is a real cost; it is EXCLUDED by construction and reported separately rather than silently averaged in. |
| **COST-SIM-3** | Life-sim / Wurlds is out of scope. No `life_*` category is modelled. |
| **COST-POP-1** | The simulated population's practice languages OVERLAP its native set, because that overlap is what collapses the translation fan-out via MSG-PIPE-8 dedup and is the single biggest lever on per-message cost. A population of 10 disjoint pairs would be a worst case, not a realistic one. |
| **COST-POP-2** | Messages are real text in each language, never English stand-ins (see COST-TOK-1 for why). |
| **COST-FS-1** | Firestore reads scale with `members x doc-versions`, not `members`. The pipeline writes the message doc many times (skeleton → analysis → one commit per translate job → finalize) and every member holds a listener on it. That amplification, not the writes, is what makes a large group chat expensive on Firestore. |
| **COST-FS-2** | The listener coalescing factor is the largest single uncertainty in the infra model and is exposed as a parameter (`DEFAULT_COALESCE`), not buried as a constant. |
| **COST-VOL-1** | Volume sensitivity rescales infra WITH message volume, never holds it flat. Most of infra is message-driven — Cloud Run bills per invocation-second and the translate fan-out makes one message ~7 invocations, so Cloud Run is the larger half of infra, not Firestore. Holding infra flat while scaling LLM overstates a low-volume user by roughly 2x (it put a 250-message user at $1.05 when the figure is $0.74), and that error biases a pricing decision toward charging more than needed. A floor remains: chat opens, read receipts and stored history follow READING, not sending, so a lurker still costs ~$0.06/month. |

| **COST-LUNA-1** | A Luna price is the row's Gemini cost times the Luna/Gemini cost ratio MEASURED for that prompt (same sample, shipped prompts on both sides, per 1,000 calls; `scripts/cost-sim/luna.mjs`). A ratio, not an absolute $/call, so the ledger's simulated sizes carry over and only the provider changes. A call type that is not a ProviderCategory (MSG-PIPE-31.9) stays at 1. `PROVIDER=luna` on `subscriber-per-chat.mjs` applies it. |
| **COST-LUNA-3** | OpenAI Fast mode (MSG-PIPE-31.12) doubles every component of a Luna call's price (input, cached input, output: $0.20 / $0.02 / $1.00 per 1M against $0.10 / $0.01 / $0.50, OpenAI pricing page, 2026-10-26), so a category priced in Fast mode takes twice its COST-LUNA-1 factor. `LUNA_FAST=<ProviderCategory,…>` applies it (e.g. `LUNA_FAST=analysis`, the only switchable category); it is ignored without `PROVIDER=luna`. Fast mode also changes no token counts. |
| **COST-LUNA-2** | `luna-breakdown.mjs` prices one design ledger both ways, split by surface, from the `chatKind` each ledger row carries (COST-POLICY-12's bucket). |

---

## 4. Headline results

From a 7-day, 10-user run (1,790 messages, 105 practice sessions, 14,657 LLM
calls), **re-measured 2026-08-11 against `dev`**:

| Metric | Value | Before the dev merge |
|---|---|---|
| Total LLM spend | $9.03 / week | $16.51 |
| Cost per chat message, all-in | $0.0042 | $0.0072 |
| Translate/annotate calls per message | 6.2 | 6.2 |
| Chat + translation share of total cost | 84% | 78% |
| Practice share | 14% | 21% |
| Tutor + explain + read-aloud share | 2% | 1% |
| FREE user (chat + translation only) | **$3.70 / month** | $5.99 |
| PREMIUM user (everything) | **$4.37 / month** | $7.57 |
| Infra (Firestore + Cloud Run), outside free tier | $0.50 / user / month | $0.50 |
| Model "thinking" tokens | **0** | 571,305 / week |

The 45% drop came from `dev`, not from this work: translation and analysis
output tokens fell 5–8x on the rewritten prompts, and retiring the
`gemini-3-flash-preview` tier removed the thinking-token waste entirely.

**The decisive finding is unchanged, and stronger.** The free tier — chat plus
all translation features — is now **84%** of total cost, up from 78%, because
the premium surfaces got cheaper faster than chat did. Premium features are the
cheap part. An uncapped free tier still does not close at any realistic
conversion rate; at 10% conversion the premium list price would need to be
~$44/month (down from $72, still unsellable). A 100-message/month free cap
brings that to ~$10. See §6/§6b of the report.

**On GPT-6 Luna (2026-10-25, COST-LUNA-1).** In the chosen design (a subscriber in every chat, the paid language set), turning every switch on takes the society fixture from **$0.782 to $0.376 per user per month** (infra unchanged at $0.161, now 43% of the total), the break-even ticket from $1.93 to $1.09, and the household one $2.99 subscription carries from payer + 2 to payer + 9. **With the send analysis on Fast mode (2026-10-26, COST-LUNA-3, `LUNA_FAST=analysis`)** the figure is **$0.438** (infra 37%), and the biggest household that still breaks even drops to payer + 6. Write-up with the vocab-card explain added by hand ($0.444 with Fast, $1.70 margin per $2.99 subscription): "Wurld costs per user on Luna" (https://claude.ai/artifact/XjVwp6qwo5WKzigwLxXm2M).

## 4b. Storage-backed media (outside the simulation)

The harness models LLM calls, Firestore and Cloud Run. Media bytes live in
Cloud Storage (`wurld-e27d8-chat-images`) and are costed here by hand from
measured file sizes, not simulated. Photos are small enough to ignore. Video
is not: one clip is 10–100× a photo.

**Price assumptions (Cloud Storage list prices as of 2026-09, not re-checked
against the live price page; verify before a pricing decision):** Standard
storage **$0.020–0.026 / GB-month** (regional vs US multi-region; the bucket's
location class was not checked); internet egress **$0.12 / GB** (0–1 TB
premium tier, worldwide excl. China/Australia); Class A ops $0.005 / 1k and
Class B $0.0004 / 1k (negligible here). As elsewhere in this model, free-tier
allowances are **not** applied (§5), and neither is the Firebase no-cost
download quota, which may not cover a non-default bucket anyway.

**Sizes (S0 device runs, recorded in the deleted `docs/plans/video-messages.md` §0 — git history):**
the transcode (H.264/AAC, long edge ≤ 1280) produces **≈ 20 MB per 60 s**
(iPhone: 13.6 MB for 51 s; Android: 22.2 MB for 60 s before the long-edge cap).
Server cap 40 MB per stream. The poster is a normal chat image (full ≤ 1600 px
JPEG + thumb): **≈ 0.2–0.4 MB**, the few-hundred-KB figure is an estimate, not
a measurement.

| Item | Per 60 s video message | Notes |
|---|---|---|
| Storage | ≈ 20.4 MB → **≈ $0.0004–0.0005 / month**, forever | Nothing expires. A user sending 10 clips / month adds ≈ 0.2 GB / month, so their storage line grows by ≈ $0.005 / month every month (≈ $0.06 / month after a year). Orphans (abandoned uploads, failed deletes) are swept by `scripts/cleanup-test-media.mjs`. |
| Egress, per full view | ≈ 20 MB → **≈ $0.0024** | Poster-only views (bubble, grid, gallery) cost ≈ 0.02–0.4 MB ≈ $0.00005. The viewer uses `preload="metadata"`, so an opened but unplayed video costs little more than its poster. |
| Egress, 1:1 chat (1 recipient view + 1 sender re-watch) | **≈ $0.005** | The sender's own bubble plays its local blob until the server URL swaps in. |
| Egress, group of 4 (3 recipient views) | **≈ $0.007** | Scales linearly with views — a busy group is the expensive case. |
| Transcode | **$0 server cost** | Runs on the sender's device (Mediabunny / WebCodecs, ≈ 0.5–0.6× real time). The server only mints a signed upload URL and reads object metadata in `finalizeVideoUpload` (never downloads the bytes) — two short Cloud Run invocations, in the noise next to the pipeline's ~7 per message. |
| Save / share (VID-SAVE-1) | one more full-view egress per save | Native streams straight to disk; no extra server work. |

For scale: the measured all-in LLM + infra cost of a text message is
$0.0042 (§4). **A group video viewed three times is ≈ 1.7× that, and it keeps
costing ≈ $0.0005 / month in storage after.** Negligible at the current user
count; worth a per-user monthly video allowance, or cold-storage / expiry of
old streams, before a wide rollout. Revisit if video share of messages passes
~5% or storage passes ~50 GB.

## 5. Design decisions

**Sender-attributed message cost.** The whole pipeline cost of a message
is booked to the sender, even though the fan-out is driven by the
*recipients'* language keys. Alternatives considered: split per recipient
(more "fair", but no per-user total changes since everyone both sends and
receives), or book to the chat (loses the per-user view the pricing
question needs). Sender attribution is exact in aggregate and simplest;
the group-size effect is surfaced separately in §3 of the report rather
than hidden by the choice. Revisit if per-seat B2B pricing is ever
considered, where attribution stops averaging out.

**Median over mean for calibration.** See COST-CAL-3. The trade is that a
genuinely heavy-tailed cost looks cheaper than its expectation; the
sensitivity band exists to carry that.

**Cached rate at 10%, not 25%.** `OBS-SEND-6` and `UsageStatsTab` both said
25%. The published rate for every model this app uses is 10% (e.g.
gemini-3.1-flash-lite: $0.25 input, $0.025 cached), which
`src/lib/life/geminiPricing.ts` already had right. Both wrong copies are now
fixed and `UsageStatsTab` imports the shared table rather than re-declaring
rates, so there is one place to change when Google moves prices (F1).

**Free-tier allowances deliberately NOT applied.** A costing exercise for a
growing app wants the marginal user's cost: the free tier is consumed by
the users who came before. `applyFreeTier` exists for the small-scale
case but defaults off.

**Backfill excluded.** A language change triggers `MSG-BACKFILL-6`, which
re-translates the loaded history window — potentially dozens of messages x
the full key fan-out, in one burst. It is excluded here because the
simulation resets chats between language remixes (COST-SIM-2). It is a
real and potentially large cost for a user who changes their practice
language on a busy chat, and needs its own measurement before any
"change your language freely" messaging ships.

---

## 6. Re-running

```bash
npm --prefix functions run build                                  # prompts → lib/
node --experimental-strip-types scripts/cost-sim/calibrate.mjs    # live, costs ~$0.15
node --experimental-strip-types scripts/cost-sim/simulate.mjs     # free after first run
node --experimental-strip-types scripts/cost-sim/report.mjs
```

`calibrate.mjs` needs a Gemini key and should use `GEMINI_API_KEY_DEV`
per OBS-SEND-5. `simulate.mjs` needs no key once `tokenizer.mjs`'s disk
cache is warm. Re-calibrate when a prompt, a model or a thinking config
changes — the report's numbers are only as current as `calibration.json`.
