import type { ReactElement } from 'react';

// ---------------------------------------------------------------------------
// Scene definitions for WurldsDemo.
//
// Each scene bundles its backdrop art with its script so the whole demo can be
// swapped by changing ONE import in WurldsDemo.tsx. Two are defined:
//
//   ACADEMY  — currently live. A magic academy: visually exciting, and its
//              purples sit inside the brand palette.
//   CAFE     — the original, parked. Kept live (not deleted) so we can switch
//              back without digging through git history.
//
// THE RULE FOR ANY NEW SCENE: the setting can be as fantastical as you like,
// but the DIALOGUE must be everyday, high-frequency language the learner would
// actually use — being late, borrowing something, asking if it's started. The
// site's own feature card promises "vocabulary you actually need"; a scene
// full of invented arcana would contradict it. Exciting world, ordinary words.
// ---------------------------------------------------------------------------

export type Chip = { practice: string; native: string };

export type WurldScene = {
  id: string;
  /** Header line — the world's name. */
  worldTitle: string;
  /** Header subline. */
  chapter: string;
  /** Location ribbon over the scene. App chrome is system-language. */
  location: string;
  npcName: string;
  Backdrop: () => ReactElement;
  /** Opening line, before the player picks. */
  beatOne: { practice: string; native: string };
  /** Reply, after the pick. Must contain `vocab.word` verbatim. */
  beatTwo: { practice: string; native: string };
  /** The word the demo taps to show save-as-flashcard. */
  vocab: { word: string; gloss: string };
  chipsA: Chip[];
  chipsB: Chip[];
  /** Which of chipsA the demo picks. */
  pickedIndex: number;
};

// -- Magic academy ----------------------------------------------------------

function AcademyBackdrop() {
  return (
    <svg
      viewBox="0 0 240 300"
      preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wd-a-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3B2C63" />
          <stop offset="55%" stopColor="#2A1F49" />
          <stop offset="100%" stopColor="#1B1533" />
        </linearGradient>
        <linearGradient id="wd-a-dawn" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F7C9E4" />
          <stop offset="45%" stopColor="#FFD9A0" />
          <stop offset="100%" stopColor="#FFB07C" />
        </linearGradient>
        <linearGradient id="wd-a-shaft" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#FFE3B0" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#FFE3B0" stopOpacity="0" />
        </linearGradient>
        <radialGradient id="wd-a-flame" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFE9B8" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#FFB84D" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="wd-a-orb" cx="0.5" cy="0.45" r="0.55">
          <stop offset="0%" stopColor="#E9D6FF" />
          <stop offset="55%" stopColor="#A78BFF" />
          <stop offset="100%" stopColor="#7340f5" />
        </radialGradient>
        <radialGradient id="wd-a-orbglow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#db53d7" stopOpacity="0.5" />
          <stop offset="100%" stopColor="#db53d7" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wd-a-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#120E22" stopOpacity="0" />
          <stop offset="55%" stopColor="#120E22" stopOpacity="0.55" />
          <stop offset="100%" stopColor="#120E22" stopOpacity="0.88" />
        </linearGradient>
      </defs>

      {/* Hall */}
      <rect width="240" height="300" fill="url(#wd-a-wall)" />

      {/* Everything with detail is lifted into the TOP of the frame: the
          dialogue bubbles occupy the bottom ~40% of the screen, so anything
          busy down there just fights them. Candles shift less than the rest
          so they don't clip off the top edge. */}
      <g transform="translate(0,-10)">
        <ellipse cx="78" cy="46" rx="13" ry="13" fill="url(#wd-a-flame)" />
        <rect x="76" y="46" width="4" height="12" rx="1.5" fill="#F0E4CE" />
        <ellipse cx="118" cy="30" rx="11" ry="11" fill="url(#wd-a-flame)" />
        <rect x="116.5" y="30" width="3.5" height="10" rx="1.5" fill="#F0E4CE" />
        <ellipse cx="204" cy="52" rx="12" ry="12" fill="url(#wd-a-flame)" />
        <rect x="202.5" y="52" width="3.5" height="11" rx="1.5" fill="#F0E4CE" />
      </g>

      <g transform="translate(0,-26)">
        {/* Vaulted rib arches */}
        <g stroke="#4B3A7A" strokeWidth="2.5" fill="none" opacity="0.75">
          <path d="M-6 76 Q 40 6 86 76" />
          <path d="M86 76 Q 132 -2 178 76" />
          <path d="M178 76 Q 224 6 270 76" />
        </g>

        {/* Tall arched windows with dawn light */}
        <g>
          <path d="M26 132V70a20 20 0 0 1 40 0v62z" fill="#4B3A7A" />
          <path d="M30 128V71a16 16 0 0 1 32 0v57z" fill="url(#wd-a-dawn)" />
          <path d="M34 128v-22h7v22zM45 128v-30h6v30zM55 128v-18h6v18z" fill="#C97FA8" opacity="0.55" />
          <rect x="45" y="55" width="2.5" height="73" fill="#4B3A7A" />
          <rect x="30" y="92" width="32" height="2.5" fill="#4B3A7A" />

          <path d="M150 132V70a20 20 0 0 1 40 0v62z" fill="#4B3A7A" />
          <path d="M154 128V71a16 16 0 0 1 32 0v57z" fill="url(#wd-a-dawn)" />
          <path d="M158 128v-26h7v26zM169 128v-34h6v34zM179 128v-20h6v20z" fill="#C97FA8" opacity="0.55" />
          <rect x="169" y="55" width="2.5" height="73" fill="#4B3A7A" />
          <rect x="154" y="92" width="32" height="2.5" fill="#4B3A7A" />
        </g>

        {/* Light shafts landing on the floor */}
        <path d="M30 128 L62 128 L84 206 L20 206 Z" fill="url(#wd-a-shaft)" />
        <path d="M154 128 L186 128 L208 206 L144 206 Z" fill="url(#wd-a-shaft)" />

        {/* Bookshelf between the windows */}
        <rect x="92" y="88" width="52" height="76" rx="3" fill="#2F2450" />
        <g fill="#4B3A7A">
          <rect x="95" y="104" width="46" height="3" />
          <rect x="95" y="126" width="46" height="3" />
          <rect x="95" y="148" width="46" height="3" />
        </g>
        <g>
          <rect x="98" y="92" width="5" height="12" rx="1" fill="#A78BFF" />
          <rect x="105" y="94" width="4" height="10" rx="1" fill="#db53d7" opacity="0.8" />
          <rect x="111" y="91" width="6" height="13" rx="1" fill="#7DD3C0" opacity="0.75" />
          <rect x="119" y="95" width="4" height="9" rx="1" fill="#F5A6C8" opacity="0.8" />
          <rect x="126" y="92" width="5" height="12" rx="1" fill="#A78BFF" opacity="0.7" />
          <rect x="98" y="115" width="4" height="11" rx="1" fill="#F5A6C8" opacity="0.7" />
          <rect x="104" y="113" width="6" height="13" rx="1" fill="#A78BFF" opacity="0.85" />
          <rect x="112" y="116" width="4" height="10" rx="1" fill="#7DD3C0" opacity="0.6" />
          <rect x="119" y="114" width="5" height="12" rx="1" fill="#db53d7" opacity="0.65" />
          <rect x="99" y="137" width="5" height="11" rx="1" fill="#7DD3C0" opacity="0.6" />
          <rect x="106" y="135" width="4" height="13" rx="1" fill="#A78BFF" opacity="0.7" />
          <rect x="113" y="138" width="6" height="10" rx="1" fill="#F5A6C8" opacity="0.6" />
        </g>

        {/* Armillary sphere / orrery on a plinth */}
        <g>
          <ellipse cx="206" cy="140" rx="32" ry="32" fill="url(#wd-a-orbglow)" />
          <rect x="198" y="150" width="16" height="22" rx="2" fill="#3B2C63" />
          <rect x="192" y="170" width="28" height="6" rx="2" fill="#4B3A7A" />
          <circle cx="206" cy="138" r="12" fill="url(#wd-a-orb)" />
          <ellipse cx="206" cy="138" rx="19" ry="6.5" fill="none" stroke="#E9D6FF" strokeWidth="1.4" opacity="0.85" />
          <ellipse cx="206" cy="138" rx="6.5" ry="19" fill="none" stroke="#E9D6FF" strokeWidth="1.4" opacity="0.6" />
          <circle cx="225" cy="138" r="2.2" fill="#FFE9B8" />
          <circle cx="206" cy="119" r="1.8" fill="#F5A6C8" />
        </g>

        {/* Star motes */}
        <g fill="#E9D6FF">
          <circle cx="70" cy="96" r="1.3" opacity="0.8" />
          <circle cx="88" cy="66" r="1" opacity="0.6" />
          <circle cx="146" cy="58" r="1.2" opacity="0.7" />
          <circle cx="166" cy="104" r="1" opacity="0.55" />
          <circle cx="40" cy="150" r="1.1" opacity="0.5" />
          <circle cx="132" cy="160" r="1.3" opacity="0.6" />
          <circle cx="182" cy="44" r="1" opacity="0.5" />
        </g>
      </g>

      {/* Floor — raised, and deliberately plain. This is the band the bubbles
          sit on, so it carries no detail beyond faint flagstone lines. */}
      <rect x="0" y="180" width="240" height="120" fill="#241B41" />
      <rect x="0" y="180" width="240" height="4" fill="#4B3A7A" opacity="0.7" />
      <g stroke="#3B2C63" strokeWidth="1.2" opacity="0.45">
        <path d="M0 210h240M0 246h240" />
        <path d="M52 180v120M120 180v120M188 180v120" />
      </g>

      {/* Bottom vignette — starts higher and lands darker than before so the
          bubble zone is close to flat colour. */}
      <rect x="0" y="120" width="240" height="180" fill="url(#wd-a-shade)" />
    </svg>
  );
}

export const ACADEMY: WurldScene = {
  id: 'academy',
  // Keep world titles short — the header gives them ~120px before they
  // ellipsise. The scene art and the location ribbon carry the setting.
  worldTitle: 'Aldermoor',
  chapter: 'Chapter 2 · First term',
  location: 'The Orrery Hall · morning',
  npcName: 'ELENA',
  Backdrop: AcademyBackdrop,
  // Deliberately ordinary Spanish: running late, apologising, asking whether
  // something has started, borrowing notes. All of it transfers straight to
  // real life — the academy is only the backdrop.
  beatOne: {
    practice: 'Llegas tarde otra vez. ¿Te guardo un sitio?',
    native: "You're late again. Shall I save you a seat?",
  },
  beatTwo: {
    practice: 'No te preocupes, todavía no ha empezado. Siéntate aquí.',
    native: "Don't worry, it hasn't started yet. Sit here.",
  },
  vocab: { word: 'todavía', gloss: 'still / yet' },
  chipsA: [
    { practice: 'Perdona, me he perdido.', native: 'Sorry, I got lost.' },
    { practice: 'Sí, por favor.', native: 'Yes, please.' },
    { practice: '¿Ya ha empezado?', native: 'Has it started yet?' },
  ],
  chipsB: [
    { practice: '¿Me prestas tus apuntes?', native: 'Can I borrow your notes?' },
    { practice: 'Gracias, te debo una.', native: 'Thanks, I owe you one.' },
    { practice: '¿Nos vemos después?', native: 'Shall we meet afterwards?' },
  ],
  pickedIndex: 0,
};

// -- Café (parked alternative) ----------------------------------------------

function CafeBackdrop() {
  return (
    <svg
      viewBox="0 0 240 300"
      preserveAspectRatio="xMidYMid slice"
      style={{ width: '100%', height: '100%', display: 'block' }}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="wd-c-wall" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F6E9DB" />
          <stop offset="100%" stopColor="#E3CDB8" />
        </linearGradient>
        <linearGradient id="wd-c-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#BFE3F5" />
          <stop offset="100%" stopColor="#F3D9C8" />
        </linearGradient>
        <linearGradient id="wd-c-counter" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8A5A3B" />
          <stop offset="100%" stopColor="#6B432B" />
        </linearGradient>
        <radialGradient id="wd-c-glow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="#FFE9B8" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#FFE9B8" stopOpacity="0" />
        </radialGradient>
        <linearGradient id="wd-c-shade" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2A1B12" stopOpacity="0" />
          <stop offset="100%" stopColor="#2A1B12" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      <rect width="240" height="300" fill="url(#wd-c-wall)" />

      <rect x="18" y="34" width="94" height="86" rx="5" fill="#C9A98C" />
      <rect x="22" y="38" width="86" height="78" rx="3" fill="url(#wd-c-sky)" />
      <circle cx="86" cy="58" r="9" fill="#FFF3C4" opacity="0.9" />
      <path d="M22 96h86v20H22z" fill="#C6A187" opacity="0.55" />
      <path d="M28 96V74h12v22zM46 96V66h14v30zM66 96V78h10v18zM82 96V70h13v26z" fill="#B08D74" opacity="0.7" />
      <rect x="63" y="38" width="4" height="78" fill="#C9A98C" />
      <rect x="22" y="74" width="86" height="4" fill="#C9A98C" />

      <g stroke="#4A3527" strokeWidth="1.5">
        <line x1="150" y1="0" x2="150" y2="30" />
        <line x1="196" y1="0" x2="196" y2="44" />
      </g>
      <path d="M138 30h24l-6 13h-12z" fill="#3E2C20" />
      <path d="M184 44h24l-6 13h-12z" fill="#3E2C20" />
      <circle cx="150" cy="46" r="3" fill="#FFE9B8" />
      <circle cx="196" cy="60" r="3" fill="#FFE9B8" />
      <ellipse cx="150" cy="62" rx="30" ry="22" fill="url(#wd-c-glow)" />
      <ellipse cx="196" cy="76" rx="30" ry="22" fill="url(#wd-c-glow)" />

      <rect x="128" y="86" width="94" height="4" rx="2" fill="#7A5238" />
      <rect x="136" y="70" width="12" height="16" rx="2" fill="#9C6B4A" opacity="0.8" />
      <rect x="154" y="66" width="14" height="20" rx="2" fill="#87553A" opacity="0.85" />
      <rect x="174" y="72" width="11" height="14" rx="2" fill="#A87550" opacity="0.85" />
      <rect x="192" y="68" width="13" height="18" rx="2" fill="#946141" opacity="0.8" />

      <rect x="120" y="120" width="120" height="90" fill="url(#wd-c-counter)" />
      <rect x="120" y="118" width="120" height="8" rx="3" fill="#A97A55" />

      <rect x="150" y="92" width="44" height="28" rx="4" fill="#4C5560" />
      <rect x="154" y="96" width="36" height="10" rx="2" fill="#6E7885" />
      <circle cx="160" cy="114" r="2.5" fill="#C8CED6" />
      <circle cx="184" cy="114" r="2.5" fill="#C8CED6" />

      <path d="M128 108h14v8a7 7 0 0 1-14 0z" fill="#FFFFFF" />
      <path d="M142 110h4a3 3 0 0 1 0 6h-4z" fill="none" stroke="#FFFFFF" strokeWidth="2" />
      <path d="M132 100c2-3-2-5 0-8M137 100c2-3-2-5 0-8" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />

      <rect x="6" y="150" width="86" height="7" rx="3" fill="#8A5A3B" />
      <rect x="44" y="157" width="8" height="46" fill="#6B432B" />
      <path d="M22 150c-8-6-10-16-6-24 6 4 9 13 6 24z" fill="#4E8F63" />
      <path d="M30 150c8-6 10-18 5-26-6 5-9 15-5 26z" fill="#5FA576" />
      <path d="M20 150h14l-2 12H22z" fill="#B4785A" />

      <rect x="0" y="203" width="240" height="97" fill="#B98F6E" />
      <rect x="0" y="203" width="240" height="6" fill="#A87D5D" />

      <rect x="0" y="150" width="240" height="150" fill="url(#wd-c-shade)" />
    </svg>
  );
}

export const CAFE: WurldScene = {
  id: 'cafe',
  worldTitle: 'Barcelona, 2019',
  chapter: 'Chapter 2 · The regular',
  location: 'Café Aurora · morning',
  npcName: 'MARTA',
  Backdrop: CafeBackdrop,
  beatOne: {
    practice: '¿Lo de siempre, o te apetece probar algo nuevo?',
    native: 'The usual, or do you fancy trying something new?',
  },
  beatTwo: {
    practice: 'Entonces… te toca el café del día. Es muy fuerte.',
    native: "Then… you get the coffee of the day. It's very strong.",
  },
  vocab: { word: 'fuerte', gloss: 'strong' },
  chipsA: [
    { practice: 'Lo de siempre, gracias.', native: 'The usual, thanks.' },
    { practice: 'Sorpréndeme.', native: 'Surprise me.' },
    { practice: '¿Qué me recomiendas?', native: 'What do you recommend?' },
  ],
  chipsB: [
    { practice: '¿Es muy fuerte?', native: 'Is it very strong?' },
    { practice: 'Perfecto, lo pruebo.', native: "Perfect, I'll try it." },
    { practice: '¿Cuánto es?', native: 'How much is it?' },
  ],
  pickedIndex: 1,
};
