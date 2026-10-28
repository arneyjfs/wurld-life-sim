/**
 * SRV-PROMPT-3 — the adapter that let the `life_step` prompt tests MOVE rather
 * than die.
 *
 * `src/lib/life/prompts/step.test.ts` was 1,353 lines and the largest body of
 * assertions on any prompt in this repo. Its fixtures are shaped like the
 * CLIENT builder's old input — a whole `LifeWorld`, an event log, a roster, a
 * scene — because that is what `buildLifeStepPrompt` used to take. The server
 * builder takes the narrowed spec instead.
 *
 * Rewriting 1,353 lines of fixtures by hand to land the same assertions would
 * have been the single most likely place in this batch to lose one quietly, so
 * the fixtures came across UNCHANGED and this maps them. It is the same
 * narrowing `src/lib/life/stepSpec.ts` performs in the app, written once more
 * for test inputs that are deliberately partial.
 *
 * ⚠ IT IS NOT A THIRD COPY OF THE CONTRACT. The app's own mapping is asserted
 * end to end by `stepGoldenParity.test.ts`, which drives `resolveServerPrompt`
 * with the spec the REAL call site builds. This file only has to be faithful
 * enough for tests whose subject is the RENDERED TEXT, and where it differs
 * from the app's mapping the golden is the one that decides.
 */
import { buildLifeStepPrompt, type LifeStepInput } from "../../prompts/lifeStep";

type Loose = Record<string, unknown>;

const obj = (v: unknown): v is Loose =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function millis(v: unknown): number | null {
  return obj(v) && typeof (v as { toMillis?: unknown }).toMillis === "function"
    ? (v as { toMillis: () => number }).toMillis()
    : null;
}

/**
 * `resolveCanon`, as the client applies it: the stored ledger, plus every NPC
 * on the live roster, plus the current location — id-sorted, stored entries
 * first so their richer records win the dedup.
 */
function resolveCanon(world: Loose, npcs: Loose[]): LifeStepInput["canon"] {
  const stored = (obj(world.canon) ? world.canon : {}) as Loose;
  const arr = (k: string): Loose[] => (Array.isArray(stored[k]) ? (stored[k] as Loose[]) : []);
  const append = (list: Loose[], next: Loose[]): Loose[] => {
    const seen = new Set(list.map((e) => e.id as string));
    const out = [...list];
    for (const e of next) {
      if (seen.has(e.id as string)) continue;
      seen.add(e.id as string);
      out.push(e);
    }
    return out;
  };
  const fromRoster = [...npcs]
    .sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : (a.id as string) > (b.id as string) ? 1 : 0))
    .map((n) => ({ id: n.id, name: n.name, kind: "person", note: n.relationship ?? "" }));
  const label = world.currentLocationLabel;
  const here =
    typeof label === "string" && label
      ? [{ id: canonSlug("place", label), name: label, kind: "place", note: "" }]
      : [];
  return {
    characters: append(arr("characters"), fromRoster) as never,
    places: append(arr("places"), here) as never,
    objects: arr("objects") as never,
    facts: arr("facts") as never,
  };
}

/** `canon.ts`'s own slug, restated — the derived place id has to match. */
function canonSlug(kind: string, name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  const prefix =
    kind === "place" ? "plac" : kind === "object" ? "obje" : kind === "fact" ? "fact" : kind === "faction" ? "grp" : "char";
  return `${prefix}-${base || "x"}`;
}

/** Map a CLIENT-shaped step fixture onto the server's spec and build. */
export function buildStepPromptFromWorld(input: Loose): string {
  return buildLifeStepPrompt(stepInputFromWorld(input));
}

export function stepInputFromWorld(input: Loose): LifeStepInput {
  const w = (obj(input.world) ? input.world : {}) as Loose;
  const npcs = (Array.isArray(input.npcs) ? input.npcs : []) as Loose[];
  const events = (Array.isArray(input.events) ? input.events : []) as Loose[];
  const scene = obj(input.scene) ? (input.scene as Loose) : null;
  const arc = obj(w.currentArc) ? (w.currentArc as Loose) : null;
  const log = obj(w.storyLog) ? (w.storyLog as Loose) : null;
  const ladder = obj(w.goalLadder) ? (w.goalLadder as Loose) : null;
  const objective = ladder && obj(ladder.objective) ? (ladder.objective as Loose) : null;
  const entries = Array.isArray(log?.entries) ? (log!.entries as string[]) : [];

  return {
    practiceLanguage: (w.practiceLanguage as string) ?? "French",
    nativeLanguage: (w.nativeLanguage as string) ?? "English",
    systemLanguage: (w.systemLanguage as string) ?? (w.nativeLanguage as string) ?? "English",
    difficulty: (w.difficulty as number) ?? 3,
    characterName: (w.characterName as string) ?? "Marc",
    worldSeedKey: (w.worldSeedKey as string) ?? "",
    ...(typeof w.worldSeedText === "string" && w.worldSeedText
      ? { worldSeedText: w.worldSeedText }
      : {}),
    ...(typeof w.bio === "string" && w.bio ? { bio: w.bio } : {}),
    universe: (w.universe as LifeStepInput["universe"]) ?? null,
    story: {
      ...(typeof w.situation === "string" ? { situation: w.situation } : {}),
      fronts: (w.fronts as LifeStepInput["story"] extends undefined ? never : never) ?? (w.fronts as never) ?? [],
      cast: (w.cast as never) ?? [],
    },
    canon: resolveCanon(w, npcs),
    npcs: npcs as never,
    recurringNpcIds: (arc?.recurringNpcIds as string[]) ?? [],
    chapterNumber: (arc?.chapterNumber as number) ?? 1,
    chapterTurns: (log?.turns as number) ?? entries.length ?? 0,
    chapterStartedAtMs: millis(arc?.startedAt),
    sceneTurns: (log?.sceneTurns as number) ?? 0,
    storyLogEntries: entries,
    ...(typeof w.rollingSummary === "string" ? { rollingSummary: w.rollingSummary } : {}),
    arc: arc
      ? ({
          chapterNumber: arc.chapterNumber,
          premise: arc.premise,
          themes: arc.themes ?? [],
          recurringNpcIds: arc.recurringNpcIds ?? [],
          completedSceneMemories: arc.completedSceneMemories ?? [],
        } as never)
      : null,
    scene: scene as never,
    ...(typeof w.currentLocationLabel === "string" && w.currentLocationLabel
      ? { currentLocationLabel: w.currentLocationLabel }
      : {}),
    goalLadder: ladder
      ? ({
          ...(obj(ladder.saga)
            ? {
                saga: {
                  text: (ladder.saga as Loose).text,
                  when: (ladder.saga as Loose).when,
                  // `daysLeft(ladder)` = max(0, saga.days - dayIndex).
                  daysLeft: Math.max(
                    0,
                    (((ladder.saga as Loose).days as number) ?? 0) - ((ladder.dayIndex as number) ?? 0),
                  ),
                },
              }
            : {}),
          ...(objective
            ? {
                objective: {
                  text: objective.text,
                  ...(obj(objective.need) ? { need: { name: (objective.need as Loose).name } } : {}),
                },
              }
            : {}),
          done: ladder.done ?? [],
          // `exposureReason(objective, worldFactsFor(world, npcs))`. Only the
          // `who` arm is reachable in practice (LIFE-NEED-6's note), and the
          // fixtures drive it through the roster.
          ...(() => {
            const need = objective && obj(objective.need) ? (objective.need as Loose) : null;
            if (!need) return {};
            const name = String(need.name ?? "");
            const fold = (s: string) =>
              s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
            const kind = need.kind ?? "who";
            if (kind === "who") {
              const met = npcs.some(
                (n) => fold(String(n.name ?? "")) === fold(name) && ((n.standing as number) ?? 0) >= 1,
              );
              return met ? {} : { blocked: `${name} has no reason to do this for you yet` };
            }
            if (kind === "what") return { blocked: `you do not have ${name}` };
            const here = typeof w.currentLocationLabel === "string" ? w.currentLocationLabel : "";
            return fold(here) === fold(name) ? {} : { blocked: `that happens at ${name}` };
          })(),
        } as never)
      : null,
    ...(w.timeOfDay !== undefined ? { timeOfDay: w.timeOfDay } : {}),
    ...(input.turnIndex !== undefined ? { turnIndex: input.turnIndex as number } : {}),
    events: events.map((e) => ({
      kind: e.kind as string,
      ...(obj(e.payload) ? { payload: e.payload as Record<string, unknown> } : {}),
      createdAtMs: millis(e.createdAt),
    })),
    ...(input.requestKind !== undefined
      ? { requestKind: input.requestKind as "live" | "options" }
      : {}),
    ...(input.currentNodeKind
      ? { currentNodeKind: input.currentNodeKind as "branch" | "continuation" }
      : {}),
    isOpeningBeat: input.isOpeningBeat === true,
    ...(obj(input.choice) ? { choice: input.choice as never } : {}),
    ...(typeof input.freeText === "string" && input.freeText ? { freeText: input.freeText } : {}),
    ...(obj(input.practiceOutcome) ? { practiceOutcome: input.practiceOutcome as never } : {}),
    ...(typeof input.retryHint === "string" ? { retryHint: input.retryHint } : {}),
  };
}
