import {useEffect, useRef, useState, type CSSProperties, type RefObject} from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(QUERY).matches === true;
}

/** Live value of the OS "reduce motion" setting. */
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/**
 * Gentle fade when a section scrolls into view. Opacity only: nothing moves,
 * so nothing appears to jump. With reduced motion the content is simply
 * visible, without any transition.
 */
export function useReveal<T extends HTMLElement>(): {ref: RefObject<T | null>; style: CSSProperties} {
  const ref = useRef<T | null>(null);
  const reduced = useReducedMotion();
  const [shown, setShown] = useState(false);

  useEffect(() => {
    if (reduced || shown) return;
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setShown(true);
      return;
    }
    const io = new IntersectionObserver(
      entries => {
        if (entries.some(e => e.isIntersecting)) {
          setShown(true);
          io.disconnect();
        }
      },
      {rootMargin: '0px 0px -8% 0px', threshold: 0.08},
    );
    io.observe(el);
    return () => io.disconnect();
  }, [reduced, shown]);

  if (reduced) return {ref, style: {}};
  return {
    ref,
    style: {
      opacity: shown ? 1 : 0,
      transition: 'opacity var(--duration-medium) var(--ease-standard)',
    },
  };
}

/**
 * Media query that is correct on the FIRST render (this app is client-only),
 * so a layout switch never flashes the wrong variant and then jumps.
 */
export function useMatchMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatches(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return matches;
}
