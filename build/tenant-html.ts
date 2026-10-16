/**
 * One shared JS/CSS build, many studios.
 *
 * Dev:   /s/<slug>/… navigations get index.html with that studio's <head>.
 * Build: writes dist/s/<slug>/index.html (studio <head> + the shared bundle)
 *        and dist/s/<slug>/sw.js (the shared worker, served from the studio's
 *        own scope so installs and caches stay separate).
 */
import {copyFileSync, existsSync, readFileSync, readdirSync, writeFileSync} from 'node:fs';
import path from 'node:path';
import type {Plugin, ViteDevServer} from 'vite';

type Head = {
  slug: string;
  title: string;
  description: string;
  shortName: string;
  manifest: string;
  favicon: string;
  appleTouchIcon: string;
  heroPreload: string;
  ogImage: string;
  splash: {href: string; media: string}[];
};

const MARKER = '<!--tenant-head-->';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function renderHead(h: Head): string {
  return [
    `<title>${esc(h.title)}</title>`,
    `<meta name="description" content="${esc(h.description)}" />`,
    `<link rel="manifest" href="${h.manifest}" />`,
    `<link rel="icon" type="image/png" sizes="32x32" href="${h.favicon}" />`,
    `<link rel="apple-touch-icon" href="${h.appleTouchIcon}" />`,
    `<meta name="apple-mobile-web-app-title" content="${esc(h.shortName)}" />`,
    `<meta name="application-name" content="${esc(h.shortName)}" />`,
    `<meta property="og:type" content="website" />`,
    `<meta property="og:title" content="${esc(h.title)}" />`,
    `<meta property="og:description" content="${esc(h.description)}" />`,
    `<meta property="og:image" content="${h.ogImage}" />`,
    `<meta name="robots" content="noindex" />`,
    `<link rel="preload" as="image" href="${h.heroPreload}" fetchpriority="high" />`,
    ...h.splash.map(s => `<link rel="apple-touch-startup-image" href="${s.href}" media="${s.media}" />`),
  ].join('\n    ');
}

function readHead(root: string, slug: string): Head | null {
  const file = path.join(root, 's', slug, 'head.json');
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Head) : null;
}

export function tenantHtml(): Plugin {
  let outDir = 'dist';
  let publicDir = 'public';
  return {
    name: 'tenant-html',
    configResolved(config) {
      outDir = path.resolve(config.root, config.build.outDir);
      publicDir = config.publicDir;
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        const m = url.match(/^\/s\/([a-z0-9-]+)(\/[^?#]*)?/);
        const accept = req.headers.accept ?? '';
        if (!m || req.method !== 'GET' || !accept.includes('text/html') || /\.[a-z0-9]+$/i.test(m[2] ?? '')) return next();
        const head = readHead(publicDir, m[1]!);
        if (!head) return next();
        const template = readFileSync(path.resolve(server.config.root, 'index.html'), 'utf8').replace(MARKER, renderHead(head));
        const html = await server.transformIndexHtml(url, template);
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.end(html);
      });
    },
    closeBundle() {
      const shell = path.join(outDir, 'index.html');
      const tenantsDir = path.join(outDir, 's');
      if (!existsSync(shell) || !existsSync(tenantsDir)) return;
      const template = readFileSync(shell, 'utf8');
      const sw = path.join(outDir, 'sw.js');
      for (const slug of readdirSync(tenantsDir)) {
        const head = readHead(outDir, slug);
        if (!head) continue;
        writeFileSync(path.join(tenantsDir, slug, 'index.html'), template.replace(MARKER, renderHead(head)));
        if (existsSync(sw)) copyFileSync(sw, path.join(tenantsDir, slug, 'sw.js'));
      }
      // The bare domain gets a neutral title.
      writeFileSync(shell, template.replace(MARKER, '<title>Онлайн-запись</title>\n    <meta name="robots" content="noindex" />'));
    },
  };
}
