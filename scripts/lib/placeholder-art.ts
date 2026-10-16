/**
 * Temporary studio imagery rendered from SVG with sharp.
 *
 * `tenant:new` uses these so a fresh preview looks finished before the owner
 * sends real photos. Owner photos always win: they replace these files in
 * tenants/<slug>/images or are uploaded from the cabinet.
 */
import sharp from 'sharp';

type Rgb = [number, number, number];

const hexToRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgb = ([r, g, b]: Rgb, a = 1) => `rgba(${r},${g},${b},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;

const CAR_BODY =
  'M150,660 L160,612 C166,590 192,578 232,572 L470,548 C560,480 680,430 820,425 C960,420 1062,440 1152,500 ' +
  'L1272,548 C1362,556 1432,574 1456,606 L1462,660 L1312,668 A112,112 0 0 0 1088,668 L532,668 A112,112 0 0 0 308,668 Z';
const WINDOW_REAR = 'M582,546 C652,494 732,465 812,462 L812,546 Z';
const WINDOW_FRONT = 'M840,462 C928,462 1000,478 1062,512 L1104,546 L840,546 Z';

function carSvg(opts: {
  width: number;
  height: number;
  accent: string;
  paint: string;
  scale: number;
  dx: number;
  dy: number;
  streaks: number;
  label?: string;
}): string {
  const accent = hexToRgb(opts.accent);
  const paint = hexToRgb(opts.paint);
  const paintDark = mix(paint, [0, 0, 0], 0.72);
  const paintLight = mix(paint, [255, 255, 255], 0.35);
  const streaks = Array.from({length: opts.streaks}, (_, i) => {
    const y = 90 + i * 46;
    const x = (i * 337) % 900;
    return `<rect x="${x}" y="${y}" width="${520 - i * 30}" height="6" rx="3" fill="${rgb(accent, 0.18 - i * 0.02)}"/>`;
  }).join('');
  const wheel = (cx: number) => `
    <circle cx="${cx}" cy="668" r="96" fill="#07080a"/>
    <circle cx="${cx}" cy="668" r="62" fill="url(#rim)"/>
    ${Array.from({length: 10}, (_, i) => {
      const a = (i * Math.PI) / 5;
      return `<line x1="${cx}" y1="668" x2="${cx + Math.cos(a) * 58}" y2="${668 + Math.sin(a) * 58}" stroke="#1b1e24" stroke-width="7"/>`;
    }).join('')}
    <circle cx="${cx}" cy="668" r="16" fill="#2a2e36"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${opts.width}" height="${opts.height}" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">
  <defs>
    <radialGradient id="glow" cx="50%" cy="58%" r="60%">
      <stop offset="0" stop-color="${rgb(accent, 0.55)}"/>
      <stop offset="0.45" stop-color="${rgb(accent, 0.12)}"/>
      <stop offset="1" stop-color="#000"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#101216"/><stop offset="1" stop-color="#000"/>
    </linearGradient>
    <linearGradient id="paint" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${rgb(paintLight)}"/>
      <stop offset="0.38" stop-color="${rgb(paint)}"/>
      <stop offset="1" stop-color="${rgb(paintDark)}"/>
    </linearGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c2230"/><stop offset="1" stop-color="#05070a"/>
    </linearGradient>
    <radialGradient id="rim" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#c9ced8"/><stop offset="1" stop-color="#4a505c"/>
    </radialGradient>
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14"/></filter>
    <filter id="soft"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <rect width="1600" height="1000" fill="#000"/>
  <rect width="1600" height="1000" fill="url(#glow)"/>
  <rect y="690" width="1600" height="310" fill="url(#floor)"/>
  <g filter="url(#soft)">${streaks}</g>
  <g opacity="0.9">
    <rect x="260" y="40" width="1080" height="18" rx="9" fill="${rgb([255, 255, 255], 0.75)}" filter="url(#soft)"/>
    <rect x="260" y="40" width="1080" height="18" rx="9" fill="${rgb(accent, 0.35)}" filter="url(#blur)"/>
  </g>
  <g transform="translate(${opts.dx} ${opts.dy}) scale(${opts.scale})" transform-origin="800 600">
    <ellipse cx="806" cy="742" rx="700" ry="38" fill="#000" opacity="0.85" filter="url(#blur)"/>
    <path d="${CAR_BODY}" fill="url(#paint)"/>
    <path d="${CAR_BODY}" fill="none" stroke="${rgb(accent, 0.9)}" stroke-width="5" filter="url(#soft)"/>
    <path d="M232,600 C600,585 1100,585 1440,612" stroke="${rgb([255, 255, 255], 0.35)}" stroke-width="4" fill="none"/>
    <path d="${WINDOW_REAR}" fill="url(#glass)"/>
    <path d="${WINDOW_FRONT}" fill="url(#glass)"/>
    <path d="M600,520 C700,470 800,452 900,452" stroke="${rgb([255, 255, 255], 0.45)}" stroke-width="6" fill="none" filter="url(#soft)"/>
    <rect x="1400" y="590" width="58" height="16" rx="8" fill="${rgb([255, 255, 255], 0.95)}"/>
    <rect x="1380" y="586" width="90" height="26" rx="13" fill="${rgb(accent, 0.6)}" filter="url(#blur)"/>
    <rect x="152" y="598" width="40" height="14" rx="7" fill="#ff2a2a"/>
    ${wheel(420)}
    ${wheel(1200)}
    <path d="M532,668 L1088,668" stroke="#000" stroke-width="10"/>
  </g>
  ${opts.label ? `<text x="80" y="930" font-family="Arial, sans-serif" font-size="44" font-weight="700" fill="${rgb([255, 255, 255], 0.85)}">${opts.label}</text>` : ''}
</svg>`;
}

const PAINTS = ['#2b3442', '#e9edf2', '#7d1420', '#14161b', '#1d4fa8', '#3b4a3a', '#8a6a2a', '#5a5f69'];

export async function renderHero(file: string, accent: string): Promise<void> {
  const svg = carSvg({width: 1800, height: 1200, accent, paint: '#2b3442', scale: 1, dx: 0, dy: 40, streaks: 6});
  await sharp(Buffer.from(svg)).webp({quality: 82}).toFile(file);
}

export async function renderGallery(file: string, accent: string, index: number): Promise<void> {
  const svg = carSvg({
    width: 1200,
    height: 900,
    accent,
    paint: PAINTS[index % PAINTS.length]!,
    scale: 1.15 + (index % 3) * 0.25,
    dx: ((index % 2) * 2 - 1) * 120,
    dy: 30 + (index % 3) * 20,
    streaks: 3 + (index % 4),
  });
  await sharp(Buffer.from(svg)).webp({quality: 80}).toFile(file);
}

/** Square logo: the first letter of the studio name on the accent colour. */
export async function renderLogo(file: string, accent: string, name: string): Promise<void> {
  const letter = (name.trim()[0] ?? 'S').toUpperCase().replace(/[<&>]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${accent}"/><stop offset="1" stop-color="${rgb(mix(hexToRgb(accent), [0, 0, 0], 0.55))}"/>
    </linearGradient></defs>
    <rect width="1024" height="1024" fill="#000"/>
    <rect x="112" y="112" width="800" height="800" rx="200" fill="url(#g)"/>
    <text x="512" y="660" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-size="460" font-weight="800" fill="#fff">${letter}</text>
  </svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}
