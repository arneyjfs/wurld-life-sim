/**
 * LIFE-ONBOARD-*: onboarding for a new life world.
 *
 * A fixed header over one scroll surface: name field, language
 * selection (the shared picker — LIFE-ONBOARD-2), the world-MODE
 * toggle, the mode's example chips, then the free-text seed.
 *
 * The header sits OUTSIDE the scroller and owns `pt-safe-top`
 * (LIFE-ONBOARD-9). As a `sticky` child of a padded scroller it
 * parked below that padding while content ran up through it, so the
 * subtitle rendered over the status bar.
 *
 * The 2026-07-31 redesign (owner request) rebuilt the bottom half. It
 * used to be a flat nine-chip grid with a realism hint floating above
 * it and "Write your own" tucked underneath as a disclosure — so the
 * two things that actually shape a wurld (which register, and the
 * player's own idea) were the two least prominent things on the
 * screen. The mode toggle now leads and the free-text box is a
 * first-class field rather than a disclosure.
 *
 * The chips then moved ABOVE that box and back again. Promoting the
 * box made it the primary path but left the chips discoverable only
 * by a scroll that OVERSHOT it. The owner's call is that the chips
 * should be passed THROUGH on the way down instead (2026-07-31,
 * later the same day): "put the example wurld cards above the free
 * text input again so the user has to scroll past them". So the
 * examples lead and the box is the floor of the form — and the "or"
 * moved with them, because a heading reading "Or start from an
 * example" above the box is an alternative to nothing.
 *
 * The realism nudge is GONE as a standalone note: its content now
 * rides on the Realistic segment's subtitle, next to the choice it is
 * trying to influence, with the counter-case stated just as plainly
 * on the Fantasy segment. A nudge above a grid was arguing with a
 * decision the player had not been asked to make yet.
 *
 * The vertical rhythm is DELIBERATELY loose (LIFE-ONBOARD-11). Do NOT
 * tighten it to fit more into the first screen — that was tried and
 * read as crammed. It survives the reorder unchanged: the spacing is
 * what forces the scroll that now carries the player past the chips.
 *
 * Tapping a chip or submitting a manual seed writes the lifeWorld
 * doc and navigates to /life (LIFE-ONBOARD-6). The first scene +
 * first beat are kicked off from LifeScreen on arrival (Phase B.2).
 *
 * Spec: docs/specs/life-sim.md §3.
 */
import { levelFor } from '@/lib/level';
import { useEffect, useRef, useState } from 'react';
import { Building2, ChevronDown, Loader, Wand2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { BackButton } from '@/components/nav/BackButton';
import { useKeyboardState } from '@/hooks/useKeyboardState';
import { useT } from '@/i18n';
import { useI18nStore } from '@/i18n/store';
import { resolveSystemLanguage } from '@/lib/life/systemLanguage';
import { useAuthStore } from '@/store/authStore';
import { useUserProfile } from '@/hooks/useUserProfile';
import {
  createLifeWorld,
  newWorldId,
  setLastSeenWorld,
  updateLifeWorld,
} from '@/lib/life/world';
import {
  generateCharacterBio,
  renderBioForPrompt,
} from '@/lib/life/generateBio';
import { runWorldArcGenerate } from '@/lib/life/runWorldArcGenerate';
import { runSagaOpen } from '@/lib/life/runSagaOpen';
import type { LifeWorld, WorldSaga } from '@/types/firestore';
import { useUIStore } from '@/store/uiStore';
import { toUserMessage } from '@/lib/errors';
import { getBaseLanguageName, getLanguageFlag, localizedLanguageName } from '@/lib/languages';
import { cn } from '@/lib/cn';
import { LanguagePicker } from '@/components/LanguagePicker';
import type { WorldMode, WorldSeedKey } from '@/types/firestore';
import { chipsForMode, DEFAULT_WORLD_MODE, WORLD_MODES } from './worldModes';
import * as log from '@/lib/log';

const MODE_ICON = { realistic: Building2, fantasy: Wand2 } as const;

export function LifeStartScreen() {
  const t = useT();
  const locale = useI18nStore((st) => st.locale);
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const profile = useUserProfile(user?.uid ?? null);
  const pushToast = useUIStore((s) => s.pushToast);

  const [name, setName] = useState('');
  const [mode, setMode] = useState<WorldMode>(DEFAULT_WORLD_MODE);
  const [manualText, setManualText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // LIFE-ONBOARD-2: `null` means "follow the profile". Deliberately NOT
  // seeded from the profile in `useState`: the profile arrives async, so an
  // initialiser would freeze whatever was there on first render (the
  // 'French' fallback) and never pick up the real value. Reading through
  // `??` on every render means the row tracks settings until the player
  // overrides it, and their choice sticks from then on.
  const [pickedLanguage, setPickedLanguage] = useState<string | null>(null);
  const [langPickerOpen, setLangPickerOpen] = useState(false);

  // COMP-KB-22 / LIFE-ONBOARD-10 — see the effect below.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const seedRef = useRef<HTMLTextAreaElement | null>(null);
  const [seedFocused, setSeedFocused] = useState(false);
  const kb = useKeyboardState();

  /**
   * COMP-KB-22 — keep the focused seed field clear of the keyboard.
   *
   * It sits low in a long scroll, so on a phone the keyboard opens straight
   * over the box the player is being asked to type into. `.pb-keyboard` on
   * the scroller makes the room; this moves the field INTO it.
   *
   * Three properties, and each one is load-bearing against the jitter the
   * previous implementation produced when the keyboard's top edge bisected
   * the field (owner, 2026-07-31):
   *
   * 1. It scrolls THIS CONTAINER, never the document. `scrollIntoView`
   *    scrolls every scrollable ancestor including the viewport, and
   *    `keyboardInset.ts` owns the window scroll position while a keyboard
   *    opens — a 350ms rAF loop forcing `scrollTo(0, 0)` (COMP-KB-10) and a
   *    permanent `visualViewport.scroll` snap-back. Two writers of one
   *    number, once per frame.
   * 2. It is INSTANT. A `behavior: 'smooth'` scroll keeps writing across the
   *    whole animation, so it is not one contested write but sixty.
   * 3. It moves the MINIMUM distance and is a no-op once the field is
   *    clear — so it cannot be re-triggered by the layout change it just
   *    caused. `block: 'center'` was neither: it re-aims every time it runs,
   *    at a centre that is still moving while `--kb-h` settles.
   *
   * Driven by the settled keyboard height rather than a bare 300ms timer:
   * `useKeyboardState` only publishes committed values (COMP-KB-9's settle
   * debounce, plus COMP-KB-13's upward corrections at +150/+350ms), so each
   * correction targets a layout that has stopped moving. The follow-up pass
   * covers the one thing that is still in flight after that — `.pb-keyboard`
   * transitions its padding over 250ms, so the room to lift the field may
   * not exist yet on the first attempt.
   */
  useEffect(() => {
    if (!seedFocused) return;
    const align = () => {
      const port = scrollerRef.current;
      const field = seedRef.current;
      if (!port || !field) return;
      const portBox = port.getBoundingClientRect();
      const fieldBox = field.getBoundingClientRect();
      // The keyboard OVERLAYS the layout viewport rather than shrinking it
      // (COMP-KB-1's `KeyboardResize.None`; `html`/`body` pinned to a fixed
      // height on web), so the bottom edge that actually matters is whichever
      // of the scrollport and the keyboard's top comes first. On iOS PWA
      // `innerHeight` under-reports the WebView by the status-bar zone, which
      // biases this a few tens of px CONSERVATIVE — the field lands slightly
      // higher than required, never lower.
      const keyboardTop = window.innerHeight - kb.height;
      const below = fieldBox.bottom - Math.min(portBox.bottom, keyboardTop);
      const above = portBox.top - fieldBox.top;
      const delta = below > 0 ? below : above > 0 ? -above : 0;
      if (delta === 0) return;
      port.scrollTop += delta;
    };
    align();
    const settle = window.setTimeout(align, 300);
    return () => window.clearTimeout(settle);
  }, [seedFocused, kb.height]);

  // LIFE-ONBOARD-2: the profile is the DEFAULT, so the screen waits for it
  // (see the `profile.loading` gate below) rather than rendering a guess.
  // The 'French' tail only covers a profile that has genuinely landed
  // carrying no learningLanguage.
  const practiceLanguage =
    pickedLanguage ?? profile.data?.learningLanguage ?? 'French';
  const nativeLanguage = profile.data?.nativeLanguage ?? 'English';
  const difficulty = levelFor(profile.data, practiceLanguage); // XP-LANG-4

  // LIFE-LANG-7: the wurld's SYSTEM language (narration language),
  // captured from the ACTIVE app locale. resolveSystemLanguage prefers
  // the user's own native/practice NAMES so the downstream
  // `=== practiceLanguage` immersion gate is exact.
  //
  // The on-screen "narration will be in X" warning this used to drive was
  // REMOVED 2026-07-31 (owner: narration behaviour has changed since the
  // warning was written, so it no longer described what happens). The
  // VALUE is unaffected — it is still captured and still written to the
  // world doc; only the warning UI is gone.
  const activeLocale = useI18nStore((s) => s.locale);
  const systemLanguage = resolveSystemLanguage({
    activeLocale,
    nativeLanguage,
    practiceLanguage,
  });

  async function begin(seedKey: WorldSeedKey, seedText?: string): Promise<void> {
    if (!user || submitting) return;
    setSubmitting(true);
    try {
      const characterName =
        name.trim() || profile.data?.displayName || 'You';
      const worldId = newWorldId();
      await createLifeWorld({
        uid: user.uid,
        worldId,
        characterName,
        practiceLanguage,
        nativeLanguage,
        systemLanguage,
        difficulty,
        worldSeedKey: seedKey,
        worldSeedText: seedText,
        // LIFE-ONBOARD-3: persisted for EVERY seed. 'surprise' and
        // 'manual' carry no register in their key, so without this the
        // toggle would be a filter over chips and nothing more.
        worldMode: mode,
      });
      // Remember this world as the lastSeen so the overview can
      // highlight it on next visit (though entry always lands on
      // overview per LIFE-WORLD-3).
      void setLastSeenWorld(user.uid, worldId).catch(() => undefined);
      // LIFE-WORLD-SAGA-* → LIFE-ONBOARD-6 (bio) → LIFE-WORLD-ARC-*
      // (chapter 1). Fully chained: saga first (book-level through-
      // line), then bio (so the player's character situation
      // reflects the saga's factions / antagonist / arc), then
      // chapter 1 (act-beat one). Non-blocking on the navigation —
      // the player lands on /life/{worldId} immediately; the
      // opening-step gate in LifeScreen waits for saga + chapter
      // before firing the first turn.
      void (async () => {
        const stubWorld = {
          id: worldId,
          characterName,
          practiceLanguage,
          nativeLanguage,
          systemLanguage,
          difficulty,
          worldSeedKey: seedKey,
          worldSeedText: seedText,
          worldMode: mode,
        } as LifeWorld;
        // LIFE-ARCH — `sagaOpen` replaces `worldSaga`. It writes the universe,
        // the situation, the two-tier cast and the ONE thing in motion, and is
        // forbidden from stating any outcome (LIFE-ARCH-3). The `saga` field it
        // used to fill — premise, midpointTwist, climax, candidateEndings — is
        // gone: every one of those was a stored future, and a model handed the
        // twist writes toward the twist.
        // Always written, on both arms — see the failure branch for why a
        // world without one is unreachable rather than merely plain.
        let saga: WorldSaga;
        const opened = await runSagaOpen({ world: stubWorld });
        if (opened.kind === 'ok') {
          // A thin `saga` survives ONLY as the display record — the title the
          // wurld card shows, its translation, the player's teaser and the tone
          // line. Nothing reads it for story.
          //
          // LIFE-ARCH-8: `playerFacingTeaser` was dropped here in the migration
          // and never noticed, because `ZWorldSaga` defaults it to '' — so
          // every card since has read "Your story is being written…".
          saga = {
            title: opened.state.title,
            titleNative: opened.state.titleNative,
            playerFacingTeaser: opened.state.playerFacingTeaser,
            tone: opened.state.tone,
          } as unknown as WorldSaga;
          await updateLifeWorld(user.uid, worldId, {
            saga,
            universe: opened.state.universe,
            situation: opened.state.situation,
            cast: opened.state.cast,
            fronts: opened.state.fronts,
            sagaHistory: [],
            recentSubjects: [],
            // LIFE-GOAL-1/2 — the ladder the world opens with. Spread-when-present
            // for the same reason as every other optional Firestore field: the
            // SDK rejects an `undefined` value outright, and a world whose saga
            // arrived without a goal should play without direction rather than
            // fail to open (`runSagaOpen` logs it).
            ...(opened.state.ladder ? { goalLadder: opened.state.ladder } : {}),
          });
        } else {
          // LIFE-ARCH-3 — A DISPLAY-ONLY FALLBACK, AND THE DISTINCTION IS THE
          // WHOLE POINT.
          //
          // `runSagaOpen` refuses to invent a world, and that is right: the
          // call it replaced synthesised a whole `trivialSaga` — premise,
          // conflict, antagonist — so a failed open produced a world that
          // played badly for its entire life and never said so.
          //
          // But refusing to invent moved the failure somewhere with nowhere to
          // put it. `LifeScreen` gates BOTH the intro screen and the opening
          // turn on `world.saga`, so with nothing written the player sat on
          // "Building your wurld…" for ever — no error, nothing to retry, and
          // a world they can never enter. Measured on the mocked E2E path the
          // moment `sagaOpen` started failing.
          //
          // So this writes the DISPLAY record and nothing else: a title, from
          // the player's own seed. No cast, no fronts, no situation — nothing
          // false enters the world, and the step engine improvises from the
          // bio and the chapter exactly as it does for a world whose state has
          // not arrived yet. Thin, enterable, and loud in the log.
          log.warn('life.sagaOpen.failed', { reason: opened.reason });
          // LIFE-ARCH-8: no teaser on this arm either, and deliberately — an
          // invented caption is exactly the "nothing false enters the world"
          // line above. The card shows the pending stub, which is true.
          saga = {
            title: seedText?.trim() || characterName,
            titleNative: '',
            playerFacingTeaser: '',
            tone: '',
          } as unknown as WorldSaga;
          await updateLifeWorld(user.uid, worldId, { saga });
        }
        // Bio reads the saga so the player's people / job / current
        // situation align with the saga's setup. Non-blocking on
        // chapter gen — the chapter doesn't depend on bio.
        const worldWithSaga = saga
          ? ({ ...stubWorld, saga } as typeof stubWorld)
          : stubWorld;
        // LIFE-ONBOARD-17 — BIO BEFORE CHAPTER, and the await is the fix.
        //
        // These used to run in parallel, under a comment claiming they "both
        // depend on saga but not on each other". They do depend on each other.
        // The bio fixes the two most concrete facts in the player's life —
        // their JOB and WHERE THEY LIVE — and the chapter is about their life.
        // Reported 2026-08-03: a bio reading "analog communications technician
        // in Saint-Malo, in the lead-lined cellars" produced a chapter 1 about
        // "securing work at the local bakery" in Saint-Céneri. Different job,
        // different town, no shared fact. `buildWorldArcPrompt` renders
        // `world.bio` already — it was simply empty, because the write had not
        // landed when the chapter call was made.
        //
        // The ordering is not arbitrary: the bio is who the player IS, the
        // chapter is what HAPPENS to them, so the chapter conforms. It costs
        // one call's latency at world creation, behind the building-wurld
        // shimmer the player is already watching.
        let bioText: string | null = null;
        try {
          const bio = await generateCharacterBio({
            characterName,
            practiceLanguage,
            nativeLanguage,
            worldSeedKey: seedKey,
            worldSeedText: seedText,
            worldMode: mode,
            // LIFE-ARCH-3: the bio is written INSIDE the world that `sagaOpen`
            // just established, not inside a synopsis of one. Sequential for
            // exactly this reason — a bio generated in parallel had nothing to
            // agree with, which is how "my bio said I worked at the bakery but
            // the story disagreed" happened.
            story: opened.kind === 'ok'
              ? {
                  title: opened.state.title,
                  tone: opened.state.tone,
                  situation: opened.state.situation,
                  cast: opened.state.cast,
                  fronts: opened.state.fronts,
                }
              : null,
          });
          if (bio) {
            bioText = renderBioForPrompt(bio);
            await updateLifeWorld(user.uid, worldId, { bio: bioText });
          }
        } catch (err) {
          log.warn('life.bio.attempt-failed', { err: String(err) });
        }

        try {
          const arcResult = await runWorldArcGenerate({
            uid: user.uid,
            world: {
              ...worldWithSaga,
              ...(bioText ? { bio: bioText } : {}),
            } as Parameters<typeof runWorldArcGenerate>[0]['world'],
            chapterNumber: 1,
          });
          await updateLifeWorld(user.uid, worldId, {
            currentArc: arcResult.arc,
          });
        } catch (err) {
          log.warn('life.worldArc.attempt-failed', { err: String(err) });
        }
      })();
      navigate(`/wurlds/${worldId}`, { replace: true });
    } catch (err) {
      log.error(err, { action: 'createLifeWorld' });
      pushToast({ kind: 'error', message: toUserMessage(err) });
      setSubmitting(false);
    }
  }

  // LIFE-ONBOARD-2: WAIT for the profile rather than render a default that
  // might be wrong. The old code fell straight through to 'French' while the
  // doc was in flight, so a player whose setting is German could both SEE
  // the wrong language and — by tapping a seed chip before the doc landed —
  // have a wurld created in it. Gating the whole screen fixes the display
  // and the write together; gating only the row would leave the race.
  //
  // After every hook, so the hook order is stable across both branches.
  // `useDocSnapshot` serves a cached doc synchronously, so on any visit
  // after the first this branch is never seen.
  if (profile.loading) {
    return (
      <div
        data-testid="LifeStart-ProfileLoading"
        className="flex-1 min-h-0 flex items-center justify-center bg-(--color-bg)"
      >
        <Loader size={20} className="animate-spin text-(--color-fg-muted)" />
      </div>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-(--color-bg)">
      {/* COMP-KB-14: `.pb-keyboard` gives the scrollable onboarding form room
          to bring the focused field (name / manual seed textarea) above the
          soft keyboard — keyboard down it collapses to the safe-area floor. */}
      {/* LIFE-ONBOARD-9 — the header owns the safe area and sits OUTSIDE the
          scroll container, matching LifeOverviewScreen.

          It used to be `sticky top-0` INSIDE a container carrying
          `pt-safe-top`. Sticky offsets resolve against the scrollport, so the
          header parked BELOW that padding while the scrolled content ran up
          THROUGH it — the subtitle rendered over the status bar with the
          header sitting under it (owner screenshot, 2026-07-31). Taking the
          header out of the scroller makes the strip structurally
          unreachable rather than covered by a matching background. */}
      <header className="shrink-0 px-4 pt-safe-top bg-(--color-bg)">
        <div className="w-full max-w-md mx-auto flex items-center gap-3 pt-2 pb-2">
          <BackButton />
          <h1 className="flex-1 text-center text-base font-semibold pr-6">
            {t('life.onboard.title')}
          </h1>
        </div>
      </header>

      {/* LIFE-ONBOARD-11 — the rhythm below (`mb-8` between sections, a
          6-row seed box) is a deliberate choice, not an accident of
          editing. Do NOT tighten it to fit more of the form into the
          first screen: that was tried and the page read as crammed.
          The spacing is load-bearing for LIFE-ONBOARD-4 as well — it
          is what guarantees the scroll down to the seed box that
          carries the player through the example chips on the way. */}
      <div
        ref={scrollerRef}
        data-testid="LifeStart-Scroll"
        className="w-full max-w-md mx-auto px-4 pb-keyboard flex-1 flex flex-col overflow-y-auto"
      >
        <p className="text-sm text-(--color-fg-muted) mb-7 pt-2">
          {t('life.onboard.subtitle', {
            // I18N-EDGE-5 — prose names the LANGUAGE, not the raw value.
            language: localizedLanguageName(getBaseLanguageName(practiceLanguage), locale),
          })}
        </p>

        <section className="mb-8">
          <label
            htmlFor="life-onboard-name"
            className="text-xs font-bold uppercase tracking-wide text-(--color-fg-muted) mb-2 block"
          >
            {t('life.onboard.name.label')}
          </label>
          <input
            id="life-onboard-name"
            data-testid="LifeStart-Name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('life.onboard.name.placeholder')}
            maxLength={32}
            className="w-full px-3 py-2 rounded-xl border border-(--color-border) bg-(--color-bg-elevated) text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/40"
          />
        </section>

        <section className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wide text-(--color-fg-muted) mb-2">
            {t('life.onboard.language.label')}
          </div>
          {/* LIFE-ONBOARD-2: opens the SAME picker settings uses, on the
              same 'practice' recents bucket, so any supported language is
              reachable here. The row was read-only, which contradicted the
              hint directly under it ("languages are set per wurld") — the
              doc has always carried its own practiceLanguage. */}
          <button
            type="button"
            data-testid="LifeStart-Language"
            onClick={() => setLangPickerOpen(true)}
            disabled={submitting}
            className={cn(
              'inline-flex items-center gap-2 px-3 py-2 rounded-xl',
              'border border-(--color-border) bg-(--color-bg-elevated)',
              submitting
                ? 'opacity-50 cursor-not-allowed'
                : 'hover:bg-(--color-bg-hover)',
            )}
          >
            <span className="text-lg leading-none">
              {getLanguageFlag(practiceLanguage) || '🌐'}
            </span>
            {/* I18N-EDGE-5 — a picker-style chip KEEPS the variant: this is where
                  you choose between the four Englishes. */}
              <span className="text-sm font-medium">
                {localizedLanguageName(practiceLanguage, locale, { style: 'label' })}
              </span>
            <ChevronDown size={16} className="text-(--color-fg-muted)" />
          </button>
          <p className="text-[11px] text-(--color-fg-muted) mt-1.5">
            {t('life.onboard.language.hint')}
          </p>

        </section>

        {/* LIFE-ONBOARD-3: the world-mode toggle. Both subtitles render
            at all times — the player is being asked to weigh two
            trade-offs against each other, and a subtitle that only
            appears once you have already chosen cannot help with
            that. */}
        <section className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wide text-(--color-fg-muted) mb-2">
            {t('life.onboard.mode.label')}
          </div>
          <div
            role="radiogroup"
            aria-label={t('life.onboard.mode.label')}
            className="grid grid-cols-2 gap-2"
          >
            {/* LIFE-ONBOARD-15: the order comes from WORLD_MODES, not from a
                literal here. This used to be `['realistic', 'fantasy']`, a
                second source of truth that disagreed with the array the moment
                the array changed. */}
            {WORLD_MODES.map(({ mode: m }) => {
              const Icon = MODE_ICON[m];
              const active = mode === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(m)}
                  disabled={submitting}
                  data-testid={`LifeStart-Mode-${m}`}
                  className={cn(
                    'flex flex-col items-start gap-1.5 p-3 rounded-2xl text-left border transition-colors',
                    active
                      ? 'border-(--color-accent) bg-(--color-accent)/10'
                      : 'border-(--color-border) bg-(--color-bg-elevated)',
                    submitting && 'opacity-50 cursor-not-allowed',
                  )}
                >
                  <Icon
                    size={20}
                    className={
                      active ? 'text-(--color-accent)' : 'text-(--color-fg-muted)'
                    }
                  />
                  {/* Full contrast on BOTH segments. Selection is already
                      carried by the border, the background tint and the
                      icon colour; greying the unselected title as well
                      made it read as disabled rather than unchosen. */}
                  <div className="text-sm font-semibold text-(--color-fg)">
                    {t(`life.onboard.mode.${m}`)}
                  </div>
                  <div className="text-[11px] leading-snug text-(--color-fg-muted)">
                    {t(`life.onboard.mode.${m}.sub`)}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        {/* LIFE-ONBOARD-4: examples, filtered to the live mode. They sit
            ABOVE the free-text box so the player meets them on the way
            down to it rather than by overshooting it. */}
        <section className="mb-8">
          <div className="text-xs font-bold uppercase tracking-wide text-(--color-fg-muted) mb-2">
            {t('life.onboard.seed.examples.label')}
          </div>

          <div className="grid grid-cols-2 gap-2 mb-3">
            {chipsForMode(mode).map((chip) => (
              <button
                key={chip.key}
                type="button"
                onClick={() => void begin(chip.key)}
                disabled={submitting}
                data-testid={`LifeStart-Seed-${chip.key}`}
                className={cn(
                  'flex flex-col items-start gap-0.5 px-3 py-2.5 rounded-2xl text-left',
                  'border border-(--color-border) bg-(--color-bg-elevated)',
                  'transition-colors',
                  submitting
                    ? 'opacity-50 cursor-not-allowed'
                    : 'hover:bg-(--color-bg-hover) active:scale-[0.98]',
                )}
              >
                <div className="flex items-center gap-1.5 text-sm font-medium text-(--color-fg) leading-snug">
                  <span className="text-base leading-none">{chip.emoji}</span>
                  <span>{t(`life.onboard.seed.chip.${chip.key}`)}</span>
                </div>
                {(() => {
                  const hint = t(`life.onboard.seed.chip.${chip.key}.hint`);
                  return hint ? (
                    <div className="text-[11px] text-(--color-fg-muted) leading-snug">
                      {hint}
                    </div>
                  ) : null;
                })()}
              </button>
            ))}
          </div>
        </section>

        {/* LIFE-ONBOARD-5: the free-text seed, LAST — the floor of the
            form. It still inherits the register the toggle set; what
            changed is that the chips are now read on the way to it, so
            its heading carries the "or" (LIFE-ONBOARD-4). */}
        <section className="mb-8">
          <label
            htmlFor="life-onboard-manual"
            className="text-xs font-bold uppercase tracking-wide text-(--color-fg-muted) mb-2 block"
          >
            {t('life.onboard.seed.manual.label')}
          </label>
          <div className="flex flex-col gap-3">
            <textarea
              ref={seedRef}
              id="life-onboard-manual"
              data-testid="LifeStart-ManualText"
              value={manualText}
              onChange={(e) => setManualText(e.target.value)}
              placeholder={t(`life.onboard.seed.manual.placeholder.${mode}`)}
              // COMP-KB-22 — focus only ARMS the correction; the effect above
              // runs it once the keyboard height has settled.
              onFocus={() => setSeedFocused(true)}
              onBlur={() => setSeedFocused(false)}
              // LIFE-ONBOARD-11 — a genuinely writable box. The player is
              // being asked for a person, a situation and a source of drama;
              // three lines showed about a third of that at a time.
              rows={6}
              maxLength={500}
              className="w-full px-3 py-2 rounded-xl border border-(--color-border) bg-(--color-bg-elevated) text-sm focus:outline-none focus:ring-2 focus:ring-(--color-accent)/40 resize-none"
            />
            <button
              type="button"
              onClick={() => void begin('manual', manualText)}
              disabled={submitting || !manualText.trim()}
              data-testid="LifeStart-ManualSubmit"
              className={cn(
                'self-end px-4 py-2 rounded-full text-sm font-semibold',
                submitting || !manualText.trim()
                  ? 'bg-(--color-bg-hover) text-(--color-fg-muted) cursor-not-allowed'
                  : 'bg-gradient-accent text-white',
              )}
            >
              {t('life.onboard.startCta')}
            </button>
          </div>
        </section>

        {submitting && (
          <div className="flex items-center justify-center gap-2 text-sm text-(--color-fg-muted) mt-auto pt-4">
            <Loader size={14} className="animate-spin" />
            <span>{t('life.onboard.creating')}</span>
          </div>
        )}
      </div>

      <LanguagePicker
        open={langPickerOpen}
        onClose={() => setLangPickerOpen(false)}
        value={practiceLanguage}
        bucket="practice"
        title={t('life.onboard.language.pickerTitle')}
        onChange={setPickedLanguage}
      />
    </div>
  );
}
