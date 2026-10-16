/** WCAG contrast helpers used to derive a readable accent pair from one config colour. */

export type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return '#' + [r, g, b].map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('').toUpperCase();
}

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};

export function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const scale = (hex: string, factor: number): string => rgbToHex(hexToRgb(hex).map(v => v * factor) as Rgb);
const towardWhite = (hex: string, t: number): string => rgbToHex(hexToRgb(hex).map(v => v + (255 - v) * t) as Rgb);

/**
 * From one brand colour:
 *  - `fill`  — background for filled buttons, darkened until white text reaches 4.5:1;
 *  - `text`  — accent text/icons on the black page, lightened until it reaches 4.5:1;
 *  - `onFill` — label colour on `fill` (white).
 */
export function accentPair(hex: string): {fill: string; text: string; onFill: string} {
  let fill = hex.toUpperCase();
  for (let i = 0; i < 40 && contrast(fill, '#FFFFFF') < 4.5; i++) fill = scale(fill, 0.96);
  let text = hex.toUpperCase();
  for (let i = 0; i < 40 && contrast(text, '#000000') < 4.5; i++) text = towardWhite(text, 0.08);
  return {fill, text, onFill: '#FFFFFF'};
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
