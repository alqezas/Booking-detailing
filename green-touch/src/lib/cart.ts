/**
 * Local cart (localStorage): survives reloads, works offline, syncs between tabs.
 * Snapshot prices are only for showing the cart offline — the server quotes the
 * real prices and availability before any order (quote_cart / create_order).
 */
import {useSyncExternalStore} from 'react';
import type {ItemCard, ItemKind} from './types.ts';

export type CartLine = {
  id: string;
  kind: ItemKind;
  slug: string;
  name: string;
  volume: string | null;
  price_kop: number;
  base_kop: number | null;
  image: string | null;
  qty: number;
};
export type CartState = {lines: CartLine[]; updated_at: number};

export const MAX_QTY = 50;
export const MAX_LINES = 30;
const KEY = 'gt-cart-v1';

export type CartAction =
  | {type: 'add'; item: Pick<ItemCard, 'id' | 'kind' | 'slug' | 'name' | 'volume' | 'price_kop' | 'base_kop' | 'image'>; qty: number}
  | {type: 'set'; id: string; qty: number}
  | {type: 'remove'; id: string}
  | {type: 'refresh'; prices: Record<string, {price_kop: number; base_kop: number | null; name: string}>}
  | {type: 'clear'};

/** Pure reducer (unit-tested). A kit is one line; its components cannot be removed. */
export function cartReducer(state: CartState, a: CartAction, now = Date.now()): CartState {
  const clamp = (n: number) => Math.min(MAX_QTY, Math.max(1, Math.floor(n)));
  switch (a.type) {
    case 'add': {
      const hit = state.lines.find(l => l.id === a.item.id);
      if (hit) return {lines: state.lines.map(l => (l.id === a.item.id ? {...l, qty: clamp(l.qty + a.qty)} : l)), updated_at: now};
      if (state.lines.length >= MAX_LINES) return state;
      return {lines: [...state.lines, {...a.item, qty: clamp(a.qty)}], updated_at: now};
    }
    case 'set':
      if (a.qty < 1) return {lines: state.lines.filter(l => l.id !== a.id), updated_at: now};
      return {lines: state.lines.map(l => (l.id === a.id ? {...l, qty: clamp(a.qty)} : l)), updated_at: now};
    case 'remove':
      return {lines: state.lines.filter(l => l.id !== a.id), updated_at: now};
    case 'refresh':
      return {
        lines: state.lines.map(l => (a.prices[l.id] ? {...l, ...a.prices[l.id]} : l)),
        updated_at: now,
      };
    case 'clear':
      return {lines: [], updated_at: now};
  }
}

export function parseCart(raw: string | null): CartState {
  try {
    const v = JSON.parse(raw ?? '') as CartState;
    if (!Array.isArray(v.lines)) throw new Error();
    const lines = v.lines
      .filter(l => typeof l.id === 'string' && Number.isInteger(l.qty) && l.qty >= 1)
      .slice(0, MAX_LINES)
      .map(l => ({...l, qty: Math.min(MAX_QTY, l.qty)}));
    return {lines, updated_at: Number(v.updated_at) || 0};
  } catch {
    return {lines: [], updated_at: 0};
  }
}

let state: CartState = typeof localStorage !== 'undefined' ? parseCart(localStorage.getItem(KEY)) : {lines: [], updated_at: 0};
const listeners = new Set<() => void>();
const emit = () => listeners.forEach(l => l());

export function dispatchCart(a: CartAction): void {
  state = cartReducer(state, a);
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode: cart lives for this tab only */
  }
  emit();
}

if (typeof window !== 'undefined') {
  window.addEventListener('storage', e => {
    if (e.key === KEY) {
      state = parseCart(e.newValue);
      emit();
    }
  });
}

export function useCart(): CartState {
  return useSyncExternalStore(
    l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export const cartCount = (s: CartState) => s.lines.reduce((n, l) => n + l.qty, 0);
export const cartPayload = (s: CartState) => s.lines.map(l => ({id: l.id, qty: l.qty}));
