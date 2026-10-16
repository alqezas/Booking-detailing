import {useEffect} from 'react';
import {prefersReducedMotion} from './motion.ts';

type Lens = {destroy?: () => void};
type LiquidGL = ((options: Record<string, unknown>) => Lens | Lens[] | undefined) & {
  registerDynamic?: (els: Element[] | string) => void;
};

let loader: Promise<LiquidGL> | null = null;
function loadLiquidGL(): Promise<LiquidGL> {
  loader ??= import('liquid-gl').then(m => (m.default ?? (window as unknown as {liquidGL: LiquidGL}).liquidGL) as LiquidGL);
  return loader;
}

export type GlassOptions = {
  /** CSS selector of the element to turn into glass. */
  target: string;
  /** CSS selector of the only area the lens may refract. */
  snapshot: string;
  enabled?: boolean;
  /** Re-snapshot when this value changes (content under the lens changed). */
  refreshKey?: unknown;
  tint?: string;
  frost?: number;
  resolution?: number;
};

/**
 * Real refractive glass (liquid-gl: WebGPU → WebGL → CSS backdrop-filter).
 * The label lives in the DOM above the lens (`content: false`), so text stays
 * crisp. Motion effects are off when the user asked for reduced motion.
 */
export function useLiquidGlass({target, snapshot, enabled = true, refreshKey, tint, frost = 2, resolution = 1.5}: GlassOptions): void {
  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    let lenses: Lens[] = [];
    let cancelled = false;
    const reduced = prefersReducedMotion();

    const start = async () => {
      await document.fonts?.ready;
      const liquidGL = await loadLiquidGL();
      if (cancelled || !document.querySelector(target)) return;
      const result = liquidGL({
        target,
        snapshot,
        content: false,
        resolution,
        refraction: 0.012,
        bevelDepth: 0.06,
        bevelWidth: 0.2,
        frost,
        tint: tint ?? 'rgba(10, 12, 18, 0.32)',
        shadow: true,
        specular: !reduced,
        reveal: reduced ? 'none' : 'fade',
        tilt: false,
        interaction: 'none',
      });
      lenses = Array.isArray(result) ? result : result ? [result] : [];
      if (cancelled) lenses.forEach(l => l.destroy?.());
    };
    const id = window.setTimeout(() => void start().catch(() => undefined), 60);
    return () => {
      cancelled = true;
      window.clearTimeout(id);
      lenses.forEach(l => {
        try {
          l.destroy?.();
        } catch {
          /* already torn down */
        }
      });
    };
  }, [target, snapshot, enabled, tint, frost, resolution]);

  // Content under the lens changed without a resize: take a fresh snapshot.
  useEffect(() => {
    if (!enabled || refreshKey === undefined) return;
    const id = window.setTimeout(() => {
      const gl = (window as unknown as {liquidGL?: LiquidGL}).liquidGL;
      try {
        gl?.registerDynamic?.([]);
      } catch {
        /* no renderer yet */
      }
    }, 250);
    return () => window.clearTimeout(id);
  }, [enabled, refreshKey]);
}
