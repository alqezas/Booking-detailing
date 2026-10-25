/**
 * A Ukrainian studio: book through the real UI at phone width and check that
 * no Russian text appears anywhere on the way (letters ы э ё ъ or Russian UI words).
 *   tsx tests/visual/ukrainian-booking.ts [baseURL] [outDir] [slug] [studio name] [short service] [question] [answer regex]
 */
import {chromium, type Page} from '@playwright/test';

const [
  base = 'http://localhost:5173',
  out = 'test-results/visual',
  slug = 'admire-detailing',
  studio = 'Admire Detailing Center',
  service = 'Озонування',
  question = 'Чи є подарункові сертифікати?',
  answer = '5000 грн',
] = process.argv.slice(2);
const browser = await chromium.launch();
const ctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true, reducedMotion: 'reduce', locale: 'uk-UA'});
const page = await ctx.newPage();
page.setDefaultTimeout(20_000);

const RUSSIAN = /[ЫыЭэЁёЪъ]|(?<!\p{L})(Шаг|Дальше|Выбор|Время|Выберите|Записаться|Ваши|Имя|Подтвердить|Отменить|Услуги|Свободно|занято|Сегодня)(?!\p{L})/gu;
const foreign = async (p: Page, where: string) => {
  const text = await p.evaluate(() => document.body.innerText);
  const found = text.match(RUSSIAN) ?? [];
  if (found.length) throw new Error(`Russian text on ${where}: ${found.slice(0, 10).join(', ')}`);
  console.log(`✓ ${where}: Ukrainian only`);
};

await page.goto(`${base}/s/${slug}/`);
await page.getByRole('heading', {level: 1, name: studio}).waitFor();
await foreign(page, 'home');
await page.getByRole('button', {name: 'Записатися'}).first().click();
const d = page.getByRole('dialog');
await d.getByText('Крок 1 з 3').waitFor();
await foreign(page, 'step 1');
await d.getByText(service, {exact: true}).click();
await d.getByRole('radiogroup', {name: 'Вибір часу'}).getByRole('radio').filter({hasNotText: 'зайнято'}).first().click();
await foreign(page, 'step 2');
await page.screenshot({path: `${out}/uk-step2.png`});
await d.getByRole('button', {name: 'Далі'}).click();
await d.getByLabel('Імʼя').fill('Олександр Коваль');
await d.getByLabel('Телефон').fill(`050 ${Math.floor(100 + Math.random() * 899)} ${Math.floor(10 + Math.random() * 89)} ${Math.floor(10 + Math.random() * 89)}`);
await d.getByLabel('Автомобіль', {exact: true}).fill('Toyota RAV4');
await d.getByRole('button', {name: 'Перевірити запис'}).click();
await d.getByText('Перевірте й підтвердьте').waitFor();
await foreign(page, 'confirm');
await page.screenshot({path: `${out}/uk-confirm.png`});
await d.getByRole('button', {name: 'Підтвердити запис'}).click();
await d.getByText('Ви записані').waitFor();
await foreign(page, 'done');
await d.getByRole('button', {name: 'Мій запис'}).click();
await page.getByRole('heading', {name: 'Ваш запис'}).waitFor();
await page.waitForTimeout(600);
await foreign(page, 'my booking');
await page.screenshot({path: `${out}/uk-my.png`, fullPage: true});

await page.goto(`${base}/s/${slug}/assistant?q=${encodeURIComponent(question)}`);
await page.getByText(new RegExp(answer)).first().waitFor();
await foreign(page, 'assistant');
await page.screenshot({path: `${out}/uk-assistant.png`});

await page.goto(`${base}/s/${slug}/owner/login`);
await page.getByRole('heading', {name: 'Вхід до кабінету'}).waitFor();
await foreign(page, 'owner login');
await browser.close();
