/**
 * LIFE-BACKDROP-7 / LIFE-BACKDROP-8: hand-picked fallback library of
 * silhouette SVGs that ship in the bundle. Used for:
 *   - the "building world…" placeholder during cold-start gen
 *   - the failure path when Gemini SVG gen returns malformed output
 *   - Phase A.1 of the vertical slice (before backdrop gen is wired)
 *
 * Each backdrop has a stylised, mood-evoking silhouette in the same
 * palette as the app's brand colours, so they never look broken.
 * Designed to scale to any aspect ratio via
 * preserveAspectRatio="xMidYMid slice".
 *
 * Spec: docs/specs/life-sim.md §6.
 */

export type FallbackBackdropKey =
  | 'apartment_bedroom'
  | 'apartment_living'
  | 'cafe'
  | 'market'
  | 'office'
  | 'street'
  | 'park'
  | 'train_station';

const APARTMENT_BEDROOM = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fef3e8"/>
      <stop offset="1" stop-color="#fbd5b5"/>
    </linearGradient>
    <linearGradient id="wall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8dcc4"/>
      <stop offset="1" stop-color="#d4c39e"/>
    </linearGradient>
    <radialGradient id="sunbeam" cx="0.7" cy="0.4" r="0.5">
      <stop offset="0" stop-color="#fff4d6" stop-opacity="0.7"/>
      <stop offset="1" stop-color="#fff4d6" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="800" fill="url(#wall)"/>
  <rect x="0" y="0" width="1200" height="450" fill="url(#wall)"/>
  <rect x="0" y="450" width="1200" height="350" fill="#c4a878"/>
  <rect x="700" y="100" width="380" height="320" rx="6" fill="url(#sky)" stroke="#8a7556" stroke-width="6"/>
  <line x1="890" y1="100" x2="890" y2="420" stroke="#8a7556" stroke-width="4"/>
  <line x1="700" y1="260" x2="1080" y2="260" stroke="#8a7556" stroke-width="4"/>
  <circle cx="950" cy="220" r="55" fill="#fff2c9">
    <animate attributeName="cy" values="220;215;220" dur="6s" repeatCount="indefinite"/>
  </circle>
  <rect x="60" y="380" width="520" height="260" rx="18" fill="#c98d7b"/>
  <rect x="60" y="320" width="520" height="80" rx="18" fill="#e8a692"/>
  <rect x="100" y="240" width="160" height="120" rx="14" fill="#fff" stroke="#8a7556" stroke-width="3"/>
  <rect x="280" y="220" width="180" height="140" rx="14" fill="#fff" stroke="#8a7556" stroke-width="3"/>
  <ellipse cx="640" cy="780" rx="540" ry="14" fill="rgba(0,0,0,0.1)"/>
  <rect x="0" y="0" width="1200" height="800" fill="url(#sunbeam)"/>
</svg>`;

const APARTMENT_LIVING = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="wall2" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f0e4d2"/>
      <stop offset="1" stop-color="#d8c5a3"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="500" fill="url(#wall2)"/>
  <rect y="500" width="1200" height="300" fill="#9a7c5a"/>
  <rect x="100" y="180" width="280" height="220" rx="6" fill="#9ec3e8" stroke="#7a6448" stroke-width="6"/>
  <rect x="450" y="380" width="460" height="180" rx="20" fill="#8b6f5a"/>
  <rect x="930" y="280" width="160" height="280" rx="6" fill="#a08868" stroke="#7a6448" stroke-width="3"/>
  <ellipse cx="600" cy="780" rx="540" ry="14" fill="rgba(0,0,0,0.1)"/>
</svg>`;

const CAFE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="cafewall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e8d4a8"/>
      <stop offset="1" stop-color="#c8a878"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="550" fill="url(#cafewall)"/>
  <rect y="550" width="1200" height="250" fill="#8a6a4a"/>
  <rect x="400" y="200" width="400" height="280" rx="12" fill="#5a4a3a"/>
  <rect x="420" y="220" width="360" height="180" rx="6" fill="#d4b87a"/>
  <rect x="380" y="160" width="440" height="50" rx="6" fill="#a07050"/>
  <circle cx="300" cy="620" r="50" fill="#5a4a3a"/>
  <circle cx="900" cy="620" r="50" fill="#5a4a3a"/>
  <rect x="280" y="540" width="40" height="90" fill="#3a2a1a"/>
  <rect x="880" y="540" width="40" height="90" fill="#3a2a1a"/>
</svg>`;

const MARKET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="msky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#bde0fe"/>
      <stop offset="1" stop-color="#a2d2ff"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="550" fill="url(#msky)"/>
  <rect y="550" width="1200" height="250" fill="#c8b896"/>
  <polygon points="350,300 850,300 800,200 400,200" fill="#e85a4f"/>
  <rect x="380" y="300" width="440" height="280" rx="6" fill="#a87850"/>
  <ellipse cx="450" cy="380" rx="60" ry="20" fill="#f4a261"/>
  <ellipse cx="600" cy="380" rx="60" ry="20" fill="#e76f51"/>
  <ellipse cx="750" cy="380" rx="60" ry="20" fill="#7a9e6e"/>
  <circle cx="200" cy="200" r="60" fill="#7ab68d"/>
  <rect x="190" y="240" width="20" height="120" fill="#6a4a3a"/>
  <circle cx="1000" cy="180" r="40" fill="#fff" opacity="0.85">
    <animate attributeName="cx" values="1000;1050;1000" dur="20s" repeatCount="indefinite"/>
  </circle>
</svg>`;

const OFFICE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="owall" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4f4f0"/>
      <stop offset="1" stop-color="#d8d8d0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="600" fill="url(#owall)"/>
  <rect y="600" width="1200" height="200" fill="#5a5a5a"/>
  <rect x="100" y="200" width="200" height="280" rx="4" fill="#a8c8e8" stroke="#5a7090" stroke-width="3"/>
  <rect x="350" y="200" width="200" height="280" rx="4" fill="#a8c8e8" stroke="#5a7090" stroke-width="3"/>
  <rect x="600" y="200" width="200" height="280" rx="4" fill="#a8c8e8" stroke="#5a7090" stroke-width="3"/>
  <rect x="200" y="520" width="800" height="100" rx="8" fill="#7a5a3a"/>
  <rect x="500" y="430" width="200" height="100" rx="6" fill="#2a2a2a"/>
</svg>`;

const STREET = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="ssky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#a8d8f8"/>
      <stop offset="1" stop-color="#e0c8a0"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="500" fill="url(#ssky)"/>
  <rect y="500" width="1200" height="300" fill="#3a3a3a"/>
  <polygon points="0,500 100,300 200,500" fill="#c48868"/>
  <polygon points="200,500 350,250 500,500" fill="#a87858"/>
  <polygon points="500,500 700,200 900,500" fill="#9a6848"/>
  <polygon points="900,500 1050,300 1200,500" fill="#c89878"/>
  <rect x="0" y="650" width="1200" height="20" fill="#fff"/>
  <line x1="100" y1="660" x2="200" y2="660" stroke="#3a3a3a" stroke-width="6"/>
  <line x1="350" y1="660" x2="450" y2="660" stroke="#3a3a3a" stroke-width="6"/>
</svg>`;

const PARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <defs>
    <linearGradient id="psky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#c8e8c8"/>
      <stop offset="1" stop-color="#a8d8a8"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="500" fill="url(#psky)"/>
  <rect y="500" width="1200" height="300" fill="#7aa868"/>
  <circle cx="150" cy="350" r="80" fill="#5a8a5a"/>
  <rect x="140" y="430" width="20" height="100" fill="#5a3a2a"/>
  <circle cx="900" cy="320" r="100" fill="#5a8a5a"/>
  <rect x="890" y="420" width="20" height="120" fill="#5a3a2a"/>
  <circle cx="500" cy="380" r="60" fill="#5a8a5a"/>
  <rect x="492" y="440" width="16" height="80" fill="#5a3a2a"/>
  <ellipse cx="600" cy="780" rx="540" ry="14" fill="rgba(0,0,0,0.1)"/>
</svg>`;

const TRAIN_STATION = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 800" preserveAspectRatio="xMidYMid slice">
  <rect width="1200" height="800" fill="#3a3a4a"/>
  <rect y="500" width="1200" height="300" fill="#1a1a2a"/>
  <rect x="0" y="450" width="1200" height="20" fill="#5a5a6a"/>
  <rect x="200" y="350" width="800" height="150" rx="6" fill="#6a6a7a"/>
  <rect x="220" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="300" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="380" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="460" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="540" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="620" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="700" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="780" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="860" y="380" width="60" height="90" fill="#a8c8e8"/>
  <rect x="940" y="380" width="60" height="90" fill="#a8c8e8"/>
</svg>`;

const LIBRARY: Record<FallbackBackdropKey, string> = {
  apartment_bedroom: APARTMENT_BEDROOM,
  apartment_living: APARTMENT_LIVING,
  cafe: CAFE,
  market: MARKET,
  office: OFFICE,
  street: STREET,
  park: PARK,
  train_station: TRAIN_STATION,
};

export function getFallbackBackdrop(key: FallbackBackdropKey): string {
  return LIBRARY[key];
}
