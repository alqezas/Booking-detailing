/**
 * Temporary imagery for beauty studios (salon interior, works, master
 * portraits), rendered from SVG with sharp. Clearly placeholders: owner photos
 * replace them in tenants/<slug>/images or from the cabinet.
 */
import sharp from 'sharp';

type Rgb = [number, number, number];
const hexToRgb = (hex: string): Rgb => {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const css = ([r, g, b]: Rgb, a = 1) => `rgba(${r},${g},${b},${a})`;
const mix = (a: Rgb, b: Rgb, t: number): Rgb => [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * t)) as Rgb;
const CREAM: Rgb = [250, 248, 246];
const WARM: Rgb = [232, 220, 208];
const INK: Rgb = [20, 19, 24];

export type BeautyTheme = 'nails' | 'massage' | 'hair';

/**
 * Manicure cover: a flat lay on a warm cream table — a fan of almond nail-tip
 * swatches in the studio palette, gel polish bottles and a nail file. The
 * lower-left corner stays calm: the round logo sits there on the page.
 */
export async function renderNailsHero(file: string, accent: string): Promise<void> {
  const a = hexToRgb(accent);
  const palette: Rgb[] = [
    mix(a, INK, 0.35), a, [200, 40, 60], [214, 92, 110], mix(a, CREAM, 0.45),
    [226, 160, 160], [236, 196, 186], [222, 190, 168], [242, 222, 210],
  ];
  const shadow = (id: string, dy: number, blur: number, op: number) =>
    `<filter id="${id}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="${dy}" stdDeviation="${blur}" flood-color="#5a3a2a" flood-opacity="${op}"/></filter>`;
  // Nail tips fanned around a pivot, like a colour swatch ring.
  const cx = 780, cy = 990;
  const tips = palette
    .map((c, i) => {
      const angle = -48 + i * 12;
      const tip = `M-46,0 C-46,-150 -30,-270 0,-300 C30,-270 46,-150 46,0 Z`;
      return `<g transform="translate(${cx} ${cy}) rotate(${angle}) translate(0 -330)" filter="url(#soft)">
        <path d="${tip}" fill="${css(c)}"/>
        <path d="M-26,-40 C-26,-150 -16,-240 0,-268" stroke="#fff" stroke-opacity="0.45" stroke-width="10" fill="none" stroke-linecap="round"/>
        <rect x="-8" y="0" width="16" height="70" rx="8" fill="#e9dfd6"/>
      </g>`;
    })
    .join('');
  // Gel polish bottles: square glass, tall black caps.
  const bottle = (x: number, c: Rgb, h: number) => `<g transform="translate(${x} ${820 - h})" filter="url(#lift)">
      <rect x="0" y="${h * 0.42}" width="150" height="${h * 0.58}" rx="26" fill="${css(c)}"/>
      <rect x="0" y="${h * 0.42}" width="150" height="${h * 0.58}" rx="26" fill="url(#glass)"/>
      <rect x="34" y="0" width="82" height="${h * 0.46}" rx="14" fill="#1d1a1f"/>
      <rect x="44" y="12" width="14" height="${h * 0.38}" rx="7" fill="#fff" fill-opacity="0.18"/>
      <rect x="22" y="${h * 0.62}" width="106" height="44" rx="10" fill="#fff" fill-opacity="0.82"/>
      <rect x="40" y="${h * 0.62 + 16}" width="70" height="12" rx="6" fill="${css(mix(c, INK, 0.3))}" fill-opacity="0.7"/>
    </g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1000" viewBox="0 0 2000 1000">
  <defs>
    <linearGradient id="table" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f7f0e8"/><stop offset="1" stop-color="#eadccf"/></linearGradient>
    <radialGradient id="light" cx="0.62" cy="0.25" r="0.75"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="glass" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0.35"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.05"/><stop offset="1" stop-color="#000" stop-opacity="0.12"/></linearGradient>
    ${shadow('soft', 10, 12, 0.18)}${shadow('lift', 18, 18, 0.22)}
  </defs>
  <rect width="2000" height="1000" fill="url(#table)"/>
  <circle cx="1720" cy="160" r="260" fill="${css(mix(a, CREAM, 0.88))}"/>
  <circle cx="300" cy="120" r="150" fill="${css(mix(a, CREAM, 0.92))}"/>
  ${tips}
  <g transform="translate(1275 0)">${[
    bottle(0, palette[0]!, 300),
    bottle(170, palette[2]!, 340),
    bottle(340, palette[4]!, 300),
    bottle(510, palette[7]!, 320),
  ].join('')}</g>
  <g transform="translate(1250 905) rotate(-8)" filter="url(#soft)">
    <rect x="0" y="0" width="560" height="54" rx="27" fill="#d9d4d0"/>
    <rect x="0" y="0" width="280" height="54" rx="27" fill="#c9c2bd"/>
    <rect x="270" y="0" width="20" height="54" fill="#efe9e4"/>
  </g>
  ${[[1050, 260, 10], [1120, 320, 6], [640, 230, 8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${css(a)}" fill-opacity="0.35"/>`).join('')}
  <rect width="2000" height="1000" fill="url(#light)"/>
</svg>`;
  await sharp(Buffer.from(svg)).webp({quality: 90}).toFile(file);
}

/** Salon interior: arched mirrors, a styling chair or a massage table, plants, warm light. */
export async function renderBeautyHero(file: string, accent: string, theme: BeautyTheme): Promise<void> {
  const a = hexToRgb(accent);
  const wall = mix(WARM, [214, 190, 170], 0.35);
  const floor = mix(WARM, INK, 0.12);
  const soft = mix(a, CREAM, 0.78);
  const furniture =
    theme === 'massage'
      ? `<rect x="620" y="640" width="760" height="70" rx="35" fill="${css(mix(CREAM, WARM, 0.2))}"/>
         <rect x="660" y="700" width="30" height="170" fill="${css(mix(WARM, INK, 0.35))}"/>
         <rect x="1310" y="700" width="30" height="170" fill="${css(mix(WARM, INK, 0.35))}"/>
         <ellipse cx="1000" cy="630" rx="360" ry="22" fill="${css(soft, 0.9)}"/>
         <g fill="${css(mix(INK, WARM, 0.45))}"><ellipse cx="1500" cy="800" rx="46" ry="20"/><ellipse cx="1560" cy="772" rx="38" ry="17"/><ellipse cx="1520" cy="748" rx="30" ry="13"/></g>
         <g fill="${css(a, 0.25)}"><circle cx="420" cy="760" r="14"/><circle cx="460" cy="770" r="10"/></g>`
      : `<rect x="560" y="610" width="880" height="44" rx="22" fill="${css(mix(CREAM, WARM, 0.15))}"/>
         <rect x="600" y="654" width="24" height="210" fill="${css(mix(WARM, INK, 0.3))}"/>
         <rect x="1376" y="654" width="24" height="210" fill="${css(mix(WARM, INK, 0.3))}"/>
         ${[700, 1040].map(x => `<path d="M${x},860 v-120 a110,110 0 0 1 220,0 v120 z" fill="${css(soft)}"/><rect x="${x + 20}" y="760" width="180" height="56" rx="20" fill="${css(mix(soft, CREAM, 0.4))}"/>`).join('')}
         <g>${[0, 1, 2, 3, 4].map(i => `<rect x="${640 + i * 34}" y="${560 - (i % 2) * 14}" width="20" height="${50 + (i % 2) * 14}" rx="6" fill="${css(i % 2 ? a : mix(a, CREAM, 0.5), 0.85)}"/>`).join('')}</g>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="1100" viewBox="0 0 2000 1100">
  <defs>
    <radialGradient id="light" cx="0.62" cy="0.18" r="0.8"><stop offset="0" stop-color="#fff" stop-opacity="0.9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${css(floor)}"/><stop offset="1" stop-color="${css(mix(floor, INK, 0.18))}"/></linearGradient>
  </defs>
  <rect width="2000" height="1100" fill="${css(wall)}"/>
  ${[300, 1000, 1700].map(x => `<path d="M${x - 170},880 V330 a170,170 0 0 1 340,0 V880 z" fill="${css(mix(wall, CREAM, 0.6))}" stroke="${css(mix(WARM, INK, 0.2))}" stroke-width="6"/>`).join('')}
  <rect x="0" y="860" width="2000" height="240" fill="url(#floor)"/>
  ${furniture}
  <g transform="translate(160,560)">
    <rect x="-40" y="230" width="80" height="90" rx="14" fill="${css(mix(WARM, INK, 0.25))}"/>
    ${[-60, -20, 20, 60].map((r, i) => `<ellipse cx="0" cy="${150 - i * 30}" rx="26" ry="90" transform="rotate(${r} 0 230)" fill="${css(mix([92, 132, 96], CREAM, 0.15 + i * 0.08))}"/>`).join('')}
  </g>
  <g transform="translate(1840,600)">
    <rect x="-34" y="200" width="68" height="80" rx="12" fill="${css(mix(WARM, INK, 0.25))}"/>
    ${[-40, 0, 40].map((r, i) => `<ellipse cx="0" cy="${120 - i * 20}" rx="22" ry="80" transform="rotate(${r} 0 200)" fill="${css(mix([92, 132, 96], CREAM, 0.2 + i * 0.1))}"/>`).join('')}
  </g>
  <circle cx="1000" cy="150" r="46" fill="${css(mix(CREAM, [255, 214, 150], 0.5))}"/>
  <rect width="2000" height="1100" fill="url(#light)"/>
</svg>`;
  await sharp(Buffer.from(svg)).webp({quality: 86}).toFile(file);
}

/** A «work»: nail palettes, brow arcs or massage stones on a soft background. */
export async function renderBeautyWork(file: string, accent: string, index: number, theme: BeautyTheme): Promise<void> {
  const a = hexToRgb(accent);
  const tones: Rgb[] = [mix(a, CREAM, 0.15), mix(a, [214, 92, 120], 0.5), mix([214, 168, 150], CREAM, 0.1), mix(a, INK, 0.25), [188, 140, 120], mix(a, CREAM, 0.55)];
  const tone = tones[index % tones.length]!;
  const bg = mix(CREAM, index % 2 ? WARM : mix(a, CREAM, 0.85), 0.5);
  let body: string;
  if (theme === 'massage') {
    body = [0, 1, 2, 3].map(i => `<ellipse cx="${540 - i * 20}" cy="${760 - i * 120}" rx="${230 - i * 38}" ry="${70 - i * 8}" fill="${css(mix(INK, WARM, 0.35 + i * 0.12))}"/>`).join('') +
      `<g fill="${css(mix(a, CREAM, 0.4), 0.9)}">${[0, 1, 2, 3, 4].map(i => `<ellipse cx="${260 + i * 140}" cy="${300 + (i % 2) * 40}" rx="20" ry="46" transform="rotate(${i * 30 - 50} ${260 + i * 140} ${300 + (i % 2) * 40})"/>`).join('')}</g>`;
  } else if (theme === 'hair' && index % 3 === 2) {
    // brows / lashes
    body = `<path d="M230,520 C380,380 640,370 840,470" stroke="${css(mix(INK, WARM, 0.25))}" stroke-width="46" fill="none" stroke-linecap="round"/>
      <ellipse cx="540" cy="700" rx="230" ry="96" fill="${css(CREAM)}" stroke="${css(mix(INK, WARM, 0.4))}" stroke-width="10"/>
      <circle cx="540" cy="700" r="70" fill="${css(tone)}"/><circle cx="540" cy="700" r="30" fill="${css(INK)}"/>
      ${Array.from({length: 9}, (_, i) => `<path d="M${330 + i * 52},${625 - Math.sin((i / 8) * Math.PI) * 26} l-${8 - i},-44" stroke="${css(INK)}" stroke-width="7" stroke-linecap="round"/>`).join('')}`;
  } else {
    // nails: five almond nails in a fan
    body = [-36, -18, 0, 18, 36]
      .map((r, i) => {
        const c = i === 2 ? mix(tone, [255, 255, 255], 0.15) : tone;
        return `<g transform="rotate(${r} 540 980)"><rect x="490" y="${300 + Math.abs(r) * 3}" width="100" height="300" rx="50" fill="${css(mix(WARM, [236, 200, 180], 0.6))}"/>
          <path d="M500,${340 + Math.abs(r) * 3} q40,-90 80,0 v120 q-40,24 -80,0 z" fill="${css(c)}"/>
          <ellipse cx="528" cy="${360 + Math.abs(r) * 3}" rx="10" ry="26" fill="#fff" opacity="0.45"/></g>`;
      })
      .join('');
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
  <defs><radialGradient id="g" cx="0.3" cy="0.2" r="1"><stop offset="0" stop-color="#fff" stop-opacity="0.7"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>
  <rect width="1080" height="1080" fill="${css(bg)}"/>${body}<rect width="1080" height="1080" fill="url(#g)"/></svg>`;
  await sharp(Buffer.from(svg)).webp({quality: 84}).toFile(file);
}

/** Abstract master portrait: head-and-shoulders silhouette on a tinted card. */
export async function renderPortrait(file: string, accent: string, index: number): Promise<void> {
  const a = hexToRgb(accent);
  const bg = mix(a, CREAM, 0.72 - (index % 3) * 0.1);
  const skin: Rgb = ([[232, 196, 170], [210, 165, 135], [240, 210, 188]] as Rgb[])[index % 3]!;
  const hair: Rgb = ([[60, 40, 32], [150, 100, 60], [30, 26, 30]] as Rgb[])[index % 3]!;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800">
  <rect width="800" height="800" fill="${css(bg)}"/>
  <path d="M150,800 C170,600 300,560 400,560 C500,560 630,600 650,800 Z" fill="${css(mix(a, INK, 0.2))}"/>
  <rect x="360" y="460" width="80" height="120" rx="30" fill="${css(skin)}"/>
  <path d="M250,380 C240,190 560,170 560,380 C570,520 500,600 400,600 C300,600 240,520 250,380 Z" fill="${css(hair)}"/>
  <ellipse cx="400" cy="380" rx="130" ry="160" fill="${css(skin)}"/>
  <path d="M270,330 C300,210 500,200 540,330 C470,280 360,280 270,330 Z" fill="${css(hair)}"/>
</svg>`;
  await sharp(Buffer.from(svg)).webp({quality: 84}).toFile(file);
}

/** Round monogram logo on cream. */
export async function renderBeautyLogo(file: string, accent: string, name: string): Promise<void> {
  const letter = (name.trim()[0] ?? 'B').toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="${accent}"/>
  <circle cx="512" cy="512" r="420" fill="none" stroke="#fff" stroke-opacity="0.5" stroke-width="8"/>
  <text x="512" y="600" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="300" font-weight="700" fill="#fff">${letter}</text>
</svg>`;
  await sharp(Buffer.from(svg)).png().toFile(file);
}
