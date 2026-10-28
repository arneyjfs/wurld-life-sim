/**
 * English source-of-truth for the i18n message catalogue.
 *
 * Conventions:
 *  - Keys are flat dot-separated paths: `<area>.<screen>.<role>`.
 *  - Placeholders use `{name}` (Intl-MessageFormat-lite). The `t()` helper
 *    substitutes via simple regex — no plural rules in v1 (use
 *    `Intl.PluralRules` directly in components if needed).
 *  - Values are PURE English. No HTML, no markdown, no concatenation.
 *  - If you add OR EDIT a key here, run `npm run i18n:regen` to bring
 *    every non-English locale in sync. The generator is incremental —
 *    it hashes each en value and only re-translates locales whose
 *    stored `__sourceHashes` no longer match (or whose locale file
 *    lacks the key entirely). Unchanged keys are skipped (no API cost,
 *    no model drift).
 *  - To preview what would be translated without spending: `npm run
 *    i18n:dry-run`. For a current coverage report: `npm run i18n:audit`.
 *
 * Coverage v1: high-traffic chrome (login, chat, settings, common toasts,
 * image review). Admin panel + practice screens defer until phase 10b.
 *
 * The TYPE shape of this object is exported as `Messages` — every other
 * locale must satisfy `Partial<Messages>`. Missing keys fall back to the
 * English string at runtime, so a locale file can be incomplete without
 * breaking the UI.
 *
 * ⚠️ NOT everything user-facing lives here. DYNAMIC, data-driven labels are
 * localised OUTSIDE this file and are easy to forget — CHECK THEM whenever you
 * touch i18n:
 *  - **Flashcard categories / topics** are Gemini-generated at runtime, so
 *    they can't be static keys. They live in the `/topics` Firestore
 *    collection as `{ name (English), translations: { <locale>: label } }`,
 *    populated by the `onTopicCreate` Cloud Function (+ a one-shot backfill
 *    for pre-existing topics) and read via `getTopicLabel` /
 *    `getTopicLabelByName` (`src/lib/topicLabel.ts`), which falls back
 *    locale → base → en → titleCase(name). When adding a topic-like dynamic
 *    string, or changing the locale set, make sure that path still localises
 *    every category — a missing `translations` entry silently shows English.
 */

export const en = {
  // ── settings: privacy ──────────────────────────────────────────────
  // AUTH-PROFILE-7.1 — shown only when the boot gate's hold exceeds
  // BOOT_STALL_MS, i.e. the profile snapshot never arrived and never errored.
  'boot.stalled.title': 'Still connecting',
  'boot.stalled.body': 'This is taking longer than usual. Reloading normally fixes it.',
  'boot.stalled.action': 'Reload',

  'settings.privacy.title': 'Privacy',
  'settings.privacy.privacyPolicy': 'Privacy policy',
  'settings.privacy.termsOfService': 'Terms of service',

  // ── settings: difficulty ───────────────────────────────────────────
  'settings.difficulty.title': 'Level',
  'settings.difficulty.subtitle':
    'Sets how challenging practice, chat quizzes and explanations are. Each language you practise has its own level.',
  'settings.difficulty.tabsAria': 'Level for each language',

  // ── settings: pronouns ─────────────────────────────────────────────
  'settings.pronouns.title': 'Pronouns',
  'settings.pronouns.whyDoWeAsk': 'Why do we ask?',
  'settings.pronouns.explainer':
    'The translation engine uses your pronouns to choose the right verb agreement when other languages distinguish gendered forms.',
  'settings.pronouns.heHim': 'He / Him',
  'settings.pronouns.sheHer': 'She / Her',
  'settings.pronouns.other': 'Other / Prefer not to say',

  // ── settings: speech (dedicated card — speed + voice) ──────────────
  'settings.speech.title': 'Speech',
  'settings.speech.subtitle': 'How spoken audio sounds across the app.',
  'settings.voice.subheader': 'Voice',
  'settings.voice.subtitle':
    'The speaking voice used across the app — and the Wurld tutor’s persona.',
  'settings.voice.male': 'Male',
  'settings.voice.female': 'Female',
  'settings.voice.notSupported':
    'Speech isn’t available for your practice language yet, so there’s no preview.',

  // ── settings: speech speed (clarity scale — top is natural) ────────
  'settings.speechSpeed.title': 'Speech speed',
  'settings.speechSpeed.subtitle':
    'How clearly speech is spoken everywhere — full natural pace, or clearer and easier to follow.',
  'settings.speechSpeed.tabsAria': 'Speech speed for each language',
  'settings.speechSpeed.level1': 'Clearer',
  'settings.speechSpeed.level2': 'Clear',
  'settings.speechSpeed.level3': 'Natural',
  'settings.speechSpeed.level4': 'Fluent',
  'settings.speechSpeed.level1.blurb': 'Clearly articulated and easy to follow.',
  'settings.speechSpeed.level2.blurb': 'Natural pace, spoken a little more clearly.',
  'settings.speechSpeed.level3.blurb': 'Full native pace, like a casual chat (default).',
  'settings.speechSpeed.level4.blurb': 'Fast and very casual, with natural reductions — for advanced ears.',

  // ── settings: difficulty levels ────────────────────────────────────
  // XP-UI-3.7 — shown when a learner moves their own level up.
  'settings.difficulty.raiseWarning':
    'Moving up a level too early can make practice sessions and chat quizzes quite challenging. You can move back down any time you like.',
  'settings.difficulty.level1.label': 'Total Beginner',
  'settings.difficulty.level1.blurb':
    'Simplest, most patient explanations. Practice sessions stick to essential vocabulary.',
  'settings.difficulty.level2.label': 'Basic',
  'settings.difficulty.level2.blurb':
    'Gentle explanations with grammar basics. Practice covers everyday phrases.',
  'settings.difficulty.level3.label': 'Improver',
  'settings.difficulty.level3.blurb':
    'Clearer explanations with light grammar notes. Practice covers common situations.',
  'settings.difficulty.level4.label': 'Intermediate',
  'settings.difficulty.level4.blurb':
    'Nuanced explanations with cultural context. Moderately challenging practice.',
  'settings.difficulty.level5.label': 'Conversational',
  'settings.difficulty.level5.blurb':
    'Concise explanations focused on idiom + register. Practice spans real conversation topics.',
  'settings.difficulty.level6.label': 'Comfortable',
  'settings.difficulty.level6.blurb':
    'Brief explanations focused on subtleties. Challenging practice with idioms and edge cases.',
  'settings.difficulty.level7.label': 'Advanced',
  'settings.difficulty.level7.blurb':
    'Minimal but rich explanations — cultural + literary nuance. Toughest practice exercises.',

  // ── settings: beta flags (per-flag content) ────────────────────────
  'settings.beta.title': 'Beta features',
  'settings.beta.subtitle': 'Experimental toggles. Behaviour may change.',
  'settings.beta.verboseLogs.label': 'Verbose logs',
  'settings.beta.verboseLogs.description':
    'Print extra console output for the translation pipeline.',
  'settings.beta.disableHaptics.label': 'Disable haptics',
  'settings.beta.disableHaptics.description':
    'Suppress vibration on long-press and swipe.',
  'settings.beta.showPipelineDebug.label': 'Show pipeline debug',
  'settings.beta.showPipelineDebug.description':
    'Reveal pipeline state badges on each message bubble.',
  'settings.beta.devConsole.label': 'Dev console',
  'settings.beta.devConsole.description':
    'Floating on-device console + network inspector. Text is selectable so you can copy errors out.',
  // SETTINGS-BETA-4 / LIFE-UI-8 — the brand string LIFE-UI-8 has always named
  // for this row. Reinstated 2026-09-22 with the flag itself.
  'settings.beta.lifeSimBeta.label': 'Wurlds (beta)',
  'settings.beta.lifeSimBeta.description':
    'Show the Wurlds tab — the life simulator. Still changing week to week.',

  // ── settings: notifications (hint paragraph) ───────────────────────
  'settings.notifications.previewHint':
    'Pick {practiceLabel} to test yourself on notifications as they arrive. Also controls the language of message previews in your chat list.',

  // ── chat: date separator pill + list timestamps ────────────────────
  // I18N-10. The only two WORDS in the `lib/time.ts` cascade; every other
  // branch is an Intl date/time format and needs no key.
  'chat.dateSeparator.today': 'Today',
  'chat.dateSeparator.yesterday': 'Yesterday',

  // ── chat: view-mode modal ──────────────────────────────────────────
  'chat.viewMode.swipeToPeek': 'Swipe messages left to peek at translation',
  // MSG-VIEW-8: toast on the second-row toggle (header eye OR sheet switch).
  'chat.viewMode.translationsHiddenToast': 'Translations hidden',
  'chat.viewMode.translationsVisibleToast': 'Translations visible',

  // ── tutor setup walkthrough panel (TUTOR-SETUP-6/11) ───────────────
  // Each step shows a SHORT title (TUTOR-SETUP-11) above its instruction.
  'setup.exitTour': 'Exit tour',
  'setup.sendMessage.title': 'Welcome to Wurld!',
  'setup.sendMessage.instruction':
    "Reply in {practice} or {native} to get started — I'll catch any mistakes.",
  'setup.sendMessage.hint':
    'Hint: setup your keyboard for both languages first',
  'setup.viewMode.title': 'Test yourself',
  'setup.viewMode.instruction':
    'As you get better, hide the {native} row to test yourself — tap the eye {icon} (top-right).',
  'setup.viewMode.instructionRetry':
    'Still showing the {native} row — tap the eye {icon} to hide it, or tap below.',
  'setup.viewMode.turnOff': 'Turn off the {native} row',
  'setup.peek.title': 'Peek at the translation',
  'setup.peek.instruction':
    'With {native} hidden, swipe a message left to peek at the translation.',
  'setup.peek.wrongWay': 'Other way! Swipe left to peek',
  'setup.flashcard.title': 'Save a word',
  'setup.flashcard.instruction':
    'Tap an underlined word, then the {icon} button, to save it as a flashcard.',
  'setup.flashcard.turnOnHint': 'Tap the {icon} to show your {native} row again.',
  'setup.stepDone': 'Nice!',
  // TUTOR-SETUP-21 — the tour ends on one button. No navigation: the tutor
  // takes it from here, in the chat the user is already looking at.
  'setup.handover.title': "That's the tour",
  'setup.handover.instruction':
    'You know your way around now. Let me set you up with something to study.',
  'setup.handover.go': 'Continue to chat',
  'setup.finish.goToCards': 'Go to my flashcards',
  // Tutor structured-action cards (TUTOR-ACTION-7).
  'tutorAction.flashcardsAddedOne': 'Added {phrase} to your flashcards',
  'tutorAction.flashcardsAddedMany':
    'Added {phrase} and {count} more to your flashcards',
  'tutorAction.viewDeck': 'View deck',
  'tutorAction.savedWord': 'Saved {word}',
  'tutorAction.saveWordError': 'Couldn’t save that word',
  'tutorAction.explainLongPressHint':
    'Hold down on a message bubble at any time to explain the translation.',
  'tutorAction.practiceDefaultLabel': 'Practice session',
  'tutorAction.practiceStart': 'Start practice',
  'chat.viewMode.applyAcrossAllChats': 'Apply across all chats',
  // MSG-VIEW-7.11 — name WHAT copies. This is the only control on the sheet
  // that leaves this chat, and it sits inches under a language heading: the
  // settings travel, the chat's LANGUAGES do not. "Copy the above settings",
  // next to rows reading "English first", invited exactly the wrong inference —
  // that every chat was about to become English.
  'chat.viewMode.applyAcrossAllChatsSubtitle':
    'Apply these reading order settings across all chats.',
  'chat.viewMode.applyGlobally': 'Apply Globally',
  'chat.viewMode.applying': 'Applying…',
  'chat.viewMode.appliedToast': 'Updated defaults for all chats',
  // LANG-SET-8 — the view menu's row is now a SIGNPOST to the info screen,
  // where the pickers live. It keeps naming both languages so the row still
  // answers "what am I set to" at a glance; only the tap target changed.
  // MSG-VIEW-7.10 — the route to the chat's LANGUAGES, top-right of the
  // heading row. Short on purpose: it only navigates, and a full-width row with
  // a subtitle naming both languages was the longest line on the sheet.
  'chat.viewMode.languagesRowTitle': 'Manage languages',
  'chat.viewMode.languagesRowAria': 'Manage this chat’s languages — opens chat info',
  'chat.viewMode.languageAriaSet': 'Practice language: {language}',

  // MSG-VIEW-7 / LIFE-LANG-3 — the unified view-settings sheet, shared by the
  // chat screen and the life sim. `{language}` is always a REAL language name
  // ("French", "English"), never the words "practice" / "native": the reader
  // knows what they are learning, not which of the two abstractions it is.
  'view.settings.heading': 'View settings',
  // MSG-VIEW-7.3 — real language names, plus the ORDER they set.
  //
  // ⚠ Never "practice language" / "native language": the reader knows what they
  // are learning, and "practice" is our word for it. The word `first` is what
  // the bare names were missing — it says this picks an ORDER, not a language.
  //
  // ⚠ A role-led variant ("Practice first ({practice})") was tried and reverted
  // the same day. It fixed the `Apply Globally` ambiguity by loading every row
  // label with a qualifier; the ambiguity lives in ONE sentence, so it is fixed
  // there instead (MSG-VIEW-7.11) and these stay short.
  'view.settings.mainRow': 'Reading language',
  'view.settings.mainRowHeading': 'Reading language',
  'view.settings.mainRowPractice': '{practice} first',
  'view.settings.mainRowPracticeDesc': 'Read in {practice}.',
  'view.settings.mainRowNative': '{native} first',
  'view.settings.mainRowNativeDesc': 'Read in {native}.',
  'view.settings.secondRow': 'Show second row',
  'view.settings.secondRowOnDesc': '{language} appears underneath, in smaller text.',
  'view.settings.secondRowOffDesc': 'Turn on to also show {language} underneath.',
  'view.settings.eyeAria': 'Toggle the second row',
  'chat.viewMode.menuButtonAria': 'View settings menu',
  'chat.viewMode.menuButtonTitle': 'View settings',

  // ── common ─────────────────────────────────────────────────────────
  'common.cancel': 'Cancel',
  'common.confirm': 'Confirm',
  'common.continue': 'Continue',
  'common.save': 'Save',
  'common.delete': 'Delete',
  'common.retry': 'Retry',
  'common.close': 'Close',
  'common.back': 'Back',
  'common.next': 'Next',
  'common.done': 'Done',
  'common.saving': 'Saving…',
  'common.loading': 'Loading…',
  'common.send': 'Send',
  'common.errorGeneric': 'Something went wrong. Please try again.',
  'common.you': 'You',

  // ── tab bar ────────────────────────────────────────────────────────
  'tabBar.chats': 'Chats',
  'tabBar.contacts': 'Contacts',
  'tabBar.cards': 'Cards',
  // NAV-PRACTICE-1 — Practice is its own tab (2026-10-24).
  'tabBar.practice': 'Practice',
  'tabBar.life': 'Wurlds',
  'tabBar.settings': 'Settings',

  // UI-DESKTOP-8 — the pointer-only route to the message actions menu.
  'chat.actions.openMenu': 'Message actions',

  // UI-DESKTOP-5 — the desktop nav rail. No mobile surface uses these.
  'nav.expand': 'Show labels',
  'nav.collapse': 'Hide labels',
  'nav.newGroup': 'New group',

  // ── life sim (LIFE-*) ──────────────────────────────────────────────
  'life.title': 'Wurlds',
  'life.wipBadge.label': 'WIP',
  'life.wipBadge.title': 'Life sim is being built — the visual identity is here, but the LLM-driven story arrives in the next phase.',
  'life.buildingWorld': 'Building your wurld…',
  'life.travellingTo': 'Travelling to {destination}…',
  'life.arrivedAt': 'Arrived at {destination}',
  'life.locationRibbon.apartment': 'Your apartment · morning',
  'life.thinking': 'Thinking…',
  // LIFE-UI-11: the live-loading bar, keyed to what the player just did. The
  // wait is 2-3s and happens EVERY turn, so this is story voice, not app voice
  // — "Thinking…" described the machinery in the middle of a scene.
  'life.goal.chipAria': 'Your goal and how long is left',
  'life.goal.daysLeft': '{count} days',
  'life.goal.sheetTitle': 'What you are working toward',
  'life.goal.by': 'by {when}',
  'life.goal.nowLabel': 'Right now',
  'life.goal.sceneClose': 'Still to do',
  'life.goal.introLabel': 'What you are working toward',
  'life.goal.startWith': 'Start with: {what}',
  'life.wait.opening': 'Setting the scene…',
  'life.wait.say': 'Seeing how that lands…',
  'life.wait.act': 'Seeing what happens…',
  'life.wait.write': 'Seeing where that takes you…',
  'life.wait.resume': 'Picking up the thread…',
  'life.wait.outcome': 'Carrying on…',
  'life.practice.fillBlankEyebrow': 'Complete the sentence',
  'life.practice.sayThis': 'Say: “{text}”',
  'life.practice.comprehensionEyebrow': 'What did they just say?',
  'life.practice.listenFillEyebrow': 'Listen & fill',
  'life.practice.listenFillHint': 'Tap play, then pick the word you heard.',
  // LIFE-EX-12: the listening variant of a comprehension question.
  'life.practice.listenComprehensionEyebrow': 'Listen & answer',
  'life.practice.listenComprehensionMasked': 'Listen — what did they say?',
  'life.cardMatch.eyebrow': 'Quick review — match the pairs',
  'life.wordOrder.eyebrow': 'Build the sentence',
  'life.wordOrder.sayThis': 'Say: “{text}”',
  'life.wordOrder.hint': 'Tap the words in order…',
  'life.wordOrder.submit': 'Check',
  'life.practice.saidBy': '{name} said:',
  'life.options.eyebrow': 'What do you do?',
  'life.reveal.translation': 'Reveal translation',
  'life.typeToFill.placeholder': 'Type the missing word…',
  'life.typeToFill.submit': 'Check',
  'life.vocab.narrator': 'Narrator',
  'life.vocab.saved': 'Saved to flashcards',
  'life.vocab.removed': 'Removed from flashcards',
  'life.feedback.correct': 'Nice — that\'s right.',
  'life.feedback.wrong': 'Not quite.',
  'life.feedback.youPicked': 'You picked:',
  'life.feedback.correctAnswer': 'The correct answer was:',
  'life.feedback.meaning': 'It means:',
  'life.feedback.fullSentence': 'The full sentence:',
  'life.feedback.why': 'Why?',
  'life.feedback.continue': 'Continue',
  'life.streak.title': '{count}-day streak — keep it alive!',
  'life.intro.eyebrow': 'Your story begins',
  'life.intro.begin': 'Begin',
  'life.avatar.you': 'You',
  'life.freeText.placeholder': 'Write your own…',
  'life.freeText.send': 'Send',
  'life.writeYourOwn.chip': 'Write your own',
  'life.writeYourOwn.cancel': 'Back to choices',
  'life.question.authoring': 'Preparing your question…',
  'life.optionsFailed.note': 'The story snagged for a moment.',
  'life.optionsFailed.continue': 'Continue',
  'life.vocabChip.savedBadge': 'Saved word',
  'life.vocabChip.popover.title': 'From your vocab',
  'life.vocabChip.popover.use': 'Use "{chip}"',
  // LIFE-SCENE-25: the hierarchy the player sees is scene -> chapter -> story.
  // It was day -> chapter -> story until 2026-08, when a scene stopped being a
  // day: several scenes now run in one sitting, so "Day complete" fired three
  // times an evening and "come back tomorrow" was contradicted a minute later.
  'life.sceneComplete.eyebrow': 'Scene complete',
  // LIFE-SCENE-31: the completion screen leads with the compacted line
  // `sceneClose` wrote — the record every later turn reads — rather than the
  // resolution beat, which the player finished reading one screen ago.
  //
  // "What happened", not "what the wurld recorded": the LIFE-UI-8 brand guard
  // rejected the first draft, and it was right for a second reason — "recorded"
  // is engine vocabulary. The player does not know there is a record.
  'life.sceneComplete.summaryLabel': 'What happened',
  'life.sceneComplete.summaryPending': 'Writing this into the story…',
  'life.sceneComplete.summaryUnavailable': 'No record was kept of this scene.',
  // Shown only when the chapter CONTINUES — after a concluding scene the
  // chapter screen follows immediately with its own Continue CTA, and closing
  // the story down one beat before offering to carry on is a contradiction.
  'life.sceneComplete.tomorrow': 'The story picks up from here whenever you are ready.',
  'life.sceneComplete.stats.practiced': 'Practice questions',
  'life.sceneComplete.stats.accuracy': 'Accuracy',
  'life.sceneComplete.stats.fillBlank': 'Fill-blank',
  'life.sceneComplete.stats.comprehension': 'Comprehension',
  'life.vocabRecap.reviewMistakes': 'Practise the {count} you missed',
  'life.vocabRecap.reviewMistakesOne': 'Practise the one you missed',
  // LIFE-DAY-4 — a scene and the chapter can land on the same turn.
  // The button then leads to the chapter's summary rather than home, so the
  // bigger milestone is not left somewhere the player has no reason to look.
  'life.sceneComplete.seeChapterSummary': 'See chapter summary',
  'life.sceneComplete.chapterEndTitle': 'Chapter complete!',
  'life.sceneComplete.chapterEndBody':
    'That scene closed out the chapter too — here is how the whole thing went.',
  // LIFE-SCENE-29: `returnHome` was a lie — the CTA resumed the story. The two
  // destinations are now two buttons that each say what they do.
  'life.sceneComplete.continueStory': 'Continue the story',
  'life.sceneComplete.returnToWurlds': 'Return to Wurlds home',
  'life.sceneComplete.returning': 'One moment…',
  // LIFE-SCENE-30: the resolution beat plays out on screen and the player
  // opens the summary when they are ready.
  'life.sceneComplete.viewSummary': 'View scene summary',
  'life.arcComplete.eyebrow': 'Chapter {chapter} complete',
  'life.arcComplete.title': 'Chapter {chapter}',
  'life.arcComplete.stats.campaigns': 'Scenes',
  'life.arcComplete.stats.practiced': 'Practiced',
  'life.arcComplete.stats.accuracy': 'Accuracy',
  'life.arcComplete.recurring': 'You\'ll see again:',
  'life.arcComplete.continue': 'Continue your wurld',
  'life.arcComplete.continuing': 'Setting up the next chapter…',
  'life.arcComplete.pause': 'Pause for now',
  // LIFE-VOCAB-RECAP-6: the day list now carries the day's story vocabulary
  // alongside the graded words, so "Words you practised" over-claims for the
  // rows the player only READ. "Words from today" covers both, and the per-row
  // ✓ / ✗ / neutral marker is what says which is which.
  'life.vocabRecap.title': 'Words from today',
  // LIFE-DAY-2: the chapter screen recaps the DAYS it was made of, and looks
  // forward. It no longer restates the day screen's stats + practised words.
  'life.arcComplete.daysHeading': 'How the chapter went',
  'life.arcComplete.nextTeaser': 'A new chapter is waiting. Open your wurld when you\u2019re ready to see where it goes.',
  'life.arcComplete.keyWords': 'Key words this chapter',
  'life.vocabRecap.more': '+{count} more',
  'life.menu.label': 'Wurld options',
  'life.menu.deleteRestart': 'Delete this wurld',
  'life.menu.deleteConfirm.title': 'Delete this wurld?',
  'life.menu.deleteConfirm.body': 'This wipes your character, every event, NPC, backdrop, and any active or archived scene. Your flashcards stay safe. There is no undo.',
  'life.menu.deleteConfirm.confirm': 'Delete wurld',
  'life.menu.deleteConfirm.deleting': 'Deleting…',
  'life.menu.exit': 'Exit to overview',
  'life.menu.debug': 'View debug logs',
  // LIFE-SETTINGS-7: per-wurld difficulty override in the ⋯ menu.
  'life.difficulty.title': 'Difficulty',
  'life.difficulty.followingGlobal': 'Following global · Level {level}: {label}',
  'life.difficulty.pinned': 'Set for this wurld · Level {level}: {label}',
  'life.difficulty.setForWurld': 'Set for this wurld',
  'life.difficulty.useGlobal': 'Use global setting',
  'life.debug.title': 'Life-sim debug logs',
  'life.debug.count': '{n} entries',
  'life.debug.clear': 'Clear',
  'life.debug.copy': 'Copy',
  'life.debug.copied': 'Copied',
  'life.debug.empty': 'No life-sim events yet. They\'ll show up here as the wurld unfolds.',
  'life.debug.tab.logs': 'Logs',
  'life.debug.tab.telemetry': 'Telemetry',
  'life.debug.telemetry.empty': 'No Gemini calls yet. Each call will appear here with tokens + cache stats.',
  'life.debug.telemetry.callCount': '{n} calls',
  'life.debug.telemetry.totalsHeading': 'Totals by category',
  'life.debug.telemetry.callsHeading': 'Recent calls',
  'life.debug.telemetry.category': 'Category',
  'life.debug.telemetry.calls': 'Calls',
  'life.debug.telemetry.tokensIn': 'In',
  'life.debug.telemetry.tokensOut': 'Out',
  'life.debug.telemetry.cached': 'Cached',
  'life.debug.telemetry.thinking': 'Think',
  'life.debug.telemetry.cost': 'Cost',
  'life.debug.telemetry.cacheSaving': 'Cache saved {saved} of {full} · rates checked {rates}',
  'life.debug.telemetry.retries': 'Retries {count}/{calls} ({pct}%) · {cost} wasted',
  'life.debug.telemetry.retryBadge': 'RETRY {n}',
  'life.debug.telemetry.grand': 'Grand total',
  'life.debug.telemetry.ms': '{ms}ms',
  'life.overview.title': 'Wurlds',
  'life.overview.subtitle': 'Your other Wurlds',
  'life.overview.create': 'Start a new wurld',
  // LIFE-WORLD-11: a delete that fails, and one that is merely taking too long
  // to confirm — the second is not an error, so it must not read like one.
  'life.overview.deleteFailed': 'Could not delete that wurld. Please try again.',
  'life.overview.deleteSlow': 'Still deleting — it will finish once you are back online.',
  'life.overview.createFirst': 'Start your first wurld',
  'life.overview.maxReached': 'You can run up to {max} wurlds at once',
  'life.overview.cardMenu': 'Wurld options',
  'life.overview.cardDelete': 'Delete wurld',
  'life.overview.viewMore.expand': 'View story',
  'life.overview.viewMore.collapse': 'Hide story',
  'life.overview.story.pending': 'Your story is being written…',
  'life.overview.idleLocation': 'Between scenes',
  'life.overview.empty.eyebrow': 'A second wurld',
  'life.overview.empty.title': 'Step into a wurld that speaks your practice language.',
  'life.overview.empty.body': 'Pick a wurld. Become someone. Get fluent through the story of who you become.',
  'life.overview.empty.couldBe': 'You could be living…',
  'life.overview.empty.samplesHint': 'These are sketches of what\'s possible. Your own wurld is whatever you want it to be.',
  'life.overview.explainer.title': 'How wurlds work',
  'life.overview.explainer.chapters': 'Each wurld unfolds in chapters — multi-scene story arcs that thread your character\'s life across sessions.',
  'life.overview.explainer.recurring': 'Characters you build relationships with recur across scenes. Others drift out of touch as the story moves on.',
  'life.overview.explainer.parallel': 'Run up to five wurlds in parallel — different languages, different lives.',
  'life.overview.chapter.number': 'Chapter {number}',
  'life.overview.chapter.readyBadge': 'Chapter {number} · ready',
  'life.overview.chapter.startBadge': 'Just starting',
  'life.overview.chapter.readyPremise': 'A new chapter is ready to begin.',
  'life.overview.chapter.startPremise': 'The first chapter is being written.',
  'life.overview.setting.city_life': 'Everyday city life',
  'life.overview.setting.studying_abroad': 'Studying abroad',
  'life.overview.setting.work_abroad': 'Sent abroad for work',
  'life.overview.setting.family_country': "Your family's country",
  'life.overview.setting.farm_life': 'Taking on the farm',
  'life.overview.setting.retired_village': 'Retired to the village',
  'life.overview.setting.restaurant': 'The restaurant',
  'life.overview.setting.local_team': 'The local team',
  'life.overview.setting.hostel': 'The hostel',
  'life.overview.setting.magic_university': 'The University of Magic',
  'life.overview.setting.noir_detective': 'A noir detective',
  'life.overview.setting.alien_invasion': 'The invasion',
  'life.overview.setting.frontier_colony': 'A frontier colony',
  'life.overview.setting.sea_voyage': 'The long crossing',
  'life.overview.setting.pilgrim_town': 'The pilgrim town',
  'life.overview.setting.outlaw_trail': 'The outlaw trail',
  'life.overview.setting.heist': 'The heist',
  'life.overview.setting.haunted_house': 'The haunting',
  'life.overview.setting.surprise': 'A surprise wurld',
  'life.overview.setting.manual': 'A wurld of your own',
  'life.overview.deleteConfirm.title': 'Delete {name}\'s wurld?',
  'life.overview.deleteConfirm.body': 'This wipes the character, all events, NPCs, backdrops, and any active or archived scene for this wurld. Your flashcards stay safe. There is no undo.',
  'life.resume.prompt.practice': 'Tu reprends ta journée…',
  'life.resume.prompt.native': 'You pick up where you left off…',
  'life.resume.continue.practice': 'Continuer',
  'life.resume.continue.native': 'Continue',
  'life.resume.eyebrow': 'Previously, in this wurld',
  'life.resume.story': 'The story',
  'life.resume.chapter': 'Chapter {number}',
  'life.resume.previously': 'Previously',
  'life.resume.momentsAgo': 'Moments ago',
  'life.resume.continue': 'Continue',

  // ── life sim: onboarding (LIFE-ONBOARD-*) ──────────────────────────
  'life.onboard.title': 'A second wurld',
  'life.onboard.subtitle': 'Step into a wurld in {language}. The story is yours.',
  'life.onboard.name.label': 'Your name in this life',
  'life.onboard.name.placeholder': 'Use a different name for immersion (optional)',
  'life.onboard.language.label': 'Which language should people speak in this wurld?',
  'life.onboard.language.hint': 'Languages are set per wurld — switching later means starting a new one.',
  'life.onboard.language.pickerTitle': 'Language for this wurld',
  // LIFE-ONBOARD-3: the world-mode toggle. The two subtitles ARE the
  // realism nudge now — stated at the moment of choice rather than as
  // a note above a grid, and with the counter-case for fantasy stated
  // just as plainly so the choice reads as a choice.
  'life.onboard.mode.label': 'What kind of wurld?',
  'life.onboard.mode.realistic': 'Realistic',
  'life.onboard.mode.realistic.sub':
    'Live out a situation you may come across in real life. Useful for learning vocab that will help you in a meeting, on holiday, or with the in-laws.',
  'life.onboard.mode.fantasy': 'Fantasy',
  'life.onboard.mode.fantasy.sub':
    'Get lost in a wurld of your choosing. Make the learning adventure gripping enough that you are drawn back to it every day.',
  // LIFE-ONBOARD-3: `life.onboard.seed.label` + `life.onboard.seed.realism`
  // retired 2026-07-31 — the standalone realism nudge is now carried by
  // the two mode subtitles above, at the moment of choice.
  // LIFE-ONBOARD-17 — a hint names what the universe makes POSSIBLE, not what
  // furniture is in it. LIFE-ONBOARD-14 forbids naming the PLOT; it says
  // nothing against naming a standing tension, and the first pass here
  // over-corrected into pure inventory ("halls of residence, lectures, friends
  // on other courses") which sells nothing. Owner, 2026-08-05: *"Although they
  // can't give actual plot, your descriptions can still give an idea of what's
  // possible."* So: rivalries and forbidden shelves, a charter nobody agrees
  // on, a court where drowning can be a verdict — each a permanent fact about
  // the world, none of them an event already in motion.
  //
  // The REALISTIC hints deliberately do NOT get the same treatment. The scar
  // in LIFE-ONBOARD-14 is a menacing backpacking hint; possibility on this
  // side means SOCIAL possibility (a term that ends, a return ticket, a
  // surname already known), never threat.
  'life.onboard.seed.chip.city_life': 'City life',
  'life.onboard.seed.chip.city_life.hint':
    'Trams, tiny kitchens, neighbours met on the stairs, and a city that keeps its own hours',
  'life.onboard.seed.chip.studying_abroad': 'Studying abroad',
  'life.onboard.seed.chip.studying_abroad.hint':
    'Cheap rent, late libraries, and a term that will end before you are ready',
  'life.onboard.seed.chip.work_abroad': 'Sent abroad for work',
  'life.onboard.seed.chip.work_abroad.hint':
    'A borrowed desk, a borrowed flat, and a return ticket with a date on it',
  'life.onboard.seed.chip.family_country': "Your family's country",
  'life.onboard.seed.chip.family_country.hint':
    'A country your grandparents talked about, where your surname is already familiar',
  'life.onboard.seed.chip.farm_life': 'Taking on the farm',
  'life.onboard.seed.chip.farm_life.hint':
    'Weather that decides your week, animals that will not wait, and opinionated neighbours',
  'life.onboard.seed.chip.retired_village': 'Retired to the village',
  'life.onboard.seed.chip.retired_village.hint':
    'Slow mornings, a garden getting away from you, and neighbours with time to talk',
  'life.onboard.seed.chip.restaurant': 'The restaurant',
  'life.onboard.seed.chip.restaurant.hint':
    'Service every night, suppliers who know you, and regulars who never read the menu',
  'life.onboard.seed.chip.local_team': 'The local team',
  'life.onboard.seed.chip.local_team.hint':
    'Training twice a week, a league table, and teammates who only know you from here',
  'life.onboard.seed.chip.hostel': 'The hostel',
  'life.onboard.seed.chip.hostel.hint':
    'Bunks, a night desk, staff who stay, and guests who never do',
  'life.onboard.seed.chip.magic_university': 'The University of Magic',
  'life.onboard.seed.chip.magic_university.hint':
    'Rivalries, romances, forbidden shelves, and magic that always takes something back',
  'life.onboard.seed.chip.noir_detective': 'Noir detective',
  'life.onboard.seed.chip.noir_detective.hint':
    'Late offices, wet streets, and a city where everybody owes somebody',
  'life.onboard.seed.chip.alien_invasion': 'The invasion',
  'life.onboard.seed.chip.alien_invasion.hint':
    'Ships in the sky, cordons on the roads, and neighbours who disagree about what they are',
  'life.onboard.seed.chip.frontier_colony': 'Frontier colony',
  'life.onboard.seed.chip.frontier_colony.hint':
    'Thin air, rationed light, a charter nobody agrees on, and no way home for a year',
  'life.onboard.seed.chip.sea_voyage': 'The long crossing',
  'life.onboard.seed.chip.sea_voyage.hint':
    'Months at sea, a captain nobody crosses twice, and a crew with its own arrangements',
  'life.onboard.seed.chip.pilgrim_town': 'The pilgrim town',
  'life.onboard.seed.chip.pilgrim_town.hint':
    'Bell towers, pilgrim money, relics worth stealing, and a miracle nobody may doubt',
  'life.onboard.seed.chip.outlaw_trail': 'The outlaw trail',
  'life.onboard.seed.chip.outlaw_trail.hint':
    'Dust, a railhead town, a marshal with a long memory, and a price on more than one head',
  'life.onboard.seed.chip.heist': 'The heist',
  'life.onboard.seed.chip.heist.hint':
    'A crew, a target, a plan with too many steps, and one date that cannot move',
  'life.onboard.seed.chip.haunted_house': 'The haunting',
  'life.onboard.seed.chip.haunted_house.hint':
    'A house left to you, a village that knew it well, and rooms nobody opens',
  'life.onboard.seed.chip.surprise': 'Surprise me',
  'life.onboard.seed.chip.surprise.hint': 'Let the story choose, in this style',
  // LIFE-ONBOARD-4/5: the two headings are an "examples, OR write your
  // own" PAIR, and the "or" belongs to whichever of them comes second.
  'life.onboard.seed.examples.label': 'Start from an example',
  // LIFE-ONBOARD-5: `.toggle` + the generic `.placeholder` retired
  // 2026-07-31 — the textarea no longer hides behind a disclosure, and
  // its placeholder is now a worked example chosen by mode.
  'life.onboard.seed.manual.label': 'Or write your own',
  // LIFE-ONBOARD-5: a WORKED example, not a description of one. Each
  // names a person, a situation, and a source of drama — the three
  // things a seed needs before the saga generator has anything to
  // pull on. Tailored per mode so the example matches the register
  // the toggle above just set.
  //
  // The realistic one deliberately SPANS several registers — a prepared
  // talk, questions from the floor, an unfamiliar venue, a social evening.
  // A single-scene example teaches a single-scene seed, and the saga
  // generator has correspondingly less to pull on.
  //
  // SHORTENED 2026-08-01: it had grown to a paragraph, which reads as the
  // required length rather than as an example. The specifics that make it a
  // GOOD seed are kept — a named field ("rare disease") and a concrete
  // friction ("the one person they need to impress") — because those are
  // what a learner should copy. What went is the elaboration around them.
  'life.onboard.seed.manual.placeholder.realistic':
    'e.g. a researcher presenting at a conference on rare disease — questions from the floor, an unfamiliar venue, and drinks afterwards with the one person they need to impress',
  'life.onboard.seed.manual.placeholder.fantasy':
    'e.g. an astronaut on a dying mining colony, who finds a door behind the airlock that opens somewhere it should not — and a captain who already knew it was there',
  'life.onboard.startCta': 'Begin',
  'life.onboard.creating': 'Creating your wurld…',

  // ── login / auth ───────────────────────────────────────────────────
  'login.heading': 'Sign in',
  'login.verifyHeading': 'Verify',
  'login.verifySubtitle': 'You should have received a text — enter the code below to sign in.',
  'login.didntReceive': 'Didn’t receive it?',
  'login.signInWithPhone': 'Sign in with phone to continue.',
  'login.willSendText': 'We’ll send a text to {phone}',
  'login.changePhoneNumber': 'Change phone number',
  'login.sending': 'Sending…',
  'login.verifying': 'Verifying…',
  'login.phonePlaceholder': 'Phone number',
  'login.sendCode': 'Send code',
  'login.verify': 'Verify',
  'login.resendCode': 'Resend code',
  'login.resendIn': 'Resend in {seconds}s',
  'login.codeSentTo': 'We sent a 6-digit code to {phone}.',
  'login.countryPickerSearch': 'Search countries',
  // AUTH-ACCOUNT-2 — Google / Apple / email sign-in.
  'login.subtitle': 'Sign in or create an account to continue.',
  'login.continueWithGoogle': 'Continue with Google',
  'login.continueWithApple': 'Continue with Apple',
  'login.or': 'or',
  'login.emailLabel': 'Email',
  'login.passwordLabel': 'Password',
  'login.signInWithEmail': 'Sign in',
  'login.createAccount': 'Create account',
  'login.switchToCreate': 'New to Wurld? Create an account',
  'login.switchToSignIn': 'Already have an account? Sign in',
  'login.forgotPassword': 'Forgot password?',
  'login.resetSent': 'If an account uses {email}, we’ve emailed it a reset link.',
  'login.working': 'Signing in…',
  'login.oauthStalled': 'Sign-in didn’t finish. Please try again.',
  // AUTH-ACCOUNT-11 — the live password policy's rules, under the password field.
  'login.passwordRules': 'Your password needs',
  'login.passwordRule.length': 'At least {n} characters',
  'login.passwordRule.upper': 'An uppercase letter',
  'login.passwordRule.lower': 'A lowercase letter',
  'login.passwordRule.number': 'A number',
  'login.passwordRule.special': 'A symbol, like ! ? @ # %',
  // AUTH-ACCOUNT-4 — link a phone number to a new account.
  'verifyPhone.heading': 'Add your phone number',
  'verifyPhone.subtitle': 'Friends find you on Wurld by your number. We’ll text you a code to confirm it.',
  'verifyPhone.codeSubtitle': 'Enter the code we texted to your phone.',
  'verifyPhone.useDifferentAccount': 'Use a different account',
  // AUTH-ACCOUNT-6 — beta merge into an existing phone-only account.
  'merge.heading': 'You already have a Wurld account',
  'merge.body':
    '{phone} already belongs to a Wurld account. We’ll add this sign-in to that account and keep all your chats, contacts and cards.',
  'merge.continue': 'Continue',
  'merge.cancel': 'Use a different number',
  // AUTH-ACCOUNT-5 — phone-only accounts add an email method.
  'addEmail.heading': 'Add an email to your account',
  'addEmail.subtitle':
    'Wurld now needs an email address on every account. Add one to keep going. Your chats and contacts stay as they are.',
  'addEmail.submit': 'Add email',
  'addEmail.signOut': 'Sign out',

  // ── profile setup ──────────────────────────────────────────────────
  'profileSetup.displayNameLabel': 'Your name',

  // ── chat list ──────────────────────────────────────────────────────
  'chatList.title': 'Chats',
  'chatList.subtitle': 'Your conversations',
  'chatList.searchPlaceholder': 'Search chats…',

  // ── learning tips (TIPS-*, docs/specs/learning-tips.md) ─────────────
  // `{practice}` / `{native}` are REAL language names ("French"), falling back
  // to `tips.lang.*Fallback` only while the profile is empty (TIPS-PAGE-4).
  // Gesture wording matches the tutor tour's `setup.*` keys on purpose.
  'tips.row.title': 'Learning tips',
  'tips.row.subtitle': 'Get more out of every chat',
  'tips.row.dismiss': 'Hide learning tips',
  'tips.page.title': 'Get the most out of Wurld',
  'tips.page.intro':
    'Small habits that turn every chat into practice. Tap See more on any tip for the details.',
  'tips.group.chats': 'In your chats',
  'tips.group.flashcards': 'Flashcards',
  'tips.group.practice': 'Practice',
  'tips.seeMore': 'See more',
  'tips.seeLess': 'See less',
  'tips.tryIt': 'Try it',
  'tips.exampleLabel': 'For example',
  'tips.shotAlt': 'Screenshot: {title}',
  'tips.lang.practiceFallback': 'your practice language',
  'tips.lang.nativeFallback': 'your own language',
  'tips.settings.title': 'Learning tips',
  'tips.settings.subtitle': 'How to get the most out of Wurld',

  'tips.write.title': 'Write in {practice}',
  'tips.write.summary':
    'Reply in {practice} whenever you can. Everyone still reads you in their own language.',
  'tips.write.details':
    'Each person in a chat reads your message in the languages they chose, so writing in {practice} never slows the conversation down. If something is off, Wurld suggests a corrected version before your message goes, and you choose which one to send.',
  'tips.write.example':
    'Start small: a greeting, a thank-you or a one-word reply in {practice} all count.',

  'tips.guess.title': 'Don’t know a word? Guess it',
  'tips.guess.summary':
    'Type your best guess, or use the {native} word. Wurld fixes it before it sends.',
  'tips.guess.details':
    'You don’t need every word to write in {practice}. Where you get stuck, type a guess or just drop in the word in {native}. Wurld suggests the whole sentence in correct {practice}, so you learn the missing word at the moment you needed it.',
  'tips.guess.example':
    'Write most of the sentence in {practice} and leave the one word you don’t know in {native}.',

  'tips.hideRow.title': 'Hide the {native} row',
  'tips.hideRow.summary': 'Tap the eye at the top right of a chat to read in {practice} only.',
  'tips.hideRow.details':
    'Every message shows in {practice} with {native} underneath. As you get better, hide the {native} row to test yourself: tap the eye icon at the top right of the chat. Tap it again whenever you want it back.',

  'tips.peek.title': 'Swipe left to peek',
  'tips.peek.summary':
    'With the {native} row hidden, swipe a message left to see its translation.',
  'tips.peek.details':
    'Peeking shows the translation of one message without bringing the {native} row back for the whole chat. Swipe a message bubble left to flip it, and swipe again to flip it back. You can flip several messages at once to compare them.',

  'tips.explain.title': 'Hold a message to explain it',
  'tips.explain.summary':
    'Hold down any message to explain its grammar, word choices and meaning, or hear it read aloud.',
  'tips.explain.details':
    'Hold down a message bubble to open its menu, then choose Explain translation. You get the message line by line: what each phrase means, why it’s phrased that way, and the words worth keeping. The same menu can also read the message aloud. Explanations are part of Wurld Plus.',

  'tips.tapWords.title': 'Tap a word to hear it or save it',
  'tips.tapWords.summary':
    'Tap an underlined word to see what it means, hear it and add it to your flashcards.',
  'tips.tapWords.details':
    'Underlined words are the ones worth learning in that message. Tap one to open its card with the meaning. Tap the speaker right after the word to hear how it sounds, and the add-to-flashcards button on the right to save it. Saved words come back in your flashcards and practice quizzes. The ? on the left of the card explains the phrase (see the next tip).',

  'tips.explainPhrase.title': 'Tap ? to explain a phrase',
  'tips.explainPhrase.summary':
    'Not sure why a phrase is said that way? The ? on its card explains just that phrase.',
  'tips.explainPhrase.details':
    'Tap an underlined word or phrase, then tap the ? on the left of its card. The message lifts and the explanation appears below it: what the phrase means in this message, what it says word for word, and the mistakes learners often make with it. Tap anywhere outside to put the message back. Phrase explanations are part of Wurld Plus.',

  'tips.review.title': 'Review your flashcards',
  'tips.review.summary':
    'Every word you save lands in Cards, ready to review, search and filter.',
  'tips.review.details':
    'The Cards tab holds every word and phrase you’ve saved from your chats and quizzes. Filter by topic or language, search for a word, and tap a card to edit it. A few minutes a day is enough to keep new words fresh.',

  'tips.flip.title': 'Use flip view',
  'tips.flip.summary': 'Switch Cards from List to Flip to test yourself one card at a time.',
  'tips.flip.details':
    'In Cards, tap Flip at the top. You see one card at a time: say the answer in your head, then tap the card to reveal the translation, and swipe up for the next one. Shuffle mixes the order.',

  'tips.chatQuiz.title': 'Practise {practice} even when you write in {native}',
  'tips.chatQuiz.summary':
    'Sometimes you write in {native}, because you’re unsure of the {practice} or you’re in a hurry. A quick chat quiz turns that message into {practice} practice.',
  'tips.chatQuiz.details':
    'Right after you send, the quiz asks you to fill in a gap or put the {practice} translation of what you wrote in order. It takes a few seconds and keeps your focus on the {practice}, so the translation sticks either way. Every quiz also earns XP.',
  'tips.chatQuiz.now.always': 'Right now: every message',
  'tips.chatQuiz.now.every': 'Right now: 1 in every {n} messages',
  'tips.chatQuiz.now.off': 'Right now: off',
  'tips.chatQuiz.nudge': 'More often means more practice. Try 1 in 3 or every message.',
  'tips.chatQuiz.tryNow': 'Try it now',
  'tips.chatQuiz.tryNote': 'Your next message in {native} will get a quiz.',
  'tips.quiz.title': 'Take a practice quiz',
  'tips.quiz.summary':
    'A suggested session mixes the words you’re due to review with ones from recent chats.',
  'tips.quiz.details':
    'Practice builds quizzes from your own flashcards and the words you’ve seen in your conversations, so you study the language you actually use. The suggested session picks what’s due for review, and every answer helps schedule what comes back next.',

  'tips.customQuiz.title': 'Build your own quiz',
  'tips.customQuiz.summary':
    'Pick what to practice, how long, and which topics in a custom session.',
  'tips.customQuiz.details':
    'Choose Custom session in Practice. Tell it what you want to work on in your own words, or pick a quick option such as words you struggle with or cards from this week. Then set the length, and open Advanced for topics and archived cards.',
  'tips.customQuiz.example':
    'Try “ordering food at a restaurant” or “verbs I keep getting wrong”.',
  'chatList.imagePreview': '\u{1F4F7} Image',
  // VID-RENDER-2 (docs/specs/video-messages.md) — chat-list preview labels.
  'chatList.imagePreviewCaption': '\u{1F4F7} {caption}',
  'chatList.videoPreview': '\u{1F3A5} Video',
  'chatList.videoPreviewCaption': '\u{1F3A5} {caption}',
  // VID-RENDER-2 — batches, and photos + videos in one message.
  'chatList.imagesPreview': '\u{1F4F7} {count} images',
  'chatList.videosPreview': '\u{1F3A5} {count} videos',
  'chatList.mixedPreview': '\u{1F5BC}\u{FE0F} {count} photos & videos',
  'chatList.mixedPreviewCaption': '\u{1F5BC}\u{FE0F} {caption}',

  // ── chat screen ────────────────────────────────────────────────────
  'chat.composerPlaceholder': 'Type a message…',
  'chat.composerPlaceholderOne': 'Type in {language}…',
  'chat.composerPlaceholderBoth': 'Type in {native} or {practice}…',
  'chat.header.learningLanguage': 'Learning {language}',
  'chat.header.memberCount': '{count} member',
  'chat.header.memberCountPlural': '{count} members',
  'chat.header.chatInfo': 'Chat info',

  // ── chat message list — loaders, pagination edges, scroll chips ─────
  'chat.messageList.loadingOlder': 'Loading older messages…',
  'chat.messageList.loadingOlderOffline':
    'Waiting for connection — older messages will load when online',
  'chat.messageList.historyStart': 'This is the beginning of the conversation',
  'chat.messageList.loadingNewer': 'Loading newer messages…',
  'chat.messageList.atLatest': 'You’ve reached the latest messages',
  'chat.messageList.returnToChat': 'Return to chat',
  'chat.messageList.scrollToLatest': 'Scroll to latest',
  'chat.messageList.scrollToNew': 'Scroll to new message',

  // ── language picker (bottom-sheet) ─────────────────────────────────
  'languagePicker.title': 'Choose language',
  'languagePicker.searchPlaceholder': 'Search languages…',
  'languagePicker.recent': 'Recent',
  'languagePicker.noMatches': 'No languages match "{query}"',
  'languagePicker.speechNotSupported': 'Speech not supported',
  // LANG-LEARNWITH-11 — the constrained picker's two groups.
  'languagePicker.freeHere': 'Free in this chat',
  'languagePicker.withPlus': 'With Wurld Plus',
  'languagePicker.plusNotice': 'Learn {practice} here instead',
  'languagePicker.plusNoticeAny': 'Use any language with Wurld Plus',
  'languagePicker.plusNoticeHint': 'Get Wurld Plus to learn any of these',
  'languagePicker.noTranslation': 'No translation',
  'languagePicker.noTranslationHint': 'Just {native}',
  'languagePicker.plusMark': 'Wurld Plus',
  'languagePicker.yourLanguage': 'Your language',
  // LANG-LEARNWITH-10 — the free practice row before a pick.
  'chatInfo.practicePick': 'Pick a language to learn',
  'chatInfo.practicePickHint': '{language}, included in {name}’s Plus',
  // LANG-GATE-8 — what replaces the composer when a chat cannot accept
  // messages. The reassurance comes FIRST in the body because the panel
  // appears where a text box used to be, and the reflexive reading of that is
  // "my chat is gone".
  'chatPaused.title': 'This chat is paused',
  'chatPaused.nothingLost': 'Every message is still here.',
  // Two variants because "any member" reads oddly about two people, and
  // because the point being made — one subscription covers the room — is the
  // whole offer and has to land in both shapes.
  'chatPaused.bodyDirect': 'Either of you on Plus reopens it.',
  'chatPaused.bodyGroup': 'Any one member on Plus reopens it — for everyone.',
  'chatPaused.tutorTitle': 'Your tutor is part of Plus',
  'chatPaused.tutorBody': 'This chat stays exactly where it is, and so does everything you’ve practised.',
  'chatPaused.seePlus': 'See Plus',
  // LANG-FREE-1 — the PASSTHROUGH chat's offer. Not a wall: the composer is
  // alive underneath this, so the copy has to describe a limit rather than a
  // stoppage. It never says "paused" and never reassures about lost messages —
  // nothing is paused and nothing is lost, and saying so would tell a user
  // whose chat works fine that it has broken.
  //
  // Same two variants as the paused panel, and for the same load-bearing
  // reason: one Plus covers the whole room, and copy implying otherwise
  // misprices the product in the reader's head.
  // ⚠ REWORDED 2026-09-22 (owner). Was *"Either of you on Plus turns it on."*
  // The pricing claim is unchanged and still load-bearing — "at least one"
  // says a single subscription covers the room, which is what stops a reader
  // pricing Plus at N× and not coming back — but the remedy is now named as
  // an ACTION the reader can take rather than a state of affairs they might
  // find themselves in.
  //
  // ⚠ The owner's note retyped the first sentence with a slip ("messages have
  // aren't translated"); the original wording is kept. "here" is load-bearing:
  // it scopes the fact to THIS chat, and the same member's other chats may
  // translate perfectly well.
  //
  // ⚠ `chatPassthrough.bodyGroup` below is now IDENTICAL (owner, 2026-09-22),
  // so the two carry the same pricing claim in the same words.
  // LANG-FREE-1.2 — the card's title; the bodies below are its second line.
  'chatPassthrough.title': 'Messages here aren’t translated',
  'chatPassthrough.bodyDirect':
    'At least one person needs to upgrade to Wurld Plus.',
  // ⚠ IDENTICAL to `bodyDirect` as of 2026-09-22 (owner: *"just make it the
  // same as the direct messaging"*). Kept as two keys rather than collapsed to
  // one: the call site already branches on `isGroup`, the 80 generated locales
  // each carry both, and the two have diverged before and may again. "At least
  // one person" carries the pricing claim in both shapes — one subscription
  // covers the room — which is the only thing these two were ever required to
  // agree on.
  'chatPassthrough.bodyGroup':
    'At least one person needs to upgrade to Wurld Plus.',
  'chatPassthrough.plusRow': 'Turn on translation with Wurld Plus',
  'chatPassthrough.plusRowHint': 'One person upgrading turns it on for everyone here',

  // ── LANG-FREE-13/14 — creating a chat with nobody on Plus ─────────────
  //
  // The fork that replaces the retired LANG-TIER-2 wall. Owner, 2026-09-21:
  // *"after selecting [members], if there is no plus member in the group, take
  // them to a screen that says translation features are not available until at
  // least one person in the group upgrades to plus ... then say 'Or stay on
  // Free and choose a common language for all members.' and show just the
  // native picker."*
  //
  // ⚠ It is an OFFER, never a refusal (LANG-FREE-8). The old screen said
  // "Groups need one member on Plus", which was not true — a group with nobody
  // on Plus works, it just does not translate. Copy that overstates a limit is
  // the LANG-TIER-1.1 failure: a reader who checks one claim and finds it
  // false stops believing the rest.
  'freeChat.title': 'Nobody here has Plus yet',
  // ⚠ Present tense and a LIVE condition, not a past event: translation starts
  // the moment anybody here is entitled, which is why it is worth saying who
  // that can be. "One covers the whole chat" is the same claim
  // `chatPassthrough.bodyGroup` makes one screen away — they must agree, or a
  // reader prices Plus at N× and does not come back.
  'freeChat.bodyGroup': 'So messages won’t be translated. Choose one language for everyone to write in, or get Plus and everyone can learn with you.',
  'freeChat.bodyDirect': 'So messages won’t be translated. Choose one language for you both to write in, or get Plus and they can learn with you.',
  // The second road. The owner's words, kept: this is the sentence that makes
  // the screen a fork rather than a wall.
  'freeChat.orStayFreeGroup': 'Or stay on Free and choose a common language for all members.',
  'freeChat.orStayFreeDirect': 'Or stay on Free and choose a common language for both of you.',
  // ⚠ ONE picker, and the practice language is ABSENT rather than disabled
  // (LANG-FREE-13). There is no practice language in a room that does not
  // translate; offering a setting with no effect is worse than not offering
  // it. This is not LANG-TX-5 reversed — see LANG-FREE-15 for why the two
  // states differ.
  'freeChat.languageHeading': 'Everyone types in',
  'freeChat.languageHint': 'Messages are delivered as typed, so everyone needs to use the same language.',
  'freeChat.create': 'Create group',
  'freeChat.startChat': 'Start chat',

  // ── LANG-FREE-14 — the same language, seen from chat info ─────────────
  //
  // ⚠ Every member SEES it; only the admin may CHANGE it. Hiding it from
  // non-admins would leave the room looking unconfigured for everybody who
  // cannot change it, and this row is the fact that explains what they are
  // reading.
  'chatInfo.commonLanguageLabel': 'Chat language',
  'chatInfo.commonLanguageAdminHint': 'You choose this for the whole chat.',
  'chatInfo.commonLanguageLockedHint': 'Only an admin can change this.',
  // ⚠ The confirm is a CONTRACT, the same argument ADMIN-PLAN-2 makes about
  // the trial: the change lands on people who are not looking at the screen.
  // An admin switching the room to Polish has just changed what every other
  // member reads, and before it happens is the only moment that can be said.
  'chatInfo.commonLanguageConfirmTitle': 'Change the language for everyone?',
  'chatInfo.commonLanguageConfirmBody': 'Nobody here is on Plus, so this chat carries one language and everyone types in it. Switching to {language} changes it for every member, not just you.',
  'chatInfo.commonLanguageConfirmCta': 'Change for everyone',
  // ── LANG-LEARNWITH — the bar above the composer (language-tiers.md §3c) ──
  // The verb is always "learn". Never "premium", "unavailable", "paid for",
  // "basic plan" or "language pair" on this surface (LANG-LEARNWITH-4).
  'learnWith.title': 'Learn a language in this chat',
  'learnWith.explainOne': '{name} has Wurld Plus, so you can learn their languages here for free.',
  'learnWith.explainMany': '{count} people here have Wurld Plus, so you can learn their languages for free.',
  'learnWith.howLink': 'How this works',
  'learnWith.option': 'Learn {language} with {name}',
  'learnWith.optionMany': 'Learn {language} with {name} and {count} others',
  'learnWith.included': 'Included in {name}’s Plus',
  'learnWith.includedMany': 'Included in their Plus',
  // LANG-LEARNWITH-10 — chat info, after the holders' stacked photos (owner,
  // 2026-10-26: "their" only reads under a line that names them).
  'learnWith.includedMembers': 'Included in {count} members’ Plus',
  'learnWith.start': 'Start',
  'learnWith.pickGroup': 'Pick a language to learn',
  'learnWith.fold': 'Hide',
  'learnWith.plusOption': 'Learn {practice} here instead',
  'learnWith.plusOptionHint': 'Your language · Wurld Plus',
  'learnWith.plusGroupLabel': 'With Wurld Plus',
  'learnWith.plusGroupOption': '{practice}, or any of {count} languages',
  'learnWith.plusGroupOptionAny': 'Any of {count} languages',
  'learnWith.plusGroupHint': 'Your choice, in every chat',
  // LANG-LEARNWITH-8 — the room already offers their practice language, so
  // the row sells what else Plus brings. Only perks the Plus sheet lists.
  'learnWith.plusMore': 'Learn more effectively',
  'learnWith.plusMoreHint': 'Any of {count} languages, a tutor, practice sessions and more',
  'learnWith.plusGroupMoreHint': 'Plus a tutor, practice sessions and more',
  'learnWith.howTitle': 'How languages work on Free',
  // LANG-LEARNWITH-9 — two sections, Wurld Free then Wurld Plus (owner,
  // 2026-10-26). "Every chat" and "Nobody has Plus" are merged.
  'learnWith.howFreeTitle': 'Wurld Free',
  'learnWith.howFreeNeedsPlus': 'Translation needs at least one person in the chat to have Wurld Plus.',
  'learnWith.howFreeLearnSame': 'Each Plus member sets their two languages for the chat. Whatever they pick is also free for everyone else in it.',
  'learnWith.howHereOne': 'In this chat, {name} translates between {languages}, so both are free for you.',
  'learnWith.howHereOneSame': 'In this chat, {name} uses {language}, so it’s free for you.',
  'learnWith.howHereMany': 'In this group, {count} Plus members have picked {languages}, so all of these are free for you.',
  'learnWith.howHereMore': '{count} more',
  'learnWith.howHereNobody': 'Nobody in this chat has Plus. If you upgrade, {practice} (or any language you pick) is turned on for everyone here.',
  'learnWith.howHereNobodyAny': 'Nobody in this chat has Plus. If you upgrade, any language you pick is turned on for everyone here.',
  'learnWith.howFreeGroupChoice': 'In a group with more than one person on Plus, you may get to choose from several languages.',
  'learnWith.howFreeNobody': 'If nobody in the chat has Plus, messages arrive as they’re written.',
  'learnWith.howPlusTitle': 'Wurld Plus',
  'learnWith.howPlusNoLimits': 'No restrictions: learn {practice}, or any of {count} languages, in every chat.',
  'learnWith.howPlusNoLimitsAny': 'No restrictions: learn any of {count} languages, in every chat.',
  'learnWith.howPlusWithYou': 'Everyone you talk to can learn with you.',
  'learnWith.howFooter': 'Wurld has no ads and never sells your data, so Plus is what pays for translation.',
  'learnWith.howSeeAllPlus': 'See all Wurld Plus features',
  'learnWith.howSeeAllPlusDetail': 'All {count} languages, a tutor, practice sessions and more',
  'learnWith.howGotIt': 'Got it',

  // LANG-LEARNWITH-21 — first open of a chat that does not carry your language.
  // `{languages}` is the room's languages as a list; `{language}` is yours.
  'nativeMissing.title': 'You may not understand this chat',
  'nativeMissing.moreLanguages': '{count} more languages',
  'nativeMissing.body': 'Messages here are in {languages}, and {language} isn’t one of them.',
  'nativeMissing.bodyUnfunded': 'Everyone here writes in {languages}, and nobody has Plus to translate it into {language}.',
  // "Switch", not "add": someone else has to compromise (owner, 2026-10-23).
  // `{name}` is a first name.
  'nativeMissing.askDirect': 'Ask {name} to switch language',
  'nativeMissing.askGroup': 'Ask someone to switch language',
  'nativeMissing.asked': 'Asked',
  'nativeMissing.plusRow': 'Read every chat in {language}',
  'nativeMissing.notNow': 'Not now',
  // LANG-LEARNWITH-26/27/28 — chat info's settings-style rows. The missing
  // line reads "No English here · Upgrade or ask Tom to switch": the two
  // actions are separate links and "or" is plain text between them.
  'nativeMissing.speakLabel': 'I speak',
  'nativeMissing.learningLabel': 'I’m learning',
  'nativeMissing.noneHere': 'No {language} here',
  'nativeMissing.upgrade': 'Upgrade',
  'nativeMissing.or': 'or',
  'nativeMissing.askSwitchDirect': 'ask {name} to switch',
  'nativeMissing.askSwitchGroup': 'ask someone to switch',
  'nativeMissing.askedDirect': 'Asked {name}',
  'nativeMissing.variantNote': 'This chat uses {variant}.',

  // LANG-LEARNWITH-24/25 — the request, as each member reads it.
  'languageRequest.mine': 'You asked the group to switch to {language}.',
  'languageRequest.mineDirect': 'You asked {name} to switch to {language}.',
  'languageRequest.other': '{name} doesn’t speak any of the languages in this chat, and asked if you could switch to {language}.',
  // LANG-LEARNWITH-28 — a request for the member's learning language.
  'languageRequest.otherPractice': '{name} is learning {language}, and asked if you could switch to it.',
  'languageRequest.resolved': '{language} is now in this chat.',
  'languageRequest.someone': 'Someone',
  'languageRequest.openSettings': 'Open language settings',
  'languageRequest.changeCommon': 'Change chat language',

  // The free-chat fork screen's offer (LANG-SET-6.3). The key outlived the
  // override dialogue it was written for (retired by LANG-LEARNWITH-14); kept
  // under its old name so the 80 generated locales stay valid.
  // ⚠ `{total}` is `SUPPORTED_LANGUAGES.length`, never typed in.
  'languageOverride.upgradeCta': 'Unlock all {total} languages',
  // The passthrough offer's dismiss control (PausedComposer). Same story.
  'languageOverrideStrip.dismiss': 'Dismiss',
  // The upgrade sheet. Framed around what a chat can CARRY rather than around
  // a feature list, because the constraint the user actually meets is "the
  // language I want isn’t in this room".
  'plus.title': 'Wurld Plus',
  // Owner's words, 2026-09-22. No full stop: it is a slogan, not a sentence.
  // LANG-LEARNWITH-15 — one vocabulary for the whole rule (2026-10-23).
  'plus.tagline': 'Learn your language in every chat',

  // ── TWO SECTIONS, 2026-09-22 (owner) ──────────────────────────────────────
  //
  // The sheet was three boxes, then one flat list whose TIER was carried by a
  // Check/Sparkles bullet, and is now TWO SECTIONS: a Free block and a Plus
  // block. Owner: *"Two sections instead of one list"*, the Plus one reading
  // *"all of free, plus…"*, with the stated goal *"to make the page
  // prettier"*.
  //
  // ⚠ The tier is carried by the BLOCK now rather than by the bullet, and that
  // is what frees each row's icon to say what the FEATURE is (the mapping
  // lives in `PlusSheet.tsx`). A reader still tells the two apart without
  // reading them: the Plus block is accent-bordered, accent-tinted, and its
  // row icons are in the accent colour.
  //
  // ⚠ **LANG-TIER-1.1 owns what may sit on each half**, and both halves must
  // match the table in `docs/specs/language-tiers.md` §4. A sheet that sells a
  // feature the reader already has for free is worse than a shorter sheet —
  // and a gate the sheet never mentions is the same failure from the other
  // side.
  //
  // ⚠ `{count}` is `SUPPORTED_LANGUAGES.length`. The owner typed "85"; it is
  // interpolated here by their own standing rule — 85 is true today, and it is
  // the kind of true that rots inside the one sentence asking somebody to pay.

  // The two section headings. `plus.sectionPlus` is the owner's own words —
  // *"all of free, plus…"* — set in sentence case so the noun reads as the
  // TIER's name and not as an adjective.
  'plus.sectionFree': 'Free',
  'plus.sectionPlus': 'All of Free, plus…',

  // ── HEADING + EXPLAINER PER ROW, 2026-09-23 (owner) ───────────────────────
  //
  // Every row is now two strings: a heading that says what the feature IS, and
  // one short line under it. Owner's brief, verbatim: *"the headings are
  // written to be snappy and catchy rather than actually informative about
  // what the feature gives you. Someone only reading the headings would not
  // understand what they're paying for or what they're getting in free."*
  //
  // ⚠ So a heading here is a DESCRIPTION, not a slogan. "Chat with a virtual
  // tutor" over "A tutor at 3am"; "Help for each message" over "Ask why, not
  // just what". The one place that rule costs something is scanning appeal,
  // and the owner took that trade explicitly.
  //
  // ⚠ **The explainer must not restate the heading.** That was the failure of
  // the list this replaces — five rows in a row all saying "languages", which
  // the owner read as *"trying to sell the same thing 5 times"*. Each line
  // adds a fact the heading does not carry.
  //
  // ⚠ The FREE list is four rows to Plus's six, deliberately. Free's rows are
  // each a different KIND of thing, so the shorter list does not read as a
  // thinner product — and LANG-TIER-1.1 still requires every gated surface to
  // appear on the Plus side.

  // ⚠ The CONDITION is in the heading, not walked back by the body. The list
  // this replaces said "Unlimited translations, typing corrections, hint
  // words" two rows below "no translation features available", which a reader
  // cannot reconcile — so they stop believing both. LANG-FREE-8's "must name
  // the condition" is satisfied by the heading itself.
  //
  // ⚠ **"Plus" is CAPITALISED** — it is the product's name, every other string
  // in this file sets it that way, and `PlusSheet.test.tsx` matches `/\bPlus\b/`
  // case-sensitively as the proof the condition was named at all.
  //
  // ⚠ The parenthetical is `LANG-SET-4` stated plainly: a free member's pair is
  // bound to the chat's set, so what they get is the PLUS MEMBER'S pair, not a
  // free choice of their own. It used to live in its own row
  // (`plus.itemFreeToPlus`, now retired) where it read as a restriction; here
  // it is the small print on a gift, which is what it actually is.
  //
  // ⚠ **ONE STRING LITERAL, NEVER CONCATENATED.** `generate-locales.mjs`
  // loose-parses this file as JSON (`loadEnglish`), so `'a' + 'b'` is a syntax
  // error there and `npm run i18n:regen` dies before it touches a single
  // locale — which is how this line was first written, on 2026-09-23. It fails
  // loudly and early, but only when somebody runs the regen, so the rule is
  // worth stating where the temptation is: long values stay long.
  'plus.itemTranslations': 'Learn with friends on Plus',
  'plus.itemTranslationsBody': 'In a chat with someone on Plus, learn any language they use, free.',

  'plus.itemCards': 'Save words to flashcards',
  // ⚠ Names the deck explicitly — owner: *"Save what you meet is too vague. I
  // want to explicitly mention flashcards."* LANG-TIER-1.1 draws its line
  // between the CARD (free) and the SESSION (Plus), and a reader can only see
  // that line if both surfaces are named where they sit.
  'plus.itemCardsBody': 'Keep any word and revise it later.',

  // ⚠ **A FACT ABOUT THE ROOM, NEVER A REFUSAL** — the rule LANG-SET-6 and
  // LANG-FREE-8 both make about this exact moment. The old line led with the
  // absence ("no translation features available") in schematic notation; this
  // one names the situation in the heading and the consequence in the body,
  // and the body names the way out in the same breath.
  //
  // ⚠ "↔" is gone with it. The relation was set properly, but a notation the
  // reader has to decode is not copy.
  // ⚠ **MERGED and MOVED TO THE TOP, 2026-09-23 (owner).** This was the LAST
  // free row and `plus.itemMessaging` was the first; they are one row now.
  // Unlimited messaging and "nothing is translated here" are two facts about
  // the same chat, and splitting them put the good news three rows away from
  // the condition it belongs to.
  //
  // ⚠ It leads the section, which reverses the earlier rule that the only
  // non-gain went last. It can, because it is no longer a non-gain: the
  // heading says what these chats ARE ("normal"), the body gives the unlimited
  // part first and names the exit second. A reader meets the limit inside a
  // sentence that is mostly about what works.
  'plus.itemFreeToFree': 'Chat with anyone, in your language',
  'plus.itemFreeToFreeBody': 'Unlimited messages and groups.',
  // LANG-LEARNWITH-15 — owner's wording, 2026-10-24.
  'plus.itemNoAds': 'No ads',
  'plus.itemNoAdsBody': 'We never sell your data.',
  'plus.supportWurld': 'Help support Wurld',
  'plus.supportWurldBody':
    'We’re committed to giving everyone a great learning experience even on Free. Please consider upgrading if you can to support our effort.',

  // ⚠ `{count}` stays interpolated. The owner typed "85"; it is 85 today and
  // it is the kind of true that rots inside the one sentence asking somebody
  // to pay (LANG-SET-6.1).
  //
  // ⚠ The body sells the PER-CHAT part rather than repeating the number —
  // owner: *"instead of saying swapped as often as you change your mind, let's
  // say something about being able to have a different language for each chat
  // so you can practice multiple."* That is the thing the count alone does not
  // tell you, and it is the only row that describes how the languages are used
  // rather than how many there are.
  // ⚠ "All", at the owner's instruction 2026-09-23. The bare count reads as a
  // quantity; "all" reads as the whole catalogue being handed over, which is
  // what is actually being sold. It does echo `plus.sectionPlus` ("All of
  // Free, plus…") two lines above — accepted, because the echo lands on the
  // word doing the work in both.
  'plus.itemAllLanguages': 'Your language in every chat',
  'plus.itemAllLanguagesBody':
    'Choose from {count} languages, and a different one per chat if you like.',

  // ⚠ **The load-bearing PRICING claim**: one subscription covers everybody in
  // the chat. If this sheet implies each person needs their own, the reader
  // prices Plus at N× and does not come back to check (`PlusSheet.test.tsx`
  // states this as claim 2 of 3).
  //
  // ⚠ Worded as INCLUSION, not charity. The draft said *"Someone else's Plus
  // covers you"*, which the owner read as freeloading; this says the same
  // mechanic from the paying side, where it is a thing you give rather than a
  // thing they take. Its Free-side mirror is `plus.itemTranslations`.
  'plus.itemCoversFree': 'Friends learn with you for free',
  'plus.itemCoversFreeBody': 'Anyone you chat with can learn your languages without paying.',

  // ⚠ "Explain" survives as a VERB. Owner: *"you don't actually need to say
  // tap explain, just say hold a message"* — so the body names the GESTURE and
  // the payload, not the button. The word still has to appear somewhere on
  // this row: LANG-TIER-1.1 gates Explain, and a gate the sheet never names is
  // a reader meeting a wall the list told them nothing about.
  'plus.itemExplain': 'Help for each message',
  'plus.itemExplainBody':
    'Hold down a message to explain the grammar, the word choices and the meaning.',

  // ⚠ "VIRTUAL", at the owner's instruction: *"probably has to say virtual
  // tutor or misrepresenting"*. It is an LLM, and "your own language tutor"
  // reads as a person on the other end.
  // QUIZ-GATE-1 / LANG-TIER-1.1 (2026-10-24) — the heading names WHERE it
  // happens, the body says what it asks and how often.
  'plus.itemChatQuiz': 'Quick quizzes in your chats',
  'plus.itemChatQuizBody': 'Now and then, a quick question on a message you’ve just sent, in the language you’re learning.',

  'plus.itemTutor': 'Chat with a virtual tutor',
  'plus.itemTutorBody': 'Practise whenever you want, in the language you’re learning.',

  // ⚠ RESTORED 2026-09-22 after the owner reviewed the omission: practice
  // sessions ARE gated, so LANG-TIER-1.1 requires the sheet to say so — a
  // reader who meets a gate this list never mentioned stops believing the rest
  // of it. Worded as the SESSION, never the card: the deck is free
  // (`plus.itemCards` above) and selling it here is the contradiction 1.1
  // names.
  // ⚠ The body says "the words you've saved" rather than "your flashcards",
  // and that is a rule rather than a synonym. LANG-TIER-1.1 puts the DECK on
  // the free side and the SESSION on the paid one, so the word "flashcards"
  // appearing in the Plus block is exactly the contradiction the table
  // forbids — `PlusSheet.test.tsx` asserts the Plus section never says it.
  'plus.itemPractice': 'Tailor-made practice sessions',
  'plus.itemPracticeBody':
    'From the words you’ve saved and your recent chats, timed so things stick.',
  // ⚠ Group chats are FREE now — LANG-TIER-2's wall was retired — so these
  // lines are NOT "groups need Plus". What Plus buys INSIDE a group is the
  // language freedom, and it takes two rows because the two halves are about
  // different people.
  //
  // ⚠⚠ **CORRECTED 2026-09-22 — the old single line was FALSE.** It read *"In
  // group chats, one Plus lets everyone read along in their own language"*.
  // `LANG-SET-4` binds a free member's reading AND practice language to the
  // chat's language set, and `LANG-SET-1` builds that set from the entitled
  // members' own pairs — so what the room reads along in is the SUBSCRIBER'S
  // SET. "Their own language" would require every free member to pick freely
  // from all {count}, which is exactly the thing Plus is being sold for.
  //
  // Owner's replacement, verbatim: *"Read group chats in any language +
  // anyone else can read along in your language set"*. First row is
  // `LANG-SET-3` (a subscribed member is never constrained by the set); second
  // is `LANG-SET-4` seen from the other end.
  //
  // ⚠ The KEY is REUSED rather than renamed, deliberately. Deleting a key from
  // this file fails `tsc` in all 80 locale files at once — they type as
  // `Partial<Messages>`, so a key this file no longer declares is an excess
  // property. Changing the VALUE is the supported path: the `__sourceHashes`
  // entry stops matching, so `npm run i18n:regen` retranslates it. Until that
  // regen runs, non-English readers see the OLD translated sentence here.
  // ⚠ Now ONE row — a heading and its explainer — where it used to be two. The
  // two-row version said the same thing twice from either end, which is what
  // the owner read as repetition.
  //
  // ⚠ **The claim is still the corrected one.** It does NOT say everyone reads
  // in their own language: `LANG-SET-4` binds a free member's pair to the
  // chat's set and `LANG-SET-1` builds that set from the ENTITLED members'
  // pairs, so what the room reads along in is the subscriber's set. "Everyone
  // else can select your chosen language" is that, said from the room's side.
  //
  // ⚠ "Room" is gone. Owner: *"when you say read the whole room, I wouldn't
  // really know what the room means."* It is this codebase's word for a chat,
  // not a reader's.
  'plus.seePlus': 'See Plus',

  // LANG-SET-6.3 — the SECOND LINE of every upgrade CTA in the product, and it
  // belongs to `PlusCta` rather than to any caller. (Added 2026-09-21. Owner:
  // *"I like the shared key. Use a style like that for all modals."*)
  //
  // ⚠ It names the PRODUCT so the first line does not have to. That is what
  // lets a surface say "Unlock all {total} languages" or "Unlock the tutor"
  // without dropping the word Plus — which is exactly what went wrong when the
  // label was the only line: worded as dictated, the sheet asked for {price} a
  // month and never said what it sold (LANG-SET-6.1 bans the alternatives
  // because they are false for a trialist).
  //
  // ⚠ `{price}` is `PLUS_PRICE`. One literal here now goes stale on every
  // surface at once, which is why the test reads the source string.
  /** BILL-MANAGE-5 — the product name alone, shown in a store build until the store prices it. */
  'plus.ctaName': 'Wurld Plus',
  'plus.ctaPeriod': 'Wurld Plus · {price} /month',
  // The FIRST line where the gate is not about languages — the tutor, Explain,
  // practice sessions. `LANG-TIER-1.1` is a table, not a sentence, so those
  // surfaces cannot borrow the language copy: "Unlock all 85 languages" on the
  // practice gate is a true statement about Plus and a false description of
  // what the reader just hit.
  //
  // "Unlock", never "Buy"/"Subscribe" (LANG-SET-6.3). Since BILL-MANAGE-5 it
  // is also the first line of `PlusSheet`'s real purchase button.
  'plus.ctaUnlock': 'Unlock everything in Plus',
  'plus.close': 'Got it',
  // BILL-MANAGE-1/2/5 — the purchase half of `PlusSheet` (billing.md). The
  // button's lines are `plus.ctaUnlock` + `plus.ctaPeriod` (LANG-SET-6.3's
  // "Unlock" verb and the product + price + period, with the STORE's price).
  // (`plus.comingSoon`, "not on sale yet", is deleted — audit DEAD-22.)
  'plus.priceLoading': 'Checking the price…',
  'plus.purchaseWorking': 'One moment…',
  // Auto-renew disclosure next to the button (App Store 3.1.2).
  'plus.renewalTerms': 'Renews monthly until you cancel. Cancel anytime.',
  // BILL-MANAGE-7.2 — web only, and only when the visitor pays in US dollars
  // (tax-exclusive). Pounds and euros already include VAT, so they get no note.
  'plus.salesTaxNote': 'Sales tax is added at checkout where it applies.',
  'plus.termsLink': 'Terms',
  'plus.privacyLink': 'Privacy',
  // The dismiss, once the sheet carries a purchase: "Got it" beside a buy
  // button reads as agreeing to it.
  'plus.notNow': 'Not now',
  // BILL-MANAGE-2 — shown INSTEAD of the button to anyone already on Plus.
  'plus.hasPlus': 'You have Wurld Plus.',
  'plus.statusPurchased': 'You’re on Plus — enjoy every language.',
  'plus.statusRedirecting': 'Taking you to checkout…',
  'plus.statusPending': 'Your purchase is waiting for approval. Plus switches on as soon as it goes through.',
  'plus.statusAlreadyEntitled': 'You already have Plus through another subscription, so there’s nothing to buy here.',
  'plus.statusWrongAccount': 'This store subscription belongs to a different Wurld account.',
  'plus.statusUnconfirmed': 'Your purchase went through, but we couldn’t switch Plus on yet. It should catch up shortly.',
  'plus.statusFailed': 'The purchase didn’t go through. Please try again.',
  'plus.statusUnavailable': 'Purchases aren’t available on this device right now.',
  // LANG-TRIAL-5 — the trial notice. One sheet, two modes; it differs only in
  // its headline and its action.
  //
  // ⚠ The point of this sheet is HONESTY, not conversion. Automatic enrolment
  // without a notice is a countdown the user cannot see, which surfaces a day
  // later as an app that mysteriously stopped working. So it has to say three
  // things: how long, what happens after, and what Plus costs. `{duration}` is
  // interpolated from TRIAL_DURATION_MS (LANG-TRIAL-3) — never hard-coded, or
  // changing the policy silently makes this copy a lie.
  'trial.titleAutomatic': 'You’re on Wurld Plus',
  'trial.bodyAutomatic': 'You’ve got {duration} of everything, free. Nothing to set up and nothing to cancel.',
  'trial.titleOffer': 'Try Wurld Plus, free',
  'trial.bodyOffer': 'Take {duration} of everything, free. Nothing to set up and nothing to cancel.',
  'trial.whatYouGet': '{practice} in every chat, the virtual tutor, Explain and practice sessions.',
  'trial.afterHeading': 'When it ends',
  // ⚠ Names the price as a FACT. There is no purchase path in this build
  // (LANG-SEC-3), so nothing here may read as a call to buy — a test asserts
  // no BUTTON ever carries the price.
  'trial.afterBody': 'You move to the free plan and keep chatting — or keep everything for {price} a month.',
  // LANG-SET-6.1's rule applied to the trial sheet: name the SOURCE of a
  // chat's languages rather than gesturing at them. "The languages already in
  // your rooms" is the same vagueness the owner reported on the picker
  // (2026-09-21) — it describes where they are, never where they come from,
  // so a reader cannot tell what would change the answer.
  // Stands in for {native}/{practice} while the profile has not loaded.
  'trial.yourLanguage': 'your language',
  'trial.afterFreeNote': 'Every chat shows in {native}, and you can still learn with friends who have Plus.',
  'trial.notOnSale': 'Plus isn’t on sale yet — we’ll tell you the moment it is.',
  'trial.ctaAcknowledge': 'Got it',
  'trial.ctaStart': 'Start my free trial',
  // LANG-TRIAL-10 — the other end of the same trial. LANG-TRIAL-5's sheet says
  // it started; nothing said it would end, and an app that quietly stops
  // translating is remembered as an app that broke.
  //
  // ⚠ It describes a CHANGE, not a punishment. LANG-TIER-1 keeps the whole
  // experience on free in the languages already in the room, so a notice
  // listing only losses misdescribes the product it is dropping the user into —
  // and what CONTINUES is deliberately said first.
  'trialEnded.title': 'Your free trial has ended',
  'trialEnded.body': 'Your chats now show in {native}. Here’s what’s still free:',
  'trialEnded.keepsHeading': 'You keep',
  // LANG-SET-6.1 — same substitution as the other two free-tier lines: the
  // languages come from the chat's Plus members, which is a fact the reader
  // can act on, where "already in your rooms" is one they cannot.
  'trialEnded.keepsBody':
    'Learn with friends on Plus: in any chat with someone on Plus, learn a language they use. Every chat and group, and your flashcards.',
  'trialEnded.lostHeading': 'Plus adds back',
  'trialEnded.lostBody':
    '{practice} in every chat, the virtual tutor, Explain and practice sessions.',
  // LANG-LEARNWITH-15 — the same no-ads fact the Plus sheet states, in the
  // present tense only: a promise about the future is not ours to make here.
  'trialEnded.noAds': 'No ads on either plan. Plus is what keeps Wurld running without them.',
  'trialEnded.close': 'Got it',
  // TUTOR-NUDGE-4 — after the tutor tour, point new users at their friends.
  'friendNudge.title': 'Talking to the tutor is great — speaking to your friends is even better!',
  'friendNudge.benefitRoutine': 'It fits straight into your daily routine — no need to set time aside to learn a language.',
  'friendNudge.benefitReal': 'You pick up the vocabulary and slang you actually use in real, everyday conversations with your friends.',
  'friendNudge.cta': 'Start a real conversation',
  'friendNudge.later': 'Maybe later',
  // IMMERSE-COPY-1/2 — the chat list when the tutor chat is the only chat.
  'immersion.real': "Real chats with real people, every day. That's language immersion.",
  'immersion.tutor': 'You can also use the language assistant to ask questions at any time.',
  'immersion.friends': 'invite a friend 👋',
  'immersion.findFriends': 'Find your friends',
  // LANG-TRIAL-11 — the T-2h push. Written server-side, so it is NOT localised
  // through this file (the sweep has no locale context and FCM carries one
  // string). Kept here as the source of the English the server sends, so a copy
  // edit starts in the same place as every other.
  'trialEnded.pushTitle': 'Your Wurld trial ends soon',
  'trialEnded.pushBody':
    'About {remaining} left of Wurld Plus. After that, chats show in {native} unless a friend on Plus is learning with you.',
  // LANG-TIER-2 — the group-creation gate. Shown at the START of the flow, not
  // on the Create button: refusing somebody after they have picked six
  // contacts and named the group is the version that generates support mail.
  'createGroup.needsPlusTitle': 'Groups need one member on Plus',
  // MSG-KEY-9 — sits BESIDE a readable practice row whose vocab has not
  // arrived yet, so it must read as an addition rather than as a placeholder.
  'chat.annotating': 'adding vocab…',
  // MSG-KEY-9.8 — beneath a message whose translation is MISSING while a
  // repair (backfill) fills it; never on the send path. Lowercase + ellipsis to
  // sit in the same family as 'adding vocab…', which often follows it.
  'chat.backfillTranslating': 'translating…',
  'chat.retrying': 'Retrying…',
  // MSG-BUBBLE-11.5 — the in-bubble shimmer label (no ellipsis: the shimmer is the motion).
  'chat.bubbleTranslating': 'Translating',
  'chat.bubbleSending': 'Sending',
  'chat.translatingAria': 'Translating',
  'chat.retryingAria': 'Retrying translation',
  'chat.failedLabel': 'Failed',
  'chat.failedAriaRetry': 'Retry send',
  'chat.failedAriaCancel': 'Cancel send',
  'chat.failedAriaCombined': 'Send failed',
  'chat.translationFailedLabel': 'Translation failed',
  'chat.translationFailedAriaRetry': 'Retry translation',
  'chat.translationFailedAriaCombined': 'Translation failed',
  'chat.deletedMessage': 'message deleted',
  'chat.editedLabel': 'edited',
  'chat.attachPhoto': 'Attach photo',
  'chat.replyDismiss': 'Cancel reply',
  // VID-RENDER-2 / VID-RENDER-3 — reply-preview labels + video thumb badge.
  'chat.replyImageLabel': 'Image \u{1F4F7}',
  'chat.replyVideoLabel': 'Video \u{1F3A5}',
  'chat.replyMixedLabel': 'Photos & videos \u{1F5BC}\u{FE0F}',
  'chat.videoAria': 'Video, {duration}',
  'chat.actionsCopy': 'Copy',
  'chat.actionsReply': 'Reply',
  'chat.actionsEdit': 'Edit',
  // I18N-EDGE-6 — the long-press menu's own wording, which is NOT
  // `chat.actionsDelete`: the row says what the action reaches (everyone),
  // because it is the one message action another person can see.
  'chat.actionsDeleteForEveryone': 'Delete for everyone',
  'chat.actionsRateTranslation': 'Rate translation quality',
  // {language} is the READER's name for it — see I18N-EDGE-5. `nativeWord` /
  // `practiceWord` are the fallbacks for a message whose language is unknown,
  // which is why they are words and not names.
  'chat.actionsCopyLanguage': 'Copy {language}',
  'chat.nativeWord': 'native',
  'chat.practiceWord': 'practice',
  // The TTS button says STOP, not pause: a second tap ends playback and
  // resets, so `explain.pauseAudio` would mis-describe it.
  'chat.ttsStop': 'Stop',
  'chat.actionsDeleteConfirm': 'Delete message?',
  'chat.actionsDeleteConfirmBody':
    'This removes the message for everyone in the chat. It can\u2019t be undone.',
  'chat.actionsReadAloud': 'Read aloud',
  'chat.actionsExplainTranslation': 'Explain translation',

  // ── image review modal ─────────────────────────────────────────────
  'imageReview.captionPlaceholder': 'Add a caption (optional)',
  'imageReview.send': 'Send',

  // ── images review (multi-image) modal ──────────────────────────────
  'imagesReview.title': '{count} photos',
  'imagesReview.titleOne': '1 photo',
  'imagesReview.titleVideos': '{count} videos',
  'imagesReview.titleMixed': '{count} photos & videos',
  'imagesReview.cancel': 'Cancel',
  'imagesReview.addMore': 'Add more',
  'imagesReview.maxReached': 'You can attach up to {max} photos or videos per message.',
  'imagesReview.maxVideos': 'You can attach up to {max} videos per message.',
  'imagesReview.preparingVideos': 'Preparing videos… {percent}%',
  'imagesReview.videoFailed': 'This video can’t be sent — tap × to remove.',
  'imagesReview.removeFailed': 'Remove the items marked as failed to send.',
  'imagesReview.itemFailed': 'This image failed — tap × to remove.',
  'imagesReview.someFailed': 'Some photos couldn’t be processed.',

  // ── share target (docs/specs/share-target.md) ─────────────────────
  'share.title': 'Share to chat',
  'share.cancel': 'Cancel',
  'share.pickChat': 'Pick a chat',
  'share.noChats': 'No chats yet.',
  'share.dropped': 'Items that can’t be shared to Wurld: {count}',
  'share.receiveFailed': 'Couldn’t receive what you shared.',
  'share.receiving': 'Receiving…',

  // ── video review (docs/specs/video-messages.md) ────────────────────
  'videoReview.title': 'Send video',
  'videoReview.cancelPreparing': 'Stop',
  'videoReview.limitNotice':
    'Videos can be up to {max} seconds long. The first {max} seconds are selected — drag the bar below to choose a different part.',
  'videoReview.trimBar': 'Trim video',
  'videoReview.trimStart': 'Trim start',
  'videoReview.trimEnd': 'Trim end',
  'videoReview.trimReadout': '{start} – {end} · {length}',
  'videoReview.play': 'Play',
  'videoReview.pause': 'Pause',
  'videoReview.scrub': 'Position in the trimmed video',
  'videoReview.unsupported': 'This video can’t be sent from this device.',
  'videoReview.failed': 'Couldn’t prepare this video. Please try again.',
  'picker.chooseVideo': 'Choose video',
  'picker.choosePhotos': 'Choose photos',
  'picker.addMoreTitle': 'Add photos or videos',

  // ── contacts ───────────────────────────────────────────────────────
  'contacts.title': 'Contacts',
  'contacts.subtitle': 'People you chat with',
  'contacts.searchPlaceholder': 'Search contacts…',
  'contacts.addContact': 'Add Contact',
  'contacts.newGroup': 'Create Group',
  'contacts.syncing': 'Syncing…',
  'contacts.syncContacts': 'Sync Contacts',
  'contacts.emptyTapSync': 'No contacts yet. Tap Sync Contacts to import from this device.',
  'contacts.emptyTapAdd': 'No contacts yet. Tap Add Contact to add one manually.',
  'contacts.noMatches': 'No matches.',
  'contacts.onWurld': 'On Wurld',
  'contacts.addedToast': 'Contact added.',
  // Add-them-back affordances (banner under the chat header) — CONTACTS-RECIP-*.
  'contacts.addBackTitle': 'Add {name} to your contacts?',
  'contacts.addBackAction': 'Add',
  'contacts.addBackAdding': 'Adding…',
  'contacts.addBackDismissAria': 'Not now',
  'contacts.lookupChecking': 'Looking for {name} in your phone contacts…',
  'contacts.lookupFound': 'Found {name} in your contacts',
  'contacts.actionsEdit': 'Edit',
  // CONTACTS-INVITE-1/4/5 — address-book people who are not on Wurld.
  'contacts.inviteSectionTitle': 'Invite from your phone',
  'contacts.invite': 'Invite',
  'contacts.inviteAria': 'Invite {name} to Wurld',
  'contacts.inviteMessage': "I'm using Wurld to chat across languages. Join me: {link}",
  'contacts.inviteShowMore': 'Show more ({count} more)',
  'contacts.inviteSheetTitle': 'Invite {name} to Wurld',
  'contacts.inviteViaSms': 'Text message',
  'contacts.inviteViaWhatsApp': 'WhatsApp',
  'contacts.inviteViaOther': 'More options',
  'contacts.openingChat': 'Opening chat…',
  // CONTACTS-VIEW-* — the one contact screen (group member, Contacts list, 1:1 info).
  'contactScreen.chat': 'Chat',
  'contactScreen.delete': 'Delete',
  'contactScreen.deleteTitle': 'Delete {name}?',
  'contactScreen.deleteMessage': 'This removes them from your Wurld contacts. Your chats with them stay.',
  'contactScreen.deleteMessageDevice':
    'This removes them from your Wurld contacts and your phone contacts. Your chats with them stay.',
  'contactScreen.deletedToast': '{name} removed from your contacts.',
  'contactScreen.notFound': 'This contact is no longer in your contacts.',
  // CONTACTS-VIEW-5 — the prefilled add form saves without starting a chat.
  'addContact.saveContact': 'Save contact',
  'contacts.editTitle': 'Edit contact',
  // CONTACTS-ADD-5 — the name the VIEWER gives this person, not their own.
  'contacts.nicknameLabel': 'Nickname',
  'contacts.editSave': 'Save changes',
  'contacts.editSaving': 'Saving…',
  'contacts.editSavedToast': 'Contact updated.',
  'contacts.editPhoneWarning':
    'Changing the phone number will mark this as a different contact for app-wide search.',

  // ── group chat creation ────────────────────────────────────────────
  'createGroup.namePlaceholder': 'Group name',
  'createGroup.create': 'Create group',

  // ── chat info ──────────────────────────────────────────────────────
  'chatInfo.title': 'Chat info',
  'chatInfo.members': 'Members',
  'chatInfo.leaveGroup': 'Leave group',

  // ── settings ───────────────────────────────────────────────────────
  // LANG-TRIAL-9 — the standing row. PRESENT TENSE ONLY: a lapsed trial reads
  // 'Free', never 'expired'. The row says what the account IS; "was" belongs to
  // the one-time notice below, and a row carrying the past becomes a permanent
  // reproach on a screen people open to change their theme.
  //
  // ⚠ `{remaining}` comes from `formatTrialRemaining`, which floors at "less
  // than a minute" and never renders 0 — "0 minutes left" beside a working
  // composer is this row calling the app a liar.
  'settings.plan.title': 'Your plan',
  // SETTINGS-PLAN-1 — the plan badge. "Wurld Plus" is the product name.
  'settings.plan.badgeFree': 'Free',
  'settings.plan.badgeTrial': 'Trial',
  'settings.plan.badgePlus': 'Wurld Plus',
  'settings.plan.pro': 'Wurld Plus: your language in every chat.',
  'settings.plan.trial': 'Free trial — {remaining} left.',
  // LANG-LEARNWITH-15 — the rule in one line. Still opens with "Free", which
  // is what LANG-TRIAL-9's present-tense rule is actually about.
  'settings.plan.free': 'Free: chat in your language, and learn with friends who have Plus.',
  // BILL-MANAGE-3 — one "Manage subscription" row per live source, each with
  // a line saying who bills it. Apple/Google off their own platform say where
  // to go instead, because we cannot manage them from here (BILL-APPLE-5).
  'settings.plan.manage': 'Manage subscription',
  // BILL-MANAGE-3.2 — while the button's action runs (the Stripe portal needs
  // a server round trip before the page moves).
  'settings.plan.manageOpening': 'Opening…',
  'settings.plan.billedByApple': 'Billed by Apple.',
  'settings.plan.billedByAppleElsewhere': 'Billed by Apple — manage it on your iPhone or iPad.',
  'settings.plan.billedByGoogle': 'Billed by Google Play.',
  'settings.plan.billedByGoogleElsewhere': 'Billed by Google Play — manage it on your Android phone or in Google Play.',
  'settings.plan.billedByStripe': 'Billed by card on the web.',
  // BILL-MANAGE-3.4 / NATIVE-STORE-2 — a web (Stripe) subscriber inside the
  // iOS / Android app. Information only: no link, no price, no call to action
  // (App Store 3.1.1, Play payments policy).
  'settings.plan.managedOnWeb': 'Your plan is managed on the web.',
  // BILL-MANAGE-3.1 — under a paid row whose subscription will not renew.
  // Same sentence wurld.chat's /account uses.
  'settings.plan.endsOn': 'Ends on {date}. It won’t renew.',
  'settings.plan.manual': 'Plus was given to you — there’s nothing to manage or pay.',
  'settings.plan.manageNoCustomer': 'We couldn’t find your billing details. Contact support and we’ll sort it out.',
  'settings.plan.manageFailed': 'Couldn’t open subscription management. Please try again.',
  // BILL-APPLE-4 — iOS only (App Store Guideline 3.1.1).
  'settings.plan.restore': 'Restore purchases',
  'settings.plan.restoring': 'Restoring…',
  'settings.plan.restoreDone': 'Purchases restored.',
  'settings.plan.restoreNothing': 'Nothing to restore on this Apple ID.',
  'settings.plan.restoreWrongAccount': 'That subscription belongs to a different Wurld account.',
  'settings.plan.restoreAlreadyEntitled': 'You already have Plus through another subscription.',
  'settings.plan.restoreFailed': 'Couldn’t restore purchases. Please try again.',
  // BILL-STRIPE-7 — back from web Checkout. "Finishing" until the webhook's
  // projection reads paid: the redirect is not proof of payment.
  'settings.plan.checkoutFinishing': 'Finishing up your purchase…',
  'settings.plan.checkoutSlow': 'This is taking longer than usual. Plus switches on as soon as the payment is confirmed.',
  'settings.plan.checkoutDone': 'You’re on Plus — thank you!',
  'settings.plan.checkoutCancelled': 'Checkout cancelled — you haven’t been charged.',
  // ── settings: groups (SETTINGS-GROUP-1) ────────────────────────────
  // SETTINGS-GROUP-1 — the languages group's title (key `languages`).
  'settings.groups.languages': 'Translation settings',
  'settings.groups.languagesSubtitle': 'Your languages, translation, pronouns',
  'settings.groups.learning': 'Practice settings',
  'settings.groups.learningSubtitle': 'Quiz level, speech speed, voice, chat quiz',
  // SETTINGS-GROUP-1 — the two parts of Practice settings.
  'settings.learning.difficultyTitle': 'Difficulty settings',
  'settings.learning.experienceTitle': 'Learning experience',
  'settings.learning.quizLevel': 'Quiz level',
  'settings.learning.quizLevelHint':
    'How challenging your quizzes and practice are. It also guides explanations, corrections and how the tutor talks to you. Each language you practise has its own level.',
  'settings.groups.app': 'App preferences',
  'settings.groups.appSubtitle': 'App language, appearance, notifications',
  'settings.groups.help': 'Help & about',
  'settings.groups.helpSubtitle': 'Safety, blocked people, privacy, terms, support, delete account',

  // ── settings: profile ──────────────────────────────────────────────
  'settings.profile.namePlaceholder': 'Your name',
  'settings.profile.editName': 'Display name',
  'settings.profile.edit': 'Edit',
  'settings.profile.editAriaEdit': 'Edit profile',
  'settings.profile.editAriaSave': 'Save name',
  'settings.profile.editAriaCancel': 'Cancel name edit',
  'settings.profile.phoneNumber': 'Phone number',

  // ── settings: language ─────────────────────────────────────────────
  // LANG-TX-4 — the ACCOUNT-wide switch, and the default every chat cascades
  // from. Deliberately the chat label "scoped to the account" rather than a
  // freshly-invented phrase: a user who has met the per-chat switch has to
  // recognise this one as the same control one level up, or they will believe
  // they have turned translation off and find one chat still doing it.
  'settings.translation.title': 'Translation',
  'settings.translation.label': 'Enable translation in your chats',
  // Names the override rather than hiding it. The per-chat switch wins
  // (LANG-TX-2), so a global toggle that did not say so is a control the user
  // will think is broken the first time a chat disagrees with it.
  'settings.translation.hint':
    'The default for every chat. Any chat can set its own on its info screen.',
  'settings.language.title': 'Languages',
  // LANG-SET-13 — chat languages vs the app language, kept apart.
  'settings.language.chatGroup': 'Chat languages',
  'settings.language.chatGroupHint':
    'The languages you read and write messages in. Each message bubble can show both at once or swipe to flip between them.',
  'settings.language.appLanguage': 'App language',
  'settings.language.appLanguageHint': 'Menus and buttons only. Starts in your phone’s language.',
  'settings.language.changeAnytime': 'You can change these anytime in Settings.',
  'settings.language.iSpeak': 'I speak',
  'settings.language.iSpeakSubtitle': '(native language)',
  'settings.language.iSpeakPlaceholder': 'Select your native language',
  'settings.language.iSpeakPickerTitle': 'Your native language',
  'settings.language.iAmLearning': 'I’m learning',
  'settings.language.iAmLearningSubtitle': '(practice language)',
  'settings.language.iAmLearningPlaceholder': 'Select a language to learn',
  'settings.language.iAmLearningPickerTitle': 'Language you’re learning',

  // ── settings: notifications ────────────────────────────────────────
  'settings.notifications.title': 'Notifications',
  'settings.notifications.languageLabel': 'Notification language',
  'settings.notifications.bannerOff': 'Notifications are off',
  'settings.notifications.bannerBody': 'You won’t be notified when new messages arrive.',
  'settings.notifications.bannerCta': 'Turn on',
  'settings.notifications.enabledToast': 'Notifications enabled',
  'settings.notifications.unsupportedToast': 'Notifications are not supported in this browser',
  'settings.notifications.deniedToast': 'Allow notifications in your browser or device settings',
  'settings.notifications.enabled': 'Enabled',
  'settings.notifications.disabled': 'Disabled',
  'settings.notifications.status': 'Status:',
  'settings.notifications.nativeFallback': 'Native',
  'settings.notifications.practiceFallback': 'Practice',
  // NOTIF-7.3 — this device's push registration.
  'settings.notifications.deviceLabel': 'This device:',
  'settings.notifications.deviceRegistered': 'Registered · {when}',
  'settings.notifications.deviceMissing': 'Missing on the server',
  'settings.notifications.deviceUnregistered': 'Not registered on this device',
  'settings.notifications.deviceReregister': 'Re-register',
  'settings.notifications.deviceReregistered': 'Push registration refreshed',

  // ── settings: appearance ───────────────────────────────────────────
  'settings.appearance.title': 'Appearance',
  'settings.appearance.subtitle':
    'Choose your preferred color theme. System follows your device settings.',
  'settings.appearance.themeSystem': 'System',
  'settings.appearance.themeLight': 'Light',
  'settings.appearance.themeDark': 'Dark',

  // ── settings: about / footer ───────────────────────────────────────
  'settings.about.title': 'About',
  'settings.about.appVersionLabel': 'App',
  'settings.about.serverVersionLabel': 'Server',
  // SETTINGS-ABOUT-1 — names the timestamp beside each build's channel tag.
  'settings.about.buildTimeLabel': 'Built',
  // OTA-11 (docs/specs/live-updates.md §3d) — the App row's native facts in a
  // native shell: the shell's build number and the channel this device
  // follows, joined with " · " under the version line.
  'settings.about.nativeBuild': 'build {build}',
  'settings.about.deviceChannel': '{channel} channel',
  'settings.about.copyDebug': 'Copy debug info',
  'settings.about.copied': 'Copied',
  'settings.about.openSourceLicenses': 'Open-source licenses',
  'settings.about.sendFeedback': 'Send feedback',
  // SETTINGS-HELP-1 — a plain mail to support@wurld.chat, below Send feedback.
  'settings.about.contactSupport': 'Contact support',
  'settings.footer.installApp': 'Install as App',
  'settings.footer.openInApp': 'Open in App',
  'settings.footer.checkForUpdates': 'Check for updates',
  'settings.footer.upToDate': "You're on the latest version.",
  'settings.footer.updateDownloaded': 'Update downloaded. Close and reopen Wurld to finish updating.',
  'settings.footer.updateUnsupported': 'Updates are handled by the app store on this device.',
  'settings.footer.signOut': 'Sign out',
  'settings.footer.adminDashboard': 'Admin Dashboard',
  'settings.signOut.confirmTitle': 'Sign out?',
  'settings.signOut.confirmBody':
    'You’ll need to verify your phone number again to sign back in.',

  // ── account deletion ───────────────────────────────────────────────
  'settings.deleteAccount.title': 'Account deletion',
  'settings.deleteAccount.subtitle':
    'Permanently delete your account, profile, and message history. Other users’ copies of messages you sent will remain (a chat history can’t be unmade for everyone). This action can’t be undone.',
  'settings.deleteAccount.startButton': 'Delete my account',
  'settings.deleteAccount.areYouSure': 'Are you sure?',
  'settings.deleteAccount.yesDelete': 'Yes, delete',
  'settings.deleteAccount.deleting': 'Deleting…',
  'settings.deleteAccount.successToast': 'Account deleted.',
  'settings.deleteAccount.removedKept':
    'Removed: your profile, 1-to-1 chats and images, contacts, flashcards, and learning data. Kept: messages you sent in group chats stay for the other members, and short-term backups expire on a rolling schedule.',
  'settings.deleteAccount.privacyLink': 'How we handle your data',
  // BILL-DEL-3 / BILL-DEL-4 (billing.md). English only for now — the other
  // locales fall back to English until `npm run i18n:regen` is run.
  'settings.deleteAccount.billingRecords':
    'Purchase records are kept, with your account ID removed, for refunds, disputes and tax.',
  'settings.deleteAccount.appleBillingTitle': 'Your Plus subscription is still active',
  'settings.deleteAccount.appleBillingBody':
    'Your subscription is billed by Apple and will continue until you cancel it. Deleting your account does not cancel it.',
  'settings.deleteAccount.manageSubscription': 'Manage subscription',
  'settings.deleteAccount.deleteAnyway': 'Delete anyway',
  'settings.deleteAccount.checking': 'Checking…',

  // ── cards / flashcards ─────────────────────────────────────────────
  'cards.headerTitle': 'Flashcards',
  'cards.cardCount': '{count} cards',
  'cards.accuracy': '{pct}% accuracy',
  'cards.emptyHint':
    'Tap an underlined word in chat to save it as a flashcard.',
  'cards.searchPlaceholder': 'Search cards…',
  // Unused since 2026-10-24: the Play FAB nudge label (now cards.addFabLabel).
  'cards.practiceCta': 'Practice',
  'cards.clearFilters': 'Clear',
  'cards.filterTab.languages': 'Languages',
  'cards.filterTab.topics': 'Topics',
  'cards.filterTab.accuracy': 'Accuracy',
  'cards.filterTab.date': 'Date',
  'cards.filterTab.search': 'Search',
  'cards.accuracy.below': '<{pct}%',
  'cards.date.all': 'All time',
  'cards.date.today': 'Today',
  'cards.date.7d': 'Last 7 days',
  'cards.date.30d': 'Last 30 days',
  'cards.viewModeAria': 'Card view mode',
  'cards.viewMode.list': 'List',
  'cards.viewMode.flip': 'Flip',
  'cards.shuffleAria': 'Shuffle deck',
  'cards.flip.progressHint': 'Tap or swipe up',
  'cards.flip.bottomAria': 'Card {idx} of {total} — tap to reveal translation',
  'cards.flip.emptyDeck': 'No cards in this view yet.',
  'cards.flip.endOfDeck': 'You’ve studied every card in the deck.',
  'cards.flip.backToList': 'Back to list',
  'cards.flip.reset': 'Reset',
  'cards.allLanguages': 'All Languages',
  'cards.allTopics': 'All',
  'cards.noMatches': 'No matches.',
  'cards.deletedToast': 'Card deleted',
  'cards.noPhrase': '(no phrase)',
  'cards.noTranslation': '(no translation)',
  'cards.deleteCardLabel': 'Delete card',
  'cards.archived.title': 'Archived ({count})',
  'cards.archived.body':
    'Cards move here once you’ve repeatedly answered them correctly. They’re skipped from regular practice — tap a card’s ↺ to bring it back, or pick "Review archived cards" on the custom-practice screen for a one-off session. Keep adding flashcards from your conversations, or from this page, so practice sessions stay relevant and up to date.',
  'cards.archived.unarchiveLabel': 'Move back to active',
  'cards.markLearntLabel': 'Mark as learnt',
  'cards.rowMenuLabel': 'Card actions',
  // CARDS-LIST-12 — accessible name for the odd-language flag emoji on a
  // cards-list row. Shown only when the card's language differs from the
  // language the list is scoped to, so it must name that language.
  'cards.otherLanguageAria': 'Card language: {lang}',
  'cards.menu.markLearnt': 'Mark as learnt',
  'cards.menu.edit': 'Edit',
  'cards.menu.delete': 'Delete',
  'cards.markedLearntToast': 'Marked as learnt',
  'cards.undo': 'Undo',
  'cards.edit.title': 'Edit card',
  'cards.edit.topicLabel': 'Topic',
  'cards.edit.save': 'Save',
  'cards.edit.cancel': 'Cancel',
  'cards.edit.savedToast': 'Card updated',
  'cards.add.menu.fromChats': 'Create from recent chats',
  'cards.add.orManually': 'or add manually',
  'cards.add.title': 'New card',
  'cards.add.languageLabel': 'Language',
  'cards.add.translateTo': 'Translate to {lang}',
  'cards.add.languagePickerTitle': 'Card language',
  'cards.editor.clearField': 'Clear',
  'cards.add.savedToast': 'Card saved',
  'cards.editor.detectingTopic': 'Detecting…',
  'cards.editor.translationFailed': 'Translation failed',
  // CARDS-LIST-13: in-box button that fills this box from the other one.
  'cards.editor.translateHere': 'Translate here',
  // CARDS-FAB-* + CARDS-FILTER-1: floating actions + always-visible filter row.
  // Unused since 2026-10-24: the Play FAB is gone (Practice is a tab, NAV-PRACTICE-1).
  'cards.playFabAria': 'Start practising',
  'cards.addFabLabel': 'Add phrases',
  'cards.addFabAria': 'Add phrases',
  'cards.addMenu.import': 'Import from chats',
  'cards.addMenu.manual': 'Add manually',
  'cards.filtersAria': 'Filters',

  // ── practice hub (PRACTICE-HUB-*) ──────────────────────────────────
  'practice.hub.title': 'Practice',
  // PRACTICE-HUB-1/10 — sessions are built from the user's own cards (owner, 2026-10-24).
  'practice.hub.source': 'Built from your saved flashcards',
  'practice.hub.suggested': 'Suggested session',
  'practice.hub.suggestedSubtitle': 'A smart mix from your saved flashcards and recent chats',
  'practice.hub.suggestedDue': '{count} of your saved flashcards are due for review',
  'practice.hub.suggestedDueOne': '1 of your saved flashcards is due for review',
  'practice.hub.custom': 'Custom session',
  'practice.hub.customSubtitle': 'Pick topics, length and focus',
  'practice.hub.emptyHint': 'Add some cards first and your suggested session will fill in.',
  'practice.hub.resume': 'Resume session',
  'practice.hub.resumeProgress': 'Question {n} of {total}',
  'practice.hub.resumeChoiceTitle': 'Resume or start new?',
  'practice.hub.resumeChoiceBody': 'You have an unfinished session (question {n} of {total}). Starting a new one discards it.',
  'practice.hub.resumeChoiceResume': 'Resume',
  'practice.hub.resumeChoiceStartNew': 'Start new',
  // LANG-TIER-1.1 — the offer shown where a session would start. It names what
  // stays free in the same breath, because the reader is standing on their own
  // deck and the one thing they must not conclude is that it has been taken
  // away. LANG-FREE-8's rules apply: an offer, never a wall — no "paused", no
  // reassurance about data being kept, because nothing has been lost.
  'practice.needsPlusTitle': 'Practice sessions come with Plus',
  'practice.needsPlusBody': 'Your cards stay yours — keep saving them and reviewing your deck for free. Plus adds the sessions built from them: questions written for you, scheduled as you learn.',

  // ── practice ───────────────────────────────────────────────────────
  'practice.headerTitle': 'Practice',
  'practice.questionsCount': '{count} questions',
  'practice.whyLabel': 'Why',
  'practice.skip': 'Skip',
  'practice.explain': 'Explain',
  'practice.seeResults': 'See results',
  'practice.previous': 'Previous question',
  'practice.addToFlashcards': 'Add to flashcards',
  'practice.inFlashcards': 'In your flashcards',

  // ── practice — question UIs (shared across question renderers) ──────
  'practice.question.fillPlaceholder': 'Type the missing word(s)…',
  'practice.question.fillAriaLabel': 'Type the missing word(s)',
  'practice.question.submitAria': 'Submit answer',
  'practice.question.correctLabel': 'Correct:',

  // ── practice — end-of-session summary screen ───────────────────────
  'practice.summary.scoreGreat': 'Great job!',
  'practice.summary.scoreKeep': 'Keep practicing!',
  'practice.summary.scoreImprove': 'Room to improve',
  'practice.summary.skipped': '{count} skipped',
  'practice.summary.byTopic': 'By topic',
  'practice.summary.perQuestion': 'Per question',
  'practice.summary.youSaid': 'You said: {answer}',
  'practice.summary.reviewMistakes': 'Review {count} mistake',
  'practice.summary.reviewMistakesPlural': 'Review {count} mistakes',
  'practice.summary.newSession': 'New session',
  'practice.summary.otherTopic': 'Other',
  'practice.summary.tryHarder': 'Try a harder session?',
  'practice.summary.tryEasier': 'Try an easier session?',
  'practice.summary.tryHarderSubtitle': 'One similar session at Level {level}. You stay at Level {current}.',
  'practice.summary.tryEasierSubtitle': 'One similar session at Level {level}. You stay at Level {current}.',
  'practice.summary.changeDifficultyInSettings': 'To change your level for good, go to Settings →',
  'practice.summary.savedConcepts': 'New concepts from this session',
  'practice.summary.saveOneCta': 'Save',
  'practice.summary.saveAllCta': 'Save all',
  'practice.summary.saved': 'Saved',

  // ── practice — pre-session customization screen ────────────────────
  'practice.start.title': 'Custom session',
  'practice.start.subtitle':
    'Tell the planner what you want — focus on a topic, words you struggle with, or a free-form ask.',
  'practice.start.intentLabel': 'What do you want to practice?',
  'practice.start.intentPlaceholder':
    'e.g. Focus on past-tense verbs, or test me on travel vocabulary',
  'practice.start.chip.struggling': 'Words I struggle with',
  'practice.start.chip.thisWeek': 'Cards from this week',
  'practice.start.chip.smartShuffle': 'Smart shuffle (new vocabulary)',
  'practice.start.chip.focusOn': 'Focus on {topic}',
  'practice.start.lengthLabel': 'Length',
  'practice.start.length.short': 'Short',
  'practice.start.length.medium': 'Medium',
  'practice.start.length.long': 'Long',
  'practice.start.lengthCount': '{count} questions',
  'practice.start.skillLabel': 'Question types',
  'practice.start.skill.all': 'All',
  'practice.start.skill.reading': 'Reading',
  'practice.start.skill.writing': 'Writing',
  'practice.start.skill.listening': 'Listening',
  'practice.start.topicLabel': 'Topic filter (optional)',
  // PRACTICE-START-LANG-1: explicit language section (deck spans 2+ langs).
  'practice.start.languageLabel': 'Language',
  // PRACTICE-START-ADV-1: progressive-disclosure "Advanced" section + the
  // standalone archived toggle inside it.
  'practice.start.advanced': 'Advanced',
  'practice.start.advancedSubtitle': 'Topics & archived cards',
  'practice.start.reviewArchivedLabel': 'Include archived cards',
  'practice.start.reviewArchivedSubtitle': '{count} archived in this language',
  'practice.start.startCta': 'Start session',
  'practice.start.noCardsHint':
    'You don’t have any cards in this language yet. Try importing from your chats below.',

  // ── practice — parallel-load lesson intro ──────────────────────────
  'practice.intro.weakTopics':
    'You’ve been struggling with: {topics}. We’ll favor these.',
  'practice.intro.weakSkills':
    'Weakest skill area: {challenge} ({pct}%). Adding more {challenge} questions.',
  'practice.intro.startCta': 'Start lesson',
  'practice.intro.preparingCta': 'Preparing…',

  // ── practice — progress dashboard ──────────────────────────────────
  'practice.progress.title': 'Your progress',
  'practice.progress.emptyHint':
    'Complete a session to see your progress, XP, and weakest topics.',
  'practice.progress.emptyCta': 'Start a session',
  'practice.progress.error': 'Couldn’t load your progress. Try again.',
  // streakLabel, trendTitle, trendCaption: unused since XP-UI-3/4 (2026-10-20)
  // replaced the streak header and the accuracy sparkline. Kept until the next locale regen: the 80 locale files
  // still carry these keys and `Partial<Messages>` rejects unknown ones.
  'practice.progress.streakLabel': 'day streak',
  'practice.progress.totalsTitle': 'Totals',
  'practice.progress.totalsSessions': 'Sessions',
  'practice.progress.totalsQuestions': 'Questions',
  'practice.progress.totalsAccuracy': 'Accuracy',
  'practice.progress.trendTitle': 'Recent accuracy',
  'practice.progress.trendCaption': 'Last {count} session(s)',
  'practice.progress.topicsTitle': 'Topic mastery',
  'practice.progress.skillsTitle': 'Skills',
  'practice.progress.dueCount': '{count} of your saved flashcards are due for review',
  'practice.progress.dueCountOne': '1 of your saved flashcards is due for review',
  'practice.progress.dueCta': 'Start a session focused on what’s due',
  'practice.progress.languageTabsAria': 'Practice languages',
  // PRACTICE-DASH-17.1 — a language tab: its name, then its total XP.
  'practice.progress.languageTabXp': '{language} · {xp} XP',
  // ── practice — XP (docs/specs/xp.md XP-UI-2/3/4, XP-LEVEL-5) ─────────
  // XP-UI-3 — says what XP is, under the total (owner, 2026-10-24: "quite a gaming term").
  'practice.progress.xpTotalLabel': 'Experience points, earned by practising',
  'practice.progress.xpTotal': '{xp} XP',
  'practice.progress.levelProgress': 'Level {level} · {earned} / {target} XP',
  'practice.progress.topLevel': 'Top level',
  'practice.progress.accuracyHint':
    'Accuracy counts too: get 70% of your recent answers right at this level to move up.',
  'practice.progress.accuracyLabel': 'Recent accuracy · {rate}%',
  'practice.progress.accuracyEmpty': 'Recent accuracy · no answers yet',
  // XP-UI-3.4 — the next-level checklist.
  'practice.progress.accuracyCaption': 'Your latest chat quiz and practice session answers at this level.',
  // XP-LEVEL-2.1 / 2.3 — from level 6 messages count and quizzes don't.
  'practice.progress.accuracyCaptionNoQuiz': 'Your latest practice session answers and messages at this level.',
  'practice.progress.nextLevelTitle': 'To reach Level {next}',
  'practice.progress.levelXpLabel': 'XP earned at Level {level}',
  'practice.progress.levelXpValue': '{earned} / {target}',
  'practice.progress.writingLabel': 'Writing in {language}',
  'practice.progress.yourPracticeLanguage': 'your practice language',
  'practice.progress.waitWriting':
    'You’ve earned the XP for Level {next}. Keep writing in {language} to fill your writing bar and move up.',
  // XP-UI-3.5 — the writing nudge.
  'practice.progress.writeNudgeBonus':
    'Write your messages in {language} whenever you can. Each one earns XP, and mistakes won’t lower your accuracy at this level.',
  // Unused since 2026-10-24 (XP-UI-3.2/3.5 trims); kept for the generated locales.
  'practice.progress.writeNudgeRequired':
    'Moving up to Level {next} takes plenty of writing in {language}. Every message you send in {language} fills your writing bar, right or wrong, and earns XP.',
  // Unused since 2026-10-24 (XP-UI-3.2/3.5 trims); kept for the generated locales.
  'practice.progress.writeNudgeMet':
    'You’ve written enough in {language} for the next level. Keep going: every message earns XP.',
  // XP-UI-3.8 — "How levels work".
  'practice.levelGuide.link': 'How XP and levels work',
  'practice.levelGuide.title': 'How XP and levels work',
  // Owner, 2026-10-24: give the app credit; levels here mean real progress.
  'practice.levelGuide.why':
    'Your points and levels here are more than a streak. They show real progress: to move up, you write real messages and get them right, the same skills a real conversation needs. When your level goes up, your {language} has genuinely improved.',
  'practice.levelGuide.xp':
    'XP (experience points) shows how much you practise. You earn it for writing in {language}, answering chat quizzes, and answering questions in practice sessions. Your total never goes down.',
  'practice.levelGuide.rule':
    'To move up from a level, earn {xp} XP at that level and get {rate}% of your last {answers} or more answers there right. From Level {from}, you also need plenty of writing in {language}.',
  'practice.levelGuide.levelName': 'Level {level} · {name}',
  'practice.levelGuide.yourLevel': 'Your level',
  'practice.levelGuide.quizLabel': 'Chat quiz',
  'practice.levelGuide.accuracyLabel': 'Accuracy counts',
  'practice.levelGuide.writingLabel': 'Also needed',
  'practice.levelGuide.moveLabel': 'Moving up',
  'practice.levelGuide.quizGapsHints': 'Fill the gaps, with hints',
  'practice.levelGuide.quizGaps': 'Fill the gaps',
  'practice.levelGuide.quizMixGaps': 'Mostly fill the gaps, some short re-orders',
  'practice.levelGuide.quizMixOrder': 'Mostly short re-orders, some fill the gaps',
  'practice.levelGuide.quizWhole': 'Re-order whole sentences',
  'practice.levelGuide.quizWholeXpOnly': 'Re-order whole sentences, for XP only',
  'practice.levelGuide.accuracyAnswers': 'Chat quiz and practice session answers',
  'practice.levelGuide.accuracyNoQuiz': 'Practice session answers and messages',
  'practice.levelGuide.writing': 'Writing in {language}, right or wrong',
  'practice.levelGuide.writingMore': 'Writing in {language}, more than at the level before',
  'practice.levelGuide.topLevel': 'Top level',
  'practice.levelGuide.plansTitle': 'Free and Plus',
  'practice.levelGuide.everyoneTitle': 'Everyone',
  'practice.levelGuide.everyoneBody':
    'earns XP for writing in {language}, sees this progress, and can change level any time.',
  'practice.levelGuide.plusTitle': 'Wurld Plus',
  'practice.levelGuide.plusBody':
    'adds chat quizzes and tailor-made practice sessions, more ways to earn XP and build accuracy, and moves you up automatically when you’re ready.',
  'practice.levelGuide.freeNote':
    'On Free, you choose when to move up. Change your level from this screen whenever it feels right.',
  'practice.levelGuide.plusNote': 'You’re on Plus, so we move you up as soon as you’re ready.',
  // XP-UI-3.6 — the practice sessions card.
  'practice.progress.sessionsTitle': 'Practice sessions',
  'practice.progress.sessionsCaption': 'All time',
  'practice.progress.sessionsRight': 'Answered right',
  'practice.progress.accuracyCount': '{count} of {needed} answers',
  'practice.progress.accuracyTarget': 'Goal {target}%',
  'practice.progress.accuracyAria': 'Your accuracy at this level; {target}% is needed to move up',
  'practice.progress.readyHint': 'You’re ready for Level {next}.',
  'practice.progress.waitAnswers':
    'You’ve earned the XP for Level {next}. Answer {remaining} more chat quiz or practice session questions so we can check you’re ready.',
  'practice.progress.waitRate':
    'We’re helping you get a little more consistent before moving you up: waiting for {target}% accuracy (you’re at {rate}%). Practice sessions and chat quizzes help.',
  // XP-LEVEL-2.3 — from level 6 the quiz no longer counts toward accuracy.
  'practice.progress.waitAnswersNoQuiz':
    'You’ve earned the XP for Level {next}. Answer {remaining} more practice session questions or write messages in {language} so we can check you’re ready.',
  'practice.progress.waitRateNoQuiz':
    'We’re helping you get a little more consistent before moving you up: waiting for {target}% accuracy (you’re at {rate}%). Practice sessions and writing in {language} help.',
  'practice.progress.levelUpNow': 'Level up now',
  // Unused since 2026-10-24 (XP-UI-3.2/3.5 trims); kept for the generated locales.
  'practice.progress.levelUpWarning':
    'You can move up yourself now, but practice sessions and chat quizzes at Level {next} might feel too hard for a while.',
  'practice.progress.levelChange': 'Change',
  'practice.progress.levelDone': 'Done',
  'practice.progress.levelCurrent': 'Level {level} · {name}',
  'practice.progress.xpChartTitle': 'XP per day',
  'practice.progress.xpChartCaption': 'Last 14 days',
  'practice.progress.xpChartAria': 'XP earned each day over the last 14 days',
  'practice.progress.xpChartTotalTitle': 'Your XP',
  'practice.progress.xpChartTotalAria': 'Your total XP over the last 14 days, now {xp}',
  'practice.progress.xpChartGained': '+{xp} XP',
  'practice.progress.xpChartModeTotal': 'Total',
  'practice.progress.xpChartModeDaily': 'Per day',
  'practice.summary.xpEarned': '+{xp} XP',
  'practice.summary.xpSplit': '{answers} for answers · {bonus} completion bonus',
  'practice.levelUp.aria': 'Level up',
  'practice.levelUp.title': 'Level {level}: {name}',
  'practice.levelUp.kicker': 'You moved up a level',
  'practice.levelUp.whatChanges':
    'Practice sessions, chat quizzes and corrections now aim at {name} level.',
  // XP-LEVEL-5.1 — the learner's own record at the level they left.
  'practice.levelUp.proof': 'You earned it: {rate}% of your last {answers} answers at Level {level} were right.',
  'practice.levelUp.proofWriting':
    'You earned it: {rate}% of your last {answers} answers at Level {level} were right, and you wrote {written} messages in {language}.',
  'practice.levelUp.goBack':
    'If it feels too hard you can go back to Level {level} any time in Settings.',
  'practice.levelUp.stay': 'Stay at Level {level}',
  'practice.levelUp.continue': 'Keep going',
  'practice.intro.firstSession':
    'Your first session here — questions cover whatever you saved. We’ll learn what you’re strong at over time.',
  'practice.intro.basicModeBanner':
    'Network issue — running a simplified session from your local flashcards.',
  // PRACTICE-PLAN-45 — the 402 / 429 selector fallbacks. Neither is a network
  // problem, so neither may borrow the network copy above.
  'practice.intro.planBanner':
    'Personalised sessions come with Plus — this one is built from your saved cards.',
  'practice.intro.rateLimitedBanner':
    'Too many requests just now — this session is built from your saved cards.',
  'practice.intro.basedOnDeck': 'Why (Based on your deck)',
  'practice.intro.personalisedLesson': 'Personalised Lesson',
  'practice.resumePrompt.heading': 'Pick up where you left off?',
  'practice.resumePrompt.body':
    'You have a practice session in progress — question {idx} of {total}. Resume it, or start a new lesson.',
  'practice.resumePrompt.resumeCta': 'Resume',
  'practice.resumePrompt.startNewCta': 'Start a new lesson',

  // ── practice — chat-import flashcard flow ──────────────────────────
  'practice.import.title': 'Build flashcards from chats',
  'practice.import.consent.body':
    'Wurld will scan your recent messages (up to 150 from the last 3 months) for new vocabulary. Periodically reflecting on new words that come up naturally is a great way to build familiarity with the language.',
  'practice.import.consent.privacy':
    'While processing is done externally, no data is stored or used for training with any 3rd party. We never sell any of your chat data and never will.',
  'practice.import.consent.continue': 'Import',
  'practice.import.consent.cancel': 'Cancel',
  'practice.import.extracting': 'Looking for new vocabulary…',
  'practice.import.noCandidates':
    'No new vocabulary found in your recent chats. Try chatting some more!',
  'practice.import.candidatesTitle': 'Found {count} new words & phrases',
  'practice.import.candidatesSubtitle': 'Pick the ones to add as flashcards.',
  'practice.import.selectAll': 'Select all',
  'practice.import.clearAll': 'Clear',
  'practice.import.saveSelected': 'Save {count}',
  'practice.import.saveAll': 'Save all',
  'practice.import.savedToast': 'Saved {count} new flashcard(s)',
  'practice.import.errorToast': 'Couldn’t extract from chats. Try again.',
  'practice.import.close': 'Close',

  // ── explain modal ──────────────────────────────────────────────────
  'explain.playAudio': 'Play audio',
  'explain.pauseAudio': 'Pause',
  // EXPLAIN-ORIG-1 — the collapsed source-message row; {language} is the
  // message's original language name as the language cards show it.
  'explain.original': 'Original ({language})',
  // LANG-TIER-1.1 — Explain is Plus. Shown inside the modal the tap opened, so
  // it describes the thing the reader has just asked for rather than the tier.
  // "One Plus covers the whole chat" is the sheet's job, one tap away.
  'explain.needsPlusTitle': 'Explanations come with Plus',
  'explain.needsPlusBody': 'Plus breaks any message down line by line — what each phrase means, why it is phrased that way, and the words worth keeping.',
  // EXPLAIN-PHRASE-* — the vocab card's `?` (the phrase explainer).
  'explain.phraseButton': 'Explain this phrase',
  'explain.phrasePanel': 'Phrase explanation',
  // EXPLAIN-PHRASE-4 — owner's copy (2026-10-24). Title only, with the upgrade
  // button under it: the panel sits under a lifted bubble and stays small.
  'explain.phraseNeedsPlusTitle': 'Get explanations on all translations',

  // ── toasts (cross-cutting) ─────────────────────────────────────────

  // ── offline / connectivity ─────────────────────────────────────────
  'offline.banner': 'You’re offline — messages will send when you reconnect.',
  'offline.bubbleChip': 'Waiting for network',

  // ── update available ───────────────────────────────────────────────
  'update.available': 'A new version is available.',
  'update.reload': 'Reload',
  'update.later': 'Later',
  // BOOT-GATE-3 — the blocking screen for a build below the version floor
  // (docs/specs/cold-boot.md §3d). No dismiss: the old build must stop.
  'versionGate.title': 'Update required',
  'versionGate.body': 'This version of Wurld is no longer supported. Update to the latest version to keep chatting — your messages and cards are safe.',
  'versionGate.action.web': 'Update now',
  'versionGate.action.appStore': 'Open the App Store',
  'versionGate.action.playStore': 'Open Google Play',
  'versionGate.updating': 'Updating…',
  // OTA-6 (docs/specs/live-updates.md) — the native floor. On iOS the beta
  // channel updates from TestFlight, not the App Store; a shell below the
  // floor is prompted once per launch before `enforceAt`, then blocked.
  'versionGate.action.testFlight': 'Open TestFlight',
  'versionGate.prompt.title': 'A newer version of Wurld is available',
  'versionGate.prompt.update': 'Update',
  'versionGate.prompt.later': 'Later',

  // ── install hints ──────────────────────────────────────────────────
  'install.iosHint': 'Tap Share → Add to Home Screen to install.',
  'install.otherHint': 'Install from your browser menu.',

  // ── chat info / group info / add member ────────────────────────────
  // (a few keys further up — `chatInfo.title`, `.members`, `.addMember`,
  // `.leaveGroup` — predate this block and are reused below.)
  'chatInfo.groupTitle': 'Group info',
  'chatInfo.contactTitle': 'Contact info',
  'chatInfo.noName': '(no name)',
  'chatInfo.renameGroupAria': 'Rename group',
  'chatInfo.addMemberShort': 'Add',
  'chatInfo.noMembers': 'No members.',
  'chatInfo.leaving': 'Leaving…',
  'chatInfo.lastAdminBeforeLeaveHint':
    'You’re the only admin. Promote another member before leaving.',
  'chatInfo.copyChatIdAria': 'Copy chat ID',
  'chatInfo.chatIdLabel': 'chat ID',
  'chatInfo.userIdLabel': 'user ID',
  'chatInfo.chatIdCopiedToast': 'Chat ID copied',
  'chatInfo.userIdCopiedToast': 'User ID copied',
  'chatInfo.couldNotCopyToast': 'Could not copy',
  'chatInfo.phoneCopiedToast': 'Phone number copied',
  'chatInfo.openProfileAria': 'Open {name} profile',
  'chatInfo.youSuffix': '(you)',
  'chatInfo.copyPhoneAria': 'Copy phone number',
  'chatInfo.adminBadge': 'Admin',
  // LANG-SET-9 — who carries the room, and what each member reads.
  //
  // ⚠ "Plus" and nothing finer. A trialling member and a paying one carry the
  // SAME pill: the room's interest is who is funding its languages, and
  // distinguishing the two would publish one member's countdown to everybody
  // else. There is deliberately no "Free" counterpart — the absence of a pill
  // is not a status worth labelling, and labelling it would make the member
  // list a ranking.
  'chatInfo.plusPill': 'Plus',
  'chatInfo.memberLearning': 'Learning {language}',
  // LANG-SET-8 — the language controls, moved off the view menu.
  //
  // ⚠ Each hint names the language's ROLE, not just its name. The two rows set
  // opposite ends of one translation and sit one tap apart, so a reader who
  // cannot tell them apart ends up reading the chat in a language they do not
  // speak. "You read" / "you're learning" is the distinction, in the second
  // person, because the row is about this member and not about the room.
  // LANG-TX-3 — the per-chat translation switch, ABOVE the language rows.
  //
  // ⚠ The hints describe the CHAT, never the control. "Messages arrive exactly
  // as they were written" is a fact about what the reader will see; "toggle is
  // off" is a fact about a widget they can already look at. The product had no
  // way at all to say "do not translate this" before this switch, so users
  // reached for the only lever in sight — setting both languages the same —
  // and the copy here is what stops that being the discoverable path.
  'chatInfo.translationLabel': 'Enable translation in this chat',
  'chatInfo.translationHintOn': 'Messages are translated into the languages below.',
  'chatInfo.translationHintOff': 'Messages arrive exactly as they were written.',
  // LANG-TX-8 — what the ROOM needs, never a refusal. Same rule LANG-SET-6 and
  // LANG-FREE-8 apply, for the same reason: this is the moment the product
  // asks somebody to pay, and copy that reads as breakage spends it
  // complaining. So it states a fact about the chat and names the remedy
  // without attaching it to the reader — "someone", not "you".
  //
  // ⚠ It must agree with `chatPassthrough.*` above, which the same user is
  // reading one screen away: one Plus covers the whole room. Copy implying
  // everybody needs it misprices the product in the reader's head.
  'chatInfo.translationNeedsPlus': 'Nobody here has Plus, so messages aren’t translated. One person on Plus turns it on for everyone.',
  'chatInfo.languagesHeading': 'Your languages here',
  // LANG-SET-12 — each row names ONLY its own role. The reading row's subtitle
  // used to name BOTH languages ("You read this chat in {reading}; you're
  // practising {practice}") on the argument that two rows one tap apart, each
  // reading "<flag> <language>", is how somebody sets the wrong end of the
  // pair. The risk was real and that was the weakest answer to it: it fixed
  // "the two VALUES look alike" by duplicating the value in the row directly
  // below. Owner, 2026-09-21: *"top picker says the language I'm reading and
  // describes the one I'm practicing. No need. It's right below."*
  //
  // ⚠ NARROWED, not dropped. A row showing a flag and a language name with no
  // role line is the mis-tap these subtitles exist to prevent.
  //
  // ⚠ "practising", not "practicing" — the app's spelling throughout.
  // ── The ROLE, in one word, right-aligned on the row ───────────────────────
  // Owner, 2026-09-22: *"I need some indication back on the pickers or in a
  // header that shows which is the native and practice but can't think of a
  // way without cluttering the view."*
  //
  // ⚠ These are what `LANG-SET-12` asks for at a fraction of the cost. The
  // full-sentence sub-line ("The language you already know.") is what made the
  // rows feel cluttered and what the 2026-09-22 rewrite deleted; a single word
  // in the row's TRAILING slot costs no vertical height at all, which is the
  // dimension that was actually scarce. It reads as a settings row's value —
  // the pattern every OS list already teaches — and it leaves the sub-line
  // free for the one fact that changes ("3 others available").
  //
  // ⚠ "Native", not "Reading". The owner's own word for the end you already
  // know, and the word the blocked sentence uses. `chatInfo.readingLabel`
  // stays as it is: it titles the PICKER SHEET, where "Reading language" is a
  // heading rather than a chip, and the two jobs want different lengths.
  'chatInfo.readingRole': 'Native',
  'chatInfo.practiceRole': 'Practice',
  'chatInfo.readingLabel': 'Reading language',
  'chatInfo.readingHint': 'The language you already know.',
  'chatInfo.practiceLabel': 'Practice language',
  'chatInfo.practiceHint': 'The language you’re practising.',
  'chatInfo.languageNotSet': 'Not set',
  'chatInfo.demoteAria': 'Demote from admin',
  'chatInfo.promoteAria': 'Promote to admin',
  'chatInfo.removeMemberAria': 'Remove member',
  'chatInfo.removeOnlyAdminToast':
    'They are the only admin. Promote another member first, then remove.',
  'chatInfo.removeConfirm': 'Remove {name} from the group?',
  'chatInfo.removedToast': 'Removed {name}',
  'chatInfo.atLeastOneAdminToast':
    'There must be at least one admin. Promote another member first.',
  'chatInfo.demoteConfirm': 'Demote {name}?',
  'chatInfo.promoteConfirm': 'Promote {name}?',
  'chatInfo.demotedToast': 'Demoted {name}',
  'chatInfo.promotedToast': 'Promoted {name}',
  'chatInfo.leaveLastAdminToast':
    'You are the only admin. Promote another member to admin before leaving.',
  'chatInfo.leaveConfirm':
    'Leave "{group}"? You won’t receive new messages.',
  'chatInfo.thisGroupFallback': 'this group',
  'chatInfo.leftGroupToast': 'Left group',
  // GROUP-DEL-1/2 (docs/specs/groups.md) — admins only. The confirm says it is
  // for EVERYONE: unlike leaving, this removes the room from every member.
  'chatInfo.deleteGroup': 'Delete group',
  'chatInfo.deletingGroup': 'Deleting…',
  'chatInfo.deleteGroupConfirm':
    'Delete "{group}" for everyone? All its messages and photos are removed for every member. This can’t be undone.',
  'chatInfo.groupDeletedToast': 'Group deleted',
  'chatInfo.deleteGroupNotAdminError': 'Only a group admin can delete this group.',
  'chatInfo.renamedToast': 'Group renamed',
  'chatInfo.viewGroupPhotoAria': 'View {name}',
  'chatInfo.groupPhotoFallback': 'group photo',
  'chatInfo.groupPhotoUpdatedToast': 'Group photo updated',
  'chatInfo.mediaSectionTitle': 'Media',
  'chatInfo.mediaEmpty': 'No photos or videos in this chat yet',
  'chatInfo.mediaOpenAria': 'Open photo',
  // VID-RENDER-3 / VID-VIEWER-3 (docs/specs/video-messages.md)
  'chatInfo.mediaOpenVideoAria': 'Open video, {duration}',
  'viewer.videoError': 'Can’t play this video',
  'viewer.photoError': 'Couldn’t load this photo',
  'viewer.videoLabel': 'Video',
  // IMG-VIEWER-3 — Save's two-tap fallback when the share sheet lost the tap
  'viewer.saveTapAgain': 'Tap again to save',

  // 1:1 / contact-info screen
  'oneToOne.deleteConfirm':
    'Delete this conversation? All messages will be removed for both sides. This cannot be undone.',
  'oneToOne.deletedToast': 'Conversation deleted',
  'oneToOne.deleteUnauthorisedError':
    'Not authorised to delete this conversation.',
  'oneToOne.deleting': 'Deleting…',
  'oneToOne.delete': 'Delete Conversation',
  'oneToOne.displayNameLabel': 'Display name',
  'oneToOne.phoneLabel': 'Phone',
  'oneToOne.learningLabel': 'Learning',
  'oneToOne.savedAsLabel': 'Saved as',
  'oneToOne.addToContacts': 'Add to contacts',
  'oneToOne.viewContact': 'View contact',
  'oneToOne.viewPhotoAria': 'View {name}',
  'oneToOne.photoFallback': 'photo',
  'oneToOne.copyValueAria': 'Copy {label}',

  // add-member screen (existing group)
  'addMember.title': 'Add member',
  'addMember.notGroup': 'Not a group chat.',
  'addMember.searchPlaceholder': 'Search contacts…',
  'addMember.noMatches': 'No matches.',
  'addMember.noEligible': 'No eligible contacts to add.',
  'addMember.addedToast': 'Added {name}',
  // GROUP-ADD-1/2 — tick several, then one confirm labelled with the count.
  'addMember.confirmOne': 'Add 1 member',
  'addMember.confirmMany': 'Add {count} members',
  'addMember.addedManyToast': 'Added {count} members',

  // create-group screen (untranslated stragglers)
  'createGroup.linkFailedRetryToast':
    'Photo uploaded but not linked to the group. Tap Retry below to finish.',
  'createGroup.photoLinkedToast': 'Photo linked',
  'createGroup.photoUploadFailedToast':
    'Group created — photo upload failed, try again from group info.',
  'createGroup.nameYourGroup': 'Name your group',
  'createGroup.retrying': 'Retrying…',
  'createGroup.newGroup': 'New group',
  'createGroup.loadingContacts': 'Loading contacts…',
  'createGroup.noContactsOnWurld':
    'No contacts on Wurld yet. Add some from the Contacts screen first.',
  'createGroup.noMatches': 'No matches.',
  'createGroup.membersSelected': '{count} member selected',
  'createGroup.membersSelectedPlural': '{count} members selected',
  'createGroup.shortSelectedCount': '{count} selected',
  'createGroup.linkPhotoBanner':
    'Group created, but the photo couldn’t be linked. Retry to finish, or skip and continue to the group.',
  'createGroup.skip': 'Skip',
  'createGroup.nextAria': 'Next',

  // ── onboarding: welcome (web install-gate) ─────────────────────────
  'onboarding.welcome.headline': 'Learn a language just by chatting',
  'onboarding.welcome.explainer':
    'Wurld translates your everyday conversations, so you pick up real vocabulary from the chats you’re already having.',
  'onboarding.welcome.point1': 'Chat normally — Wurld does the teaching',
  'onboarding.welcome.point2': 'Learn the words you actually use',
  'onboarding.welcome.install': 'Install app',
  'onboarding.welcome.addToHomeScreen': 'Add to home screen',
  'onboarding.welcome.continueWeb': 'Continue in browser',

  // ── onboarding: permissions walk-through ───────────────────────────
  'onboarding.permissions.notifications.title': 'Stay in the loop',
  'onboarding.permissions.notifications.body':
    'Get notified the moment a friend messages you, so you never miss a chance to practise.',
  'onboarding.permissions.notifications.enable': 'Enable notifications',
  'onboarding.permissions.contacts.title': 'Find your friends',
  'onboarding.permissions.contacts.body':
    'See which of your contacts are already on Wurld so you can start chatting right away. Contacts are only used to find matches.',
  'onboarding.permissions.contacts.enable': 'Allow contacts',
  'onboarding.permissions.skip': 'Skip',
  'onboarding.permissions.skipStep': 'Skip this step',
  'onboarding.permissions.skipAll': 'Skip for now',

  // ── onboarding: profile completion ─────────────────────────────────
  'onboarding.profile.title': 'Complete your profile',
  'onboarding.profile.subtitle':
    'A few details so Wurld can tailor translations to you.',
  'onboarding.profile.progress': '{done} of {total} done',
  'onboarding.profile.allComplete': 'All set!',
  'onboarding.profile.incompleteHeading': 'Needs your attention',
  'onboarding.profile.continue': 'Get started',

  // ── onboarding: agreements (terms + privacy) ───────────────────────
  'onboarding.agreements.title': 'Terms & privacy',
  'onboarding.agreements.subtitle': 'Please review and accept to continue.',
  'onboarding.agreements.continue': 'Continue',
  'onboarding.legal.pageTitle': 'Before you start',
  'onboarding.legal.pageSubtitle': 'Please review and accept our Terms and Privacy Policy to continue.',
  // AUTH-LEGAL-9 — a re-consent after the documents changed says so, so it
  // does not read as the first-run prompt reappearing for no reason.
  'onboarding.legal.updatedTitleBoth': 'We’ve updated our Terms and Privacy Policy',
  'onboarding.legal.updatedTitleTerms': 'We’ve updated our Terms of Service',
  'onboarding.legal.updatedTitlePrivacy': 'We’ve updated our Privacy Policy',
  'onboarding.legal.updatedSubtitle': 'Please take a look at what’s changed and accept to keep using Wurld.',
  'onboarding.agreements.agreePrefix': 'I agree to the',
  'onboarding.agreements.agreeTermsPrefix': 'I’m 18 or over and agree to the',
  'onboarding.agreements.termsName': 'Terms of Service',
  'onboarding.agreements.privacyName': 'Privacy Policy',
  // Chat quiz (docs/specs/chat-quiz.md)
  'chatQuiz.lesson': 'Quick lesson:',
  'chatQuiz.sent': 'Sent',
  'chatQuiz.lessonShort': 'Quick lesson',
  'chatQuiz.skip': 'Skip',
  'chatQuiz.frequencyShort': 'Frequency',
  'chatQuiz.resultCorrect': 'Quick lesson: correct',
  // XP-UI-1 — the pill on the sender's own bubble; the label is its accessible name.
  'chatQuiz.xpPill': '+{count} XP',
  'chatQuiz.xpLabel': 'Earned {count} XP',
  'chatQuiz.askWord': 'Translate “{word}”',
  'chatQuiz.askListen': 'Listen and translate',
  'chatQuiz.askOrder': 'Re-order in {language}',
  'chatQuiz.askListenOrder': 'Listen and re-order',
  'chatQuiz.askGaps': 'Fill the gaps in {language}',
  // QUIZ-INB-2 — the in-bubble header (owner, 2026-10-20: immersion, not a test).
  'chatQuiz.practiceShort': 'Practice',
  'chatQuiz.tapOrder': 'Tap to type the {language}',
  'chatQuiz.tapOrderShort': 'Tap to type',
  'chatQuiz.tapGaps': 'Tap to fill the gaps',
  // QUIZ-INB-2.1 — under the delayed speaker beside the bubble.
  'chatQuiz.hint': 'Hint',
  'chatQuiz.dismiss': 'Dismiss quiz',
  'chatQuiz.correct': 'Correct!',
  'chatQuiz.wrong': 'Not quite. It’s {answer}',
  'chatQuiz.why': 'Why?',
  'chatQuiz.more': 'More practice',
  'chatQuiz.changeFrequency': 'Change frequency',
  // QUIZ-FREQ-6 — the prompt under the bubble after a skip.
  'chatQuiz.lessOften': 'See this less often?',
  'chatQuiz.lessOftenDismiss': 'Dismiss',
  'chatQuiz.save': 'Save as flashcard',
  'chatQuiz.saved': 'Saved',
  'chatQuiz.frequency.title': 'How often should these appear?',
  'chatQuiz.frequency.off': 'Off',
  'chatQuiz.frequency.always': 'Every time',
  'chatQuiz.frequency.every': '1 in {n}',
  'chatQuiz.frequency.hint': 'You can change this in Settings any time.',
  'chatQuiz.settings.label': 'Chat quiz',
  'chatQuiz.settings.hint': 'A quick question after some messages you send in your own language.',
  // QUIZ-FREQ-7 — free users: the row is locked; the link opens the Plus sheet.
  'chatQuiz.settings.plusExplainer': 'Chat quizzes come with Wurld Plus.',
  'chatQuiz.settings.seeIncluded': 'See what’s included',
  // SAFETY-* — block, report, the More menu (docs/specs/safety.md).
  'safety.block': 'Block {name}',
  'safety.unblock': 'Unblock {name}',
  'safety.blockConfirmTitle': 'Block {name}?',
  'safety.blockConfirmBody': "They won't be able to message you, and you won't get notifications from them. Your chat with them is hidden from your chat list (not deleted) until you unblock. They won't be told.",
  'safety.blockConfirm': 'Block',
  'safety.blockedToast': '{name} blocked',
  'safety.unblockedToast': '{name} unblocked',
  'safety.blockFailed': "Couldn't update the block. Please try again.",
  'safety.report': 'Report {name}',
  'safety.reportMessage': 'Report',
  'safety.reportTranslation': 'Report translation',
  'safety.reportExplanation': 'Report this explanation',
  'safety.reportAi': 'Report a problem with AI content',
  'safety.reportTitleMessage': 'Report message',
  'safety.reportTitleUser': 'Report {name}',
  'safety.reportTitleExplanation': 'Report explanation',
  'safety.reportTitleAi': 'Report AI content',
  'safety.reportWhy': "What's wrong?",
  'safety.reason.harassment': 'Harassment or bullying',
  'safety.reason.hate': 'Hate speech',
  'safety.reason.sexual': 'Sexual content',
  'safety.reason.violence': 'Violence or threats',
  'safety.reason.spam': 'Spam or scam',
  'safety.reason.impersonation': 'Pretending to be someone else',
  'safety.reason.ai_offensive': "AI output that's offensive or harmful",
  'safety.reason.ai_wrong': "AI translation or explanation that's wrong",
  'safety.reason.other': 'Something else',
  'safety.reportNote': 'Add details (optional)',
  'safety.reportAiText': 'What did the app show? Paste or describe it.',
  'safety.reportAlsoBlock': 'Also block {name}',
  'safety.reportShareMessage': "Your report sends this message, including any photos, and the messages before it to Wurld's admins for review.",
  'safety.reportShareUser': "Your report sends {name}'s recent messages in this chat to Wurld's admins for review.",
  'safety.reportShareAi': "Your report sends the text above to Wurld's admins for review.",
  'safety.reportSubmit': 'Send report',
  'safety.reportSending': 'Sending…',
  'safety.reportThanks': 'Thanks for reporting. We review every report within 24 hours.',
  'safety.reportLimit': "You've sent a lot of reports today. Please try again tomorrow.",
  'safety.reportFailed': "Your report didn't send. Please try again.",
  'safety.leaveGroupsTitle': 'Leave groups with {name}?',
  'safety.leaveGroupsBody': "You're both in these groups. If you stay, their messages there are hidden for you.",
  'safety.leaveGroupsSoleAdmin': "You're the only admin",
  'safety.leaveGroupsLeave': 'Leave selected groups',
  'safety.leaveGroupsStay': 'Stay in them',
  'safety.leftGroupsToast': 'You left the selected groups',
  'safety.leaveGroupsFailed': "Couldn't leave one of the groups. You can leave it from its info screen.",
  'safety.blockedBar': 'You blocked {name}.',
  'safety.unblockAction': 'Unblock',
  'safety.blockedMessage': 'Message from someone you blocked',
  'safety.show': 'Show',
  'safety.notDelivered': 'Not delivered',
  'safety.blockedPeople': 'Blocked people',
  'safety.blockedPeopleEmpty': "You haven't blocked anyone.",
  'safety.title': 'Safety',
  'safety.help': 'To block someone, open their contact or your chat info and tap Block. To report a message, press and hold it, tap More, then Report. We review every report within 24 hours.',
  'safety.communityStandards': 'Community standards',
  'safety.contact': 'Contact us at {email}',
  'safety.more': 'More',
  'safety.back': 'Back',
  'safety.original': 'Original',
  'safety.messageDetails': 'Message details',
  'safety.sentAt': '{date} at {time}',
} as const;

/** Keys are derived from the source-of-truth object, but values are
 *  widened to `string` so locale files (which carry translated values
 *  of the SAME keys) can assign to the same type. Without the widen
 *  every locale would need to literal-type-match the English string,
 *  which is the opposite of the point. */
export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export default en as Messages;
