import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {env} from './env.ts';

/** Anonymous client for the public booking flow: never stores a session. */
export const publicClient: SupabaseClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});

const ownerClients = new Map<string, SupabaseClient>();

/**
 * Owner client, one per studio, with its own storage key so signing in to one
 * studio's cabinet never leaks a session into another studio's pages.
 */
export function ownerClient(slug: string): SupabaseClient {
  let c = ownerClients.get(slug);
  if (!c) {
    c = createClient(env.supabaseUrl, env.supabaseAnonKey, {
      auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: `studio-owner-${slug}`},
    });
    ownerClients.set(slug, c);
  }
  return c;
}
