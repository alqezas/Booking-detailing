/**
 * JH Auto Detailing cabinet in Czech: sign in as the local demo owner (seed
 * only), open every section, fail on any Russian text (local stack only).
 *   tsx tests/visual/czech-owner.ts [baseURL] [outDir]
 */
import {chromium, type Page} from '@playwright/test';
import {DEMO_OWNER_PASSWORD} from '../../scripts/lib/demo.ts';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results/visual';
const browser = await chromium.launch();
const page = await (await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce'})).newPage();
page.setDefaultTimeout(20_000);

const russian = async (p: Page, where: string) => {
  await p.waitForTimeout(500);
  const found = await p.evaluate(() => document.body.innerText.match(/[А-Яа-яЁё]+/g) ?? []);
  if (found.length) throw new Error(`Russian text on ${where}: ${found.slice(0, 10).join(', ')}`);
  console.log(`✓ ${where}: Czech only`);
};

const s = `${base}/s/jh-auto-detailing/owner`;
await page.goto(`${s}/login`);
await page.getByLabel('E-mail').fill('owner@example.com');
await page.getByLabel('Heslo').fill(DEMO_OWNER_PASSWORD);
await page.getByRole('button', {name: 'Přihlásit se'}).click();
await page.getByRole('heading', {name: 'Rezervace', level: 1}).waitFor();
await russian(page, 'bookings');
await page.screenshot({path: `${out}/cs-owner-bookings.png`});
await page.getByRole('link', {name: 'Tržby'}).click();
await page.getByRole('heading', {name: 'Tržby a příjezdy'}).waitFor();
await russian(page, 'stats');
await page.getByRole('link', {name: 'Nastavení'}).click();
await page.getByRole('heading', {name: 'Nastavení'}).waitFor();
await page.waitForTimeout(500);
for (const tab of ['Studio', 'Služby', 'Boxy', 'Otevírací doba', 'Hlavní stránka', 'Fotky prací']) {
  await page.locator('main').getByText(tab, {exact: true}).first().click();
  await russian(page, `settings › ${tab}`);
  if (tab === 'Fotky prací') await page.screenshot({path: `${out}/cs-owner-gallery.png`, fullPage: true});
}
await page.getByRole('link', {name: 'Asistent'}).click();
await page.waitForTimeout(2000); await page.screenshot({path: `${out}/cs-owner-assistant-empty.png`}); console.log(await page.evaluate(() => { const m = document.querySelector('main'); const c = m?.firstElementChild as HTMLElement; return [m?.getBoundingClientRect().height, c?.getBoundingClientRect().height, c?.style.height]; }));
await page.getByRole('button', {name: 'Co mám zítra?'}).click();
await page.getByText(/rezervac/i).nth(1).waitFor();
await russian(page, 'owner assistant');
await page.screenshot({path: `${out}/cs-owner-assistant.png`});
await browser.close();
