/**
 * pnpm cloud:configure — environment-specific settings of the linked cloud
 * database that migrations cannot know:
 *   private.app_config.functions_url → https://<ref>.supabase.co/functions/v1
 *     (pg_cron uses it to wake notify-dispatch)
 * Needs `supabase link` and SUPABASE_URL + SUPABASE_DB_PASSWORD in .env.publish.
 */
import {existsSync, readFileSync} from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import {ROOT} from './lib/tenants.ts';

const envFile = path.join(ROOT, '.env.publish');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const pooler = path.join(ROOT, 'supabase', '.temp', 'pooler-url');
const url = process.env.SUPABASE_URL;
const password = process.env.SUPABASE_DB_PASSWORD;
if (!existsSync(pooler) || !url || !password) {
  console.error('✗ Сначала `supabase link`, и задайте SUPABASE_URL и SUPABASE_DB_PASSWORD в .env.publish');
  process.exit(1);
}
const conn = new URL(readFileSync(pooler, 'utf8').trim());
conn.password = password;
const client = new pg.Client({connectionString: conn.toString(), ssl: {rejectUnauthorized: false}});
await client.connect();
const functionsUrl = `${url.replace(/\/$/, '')}/functions/v1`;
await client.query(`update private.app_config set value = $1 where name = 'functions_url'`, [functionsUrl]);
const jobs = await client.query(`select jobname, schedule from cron.job order by jobname`);
await client.end();
console.log(`✓ functions_url = ${functionsUrl}`);
console.log(`✓ cron: ${jobs.rows.map(r => `${r.jobname} (${r.schedule})`).join(', ')}`);
