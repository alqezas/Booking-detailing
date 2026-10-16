import {execSync} from 'node:child_process';
import pg from 'pg';

/**
 * All local requests share one client IP, so the per-IP booking limit
 * (8 per 10 min) would trip across test runs. Reset the counters of the
 * LOCAL database only; production limits are untouched.
 */
export default async function setup(): Promise<void> {
  const out = execSync('npx supabase status -o env', {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  const url = out.match(/^DB_URL="?([^"\n]+)"?/m)?.[1];
  if (!url || !/127\.0\.0\.1|localhost/.test(url)) throw new Error('e2e runs only against the local Supabase stack');
  const client = new pg.Client({connectionString: url});
  await client.connect();
  await client.query('delete from private.rate_counters');
  await client.end();
}
