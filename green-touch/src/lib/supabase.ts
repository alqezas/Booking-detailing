import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {env} from './env.ts';

/** Shoppers: anonymous, never stores a session. */
export const publicClient: SupabaseClient = createClient(env.supabaseUrl, env.anonKey, {
  auth: {persistSession: false, autoRefreshToken: false, detectSessionInUrl: false},
});

/** The owner's admin session (Supabase Auth). Created on first use: shoppers never load it. */
let adminClient: SupabaseClient | null = null;
export function admin(): SupabaseClient {
  adminClient ??= createClient(env.supabaseUrl, env.anonKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce', storageKey: 'gt-admin'},
  });
  return adminClient;
}
