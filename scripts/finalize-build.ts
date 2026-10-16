/**
 * Runs after `vite build` (the service worker is built last by vite-plugin-pwa).
 * Copies dist/sw.js into every studio scope and fails the build if any studio
 * is missing its shell, manifest, icons or worker.
 */
import {copyFileSync, existsSync, readdirSync, readFileSync} from 'node:fs';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '..', 'dist');
const sw = path.join(dist, 'sw.js');
if (!existsSync(sw)) {
  console.error('✗ dist/sw.js was not built');
  process.exit(1);
}
const swText = readFileSync(sw, 'utf8');
if (/"url":"assets\//.test(swText)) {
  console.error('✗ precache URLs are relative; they would break inside /s/<slug>/');
  process.exit(1);
}

let failed = false;
for (const slug of readdirSync(path.join(dist, 's'))) {
  const dir = path.join(dist, 's', slug);
  copyFileSync(sw, path.join(dir, 'sw.js'));
  const required = ['index.html', 'manifest.webmanifest', 'sw.js', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'];
  const missing = required.filter(f => !existsSync(path.join(dir, f)));
  const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.webmanifest'), 'utf8'));
  const html = readFileSync(path.join(dir, 'index.html'), 'utf8');
  if (manifest.scope !== `/s/${slug}/` || manifest.id !== `/s/${slug}/`) missing.push('manifest scope/id');
  if (!html.includes(`/s/${slug}/manifest.webmanifest`)) missing.push('manifest link in HTML');
  if (missing.length) {
    failed = true;
    console.error(`✗ ${slug}: ${missing.join(', ')}`);
  } else console.log(`✓ ${slug}: shell, manifest, icons, worker`);
}
process.exit(failed ? 1 : 0);
