# Story generation — where it sits between "fully mapped" and "fully emergent"

An audit of every mechanism from world-creation down to the option grid, sorted by
which direction it pulls. Written as an inventory to design from, not a proposal.

Companion to `docs/specs/life-sim.md`. Where this doc disagrees with a comment in
the code, the code is the fact and this doc is the reading of it.

---

## 1. The short answer

**The design sits much closer to "fully mapped" than its own documentation claims,
and the sameness the player feels is mostly NOT coming from the map.**

Three separate things are true at once, and conflating them is what makes this
problem feel intractable:

1. **The planning stack is deep.** Four layers — universe → saga → chapter → scene
   outline — and three of them are frozen artefacts that ride into *every single
   turn*. The turn model has less authority than the phrase "the scene is a
   SCENARIO, not a script" implies. It improvises sentences inside a fixed frame;
   it does not shape the frame.

2. **The plan is not what produces the cliché.** The saga generator is *actively
   fighting* formula (banned lexicon, name tests, genre spread, the ordinary
   world). The cliché arrives from the model's median at the sentence and
   situation level, and from structural repetition that no layer measures.

3. **The genuine directionlessness is local, not global.** The world always has a
   through-line. What it lacks is any evidence *reaching the player* that their
   choices changed anything — because the one adaptive mechanism (`sceneReplan`)
   is blind to the story it is adapting, and the option space only ever narrows.

So the axis the problem lives on is not "mapped ↔ emergent". It is closer to:

> **How much of the variance between two playthroughs is decided by the player,
> versus decided by the sampler?**

Right now: the *skeleton* is identical between playthroughs (fixed counters), the
*flesh* is sampled (fresh each time but drawn from a median), and the *player's
contribution* is confined to which of 2-3 pre-labelled actions happens next inside
a scene whose ending set can only shrink.

---

## 2. The map — what generates what, and what survives

| Layer | Call | Fires | Lifetime | Rides into every turn? |
|---|---|---|---|---|
| **Universe** | `worldSagaGenerate` (same call) | once, at creation | forever, immutable | **yes** — `renderUniverse`, incl. `laws` |
| **Saga** | `worldSagaGenerate` | once, at creation | forever, immutable | **yes** — `renderSaga`, pillars gated by stage |
| **Chapter** | `worldArcGenerate` | once per chapter | ~25-40 turns | **yes** — `renderScene`'s idle block / arc block |
| **Scene outline** | `sceneGenerate` | once per scene | ~6-12 turns | **yes** — `renderScene` |
| **Scene outline (revised)** | `sceneReplan` | ~10 turns / on drift / on pivot | replaces outline | (same block) |
| **Node + options** | `lifeStep` `<turn kind=…>` | every turn | one turn | — |
| **Option chips only** | `lifeStep` `<turn kind="options">` | when node arrived without options | one turn | — |
| **Graded question** | `life_graded_question` | ~1 node in 3 | one node | — |

**Nothing regenerates.** The saga is written before the player has taken a single
turn and is never revisited. The chapter premise is written before its first scene
and is never revisited. Only the *scene outline* adapts, via `sceneReplan`.

### What the turn model actually receives

In prompt order (`buildLifeStepPrompt`): universe → world seed + character → canon
→ NPC roster → recurring-NPC highlight → active scene outline → per-NPC memory →
volatile world state → `<storySoFar>` → recent events → recently-practiced →
practice cadence → chapter pace → scene pace → story stage → `<turn>`.

That is a *lot* of standing constraint, most of it authored before the player
arrived, and only the last four blocks are responsive to the current moment.

---

## 3. The four forces

The single "open ↔ constrained" line hides two independent problems. Sorting every
mechanism into one of four buckets makes the trade-offs legible:

|  | **Too much** | **Too little** |
|---|---|---|
| **Structure** (does the story have a shape?) | **RAILS** — every scene serves the same conflict; ending set only shrinks; identical turn-count skeleton every world | **DRIFT** — no through-line; scenes feel random; nothing to come back for |
| **Surface** (does it read as written or generated?) | **MEDIAN** — portentous nouns, antithesis-reveal, "Ask…" options, drama in every beat | **NOISE** — variety for its own sake; tonal whiplash; a world that is not *about* anything |

The recent work (2026-08) is almost entirely **anti-MEDIAN**. `LIFE-STORY-VOICE-1`,
`LIFE-STORY-LEXICON-1`, `LIFE-STORY-STAGE-1`. It worked — measured. But anti-MEDIAN
work does not touch RAILS, and several anti-MEDIAN fixes *tightened* rails as a
side effect (§7).

---

## 4. Pulling toward RAILS (over-determined)

Ordered by force, strongest first.

1. **`sceneReplan` is saga-blind, chapter-blind and universe-blind.**
   `buildSceneReplanPrompt` sends only: character, world seed, current outline,
   current phase, recent events, reason. No `<saga>`, no `<worldArc>`, no
   `<universe>`, no `<canon>`. The *only* mechanism that adapts the plan to the
   player cannot re-anchor that adaptation to the story. It can only erode the
   outline it was handed. **This is the single most consequential finding in this
   audit.**

2. **`candidateEndings` narrows monotonically.** Replan's instruction is *"NARROW
   candidateEndings — drop endings the player's choices have ruled out; keep the
   1-2 still in play."* Nothing anywhere adds an ending. A scene's possibility
   space is maximal at turn 1 and strictly decreasing thereafter. `openBranches`
   are refreshed (can widen); endings cannot.

3. **"This chapter MUST advance the saga."** (`worldArc.ts`) Combined with the
   scene generator's *"The scene's themes must connect to the saga's
   centralConflict / antagonist"* and *"A scene that runs without engaging any
   saga archetypes is a missed beat"* — every scene is required to point at the
   same conflict. There is no sanctioned mechanism for a scene that is simply
   about something else. `openBranches` are described as "SAFE detours", i.e.
   detours that do not count.

4. **The whole outline rides every turn.** `renderScene` ships subject, premise,
   tone, keyNpcs, openBranches, candidateEndings, completionTriggers, currentPhase
   into all ~6-12 turns of the scene. A thin or wrong outline cannot be escaped by
   the turn model; it is restated on every call.

5. **Four counter-driven pace blocks, all turn-count based.** `<storyStage>`
   (6/13/21), `<scenePace>` (6/9/12 + floor 4), `<chapterPace>` (25/32/40),
   `<practiceCadence>` (2/3). These make pacing *observable*, which is why they
   work — and they are the reason **every world has the identical skeleton**.
   Two playthroughs of different seeds hit "start converging" on the same turn
   number. Formula at the structural level even when the prose is fresh.

6. **`SCENE_FLOOR = 4` refuses early resolution in code.** Correct guard against
   trivial scenes; also means a subject that genuinely lands in 3 turns cannot.

7. **`completionTriggers` are authored at scene-gen** — before the player has
   acted once — and replan is not instructed to revise them.

8. **`storyMovements` + "decide which movement this chapter sits in"** gives the
   chapter generator a 3-4 slot ladder to walk. Emergent chapter *count* is a real
   openness win, but the *order* is fixed.

9. **Graded questions remove a third of all choice points.** `CADENCE_DUE = 2`,
   `CADENCE_OVERDUE = 3` — a question node carries **no options at all**. See §6
   for the arithmetic.

---

## 5. Pulling toward DRIFT (under-determined)

Genuinely open, and mostly healthy:

1. **The write-your-own ✏️ chip.** The single biggest openness lever in the
   product — arbitrary player intent, client-added, no model authorship. Note it
   is added on **branch nodes only**, so it is absent from roughly half of turns.
2. **Emergent chapter count.** *"Number-of-chapters is EMERGENT"* — movements are
   not mapped 1:1 to chapters.
3. **`openBranches`** — 2-4 sanctioned detours per scene, refreshed on replan.
4. **`replanRequested` / `hardPivot`** — the turn model can flag drift and force a
   re-outline immediately.
5. **The scene generator invents its own premise** (`LIFE-SCENE-24` deleted the
   hook handshake) from saga + chapter + roster + open threads.
6. **Phases are explicitly hints** — *"Phases are HINTS about emotional shape, NOT
   waypoints."*
7. **NPC promotion / retirement at resolve** — the cast composition is genuinely
   emergent across chapters.
8. **`<canon>` is append-only and checked**, so improvised entities become
   first-class and reusable.

---

## 6. Pulling toward MEDIAN (sameness at the surface)

### 6a. The option grid — the arithmetic

The complaint *"always directing the user to the same or very similar options"* has
a structural component before any prose consideration:

- **~1 node in 3 is a `question`** → **zero options**. Answer chips only.
- **Up to ~1 node in 4 (of the rest) is a `continuation`** → **exactly one option**,
  literally `id: "continue"`.
- The remainder are `branch` nodes → **2-3 options** + the ✏️ chip.

So **roughly half of all turns present a real branching choice, with 2-3 options.**
Everything the player experiences as "the grid" is coming from that half.

### 6b. Option variety is enforced *within* a set and never *across* turns

`LIFE-OPT-VARIETY` is strong and well-designed — it names the action types
(ASK / DO / MOVE / OBSERVE / DECIDE / LEAVE), requires at least one DO-or-GO per
set, and states the failure as a checkable count (*"If every option starts with
'Ask…', you have FAILED"*).

**It governs one grid in isolation.** Nothing in the prompt shows the model the
*previous* option sets, and nothing forbids offering the same three shapes turn
after turn. Contrast `<recentlyPracticed>`, which exists precisely to stop vocab
repeating across turns — there is no `<recentlyOffered>` for actions. This is the
exact reported symptom, structurally unguarded.

### 6c. The variety rules are pleas, not forcing functions

The codebase has independently discovered, **five times**, that *a rule the model
can satisfy by doing nothing is not a mechanism* (`LIFE-SCENE-24`,
`LIFE-LANG-13.1`, `LIFE-SPEECH-3`, `LIFE-ARC-PACE-3`, `LIFE-STORY-STAGE-5`), and
fixed each by converting it into an observable counter.

**That conversion has never been applied to variety.** The saga SI's tone rule is
still in the un-fixed form:

> *"Comedy, romance, wonder, warmth, mischief, melancholy, awe, suspense — the
> WHOLE range of human story, chosen to fit THIS seed, never a house style."*

There is no sampled genre, no rotation, no commitment recorded on the world doc, no
counter the model can check. A model that writes a tense drama every time satisfies
this instruction completely.

### 6d. Negative constraint without positive generation

`BANNED_LEXICON` (19 words) + the banned title shapes + the banned antithesis-reveal
+ the banned stakes clause + the banned question mark. All measured effective. But
they remove regions of the space; they do not push toward any particular new one.
The saga prompt spends substantial budget enumerating what not to do — and
enumerating clichés necessarily *names* them.

### 6e. The interesting-moment quota is itself a formula

> *"About 1 node in 4 should introduce something genuinely interesting"*

A fixed rate of injected novelty is exactly "predictable drama in every step" at a
different frequency. It also lists its own examples (flash mob, power cut, dog with
a hat, café cat steals a croissant), which become the sampled set.

### 6f. Every layer is told the same "must be interesting" job

`STORYLINE QUALITY` (*"boring is the failure mode"*) at turn level, `VARIETY IS THE
JOB` at saga level, "don't let a scene stall" at rhythm level. Four layers each
independently trying to raise interest, with no layer owning *quietness*. There is
no mechanism that says "this stretch should be uneventful" except the first-chapter
stage ladder.

---

## 7. Mechanisms that pull BOTH ways

The most important section — these are where a fix at one level cost something at
another.

1. **`storyStage` withholding saga pillars (`LIFE-STORY-STAGE-2`).**
   *Pro:* structurally prevents early foreshadowing. Measured, works.
   *Con:* it also feeds the **scene generator** a stripped saga
   (`sagaPillarsVisible(stage)`), so the first scene's outline is built from teaser
   + first movement only — and **that outline then rides every turn of the scene**.
   The stage clock advances at turn 6/13/21, but the outline does not regenerate,
   and replan cannot re-acquire the saga (§4.1). A world's first scene is therefore
   planned with the least context of any scene it will ever have, and cannot
   recover.

2. **The chapter-1 / chapter-2 cliff.** `storyStage` returns `underway` for any
   `chapterNumber > 1`. Chapter 1 turn 21 → gradual. Chapter 2 turn 1 → full
   pillars, full conflict, no ladder. Every chapter after the first re-opens at
   maximum information.

3. **Pace blocks.** Fixed pacing (good) by making every world the same shape (bad).

4. **`SCENE_FLOOR` + `<scenePace>` ceiling.** Bounds a scene usefully; also means
   the story's rhythm is set by a turn budget rather than by whether the subject
   has landed — even though the model is *asked to emit exactly that signal* and
   it is thrown away (§8.2).

5. **`GENTLE_INTRODUCTION_RULES` + `CAST_FLOOR`.** Forces a cast to exist
   (excellent — fixes "characters are never introduced"). Also makes every world
   introduce its 1st/2nd/3rd named person on roughly the same turns.

6. **The two-register split** (`premise` for the model / `playerTeaser` for the
   player, at both saga and chapter level). Genuinely excellent and worth keeping —
   it is what lets the plan be specific without spoiling. Cost: the player-facing
   half is the *only* thing the early game is written from, so its quality is
   load-bearing far beyond its size.

---

## 8. Findings worth acting on first

Ranked by (impact × cheapness).

1. **`sceneReplan` cannot see the story it is replanning.** Add `<saga>` (stage-gated),
   `<worldArc>` and `<canon>` to its prompt. Today the adaptive layer can only erode.
   *This is the highest-value single change in the audit.*

2. **`sceneProgress` is emitted every turn and consumed by nothing.**
   `stepSchema.ts:277` parses it; no non-prompt code reads it. The model is already
   being asked *"how far has the SUBJECT come?"* — the one story-state signal in
   the system — and it is discarded in favour of turn counters. This is the obvious
   substrate for replacing counter-driven pacing with state-driven pacing.

3. **Nothing tracks option-shape repetition across turns.** A `<recentlyOffered>`
   block (mirroring `<recentlyPracticed>`) would address the reported symptom
   directly and cheaply.

4. **Endings only narrow.** Give replan an explicit mandate to *add* an ending when
   the player has opened a genuinely new possibility. Otherwise every scene is a
   funnel by construction.

5. **Tone/genre is a plea.** Convert to a forcing function in the shape the codebase
   has already proven five times: sample or rotate a register at world creation,
   record it on the world doc, render it as an observable constraint. A world that
   has committed to "warm comic" in Firestore cannot drift to portentous thriller
   by turn 30.

6. **Half of turns have no branch.** Worth deciding deliberately whether ~1-in-3
   graded questions is the right price. `CADENCE_DUE = 2` is aggressive; the
   learning value is real, but it is also the largest single suppressor of player
   agency in the loop.

7. **No layer owns "quiet".** Every layer is told to be interesting. The first-chapter
   stage ladder is the only mechanism that licenses uneventfulness, and it expires
   at turn 21 forever.

---

## 9. What is load-bearing and good — do not break these

- **Universe / saga separation** (`LIFE-UNIVERSE-1`), and especially **`laws` that
  bite**. A constraint that makes certain actions *impossible* is the one kind of
  constraint that generates story rather than restricting it. This is the best
  mechanism in the stack and is under-exploited — laws are rendered but nothing
  ever checks a beat against them.
- **The two-register split** at saga and chapter level.
- **Counted, observable rules.** The technique is right. The problem is which
  quantity is being counted (turns, not story state), not the technique.
- **`<canon>` as a checked ledger** — the substrate any "did the player's choice
  matter?" measurement would need.
- **The ✏️ free-text chip.**
- **`LIFE-OPT-VARIETY`'s action-type taxonomy** — the right idea, wrong scope.
- **Emergent chapter count and NPC promotion/retirement.**

---

## 10. Where I would put the dial

Not a proposal, a reading. The design currently makes **the plan rigid and the
prose free**. The evidence in this repo suggests that is backwards for this
product:

- Rigid plan → identical skeleton, funnelling endings, scenes that must all serve
  one conflict. The player cannot feel authorship.
- Free prose → the sampler's median, fought word-by-word with an ever-growing ban
  list that can only ever remove.

The inverse — **a looser plan that can genuinely widen, and a world-level style
commitment that is recorded and enforced** — would move variance from the sampler
to the player, which is what "feels unique when read back" actually requires.
