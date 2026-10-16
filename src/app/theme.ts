import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';
import {accentPair, withAlpha} from '../../shared/color.ts';
import {phosphorIcons} from './icons.tsx';

/**
 * The studio theme: black canvas, white text, one accent from the studio
 * config. The accent is split into a button fill (≥ 4.5:1 with white) and an
 * accent text colour (≥ 4.5:1 on black), so any brand colour stays readable.
 * Built at runtime because the accent comes from the database; this app is
 * client-rendered, so a runtime theme has no hydration flash.
 */
const cache = new Map<string, ReturnType<typeof defineTheme>>();

export function studioTheme(accent: string) {
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
