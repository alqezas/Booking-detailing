import {execSync} from 'node:child_process';

/** Reads URLs and keys of the running local stack (`pnpm db:start`). */
export default function setup(): void {
  let out: string;
  try {
    out = execSync('npx supabase status -o env', {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  } catch {
    throw new Error('Local Supabase is not running. Start it with `pnpm db:start`.');
  }
  for (const line of out.split('\n')) {
    const m = line.match(/^([A-Z_]+)="?([^"]*)"?$/);
    if (m) process.env[`SB_${m[1]}`] = m[2];
  }
  if (!process.env.SB_API_URL || !process.env.SB_SERVICE_ROLE_KEY) {
    throw new Error('supabase status did not report API_URL / SERVICE_ROLE_KEY');
  }
}
