/** Kit scenario on test fixtures: filters → kit → composition and −15 % → cart with a single item → owner sees the composition. */
import {expect, test} from '@playwright/test';
import {adminLogin, confirmPrepay, fillCheckout} from './helpers.ts';

test('набір + передоплата: фільтри → склад і −15% → кошик з окремим товаром → передоплата у Viber → склад і накладений платіж у власниці', async ({page}) => {
  await page.goto('/katalog?kategoriia=nabory');
  await page.getByRole('checkbox', {name: 'Зволоження та живлення'}).click();
  await expect(page).toHaveURL(/pryznachennia=zvolozhennia/);
  await page.getByRole('heading', {name: 'E2E Набір зволоження', level: 3}).click();

  await expect(page.getByRole('heading', {name: 'Склад набору'})).toBeVisible();
  await expect(page.getByRole('link', {name: 'E2E Крем для сухої шкіри'})).toBeVisible();
  await expect(page.getByText('−15%').first()).toBeVisible();
  await expect(page.getByText('1 360 грн').first()).toBeVisible();
  await expect(page.getByText('1 600 грн').first()).toBeVisible(); // «Окремо»
  await page.getByRole('button', {name: 'У кошик'}).first().click();

  await page.goto('/tovar/e2e-tonik');
  await page.getByRole('button', {name: 'У кошик'}).first().click();

  await page.goto('/koshyk');
  await expect(page.getByText('Економія на наборах')).toBeVisible();
  await expect(page.getByText('−240 грн')).toBeVisible();
  await expect(page.getByText('1 760 грн').first()).toBeVisible(); // 1360 + 400
  await page.getByRole('link', {name: 'Оформити замовлення'}).click();

  await fillCheckout(page, 'Нова пошта — поштомат', 'prepay');
  await expect(page.getByRole('button', {name: 'Підтвердити замовлення'})).toBeVisible();
  const number = await confirmPrepay(page);
  await expect(page.getByText(/Набір: E2E Крем для сухої шкіри, E2E Сироватка зволожувальна/)).toBeVisible();
  await expect(page.getByText('1 610 грн').first()).toBeVisible(); // 1760 − 150 при отриманні

  await adminLogin(page);
  await page.getByLabel('Пошук').fill(String(number));
  await page.getByRole('link', {name: `№${number}`}).click();
  await expect(page.getByText(/Набір: E2E Набір зволоження, 50 мл × 1/)).toBeVisible();
  await expect(page.getByText(/• E2E Крем для сухої шкіри, 50 мл — 1 шт\./)).toBeVisible();
  await expect(page.getByText(/• E2E Сироватка зволожувальна, 50 мл — 1 шт\./)).toBeVisible();
  await expect(page.getByText('Разом: 1 760 грн')).toBeVisible();
  await expect(page.getByText(/Поштомат "Нова Пошта" №30001/)).toBeVisible();
  await expect(page.getByText('Чекає передоплату 150 грн').first()).toBeVisible();
  await expect(page.getByRole('link', {name: 'Написати у Viber'}).first()).toHaveAttribute('href', /^viber:\/\/chat\?number=%2B380/);
  // shipping is blocked until the owner records the prepayment
  await page.getByRole('button', {name: 'Передоплату отримано'}).click();
  await expect(page.getByText('Передоплату отримано').first()).toBeVisible();
  await expect(page.getByText('Накладений платіж на НП')).toBeVisible();

  // date filter: today's order is listed under «Сьогодні», not under «Вчора»
  await page.getByRole('link', {name: '← Усі замовлення'}).click();
  await page.getByRole('button', {name: /Дата \(Київ\)|За весь час/}).first().click();
  await page.getByRole('button', {name: 'Вчора'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', {name: `№${number}`})).toHaveCount(0);
  await page.getByRole('button', {name: /Дата \(Київ\)|–|-/}).first().click();
  await page.getByRole('button', {name: 'Сьогодні'}).click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', {name: `№${number}`})).toBeVisible();

  // the owner deletes the order right from the list, after confirming
  await page.getByRole('row', {name: new RegExp(`№${number}`)}).getByRole('button', {name: 'Видалити'}).click();
  await expect(page.getByRole('alertdialog')).toContainText(`Видалити замовлення №${number}?`);
  await page.getByRole('alertdialog').getByRole('button', {name: 'Видалити'}).click();
  await expect(page.getByRole('link', {name: `№${number}`})).toHaveCount(0);
});

test('адмінка як застосунок: свій маніфест, вхід щоразу, сесія не переживає закриття вкладки й неактивність', async ({page, context}) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', {name: 'Вхід для власниці'})).toBeVisible();
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/admin.webmanifest');
  const manifest = await (await page.request.get('/admin.webmanifest')).json();
  expect(manifest).toMatchObject({id: '/admin', start_url: '/admin', scope: '/admin', short_name: 'GT Адмін'});

  await adminLogin(page);
  // nothing durable: the session is not in localStorage
  expect(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('gt-admin')))).toEqual([]);

  // a new tab (or a fresh launch of the installed app) starts at the sign-in form
  const other = await context.newPage();
  await other.goto('/admin');
  await expect(other.getByRole('heading', {name: 'Вхід для власниці'})).toBeVisible();
  await other.close();

  // 20+ minutes without activity → signed out on return
  await page.evaluate(() => sessionStorage.setItem('gt-admin-last-activity', String(Date.now() - 21 * 60_000)));
  await page.reload();
  await expect(page.getByText(/Сесію завершено: 20 хв без дій/)).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Вхід для власниці'})).toBeVisible();

  // leaving the admin restores the shop identity
  await page.goto('/');
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', '/manifest.webmanifest');
});
