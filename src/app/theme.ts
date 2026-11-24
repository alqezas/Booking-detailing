import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';
import {accentPair, accentPairLight, withAlpha} from '../../shared/color.ts';
import {phosphorIcons} from './icons.tsx';

/**
 * The studio theme: black canvas, white text, one accent from the studio
 * config. The accent is split into a button fill (≥ 4.5:1 with white) and an
 * accent text colour (≥ 4.5:1 on black), so any brand colour stays readable.
 * Built at runtime because the accent comes from the database; this app is
 * client-rendered, so a runtime theme has no hydration flash.
 */
const cache = new Map<string, ReturnType<typeof defineTheme>>();

export function studioTheme(accent: string, mode: 'dark' | 'light' | 'cream' = 'dark') {
  if (mode !== 'dark') return lightTheme(accent, mode === 'cream' ? CREAM : WHITE);
  const hit = cache.get(accent);
  if (hit) return hit;
  const {fill, text, onFill} = accentPair(accent);
  const theme = defineTheme({
    name: 'studio',
    extends: neutralTheme,
    icons: phosphorIcons,
    typography: {
      scale: {base: 16, ratio: 1.2},
      body: {family: 'Manrope', fallbacks: '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif'},
      heading: {weight: 'bold', weights: {1: 'bold', 2: 'bold', 3: 'semibold'}},
    },
    radius: {base: 6, multiplier: 1.5},
    motion: {fast: 160, medium: 320, slow: 700, ratio: 0.75},
    tokens: {
      '--color-background-body': '#000000',
      '--color-background-surface': '#0B0B0D',
      '--color-background-card': '#121215',
      '--color-background-popover': '#18181C',
      '--color-background-muted': '#1C1C21',
      '--color-border': 'rgba(255, 255, 255, 0.10)',
      '--color-border-emphasized': 'rgba(255, 255, 255, 0.32)',
      '--color-text-primary': '#FFFFFF',
      '--color-text-secondary': 'rgba(255, 255, 255, 0.72)',
      '--color-icon-primary': '#FFFFFF',
      '--color-icon-secondary': 'rgba(255, 255, 255, 0.72)',
      '--color-accent': fill,
      '--color-on-accent': onFill,
      '--color-accent-muted': withAlpha(accent, 0.18),
      '--color-text-accent': text,
      '--color-icon-accent': text,
    },
  });
  cache.set(accent, theme);
  return theme;
}

export const DEFAULT_ACCENT = '#4690FF';

/**
 * Beauty theme: white page (#FFFFFF), clean white cards with a delicate
 * border, deep ink text (#141318), an accent from the config (violet by
 * default) and an elegant serif for headings. Soft, low shadows.
 */
type Canvas = {name: string; body: string; surface: string; card: string; muted: string; ink: string; inkRgb: string; secondary: string; shadow: string};
const WHITE: Canvas = {name: 'studio-light', body: '#FFFFFF', surface: '#FFFFFF', card: '#FFFFFF', muted: '#F4F4F6', ink: '#141318', inkRgb: '20, 19, 24', secondary: '#5E5A66', shadow: 'rgba(60, 40, 90, 0.08)'};
/** "cream": warm milky canvas with graphite text — soft, feminine studios. */
const CREAM: Canvas = {name: 'studio-cream', body: '#F6F1E9', surface: '#FBF8F3', card: '#FFFDF9', muted: '#EEE6DA', ink: '#2C2B2F', inkRgb: '44, 43, 47', secondary: '#6B655D', shadow: 'rgba(90, 70, 40, 0.08)'};

const lightCache = new Map<string, ReturnType<typeof defineTheme>>();
function lightTheme(accent: string, c: Canvas) {
  const key = c.name + accent;
  const hit = lightCache.get(key);
  if (hit) return hit;
  const {fill, text, onFill} = accentPairLight(accent);
  const theme = defineTheme({
    name: c.name,
    extends: neutralTheme,
    icons: phosphorIcons,
    typography: {
      scale: {base: 16, ratio: 1.2},
      body: {family: 'Manrope', fallbacks: '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif'},
      heading: {family: 'Playfair Display', fallbacks: 'Georgia, "Times New Roman", serif', weight: 'bold', weights: {1: 'bold', 2: 'bold', 3: 'semibold'}},
    },
    radius: {base: 4, multiplier: 1.5},
    motion: {fast: 160, medium: 280, slow: 600, ratio: 0.75},
    tokens: {
      '--color-background-body': c.body,
      '--color-background-surface': c.surface,
      '--color-background-card': c.card,
      '--color-background-popover': c.card,
      '--color-background-muted': c.muted,
      '--color-border': `rgba(${c.inkRgb}, 0.10)`,
      '--color-border-emphasized': `rgba(${c.inkRgb}, 0.22)`,
      '--color-text-primary': c.ink,
      '--color-text-secondary': c.secondary,
      '--color-icon-primary': c.ink,
      '--color-icon-secondary': c.secondary,
      '--color-accent': fill,
      '--color-on-accent': onFill,
      '--color-accent-muted': withAlpha(accent, 0.12),
      '--color-text-accent': text,
      '--color-icon-accent': text,
      '--color-shadow': c.shadow,
    },
  });
  lightCache.set(key, theme);
  return theme;
}
