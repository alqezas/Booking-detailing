import {expect, test} from '@playwright/test';
import {DEMO_OWNER_PASSWORD} from '../../scripts/lib/demo.ts';
import resetLimits from './global-setup.ts';

// All local bookings come from one IP: start each beauty flow with fresh LOCAL rate counters.
test.beforeEach(async ({}, info) => {
  if (/localhost|127\.0\.0\.1/.test(String(info.project.use.baseURL))) await resetLimits();
});

/**
 * Beauty flow: a client chooses a service with add-ons, a master, a time,
 * confirms (double tap → still one booking) — and the owner sees exactly that
 * booking, with its options and master, in the cabinet.
 */
test('beauty: service with add-ons → master → time → confirm; the owner sees it', async ({page, browser}, info) => {
  test.setTimeout(120_000);
  const name = `E2E ${info.project.name} ${Date.now().toString(36)}`;

  await page.goto('/s/aura-beauty/');
  await expect(page.getByRole('heading', {level: 1, name: 'AURA Beauty Studio'})).toBeVisible();
  await expect(page.getByText(/Открыто до|Откроемся|Сейчас закрыто/)).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Мастера'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Запись в студию'})).toBeVisible();
  // Category tabs narrow the price list.
  const tabs = page.getByRole('region', {name: 'Запись в студию'});
  await tabs.getByRole('button', {name: 'Педикюр', exact: true}).click();
  await expect(page.getByText('Педикюр + гель-лак', {exact: true})).toBeVisible();
  await expect(page.getByText('Гигиенический маникюр без покрытия', {exact: true})).toBeHidden();
  await tabs.getByRole('button', {name: 'Все', exact: true}).click();

  // Step 1: the service and its options; the total adds up live.
  await page.getByRole('button', {name: 'Выбрать услугу «Маникюр + однотонный гель-лак»'}).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Шаг 1 из 3')).toBeVisible();
  await sheet.getByRole('checkbox', {name: 'Снятие старого покрытия'}).check();
  await sheet.getByRole('checkbox', {name: 'Укрепление гелем / акригелем / пудрой'}).check();
  await expect(sheet.getByText(/^2 ч · 1\s000\sKč$/)).toBeVisible(); // whole text: the step-2 header repeats the total
  await sheet.getByRole('button', {name: 'Выбрать время'}).click();

  // Step 2: master, then the first free time; taken times are disabled.
  await expect(sheet.getByText('Шаг 2 из 3')).toBeVisible();
  await sheet.getByRole('radio', {name: 'Анна'}).click();
  const free = sheet.locator('[role=radiogroup][aria-label^="Выбор времени"] [role=radio]:not([disabled]):not([aria-disabled=true])').first();
  await expect(free).toBeVisible();
  const taken = sheet.locator('[role=radiogroup][aria-label^="Выбор времени"] [role=radio]', {hasText: 'занято'});
  if ((await taken.count()) > 0) await expect(taken.first()).toBeDisabled();
  const time = (await free.innerText()).trim();
  await free.click();
  await sheet.getByRole('button', {name: 'Дальше'}).click();

  // Step 3: contacts with validation, the summary and a double-tapped confirm.
  await expect(sheet.getByText('Шаг 3 из 3')).toBeVisible();
  await sheet.getByRole('button', {name: 'Подтвердить запись'}).click();
  await expect(sheet.getByText('Укажите имя')).toBeVisible();
  await sheet.getByLabel('Имя').fill(name);
  const digits = String(Math.floor(100_000 + Math.random() * 899_999));
  await sheet.getByLabel('Телефон').fill(`777 ${digits}`);
  await sheet.getByLabel(/Пожелание к визиту/).fill('Нюдовый оттенок');
  await expect(sheet.getByText('Снятие старого покрытия, Укрепление гелем / акригелем / пудрой')).toBeVisible();
  await sheet.getByRole('button', {name: 'Подтвердить запись'}).dblclick();
  await expect(sheet.getByRole('heading', {name: 'Вы записаны'})).toBeVisible();
  await expect(sheet.getByText('Анна')).toBeVisible();
  await expect(sheet.getByText('В образце приложения напоминания не отправляются')).toBeVisible();

  await sheet.getByRole('button', {name: 'Моя запись'}).click();
  await expect(page.getByText(name).first()).toBeVisible();
  await expect(page.getByText(`+420 777 ${digits.slice(0, 3)} ${digits.slice(3)}`).or(page.getByText(`+420777${digits}`)).first()).toBeVisible();
  await expect(page.getByRole('button', {name: 'Перенести'})).toBeVisible();

  if (!/localhost|127\.0\.0\.1/.test(String(info.project.use.baseURL))) return;
  const ctx = await browser.newContext(info.project.use);
  const owner = await ctx.newPage();
  await owner.goto('/s/aura-beauty/owner/');
  await owner.getByLabel('Почта').fill('owner@aura-beauty.demo');
  await owner.getByLabel('Пароль').fill(DEMO_OWNER_PASSWORD);
  await owner.getByRole('button', {name: 'Войти'}).click();
  await expect(owner.getByRole('heading', {name: 'Записи', level: 1})).toBeVisible();
  await owner.getByRole('radio', {name: 'Неделя'}).click();
  const row = owner.getByText(new RegExp(`${name}.*Анна.*Снятие старого покрытия, Укрепление гелем / акригелем / пудрой`));
  const inThisWeek = await row.waitFor({timeout: 10_000}).then(() => true, () => false);
  if (!inThisWeek) {
    await owner.getByRole('button', {name: 'Вперёд'}).click();
    await row.waitFor({timeout: 10_000});
  }
  await expect(row).toHaveCount(1); // the double tap made one booking
  await expect(owner.getByText(time).first()).toBeVisible();
  await expect(owner.getByText(/к оплате 1[\s ]000[\s ]Kč/).first()).toBeVisible();
  await ctx.close();
});

test('solo studio: no masters strip, no master choice; its own language and accent', async ({page}) => {
  await page.goto('/s/velvet-spa/');
  await expect(page.getByRole('heading', {level: 1, name: 'VELVET Massage & Spa'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Майстри'})).toHaveCount(0);
  await page.getByRole('button', {name: 'Обрати послугу «Лімфодренажний масаж»'}).click();
  // No options for this service: the bar offers the time directly.
  await page.getByRole('button', {name: 'Обрати час'}).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByText('Крок 2 з 3')).toBeVisible();
  await expect(sheet.getByRole('radiogroup', {name: 'Вибір майстра'})).toHaveCount(0);
  const accent = await page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--color-accent').trim());
  expect(accent.toLowerCase()).not.toBe('#7c3aed');
});
