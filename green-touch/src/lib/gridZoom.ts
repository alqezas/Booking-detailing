/**
 * Pinch-to-zoom for the catalog grid on phones, like a phone photo gallery:
 * spread two fingers → fewer, bigger cards (down to 1 per row);
 * pinch them together → more, smaller cards (up to 4 per row).
 *
 * Motion:
 * - while the fingers move, the grid follows them live (scales around the
 *   point between the fingers; at 1 or 4 per row it only stretches a little);
 * - on release past the threshold the cards fly to their new places and sizes
 *   (View Transitions: every card morphs from where it is to where it goes),
 *   and the card under the fingers stays under the fingers;
 * - a small pinch springs back.
 * With «reduce motion» in the phone settings the grid just switches.
 *
 * The browser's own page zoom is switched off while the catalog is open (on phones),
 * so a pinch never leaves the page zoomed in or out; one-finger scrolling works as usual.
 * The choice is remembered on this device.
 */
import {useEffect, useRef, useState, type CSSProperties, type RefObject} from 'react';
import {flushSync} from 'react-dom';
import {prefersReducedMotion} from './motion.ts';

export const MIN_COLS = 1;
export const MAX_COLS = 4;
const KEY = 'gt-catalog-cols';
const DEFAULT_COLS = 2;
const EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';
const MORPH_MS = 340;
const SPRING_MS = 240;

const clamp = (n: number) => Math.min(MAX_COLS, Math.max(MIN_COLS, n));

function readCols(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n >= MIN_COLS && n <= MAX_COLS ? n : DEFAULT_COLS;
  } catch {
    return DEFAULT_COLS;
  }
}

/** One pinch = one step, like a phone gallery: `ratio` is the change in finger distance. */
export function colsForPinch(start: number, ratio: number): number {
  if (ratio >= 1.25) return clamp(start - 1);
  if (ratio <= 0.8) return clamp(start + 1);
  return start;
}

/** How much the grid scales while the fingers move (live feedback, before release). */
export function liveScale(cols: number, ratio: number): number {
  const canGrow = cols > MIN_COLS; // spreading → bigger cards
  const canShrink = cols < MAX_COLS; // pinching → smaller cards
  const r = ratio >= 1 ? (canGrow ? ratio : 1 + (ratio - 1) * 0.12) : canShrink ? ratio : 1 - (1 - ratio) * 0.12;
  // the next step is cols/(cols±1) of today's size; let the fingers go a bit past it
  const lo = canShrink ? cols / (cols + 1) - 0.08 : 0.95;
  const hi = canGrow ? cols / (cols - 1) + 0.12 : 1.05;
  return Math.min(hi, Math.max(lo, r));
}

const pair = (t: TouchList) => {
  const a = t[0];
  const b = t[1];
  if (!a || !b) return null;
  return {d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2};
};

// Timing of the morph. Pseudo-elements of a view transition can only be styled
// from a stylesheet, so this one rule is added at runtime, once.
let styled = false;
function ensureMorphStyle() {
  if (styled || typeof document === 'undefined') return;
  styled = true;
  const s = document.createElement('style');
  s.textContent = [
    `@keyframes gt-fade-out{to{opacity:0}}`,
    `@keyframes gt-fade-in{from{opacity:0}}`,
    `::view-transition-group(*){animation-duration:${MORPH_MS}ms;animation-timing-function:${EASE}}`,
    // photos fly and resize (same picture before and after, so no double image)
    `::view-transition-old(.gt-photo),::view-transition-new(.gt-photo){animation-duration:${MORPH_MS}ms;animation-timing-function:${EASE};height:100%;object-fit:cover}`,
    // captions and buttons: gone at once, back when the photos have landed (text never shows twice)
    `::view-transition-old(.gt-card){animation:gt-fade-out 90ms ease-out both}`,
    `::view-transition-new(.gt-card){animation:gt-fade-in 180ms ease-out ${MORPH_MS - 120}ms both}`,
    // the rest of the page stays still; the header and cart bar stay above the flying cards
    `::view-transition-old(root),::view-transition-new(root){animation:none}`,
    `::view-transition-group(gt-header),::view-transition-group(gt-cartbar){z-index:10;animation:none}`,
    `::view-transition-old(gt-header),::view-transition-new(gt-header),::view-transition-old(gt-cartbar),::view-transition-new(gt-cartbar){animation:none}`,
  ].join('\n');
  document.head.appendChild(s);
}

/**
 * Switches off the browser's pinch zoom while the catalog is open and resets a page
 * that is already zoomed. Android browsers obey the viewport tag (changing it also
 * snaps the zoom back to 100%); iOS ignores it, there the gesture events are cancelled.
 */
function lockPageZoom(): () => void {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  const prevMeta = meta?.getAttribute('content') ?? null;
  const html = document.documentElement;
  const prevTouch = html.style.touchAction;
  meta?.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');
  html.style.touchAction = 'pan-x pan-y';
  return () => {
    if (meta && prevMeta != null) meta.setAttribute('content', prevMeta);
    html.style.touchAction = prevTouch;
  };
}

type ViewTransitionDoc = Document & {startViewTransition?: (cb: () => void) => {finished: Promise<void>}};

// overflow clip: a grid scaled up under the fingers never makes the page scroll sideways
export const pinchSurface: CSSProperties = {display: 'block', touchAction: 'pan-y', overflowX: 'clip'};
export const pinchTarget: CSSProperties = {display: 'block', willChange: 'transform'};

export function usePinchColumns(enabled: boolean): {
  cols: number;
  /** listens to the fingers (the whole results area) */
  ref: RefObject<HTMLElement | null>;
  /** what scales live (the grid of cards) */
  gridRef: RefObject<HTMLElement | null>;
} {
  const [cols, setCols] = useState(readCols);
  const ref = useRef<HTMLElement | null>(null);
  const gridRef = useRef<HTMLElement | null>(null);
  const colsRef = useRef(cols);
  colsRef.current = cols;

  useEffect(() => {
    try {
      localStorage.setItem(KEY, String(cols));
    } catch {
      /* ignore */
    }
  }, [cols]);

  useEffect(() => {
    if (!enabled) return;
    ensureMorphStyle();
    // On the catalog two fingers change the grid, never the page zoom. The pinch is
    // caught on the whole page (not only over the cards), the browser's own zoom is
    // switched off here and any zoom left from before is reset; other pages still zoom.
    const el = document;
    const unlockZoom = lockPageZoom();
    let start: {d: number; cols: number; x: number; y: number} | null = null;
    let ratio = 1;

    const grid = () => gridRef.current;
    const setTransform = (t: string, animate: boolean) => {
      const g = grid();
      if (!g) return;
      g.style.transition = animate ? `transform ${SPRING_MS}ms ${EASE}` : 'none';
      g.style.transform = t;
    };

    const commit = (next: number, x: number, y: number) => {
      const reduced = prefersReducedMotion();
      const doc = document as ViewTransitionDoc;
      // keep the card under the fingers under the fingers
      const anchor = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest<HTMLElement>('[data-card]');
      const before = anchor?.getBoundingClientRect().top;
      const apply = () => {
        flushSync(() => setCols(next));
        setTransform('', false);
        if (anchor && before != null) window.scrollBy(0, anchor.getBoundingClientRect().top - before);
      };
      if (reduced || !doc.startViewTransition) {
        apply();
        return;
      }
      doc.startViewTransition(apply);
    };

    const onStart = (e: TouchEvent) => {
      const p = pair(e.touches);
      if (e.touches.length !== 2 || !p) return;
      const g = grid();
      start = {d: p.d, cols: colsRef.current, x: p.x, y: p.y};
      ratio = 1;
      if (g) {
        const r = g.getBoundingClientRect();
        g.style.transformOrigin = `${p.x - r.left}px ${p.y - r.top}px`;
      }
    };
    const onMove = (e: TouchEvent) => {
      if (e.touches.length < 2) return;
      e.preventDefault(); // any two-finger move here is ours, not the browser's zoom
      const p = pair(e.touches);
      if (!start || !p || start.d < 10) return;
      ratio = p.d / start.d;
      if (!prefersReducedMotion()) setTransform(`scale(${liveScale(start.cols, ratio)})`, false);
    };
    const onEnd = (e: TouchEvent) => {
      if (!start || e.touches.length >= 2) return;
      const s = start;
      start = null;
      const next = colsForPinch(s.cols, ratio);
      if (next !== s.cols) commit(next, s.x, s.y);
      else setTransform('', !prefersReducedMotion()); // spring back
    };
    // iOS Safari fires its own gesture events for page zoom; keep it from zooming the page here
    const stopGesture = (e: Event) => e.preventDefault();
    el.addEventListener('touchstart', onStart, {passive: true});
    el.addEventListener('touchmove', onMove, {passive: false});
    el.addEventListener('touchend', onEnd, {passive: true});
    el.addEventListener('touchcancel', onEnd, {passive: true});
    el.addEventListener('gesturestart', stopGesture, {passive: false});
    el.addEventListener('gesturechange', stopGesture, {passive: false});
    return () => {
      unlockZoom();
      setTransform('', false);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
      el.removeEventListener('gesturestart', stopGesture);
      el.removeEventListener('gesturechange', stopGesture);
    };
  }, [enabled]);

  return {cols, ref, gridRef};
}
