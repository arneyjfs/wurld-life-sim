/**
 * THE MARK SCHEME — what each band MEANS, per dimension, in observable terms.
 *
 * ── WHY THIS REPLACED THE WORD-COUNTING ─────────────────────────────────────
 *
 * Three checks in this benchmark tried to score a narrative property by looking
 * for words, and all three failed the same way. OPT-LEAK flagged "break room"
 * and "still works" as leaked story, at false-positive rates of 28-67%, and was
 * deleted. CLICHE matched `ash` inside "wash" and "cash", `final` inside
 * "finally", and scored 0/4 on two worlds whose prose was fine. In both cases
 * the property being measured — has the player seen this? is this word doing
 * concrete work or supplying mood? — is a question about MEANING, and a
 * substring test cannot hold an opinion about meaning.
 *
 * A judge can. What a judge cannot do unaided is hold the SAME opinion twice:
 * asked "rate this 0-4", it drifts with the phrasing of the transcript, the
 * order of the dimensions, and its own mood. That drift is what makes an LLM
 * score useless as a trend line, which is the only thing this benchmark is for.
 *
 * ── THE FOUR CONSISTENCY MECHANISMS ─────────────────────────────────────────
 *
 * 1. BANDS ARE DEFINED PER DIMENSION, not once for the whole scale. "3 = good"
 *    means nothing; "3 = at least one option visibly redirected the scene, and
 *    you can name the beat that would not otherwise have happened" is checkable.
 *
 * 2. EACH DIMENSION HAS A PROCEDURE — what to look at, in what order, before
 *    forming a view. A judge that reads the whole transcript and then feels a
 *    number is sampling its own impression; one that walks a defined list is
 *    doing the same work twice on two different runs.
 *
 * 3. ANCHORS ARE REAL. Every band that has one quotes an actual line from a
 *    real playthrough, not an invented illustration. Invented anchors drift
 *    toward the archetype of the failure; real ones sit where the work sits.
 *
 * 4. EVIDENCE IS STILL VERIFIED. `verifyEvidence` continues to cap any 3 or 4
 *    whose quote is not in the transcript. The mark scheme tells the judge how
 *    to decide; the quote check keeps it honest about having decided at all.
 *
 * WHEN A BAND IS AMBIGUOUS, THE LOWER ONE WINS. Written down because "it could
 * be a 3" resolves upward every time otherwise, and a rubric that drifts up has
 * no room left to show improvement.
 */

export type Bands = {
  /** What to examine, in order, before scoring. */
  procedure: string;
  /** 0-4, each stated as an observable condition. Index === score. */
  bands: [string, string, string, string, string];
  /** A real line from a real run, and the band it sits in. */
  anchor?: { band: number; quote: string; why: string };
};

/**
 * INTENT gets the fullest treatment because it is the dimension the product
 * owner named as the top concern, and because it is the one most easily scored
 * from a general impression: a transcript in which every reply mentions what
 * the player just did FEELS responsive, whether or not anything changed.
 *
 * The procedure is built to defeat exactly that. Acknowledgement is band 2 —
 * the NPC repeating your choice back is the competent default, not a success.
 * The question is whether the scene would have been different, and the only way
 * to ask it is to look at the options NOT taken.
 */
const INTENT: Bands = {
  procedure: [
    'Find every turn that offered 2+ options. For each one:',
    '(a) read the option that was taken, and the beats on the FOLLOWING turn;',
    '(b) read the options that were NOT taken, and ask what the following turn would have looked like had one of those been picked instead;',
    '(c) decide which of these three it is:',
    '    ACKNOWLEDGED — the reply refers to the pick, but the scene is in the same place it would have been either way ("Good, take the wheelbarrow");',
    '    REDIRECTED — the pick changed WHERE the scene went, WHO was in it, WHAT was at stake, or what the player now knows;',
    '    IGNORED — the reply would read identically if a different option had been picked, or contradicts the pick.',
    'The line between the first two is narrow and you must hold it exactly where it is written. "Pick up the bread" → the next beat is the player picking up the bread: ACKNOWLEDGED, however precise and well-written. "Pick up the bread" → the player picks it up AND the baker follows them out to ask about it: REDIRECTED — someone new is in the scene who would not have been.',
    'Apply the four tests literally. A pick that moves the scene to a different place, or puts a different person in front of the player, IS a redirect — it satisfies "changed WHERE" / "changed WHO" as written. Do not discount it as too small to count; the bands below do the weighting, not you.',
    'Score on the ratio, weighting the scene\'s pivotal turns (the ones where something was actually at stake) far above its connective ones.',
  ].join('\n'),
  bands: [
    'IGNORED is common. The story runs on rails: picks are not reflected at all, or the same next beat arrives regardless. A player would stop reading the options.',
    'Almost everything is ACKNOWLEDGED and nothing is REDIRECTED. Every reply names what you did and then proceeds with what was going to happen anyway.',
    'ACKNOWLEDGED throughout: every pick is answered precisely and the scene then proceeds where it was going anyway. NO pick met the REDIRECTED test — nothing changed where the scene went, who was in it, what was at stake, or what the player knows. This is the DEFAULT — being answered is the floor, not an achievement.',
    'At least one pick met the REDIRECTED test, and you can name the beat that would not otherwise have happened. Quote it. A change of place, or of who the player is now with, COUNTS here — it is a redirect by the procedure\'s own definition. (This band used to read "at most an incidental redirect (a different room, the same conversation)" at band 2, which contradicted that definition and pushed genuine redirects down a band. It does not any more.)',
    'Redirection is the norm at the pivotal turns, and at least one pick changed what the SCENE ended up being about — visible in the closing line. Rare.',
  ],
  anchor: {
    band: 2,
    quote: "Bien. C'est lourd, alors prends la brouette qui est derrière le hangar.",
    why: 'The reply to "Offer to carry the equipment" — it answers the pick precisely and courteously, and the scene is exactly where it would have been if the player had asked about the pump instead. Textbook ACKNOWLEDGED. A judge scoring on responsiveness alone would call this a 3.',
  },
};

const OPT_FREEDOM: Bands = {
  procedure: [
    'For each option grid, ask whether the options differ in KIND of move or only in wording.',
    'Three ways of asking the same person the same thing is one option presented three times.',
    'Check also whether any option lets the player decline, leave, or do something the scene did not invite.',
  ].join('\n'),
  bands: [
    'Every grid is one move in three costumes. There is no choice being made.',
    'Grids differ in wording but converge on the same next beat.',
    'Grids offer genuinely different moves, all of them ones the scene invited. The DEFAULT.',
    'At least one grid offered a move that went against the scene\'s pull — refusing, leaving, changing the subject — and it was a real option, not a dead end.',
    'The player could consistently pursue their own agenda rather than the scene\'s. Rare.',
  ],
};

const OPT_LEAK: Bands = {
  procedure: [
    'THIS IS A GATE. Read the options against everything the player has been shown UP TO THAT TURN — beats, earlier options, and anything the turn itself introduced.',
    'Flag an option that names a person, place, object or fact the player has not encountered.',
    'Do NOT flag ordinary vocabulary for the move itself ("carry the equipment", "check the seals") — a word being new is not a thing being leaked. The question is whether the STORY has shown it.',
    'A code check was tried for this and deleted for exactly that confusion; you are here because you can tell the difference.',
  ].join('\n'),
  bands: [
    'Options routinely name things the player has never seen. The grid is written from the model\'s notes rather than the player\'s view.',
    'More than one clear leak.',
    'One borderline case, or none. The DEFAULT.',
    'No leaks, and the options draw specifically on things the player was shown.',
    'No leaks, and at least one option references something established several scenes earlier. Rare.',
  ],
  anchor: {
    band: 0,
    quote: 'Ask about the hidden conductive wire',
    why: 'The reported production failure. The basket was shown; the wire was never mentioned by anyone. This is the shape to look for.',
  },
};

const PROSE: Bands = {
  procedure: [
    'Read only the narration and dialogue, ignoring options and questions.',
    'Ask: does any sentence do something a competent generic sentence would not? Is anything observed specifically, rather than described generally?',
    'Then ask the opposite: how much of this is reaching for mood — portent, weather standing in for feeling, abstractions used as nouns.',
    'A ban on the portentous-noun family is in the prompt, so ALSO note whether those words appear doing real concrete work (fine) or supplying atmosphere (not).',
  ].join('\n'),
  bands: [
    'Overwritten throughout, or generic throughout. Reads like the median of all generated fiction.',
    'Competent sentences reaching regularly for mood they have not earned.',
    'Clear, functional, unremarkable. Nothing wrong; nothing anyone would quote. The DEFAULT for this genre.',
    'At least one specific, observed detail that belongs to this story and no other. Quote it.',
    'Sustained specificity — the prose is a reason to keep reading. Rare.',
  ],
  anchor: {
    band: 2,
    quote: "Luc's truck is an old model covered in dust. The engine is smoking gently under the sun, and a strong smell of diesel floats in the still air.",
    why: 'Three concrete details, all of them the first three anyone would pick for a hot afternoon and an old truck. Competent and unremarkable — the honest 2. Not a 3: nothing here belongs to this story rather than any story with a truck in it.',
  },
};

const CHARACTER: Bands = {
  procedure: [
    'List who speaks. For each, read their lines consecutively, ignoring everything between.',
    'Ask whether you could swap two characters\' lines without noticing.',
    'Separate SPEECH from FUNCTION: a character can be well-drawn and still exist only to hand over information — note which.',
  ].join('\n'),
  bands: [
    'One narrator voice wearing name badges.',
    'Characters are distinguished by role only; their lines are interchangeable.',
    'Each principal has a consistent register and manner. The DEFAULT.',
    'At least one character says something only they would say, in a way that reveals what they want. Quote it.',
    'The cast disagrees with itself in character — two people wanting different things and audibly being different people. Rare.',
  ],
};

const Q_TIMING: Bands = {
  procedure: [
    'For each graded question, read the two turns BEFORE it.',
    'Ask whether a line was on the table that the question could attach to — someone about to speak, someone having just spoken, something being read.',
    'A question is badly timed when it interrupts an action, arrives mid-movement, or tests a line nobody had reason to say.',
    'Note that cadence (how OFTEN) is measured separately — score only the FIT of each question to its moment.',
  ].join('\n'),
  bands: [
    'Questions arrive with no line in reach. Pop quizzes stapled to the story.',
    'Most questions attach to something, but several interrupt.',
    'Questions sit on real lines, at moments where speech or listening was happening anyway. The DEFAULT.',
    'At least one question lands on a moment the scene had built to — the line mattered, and being made to produce it added to it. Quote it.',
    'Consistently so. The graded moments are the story\'s moments. Rare.',
  ],
};

const LEARN_VALUE: Bands = {
  procedure: [
    'List what each question actually tested — the target word or the utterance to interpret.',
    'Ask of each: is this worth a learner\'s time at this difficulty? Would they meet it again?',
    'Penalise testing function words, proper nouns, and anything answerable without reading the practice language.',
  ].join('\n'),
  bands: [
    'The targets are trivial, or answerable from the gloss alone.',
    'Targets are real words but mostly ones a learner at this level already has.',
    'Targets are appropriate and varied. The DEFAULT.',
    'At least one target is a genuinely useful piece of the language — an idiom, a construction, a word that carries its context. Quote it.',
    'The set as a whole would leave a learner measurably better off. Rare.',
  ],
};

const Q_QUALITY: Bands = {
  procedure: [
    'For each question, read the stem and the choices.',
    'Ask whether the correct answer is derivable from the context shown, and whether the distractors are genuinely wrong.',
    'A distractor that is also correct, or one obviously absurd, both make the question free.',
  ].join('\n'),
  bands: [
    'Questions are unanswerable from context, or have more than one correct answer.',
    'Distractors are transparently wrong; the question costs no thought.',
    'Answerable, single correct answer, plausible distractors. The DEFAULT.',
    'At least one question whose distractors encode a real confusion a learner of this language would have. Quote it.',
    'Consistently so. Rare.',
  ],
};

const HUMOUR: Bands = {
  procedure: [
    'Find every moment intended to be funny. If there are none, that is a finding, not automatically a failure — judge against the register the world declared.',
    'Ask whether the humour arises from character and situation, or is inserted.',
  ].join('\n'),
  bands: [
    'Jokes that are not jokes, or comedy in a register the scene cannot carry.',
    'Isolated attempts that land flat.',
    'Either appropriately dry throughout, or light where the scene allows. The DEFAULT.',
    'At least one moment that is actually funny, and funny because of who these people are. Quote it.',
    'A consistent comic sensibility. Rare.',
  ],
};

const DRAMA_FIT: Bands = {
  procedure: [
    'Place each scene on the story\'s clock — how far in is it, what has been established.',
    'Ask whether the stakes at that point are proportionate: a thriller beat on day one is as wrong as nothing at all by day ten.',
  ].join('\n'),
  bands: [
    'Melodrama from a standing start, or no stakes at any point.',
    'Stakes arrive before anything has earned them, or lag well behind the story.',
    'Stakes broadly track the story\'s progress. The DEFAULT.',
    'At least one moment where the drama is exactly proportionate — small because the scene is small, or large because the story has built to it. Quote it.',
    'The escalation is legible across the whole run. Rare.',
  ],
};

const INTRIGUE: Bands = {
  procedure: [
    'At the end of each scene, ask: what would make someone take another turn?',
    'Distinguish a QUESTION the player wants answered from a mere withholding of information.',
  ].join('\n'),
  bands: [
    'Nothing pulls. The story could stop anywhere.',
    'Interest is manufactured by withholding rather than by anything wanting to happen.',
    'There is generally a reason to continue. The DEFAULT.',
    'At least one scene ends with a question the player would actually want answered. Quote it.',
    'Sustained. Rare.',
  ],
};

const COHERENCE: Bands = {
  procedure: [
    'THIS IS A GATE. Read the scene summaries in order, then the cast descriptions.',
    'Flag: a fact contradicted later; a character acting against their own stated description or wants; a place changing its nature; time moving backwards.',
    'Do NOT flag a character CHANGING — people change. Flag a character being inconsistent without the story noticing.',
  ].join('\n'),
  bands: [
    'Scenes contradict each other, or a principal repeatedly acts against their own description.',
    'One clear contradiction the story does not acknowledge.',
    'Consistent. The DEFAULT.',
    'Consistent, and at least one later scene depends on a detail established earlier. Quote it.',
    'The world holds together tightly enough that the callbacks feel planned. Rare.',
  ],
};

const PACING: Bands = {
  procedure: [
    'Read the scene summaries as a sequence. Mark where the story accelerates and where it sits.',
    'The middle is where this fails — check scenes 3 through 6 specifically.',
  ].join('\n'),
  bands: [
    'Sags badly or sprints past the material.',
    'Noticeable dead stretch, or events arriving faster than they can register.',
    'Moves at a steady rate; nothing drags conspicuously. The DEFAULT.',
    'The rhythm varies deliberately — a quiet scene doing quiet work next to a scene that moves. Quote the quiet one.',
    'Sustained control of rhythm across the run. Rare.',
  ],
};

const ARC: Bands = {
  procedure: [
    'Read the scene summaries as a list. Ask whether scene 6 depends on scene 2.',
    'A sequence of events is not an arc. An arc means the situation at the end is a consequence of the situation at the start.',
  ].join('\n'),
  bands: [
    'A list of unrelated episodes.',
    'Events share a setting and cast but do not build.',
    'A discernible through-line; later scenes follow from earlier ones. The DEFAULT.',
    'Something introduced early pays off later in a way the player would notice. Quote both ends.',
    'The whole run reads as one story with a shape. Rare.',
  ],
};

const ENDING: Bands = {
  procedure: [
    'Read the final scene and its summary.',
    'Ask whether the outcome follows from what the player did, and whether anything was actually settled.',
    'IMPORTANT: this run may have been stopped by the harness at a fixed turn count rather than at a natural end. If the last scene reads as cut off mid-action rather than concluded, say so in `note` and score the ENDINGS OF EARLIER SCENES instead — do not score the harness\'s cut as an authorial failure.',
  ].join('\n'),
  bands: [
    'Scenes stop rather than end. Outcomes are arbitrary or unearned.',
    'Endings arrive but are not consequences of anything.',
    'Scenes land; outcomes follow from events. The DEFAULT.',
    'At least one scene ends on a consequence the player brought about. Quote it.',
    'Endings that are both surprising and inevitable. Rare.',
  ],
};

const CAST_DEPTH: Bands = {
  procedure: [
    'For each principal, ask: what do they want, independently of the player?',
    'Then: does the story ever show them pursuing it when it is inconvenient for the player?',
  ].join('\n'),
  bands: [
    'Everyone exists to serve the player\'s turn.',
    'Characters have stated wants that never affect their behaviour.',
    'Principals have consistent wants that occasionally shape what they do. The DEFAULT.',
    'At least one character pursued their own interest against the player\'s. Quote it.',
    'The cast has a life the player is only part of. Rare.',
  ],
};

const CLICHE: Bands = {
  procedure: [
    'Read only the narration and dialogue.',
    'Count two distinct things: (a) stock idioms in dialogue — the lines a character says when the writer has not decided who they are; (b) the portentous-noun family (echo, shadow, silence, whisper, ash, dust, veil, the weight of, …) used as ATMOSPHERE.',
    'A banned noun doing concrete work is NOT a hit: a dusty toolbox is a toolbox, a burnt house has ash on it. A code check was deleted for failing exactly this distinction — "wash-house" and "cash flow" were counted as `ash`. The abstract slot is the target.',
  ].join('\n'),
  bands: [
    'Built from stock phrases. The prose announces itself as generated.',
    'Several clear reaches for the portentous family, or a stock idiom in a character\'s mouth.',
    'The occasional reach, mostly in narration. The DEFAULT.',
    'Clean — banned vocabulary appears only where it is doing concrete work, if at all.',
    'Clean, and the prose finds its own images where the stock one was available. Quote one. Rare.',
  ],
  anchor: {
    band: 1,
    quote: 'You breathe deeply, conscious of the weight of his condition.',
    why: '"The weight of" is the portent construction with no concrete reading — this is the abstract slot, and it recurred four times across two worlds. Contrast "covered in dust" on a truck, which is a truck.',
  },
};

const BACKDROP_FIT: Bands = {
  procedure: [
    'For each backdrop, compare its label and the scene\'s subject against what the SVG actually depicts.',
    'Flag a backdrop that contradicts the prose (a break room rendered as a smoking area behind a laundry).',
  ].join('\n'),
  bands: [
    'Backdrops contradict their scenes.',
    'Backdrops are generic placeholders unrelated to the specific place.',
    'Backdrops match their scene type. The DEFAULT.',
    'At least one backdrop depicts the specific place the prose described. Quote the matching detail.',
    'Consistently specific. Rare.',
  ],
};

const BIO_FIT: Bands = {
  procedure: [
    'For each avatar bio, read it against everything that character actually did.',
    'Flag a bio that contradicts their behaviour, or that is generic enough to fit anyone.',
    'A bio that failed to generate is a FAILURE to report, not a quality score — say so in `note`.',
  ].join('\n'),
  bands: [
    'Bios contradict the characters, or are missing.',
    'Bios are generic role descriptions.',
    'Bios agree with behaviour. The DEFAULT.',
    'At least one bio captures something the character demonstrated. Quote both.',
    'Consistently so. Rare.',
  ],
};

const QUESTION_VALUE: Bands = {
  procedure: [
    'Read the graded questions as a set, ignoring where they fell.',
    'Ask: as a vocabulary session for this learner at this difficulty, was this a good hour?',
  ].join('\n'),
  bands: [
    'The set teaches nothing.',
    'Repetitive, or pitched wrong for the difficulty.',
    'A reasonable spread at roughly the right level. The DEFAULT.',
    'The set has a shape — related constructions, useful collocations. Quote two that work together.',
    'A session a teacher would have designed. Rare.',
  ],
};

export const MARK_SCHEME: Record<string, Bands> = {
  INTENT,
  'OPT-FREEDOM': OPT_FREEDOM,
  'OPT-LEAK': OPT_LEAK,
  PROSE,
  CHARACTER,
  'Q-TIMING': Q_TIMING,
  'LEARN-VALUE': LEARN_VALUE,
  'Q-QUALITY': Q_QUALITY,
  HUMOUR,
  'DRAMA-FIT': DRAMA_FIT,
  INTRIGUE,
  COHERENCE,
  PACING,
  ARC,
  ENDING,
  'CAST-DEPTH': CAST_DEPTH,
  CLICHE,
  'BACKDROP-FIT': BACKDROP_FIT,
  'BIO-FIT': BIO_FIT,
  'QUESTION-VALUE': QUESTION_VALUE,
};

/** The scheme for one dimension, rendered for the judge prompt. */
export function renderBands(id: string): string {
  const m = MARK_SCHEME[id];
  if (!m) return `- ${id} — (no mark scheme; score on the failure description alone)`;
  const bands = m.bands.map((b, i) => `    ${i} — ${b}`).join('\n');
  const anchor = m.anchor
    ? `\n  ANCHOR (band ${m.anchor.band}), from a real run: "${m.anchor.quote}"\n    ${m.anchor.why}`
    : '';
  return `${id}\n  HOW TO LOOK:\n${m.procedure.split('\n').map((l) => `    ${l}`).join('\n')}\n  BANDS:\n${bands}${anchor}`;
}
