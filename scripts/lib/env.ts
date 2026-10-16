/**
 * Server credentials for pipeline scripts.
 *   --local   take URL/keys from the running local stack (`supabase status`)
 *   otherwise read .env.publish (git-ignored) or the process environment:
 *     SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY, SITE_URL
 */
import {execSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import path from 'node:path';
import {createClient, type SupabaseClient} from '@supabase/supabase-js';
import {ROOT} from './tenants.ts';

export type PipelineEnv = {url: string; serviceKey: string; anonKey: string; siteUrl: string | null; local: boolean};

export function loadPipelineEnv(local: boolean): PipelineEnv {
  if (local) {
    const out = execSync('npx supabase status -o env', {cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
    const kv = Object.fromEntries(out.split('\n').map(l => l.match(/^([A-Z_]+)="?([^"]*)"?$/)).filter(Boolean).map(m => [m![1]!, m![2]!]));
    return {url: kv.API_URL!, serviceKey: kv.SERVICE_ROLE_KEY!, anonKey: kv.ANON_KEY!, siteUrl: process.env.SITE_URL ?? 'http://localhost:4173', local: true};
  }
  const file = path.join(ROOT, '.env.publish');
  if (existsSync(file)) process.loadEnvFile(file);
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !serviceKey || !anonKey) {
    console.error('✗ Нужны SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY и SUPABASE_ANON_KEY (файл .env.publish, см. .env.example) или флаг --local');
    process.exit(1);
  }
  return {url, serviceKey, anonKey, siteUrl: process.env.SITE_URL ?? null, local: false};
}

export const adminClient = (e: PipelineEnv): SupabaseClient =>
  createClient(e.url, e.serviceKey, {auth: {persistSession: false, autoRefreshToken: false}});
