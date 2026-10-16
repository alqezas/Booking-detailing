/**
 * pnpm tenant:validate [slug...]   — all studios when no slug is given.
 * Exit code 1 if any studio has errors. Warnings (placeholders, small
 * photos) do not fail validation but block `tenant:verify --activate`.
 */
import {parseArgs} from 'node:util';
import {listTenantSlugs, loadTenant, printIssues} from './lib/tenants.ts';

const {positionals} = parseArgs({allowPositionals: true, options: {}});
const slugs = positionals.length ? positionals : listTenantSlugs();
if (!slugs.length) {
  console.error('✗ В папке tenants/ нет студий');
  process.exit(1);
}

let failed = false;
for (const slug of slugs) {
  const t = await loadTenant(slug);
  const errors = t.issues.filter(i => i.level === 'error').length;
  const warnings = t.issues.length - errors;
  if (errors) failed = true;
  const summary = t.config
    ? `${t.config.name}: ${t.config.services.length} услуг, ${t.config.resources.length} бокс(ов), ${t.config.gallery.length} фото`
    : 'не прочитан';
  console.log(`${errors ? '✗' : '✓'} ${slug} — ${summary}${warnings ? `, предупреждений: ${warnings}` : ''}`);
  printIssues(slug, t.issues);
}
process.exit(failed ? 1 : 0);
