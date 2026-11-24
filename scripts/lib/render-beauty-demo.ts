/**
 * Renders the temporary beauty images a business.json refers to (hero, logo,
 * works, master portraits). Existing files are kept unless `force`.
 * CLI: npx tsx scripts/lib/render-beauty-demo.ts <slug> <nails|massage|hair> [--force]
 */
import {existsSync, mkdirSync, readFileSync} from 'node:fs';
import path from 'node:path';
import {renderBeautyHero, renderBeautyLogo, renderBeautyWork, renderPortrait, type BeautyTheme} from './beauty-art.ts';
import {TENANTS_DIR} from './tenants.ts';

export async function renderBeautyImages(slug: string, theme: BeautyTheme, force = false): Promise<string[]> {
  const dir = path.join(TENANTS_DIR, slug);
  const c = JSON.parse(readFileSync(path.join(dir, 'business.json'), 'utf8'));
  const made: string[] = [];
  const want = async (rel: string, render: (abs: string) => Promise<void>) => {
    const abs = path.join(dir, rel);
    if (existsSync(abs) && !force) return;
    mkdirSync(path.dirname(abs), {recursive: true});
    await render(abs);
    made.push(rel);
  };
  await want(c.images.hero, f => renderBeautyHero(f, c.accentColor, theme));
  await want(c.images.logo, f => renderBeautyLogo(f, c.accentColor, c.name));
  for (const [i, g] of (c.gallery as {image: string}[]).entries()) await want(g.image, f => renderBeautyWork(f, c.accentColor, i, theme));
  for (const [i, r] of (c.resources as {photo?: string}[]).entries()) if (r.photo) await want(r.photo, f => renderPortrait(f, c.accentColor, i));
  return made;
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/lib/render-beauty-demo.ts')) {
  const [slug, theme = 'nails'] = process.argv.slice(2).filter(a => !a.startsWith('--'));
  if (!slug) throw new Error('usage: render-beauty-demo.ts <slug> <nails|massage|hair>');
  const made = await renderBeautyImages(slug, theme as BeautyTheme, process.argv.includes('--force'));
  console.log(made.map(m => `  + ${m} (временное изображение)`).join('\n') || '  все изображения уже есть');
}
