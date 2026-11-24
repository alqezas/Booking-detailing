/**
 * End-to-end check of both assistants on the beauty demo studios against the
 * running local stack (`pnpm functions:serve`). Prints mode, tools and answer.
 * Without LLM_API_KEY the functions answer in «no model» mode from the same
 * server tools; with LLM_BASE_URL pointing at tests/integration/fake-llm.ts the
 * tool loop is exercised with a SIMULATED model (not a real LLM check).
 *
 *   npx tsx tests/integration/beauty-assistant-check.ts
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
  console.log(`Q: ${q}\n  ${r.status} ${r.body.mode ?? ''} ${JSON.stringify(r.body.tools ?? [])} ${(r.body.text ?? r.body.message ?? '').replace(/\n/g, ' | ').slice(0, 300)}`);

let failed = 0;
const expect = (ok: boolean, what: string) => {
  if (!ok) {
    failed++;
    console.log(`  ✗ ${what}`);
  } else console.log(`  ✓ ${what}`);
};

const near = await ask('assistant', {slug: 'aura-beauty', message: 'Когда ближайшее окно на педикюр?'});
show('Когда ближайшее окно на педикюр?', near);
expect(near.status === 200 && (near.body.tools ?? []).includes('find_free_slots'), 'free slots come from find_free_slots');
const price = await ask('assistant', {slug: 'aura-beauty', message: 'Сколько стоит маникюр со снятием?'});
show('Сколько стоит маникюр со снятием?', price);
expect(/850/.test(price.body.text ?? ''), 'price with removal = 850');
const where = await ask('assistant', {slug: 'aura-beauty', message: 'Как найти студию?'});
show('Как найти студию?', where);
expect(/Vinohradská/.test(where.body.text ?? ''), 'address from the card');
const vague = await ask('assistant', {slug: 'aura-beauty', message: 'Когда ближайшее окно?'});
show('Когда ближайшее окно?', vague);
expect(vague.status === 200, 'a vague question gets an answer or a clarifying question');
const uk = await ask('assistant', {slug: 'velvet-spa', message: 'Скільки коштує класичний масаж з гарячим камінням?'});
show('[velvet] Скільки коштує класичний масаж з гарячим камінням?', uk);
expect(/1[\s ]500/.test(uk.body.text ?? ''), 'velvet: 1200 + 300');

const sb = createClient(env.API_URL!, env.ANON_KEY!, {auth: {persistSession: false}});
const {data, error} = await sb.auth.signInWithPassword({email: 'owner@aura-beauty.demo', password: DEMO_OWNER_PASSWORD});
if (error) throw error;
const token = data.session!.access_token;
for (const q of ['Кто записан на завтра?', 'Сколько свободных окон на этой неделе?', 'Сколько денег получено?']) {
  const r = await ask('owner-assistant', {slug: 'aura-beauty', message: q}, token);
  show(`[owner] ${q}`, r);
  expect(r.status === 200, `owner: ${q}`);
}
const foreign = await ask('owner-assistant', {slug: 'velvet-spa', message: 'Сколько денег получено?'}, token);
show('[owner of aura → velvet]', foreign);
expect(foreign.status === 403, 'another studio is forbidden');
const anon = await ask('owner-assistant', {slug: 'aura-beauty', message: 'Сколько денег получено?'});
expect(anon.status === 401, 'anonymous owner call is refused');
process.exit(failed ? 1 : 0);
