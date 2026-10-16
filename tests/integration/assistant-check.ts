/**
 * Manual end-to-end check of both assistants against the running local stack
 * (`supabase functions serve`). Prints mode, tools used and the answer.
 *
 *   tsx tests/integration/assistant-check.ts
 *
 * Uses the local demo owner from supabase/seed.sql (local only).
 */
import {execSync} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {DEMO_OWNER_PASSWORD} from '../../scripts/lib/demo.ts';

const env = Object.fromEntries(
  execSync('npx supabase status -o env', {encoding: 'utf8'})
    .split('\n')
    .map(l => l.match(/^([A-Z_]+)="?([^"]*)"?$/))
    .filter(Boolean)
    .map(m => [m![1], m![2]]),
);
const fn = `${env.API_URL}/functions/v1`;

async function ask(name: string, body: unknown, token = env.ANON_KEY!) {
  const r = await fetch(`${fn}/${name}`, {
    method: 'POST',
    headers: {apikey: env.ANON_KEY!, authorization: `Bearer ${token}`, 'content-type': 'application/json'},
    body: JSON.stringify(body),
  });
  return {status: r.status, body: (await r.json()) as {mode?: string; tools?: string[]; text?: string; message?: string}};
}

const show = (q: string, r: Awaited<ReturnType<typeof ask>>) =>
  console.log(`Q: ${q}\n  ${r.status} ${r.body.mode ?? ''} ${JSON.stringify(r.body.tools ?? [])} ${(r.body.text ?? r.body.message ?? '').replace(/\n/g, ' | ').slice(0, 260)}`);

for (const q of ['Когда ближайшее окно на мойку?', 'Сколько стоит полировка?', 'Как найти студию?']) {
  show(q, await ask('assistant', {slug: 'graphite', message: q}));
}

const sb = createClient(env.API_URL!, env.ANON_KEY!, {auth: {persistSession: false}});
const {data, error} = await sb.auth.signInWithPassword({email: 'owner@graphite.demo', password: DEMO_OWNER_PASSWORD});
if (error) throw error;
const token = data.session!.access_token;
for (const q of ['Что у меня завтра?', 'Сколько машин было на неделе?', 'Сколько денег получено?']) {
  show(`[owner] ${q}`, await ask('owner-assistant', {slug: 'graphite', message: q}, token));
}
show('[owner of graphite → severny]', await ask('owner-assistant', {slug: 'severny', message: 'Сколько денег получено?'}, token));
show('[anonymous → owner-assistant]', await ask('owner-assistant', {slug: 'graphite', message: 'Сколько денег получено?'}));
