import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {env} from './env.ts';

/** Shoppers: anonymous, never stores a session. */
export const publicClient: SupabaseClient = createClient(env.supabaseUrl, env.anonKey, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});

/**
 * Where the admin session is kept: sessionStorage, not localStorage. Closing the
 * tab or the installed admin app ends the session, so the home-screen icon always
 * starts at the sign-in form. Falls back to memory when storage is blocked.
 */
const memory = new Map<string, string>();
const sessionStore = {
  getItem: (k: string) => {
    try {
      return sessionStorage.getItem(k);
    } catch {
      return memory.get(k) ?? null;
    }
  },
  setItem: (k: string, v: string) => {
    try {
      sessionStorage.setItem(k, v);
    } catch {
      memory.set(k, v);
    }
  },
  removeItem: (k: string) => {
    try {
      sessionStorage.removeItem(k);
    } catch {
      memory.delete(k);
    }
  },
};

/** The owner's admin session (Supabase Auth). Created on first use: shoppers never load it. */
let adminClient: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  if (!adminClient) {
    // sessions saved by older builds in localStorage would keep the owner signed in for weeks
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('gt-admin')) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
    adminClient = createClient(env.supabaseUrl, env.anonKey, {
      auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'gt-admin', storage: sessionStore},
    });
  }
  return adminClient;
}
