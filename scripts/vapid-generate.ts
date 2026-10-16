/**
 * pnpm vapid:generate — prints a VAPID key pair for Web Push.
 *   VAPID_PUBLIC_KEY  → .env (VITE_VAPID_PUBLIC_KEY) and Edge Function secrets
 *   VAPID_PRIVATE_KEY → Edge Function secrets only (never the site)
 * With --write it fills supabase/functions/.env and .env.local for local development.
 */
import {existsSync, readFileSync, writeFileSync} from 'node:fs';
import webpush from 'web-push';

const keys = webpush.generateVAPIDKeys();

function upsert(file: string, pairs: Record<string, string>): void {
  let text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  for (const [k, v] of Object.entries(pairs)) {
    const line = `${k}=${v}`;
    text = new RegExp(`^${k}=.*$`, 'm').test(text) ? text.replace(new RegExp(`^${k}=.*$`, 'm'), line) : `${text.replace(/\n?$/, '\n')}${line}\n`;
  }
  writeFileSync(file, text);
}

if (process.argv.includes('--write')) {
  upsert('supabase/functions/.env', {VAPID_PUBLIC_KEY: keys.publicKey, VAPID_PRIVATE_KEY: keys.privateKey});
  upsert('.env.local', {VITE_VAPID_PUBLIC_KEY: keys.publicKey});
  console.log('✓ VAPID keys written to supabase/functions/.env and .env.local (both git-ignored)');
} else {
  console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}\nVAPID_PRIVATE_KEY=${keys.privateKey}`);
}
