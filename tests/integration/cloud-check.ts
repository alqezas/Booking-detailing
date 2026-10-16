/**
 * Smoke check of the deployed stack (.env.publish): both assistants, owner
 * isolation, the dispatcher secret. Uses the owner password stored by
 * tenant:publish in .secrets/owners.local.txt and never prints it.
 *   tsx tests/integration/cloud-check.ts
 */
import {readFileSync} from 'node:fs';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.publish');
const {SUPABASE_URL: url, SUPABASE_ANON_KEY: anon} = process.env;
const fn = `${url}/functions/v1`;
const ask = async (name: string, body: unknown, token = anon!) => {
  const r = await fetch(`${fn}/${name}`, {method: 'POST', headers: {apikey: anon!, authorization: `Bearer ${token}`, 'content-type': 'application/json', origin: process.env.SITE_URL ?? ''}, body: JSON.stringify(body)});
  const j = (await r.json().catch(() => ({}))) as {mode?: string; tools?: string[]; text?: string; message?: string};
  return `${r.status} ${j.mode ?? ''} ${JSON.stringify(j.tools ?? [])} ${(j.text ?? j.message ?? '').replace(/\n/g, ' | ').slice(0, 200)}`;
};
for (const q of ['Когда ближайшее окно на мойку?', 'Сколько стоит полировка?', 'Как найти студию?']) console.log('client:', q, '→', await ask('assistant', {slug: 'graphite', message: q}));
const line = readFileSync('.secrets/owners.local.txt', 'utf8').trim().split('\n').reverse().find(l => l.includes(' graphite '));
const [, , email, password] = line!.split(/\s{2}/);
const sb = createClient(url!, anon!, {auth: {persistSession: false}});
const {data, error} = await sb.auth.signInWithPassword({email: email!, password: password!});
if (error) throw error;
const t = data.session!.access_token;
for (const q of ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?']) console.log('owner:', q, '→', await ask('owner-assistant', {slug: 'graphite', message: q}, t));
console.log('owner→other studio:', await ask('owner-assistant', {slug: 'severny', message: 'Сколько денег?'}, t));
console.log('anon→owner fn:', await ask('owner-assistant', {slug: 'graphite', message: 'деньги'}));
const d = await fetch(`${fn}/notify-dispatch`, {method: 'POST', headers: {'x-cron-secret': 'wrong'}});
console.log('dispatch wrong secret:', d.status);
const own = await sb.from('bookings').select('tenant_id').limit(500);
console.log('owner sees bookings of tenants:', [...new Set((own.data ?? []).map((b: {tenant_id: string}) => b.tenant_id))].length);
