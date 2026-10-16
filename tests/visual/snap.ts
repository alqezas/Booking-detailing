/**
 * Full-page screenshots at fixed viewports for visual review of the layout.
 *   tsx tests/visual/snap.ts [baseURL] [outDir]
 */
import {chromium} from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results/visual';
const pages = ['/s/graphite/', '/s/graphite/services', '/s/graphite/my', '/s/severny/'];
const widths = [{w: 390, h: 844, m: true}, {w: 768, h: 1024, m: true}, {w: 1440, h: 900, m: false}];

const browser = await chromium.launch();
for (const {w, h, m} of widths) {
  const ctx = await browser.newContext({viewport: {width: w, height: h}, deviceScaleFactor: 1, isMobile: m, hasTouch: m, reducedMotion: 'reduce'});
  const page = await ctx.newPage();
  for (const p of pages) {
    await page.goto(base + p);
    await page.waitForLoadState('networkidle');
    // Bring lazy images in before the full-page shot.
    await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 600) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 120)); } window.scrollTo(0, 0); });
    await page.waitForTimeout(800);
    const name = `${out}/${w}${p.replace(/\//g, '_')}.png`;
    await page.screenshot({path: name, fullPage: true});
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(name, overflow > 0 ? `OVERFLOW ${overflow}px` : 'ok');
  }
  await ctx.close();
}
await browser.close();
