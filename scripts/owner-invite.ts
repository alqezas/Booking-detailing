/**
 * pnpm owner:invite <slug> <email> [--local] [--invite]
 * Adds another owner (or re-links one) to a studio. No public sign-up exists.
 */
import {parseArgs} from 'node:util';
import {adminClient, loadPipelineEnv} from './lib/env.ts';
import {CREDENTIALS_FILE, ensureOwner, recordCredential} from './lib/owner.ts';

const {values, positionals} = parseArgs({allowPositionals: true, options: {local: {type: 'boolean', default: false}, invite: {type: 'boolean', default: false}}});
const [slug, email] = positionals;
if (!slug || !email) {
  console.error('✗ pnpm owner:invite <slug> <email> [--local] [--invite]');
  process.exit(1);
}
const env = loadPipelineEnv(values.local!);
const r = await ensureOwner(adminClient(env), slug, email, {invite: values.invite!, redirectTo: env.siteUrl ? `${env.siteUrl}/s/${slug}/owner/login` : undefined});
if (r.tempPassword) recordCredential(slug, email, r.tempPassword, env.siteUrl);
console.log(r.tempPassword ? `✓ ${email}: временный пароль записан в ${CREDENTIALS_FILE}` : `✓ ${email} — владелец студии ${slug}${r.created ? ' (приглашение отправлено)' : ''}`);
