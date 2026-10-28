# Marketing content (source material for the port)

This is the marketing page + interactive demo extracted from the **legacy** repo so you can port it without re-reading `~/src/wurld`. **Content is canonical here; styling there is dead** — rebuild visuals against [design-system.md](design-system.md).

> Source files (legacy, read-only):
> - Landing page: `~/src/wurld/app/(auth)/index.tsx` (~1000 lines, a web-only Expo route)
> - Demo: `~/src/wurld/components/ConversationDemo/` (`ConversationDemo.tsx`, `demoScript.ts`, `DemoChatScreen.tsx`, `PhoneMockup.tsx`, `DemoBubble.tsx`)
> - Install prompt: `~/src/wurld/components/InstallPrompt.tsx`

## Page structure (top to bottom)

1. **Top bar** — "WURLD" wordmark (stylised underlined "U"), theme toggle (sun/moon), "80+ languages" button opening a language-picker modal.
2. **Hero** — headline + subheading + (implicit) scroll into the demo.
3. **Flag marquee** — infinite horizontal scroll of 80+ language flag emoji, gradient-masked edges (CSS `demoMarquee 40s linear infinite`).
4. **Language hook** — one-liner about pick-your-own-language.
5. **Demo section** — "EXAMPLE" label + the interactive `ConversationDemo`.
6. **Install section** — hook copy + App Store / Play badges (both "Coming soon") + "Install Web App" CTA.
7. **Features** — "WHY IT WORKS" + 4 feature cards.
8. **Pricing** — "PRICING" + "Free while we're growing" + Free/Pro cards.
9. **Final CTA** — "Start a conversation. Start learning." + badges + install button.
10. **Footer** — version string + links.

## Copy (verbatim)

**Hero headline:** "Learn a language without trying."
**Hero subheading:** "Just message your friends. Wurld teaches you the words and phrases you actually need — while you chat."

**Language hook:** "You pick your language. They pick theirs. AI handles the rest."

**Post-demo hook:** ~~"No textbooks. No streaks."~~ → **"No textbooks. No nagging."** "Simply immerse yourself in real conversations."

> ⚠️ **Changed (2026-08-05).** The original "No streaks" claim became **factually false**: the app shipped a global engagement streak (`~/wurld/src/lib/streak.ts`, `life.streak.title` = "{count}-day streak — keep it alive!", `practice.progress.streakLabel`). Owner's position is that the streak is not nagging and the no-nagging claim still holds, so the line now disavows **coercion** rather than the **mechanic**. Keep it that way: the site may promise you'll never be guilt-tripped, but it must not promise there are no progress mechanics. Revisit if the streak copy ever becomes genuinely pushy.

**Features — section label** "WHY IT WORKS" / **heading** "Language learning that fits your life":

| Icon (lucide) | Title | Description |
|---|---|---|
| Clock | No extra time needed | You're already messaging friends. Wurld turns that into language practice without adding to your day. |
| Sparkles | Language immersion | The best learning comes from living the language. Mistakes become lessons — so they really stick. |
| MessageCircle | Vocabulary you actually need | Still stuck on "I have two sisters"? Learn the things you actually talk about. |
| HeartPlus | Healthier phone use | No addictive algorithms. Spend time on your phone meaningfully. |

> Note: these four feature blurbs are *already* in the current `src/pages/index.astro` placeholder (the copy survived the skeleton). The new page should keep this copy.

**Pricing — section label** "PRICING" / **heading** "Free while we're growing":
- Description: "Full access is likely to be between $1 and $4 a month. We're happy to offer this at an initial $0 cost to give us time to build out a quality app."
- Banner: "All features included — no credit card required"

| Plan | Price | Features |
|---|---|---|
| **Free** | £0 /month | Unlimited messaging · Native language translation · Basic chat features |
| **Pro** (gradient card) | £0 /month | Everything in Free · Practice language mode · Smart grammar corrections · Word-by-word explanations · Voice message TTS · Priority support |

> ✅ **Decided (2026-06-21):** the site **launches free** — keep the "free while we're growing / no credit card required" copy. The payment plumbing gets built but stays dormant until billing is switched on later (see [payments-and-plans.md → Confirmed decisions](payments-and-plans.md#confirmed-decisions-2026-06-21)). The Free/Pro split above is the intended tier boundary and maps to the `plan: 'free' | 'pro'` field for when charging begins. **Currency: USD** — normalise the source's mixed `$`/`£` to dollars (so "£0" → "$0").

**Final CTA:** "Start a conversation. Start learning." / "Your next language is just a message away."

**CTAs:** primary button reads "Install Web App" / "Get started" / "Open Wurld" conditionally; secondary "or continue in browser". App Store + Google Play badges shown but marked "Coming soon" (40% opacity).

## The interactive demo (`ConversationDemo`)

A timeline-driven, auto-playing animation of two people texting across languages — the core value prop made visible. Auto-plays when ~80% in view (IntersectionObserver). Desktop shows **two phone mockups side by side**; mobile shows **one phone** with a carousel/fade between the two sides. Has Prev / Replay / Next controls; the Next button pulses when a scene completes.

**Characters / setup** (`demoScript.ts`):
- Phone 0 = Sarah's phone, chatting with **Carlos** (learning French 🇫🇷, avatar `#C71585`).
- Phone 1 = Carlos's phone, chatting with **Sarah** (learning Spanish 🇪🇸, avatar `#4682B4`).

**Six scenes:**
1. *"Sarah's learning French 🇫🇷"* — Sarah types "Hey Carlos, how's it going?", sends; a translating spinner; it becomes "Salut Carlos, comment ça va ?".
2. *"Carlos receives it — in Spanish! 🇪🇸"* — switch to Carlos's phone; same message arrives as "¡Hola Carlos, cómo te va?".
3. *"Carlos can reply in English or Spanish"* — Carlos types "Esta muy bien, gracias!" (intentional typo).
4. *"Write with confidence"* — sends; a grammar **review dock** slides up offering a correction + a more-natural alternative, each with reasoning. (`CARLOS_REVIEW`: corrected "Estoy muy bien, ¡gracias!", correction `esta → Estoy` "First person form of estar"; natural alt "Me va muy bien, ¡gracias!".)
5. *"Help is a tap away"* — tap-ripple selects the correction; message updates and delivers to Sarah; tapping the word "Estoy" reveals an inline translation ("I am (temporary state)").
6. *"Save to Flashcards"* — tap-ripple on the flashcard icon; a "Flashcard added" toast appears then dismisses.

**Animation primitives** (CSS keyframes injected at runtime in `ConversationDemo.tsx`): `demoBubbleSlideUp`, `demoSpin`, `demoBlink` (cursor), `demoPulseGlow`, `demoTapRipple`, `demoSwooshIn` (phone switch), `demoPulse` (Next button). The engine is a reducer + a timeline of timed steps (type / send / translate / tap / toast, with pauses in ms).

### Porting the demo

It's already React, so as an Astro **React island** (`client:visible`) it ports with the least rework. Two things to fix on the way over:
- **Strip React-Native-isms.** The legacy component is React Native Web — `StyleSheet`, RN primitives, theme via a `useColorScheme` context, inline RN colour tokens. Convert to plain DOM + the new design tokens. (The new app already did this conversion for its own components — `~/wurld/src/components/` is a good reference for the DOM/Tailwind idiom.)
- **Restyle to the new design system.** Old colours (`#4682B4` steel-blue, tie-dye palette) are obsolete. Phone mockups, bubbles, and the review dock should use the new tokens / gradient from [design-system.md](design-system.md). The *content* of the scenes (the messages, corrections, scene titles) stays.

If the full six-scene engine is too heavy to port early, an acceptable interim is a shorter 3–4 scene version or even a recorded screen-capture / Lottie of the app's real chat — but the side-by-side cross-language reveal (scenes 1–2) is the irreplaceable beat; keep that.

## Revision → Wurlds (added 2026-08-05)

Two sections between **Features** and **Pricing**, introducing the app's focused-study half: conventional practice, then *Wurlds* — the AI life-sim / language RPG (`~/wurld/docs/specs/life-sim.md`, `~/wurld/docs/plans/wurlds-v2/`). Live in `src/pages/index.astro` + `src/components/demo/WurldsDemo.tsx`.

### The four-beat arc — don't collapse it

The page runs **chat → vocabulary → practice → role play**, and each beat exists because the next one needs it:

| Beat | Eyebrow | Job | Band? |
|---|---|---|---|
| Chat (hero → features) | — | You learn without trying. | — |
| **Vocabulary** | `VOCABULARY` | Chatting *collects* the words — and because they come from real conversations, they're the ones you'll actually use. | plain |
| **"And when you do have a bit of extra time…"** | — | The hinge. Everything above costs no time; this is what happens when you choose to spend some. | tinted band |
| ↳ **Practice sessions** | `PRACTICE SESSIONS` | Sessions are built from *your* deck, not a stock syllabus. Question types, SRS, weak-topic tracking. | ↳ |
| ↳ **Role play** | `ROLE PLAY` | Efficient review isn't what makes you come back. Not a streak either — wanting to know what happens next. | ↳ |

**What holds it together:** the deck. Chat fills it, practice drills it, and words met in a wurld land in it too. That shared thread is what stops the page reading as separate products bolted together — if an edit breaks it, the page becomes a feature list.

> 🚨 **Accuracy constraint — read before editing the role-play half.** Practice sessions genuinely *are* built from the saved deck. **Wurlds are not** — they do not draw on your cards today (intended, but not shipped). What is true in both directions is the *other* way round: a word you meet in a wurld can be saved and lands in the same deck, via the same save-word path as chat (`MSG-VOCAB-*`).
>
> So every claim in the role-play half must point **into** the deck, never out of it. Allowed: "tap any word you don't know and it joins your deck". **Not** allowed: "built from your cards", "your cards get woven in", "practises the words you've collected" — those are false today. The band lead is worded "whatever you pick up along the way lands in the same deck" for exactly this reason: it's true of both halves and reads as cohesion without asserting the thing that isn't built yet. Revisit once flashcard weaving ships (`wurlds-v2` phase G).

**The hinge title is load-bearing.** The hero promises "learn a language without trying"; the band title answers *"and when you **do** have a bit of extra time…"*. It concedes the exception out loud instead of quietly contradicting the hero. Don't reword it into a generic "Go deeper" — the concession is the point.

**Three things the band's rework fixed (2026-08-06) — don't undo them):**

1. **No accent-coloured run-in.** The role-play paragraph used to open with a long bold-purple claim. The colour wasn't the real problem — the sentence said the same thing as the heading above it *and* the sentence after it, so the block stated one idea three times. Removing it fixed the clunkiness and the redundancy together.
2. **The definition leads.** "Wurlds are role-playing games you live in the language you're learning" is the first thing in the paragraph. It used to be buried in the collapsed disclosure, so a reader could get through the whole half without learning what a wurld *is*.
3. **The four points live inside the role-play copy column**, not at band level. "Chapters, not lessons" says nothing about practice sessions, so at band level they read as belonging to both halves. Inside the column they also fill the space the much taller phone leaves beside them.

The band intro is a two-column editorial block on desktop — title left, lead right — because a single 36rem column left half the band empty. Its lead must announce that *two* halves follow ("Two ways to do that"), or they read as unrelated features stacked up.

**Never let the extra-time half sound compulsory.** The whole site's differentiator is that nothing nags you. Practice is "when you want it", role play is "because you want to know what happens" — never "keep your streak", never "don't break your progress".

**Visual contrast is part of the argument.** Revision shows a plain multiple-choice card on the plain page background; Wurlds shows an immersive scene inside a phone on a tinted band. That difference *is* the pitch — flashcards look like homework, wurlds looks like somewhere you'd go. Don't prettify the question card into parity.

The revision card's example word (`todavía`) is the same word saved in the Wurlds mockup below it, and the card is attributed to Carlos — the Spanish speaker from the chat demo higher up the page. Both echoes are deliberate: they show cards coming out of real conversations rather than a stock deck. Keep names consistent with the chat demo if you edit it.

### The positioning problem, and the frame that resolves it

The site's core pitch is **passive** ("Learn a language without trying", "you're already messaging friends"). Wurlds is the opposite shape — active, sit-down, game-like. Dropping it in unframed would read as a contradiction.

The resolving frame: **the enemy is willpower, not time.** Competing apps fail twice — they need you to *find* time, then *force* yourself to use it. Wurld's two halves attack the same enemy from opposite sides:

- **Chat removes the effort** — it's inside something you already do.
- **Wurlds removes the obligation** — you return because you want to, not because you were guilt-tripped.

Neither asks for discipline. That is why both can live on one page without the second demoting the first.

**Hold this rule when editing:** Wurlds is always framed as *"when you want it"*, never *"what you should do."* The moment copy implies chat is the on-ramp and Wurlds is the real product, the site has lost the thing it does best.

> Removed 2026-08-05: the section used to close on *"Still optional. Chat keeps teaching you either way."* plus *"Part of Pro — free while we're growing."* Both are gone at the owner's request. The optionality is now carried implicitly by the body copy ("Practice mode is great for a quick revision, but…"), and the paid status by the Pro column in the pricing table. If a future edit makes the section read as *the* product rather than an addition, that explicit guardrail line is the cheapest fix.

### Non-obvious decisions

| Decision | Why | Revisit when |
|---|---|---|
| **Placed AFTER the features grid, before pricing** | That grid *is* the "why passive works" argument. The reader has to buy it before an "and when you want more" turn lands. Placed earlier, the two pitches compete. | Only if the features grid moves. |
| **Full-bleed band** (like `.demo-band`, plus a faint accent wash) | Signals "different mode of the same product" before a word is read — does half the de-jarring work visually. | — |
| **Section introduces conventional practice too** ("practice questions, flashcards, the drills") | The site previously never mentioned focused practice at all — "Practice language mode" appeared only as an unexplained Pro bullet. Wurlds lands far better as *the answer to focused practice's problem* than as a cold new feature. | If a dedicated practice-mode section is ever added. |
| **Kept the hero untouched** | "Learn a language without trying" is the strongest line on the page. Rather than soften it, the Wurlds lede *names the pivot out loud* ("some days you **do** want to try"). An acknowledged pivot reads as generous; an unacknowledged one reads as inconsistent. | Never soften the hero to accommodate this section. |
| **"It's still real study"** kept in the lede | Without it a game reads as fun-but-useless, which undercuts charging for it. | — |
| **Avoided the word "gamified"** | That's the word for what competitors do *to* you — points bolted onto a lesson. Using it files Wurld next to the thing it's differentiating from. | — |
| **Three sub-points lifted from the app's own explainer** (`LifeOverviewExplainer` / `life.overview.explainer.*`) | CLAUDE.md requires no seam between `wurld.chat` and `app.wurld.chat`. Same words in both places. | Re-sync if those i18n values change. |
| **Wurlds listed first in the Pro column** | It's a paid feature and by some distance the most compelling item in that list. | If tier boundaries change. |
| **No availability tag** | ✅ **Confirmed (2026-08-05):** the site update and the app release go live together, so there is nothing to warn about. An "In the next update" pill was built and then removed. Don't reintroduce one unless the two ship out of step again. | If site and app releases ever decouple. |

### The mockup (`WurldsDemo.tsx` + `wurldsScenes.tsx`)

Hand-built in the same design vocabulary rather than screenshotted — matching `ConversationDemo`, which is also a hand-built mockup, not a capture. Reuses `PhoneMockup` so the two demos read as one product in two modes. No new image assets; backdrops are inline SVG (in the app the scene is Gemini-generated per world and cached).

Art + script are **data**, in `wurldsScenes.tsx`. Each `WurldScene` carries its backdrop, world/chapter labels, both dialogue beats, the tapped vocab word, and both chip sets. Changing `const SCENE = …` at the top of `WurldsDemo.tsx` swaps the entire mockup.

> ⚙️ **Static, and rendered with no `client:*` directive — so the section ships zero JS.** It originally played the turn out as a scripted 7-step animation. One frame (both bubbles present, a word tapped open, the follow-up chips waiting) states the mechanism just as well without asking the reader to wait for it, so the playback engine was deleted as unnecessary complexity. Astro prerenders the component to HTML and no `WurldsDemo` chunk is emitted. **Nothing in this component may use hooks or touch the browser** — adding either silently does nothing until someone also adds a client directive, at which point the section starts shipping React again. The phone bezel is themed through the `--phone-frame` token rather than a theme-detecting hook for exactly this reason.

| Scene | Status |
|---|---|
| `ACADEMY` — a magic academy at dawn | **Live.** Chosen for visual excitement; its purples also sit inside the brand gradient, which the café's browns fought slightly. |
| `CAFE` — a Barcelona café | **Parked, still exported.** The original. Kept as live code rather than deleted so switching back is a one-word edit. |

> 🔒 **The rule for any new scene: exciting setting, ordinary language.** The backdrop can be as fantastical as you like, but the dialogue must be everyday, high-frequency phrases the learner would genuinely use — running late, apologising, asking if something has started, borrowing notes. The site's own feature card promises *"vocabulary you actually need"*; a scene full of invented arcana would contradict it on the same page. The academy script is deliberately mundane Spanish (`todavía`, `me he perdido`, `¿me prestas…?`) in a magical room.

Keep world titles short — the header allows ~120px before ellipsising.

Mirrors the real screen's composition: `SceneStage` (full-bleed SVG + location ribbon) → `DialogueArea` (sliding two-bubble window, practice text + native gloss) → `ActionBar` (3 choice chips + the ✏️ "write your own" chip, per `LIFE-NODE-4`). The scripted beat shows the whole loop: scene → dialogue → choice → consequence → tap-a-word → saved to cards.

Both bubbles — yours and theirs — sit in **one bottom-anchored flex column**, in the order they were said, both showing practice text *and* native gloss, and both carrying an avatar (theirs left, yours right). Don't move your bubble back out to a free-floating `position: absolute` corner; it detaches from the conversation and reads as a notification rather than a reply.

**Composing a backdrop:** the dialogue occupies the bottom ~40% of the screen, so keep every piece of detail in the **top ~55%** and leave the lower band as near-flat colour under a strong vignette. In `AcademyBackdrop` the detailed elements are wrapped in `translate(0,-26)` (candles shift less, `-10`, so they don't clip off the top) with a raised, deliberately plain floor beneath. Note that neither a horizontal nor a vertical flip solves this — the bubbles span the full width, so mirroring sideways changes nothing, and mirroring vertically drops *all* the detail into the bubble zone.

**Traps if you edit it:**
- The surrounding section is `text-align: center`; the phone root pins `textAlign: 'left'` so the app UI doesn't inherit it.
- The word-lookup chip is a **flow item in the dialogue column**, not an overlay. As an absolutely-positioned popover above the bubble it covered your own bubble once both bubbles moved to the bottom.
- Avatars are wrapped in a `clipPath` circle and their shoulders deliberately overflow it. Both halves are needed: without the clip the body spills out of the disc; without the overflow the clip tapers it to a floating blob.
- If you ever restore animation here, note that an animated `transform` **replaces** an element's inline `translateX(-50%)`, so anything centred that way must carry the `-50%` through every keyframe or it silently renders off-centre and clips at the screen edge.

Respects `prefers-reduced-motion` by jumping straight to the finished state.

## Assets referenced by the legacy page (mostly to be replaced)

- Logos: `~/src/wurld/public/logo.png`, `logo-w.png` — **superseded** by the new brand assets in [design-system.md](design-system.md).
- App Store / Play badges: loaded from Apple/Google CDN URLs (can reuse those URLs).
- Language flags: Unicode emoji from `~/src/wurld/constants/languages.ts` (80+ entries) — copy the list if the marquee is ported.
- `~/src/wurld/assets/images/iphone-add_to_homescreen.png` — install-instructions visual (only needed if PWA-install UX is ported).

## Behaviours worth keeping

- **Smart install redirect:** `getInstalledRelatedApps()` → if installed, jump to `app.wurld.chat` (already in the current `index.astro`).
- **Light/dark theme:** the app is theme-aware; the marketing site should be too (system-preference based; see the app's `index.html` boot script and `data-theme` attribute approach in [design-system.md](design-system.md)).
- **Reduced motion:** the demo's animations should respect `prefers-reduced-motion`.
