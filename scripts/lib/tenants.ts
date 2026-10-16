import {createHash} from 'node:crypto';
import {existsSync, readdirSync, readFileSync, statSync} from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import {businessSchema, findPlaceholders, type BusinessConfig} from '../../shared/business.ts';
import {mediaFileName} from '../../shared/media.ts';

export const ROOT = path.resolve(import.meta.dirname, '..', '..');
export const TENANTS_DIR = path.join(ROOT, 'tenants');
export const PUBLIC_TENANTS_DIR = path.join(ROOT, 'public', 's');

export type Issue = {level: 'error' | 'warning'; path: string; message: string};

export type LoadedTenant = {
  slug: string;
  dir: string;
  config: BusinessConfig;
  /** sha256 of business.json plus every referenced image: changes when anything visible changes. */
  hash: string;
  issues: Issue[];
};

export function listTenantSlugs(): string[] {
  if (!existsSync(TENANTS_DIR)) return [];
  return readdirSync(TENANTS_DIR)
    .filter(name => existsSync(path.join(TENANTS_DIR, name, 'business.json')))
    .sort();
}

export function imagePaths(config: BusinessConfig): string[] {
  return [
    config.images.hero,
    config.images.logo,
    ...(config.images.icon ? [config.images.icon] : []),
    ...config.gallery.map(g => g.image),
  ];
}

/** Parse + validate a tenant folder. Never throws for content problems: they are returned as issues. */
export async function loadTenant(slug: string): Promise<LoadedTenant | {slug: string; dir: string; config: null; issues: Issue[]}> {
  const dir = path.join(TENANTS_DIR, slug);
  const file = path.join(dir, 'business.json');
  const issues: Issue[] = [];
  if (!existsSync(file)) {
    return {slug, dir, config: null, issues: [{level: 'error', path: file, message: 'Нет файла business.json'}]};
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    return {slug, dir, config: null, issues: [{level: 'error', path: 'business.json', message: `Не JSON: ${(e as Error).message}`}]};
  }
  const parsed = businessSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({level: 'error', path: issue.path.join('.') || '(root)', message: issue.message});
    }
    return {slug, dir, config: null, issues};
  }
  const config = parsed.data;
  if (config.slug !== slug) {
    issues.push({level: 'error', path: 'slug', message: `slug «${config.slug}» не совпадает с папкой «${slug}»`});
  }

  const hash = createHash('sha256').update(readFileSync(file));
  for (const rel of imagePaths(config)) {
    const abs = path.resolve(dir, rel);
    if (!abs.startsWith(dir + path.sep)) {
      issues.push({level: 'error', path: rel, message: 'Путь к изображению выходит за папку студии'});
      continue;
    }
    if (!existsSync(abs)) {
      issues.push({level: 'error', path: rel, message: 'Файл не найден'});
      continue;
    }
    hash.update(rel).update(readFileSync(abs));
    try {
      const meta = await sharp(abs).metadata();
      if (rel === config.images.hero && (meta.width ?? 0) < 1200) {
        issues.push({level: 'warning', path: rel, message: `Главное фото узкое (${meta.width}px), лучше от 1600px`});
      }
      if (rel === config.images.logo && Math.abs((meta.width ?? 0) - (meta.height ?? 0)) > 2) {
        issues.push({level: 'warning', path: rel, message: 'Логотип не квадратный — иконка будет с полями'});
      }
      if (rel === config.images.logo && (meta.width ?? 0) < 512) {
        issues.push({level: 'error', path: rel, message: 'Логотип меньше 512×512 — иконка будет размытой'});
      }
      if (statSync(abs).size > 8 * 1024 * 1024) {
        issues.push({level: 'error', path: rel, message: 'Файл больше 8 МБ'});
      }
    } catch {
      issues.push({level: 'error', path: rel, message: 'Не удаётся прочитать изображение'});
    }
  }

  const names = new Map<string, string>();
  for (const rel of imagePaths(config)) {
    const out = mediaFileName(rel);
    if (names.has(out) && names.get(out) !== rel) {
      issues.push({level: 'error', path: rel, message: `Имя файла совпадает с ${names.get(out)} после конвертации`});
    }
    names.set(out, rel);
  }

  for (const p of findPlaceholders(config)) {
    issues.push({level: 'warning', path: p, message: 'Значение-заглушка: перед запуском замените реальными данными'});
  }

  return {slug, dir, config, hash: hash.digest('hex'), issues};
}

export function isLoaded(t: Awaited<ReturnType<typeof loadTenant>>): t is LoadedTenant {
  return t.config !== null && !t.issues.some(i => i.level === 'error');
}

export function printIssues(slug: string, issues: Issue[]): void {
  for (const i of issues) {
    const mark = i.level === 'error' ? '✗' : '!';
    console.log(`  ${mark} ${slug}: ${i.path} — ${i.message}`);
  }
}
