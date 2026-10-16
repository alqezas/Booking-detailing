import {randomBytes} from 'node:crypto';
import {appendFileSync, mkdirSync} from 'node:fs';
import path from 'node:path';
import type {SupabaseClient} from '@supabase/supabase-js';

async function findUserByEmail(admin: SupabaseClient, email: string) {
  for (let page = 1; page < 50; page++) {
    const {data, error} = await admin.auth.admin.listUsers({page, perPage: 200});
    if (error) throw error;
    const hit = data.users.find(u => u.email?.toLowerCase() === email.toLowerCase());
    if (hit) return hit;
    if (data.users.length < 200) return null;
  }
  return null;
}

/** Temporary passwords never go to the console: they land in a git-ignored file. */
export const CREDENTIALS_FILE = path.resolve(import.meta.dirname, '..', '..', '.secrets', 'owners.local.txt');
export function recordCredential(slug: string, email: string, password: string, site: string | null): void {
  mkdirSync(path.dirname(CREDENTIALS_FILE), {recursive: true});
  appendFileSync(CREDENTIALS_FILE, `${new Date().toISOString()}  ${slug}  ${email}  ${password}  ${site ? `${site}/s/${slug}/owner/` : ''}
`);
}

/**
 * Makes sure the owner account exists and is a member of the studio.
 * New accounts get either an e-mail invitation (needs SMTP in Supabase Auth)
 * or a one-time password written to CREDENTIALS_FILE.
 */
export async function ensureOwner(
  admin: SupabaseClient,
  slug: string,
  email: string,
  opts: {invite: boolean; redirectTo?: string},
): Promise<{userId: string; created: boolean; tempPassword?: string}> {
  let user = await findUserByEmail(admin, email);
  let created = false;
  let tempPassword: string | undefined;
  if (!user) {
    if (opts.invite) {
      const {data, error} = await admin.auth.admin.inviteUserByEmail(email, {redirectTo: opts.redirectTo});
      if (error) throw error;
      user = data.user;
    } else {
      tempPassword = randomBytes(12).toString('base64url');
      const {data, error} = await admin.auth.admin.createUser({email, password: tempPassword, email_confirm: true});
      if (error) throw error;
      user = data.user;
    }
    created = true;
  }
  const {error} = await admin.rpc('svc_add_member', {p_slug: slug, p_user_id: user!.id, p_role: 'owner'});
  if (error) throw error;
  return {userId: user!.id, created, tempPassword};
}
