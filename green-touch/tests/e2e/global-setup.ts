/**
 * E2E fixtures. Test-only data, clearly marked «E2E …»; it is NOT part of the
 * production seed (supabase/seed.sql never contains kits or invented properties).
 * Also creates a throwaway admin user and checks that the Edge Functions answer.
 */
import {execSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {mkdirSync, writeFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
import pg from 'pg';

export const E2E_FILE = 'test-results/e2e-env.json';

export default async function setup(): Promise<void> {
  const out = execSync('npx supabase status -o env', {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']});
  const env = Object.fromEntries(out.split('\n').map(l => l.match(/^([A-Z_]+)="?([^"]*)"?$/)).filter(Boolean).map(m => [m![1], m![2]]));
  const db = new pg.Client({connectionString: env.DB_URL});
  await db.connect();
  await db.query("delete from items where kind = 'kit' and name like 'E2E %'");
  await db.query("delete from items where name like 'E2E %'");

  const add = async (slug: string, name: string, category: string, kind: string, price: number | null, facets: Record<string, string[]>) => {
    const r = await db.query(
      `insert into items (kind, category_id, slug, name, volume, price_kop, status) values ($1, (select id from categories where slug = $2), $3, $4, '50 мл', $5, 'published') returning id`,
      [kind, category, slug, name, price],
    );
    for (const [group, slugs] of Object.entries(facets)) {
      await db.query('insert into item_facets select $1, id from facets where group_key = $2 and slug = any($3)', [r.rows[0].id, group, slugs]);
    }
    return r.rows[0].id as string;
  };
  const cream = await add('e2e-krem-sukha', 'E2E Крем для сухої шкіри', 'kremy', 'product', 110000, {skin_type: ['sukha'], skin_need: ['sukhist']});
  const serum = await add('e2e-syrovatka', 'E2E Сироватка зволожувальна', 'syrovatky', 'product', 50000, {skin_type: ['sukha', 'normalna']});
  await add('e2e-tonik', 'E2E Тонік окремий', 'toniky', 'product', 40000, {});
  // kit: 1100 + 500 = 1600 → −15 % = 1360 грн
  const kit = await add('e2e-nabir-zvolozhennia', 'E2E Набір зволоження', 'nabory', 'kit', null, {skin_type: ['sukha'], kit_purpose: ['zvolozhennia']});
  await db.query("update items set short_purpose = 'Тестовий набір (fixture)' where id = $1", [kit]);
  await db.query('insert into kit_components (kit_id, product_id, qty, sort) values ($1, $2, 1, 1), ($1, $3, 1, 2)', [kit, cream, serum]);
  await db.end();

  const admin = createClient(env.API_URL!, env.SERVICE_ROLE_KEY!, {auth: {persistSession: false}});
  const email = `e2e-admin-${randomUUID().slice(0, 8)}@example.test`;
  const password = `E2e-${randomUUID()}`;
  const {data, error} = await admin.auth.admin.createUser({email, password, email_confirm: true});
  if (error) throw error;
  const c2 = new pg.Client({connectionString: env.DB_URL});
  await c2.connect();
  await c2.query('insert into admins (user_id) values ($1)', [data.user.id]);
  await c2.end();
  mkdirSync('test-results', {recursive: true});
  writeFileSync(E2E_FILE, JSON.stringify({email, password}));

  const probe = await fetch(`${env.API_URL}/functions/v1/np`, {
    method: 'POST',
    headers: {'content-type': 'application/json', authorization: `Bearer ${env.ANON_KEY}`, apikey: env.ANON_KEY!},
    body: JSON.stringify({action: 'settlements', q: 'Київ', page: 1}),
  }).catch(() => null);
  if (!probe?.ok) throw new Error('Edge Functions are not served. Run `pnpm functions:serve` (with the test adapters in supabase/functions/.env).');
}
