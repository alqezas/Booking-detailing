import {defineTheme} from '@astryxdesign/core/theme';
import {neutralTheme} from '@astryxdesign/theme-neutral';
import {phosphorIcons} from './icons.tsx';

/**
 * Green Touch: milky page, natural greens, a readable serif for headings.
 * Colours live only here (theme tokens); components use var(--color-*).
 * Contrast: text #1F2A1D on #FBF8F1 ≈ 14:1; accent #3F6B3A with white ≈ 6:1.
 */
export const shopTheme = defineTheme({
  name: 'green-touch',
  extends: neutralTheme,
  icons: phosphorIcons,
  typography: {
    scale: {base: 16, ratio: 1.2},
    body: {family: 'Manrope', fallbacks: '-apple-system, "Segoe UI", Roboto, system-ui, sans-serif'},
    heading: {family: 'Lora', fallbacks: 'Georgia, "Times New Roman", serif', weight: 'semibold', weights: {1: 'semibold', 2: 'semibold', 3: 'semibold'}},
  },
  radius: {base: 6, multiplier: 1.6},
  motion: {fast: 160, medium: 280, slow: 560, ratio: 0.75},
  tokens: {
    '--color-background-body': '#FBF8F1',
    '--color-background-surface': '#FFFDF8',
    '--color-background-card': '#FFFFFF',
    '--color-background-popover': '#FFFFFF',
    '--color-background-muted': '#F2EEE3',
    '--color-border': 'rgba(31, 42, 29, 0.12)',
    '--color-border-emphasized': 'rgba(31, 42, 29, 0.28)',
    '--color-text-primary': '#1F2A1D',
    '--color-text-secondary': '#55604F',
    '--color-icon-primary': '#1F2A1D',
    '--color-icon-secondary': '#55604F',
    '--color-accent': '#3F6B3A',
    '--color-on-accent': '#FFFFFF',
    '--color-accent-muted': 'rgba(63, 107, 58, 0.12)',
    '--color-text-accent': '#355C31',
    '--color-icon-accent': '#355C31',
    '--color-shadow': 'rgba(40, 52, 30, 0.10)',
  },
});
