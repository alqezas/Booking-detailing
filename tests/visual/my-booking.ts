/**
 * «Моя запись» at phone and desktop width: empty, then with a booking made
 * through the real UI (local stack only). Prints overflow and heading lines.
 *   tsx tests/visual/my-booking.ts [baseURL] [outDir]
 */
import {chromium} from '@playwright/test';

const base = process.argv[2] ?? 'http://localhost:5173';
const out = process.argv[3] ?? 'test-results/visual';
const browser = await chromium.launch();
for (const [w, h, m] of [
  [390, 844, true],
  [1440, 900, false],
] as const) {
  const ctx = await browser.newContext({viewport: {width: w, height: h}, isMobile: m, hasTouch: m, reducedMotion: 'reduce'});
  const page = await ctx.newPage();
  page.setDefaultTimeout(20_000);
  await page.goto(`${base}/s/graphite/my`);
  await page.getByRole('heading', {name: 'Записей пока нет'}).waitFor();
  await page.screenshot({path: `${out}/my-empty-${w}.png`});

  await page.getByRole('button', {name: 'Выбрать услугу и время'}).click();
  const d = page.getByRole('dialog');
  await d.getByText('Полировка фар').click();
  await d.getByRole('radiogroup', {name: 'Выбор времени'}).getByRole('radio').filter({hasNotText: 'занято'}).first().click();
  await d.getByRole('button', {name: 'Дальше'}).click();
  await d.getByLabel('Имя').fill('Вёрстка Тест');
  await d.getByLabel('Телефон').fill(`8 901 ${Math.floor(1e6 + Math.random() * 8e6)}`);
  await d.getByLabel('Автомобиль').fill('Kia Rio');
  await d.getByRole('button', {name: 'Проверить запись'}).click();
  await d.getByRole('button', {name: 'Подтвердить запись'}).click();
  await d.getByRole('button', {name: 'Моя запись'}).click();
  await page.getByRole('heading', {name: 'Ваша запись'}).waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({path: `${out}/my-booking-${w}.png`, fullPage: true});
  const metrics = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    lines: [...document.querySelectorAll('main h1, main h2')].map(el => Math.round(el.getBoundingClientRect().left)),
  }));
  console.log(w, JSON.stringify(metrics));
  await ctx.close();
}
await browser.close();
