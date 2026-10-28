/**
 * LIFE-BUBBLE-*: the two-bubble sliding window overlaid on the
 * scene. AT MOST two items visible. Three speaker treatments:
 *
 *   - narrator → system/world cue, centered + greyed card with
 *     no avatar. e.g. "You arrive at the bakery. Paul, the owner,
 *     smiles when he sees you."
 *   - npc      → left-aligned message bubble with the NPC's
 *     avatar to the left of the bubble.
 *   - user     → right-aligned message bubble with the user's
 *     avatar to the right.
 *
 * When a new turn arrives, items further than the most recent two
 * slide off the top.
 *
 * Spec: docs/specs/life-sim.md §9.
 */
import type { CSSProperties } from 'react';
import { cn } from '@/lib/cn';
import { dirOf } from '@/lib/textDirection';
import { TTSButton } from '@/components/TTSButton';
import type { ViewSettings } from '@/lib/viewSettings';
import { bubbleTexts } from './bubbleTexts';
import { beatEnterOffsetX } from './nodeEngineGlide';
import { Avatar } from './Avatar';
import { BubbleVocabText } from './BubbleVocabText';
import type { LifeWordSave } from './useLifeWordSave';
import { useLifeBubbleFlip } from './useLifeBubbleFlip';
import { useExitingBubbles } from './useExitingBubbles';
import { LifeFlipSurface } from './LifeFlipSurface';
import { SecondRowReveal } from '@/components/Message/SecondRowReveal';

/** LIFE-LANG-3: life's default is practice-only — the ONE place it diverges
 *  from chat's `DEFAULT_VIEW_SETTINGS`. The player reads the target language
 *  with the gloss one flip away (LIFE-LANG-16). */
const LIFE_DEFAULT_VIEW_SETTINGS: ViewSettings = {
  primary: 'practice',
  secondRow: false,
};

/**
 * LIFE-LANG-16 — the gloss row appears and disappears INSTANTLY, in the frame
 * the card is at zero width. It used to open and close on a
 * `grid-template-rows` height glide, which is the mechanism MSG-BUBBLE-12.8
 * rules out: it animated the bubble's own box, so the card the finger was on
 * grew under it. `LifeFlipSurface` animates the SPACE beside the bubble on the
 * same schedule the chat bubble uses, and the box itself just steps.
 */

/**
 * LIFE-NODE-12 — the horizontal half of the `.life-beat-enter` glide, as an
 * inline custom property the keyframe reads.
 *
 * Inline style, not a utility class, for the reason MSG-BUBBLE-8.1 records
 * against the chat entrance: Tailwind's JIT scans SOURCE TEXT, so a class
 * built from a constant is never generated and the travel silently falls back
 * to the default — a green test asserting the class name is present is exactly
 * how that shipped the first time. Tests here assert the RESOLVED property.
 *
 * The direction itself lives in `beatEnterOffsetX` (nodeEngineGlide.ts), next
 * to the other numbers mirrored from globals.css.
 */
function beatEnterStyle(speaker: Bubble['speaker']): CSSProperties {
  return { '--life-beat-enter-x': beatEnterOffsetX(speaker) } as CSSProperties;
}

export type Bubble = {
  id: string;
  speaker: 'narrator' | 'npc' | 'user';
  speakerName?: string | null;
  /** Stable NPC slug — when set, the dialogue area looks up the
   *  matching lifeNpcs row to find an avatar URL. Persistent NPCs
   *  flip from initials → SVG avatar once gen lands (Phase C
   *  visuals task wires the avatar gen call). */
  npcId?: string | null;
  practiceText: string;
  nativeText?: string | null;
  /** LIFE-BUBBLE-7 — model-flagged hard words in practiceText; the
   *  vocab-tap UI underlines them. Mirrors MSG-VOCAB-*'s field. */
  complexWords?: string[];
  /** LIFE-BUBBLE-7 — per-word native glosses for the tap popover. */
  wordTranslations?: Record<string, string>;
};

type Props = {
  /** Any number of bubbles; the component caps the visible set
   *  to the LAST two. */
  bubbles: Bubble[];
  /** Used to render the user's avatar + (future) for accessibility
   *  labels. */
  characterName: string;
  /** The world's practice language — drives the per-bubble TTS speak
   *  button (TTS-SURFACE-4). When absent / unsupported, no button shows. */
  practiceLanguage?: string;
  /** Optional user avatar URL (Phase C). */
  userAvatarUrl?: string | null;
  /** LIFE-LANG-3 / MSG-VIEW-7: the wurld's view settings. Defaults to
   *  practice-only — the native gloss behind a chat-style flip
   *  (LIFE-LANG-16). The comprehension-source gate
   *  (hideNativeForUtterance) OUTRANKS this (LIFE-LANG-4). */
  viewSettings?: ViewSettings;
  /** LIFE-EX-INBOUND-LEAK: when set, the bubble whose practiceText
   *  matches this string is the SOURCE of the active comprehension
   *  question. Its native translation is HIDDEN to prevent answer
   *  leak; user can tap to reveal at the cost of the test. */
  hideNativeForUtterance?: string | null;
  /** LIFE-NPC-1/2: lookup for persistent NPC avatars by npcId. The
   *  dialogue area resolves a bubble's avatar URL via this map;
   *  transient NPCs (no npcId) and unresolved entries fall back to
   *  the initials Avatar. */
  npcAvatarUrls?: ReadonlyMap<string, string | null>;
  /** TTS-VOICE-9: npcId -> the Gemini voice cast for that character
   *  (`voiceForSpeaker`, from the world's cast + the per-wurld hash). Resolved
   *  in `LifeScreen`, which is the only place holding the cast — the same
   *  reason `npcAvatarUrls` is resolved there and threaded rather than looked
   *  up here. A missing entry, a transient NPC with no `npcId`, or an absent
   *  map all leave `voiceName` undefined, which `TTSButton` reads as "no
   *  override" and answers with the player's own `voicePreference`
   *  (`TTS-PREF-1`) — i.e. exactly the pre-TTS-VOICE-1 behaviour, so no world
   *  is worse off than it was. */
  npcVoiceNames?: ReadonlyMap<string, string>;
  /** LIFE-NPC-2: npcIds whose avatar SVG is still generating — the slot
   *  shows a person icon under a shimmer instead of initials. */
  npcAvatarPending?: ReadonlySet<string>;
  /** LIFE-NPC-2: the player's own avatar is still generating. */
  userAvatarLoading?: boolean;
  /** LIFE-BUBBLE-CURRENT: bubble ids that belong to the current
   *  turn (bubbles landed since the player's most recent action).
   *  These render with a gradient border; previous-turn bubbles
   *  render flat. */
  currentTurnIds?: ReadonlySet<string>;
  /** LIFE-NPC-2 (modal): fired when the player taps an avatar.
   *  LifeScreen owns the modal state + maps npcId to the full NPC
   *  doc for the bio. The user case carries npcId=null. */
  onAvatarTap?: (info: {
    kind: 'user' | 'npc';
    npcId: string | null;
    name: string;
  }) => void;
  /** LIFE-BUBBLE-7: save/unsave wiring from `useLifeWordSave`. When
   *  absent, bubbles render plain text (no vocab taps). */
  wordSave?: LifeWordSave;
};

export function DialogueArea({
  bubbles,
  characterName,
  practiceLanguage,
  userAvatarUrl,
  userAvatarLoading,
  hideNativeForUtterance,
  viewSettings = LIFE_DEFAULT_VIEW_SETTINGS,
  npcAvatarUrls,
  npcVoiceNames,
  npcAvatarPending,
  currentTurnIds,
  onAvatarTap,
  wordSave,
}: Props) {
  const visible = bubbles.slice(-2);
  // LIFE-BUBBLE-15: beats that just left the window, held for one fade. They
  // render ABOVE `visible` because that is where they were standing.
  const exiting = useExitingBubbles(visible);

  return (
    <div
      className="absolute left-0 right-0 bottom-0 px-3 pb-4 pt-12 flex flex-col gap-2 pointer-events-none bg-gradient-to-t from-(--color-bg) via-(--color-bg)/85 to-transparent"
      data-testid="LifeScreen-DialogueArea"
    >
      {exiting.map((b) => (
        <div
          key={`exit-${b.id}`}
          data-testid="LifeScreen-BeatExiting"
          aria-hidden="true"
          className="life-beat-exit pointer-events-none"
        >
          <BubbleView
            bubble={b}
            viewSettings={viewSettings}
            characterName={characterName}
            practiceLanguage={practiceLanguage}
            userAvatarUrl={userAvatarUrl ?? null}
            hideNative={
              !!hideNativeForUtterance &&
              b.practiceText.trim() === hideNativeForUtterance.trim()
            }
            npcAvatarUrl={
              b.npcId && npcAvatarUrls ? npcAvatarUrls.get(b.npcId) ?? null : null
            }
            npcVoiceName={
              b.npcId && npcVoiceNames ? npcVoiceNames.get(b.npcId) : undefined
            }
            npcAvatarLoading={false}
            userAvatarLoading={false}
            isCurrent={false}
            wordSave={undefined}
          />
        </div>
      ))}
      {visible.map((b) => (
        // LIFE-NODE-13: the grow wrapper opens the row so the beats ABOVE ease
        // upward as this one arrives, instead of jumping to make room before
        // it glides in. Keyed by bubble id, so a newly-mounted beat plays it
        // once and a re-render of an existing beat keeps its DOM node and does
        // not replay — the same lifecycle the glide itself relies on.
        <div key={b.id} className="life-beat-grow pointer-events-none">
        <BubbleView
          bubble={b}
          viewSettings={viewSettings}
          characterName={characterName}
          practiceLanguage={practiceLanguage}
          userAvatarUrl={userAvatarUrl ?? null}
          hideNative={
            !!hideNativeForUtterance &&
            b.practiceText.trim() === hideNativeForUtterance.trim()
          }
          npcAvatarUrl={
            b.npcId && npcAvatarUrls ? npcAvatarUrls.get(b.npcId) ?? null : null
          }
          npcVoiceName={
            b.npcId && npcVoiceNames ? npcVoiceNames.get(b.npcId) : undefined
          }
          npcAvatarLoading={
            !!b.npcId && !!npcAvatarPending && npcAvatarPending.has(b.npcId)
          }
          userAvatarLoading={userAvatarLoading ?? false}
          isCurrent={currentTurnIds ? currentTurnIds.has(b.id) : false}
          onAvatarTap={onAvatarTap}
          wordSave={wordSave}
        />
        </div>
      ))}
    </div>
  );
}

function BubbleView({
  bubble,
  viewSettings,
  characterName,
  practiceLanguage,
  userAvatarUrl,
  hideNative,
  npcAvatarUrl,
  npcVoiceName,
  npcAvatarLoading,
  userAvatarLoading,
  isCurrent,
  onAvatarTap,
  wordSave,
}: {
  bubble: Bubble;
  viewSettings: ViewSettings;
  characterName: string;
  practiceLanguage?: string;
  userAvatarUrl: string | null;
  hideNative: boolean;
  npcAvatarUrl: string | null;
  /** TTS-VOICE-9: the cast voice for THIS speaker; undefined ⇒ the player's own. */
  npcVoiceName?: string;
  npcAvatarLoading: boolean;
  userAvatarLoading: boolean;
  isCurrent: boolean;
  onAvatarTap?: Props['onAvatarTap'];
  wordSave?: LifeWordSave;
}) {
  if (bubble.speaker === 'narrator')
    return (
      <SystemCueView
        bubble={bubble}
        viewSettings={viewSettings}
        isCurrent={isCurrent}
        wordSave={wordSave}
        practiceLanguage={practiceLanguage}
      />
    );
  if (bubble.speaker === 'user')
    return (
      <UserBubbleView
        bubble={bubble}
        viewSettings={viewSettings}
        characterName={characterName}
        practiceLanguage={practiceLanguage}
        avatarUrl={userAvatarUrl}
        avatarLoading={userAvatarLoading}
        wordSave={wordSave}
        isCurrent={isCurrent}
        onAvatarTap={
          onAvatarTap
            ? () => onAvatarTap({ kind: 'user', npcId: null, name: characterName })
            : undefined
        }
      />
    );
  return (
    <NpcBubbleView
      bubble={bubble}
      viewSettings={viewSettings}
      practiceLanguage={practiceLanguage}
      hideNative={hideNative}
      avatarUrl={npcAvatarUrl}
      avatarLoading={npcAvatarLoading}
      npcVoiceName={npcVoiceName}
      wordSave={wordSave}
      isCurrent={isCurrent}
      onAvatarTap={
        onAvatarTap
          ? () =>
              onAvatarTap({
                kind: 'npc',
                npcId: bubble.npcId ?? null,
                name: bubble.speakerName ?? '?',
              })
          : undefined
      }
    />
  );
}

/** Narrator beats — centered, greyed, no avatar. Scene context,
 *  arrival cues, mood-setting.
 *
 *  LIFE-LANG-8 (v2): narration is now the PRACTICE language too (leveled,
 *  vocab-tagged) — same one-channel model as dialogue. It renders
 *  practiceText primary + a `nativeText` gloss per the view settings
 *  (LIFE-LANG-3),
 *  with tappable vocab on `practiceText`. Legacy narrator beats stored the
 *  narration in `nativeText` with empty `practiceText`; those fall back to
 *  the gloss as the primary line so old worlds never render blank. */
function SystemCueView({
  bubble,
  viewSettings,
  isCurrent,
  wordSave,
  practiceLanguage,
}: {
  bubble: Bubble;
  viewSettings: ViewSettings;
  isCurrent: boolean;
  wordSave?: LifeWordSave;
  practiceLanguage?: string;
}) {
  const legacy = !bubble.practiceText || !bubble.practiceText.trim();
  // LIFE-LANG-16: narrator beats flip like the rest (v2 — narration is practice).
  const flippable = !legacy && !!bubble.nativeText;
  const flip = useLifeBubbleFlip(bubble.id, flippable, 'center');
  const { flipped } = flip;
  const texts = (f: boolean) =>
    legacy
      ? { primary: bubble.nativeText ?? '', secondary: null }
      : bubbleTexts(bubble, viewSettings, false, f);
  const { primary, secondary } = texts(flipped);
  // MSG-BUBBLE-12.10 — the OTHER face, for measurement only.
  const twinTexts = texts(!flipped);
  const vocabEnabled = !legacy && (bubble.complexWords?.length ?? 0) > 0;
  const narratorRows = (p: string, sec: string | null, measuring = false) => (
    <>
      <BubbleVocabText
        bubble={bubble}
        text={p}
        mine={false}
        wordSave={vocabEnabled ? wordSave : undefined}
        vocabTarget={bubble.practiceText || bubble.nativeText || ''}
        practiceLanguage={practiceLanguage}
      />
      {/* MSG-VIEW-7.9 — the eye REVEALS the gloss; it does not turn the card. */}
      <SecondRowReveal show={!!sec} instant={flip.measuring} measuring={measuring}>
        {sec ? (
          <div
            dir={dirOf(sec)}
            className="text-[12px] leading-snug pt-1 text-(--color-fg-muted) not-italic"
          >
            {sec}
          </div>
        ) : null}
      </SecondRowReveal>
    </>
  );
  // The gloss is currently withheld ⇒ this bubble is a flip-hint target.
  const withheld = flippable && !secondary;
  return (
    <div
      className="pointer-events-auto max-w-md mx-auto w-full life-beat-enter"
      // LIFE-NODE-12 — centered card, so it has no side to arrive from: it
      // rises only. Set explicitly rather than omitted so the narrator's zero
      // is a stated position, not an accident of the CSS fallback.
      style={beatEnterStyle('narrator')}
      data-testid="LifeScreen-Bubble-narrator"
      data-current={isCurrent ? 'true' : undefined}
    >
      <LifeFlipSurface
        flip={flip}
        padding="px-4 py-2"
        data-life-flip-target={withheld ? '' : undefined}
        className={cn(
          'mx-auto rounded-xl text-center',
          'text-[13px] leading-snug text-(--color-fg) italic',
          flippable && 'touch-pan-y',
          isCurrent
            ? 'life-bubble-current-narrator'
            : 'bg-(--color-bg-hover)/70 border border-(--color-border)/40',
        )}
        twin={narratorRows(twinTexts.primary, twinTexts.secondary, true)}
      >
        {narratorRows(primary, secondary)}
      </LifeFlipSurface>
    </div>
  );
}

/** NPC beats — left-aligned bubble with avatar + name. The native
 *  gloss is force-hidden (tap-to-reveal) when this bubble is the
 *  source of an active comprehension question — that gate outranks
 *  the view mode (LIFE-LANG-4). */
function NpcBubbleView({
  bubble,
  viewSettings,
  practiceLanguage,
  hideNative,
  avatarUrl,
  avatarLoading,
  isCurrent,
  onAvatarTap,
  wordSave,
  npcVoiceName,
}: {
  bubble: Bubble;
  viewSettings: ViewSettings;
  practiceLanguage?: string;
  hideNative: boolean;
  avatarUrl: string | null;
  /** TTS-VOICE-9: the cast voice for THIS speaker; undefined ⇒ the player's own. */
  npcVoiceName?: string;
  avatarLoading?: boolean;
  isCurrent: boolean;
  onAvatarTap?: () => void;
  wordSave?: LifeWordSave;
}) {
  const name = bubble.speakerName ?? '?';
  // LIFE-LANG-16: per-bubble flip (flippedBubbleStore, like chat MSG-VIEW-3).
  const flippable = !!bubble.nativeText;
  const flip = useLifeBubbleFlip(bubble.id, flippable, 'left');
  const { flipped } = flip;
  const { primary, secondary } = bubbleTexts(bubble, viewSettings, hideNative, flipped);
  // MSG-BUBBLE-12.10 — the OTHER face, for measurement only.
  const twinTexts = bubbleTexts(bubble, viewSettings, hideNative, !flipped);
  const npcRows = (pr: string, sec: string | null, measuring = false) => (
    <>
      <BubbleVocabText
        bubble={bubble}
        text={pr}
        mine={false}
        // LIFE-BUBBLE-7 leak gate: while this bubble is the comprehension-
        // question source and its gloss is hidden, per-word glosses would leak
        // the answer too. Flip re-enables the taps (the answer is spent).
        wordSave={!hideNative || flipped ? wordSave : undefined}
        className="text-[15px] leading-snug"
        practiceLanguage={practiceLanguage}
      />
      <SecondRowReveal show={!!sec} instant={flip.measuring} measuring={measuring}>
        {sec ? (
          <div dir={dirOf(sec)} className="text-[13px] leading-snug pt-1 text-(--color-fg-muted)">
            {sec}
          </div>
        ) : null}
      </SecondRowReveal>
    </>
  );
  const withheld = flippable && !secondary;
  return (
    <div
      className="pointer-events-auto max-w-md mx-auto w-full flex items-end gap-2 life-beat-enter"
      // LIFE-NODE-12 — left-aligned (LIFE-BUBBLE-3), so it slides in from the
      // LEFT as it rises.
      style={beatEnterStyle('npc')}
      data-testid="LifeScreen-Bubble-npc"
      data-current={isCurrent ? 'true' : undefined}
    >
      <Avatar name={name} svgUrl={avatarUrl} loading={avatarLoading} onTap={onAvatarTap} />
      <div className="flex flex-col gap-1 min-w-0">
        <div className="flex items-center gap-1.5 px-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-(--color-fg-muted)">
            {name}
          </div>
          {/* TTS-SURFACE-4: hear the NPC speak the practice language.
              Always speaks practiceText regardless of the view settings
              (LIFE-LANG-3 exclusion). */}
          {/* TTS-VOICE-9: in the CHARACTER's voice, not the player's. This
              button and the ListenComprehension card are two different
              surfaces speaking the same NPC, and only the card was given the
              cast voice (TTS-VOICE-6) — so the exercise sounded like Madame
              Mora and tapping her bubble sounded like the player. Undefined
              here is the legacy path and falls back to `voicePreference`. */}
          <TTSButton
            text={bubble.practiceText}
            language={practiceLanguage}
            voiceName={npcVoiceName}
            playbackKey={`life-npc-${bubble.id}`}
            size={22}
            warmOnMount={false}
          />
        </div>
        <LifeFlipSurface
          flip={flip}
          padding="px-4 py-3"
          data-life-flip-target={withheld ? '' : undefined}
          className={cn(
            'rounded-2xl rounded-bl-md shadow-sm text-(--color-fg)',
            flippable && 'touch-pan-y',
            isCurrent
              ? 'life-bubble-current-npc'
              : 'bg-(--color-bg-elevated) border border-(--color-border)',
          )}
          twin={npcRows(twinTexts.primary, twinTexts.secondary, true)}
        >
          {npcRows(primary, secondary)}
        </LifeFlipSurface>
      </div>
    </div>
  );
}

/** User beats — right-aligned bubble with user avatar on the
 *  right. */
function UserBubbleView({
  bubble,
  viewSettings,
  characterName,
  practiceLanguage,
  avatarUrl,
  avatarLoading,
  isCurrent,
  onAvatarTap,
  wordSave,
}: {
  bubble: Bubble;
  viewSettings: ViewSettings;
  characterName: string;
  practiceLanguage?: string;
  avatarUrl: string | null;
  avatarLoading?: boolean;
  isCurrent: boolean;
  onAvatarTap?: () => void;
  wordSave?: LifeWordSave;
}) {
  // LIFE-LANG-16: per-bubble flip (like the other bubbles).
  const flippable = !!bubble.nativeText;
  const flip = useLifeBubbleFlip(bubble.id, flippable, 'right');
  const { flipped } = flip;
  const { primary, secondary } = bubbleTexts(bubble, viewSettings, false, flipped);
  // MSG-BUBBLE-12.10 — the OTHER face, for measurement only.
  const twinTexts = bubbleTexts(bubble, viewSettings, false, !flipped);
  const userRows = (pr: string, sec: string | null, measuring = false) => (
    <>
      <BubbleVocabText
        bubble={bubble}
        text={pr}
        mine
        wordSave={wordSave}
        className="text-[15px] leading-snug"
        practiceLanguage={practiceLanguage}
      />
      <SecondRowReveal show={!!sec} instant={flip.measuring} measuring={measuring}>
        {sec ? (
          <div
            dir={dirOf(sec)}
            className="text-[13px] leading-snug pt-1 text-(--color-bubble-mine-fg)/70"
          >
            {sec}
          </div>
        ) : null}
      </SecondRowReveal>
    </>
  );
  const withheld = flippable && !secondary;
  return (
    <div
      className="pointer-events-auto max-w-md mx-auto w-full flex items-end gap-2 justify-end life-beat-enter"
      // LIFE-NODE-12 — the PLAYER's own line, right-aligned (LIFE-BUBBLE-3), so
      // it slides in from the RIGHT as it rises. This is the mine/theirs
      // distinction the chat bubble draws, mapped onto player/NPC.
      style={beatEnterStyle('user')}
      data-testid="LifeScreen-Bubble-user"
      data-current={isCurrent ? 'true' : undefined}
    >
      <div className="flex flex-col gap-1 min-w-0 items-end">
        {/* TTS-SURFACE-4: hear your own line read back. Always speaks
            practiceText regardless of the view settings (LIFE-LANG-3). */}
        <TTSButton
          text={bubble.practiceText}
          language={practiceLanguage}
          playbackKey={`life-user-${bubble.id}`}
          size={22}
          // Lazy: synthesize on tap, never pre-warm (see npc bubble).
          warmOnMount={false}
        />
        <LifeFlipSurface
          flip={flip}
          padding="px-4 py-3"
          data-life-flip-target={withheld ? '' : undefined}
          className={cn(
            // LIFE-BUBBLE-3: own bubbles use the app-wide mine colour (#9842cc,
            // now the shared `--color-bubble-mine`). When current, the ring
            // class owns the fill (solid bg only on previous-turn bubbles —
            // mirrors the npc bubble).
            'rounded-2xl rounded-br-md shadow-sm text-(--color-bubble-mine-fg)',
            flippable && 'touch-pan-y',
            isCurrent ? 'life-bubble-current-user' : 'bg-(--color-bubble-mine)',
          )}
          twin={userRows(twinTexts.primary, twinTexts.secondary, true)}
        >
          {userRows(primary, secondary)}
        </LifeFlipSurface>
      </div>
      <Avatar name={characterName} svgUrl={avatarUrl} loading={avatarLoading} onTap={onAvatarTap} />
    </div>
  );
}
