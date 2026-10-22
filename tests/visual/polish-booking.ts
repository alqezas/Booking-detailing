/**
 * Detailing Studio MS (Polish): book through the real UI at phone width and
 * check that neither Russian nor Czech text appears anywhere on the way.
 *   tsx tests/visual/polish-booking.ts [baseURL] [outDir]
 */
import {chromium, type Page} from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results/visual';
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'pl-PL'});
const page = await ctx.newPage();
page.setDefaultTimeout(20_000);

const foreign = async (p: Page, where: string) => {
  const found = await p.evaluate(() => document.body.innerText.match(/[А-Яа-яЁё]+|[ěřůťďň]\p{L}*|\p{L}*[ěřůťďň]/gu) ?? []);
  if (found.length) throw new Error(`Foreign text on ${where}: ${found.slice(0, 10).join(', ')}`);
  console.log(`✓ ${where}: Polish only`);
};

await page.goto(`${base}/s/ms-detailing-studio/`);
await page.getByRole('heading', {level: 1, name: 'Detailing Studio MS'}).waitFor();
await foreign(page, 'home');
await page.getByRole('button', {name: 'Zarezerwuj termin'}).click();
const d = page.getByRole('dialog');
await d.getByText('Krok 1 z 3').waitFor();
await foreign(page, 'step 1');
await d.getByText('Ozonowanie wnętrza', {exact: true}).click();
await d.getByRole('radiogroup', {name: 'Wybór godziny'}).getByRole('radio').filter({hasNotText: 'zajęte'}).first().click();
await foreign(page, 'step 2');
await page.screenshot({path: `${out}/pl-step2.png`});
await d.getByRole('button', {name: 'Dalej'}).click();
await d.getByLabel('Imię').fill('Jan Kowalski');
await d.getByLabel('Telefon').fill(`533 ${Math.floor(100 + Math.random() * 899)} ${Math.floor(100 + Math.random() * 899)}`);
await d.getByLabel('Auto').fill('Toyota Corolla');
await d.getByRole('button', {name: 'Sprawdź rezerwację'}).click();
await d.getByText('Sprawdź i potwierdź').waitFor();
await foreign(page, 'confirm');
await page.screenshot({path: `${out}/pl-confirm.png`});
await d.getByRole('button', {name: 'Potwierdź rezerwację'}).click();
await d.getByText('Jesteś zapisany').waitFor();
await foreign(page, 'done');
await d.getByRole('button', {name: 'Moja rezerwacja'}).click();
await page.getByRole('heading', {name: 'Twoja rezerwacja'}).waitFor();
await page.waitForTimeout(600);
await foreign(page, 'my booking');
await page.screenshot({path: `${out}/pl-my.png`, fullPage: true});

await page.goto(`${base}/s/ms-detailing-studio/assistant?q=${encodeURIComponent('Czy odbieracie auto od klienta?')}`);
await page.getByText(/door-to-door/).first().waitFor();
await foreign(page, 'assistant');
await page.screenshot({path: `${out}/pl-assistant.png`});

await page.goto(`${base}/s/ms-detailing-studio/owner/login`);
await page.getByRole('heading', {name: 'Logowanie do panelu'}).waitFor();
await foreign(page, 'owner login');
await browser.close();
