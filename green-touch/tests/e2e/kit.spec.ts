/** Kit scenario on test fixtures: filters → kit → composition and −15 % → cart with a single item → owner sees the composition. */
import {expect, test} from '@playwright/test';
import {adminLogin, fillCheckout, payAndConfirm} from './helpers.ts';

test('набір: фільтри → склад і −15% → кошик з окремим товаром → правильний підсумок і склад у власниці', async ({page}) => {
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

  await fillCheckout(page, 'Нова пошта — поштомат');
  const number = await payAndConfirm(page);
  await expect(page.getByText(/Набір: E2E Крем для сухої шкіри, E2E Сироватка зволожувальна/)).toBeVisible();

  await adminLogin(page);
  await page.getByLabel('Пошук').fill(String(number));
  await page.getByRole('link', {name: `№${number}`}).click();
  await expect(page.getByText(/Набір: E2E Набір зволоження, 50 мл × 1/)).toBeVisible();
  await expect(page.getByText(/• E2E Крем для сухої шкіри, 50 мл — 1 шт\./)).toBeVisible();
  await expect(page.getByText(/• E2E Сироватка зволожувальна, 50 мл — 1 шт\./)).toBeVisible();
  await expect(page.getByText('Разом: 1 760 грн')).toBeVisible();
  await expect(page.getByText(/Поштомат "Нова Пошта" №30001/)).toBeVisible();
});
