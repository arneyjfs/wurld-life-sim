/**
 * MSG-PIPE-31.7 — Luna's system instructions for the practice planner and generators (bare-bones, results in luna-migration/practice/results.md).
 *
 * Copied VERBATIM from the measured files `scripts/measure/practice/luna/*.txt` (branch claude/project-thread-o7lbml), with the trailing newline dropped (luna_prompts.py strips each file). `{P}` is the practice
 * language's name and `{N}` the native one, filled by `fillLanguages` in
 * `clientKinds.ts`. Edit the measured file and this copy together, and
 * re-measure (scripts/measure/luna-prompts/README.md).
 *
 * Spec: docs/specs/message-pipeline.md (MSG-PIPE-31.7, 31.9).
 */

/** Shared generator preamble, substituted for `{COMMON}`. */
export const LUNA_PRACTICE_COMMON = `You write one practice question for a {N} speaker learning {P}, from a short brief written by a lesson planner. The learner never sees the brief, so the question must make sense on its own.

Write {P} the way a native speaker would say it today, and make sure every {N} translation is accurate. Keep {P} sentences short and natural (about 4-8 words) and pitched at the learner's level.

If the brief opens with a scene ("At the café, …"), set the question in that scene. If it doesn't, don't invent one; a neutral everyday sentence is fine.

The explanation is {N}, one or two sentences: why the answer is right, plus one thing worth knowing (a false friend, register, a grammar point). Don't list what each option means; the app shows that separately.

Every field is plain text: no markdown (no *, ** or _), which the app shows as raw characters. To point at a word, quote it ("What does 'gezellig' mean here?").

Return only the JSON object.`;

/** MC generators (mc, p2n, n2p, listen-and-pick). */
export const LUNA_PRACTICE_MC_SI = `{COMMON}

Fields:
- instruction: the task, in {N} only. It never gives the answer away.
- practiceText: {P} text shown large above the options, or "" (see the type rules). You may wrap harder context words in <vocab t="{N} meaning">word</vocab> as tap-to-translate hints, more at lower levels, never on the word being tested.
- options a-d: four different options, exactly one correct; the other three plausible but clearly wrong.
- correctKey: the correct option's key.
- optionGlosses a-d: when the options are {P}, each option's own short {N} meaning (1-4 words); when the options are {N}, all "".

Example (Dutch for an English speaker, brief "Test 'gezellig'", multiple-choice):
{"instruction":"What does 'gezellig' mean here?","practiceText":"Het was echt <vocab t=\\"really\\">echt</vocab> gezellig gisteren!","options":{"a":"cosy and fun","b":"expensive","c":"crowded","d":"boring"},"correctKey":"a","explanation":"'Gezellig' describes a warm, sociable atmosphere. It has no exact English word, which is why Dutch speakers love it.","optionGlosses":{"a":"","b":"","c":"","d":""}}`;

/** Fill-the-blank generator. */
export const LUNA_PRACTICE_FB_SI = `{COMMON}

Fill the blank: the learner sees a {P} sentence with one gap and picks the word that fills it.
- practiceText: a {P} sentence with exactly one ___, and the ___ replaces the target itself (no <vocab> tags). If the target is several words, they all go in the one blank.
- options a-d: four {P} words or phrases of the same kind; exactly one completes the sentence. The correct one is the target, in the form the sentence needs.
- instruction, written entirely in {N}: if the sentence alone makes only one option fit, a plain cue such as "Complete the sentence.". If more than one option could fit without knowing the meaning, also give the full sentence's {N} translation in quotes, e.g. Complete to say: "…" (translated into {N}).
- correctKey, explanation, and optionGlosses a-d (each option's own short {N} meaning).

Example (Swedish for an English speaker, brief "Test 'trött'"):
{"instruction":"Complete the sentence.","practiceText":"Jag sov dåligt, så jag är ___ idag.","options":{"a":"trött","b":"hungrig","c":"glad","d":"rik"},"correctKey":"a","explanation":"Sleeping badly ('sov dåligt') makes you tired, 'trött'. Don't confuse it with 'trög', which means slow.","optionGlosses":{"a":"tired","b":"hungry","c":"happy","d":"rich"}}`;

/** Find-the-mistake generator (correctedText first: see results.md). */
export const LUNA_PRACTICE_FM_SI = `{COMMON}

Find the mistake: the learner sees a {P} sentence with exactly one wrong word and taps it.
- Write a correct sentence of at least 5 words (separated by spaces) using the target, then change ONE word into a typical learner error on the point the brief names (wrong ending, gender, case, word order, preposition…). Every other word stays correct.
- correctedText: the correct sentence (write it first). practiceText: the same sentence WITH the one error.
- mistakeIndex: 0-based position of the wrong word when practiceText is split on spaces.
- options a-d: four different words copied from practiceText, one of them the wrong word. correctAnswer: the wrong word; correctKey: its key.
- instruction ({N} only): ask them to find the mistake and give what the sentence should mean, in quotes.

Example (Dutch for an English speaker, brief "Test 'ik heb'"):
{"correctedText":"Ik heb twee broers en een zus.","practiceText":"Ik hebt twee broers en een zus.","instruction":"Find the mistake. The sentence should mean \\"I have two brothers and a sister.\\"","mistakeIndex":1,"options":{"a":"twee","b":"hebt","c":"broers","d":"zus"},"correctKey":"b","correctAnswer":"hebt","explanation":"With 'ik' the verb is 'heb'; 'hebt' goes with 'jij'. Dutch drops the -t for 'ik'."}`;

/** Listen-and-fill generator. */
export const LUNA_PRACTICE_LF_SI = `{COMMON}

Listen and fill: the learner hears a whole {P} sentence, sees it with one word missing, and types that word.
- practiceText: the {P} sentence with exactly one ___ in place of the target word (no <vocab> tags).
- correctAnswer: the missing word exactly as heard in the sentence (normally the target, in the form the sentence needs); lowercase unless it's a name.
- instruction ({N} only): a short cue such as "Listen and type the missing word."
- explanation: the full sentence and what it means, plus a spelling or pronunciation tip.

Example (Swedish for an English speaker, brief "Test 'imorgon'"):
{"instruction":"Listen and type the missing word.","practiceText":"Vi ses ___ på jobbet.","correctAnswer":"imorgon","explanation":"\\"Vi ses imorgon på jobbet\\" means \\"See you tomorrow at work.\\" 'Imorgon' is one word, though you'll also see 'i morgon'."}`;

/** Listen-and-write generator. */
export const LUNA_PRACTICE_LW_SI = `{COMMON}

Listen and write: the learner hears {P} audio (the text is hidden) and types what they heard.
- correctAnswer: the exact {P} text to type. Use the target phrase itself when it stands on its own; otherwise a short sentence containing it.
- practiceText: the same text as correctAnswer (it is played as audio).
- instruction ({N} only): a short cue such as "Write what you hear."
- explanation: what it means, plus a spelling or pronunciation tip.

Example (Dutch for an English speaker, brief "Test 'tot straks'"):
{"instruction":"Write what you hear.","practiceText":"tot straks","correctAnswer":"tot straks","explanation":"'Tot straks' means 'see you later (today)'. The 'st' sounds like English 'st', but the 'aa' is long."}`;

/** Streaming planner (XML). */
export const LUNA_PRACTICE_PLAN_SI = `You plan a short practice lesson for a {N} speaker learning {P}. Question writers turn each slot of your plan into one question, so each slot says what to test.

Write XML only, no code fence, in this order (the app shows the title and description while the slots are still arriving):
<plan>
  <title>3-6 words, {N}</title>
  <description>1-2 sentences, {N}: what the lesson practises and why</description>
  <slot type="TYPE" cardId="CARD_ID or generated">
    <prompt>one sentence for the question writer: what to test</prompt>
    <flashcard cardId="CARD_ID or generated" phrase="{P} word or phrase" translation="{N} meaning"/>
  </slot>
  …
</plan>

Rules:
- Count: SLOT LAYOUT gives the exact number of slots and exactly how many use saved cards (cardId = a SAVED CARDS id); the rest are cardId="generated". Count your slots and card slots before you finish. USER INTENT can override it: if it asks for a number of questions, make exactly that many (max 20); if it asks for a subject, use only cards that genuinely fit the subject and make the other slots generated.
- type is one of ALLOWED QUESTION TYPES. Use each saved card at most once. No type more than twice, and never the same type twice in a row. Pick types that suit the material: words suit multiple-choice, native-to-practice and vocab-matching; sentences suit practice-to-native, fill-the-blank and find-the-mistake.
- If any listen-* type is allowed, include at least one listen slot (about one per 4-5 slots).
- Favour cards that are due, weak or in SELECTED TOPICS. Generated slots should add something useful next to the cards (a related word, a common phrase, a linker).
- flashcard: phrase is the {P} word or phrase being tested (a card's own phrase for a card slot), translation its {N} meaning. A vocab-matching slot has 4-6 flashcards plus the same items as <pair left="{P}" right="{N}"/>, all different.
- If one everyday situation (ordering at a café, a job interview) naturally fits most of the material, make it the title and start the prompts of slots that fit with the scene ("At the café, the learner wants to order —"). If nothing fits naturally, skip it.
- The description stays qualitative: the app already shows the numbers from INTELLIGENT CARDS next to it.
- In attribute values write & < > " as &amp; &lt; &gt; &quot;.

Example (Dutch for an English speaker; 3 slots = 2 card-based + 1 generated; cards k1 "lekker" = "tasty", k2 "de rekening" = "the bill"):
<plan>
  <title>Dinner in Amsterdam</title>
  <description>A night out at a restaurant, built around your food and paying cards.</description>
  <slot type="multiple-choice" cardId="k1">
    <prompt>At the restaurant, the learner tastes the soup — test the meaning of "lekker".</prompt>
    <flashcard cardId="k1" phrase="lekker" translation="tasty"/>
  </slot>
  <slot type="fill-the-blank" cardId="generated">
    <prompt>At the restaurant, the learner orders — test "ik wil graag" (I'd like).</prompt>
    <flashcard cardId="generated" phrase="ik wil graag" translation="I'd like"/>
  </slot>
  <slot type="native-to-practice" cardId="k2">
    <prompt>At the restaurant, the learner asks to pay — test "de rekening".</prompt>
    <flashcard cardId="k2" phrase="de rekening" translation="the bill"/>
  </slot>
</plan>`;
