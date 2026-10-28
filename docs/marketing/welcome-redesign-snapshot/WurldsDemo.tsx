import PhoneMockup from './PhoneMockup';
import { ACADEMY } from './wurldsScenes';

// The whole mockup — art, dialogue, chips, labels — comes from this one scene.
// Swap to CAFE (the parked original, also exported from ./wurldsScenes) to go
// back to the café version.
const SCENE = ACADEMY;

// ---------------------------------------------------------------------------
// WurldsDemo — a still of the app's /life ("Wurlds") surface, built from
// scratch in the same design vocabulary as ConversationDemo rather than
// screenshotted. It reuses PhoneMockup so the two read as the same product in
// two modes.
//
// STATIC ON PURPOSE. This used to play the turn out as a scripted animation.
// One frame carries the whole mechanism — both bubbles present, a word tapped
// open — so the playback engine was removed as unnecessary complexity. It also
// means this component is rendered WITHOUT a client:* directive in
// index.astro: Astro prerenders it to HTML and the section ships no JS at all.
// Keep it that way — nothing in here may depend on hooks or the browser.
//
// Mirrors the real screen's composition (app repo, src/screens/LifeScreen/):
//   SceneStage      → full-bleed SVG background + location ribbon
//   DialogueArea    → sliding two-bubble window, practice text + native gloss
//   ActionBar       → 3 choice chips + the ✏️ "write your own" chip
// ---------------------------------------------------------------------------

const GRADIENT = 'linear-gradient(135deg, #7340f5 0%, #db53d7 100%)';

// Your own bubble uses the app's shared chat-bubble token, NOT the gradient —
// ~/wurld/src/screens/LifeScreen/DialogueArea.tsx renders it with
// `bg-(--color-bubble-mine)`, the same token the chat bubbles use. The
// gradient stays for chips and toggles, which is what the app does too.
const BUBBLE_MINE = 'rgb(143 58 212)';

// The phone screen is always light — it's a demo of the app, not of the page.
const INK = '#111111';
const MUTED = '#6b7280';
const SUBTLE = '#9ca3af';
const BORDER = '#e6e6ea';

function NpcAvatar({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <clipPath id="wd-avatar-clip-npc">
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="20" fill="#F6E7D6" />
      {/* Clipped to the circle — the shoulders are wider than the frame at the
          bottom and spill out of the disc without this. */}
      <g clipPath="url(#wd-avatar-clip-npc)">
        {/* Long hair, drawn behind the head so it frames the face */}
        <path d="M8.5 20c0-7 5-12.5 11.5-12.5S31.5 13 31.5 20v13c0 2-1.5 3-3 3l-2.5-9V19H14v8l-2.5 9c-1.5 0-3-1-3-3z" fill="#3E2C20" />
        <path d="M20 22.5c-9.5 0-16 6.5-16 14.5v3h32v-3c0-8-6.5-14.5-16-14.5z" fill="#6D3FD6" />
        {/* Robe collar */}
        <path d="M20 22.5c-2.6 0-5 .5-7.1 1.4L20 31l7.1-7.1a17 17 0 0 0-7.1-1.4z" fill="#8A5CF0" />
        {/* Neck */}
        <path d="M16.6 17.5h6.8v6.2a3.4 3.4 0 0 1-6.8 0z" fill="#D9A87C" />
        <circle cx="20" cy="15" r="7.6" fill="#EBC49B" />
        {/* Fringe */}
        <path d="M12.6 14.2c.4-4.6 3.5-7.2 7.4-7.2s7 2.6 7.4 7.2c-1.9-2-4-3.4-6.2-3.1-2.6.4-3.4 2.2-5.3 3-1 .4-2.2.4-3.3.1z" fill="#4A3527" />
        <path d="M17.9 12.6a2.6 2.6 0 0 1 4.2 0" stroke="#2E2018" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.55" />
        <circle cx="17.2" cy="15.4" r="1.15" fill="#2E2018" />
        <circle cx="22.8" cy="15.4" r="1.15" fill="#2E2018" />
        <circle cx="14.4" cy="17.4" r="1.5" fill="#E8927F" opacity="0.4" />
        <circle cx="25.6" cy="17.4" r="1.5" fill="#E8927F" opacity="0.4" />
        <path d="M18 18.6a3.2 3.2 0 0 0 4 0" stroke="#2E2018" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

/** Your character. Deliberately distinct from the NPC — different skin tone,
 *  hair and robe colour — so the two speakers read apart at 26px. */
function UserAvatar({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      <defs>
        <clipPath id="wd-avatar-clip-user">
          <circle cx="20" cy="20" r="20" />
        </clipPath>
      </defs>
      <circle cx="20" cy="20" r="20" fill="#F3E6FB" />
      <g clipPath="url(#wd-avatar-clip-user)">
        <path d="M20 22.5c-9.5 0-16 6.5-16 14.5v3h32v-3c0-8-6.5-14.5-16-14.5z" fill="#C93FC4" />
        {/* Robe collar */}
        <path d="M20 22.5c-2.6 0-5 .5-7.1 1.4L20 31l7.1-7.1a17 17 0 0 0-7.1-1.4z" fill="#E667E1" />
        {/* Neck */}
        <path d="M16.6 17.5h6.8v6.2a3.4 3.4 0 0 1-6.8 0z" fill="#A96E4A" />
        <circle cx="20" cy="15" r="7.6" fill="#C98B62" />
        {/* Short, cropped hair — a different silhouette to Elena's so the two
            speakers stay distinguishable at 26px */}
        <path d="M12.4 16.2c-.5-5.4 3-9.2 7.6-9.2s8.1 3.8 7.6 9.2c-.5-2.6-1.1-4.2-2.1-4.9-1.8 1.2-8.6 1.5-10.6-.3-.9.8-2 2.5-2.5 5.2z" fill="#241A2E" />
        <path d="M17.9 12.8a2.6 2.6 0 0 1 4.2 0" stroke="#1A1220" strokeWidth="0.9" strokeLinecap="round" fill="none" opacity="0.5" />
        <circle cx="17.2" cy="15.4" r="1.15" fill="#241A2E" />
        <circle cx="22.8" cy="15.4" r="1.15" fill="#241A2E" />
        <circle cx="14.4" cy="17.4" r="1.5" fill="#D8705E" opacity="0.35" />
        <circle cx="25.6" cy="17.4" r="1.5" fill="#D8705E" opacity="0.35" />
        <path d="M18 18.6a3.2 3.2 0 0 0 4 0" stroke="#241A2E" strokeWidth="1.1" strokeLinecap="round" fill="none" />
      </g>
    </svg>
  );
}

export default function WurldsDemo() {
  const picked = SCENE.chipsA[SCENE.pickedIndex];
  const [beforeVocab, afterVocab] = SCENE.beatTwo.practice.split(SCENE.vocab.word);

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <div
        style={{
          width: 'min(268px, 74%)',
          margin: '0 auto',
          filter: 'drop-shadow(0 8px 24px rgba(0,0,0,0.15))',
          borderRadius: 47,
        }}
      >
        {/* Frame colour comes from the stylesheet, not from a theme-detecting
            hook — that's what keeps this component zero-JS. */}
        <PhoneMockup frameColor="var(--phone-frame, #1e1e1e)">
          {/* textAlign is pinned here: the surrounding marketing section is
              centre-aligned and would otherwise centre the app UI. */}
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#fff', textAlign: 'left' }}>
            {/* Header */}
            <div
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '6px 12px 8px', flexShrink: 0, borderBottom: `1px solid ${BORDER}`,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={INK} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
              <div style={{ minWidth: 0, flex: 1 }}>
                {/* nowrap+ellipsis: a two-line title pushes the chapter row
                    down and makes the header lurch. Truncate instead. */}
                <div style={{ fontSize: 11, fontWeight: 700, color: INK, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{SCENE.worldTitle}</div>
                <div style={{ fontSize: 9, color: MUTED, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{SCENE.chapter}</div>
              </div>
              {/* 3-way language toggle, as on the real screen */}
              <div style={{ display: 'flex', border: `1px solid ${BORDER}`, borderRadius: 999, overflow: 'hidden' }}>
                {['ES', 'Both', 'EN'].map((l) => (
                  <span
                    key={l}
                    style={{
                      fontSize: 8, fontWeight: 700, padding: '2px 5px',
                      background: l === 'Both' ? GRADIENT : 'transparent',
                      color: l === 'Both' ? '#fff' : SUBTLE,
                    }}
                  >
                    {l}
                  </span>
                ))}
              </div>
            </div>

            {/* Scene + dialogue */}
            <div style={{ position: 'relative', flex: 1, minHeight: 0, overflow: 'hidden' }}>
              <div style={{ position: 'absolute', inset: 0 }}>
                <SCENE.Backdrop />
              </div>

              {/* Location ribbon */}
              <div
                style={{
                  position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
                  padding: '2px 9px', borderRadius: 999,
                  background: 'rgba(255,255,255,0.82)', backdropFilter: 'blur(4px)',
                  border: '1px solid rgba(255,255,255,0.6)',
                  fontSize: 9, fontWeight: 600, color: INK, whiteSpace: 'nowrap',
                }}
              >
                {SCENE.location}
              </div>

              {/* Dialogue — the sliding two-bubble window. Both bubbles live in
                  ONE bottom-anchored column so yours and theirs sit together at
                  the foot of the scene, in the order they were said. */}
              <div
                style={{
                  position: 'absolute', left: 8, right: 8, bottom: 8,
                  display: 'flex', flexDirection: 'column', gap: 6,
                }}
              >
                {/* Your pick — both languages, and your own avatar mirroring
                    theirs on the opposite side. */}
                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      maxWidth: '80%', minWidth: 0,
                      padding: '5px 9px', borderRadius: 12, borderBottomRightRadius: 4,
                      background: BUBBLE_MINE, color: '#fff',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                    }}
                  >
                    <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.3 }}>{picked.practice}</div>
                    <div style={{ fontSize: 9, lineHeight: 1.3, color: 'rgba(255,255,255,0.9)' }}>{picked.native}</div>
                  </div>
                  <UserAvatar />
                </div>

                {/* Word lookup. A FLOW item in this column rather than an
                    overlay: as an absolutely-positioned popover above the
                    bubble it sat on top of your own bubble, which is
                    directly above. In-flow it stacks cleanly instead. */}
                <span
                  style={{
                    alignSelf: 'flex-start', marginLeft: 33, maxWidth: '100%',
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '4px 8px', borderRadius: 9,
                    background: INK, color: '#fff', fontSize: 9.5, fontWeight: 600,
                    whiteSpace: 'nowrap',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.25)',
                  }}
                >
                  {SCENE.vocab.word}
                  <span style={{ opacity: 0.45 }}>→</span>
                  {SCENE.vocab.gloss}
                  <span style={{ opacity: 0.45 }}>·</span>
                  <span style={{ color: '#d9c2ff', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                    <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Save
                  </span>
                </span>

                {/* Their bubble */}
                <div style={{ display: 'flex', gap: 7, alignItems: 'flex-end' }}>
                  <NpcAvatar />
                  <div
                    style={{
                      flex: 1, minWidth: 0,
                      background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(6px)',
                      borderRadius: 14, borderBottomLeftRadius: 4,
                      padding: '7px 9px',
                      boxShadow: '0 4px 14px rgba(0,0,0,0.18)',
                    }}
                  >
                    <div style={{ fontSize: 8.5, fontWeight: 700, color: '#7340f5', marginBottom: 2, letterSpacing: '0.04em' }}>
                      {SCENE.npcName}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: INK, lineHeight: 1.35 }}>
                      {beforeVocab}
                      <span
                        style={{
                          borderBottom: '1.5px dotted #7340f5',
                          color: '#7340f5',
                          background: 'rgba(115,64,245,0.10)',
                          borderRadius: 3,
                        }}
                      >
                        {SCENE.vocab.word}
                      </span>
                      {afterVocab}
                    </div>
                    <div style={{ fontSize: 9.5, color: MUTED, lineHeight: 1.35, marginTop: 3 }}>
                      {SCENE.beatTwo.native}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Action bar */}
            <div style={{ padding: '8px 8px 10px', display: 'grid', gap: 5, flexShrink: 0 }}>
              {SCENE.chipsB.map((c) => (
                <div
                  key={c.practice}
                  style={{
                    border: `1.5px solid ${BORDER}`,
                    background: '#fff',
                    color: INK,
                    borderRadius: 11,
                    padding: '5px 9px',
                  }}
                >
                  <div style={{ fontSize: 10.5, fontWeight: 600, lineHeight: 1.25 }}>{c.practice}</div>
                  <div style={{ fontSize: 9, color: SUBTLE, lineHeight: 1.25 }}>{c.native}</div>
                </div>
              ))}
              {/* LIFE-NODE-4: the 4th option is always "write your own" */}
              <div
                style={{
                  border: `1.5px dashed ${BORDER}`,
                  borderRadius: 11,
                  padding: '5px 9px',
                  display: 'flex', alignItems: 'center', gap: 6,
                  fontSize: 10, fontWeight: 600, color: MUTED,
                }}
              >
                <span aria-hidden="true">✏️</span> Write your own
              </div>
            </div>
          </div>
        </PhoneMockup>
      </div>
    </div>
  );
}
