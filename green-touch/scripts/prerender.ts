/**
 * Static head prerender for the Vite SPA (runs after `vite build`).
 * For every public page it writes a copy of dist/index.html with its own
 * <title>, description, canonical, Open Graph and (for products and kits)
 * Product structured data with the real current price — so crawlers and link
 * previews see correct metadata without JavaScript. The page body is still
 * rendered in the browser (documented limitation in SETUP.md).
 *
 * Output uses `<path>.html` files: Vercel (`cleanUrls`) and Cloudflare Pages
 * both serve /tovar/slug from tovar/slug.html. Also writes sitemap.xml and
 * robots.txt. Without database access it keeps the SPA shell only.
 */
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {createClient} from '@supabase/supabase-js';

const dist = 'dist';
const site = (process.env.VITE_SITE_URL ?? '').replace(/\/$/, '');
const url = process.env.VITE_SUPABASE_URL;
const key = process.env.VITE_SUPABASE_ANON_KEY;
const shell = readFileSync(join(dist, 'index.html'), 'utf8');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const uah = (kop: number) => (kop / 100).toFixed(2);

type Page = {path: string; title: string; description: string; image?: string | null; jsonLd?: unknown};

function render(p: Page): string {
  const full = p.title === 'Green Touch' ? p.title : `${p.title} — Green Touch`;
  const canonical = site ? `${site}${p.path}` : null;
  const head = [
    `<meta property="og:title" content="${esc(full)}" />`,
    `<meta property="og:description" content="${esc(p.description)}" />`,
    canonical ? `<link rel="canonical" href="${esc(canonical)}" />` : '',
    canonical ? `<meta property="og:url" content="${esc(canonical)}" />` : '',
    p.image ? `<meta property="og:image" content="${esc(p.image)}" />` : '',
    p.jsonLd ? `<script type="application/ld+json" data-ld="page">${JSON.stringify(p.jsonLd).replace(/</g, '\\u003c')}</script>` : '',
  ]
    .filter(Boolean)
    .join('\n    ');
  return shell
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(full)}</title>`)
    .replace(/<meta name="description" content="[^"]*" \/>/, `<meta name="description" content="${esc(p.description)}" />`)
    .replace('<!--prerender-head-->', head);
}

function write(path: string, html: string) {
  const file = path === '/' ? join(dist, 'index.html') : join(dist, `${path.slice(1)}.html`);
  mkdirSync(dirname(file), {recursive: true});
  writeFileSync(file, html);
}

const pages: Page[] = [
  {path: '/', title: 'Green Touch', description: 'Косметика власного виробництва, створена косметологом: креми, сироватки, тоніки, очищення, маски, набори догляду. Доставка Новою поштою.', jsonLd: {'@context': 'https://schema.org', '@type': 'Organization', name: 'Green Touch', ...(site ? {url: site} : {})}},
  {path: '/katalog', title: 'Каталог', description: 'Каталог косметики Green Touch: фільтри за типом і потребами шкіри, ціни в гривнях.'},
];

if (url && key) {
  try {
    const db = createClient(url, key, {auth: {persistSession: false}});
    const meta = (await db.rpc('catalog_meta')).data as {pages: {slug: string; title: string}[]} | null;
    for (const p of meta?.pages ?? []) pages.push({path: `/${p.slug}`, title: p.title, description: `${p.title} — інтернет-магазин Green Touch.`});
    for (let page = 1; page < 50; page++) {
      const {data} = await db.rpc('catalog_search', {p_page: page, p_page_size: 48, p_sort: 'new'});
      const r = data as {total: number; items: {kind: string; slug: string}[]} | null;
      if (!r?.items.length) break;
      for (const c of r.items) {
        const {data: it} = await db.rpc('catalog_item', {p_slug: c.slug});
        if (!it) continue;
        const image = it.images?.[0]?.path ? `${url}/storage/v1/object/public/catalog/${it.images[0].path}` : null;
        const path = it.kind === 'kit' ? `/nabir/${it.slug}` : `/tovar/${it.slug}`;
        pages.push({
          path,
          title: it.name,
          description: `${it.name}${it.volume ? `, ${it.volume}` : ''} — ${uah(it.price_kop)} грн. ${it.short_purpose ?? (it.description ?? '').slice(0, 120)}`.trim(),
          image,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'Product',
            name: it.name,
            brand: {'@type': 'Brand', name: 'Green Touch'},
            ...(image ? {image: [image]} : {}),
            ...(it.description ? {description: it.description} : {}),
            // real current price and availability; no ratings or reviews (none exist)
            offers: {'@type': 'Offer', priceCurrency: 'UAH', price: uah(it.price_kop), availability: it.available ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock', ...(site ? {url: site + path} : {})},
          },
        });
      }
      if (page * 48 >= r.total) break;
    }
  } catch (e) {
    console.warn('prerender: catalog not reachable, only static pages are prerendered:', e instanceof Error ? e.message : e);
  }
} else {
  console.warn('prerender: VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY not set — catalog pages are not prerendered');
}

for (const p of pages) write(p.path, render(p));
if (site) {
  const urls = pages.map(p => `  <url><loc>${esc(site + p.path)}</loc></url>`).join('\n');
  writeFileSync(join(dist, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
  writeFileSync(join(dist, 'robots.txt'), `${readFileSync('public/robots.txt', 'utf8').trim()}\nSitemap: ${site}/sitemap.xml\n`);
}
console.log(`prerender: ${pages.length} pages${site ? ', sitemap.xml' : ' (no VITE_SITE_URL: no sitemap)'}`);
