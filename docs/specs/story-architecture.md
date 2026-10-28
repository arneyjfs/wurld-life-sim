# Story architecture — the state-machine design

> **Moved 2026-10-28.** This spec came from the Wurld app (`arneyjfs/wurld-app`), where Wurlds ran behind the `lifeSimBeta` flag. It now lives here with the code. Paths and ids that name other Wurld surfaces refer to that repo; see [README.md](./README.md#reading-them-outside-wurld) and [../porting-notes.md](../porting-notes.md). The `/wurlds` routes are no longer beta-gated here.


**Status: PLAN.** This is the target design, not the shipped one. It supersedes the
planning half of `life-sim.md` (`LIFE-WORLD-SAGA-*`, `LIFE-WORLD-ARC-*`,
`LIFE-SCENE-*` outlines, `LIFE-STORY-SHAPE-*`, `LIFE-STORY-STAGE-*`). The turn-level
contracts it does NOT touch — bubbles, languages, exercises, backdrops — stay
exactly as specified there.

Read `docs/archive/story-generation-audit.md` first; this is the answer to it.

---

## 0. The one-sentence design

> **Nothing stores what WILL happen. Every artefact stores what is TRUE, what is
> WANTED, and what is IN MOTION — and drama comes from motion meeting the player.**

Corollary that makes it enforceable: **an artefact may be revised freely unless the
player has seen it.** Witnessed truth is append-only; everything else is fluid.

### Lineage

Deliberately borrowed from tabletop designs that solved this exact problem:

| Borrowed | From | What it gives us |
|---|---|---|
| **Fronts** — pressure sources with an agenda | *Apocalypse World* (Baker) | Drama without plot |
| **Clocks** — segmented progress toward a consequence | *Blades in the Dark* (Harper) | Ratchet + a **code-checkable** resolution signal |
| **"Play to find out what happens"** | *Apocalypse World* | The prohibition on pre-writing outcomes |
| **Fictional positioning** — options come from the fiction | *Blades* | Option grids that differ because the situation differs |
| **Bonds / drives** | *Ironsworn*, *Burning Wheel* | Per-character arcs; distributed tension |

The whole design is: *prep situations, never plot; let clocks escalate what the
player ignores; find out what happens.*

---

## 1. The artefacts and their mutability

Five artefacts. **Mutability is the primary axis** — it is what makes "within
reason" a check rather than a plea.

| Artefact | Mutability | Written by | Cadence |
|---|---|---|---|
| **Universe** | **Immutable** | `universeGenerate` | once per world |
| **Canon** | **Append-only** | `lifeStep` (deltas) | per turn |
| **Cast** | identity append-only · **latent free** | `sceneClose` | per scene |
| **Fronts** | **free** (clocks advance monotonically) | `sceneClose` | per scene |
| **Saga state** | **free**, constrained by Canon | `sceneClose` | per scene |
| **Scene** | **free**, short-lived | `sceneOpen` | per scene |

### LIFE-ARCH-1 — Universe is immutable and is the floor
Setting, era, **laws**, places, figures. Authored once. Never regenerated, never
revised, referenced by everything. On any contradiction anywhere, the universe wins
and the contradicting artefact is rewritten.

`laws` are the highest-leverage field in the system and are currently
under-exploited: a rule that makes an action **impossible** generates story instead
of restricting it. 3-6, present tense, consequential.

### LIFE-ARCH-2 — Canon is the constraint surface, and it is append-only
Everything the player has **witnessed**: entities, facts, events. Already built
(`LIFE-CANON-*`, "CHECKED, NOT TRUSTED", never removed or reordered). Its new job:

> **LIFE-ARCH-2.1 — No revision to Cast, Fronts or Saga may contradict Canon.**

This is what makes the villain un-forgettable while their plan stays fluid. The
villain is in Canon (the player met them); the plan never was.

> **LIFE-ARCH-2.2 — What `sceneClose` summarises is the WHOLE scene, WITH ITS SPEAKERS.**

MEASURED 2026-08-04: a benchmark world tripped the COHERENCE gate on its very
first history line, which named the wrong character *and* the wrong direction —
*"Elder Kaito redirected you to investigate the southern fields"*, when the
transcript had Elder Kaito sending the player north to find Miki and a different
character redirecting them later. History lines are written into permanent world
memory, so every later prompt read the invention as fact.

Two causes, one call site, and neither is the model's fault. **(a) The log had
no speakers** — it was built as `payload.nativeText` per event, a flat list of
unattributed sentences, while `sceneClose`'s own instructions ask it to record
*"who decided something, who refused, who turned out not to be what they
seemed"*. Attribution was not lost in summarisation; it was never supplied.
**(b) The window was the last TWELVE EVENTS.** A turn emits one or two beats
plus a decision, so twelve events is roughly four turns — and scenes run six to
twelve. A whole scene's history was written from its final third, which is
exactly the shape of the error: ending recalled correctly, opening invented.

`buildSceneLog` (`lib/life/sceneLog.ts`) is now the single builder, scoped by
the `scene_started` marker and bounded by a LINE cap (`SCENE_LOG_CAP` = 60)
rather than an event count — so the guard is against an unbounded prompt, which
is the reason a limit existed, instead of against long scenes, which are normal.
The playthrough harness had its own copy that dropped speakers *and* every
player decision, so it was measuring a `sceneClose` the app never runs; both now
call the same function, which is the only thing that stops them drifting again.

**How it is actually enforced — and the honest limit.** A general semantic
contradiction check is not implementable: "the villain is now warm toward you"
versus canon "the villain threatened you" is not a diff, it is a judgement, and
asking a model to make it is the unobservable-rule failure again. So the guarantee
is **structural, not semantic**:

1. **Canon fields are excluded from the revision response schema.** `sceneClose`
   physically cannot emit `known`, an entity id, or a name — those fields are not
   in the schema it answers. Contradiction is impossible by construction for
   everything that matters, which is stronger than checking for it.
2. **Code checks what code can check**: no canon id disappears, no id is renamed,
   principals ≤ 3, delta budget, threat count, stakes ceiling.
3. **Soft drift is accepted and bounded.** A latent field slowly rewritten across
   scenes can wander. `<canon>` is never summarised — it is the unedited anchor the
   next revision reads from — so drift is corrected on the next pass rather than
   compounding. This is the residual risk, and it is named in §9.

### LIFE-ARCH-3 — Nothing anywhere stores a future
Banned fields, deleted outright: `midpointTwist`, `climax`, `endStates`,
`candidateEndings`, `completionTriggers`, `estimatedChapters`, `storyMovements`,
chapter `premise`-as-plan.

Replaced by: *what people want*, *what is in motion*, *what happens if nobody acts*.

---

## 2. The ratchet — fronts and clocks

### LIFE-FRONT-1 — A front is pressure, never plot
```
Front {
  id, name
  driverId          // a cast member, or "circumstance"
  agenda            // what this force is TRYING to achieve (present tense)
  clock: { filled: int, size: 4|6|8, consequence: string }
  kind: FrontKind
  scope: 'saga' | 'chapter'
}
```
`consequence` is **what happens when the clock fills**, stated concretely. Never
"the player fails" — always a world event: *"the bakery is sold"*, *"Mireille stops
speaking to you"*, *"the apprenticeship goes to someone else"*.

### LIFE-FRONT-1.1 — A front is rendered DIFFERENTLY to each reader
The strongest mitigation for "the mechanism becomes visible" is not to ask the
prose model not to narrate the clock — it is **not to show it the clock**.

| reader | sees | does not see |
|---|---|---|
| `lifeStep` (per turn) | `name`, `driverId`, `agenda` | `clock`, `filled`, `size`, **`consequence`** |
| `sceneOpen` | + `filled/size`, `consequence` | — |
| `sceneClose` | everything | — |

A turn model handed *"Bébert is trying to buy the lease"* writes a person with an
intention. The same model handed *"3/6 → the bakery is sold"* writes a countdown,
whatever the prose rules say. `consequence` in particular is the single field most
likely to produce foreshadowed doom, and the turn model has no use for it.

Bonus: the hot-path `<fronts>` block roughly halves.

### LIFE-FRONT-2 — Clocks advance at scene close, never mid-scene
Cost and sanity: a clock that ticks per turn is frantic and invalidates the cache
every turn. At `sceneClose` each live front moves by a **declared delta** with a
one-line reason. Deltas are `-2..+2`. Monotonic pressure is not required — the
player can push a clock back.

**LIFE-FRONT-2.1 — TOTAL DELTA BUDGET ≤ 2 PER SCENE CLOSE, and 0 is the normal
answer.** Models are poor at restraint: asked for a delta they will produce a
non-zero one, for every front, every time — and three fronts × 8 scenes moves
everything to maximum inside one chapter. The budget is summed and clamped **in
code**, and the prompt says plainly that most scenes move nothing. This is the
difference between a world with weather and a world with a countdown.

### LIFE-FRONT-3 — Front kinds must be MOSTLY NOT THREATS
The trap the audit named: "what happens if you do nothing" collapses into
"something bad", which is the old cliché in a new costume. The type is a required
enum and the generator must not make them all `threat`:

| kind | fills into |
|---|---|
| `threat` | something is damaged or lost |
| `opportunity` | a door closes |
| `relationship` | someone cools, leaves, or gives up on the player |
| `obligation` | a debt, a promise or a duty comes due |
| `rivalry` | someone else gets there first |
| `mastery` | the player is found out as not good enough |
| `decay` | a place, a trade or a routine quietly ends |

**LIFE-FRONT-3.1 (checkable):** at most **one** `threat` front may be live at a
time. Enforced in code at `sceneClose`, not asked for in prose.

### LIFE-FRONT-4 — Exactly one front is `scope: 'saga'`
The top pressure. Everything else is chapter-scoped and disposable.

On a deliberately low-stakes seed (`retired_village`, `saints_relic`,
`backpacker_hostels`) the saga front SHOULD be a slow `decay`, `mastery` or
`relationship` with a large clock (10-12), not a compressed one. A through-line is
required; urgency is not.

### LIFE-FRONT-6 — STAKES CEILING, set by world register
The front model generalises across genres; the *severity* does not, and this is
where a conference world becomes a thriller. Consequence severity is capped by the
world's mode:

| register | ceiling |
|---|---|
| `realistic` | social, professional, financial, or personal cost. Nobody dies, nothing is destroyed, no crime unless the seed asked for one. |
| `fantasy` | as the seed and universe support. |

Worked example — a conference world, all seven kinds available and not one of them
dramatic:

- `opportunity` — *the keynote slot goes to someone else* (clock 6)
- `relationship` — *Priya stops trying to include you* (clock 4)
- `mastery` — *you are found out as the one who does not know the terminology* (6)
- `obligation` — *your talk is on Thursday whether or not it is ready* (8)
- `rivalry` — *Tomas publishes first* (8)
- `decay` — *the group you eat lunch with stops forming* (6)

Every one of those is a real conference story. None needs a villain.

### LIFE-FRONT-7 — The first chapter's fronts are non-threat and slow
`storyStage` is deleted by this design, so its measured win must be preserved
structurally rather than by exhortation. Chapter 1 of a saga may contain **no
`threat` front**, and its clocks are 8+. The player arrives into a world with
weather, not a world with a countdown — which is what
`LIFE-STORY-STAGE-1` achieved by withholding, and this achieves by typing.

### LIFE-FRONT-5 — Saga closeout is a CODE-DETECTED clock transition
The mechanism the design needs, and it costs nothing:

> The saga enters **closeout** when the saga-scoped front's clock **fills**
> (`filled >= size`, consequence fires) or is **cleared** (`filled <= 0` after a
> negative delta, the pressure is defused).

Both are integer comparisons at `sceneClose`. No model self-report, no "detect
whether the story is over" call. Same pattern this repo has proven five times:
*state the rule as a quantity the code can observe.*

Closeout runs **one final chapter** whose only job is aftermath, then the saga is
archived and `sagaOpen` writes a new one from the same universe + cast + canon.
**The world persists; sagas succeed one another.**

### LIFE-CAST-1 — TWO TIERS. Most characters do not want anything.

The first draft of this spec gave every character `wants` + `nextMove`. That is
wrong, and it rebuilds the reported failure at cast level: a world where everyone
is pursuing something is exhausting, and it is exactly "predictable drama at every
step" one layer down. **A world needs far more people who are simply THERE than
people who are driving.**

- **Principals — 2-3 at a time.** They carry an ambition and drive fronts. Arc is
  distributed across these rather than centralised in a plot.
- **Regulars — everyone else.** They carry a ROUTINE, not an ambition. They exist
  to make the place real. They can be **promoted** to principal when the story
  turns to them, and demoted back — which is itself a source of arc that costs
  nothing.

**LIFE-CAST-1.1 (checkable):** principals ≤ 3. Enforced at `sceneClose`.

```
CastMember {
  id, name
  known: string          // CANON — what the player has witnessed. append-only.
  tier: 'principal' | 'regular'
  voice: string          // latent — HOW they talk. 6-10 words.
  standing: -3..+3       // latent — toward the player
  ties: [{ id, how }]    // latent — relationships to OTHER cast, not the player

  // principals only:
  wants?: string         // the ambition
  nextMove?: string      // what they do next, unopposed
  limit?: string         // what they will NOT do
  wrongAbout?: string    // a belief that does not match reality

  // regulars only:
  routine?: string       // what they are doing when the player is not there
}
```

Why each of the non-obvious fields earns its tokens:

- **`voice`** — the audit's finding was *"if two NPCs could swap lines you have
  written one character twice"*. `LIFE-STORY-VOICE-1` states that as a rule with no
  per-character anchor. This is the anchor, and it is 8 words.
- **`ties`** — relationships between NPCs, not just to the player. This is what
  turns a cast into a society instead of spokes on a wheel, and it generates story
  with **no stakes at all**: Mireille and Bébert have not spoken in a year. That is
  a whole scene and nobody is in danger.
- **`limit`** — what they will not do. Makes a character a person with integrity
  rather than a plot function, and it constrains the model usefully.
- **`wrongAbout`** — the cheapest source of irony and payoff in the system, and the
  only thing in this design that plants something for later without planning a
  plot.
- **`routine`** — the anti-drama field. A regular whose row says *"opens at six,
  complains about the delivery van"* cannot be written as a plot device.

---

### LIFE-FRONT-5.1 — CLEARED requires the pressure to have been REAL

A clock resolves `cleared` only when it reaches 0 **and** its high-water mark
(`clock.peak`) is at least half its size. Half is the same threshold as
LIFE-FRONT-8: it is the point at which the front became perceivable, so clearing
means undoing something the player could SEE.

**Measured 2026-08-03, headless run 1.** A world's saga ended after ONE scene.
`sceneClose` emitted `-1` on a front sitting at `0/8`, the clamp held it at 0,
and "landed on zero going down" read as resolved. A pressure that never advanced
has not been overcome — nothing happened to it.

### LIFE-FRONT-8.1 — `signOf` counts only when the code asked for one

A scene's `signOf` is accepted only if its id is in the `needSign` list the
engine computed. Otherwise it is discarded.

**Measured run 2.** The model filled `signOf` on every scene regardless of
`<makePerceivable>`. Since `signOf` marks a front ATTENDED, that silently
suppressed LIFE-FRONT-9 for eighteen straight scenes.

### LIFE-FRONT-9 — Unattended clocks drift, on a counter

A front receiving no delta and not named as this scene's `signOf` increments
`clock.unattended`. At `UNATTENDED_DRIFT_SCENES` (3) it advances by 1 and the
counter resets.

**Measured run 2.** A world's saga front sat at `0/8` for six straight scenes
because the model — correctly obeying "an empty list is the normal answer" —
never moved it. That is weather that does not blow. This is the fifth instance
of the recurring lesson: *a rule the model can satisfy by doing nothing is not a
mechanism.*

### LIFE-FRONT-10 — A saga front ratchets: one notch, every other close

A `scope: 'saga'` front's positive delta is clamped to **1** and refused unless
`clock.sinceAdvance >= SAGA_ADVANCE_COOLDOWN` (2). Negative deltas are exempt —
relief is never rationed. Chapter fronts are exempt entirely; they are supposed
to land inside a chapter.

**Measured run 2.** One world advanced its saga front in 5 of 6 closes, filling
an 8-clock inside a single chapter. Every individual judgement was defensible;
`DELTA_BUDGET` caps a close and is blind to the run. With both halves an 8-clock
needs 16+ closes however the world is played.

### LIFE-CAST-3.1 / 3.2 — Standing is slow, and starts near zero

A scene close moves a standing by at most `STANDING_STEP_MAX` (1), and
`sagaOpen` may not open anyone beyond `STANDING_OPENING_MAX` (±1).

**Measured runs 2-3.** Characters reached ±3 within five scenes and then sat
pinned at the rail, after which the axis carried no information; one world
opened a principal at +3 before the player had spoken to her. The rails now mean
something fixed — ±3 is "would break a rule for you" / "will not speak to you
again" — and a relationship ARRIVES there rather than passing through.

### LIFE-CAST-4 — `"null"` is a word, not a value

Every optional model-authored string passes through `cleanText`, which nulls
`""`, `"null"`, `"none"`, `"n/a"`, `"unchanged"` and friends.

**Measured run 1.** `sceneClose` said "unchanged" through a STRING-typed
`situation` field by writing the word `null`. `if (s)` accepted it and the
world's situation became the word null.

### LIFE-CAST-5 — Nobody in the cast shares the player's name

Checked at ingest; a collision is dropped, along with ties and beliefs pointing
at it.

**Measured run 1.** A world opened for a player called Ines contained a
principal called Ines. Every NPC bubble after that was the player watching
themselves talk, and the scene planner could not tell which one a `who` meant.

### LIFE-CAST-6 — A cast member must be WRITABLE: never an explicit `undefined` key

`normaliseMember` builds every optional field **spread-when-present**, and every
site that CLEARS one uses `delete`, never `= undefined`. The Firestore SDK
rejects an `undefined` field value outright rather than ignoring it, so a single
absent field fails the entire write.

**Measured 2026-08-11, on the emulator.** World creation was throwing
`FirebaseError: updateDoc() called with invalid data. Unsupported field value:
undefined`. The cause was `wants: cleanText(raw.wants) ?? undefined` and its
three siblings (`nextMove`, `limit`, `wrongAbout`, plus `routine` on regulars):
`?? undefined` creates an explicit key holding `undefined`, which
`Object.entries` lists and the SDK refuses. **The blast radius is the whole saga
write** — `LifeStartScreen` writes saga, universe, situation, cast and fronts in
ONE `updateLifeWorld`, so one missing `limit` on one principal cost the world its
entire opening state. The player was left on "Building your wurld…" with no
error and nothing to retry: the same terminal-state failure `LIFE-SCENE-31.1`
describes one screen over, from an unrelated cause.

**Why it survived since `5ce9a61`.** `limit` and `wrongAbout` are not in the
`principalItem` schema's `required` list, so most sagas happened to fill them and
most worlds opened. It fails only for the sagas that omit one — invisible in
aggregate, total for the player it hits.

**Why no test caught it.** The unit suite asserted VALUES (`m.limit` is
undefined) and `=== undefined` is true for both an absent key and an explicit
one — the exact distinction Firestore makes, and the only one that matters here.
`LIFE-CAST-6`'s tests assert with `in` and `Object.keys` instead. And the sole
E2E exercising real world creation (`LIFE-ONBOARD`) was itself red for unrelated
reasons, so nothing was reading its result.

**The pattern was already in the same function.** `gender` and `voiceRegister`,
added by `TTS-VOICE-2` two lines above, are spread-when-present with a comment
saying why. The tier fields were written earlier and never revisited — so this is
not a rule nobody knew, it is a rule applied in one half of a function and not
the other.

### LIFE-DATA-DRIFT-1 — When a generator stops writing a field, the READER breaks first

A writer that drops a field is a one-line change. The schema that still *requires*
it turns that into a total outage, and nothing in the type system says so.

**Measured 2026-08-04, shipped to beta.** `sagaOpen` began writing a thin saga
record — `{title, titleNative, tone}` — while `ZWorldSaga` still required
`premise`, `estimatedChapters`, `centralConflict`, `antagonist`, `midpointTwist`
and `climax`. `ZLifeWorld` embeds that schema and `useDocSnapshot` returns `null`
data for a doc that fails to parse, so the consequence was not a blank subtitle on
a card: **every world created after that change read back as "world not found."**
It passed typecheck (the write was cast), passed the unit suite, and passed a
deploy.

Why no test caught it: every world fixture in the suite was hand-written to
satisfy the schema. A fixture author naturally writes a *valid* object, so the
suite proved the reader could read a document the writer no longer produces.

Three rules follow:

1. **Assert the writer's shape against the reader's schema.** `worldParse.test.ts`
   parses exactly what `LifeStartScreen` writes. When a generator stops emitting a
   field, that is the test that fails.
2. **Every field on an embedded schema is optional or defaulted.** A required
   field inside a nested object escalates a local omission into an unreadable
   parent.
3. **Deleting a concept is not done when the generator stops writing it.** The
   schema, every reader, and every prompt that mentions it are all part of the
   same change — `step.ts` was still describing `<saga>`'s `midpointTwist` to the
   model, and `worldArc.ts` was still planning chapters from `storyMovements`,
   for three commits after both stopped existing.

### LIFE-SCENE-2 — Scene focus ROTATES, and every (n+1)th scene is ordinary

`focusForScene` cycles across principals with a `null` slot, and
`<alreadyBeenAbout>` shows the planner recent scene subjects.

**Measured run 3, and this one is the important one.** A ten-scene village world
read back as ten history lines that were all "Pierre is closing the bakery
because of his health", rediscovered. Nothing escalated (signal 1 passed), every
scene drew on old canon (signal 4 passed), clocks behaved (signal 2 passed) —
and the world had ONE subject. The front's driver is the most salient person in
the planner's context, so the planner picked them every time, forever. The fix
is the mechanism that already works one level down: `requiredTypeForTurn`
rotates the option grid because a model handed the same context produces the
same shape, and a scene is no different.

The `null` slot is not decoration. A world where every scene advances somebody's
agenda has no ordinary days in it, and the ordinary days are what make the
others land.

### Signal 6 — the read-back check

The five watch-list signals in §7.1 ALL PASSED on the run that produced the
defect above. Signal 6 measures what they could not see: how many history lines
restate an earlier one, and what share of lines the single most common content
word covers. On the broken run that word covered 10/10 lines, against 8/10 and
5/10 in the two healthy worlds.

The lesson generalises past this feature: a signal set that has never failed on
a known-bad case is not yet evidence of anything.

## 3. The layers, top down

### Universe — `universeGenerate` (once)
**Role:** author a place that constrains action.
**Gets:** world seed, mode, free-text seed, character sheet.
**Emits:** `setting, era, laws[3-6], places[3-6], figures[3-6]`.
**Never runs again.**

### Saga — `sagaOpen` (once per saga; a world has several over its life)
**Role:** state the CURRENT situation and who is in it. **Forbidden from stating any
outcome.**
**Gets:** universe, character, canon (empty at first saga), surviving cast.
**Emits:** `title, titleNative, tone, situation` (2-3 sentences of *now*), initial
`cast[3-5]`, the one saga-scoped front.

The generator's hard rule: *"You are writing the FIRST PAGE and the CAST LIST, not
the book. If you find yourself writing what happens later, stop — that is the
player's to decide."*

### Chapter — `chapterOpen` (per chapter)
**Role:** state the player's **current position** and what is bearing down.
**Gets:** universe, saga state, cast, fronts, canon digest.
**Emits:** 2-3 chapter-scoped fronts, a `situation` line, `playerTeaser`.

Never "in this chapter the player does X". Always "these forces are in motion; here
is what each does if unattended".

### Scene — `sceneOpen` (per scene, ~6-12 turns)
**Role:** put the player somewhere specific with someone specific and something at
stake **right now**.
**Gets:** universe(laws only), saga situation, cast (relevant), live fronts, canon
digest, last scene's outcome.
**Emits:** `where, who[], subject, atStake` — and **nothing else**. No endings, no
triggers, no branches.

### LIFE-SCENE-END-1 — A scene ends on a material change, not a trigger list

A scene ends when the situation **materially changes** — someone leaves, a decision
lands, a place closes, a bargain is struck or refused, a thing is found or lost.
`SCENE_FLOOR` (4) and `SCENE_OVERDUE` (~12) are backstops only: the floor is
enforced in code (`sceneResolveTooEarly` refuses the resolve and the scene carries
on), the ceiling is stated to the model by `<scenePace>`. `endingKey` is a
free-form slug the model invents to label what happened; nothing validates it
against a list, because there is no list.

**This had to ship in the SAME commit as `sceneOpen`, and that was not the original
plan.** The migration sequenced the end-condition swap last, as the one change that
could strand a live world. It turned out to be *coupled*: the old contract read
"when a completionTrigger is satisfied, emit `scene.resolved` with an endingKey
from `outline.candidateEndings[]`", and `sceneOpen` stops writing both arrays. Ship
`sceneOpen` alone and every scene has no trigger to satisfy and no ending to name —
scenes could only end by running into the turn ceiling. Ordering a migration by
blast radius is right; it does not survive a dependency running the other way.

### Turn — `lifeStep` (per turn — the hot path, see §5)
**Role:** write what happens now, and offer what the player could do next.

### Scene close — `sceneClose` (per scene) — **the compaction engine**
The single most important new call. Replaces `sceneReplan` entirely and does four
jobs in **one** generation:

1. **Compact** the scene's story log into 1-2 lines for saga history.
2. **Advance clocks** — a delta + reason per live front.
3. **Revise latent state** — cast `wants` / `nextMove` / `standing`.
4. **Promote canon** — batch the scene's new entities into the canon block.

**Gets:** the scene's story log, the scene outcome, current fronts, current cast.
**Constraint:** may not contradict canon (code-checked).
**Then, in code:** `LIFE-FRONT-5` closeout check; `LIFE-FRONT-3.1` threat-count check.

---

## 4. The option grid

The audit's separate complaint, solved here because the architecture finally
supplies the raw material.

### LIFE-GRID-1 — Options are derived from the fiction, and say so structurally
Every option is now `{ type, targetId, nativeText }` where `type` is the
`LIFE-OPT-VARIETY` taxonomy (ASK · DO · MOVE · OBSERVE · OFFER · LEAVE) and
`targetId` is a **canon id** (or null for untargeted).

This turns a prose plea into a **code check**:

- **LIFE-GRID-1.1** — a set whose types are all identical is REJECTED and
  regenerated. (Today: asked for, unverifiable.)
- **LIFE-GRID-1.2** — a set whose `(type, targetId)` multiset equals the previous
  turn's is REJECTED.

### LIFE-GRID-2 — `<recentActions>` — the missing cross-turn memory
The audit's finding: `<recentlyPracticed>` stops vocab repeating; **nothing** stops
actions repeating. Add the mirror block — the last ~8 `(type, targetId)` pairs
offered — with the rule *"do not offer a shape from this list; the situation has
moved on."* Cheap (~60 tokens), proven shape.

### LIFE-GRID-3 — Options come from CAST NEXTMOVES, not from invention
The prompt now carries, for every present character, *what they want* and *what
they will do next*. The instruction becomes: **at least one option must engage a
character's `nextMove` or a live front.** Options stop being generic because they
are anchored to something specific and currently true.

### LIFE-GRID-4 — Every node offers a choice
The audit measured ~half of turns with no real branch (~1 in 3 graded questions
with zero options, up to 1 in 4 continuations with one). Fix:

- Question nodes already pre-author their `resolution` (`LIFE-EX-PLAN-5`); they now
  also carry that resolution's **options**, so answering lands straight on a choice.
- `continuation` capped by an observable counter (max 1 in 5, counted like
  `cyoaStreak`), not by "prefer real branches".
- `CADENCE_DUE` relaxed 2 → 3.

---

## 5. Cost — the design constraint, not an afterthought

`lifeStep` fires 25-40× per chapter. Everything below is designed around it.

### LIFE-COMPACT-1 — The prefix ladder (NEVER reorder)
Gemini caches by exact prefix. A block that changes invalidates **everything below
it**. So sections are ordered by change frequency, ascending:

```
[systemInstruction]     app version      ~6k tok   cached ~always
<universe>              world            ~400
<character>             world            ~120
<sagaState>             scene (~8 turns) ~250
<fronts>                scene            ~200
<cast>                  scene            ~350
<canon>                 scene (batched)  ~400
<sceneNow>              scene            ~150
─────────────────────── cache boundary in the common case ──────────
<canonDelta>            turn (append)    ~40
<storyLog>              turn (append)    ~200   scene-scoped, NOT chapter
<recentEvents>          turn (sliding)   ~500
<recentActions>         turn             ~60
<counters>              turn             ~80
<turn>                  turn             ~100
```

Two changes from today, both material:

- **`<canon>` is batched at `sceneClose`, not appended per turn**, with a tiny
  `<canonDelta>` below the boundary for this scene's new entities. Today canon sits
  near the top *and* grows per turn, which invalidates the whole prompt below it
  every time something is named. This is the single biggest cache win available.
- **`<storyLog>` is scene-scoped, not chapter-scoped.** Today it grows to 30-40
  entries across a chapter. Compaction at `sceneClose` folds it into `<sagaState>`
  in 1-2 lines, so it never exceeds ~10.

**Result: ~2.2k volatile tokens per turn against ~7.7k cached**, vs today's roughly
5-6k volatile (canon + full chapter log + saga pillars all sitting in the churn).

### LIFE-COMPACT-2 — Compaction is a by-product, never its own call
`sceneClose` already has the scene log in context to advance clocks. It emits the
compacted history in the same response. **Zero additional calls for compaction** —
this is the user requirement and it is free.

### LIFE-COMPACT-3 — Call budget per chapter (~30 turns, 4 scenes)

| Call | Today | Target |
|---|---|---|
| `lifeStep` | 30 (+ stray options calls) | 30 |
| `life_graded_question` | ~10 | ~8 (cadence 2→3) |
| `sceneGenerate` | 4 | 4 (`sceneOpen`, thinner) |
| `sceneReplan` | 4-6 | **0 — deleted** |
| `sceneClose` | 0 | 4 |
| `worldArc` | 1 | 1 |
| saga update | 0 | **0 — folded into `sceneClose`** |
| **total** | **~50** | **~47** |

Slightly fewer calls, each with a much better cache hit rate, and the two
most expensive prompts (`sceneReplan`'s full-outline round-trip, `lifeStep`'s
chapter-long log) both shrink or disappear.

### LIFE-COMPACT-4 — The SI must be consolidated
`step.ts` is 875 lines / 80KB, grown by accretion — every bug fix appended prose.
It caches, so the cost is bounded, but it is now the dominant input and much of it
is dead weight from mechanisms this design deletes (saga pillars, candidateEndings,
completionTriggers, storyStage ladder). Target: **≤400 lines** after removal.

---

## 6. What every prompt receives, and what it is asked to do

| Prompt | Receives | Role | Must NOT |
|---|---|---|---|
| `universeGenerate` | seed, mode, character | a place whose laws constrain action | tell a story |
| `sagaOpen` | universe, character, canon, surviving cast | the situation NOW + the cast + one top front | state any outcome |
| `chapterOpen` | universe, saga, cast, fronts, canon digest | the player's current position + 2-3 fronts | say what the player will do |
| `sceneOpen` | laws, situation, cast(relevant), fronts, canon digest, last outcome | where/who/at-stake right now | author endings or triggers |
| `lifeStep` | the §5 ladder | this beat + 2-3 grounded options | invent entities absent from canon |
| `gradedQuestion` | the line under test, level, recent targets | one exercise | touch the story |
| `sceneClose` | scene log, outcome, fronts, cast | compact · advance clocks · revise latent · promote canon | contradict canon |

---

## 6.5 What models are bad at, and where this design puts each weakness

The design's job is to route every task to the layer that can actually do it.
**Where a model is weak, the code holds the invariant.**

| Weakness | Where it would bite | Mitigation |
|---|---|---|
| **Arithmetic / counter state** | clock values, "is it full", principal count | Model emits a **delta + reason only**; code applies, clamps, sums and decides fullness. The model never restates an absolute and never judges a threshold. |
| **Restraint — "no change"** | every clock advancing every scene | `LIFE-FRONT-2.1` budget ≤2 total, clamped in code; prompt states 0 is normal. |
| **Respecting "at most one X"** | threat fronts, principals | Counted in code (`LIFE-FRONT-3.1`, `LIFE-CAST-1.1`), not asked for. |
| **Dropping non-required schema fields** | measured in this repo (`LIFE-WORLD-SAGA-10`) — under a schema, optionals vanish | Keep every schema **small and required-heavy**. Split `sceneClose` output into small objects rather than one wide one. |
| **Long negative constraint lists** | the ban-list approach degrades as it grows | This design *shrinks* ban surface: no pillars to withhold, no futures to avoid spoiling. `storyStage` and much of the saga SI are deleted. |
| **Semantic self-consistency at range** | latent drift over many scenes | Canon is never summarised; schema exclusion (§LIFE-ARCH-2.1). |
| **Voice differentiation across characters** | all NPCs sound alike | Per-character `voice` field — the anchor `LIFE-STORY-VOICE-1` never had. |
| **Writing a scene where nothing happens** | models want every scene to matter | `regular` tier with `routine`; `decay`/`relationship` fronts; `LIFE-FRONT-7`. |
| **Genuinely novel structure** | every playthrough the same shape | Not solvable by prompting. Variance must come from **state** — different cast wants, different clock positions — which is the whole point of the redesign. |

**The general rule this table encodes:** a model is good at *writing a sentence
given a situation*, and bad at *maintaining a system*. So it is asked only for
prose and small local judgements; every quantity, count, threshold and transition
lives in code.

---

## 6.6 Refinements — the mitigations that changed the design

Eight changes made after stress-testing §7. Three are structural; the rest are
cheap. The maxim they share: **give the model less, and ask it for less.**

### LIFE-FRONT-8 — A clock past half MUST have a perceivable sign (playability)
**The risk I initially missed, and it is the biggest one.** In *Blades*, clocks are
shown to the players — that is what makes them dramatic and steerable. Here they
are hidden, and hidden pressure that advances invisibly is indistinguishable from
things going wrong for no reason. The player cannot steer what they cannot
perceive, which quietly turns an agency design into an on-rails one.

So: once `filled >= size/2`, `sceneOpen` (which does see clocks) **must** seed a
concrete, perceivable sign into the scene — Bébert has been to the landlord twice;
there is a surveyor's tape on the shopfront. Not a warning, not a portent: a thing
with edges the player can act on. Checkable — `sceneOpen` emits `signOf: frontId`
when any clock is past half, and code asserts it is present.

This is the bridge between hidden mechanism and player agency, and without it the
rest of the design does not deliver what it promises.

### LIFE-ARCH-4 — `sceneClose` emits DELTAS ONLY, for everything
Not just clocks. A model asked to re-emit the cast will *rewrite* the cast, and
that is the telephone-game drift of risk 2 — every field re-sampled every scene.
Asked instead for *"which fields changed, and to what"*, untouched things stay
untouched by construction.

Applies to cast latent fields, saga situation, and front agendas. Cuts output
tokens substantially at the same time.

### LIFE-ARCH-5 — Saga history is append-only; fold only the oldest
`sagaState.history` is an array of one-line entries appended at each `sceneClose`
and **never rewritten**. When it outgrows its render budget, the OLDEST entries
fold into a single "earlier:" line. Degradation is bounded to the material that
matters least, instead of a summary of a summary of a summary.

### LIFE-GRID-5 — PREVENT the repeat, do not reject it
Rejection costs a whole extra call (risk 4). Prevention costs nothing: code picks
a **required action type** for this turn, rotating from a turn counter, and injects
it into the request — *"one option this turn must be MOVE"*. Same technique as the
existing `exerciseSeed` fill-blank rotation, which already works in this repo.

`LIFE-GRID-1.1/1.2` stay as a backstop and should now almost never fire. If the
measured rejection rate exceeds ~15%, the rule is wrong, not the model.

### LIFE-CAST-2 — `wrongAbout` is STRUCTURED, so payoff is code-detectable
The setup/payoff gap (risk 3) is the design's weakest point. This closes part of
it for free: `wrongAbout` becomes `{ aboutId, believes }` where `aboutId` is a
canon id. Code can then detect **"this principal believes something the player now
knows to be false"** and surface it to `sceneOpen` as available material.

A belief that is never corrected is just a fact. A belief the player can now see
through is irony, and it arrives without anyone planning it.

### LIFE-CANON-6 — Dormancy drives reuse, and reuse is what payoff is made of
`sceneOpen` receives the canon ordered **longest-dormant first**, each row carrying
`scenesSince`, plus a required `drawsOn: canonId[]` (non-empty from scene 3
onward) — the scene must pick something back up.

**Dormancy is DERIVED, not stored.** This originally specified a
`lastTouchedScene` field on each canon entry; `canonDormancy()` computes the same
answer from `sagaHistory` instead — one line per closed scene, so the index of the
newest line naming an entity IS its dormancy. Three reasons, and the third is the
one that decided it: there is no write path to keep in sync; it cannot drift out
of step with the history it describes, because it *is* the history; and its error
skews the right way. A one-line summary does not name every entity that appeared,
so a background entity present-but-unmentioned reads as *more* dormant than it
was — which biases `drawsOn` toward older material. That is exactly the direction
watch-list signal 4 measures ("always the most recent entity → dormancy not
working"). A stored counter is more precise and biases neither way.

Nothing here plans a payoff. It makes **reuse cheaper than invention**, and a
thing returning after five scenes carries new meaning automatically, because the
player has changed in between.

### LIFE-CAST-3 — Keep the cast floor; add a cast ceiling
Deleting `storyStage` wholesale would have dropped `CAST_FLOOR`, which was
orthogonal to the saga-pillar problem and fixed a *different* reported failure
(*"characters are never introduced"*). It survives as a floor on **regulars**.

The ceiling is new and equally necessary: regulars accumulate forever otherwise —
30 named people by chapter 5, prompt bloat, and a player who cannot track any of
them. Render at most ~8; the rest archive to canon-only and can be revived.

### LIFE-ARCH-8 — The display record is GENERATED, not merely declared
`sagaOpen` writes a deliberately thin `saga` — `{title, titleNative, tone,
playerFacingTeaser}` — and nothing reads it for story (`LIFE-ARCH-3`: no stored
futures). `playerFacingTeaser` is the one PROSE field in it, and it is what the
player actually reads: the overview `WorldCard`'s story line (`LIFE-WORLD-17`),
`WorldIntroScreen`, and the `WurldResumeScreen` "The story" block.

**It must be in the prompt's OUTPUT CONTRACT and `required` in the
`responseSchema`.** Found 2026-08-05, owner report — *"the cards in the Wurlds
home no longer show a summary of the story, they just show 'your story is being
written…'"*. `ZWorldSaga.playerFacingTeaser` is `z.string().default('')`, three
screens read it, and the sagaOpen prompt had never mentioned the word "teaser"
at all: the migration from `runWorldSagaGenerate` carried the CONSUMERS across
and left the producer behind. A field in the Zod schema but not in the prompt's
OUTPUT CONTRACT, defaulting to `''`, fails **silently** — every world since the
migration has shown the pending stub, and nothing logged. Same failure shape as
`LIFE-INTENT-2` and `LIFE-EX-VOCAB-4`; the third instance is why it gets its own
invariant rather than a bugfix note. `LIFE-WORLD-SAGA-10` is the reason it is
`required` and not merely declared — under a `responseSchema` a non-required
field is dropped far more readily than in free JSON.

**Register: `LIFE-STORY-STAGE-5`'s wording, NOT `LIFE-STORY-STAGE-4`'s.** The
teaser is written before anything has happened, so it cannot tease an outcome —
it has none, by `LIFE-ARCH-3`. The obvious brief — *"the ordinary world plus one
unanswered question"* — is the one `LIFE-STORY-STAGE-5` was written to delete:
**4 of 4** measured teasers complied with the word "question" literally and
closed on a rhetorical interrogative naming the plot. So the block reuses that
invariant's three working parts verbatim rather than paraphrasing them: the want
stated POSITIVELY (**plain facts, each with a loose end still attached**, tested
by *"things a neighbour would mention"*), its three measured-good statements as
the worked examples, and the ban expressed as a **count** the model executes
(*"read your draft back and count them; if there is a '?', rewrite that sentence
as a statement"*) rather than a request it can believe it honoured. The stakes
clause is banned alongside — back of a paperback, not a film trailer.
Two-to-three sentences, in the **system** language (it is chrome, not practice
text — `LIFE-LANG-8`).

`functions/src/__tests__/lifeSagaOpen.test.ts` (server-owned since 2026-09-18) asserts the ABSENCE of the phrase "unanswered question" as
well as the presence of the replacement: the paraphrase is what a later editor
tidying this block would naturally reach for, and it looks like an improvement.

**Not backfilled.** Worlds created before this landed keep `''` and keep showing
the pending stub; a repair pass would cost one full saga generation per world to
recover a caption. New worlds get it from creation.

### LIFE-ARCH-6 — The WORLD is named, not just the saga
Risk 5, cheaply. Today the saga title *is* the world's identity, so saga succession
reads as the story restarting. Give the world its own durable name at creation
(from the universe — a place, a street, a trade) and let saga titles be subtitles
beneath it. The card the player returns to never changes; the act does.

---

## 7. Risk register

Ranked by expected cost. Written now so the migration can be judged against it.

1. **Mechanism becomes visible.** Clocks are state that advances; a model that
   narrates *toward* the clock produces "and the pressure mounted" every scene —
   trading plot rails for machinery rails. *Mitigation:* clocks are never rendered
   to the player, are never named in prose, and move at most 2 segments per close.
   *Watch for:* scene outcomes that all read as escalation.

2. **Latent drift.** Repeatedly rewriting a summary degrades it — the classic
   telephone-game failure. Today's frozen plan cannot drift because it cannot move;
   making it mutable buys adaptivity and pays in drift. *Mitigation:* canon is the
   unedited anchor; compaction **appends** a line to history rather than rewriting
   the history. *Watch for:* cast `wants` becoming generic by scene 5.

3. **No setup-and-payoff.** Clocks give escalation. They do not give planting,
   reversal, or dramatic irony — the things that make a story feel *authored* when
   read back. This is the residual gap after the ratchet, and it is the design's
   weakest point. *Mitigation:* `LIFE-CAST-2` (structured `wrongAbout`, so the
   payoff is code-detectable) and `LIFE-CANON-6` (dormancy + a required `drawsOn`,
   making reuse cheaper than invention). Neither PLANS a payoff; both make one
   likely. *Watch for:* coherent but flat retrospectives.

   **DECIDED — do NOT re-admit authorship. See §7.1.**

4. **Rejection loops cost calls.** `LIFE-GRID-1.1/1.2` reject an option set in
   code, and regeneration is a whole extra call. *Mitigation:* retry **once** with
   the violation named, then accept — the same ladder `generateStepOptions` already
   runs. Instrument the rejection rate; above ~15% the rule is wrong, not the model.

5. **Saga succession reads as a restart.** Title and teaser change; the player may
   feel the story reset rather than turned a corner. *Mitigation:* cast, canon and
   universe visibly persist; the closeout chapter is aftermath, so the seam is a
   ending rather than a cut. *Watch for:* players not returning after a closeout.

6. **Deleting `storyStage` regresses the opening.** It was the measured fix for
   "always drops you into high drama". `LIFE-FRONT-7` replaces it structurally, but
   if the front generator writes a hot clock at chapter 1 the original complaint is
   back. *Mitigation:* `LIFE-FRONT-7` is code-checked, not prose. This is the single
   most important regression test in the migration.

7. **Scope.** This touches the saga, chapter, scene, turn and close paths plus the
   Firestore schema. The six-step migration exists so no step is unshippable alone;
   steps 2 and 4 deliver most of the value and neither requires deleting anything.

---

## 7.1 DECISION — no planted futures. Reversal is a state transition, not a plan.

Risk 3 asked whether a small amount of deliberate authorship — *one planted thing
per saga* — should be re-admitted to buy setup-payoff, reversal and dramatic irony.
**Decided: no.** Reasoning recorded here because the decision is expensive to
re-litigate by play.

### The three were lumped together and should not have been

- **Dramatic irony is already solved, and better than by planting.** It is
  *structurally* what this design produces: the player accumulates canon while
  characters hold latent beliefs, so every fact the player witnesses that a
  principal does not know IS dramatic irony, sitting there for free.
  `LIFE-CAST-2`'s structured `wrongAbout` makes it code-detectable on top. No
  authorship needed; the asymmetry is the mechanism.

- **Setup-payoff is addressed.** `LIFE-CANON-6` converts *"plan a payoff"* into
  *"bias toward reuse"*, and reuse plus elapsed time IS payoff — a thing returning
  after five scenes carries new meaning automatically, because the player has
  changed in between. Planting would only add specificity we do not need.

- **Reversal was the real gap — and the design is better at it than I credited.**

### The realisation: canon/latent IS the fair-play reversal structure

A reversal is fair when the clues were there and the *interpretation* was wrong,
and cheap when the facts themselves change under the reader. That is exactly the
line this design already draws:

> **Canon = the behaviour that was witnessed. Latent = the intent that was
> assumed.** A revision may invert unwitnessed intent and may never contradict
> witnessed behaviour.

So Bébert, whom the player saw being kind, may turn out to have wanted the lease
all along — kindness is canon, motive never was. That is the "it was there all
along if you re-read it" structure, and `LIFE-ARCH-2.1` enforces its fairness
without anyone planning anything.

**LIFE-ARCH-7 — reversal is an explicitly licensed revision.** `sceneClose` may,
as an ordinary delta: change a front's `driverId` (the pressure was someone else),
invert a principal's `wants`, or swing `standing` hard. Zero new fields, no stored
future — a present-tense correction of something that was never fixed.

### Why not to hedge by adding it anyway

1. **A planted thing is a stored future, and we have MEASURED what those do.**
   `LIFE-STORY-STAGE-2` found that a model handed the twist writes toward the
   twist — that is the entire reason the pillars are withheld today. One planted
   item would very likely produce foreshadowing on every turn until it lands,
   which is the reported complaint that started this work.
2. **The failure modes are asymmetric.** If this call is wrong, stories read a
   little flat — real but tolerable. If the hedge is wrong, we are back to
   portentous foreshadowing, which is the thing we are fixing.
3. **Reversal is the rarest of the three and the least missed in this product.**
   It matters most in thriller and mystery — the register being deliberately
   de-emphasised. The seeds that skew lived-in (`city_life`, `retired_village`,
   `ancestral_roots`) want texture, not inversion.
4. **The decision is cheap to reverse, in one direction only.** Adding a planted
   field later is a small change. Un-teaching a model to foreshadow costs
   playthroughs. Start without.

### What to watch — instrument the STATE, not the prose

Flatness shows up in the state ledger long before it shows up in a retrospective,
and the state is readable from Firestore after a handful of scenes rather than a
whole saga. **Do not evaluate this by playing more.**

| # | Signal | Healthy | Unhealthy — act |
|---|---|---|---|
| 1 | **Read back `sagaState.history` after ~6 scene closes.** The single sharpest check. | reads as a list of **changes** — someone changed their mind, a driver turned out to be someone else, a standing swung | reads as a list of **escalations** — "X pressed further", "Y got worse" |
| 2 | Clock delta distribution | **majority of closes move 0** | most closes move something → budget not biting, everything is countdown |
| 3 | `wrongAbout` → canon contradiction rate | ≥1 belief per chapter becomes detectably false | beliefs set and never contradicted → irony not firing |
| 4 | Age of entities in `drawsOn` | skews old sometimes | always the most recent entity → dormancy not working, no payoff material |
| 5 | `standing` trajectories | some characters swing both ways | every character monotone → no relationship reversal |

**Pre-made trigger, so the decision is cheap when it comes:** if after **two
chapters** signal 1 reads as pure escalation AND signal 5 is monotone, add exactly
one thing — a `seed: { canonId, aSecondMeaning }` on the saga, visible ONLY to
`sceneOpen` and never to `lifeStep`. Restricting it to the scene planner is what
keeps it from becoming per-turn foreshadowing. Do not add more than that, and do
not add it pre-emptively.

---

## 8. Migration

Six landable steps, each shippable and testable alone.

1. **Fronts + clocks alongside the existing saga.** New Firestore fields, rendered
   into `lifeStep`, nothing removed. Prove clocks move sensibly.
2. **`sceneClose` replaces `sceneReplan`.** Biggest single win — it fixes the
   audit's #1 finding (replan is saga-blind) by giving the adaptive call full
   context, and folds compaction in for free.
3. **Prefix re-ladder + canon batching + scene-scoped log.** Pure cost work, no
   behaviour change. Measure tokens before/after.
4. **Option grid**: structured `{type, targetId}`, code-level rejection,
   `<recentActions>`, cadence 2→3. Independently valuable; ship early.
5. **Delete the futures.** Remove `midpointTwist`/`climax`/`endStates`/
   `candidateEndings`/`completionTriggers`/`storyMovements`; consolidate the SI.
   This is where `storyStage` also goes — with no pillars to withhold, there is
   nothing for it to gate.
6. **Saga closeout + succession.** `LIFE-FRONT-5`, the aftermath chapter, and
   `sagaOpen` from surviving cast.

Beta data is disposable (`LIFE-SCENE-23` precedent), so none of these need
back-compat shims.

---

## 9. Why this meets the brief

| Requirement | Mechanism |
|---|---|
| Player can step in any direction | No stored future; options anchored to live cast intent |
| Options lead down different roads | `LIFE-GRID-1/2/3` + code rejection of repeats |
| Replans successfully on the fly | `sceneClose` sees universe, saga, cast, fronts, canon |
| Tension builds when read back | Clocks ratchet; per-character ambitions compound |
| Heads in a consistent direction | One saga-scoped front is the through-line |
| Not cliché / not dramatic every step | ≤1 `threat` front live (code-checked); 7 pressure kinds |
| Unique per playthrough | Variance moves from sampler to player: same engine, different cast wants and clock states |
| Cheap | ~47 calls/chapter, ~2.2k volatile tokens/turn, compaction free |
