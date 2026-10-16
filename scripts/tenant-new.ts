/**
 * pnpm tenant:new <slug> --name "Имя студии" [--kind detailing|autoservice]
 *                  [--accent "#4690FF"] [--timezone Europe/Moscow]
 * pnpm tenant:new <slug> --images [--force]     (re)render placeholder images only
 *
 * Creates tenants/<slug>/business.json from a template plus temporary images,
 * so the studio can be previewed immediately. Real data and photos replace
 * the placeholders; `tenant:verify --activate` refuses to go live while
 * placeholder contacts remain.
 */
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import {parseArgs} from 'node:util';
import {HEX_RE, SLUG_RE, isValidTimeZone} from '../shared/business.ts';
import {renderGallery, renderHero, renderLogo} from './lib/placeholder-art.ts';
import {ROOT, TENANTS_DIR, loadTenant, printIssues} from './lib/tenants.ts';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    name: {type: 'string'},
    kind: {type: 'string', default: 'detailing'},
    accent: {type: 'string', default: '#4690FF'},
    timezone: {type: 'string', default: 'Europe/Moscow'},
    images: {type: 'boolean', default: false},
    force: {type: 'boolean', default: false},
  },
});

const slug = positionals[0];
const fail = (msg: string): never => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

if (!slug || !SLUG_RE.test(slug)) fail('Укажите slug: латиница, цифры и дефис, например «moy-detailing»');
const dir = path.join(TENANTS_DIR, slug!);
const file = path.join(dir, 'business.json');

async function renderImages(config: {accentColor: string; name: string; images: {hero: string; logo: string}; gallery: {image: string}[]}) {
  mkdirSync(path.join(dir, 'images'), {recursive: true});
  const want = async (rel: string, render: (abs: string) => Promise<void>) => {
    const abs = path.join(dir, rel);
    if (existsSync(abs) && !values.force) return;
    mkdirSync(path.dirname(abs), {recursive: true});
    await render(abs);
    console.log(`  + ${rel} (временное изображение)`);
  };
  await want(config.images.hero, abs => renderHero(abs, config.accentColor));
  await want(config.images.logo, abs => renderLogo(abs, config.accentColor, config.name));
  for (const [i, g] of config.gallery.entries()) {
    await want(g.image, abs => renderGallery(abs, config.accentColor, i));
  }
}

if (values.images) {
  if (!existsSync(file)) fail(`Нет ${path.relative(ROOT, file)}`);
  await renderImages(JSON.parse(readFileSync(file, 'utf8')));
  process.exit(0);
}

if (existsSync(file)) fail(`Студия «${slug}» уже есть: ${path.relative(ROOT, file)}`);
if (!values.name || values.name.trim().length < 2) fail('Укажите --name "Название студии"');
if (!['detailing', 'autoservice'].includes(values.kind!)) fail('--kind: detailing или autoservice');
if (!HEX_RE.test(values.accent!)) fail('--accent: цвет в формате #RRGGBB');
if (!isValidTimeZone(values.timezone!)) fail('--timezone: часовой пояс IANA, например Europe/Moscow');

const template = JSON.parse(readFileSync(path.join(ROOT, 'scripts', 'templates', `${values.kind}.json`), 'utf8'));
const config = {
  ...template,
  slug,
  name: values.name!.trim(),
  accentColor: values.accent!.toUpperCase(),
  timezone: values.timezone,
};
mkdirSync(dir, {recursive: true});
writeFileSync(file, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log(`✓ Создан ${path.relative(ROOT, file)}`);
await renderImages(config);

const loaded = await loadTenant(slug!);
printIssues(slug!, loaded.issues);
console.log(`
Дальше:
  1. Заполните tenants/${slug}/business.json: телефон, адрес, услуги и цены, график, почту владельца.
  2. Положите фото владельца в tenants/${slug}/images/ (имена как в business.json).
  3. pnpm tenant:validate ${slug}
  4. pnpm tenant:publish ${slug} --deploy
  5. pnpm tenant:verify ${slug} --url <ссылка> [--activate]
`);
