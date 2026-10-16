/**
 * pnpm tenant:verify <slug> --url <site> [--local] [--activate]
 *
 * Checks the PUBLISHED link the way a phone would: studio HTML and deep link,
 * manifest (own id/start_url/scope), icons, worker, hero photo, the public
 * studio card and free slots from the database. With --activate, and only if
 * every check passes and business.json has no placeholders, switches the
 * studio from preview to live (demo bookings are removed).
 */
import {parseArgs} from 'node:util';
import {createClient} from '@supabase/supabase-js';
import {findPlaceholders} from '../shared/business.ts';
import {adminClient, loadPipelineEnv} from './lib/env.ts';
import {isLoaded, loadTenant} from './lib/tenants.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {url: {type: 'string'}, local: {type: 'boolean', default: false}, activate: {type: 'boolean', default: false}},
});
const slug = positionals[0];
const env = loadPipelineEnv(values.local!);
const site = (values.url ?? env.siteUrl ?? '').replace(/\/$/, '');
if (!slug || !site) {
  console.error('✗ pnpm tenant:verify <slug> --url https://ваш-сайт [--activate]');
  process.exit(1);
}

type Check = {name: string; ok: boolean; detail?: string};
const checks: Check[] = [];
const check = async (name: string, fn: () => Promise<string | void>) => {
  try {
    const detail = await fn();
    checks.push({name, ok: true, detail: detail || undefined});
  } catch (e) {
    checks.push({name, ok: false, detail: (e as Error).message});
  }
};
const get = async (path: string, accept = '*/*') => {
  const r = await fetch(`${site}${path}`, {headers: {accept}, redirect: 'follow'});
  if (!r.ok) throw new Error(`${path} → HTTP ${r.status}`);
  return r;
};
const assert = (cond: unknown, msg: string) => {
  if (!cond) throw new Error(msg);
};

const t = await loadTenant(slug);
const name = t.config?.name ?? slug;

await check('Страница студии', async () => {
  const html = await (await get(`/s/${slug}/`, 'text/html')).text();
  assert(html.includes(`/s/${slug}/manifest.webmanifest`), 'нет ссылки на манифест студии');
  assert(html.includes('<title>') && html.includes(name.replace(/&/g, '&amp;')), 'в <title> нет названия студии');
  assert(html.includes('apple-touch-icon'), 'нет apple-touch-icon');
});
await check('Адрес внутри области приложения', async () => {
  const r = await fetch(`${site}/s/${slug}/`, {redirect: 'manual'});
  assert(r.status === 200, `/s/${slug}/ отвечает ${r.status} ${r.headers.get('location') ?? ''} — start_url окажется вне scope`);
  const bare = await fetch(`${site}/s/${slug}`, {redirect: 'manual'});
  assert(bare.status === 200 || bare.headers.get('location')?.endsWith(`/s/${slug}/`), 'адрес без слеша не ведёт в область приложения');
});
await check('Глубокая ссылка /services', async () => {
  const html = await (await get(`/s/${slug}/services`, 'text/html')).text();
  assert(html.includes(`/s/${slug}/manifest.webmanifest`), 'отдана не та оболочка');
});
let icons: {src: string; purpose?: string}[] = [];
await check('Манифест', async () => {
  const m = await (await get(`/s/${slug}/manifest.webmanifest`)).json();
  assert(m.id === `/s/${slug}/` && m.scope === `/s/${slug}/`, `id/scope: ${m.id} ${m.scope}`);
  assert(String(m.start_url).startsWith(`/s/${slug}/`), `start_url: ${m.start_url}`);
  assert(m.display === 'standalone', 'display не standalone');
  icons = m.icons;
  assert(icons.some(i => i.purpose === 'maskable'), 'нет maskable-иконки');
  return `${m.name}, ${icons.length} иконки`;
});
await check('Иконки', async () => {
  for (const i of [...icons, {src: `/s/${slug}/icons/apple-touch-icon.png`}]) {
    const r = await get(i.src);
    assert(r.headers.get('content-type')?.startsWith('image/'), `${i.src}: не изображение`);
  }
});
await check('Service worker', async () => {
  const r = await get(`/s/${slug}/sw.js`);
  assert(/javascript/.test(r.headers.get('content-type') ?? ''), 'sw.js отдан не как JavaScript');
  const body = await r.text();
  assert(body.includes('precache') || body.includes('workbox'), 'это не наш воркер');
});

const anon = createClient(env.url, env.anonKey, {auth: {persistSession: false}});
let status = 'unknown';
await check('Данные студии в базе', async () => {
  const {data, error} = await anon.rpc('public_get_tenant', {p_slug: slug}, {get: true});
  if (error) throw new Error(error.message);
  status = data.status;
  assert(data.services.length > 0, 'нет активных услуг');
  const hero = await get(data.hero_path.startsWith('/') ? data.hero_path : `/s/${slug}/`);
  assert(hero.ok, 'главное фото недоступно');
  const slots = await anon.rpc('public_get_availability', {p_slug: slug, p_service_id: data.services[0].id, p_days: 7});
  if (slots.error) throw new Error(slots.error.message);
  const free = slots.data.days.reduce((n: number, d: {slots: {available: boolean}[]}) => n + d.slots.filter(s => s.available).length, 0);
  return `статус ${data.status}, услуг ${data.services.length}, свободных слотов на неделю: ${free}`;
});

for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
const failed = checks.filter(c => !c.ok).length;

if (values.activate) {
  const blockers: string[] = [];
  if (failed) blockers.push(`${failed} проверок не пройдено`);
  if (!isLoaded(t)) blockers.push('business.json с ошибками');
  else blockers.push(...findPlaceholders(t.config).map(p => `заглушка в ${p}`));
  if (blockers.length) {
    console.error(`✗ Активация отменена: ${blockers.join('; ')}`);
    process.exit(1);
  }
  if (status === 'live') console.log('✓ Студия уже работает в боевом режиме');
  else {
    const {data, error} = await adminClient(env).rpc('svc_activate_tenant', {p_slug: slug});
    if (error) {
      console.error(`✗ ${error.message}`);
      process.exit(1);
    }
    console.log(`✓ Студия переведена в боевой режим, демо-записей удалено: ${data.demo_bookings_removed}`);
  }
}
console.log(`\n${failed ? '✗' : '✓'} ${site}/s/${slug}/`);
process.exit(failed ? 1 : 0);
