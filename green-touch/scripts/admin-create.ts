/**
 * Creates (or promotes) the shop owner's admin account. There is no public
 * sign-up: this script, run by whoever deploys the shop, is the only way.
 *
 *   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm admin:create owner@example.com
 *
 * A random password is generated and written to .secrets/admin.local.txt
 * (git-ignored) — never printed to the console. Change it after first sign-in.
 */
import {randomBytes} from 'node:crypto';
import {appendFileSync, mkdirSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';

const email = process.argv[2]?.trim().toLowerCase();
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Usage: pnpm admin:create owner@example.com');
if (!url || !key) throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (server-side only).');

const db = createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}});
const password = randomBytes(18).toString('base64url');

let userId: string;
const created = await db.auth.admin.createUser({email, password, email_confirm: true});
if (created.error) {
  // already exists: find and promote without touching the password
  const {data, error} = await db.auth.admin.listUsers({page: 1, perPage: 1000});
  if (error) throw error;
  const u = data.users.find(x => x.email?.toLowerCase() === email);
  if (!u) throw created.error;
  userId = u.id;
  console.log(`User ${email} exists — granting admin role (password unchanged).`);
} else {
  userId = created.data.user.id;
  mkdirSync('.secrets', {recursive: true});
  appendFileSync('.secrets/admin.local.txt', `${new Date().toISOString()} ${email} ${password}\n`);
  console.log(`Created ${email}. Password saved to .secrets/admin.local.txt`);
}
const {error} = await db.from('admins').upsert({user_id: userId});
if (error) throw error;
console.log('Admin role granted.');
