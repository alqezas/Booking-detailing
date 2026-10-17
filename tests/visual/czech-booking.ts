/**
 * JH Auto Detailing (Czech): book through the real UI at phone width and
 * check that no Russian text appears anywhere on the way (local stack only).
 *   tsx tests/visual/czech-booking.ts [baseURL] [outDir]
 */
import {chromium, type Page} from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results/visual';
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'cs-CZ'});
const page = await ctx.newPage();
page.setDefaultTimeout(20_000);

const russian = async (p: Page, where: string) => {
  const found = await p.evaluate(() => document.body.innerText.match(/[А-Яа-яЁё]+/g) ?? []);
  if (found.length) throw new Error(`Russian text on ${where}: ${found.slice(0, 10).join(', ')}`);
  console.log(`✓ ${where}: Czech only`);
};

await page.goto(`${base}/s/jh-auto-detailing/`);
await page.getByRole('heading', {level: 1, name: 'JH Auto Detailing'}).waitFor();
await russian(page, 'home');
await page.getByRole('button', {name: 'Rezervovat termín'}).click();
const d = page.getByRole('dialog');
await d.getByText('Krok 1 ze 3').waitFor();
await russian(page, 'step 1');
await d.getByText('Renovace světlometů').click();
await d.getByRole('radiogroup', {name: 'Výběr času'}).getByRole('radio').filter({hasNotText: 'obsazeno'}).first().click();
await russian(page, 'step 2');
await page.screenshot({path: `${out}/cs-step2.png`});
await d.getByRole('button', {name: 'Pokračovat'}).click();
await d.getByLabel('Jméno').fill('Jan Novák');
await d.getByLabel('Telefon').fill(`777 ${Math.floor(100 + Math.random() * 899)} ${Math.floor(100 + Math.random() * 899)}`);
await d.getByLabel('Vůz').fill('Škoda Octavia');
await d.getByRole('button', {name: 'Zkontrolovat rezervaci'}).click();
await d.getByText('Zkontrolujte a potvrďte').waitFor();
await russian(page, 'confirm');
await page.screenshot({path: `${out}/cs-confirm.png`});
await d.getByRole('button', {name: 'Potvrdit rezervaci'}).click();
await d.getByText('Jste objednáni').waitFor();
await russian(page, 'done');
await d.getByRole('button', {name: 'Moje rezervace'}).click();
await page.getByRole('heading', {name: 'Vaše rezervace'}).waitFor();
await page.waitForTimeout(600);
await russian(page, 'my booking');
await page.screenshot({path: `${out}/cs-my.png`, fullPage: true});

await page.goto(`${base}/s/jh-auto-detailing/assistant?q=${encodeURIComponent('Kolik stojí čištění interiéru?')}`);
await page.getByText(/Ceny:|od 1 600/).first().waitFor();
await russian(page, 'assistant');
await page.screenshot({path: `${out}/cs-assistant.png`});

await page.goto(`${base}/s/jh-auto-detailing/owner/login`);
await page.getByRole('heading', {name: 'Přihlášení do administrace'}).waitFor();
await russian(page, 'owner login');
await browser.close();
