import {readFileSync} from 'node:fs';
import {expect, type Page} from '@playwright/test';
import {E2E_FILE} from './global-setup.ts';

/** Fill the checkout form and choose a real-shaped settlement and pickup point (from the NP test adapter). */
export async function fillCheckout(page: Page, method: 'Нова пошта — відділення' | 'Нова пошта — поштомат' = 'Нова пошта — відділення', pay: 'full' | 'prepay' = 'full') {
  await expect(page.getByRole('heading', {name: 'Оформлення замовлення'})).toBeVisible();
  await page.getByLabel(/Імʼя/).fill('Олена');
  await page.getByLabel(/Прізвище/).fill('Тестова');
  await page.getByLabel(/Телефон/).fill('067 123 45 67');
  await page.getByRole('radio', {name: method}).check();

  const city = page.getByRole('combobox', {name: /Населений пункт/});
  await city.fill('Київ');
  await page.getByRole('option', {name: /м\. Київ, Київська обл\./}).click();

  const point = page.getByRole('combobox', {name: method.endsWith('поштомат') ? /Поштомат/ : /Відділення/});
  await expect(point).toBeEnabled();
  await point.fill(method.endsWith('поштомат') ? 'Хрещатик, 1' : '1');
  const option = method.endsWith('поштомат') ? /Поштомат "Нова Пошта" №30001/ : /Відділення №1: вул\. Тестова, 1$/;
  await page.getByRole('option', {name: option}).first().click();

  await page.getByRole('radio', {name: pay === 'full' ? /Повна оплата онлайн/ : /Передоплата 150/}).check();
  await page.getByRole('checkbox', {name: /Погоджуюся з умовами покупки/}).check();
}

/** Submit, pay on the mono TEST ADAPTER page, return to the shop and wait for the server status. */
export async function payAndConfirm(page: Page): Promise<number> {
  await page.getByRole('button', {name: /Підтвердити й оплатити/}).click();
  await expect(page.getByRole('heading', {name: /Тестовий адаптер mono/})).toBeVisible();
  await page.getByRole('button', {name: 'Оплатити (тест)'}).click();
  await expect(page).toHaveURL(/\/zamovlennia\/[0-9a-f-]{36}$/);
  // The status comes from the server (verified callback), not from the redirect.
  await expect(page.getByText('Оплату підтверджено банком')).toBeVisible();
  const title = await page.getByRole('heading', {level: 1}).textContent();
  return Number(title!.match(/№(\d+)/)![1]);
}

export async function adminLogin(page: Page) {
  const {email, password} = JSON.parse(readFileSync(E2E_FILE, 'utf8')) as {email: string; password: string};
  await page.goto('/admin');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Пароль').fill(password);
  await page.getByRole('button', {name: 'Увійти'}).click();
  await expect(page.getByRole('heading', {name: 'Замовлення', level: 1})).toBeVisible();
}

/** Prepayment: no online payment — the order page tells the buyer to wait for Viber. */
export async function confirmPrepay(page: Page): Promise<number> {
  await page.getByRole('button', {name: 'Підтвердити замовлення'}).click();
  await expect(page).toHaveURL(/\/zamovlennia\/[0-9a-f-]{36}$/);
  await expect(page.getByText('Замовлення прийнято. Чекайте повідомлення у Viber')).toBeVisible();
  const title = await page.getByRole('heading', {level: 1}).textContent();
  return Number(title!.match(/№(\d+)/)![1]);
}
