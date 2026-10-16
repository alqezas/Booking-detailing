/**
 * pnpm tenant:publish <slug> [--local] [--sync-content] [--reseed-demo] [--invite] [--deploy] [--prod]
 *
 *   1. validates tenants/<slug>/business.json and its photos;
 *   2. builds the studio's static assets (icons, manifest, media);
 *   3. upserts the studio into the database (svc_sync_tenant):
 *        new studio → status "preview" with flagged demo bookings;
 *        existing preview → content refreshed;
 *        live studio → content untouched unless --sync-content;
 *      bookings, payments and owner uploads are never touched;
 *   4. ensures the owner account and membership;
 *   5. --deploy: deploys the site with the Vercel CLI (all studios, one bundle).
 */
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {adminClient, loadPipelineEnv} from './lib/env.ts';
import {ensureOwner} from './lib/owner.ts';
import {toSyncPayload} from './lib/payload.ts';
import {ROOT, isLoaded, loadTenant, printIssues} from './lib/tenants.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    local: {type: 'boolean', default: false},
    'sync-content': {type: 'boolean', default: false},
    'reseed-demo': {type: 'boolean', default: false},
    invite: {type: 'boolean', default: false},
    deploy: {type: 'boolean', default: false},
    prod: {type: 'boolean', default: false},
  },
});
const slug = positionals[0];
if (!slug) {
  console.error('✗ pnpm tenant:publish <slug> [--local] [--deploy --prod]');
  process.exit(1);
}

const t = await loadTenant(slug);
printIssues(slug, t.issues);
if (!isLoaded(t)) {
  console.error(`✗ ${slug}: исправьте ошибки и запустите снова`);
  process.exit(1);
}

const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, {cwd: ROOT, stdio: 'inherit', shell: process.platform === 'win32'});
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run('pnpm', ['-s', 'tenant:assets', slug]);

const env = loadPipelineEnv(values.local!);
const admin = adminClient(env);
const {data, error} = await admin.rpc('svc_sync_tenant', {p_config: toSyncPayload(t.config), p_config_hash: t.hash, p_sync_content: values['sync-content']});
if (error) {
  console.error(`✗ База данных: ${error.message}`);
  process.exit(1);
}
const sync = data as {tenant_id: string; status: string; created: boolean; content_synced: boolean};
console.log(`✓ ${slug}: ${sync.created ? 'создана' : 'обновлена'} в базе, статус ${sync.status}${sync.content_synced ? '' : ' (контент live-студии не тронут; --sync-content чтобы обновить)'}`);

if (sync.status === 'preview' && (sync.created || values['reseed-demo'])) {
  const demo = await admin.rpc('svc_seed_demo_bookings', {p_slug: slug});
  if (demo.error) console.warn(`! демо-записи: ${demo.error.message}`);
  else console.log(`✓ демо-записей: ${demo.data}`);
}

const site = env.siteUrl?.replace(/\/$/, '');
try {
  const owner = await ensureOwner(admin, slug, t.config.owner.email, {invite: values.invite!, redirectTo: site ? `${site}/s/${slug}/owner/login` : undefined});
  if (owner.created && owner.tempPassword) {
    console.log(`✓ Владелец ${t.config.owner.email} создан. Временный пароль (показывается один раз): ${owner.tempPassword}`);
  } else if (owner.created) {
    console.log(`✓ Владельцу ${t.config.owner.email} отправлено приглашение на почту`);
  } else console.log(`✓ Владелец ${t.config.owner.email} привязан к студии`);
} catch (e) {
  console.warn(`! Владелец не настроен: ${(e as Error).message}`);
}

if (values.deploy) {
  run('npx', ['vercel', 'deploy', '--yes', ...(values.prod ? ['--prod'] : [])]);
}

console.log(`
Ссылка для клиентов: ${site ?? '<SITE_URL>'}/s/${slug}/
Кабинет владельца:   ${site ?? '<SITE_URL>'}/s/${slug}/owner/
Дальше: pnpm tenant:verify ${slug} --url ${site ?? '<SITE_URL>'}${values.local ? ' --local' : ''}  (и --activate, когда данные проверены)`);
