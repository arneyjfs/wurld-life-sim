# Explain modal spec (chat mode)

The chat-mode Explain modal (`src/components/ExplainModal/`): the language cards at the top, the streamed translation review and sections, and follow-ups. Also the **phrase explainer** (§2): the vocab card's `?` button, which explains one underlined phrase without a modal. Practice mode is owned by [practice-mode.md](./practice-mode.md) (`PRACTICE-EXPLAIN-*`). The prompts are server-owned (`SRV-PROMPT-6`, same spec).

This is the **desired** state. Discrepancies are bugs. **Status: stub.** Only the original-message disclosure is specified so far. The rest of the modal predates this spec and is asserted by `tests/e2e/specs/explain-modal.spec.ts`.

Invariant ids (`EXPLAIN-*`) are stable — tests grep them.

---

## §1 Original message (EXPLAIN-ORIG-*)

*Added 2026-10-05.* The owner saw a review praise a translation for capturing "the original French", in a modal that showed only Spanish and English. The prompt is right to judge the translation against the message's real source language. The reader just had no way to see that source. Owner: *"put a collapsible at the top that's closed, saying original (French) or something."*

### EXPLAIN-ORIG-1 — A collapsed "Original (<language>)" disclosure sits above the language cards

In chat mode, when the message's original language is a different translation language from both the practice and native cards (`sameTranslationLanguage`, so `English (British)` and `English` count as the same), the modal shows a disclosure **above** the language cards. Its label is `Original (<originalLanguage>)`, with that language's flag.

### EXPLAIN-ORIG-2 — It is closed every time the modal opens

The disclosure starts collapsed on every open, and the state is not persisted. The toggle is a `<button>` with `aria-expanded` and `aria-controls`, and Enter / Space toggle it.

### EXPLAIN-ORIG-3 — Expanded, it shows the original text as a language card

Expanded, the disclosure shows the original as a language card: flag, language, text, Copy and listen (the same `LangCard` as the cards below it, TTS-SURFACE-3). The text is the original-language translation row (`readLanguageRow(translations, originalLanguage)`), never `message.originalText`. That is the same field the explain prompt reviews against (SRV-PROMPT-6), so the reader sees exactly the text the review talks about.

### EXPLAIN-ORIG-4 — Absent when there is nothing new to show

There is no disclosure when:
- the original language is the practice or native language (a card below already shows it);
- the modal is in practice mode (PRACTICE-EXPLAIN-8: no language cards at all);
- the message has no original language or no row for it.

---

## §2 Phrase explainer (EXPLAIN-PHRASE-*)

*Added 2026-10-24.* Owner: *"a question mark icon which could call a special case of the explain modal, where it doesn't do translation checking and simply does the same kind of explain generation … all focusing on that phrase. Maybe it doesn't need a follow-up message box, just to keep things really simple."* Placement picked from mockups (`/mnt/project-files/phrase-explainer/mockups/`): the message rises like a long-press and the explanation sits where the actions menu would.

### EXPLAIN-PHRASE-1 — The vocab card's left slot is a `?` button, on chat bubbles only

The chat vocab card (`WordPopover`, MSG-VOCAB-13) carries a circular `?` button at its left edge, the same 24px footprint and fill as the save button on its right. It appears only where the card belongs to a chat message (`MessageBubbleBody`). The review dock and the life sim pass no explain handler, so their cards have no `?`.

### EXPLAIN-PHRASE-2 — Tap: the `?` spins, then the message rises with the complete explanation

Tapping `?` starts one call and swaps the glyph for a spinner. Nothing else moves while it waits. **Once the whole answer has arrived**, the bubble lifts exactly as on long-press (RXN-MENU-1: same backdrop, same lift, same return), with the vocab card still open in it, and the explanation panel takes the actions menu's place below it, at its final size; the spinner stops. There is no reactions strip and there are no action rows. The panel is re-measured on every resize, so a panel that does not fit below the bubble moves the bubble up, on the lift's own transition. *(Amended 2026-10-26, owner: "the card needs to stay hidden until all content is ready. At the moment I don't like the way the card shows then jumps." This reverses the 2026-10-24 amendment that opened the panel on the first streamed section: a panel that grew under the reader made the lifted bubble jump. The call still streams on the wire, which changes nothing for the reader; partial sections are simply not rendered.)*

- **EXPLAIN-PHRASE-2.1 — Closing.** A tap on the backdrop, Escape, or Android back closes it with the long-press return animation (NAV-OVERLAY-2). The vocab card stays open.
- **EXPLAIN-PHRASE-2.2 — A stale result does not open.** If the card has closed or moved to another word by the time the answer is complete, nothing rises; the answer is still cached (EXPLAIN-PHRASE-5).
- **EXPLAIN-PHRASE-2.3 — Failure.** A call that fails at any point stops the spinner and shows the standard error toast; nothing rises, even if some sections had already streamed. Only a complete answer is cached.
- **EXPLAIN-PHRASE-2.4 — Keyboard and bubble.** The `?` carries `preventComposerFocusSteal` and stops click propagation, like the speak button (MSG-VOCAB-9.4), so the tap itself neither blurs the composer nor reaches the bubble. The lift then holds and hides the keyboard and gives it back on close, as long-press does (COMP-KB-25).

### EXPLAIN-PHRASE-3 — The prompt explains the PHRASE, not the translation

A fourth server-owned explain kind, `explain_phrase` (SRV-PROMPT-6), built by `explainPhraseSystemInstruction` / `explainPhrasePrompt` in `functions/src/prompts/explain.ts`. The spec carries `practice`, `native`, `phrase`, `gloss` (the card's translation), `sentence` (the practice-language text the phrase came from), and the optional `nativeSentence`, `wordDifficulty`, `contextMessages`.

- **EXPLAIN-PHRASE-3.1 — No translation review.** The output has no `<review>` element, so no score, no AI-feedback submission (PRACTICE-EXPLAIN-7 does not apply) and no "is this translation right" commentary.
- **EXPLAIN-PHRASE-3.2 — 1–3 short sections, all about the phrase**, only the ones that add something for this phrase: what it means in this message; the literal word-by-word meaning and why the gloss differs, when it does; a common trip-up; etymology or the idiom behind it. Same XML `<explanation><section title>` shape as `explain`, so `parseExplanationXML` and `SectionCard` render it unchanged.
- **EXPLAIN-PHRASE-3.4 — Every practice-language term is a savable card; bold only for the tapped phrase** *(owner, 2026-10-26: "the model's getting confused how to write and whether it can use Markdown or HTML or vocab cards"; then "Vocab cards are better actually, maybe let's force that")*. Every practice-language word or phrase the explanation mentions, other than the tapped phrase, is a `<vocab phrase translation/>` card, described to the model as a card that shows the phrase and its translation together with a button to save both. Markdown `**bold**` is only for the tapped phrase or a word in it, which is never a card (its own card is already open). The prompt forbids HTML tags and headings.
- **EXPLAIN-PHRASE-3.5 — Stray HTML emphasis still renders as emphasis.** If a model writes `<strong>`/`<b>` or `<em>`/`<i>` anyway, `parseExplanationXML` turns them into markdown `**…**` / `*…*` in a section or review body before rendering (a section title, which is plain text, just drops them), for every explain kind, so a learner never sees raw tags.
- **EXPLAIN-PHRASE-3.3 — No follow-up box.** The panel has no composer. Wanting more is what the full Explain (long-press) is for.

### EXPLAIN-PHRASE-4 — Plus-only, like Explain

`?` is shown to every viewer. For a viewer without the explain entitlement (`canExplain`, LANG-TIER-1.1) the tap makes NO model call and shows no spinner: the message rises at once with a compact `NeedsPlus` offer in the panel, titled "Get explanations on all translations" (owner's copy, 2026-10-24) with the standard upgrade button that opens the Plus sheet. Server-side, `explain_phrase` is in the paid gate's explain categories (`paidFeatureForCategory`), so a direct call from an unentitled account is refused there too.

### EXPLAIN-PHRASE-5 — Cached for the session

A completed explanation is cached in memory by `(message id, phrase lowercased, practice, native)`. Tapping `?` again for the same phrase rises at once with no call. The cache is LRU-bounded (30 entries), like the modal's.

---

## Design decisions

**Phrase explainer: the message rises, rather than a sheet or a popover (2026-10-24).** A bottom sheet (the Explain modal's shape) covers the message the learner is asking about and is heavier than a one-phrase question deserves. A popover anchored to the `?` gets cramped and has to flip or clip near the top of the list. Rising reuses the long-press lift, so it costs no new overlay machinery, keeps the highlighted phrase in view, and has room for three short sections. Revisit if explanations routinely overflow the space below the bubble.

**Phrase explainer: rise on the first section, not on the whole answer (2026-10-24, reversing the first build).** The first build waited for the complete answer so the lift was laid out once and never moved. On device the owner asked for it to open the moment text starts streaming: the 1–2s wait read as lag. The cost is that the panel grows after the lift, so the menu re-measures on resize and the bubble may glide up once if the panel outgrows the space below it. Rising on the first COMPLETE section (rather than the first token) keeps the panel from opening empty or half-parsed and matches the Explain modal's streaming. Revisit if the mid-read glide bothers people: reserving the panel's likely height up front would remove it.

**A closed disclosure, not a third card.** Most messages a learner explains were written in their practice or native language, and those get no disclosure (EXPLAIN-ORIG-4). When the source is a third language, it is context for the review, not something the learner is studying. A third open card would push the review below the fold on a phone. A one-line closed row costs one line.

**Gated by translation language, not by string equality.** Regional variants share one row (MSG-KEY-10.4). If `English (British)` were treated as different from `English`, the disclosure would repeat the native card.

**Phrase explainer markup, measured 2026-10-26 (EXPLAIN-PHRASE-3.4).** On GPT-6 Luna (the provider for this kind since MSG-PIPE-31), the old prompt said "section bodies render as markdown, `**bold**` and `*italic*` sparingly" next to an XML output format, and the model mixed the two: 3 runs × 17 phrases (`scripts/measure/luna-prompts/phrase-explain/run_ph.py luna-port`, the owner's "de Lupin" case added as PH17) wrote raw `<em>` tags in 3–8 of 17 answers per run, and half its vocab cards (3–12 per run) tagged the tapped phrase itself, against the rule. The new wording (cards first, described by what the reader sees; bold for pointing; no HTML) gave 0 HTML tags and 0–1 tapped-phrase cards in 3 runs. The cost: the model now points at words with bold more often than it introduces new terms, so legitimate cards fell from 5–7 per run to 1–2. Two rewordings that pushed harder for cards ("a new word is always a card") did not raise it and read worse, so the owner's framing (the model chooses) stands. Italics still appear for a title (*Lupin*) in about 1 answer in 4; the renderer shows them as italics, so they are left alone rather than adding a rule. Revisit if the owner wants more savable cards: the lever is the examples of what to card, not more rules. **Then forced (same day).** The owner preferred cards, so the rule became "every practice-language word you mention, other than the tapped phrase, is a card; bold only for the tapped phrase" (a rewrite of the same two lines, no new rule). Same 3×17 runs: 0 HTML, 0 tapped-phrase cards, legitimate cards 9–15 per run (from 1–2, and above the old 5–7), and bold landed on anything but the tapped phrase once in 51 answers. More cards exposed a tag quirk that was already in the baseline: a bare `<vocab …>` with no slash and no closer, 5–7 per run, which rendered as raw text. The client normaliser now reads it as the self-closing tag (MSG-PIPE-31.11) rather than adding a prompt rule; all 51 outputs parse with no tag text left. A proper-noun card ("Lupin" = "Lupin") appeared once; left alone.

**Phrase explainer prompt, measured 2026-10-24.** Seven phrases (French, Spanish, German, Italian, Japanese; English and Spanish natives) on `gemini-3.1-flash-lite`, minimal thinking, temperature 0.6, the production stream defaults. The first draft ("1–2 short sentences" per section) produced 3 sections of 2–3 sentences each (~200 output tokens) and opened most sections with filler ("This is a standard way to…"). Capping sections at about 30 words, preferring 2 sections, asking for the point first and an actual word-by-word rendering under "Literally", and telling the model to drop claims it is not sure of brought it to 2 sections in 6 of 7 cases, 128–190 output tokens and 0.8–1.8s for the complete answer, which is the wait the spinning `?` covers (EXPLAIN-PHRASE-2). Explain still has no prompt-eval suite; this was an eyeballed sample, not a graded one.
