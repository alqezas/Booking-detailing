/**
 * pnpm tenant:assets [slug...]
 *
 * For every studio in tenants/ writes public/s/<slug>/:
 *   media/         optimised photos referenced by the database (/s/<slug>/media/…)
 *   icons/         192/512 icons, maskable icon, apple-touch-icon, favicon
 *   splash/        iOS startup images
 *   manifest.webmanifest   own id, start_url and scope per studio
 *   head.json      HTML metadata the build injects into /s/<slug>/index.html
 *
 * Runs before every build, so the deployed site always matches tenants/.
 */
import {mkdirSync, rmSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import type {BusinessConfig} from '../shared/business.ts';
import {mediaFileName} from '../shared/media.ts';
import {PUBLIC_TENANTS_DIR, isLoaded, listTenantSlugs, loadTenant, printIssues} from './lib/tenants.ts';

const BG = '#000000';

// Portrait startup images for current iPhones (device px, CSS px, DPR).
const SPLASH: {w: number; h: number; cw: number; ch: number; dpr: number}[] = [
  {w: 750, h: 1334, cw: 375, ch: 667, dpr: 2},
  {w: 828, h: 1792, cw: 414, ch: 896, dpr: 2},
  {w: 1125, h: 2436, cw: 375, ch: 812, dpr: 3},
  {w: 1170, h: 2532, cw: 390, ch: 844, dpr: 3},
  {w: 1179, h: 2556, cw: 393, ch: 852, dpr: 3},
  {w: 1242, h: 2688, cw: 414, ch: 896, dpr: 3},
  {w: 1284, h: 2778, cw: 428, ch: 926, dpr: 3},
  {w: 1290, h: 2796, cw: 430, ch: 932, dpr: 3},
  {w: 1320, h: 2868, cw: 440, ch: 956, dpr: 3},
];

const escapeXml = (s: string) => s.replace(/[<>&'"]/g, c => ({'<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;'})[c]!);

async function iconOnBlack(src: string, size: number, inner: number, out: string): Promise<void> {
  const logo = await sharp(src).resize(Math.round(size * inner), Math.round(size * inner), {fit: 'contain', background: BG}).toBuffer();
  await sharp({create: {width: size, height: size, channels: 4, background: BG}})
    .composite([{input: logo, gravity: 'center'}])
    .png()
    .toFile(out);
}

async function buildTenant(slug: string, dir: string, c: BusinessConfig): Promise<void> {
  const outDir = path.join(PUBLIC_TENANTS_DIR, slug);
  rmSync(outDir, {recursive: true, force: true});
  for (const sub of ['media', 'icons', 'splash']) mkdirSync(path.join(outDir, sub), {recursive: true});
  const base = `/s/${slug}`;

  // Photos
  const hero = path.join(dir, c.images.hero);
  await sharp(hero).rotate().resize({width: 1800, withoutEnlargement: true}).webp({quality: 80}).toFile(path.join(outDir, 'media', mediaFileName(c.images.hero)));
  await sharp(hero).rotate().resize(1200, 630, {fit: 'cover'}).jpeg({quality: 82}).toFile(path.join(outDir, 'media', 'og.jpg'));
  for (const g of c.gallery) {
    await sharp(path.join(dir, g.image)).rotate().resize({width: 1400, withoutEnlargement: true}).webp({quality: 78}).toFile(path.join(outDir, 'media', mediaFileName(g.image)));
  }
  const logo = path.join(dir, c.images.logo);
  await sharp(logo).resize(512, 512, {fit: 'contain', background: BG}).png().toFile(path.join(outDir, 'media', mediaFileName(c.images.logo)));

  // Icons
  const iconSrc = path.join(dir, c.images.icon ?? c.images.logo);
  await iconOnBlack(iconSrc, 192, 0.92, path.join(outDir, 'icons', 'icon-192.png'));
  await iconOnBlack(iconSrc, 512, 0.92, path.join(outDir, 'icons', 'icon-512.png'));
  await iconOnBlack(iconSrc, 512, 0.72, path.join(outDir, 'icons', 'maskable-512.png')); // safe zone = inner 80%
  await iconOnBlack(iconSrc, 180, 0.86, path.join(outDir, 'icons', 'apple-touch-icon.png'));
  await iconOnBlack(iconSrc, 32, 1, path.join(outDir, 'icons', 'favicon-32.png'));

  // iOS startup images: logo + name on black
  const logoBuf = await sharp(iconSrc).resize(360, 360, {fit: 'contain', background: BG}).png().toBuffer();
  const splashLinks: {href: string; media: string}[] = [];
  for (const s of SPLASH) {
    const logoSize = Math.round(s.w * 0.28);
    const scaled = await sharp(logoBuf).resize(logoSize, logoSize).toBuffer();
    const text = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${s.w}" height="${Math.round(s.w * 0.12)}"><text x="50%" y="70%" text-anchor="middle" font-family="Arial, Helvetica, sans-serif" font-weight="700" font-size="${Math.round(s.w * 0.055)}" fill="#ffffff">${escapeXml(c.name)}</text></svg>`,
    );
    const file = `splash-${s.w}x${s.h}.png`;
    await sharp({create: {width: s.w, height: s.h, channels: 4, background: BG}})
      .composite([
        {input: scaled, top: Math.round(s.h * 0.4 - logoSize / 2), left: Math.round((s.w - logoSize) / 2)},
        {input: text, top: Math.round(s.h * 0.4 + logoSize / 2 + s.w * 0.04), left: 0},
      ])
      .png({compressionLevel: 9})
      .toFile(path.join(outDir, 'splash', file));
    splashLinks.push({
      href: `${base}/splash/${file}`,
      media: `(device-width: ${s.cw}px) and (device-height: ${s.ch}px) and (-webkit-device-pixel-ratio: ${s.dpr}) and (orientation: portrait)`,
    });
  }

  const shortName = c.shortName ?? (c.name.length <= 14 ? c.name : c.name.split(/\s+/)[0]!.slice(0, 14));
  const description = c.tagline || `Онлайн-запись: ${c.name}`;
  const manifest = {
    id: `${base}/`,
    name: c.name,
    short_name: shortName,
    description,
    lang: 'ru',
    dir: 'ltr',
    start_url: `${base}/?source=pwa`,
    scope: `${base}/`,
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    orientation: 'portrait',
    background_color: BG,
    theme_color: BG,
    categories: ['lifestyle', 'business'],
    icons: [
      {src: `${base}/icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any'},
      {src: `${base}/icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any'},
      {src: `${base}/icons/maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable'},
    ],
    shortcuts: [
      {name: 'Записаться', url: `${base}/?book=1`, icons: [{src: `${base}/icons/icon-192.png`, sizes: '192x192'}]},
      {name: 'Моя запись', url: `${base}/my`, icons: [{src: `${base}/icons/icon-192.png`, sizes: '192x192'}]},
    ],
  };
  writeFileSync(path.join(outDir, 'manifest.webmanifest'), JSON.stringify(manifest, null, 2));

  const head = {
    slug,
    title: `${c.name} — онлайн-запись`,
    description,
    shortName,
    manifest: `${base}/manifest.webmanifest`,
    favicon: `${base}/icons/favicon-32.png`,
    appleTouchIcon: `${base}/icons/apple-touch-icon.png`,
    heroPreload: `${base}/media/${mediaFileName(c.images.hero)}`,
    ogImage: `${base}/media/og.jpg`,
    splash: splashLinks,
  };
  writeFileSync(path.join(outDir, 'head.json'), JSON.stringify(head, null, 2));
}

const {positionals} = parseArgs({allowPositionals: true, options: {}});
const slugs = positionals.length ? positionals : listTenantSlugs();
let failed = false;
for (const slug of slugs) {
  const t = await loadTenant(slug);
  if (!isLoaded(t)) {
    failed = true;
    console.log(`✗ ${slug}: настройки с ошибками, ресурсы не собраны`);
    printIssues(slug, t.issues);
    continue;
  }
  await buildTenant(slug, t.dir, t.config);
  console.log(`✓ ${slug}: иконки, манифест, заставки, фото → public/s/${slug}/`);
}
process.exit(failed ? 1 : 0);
