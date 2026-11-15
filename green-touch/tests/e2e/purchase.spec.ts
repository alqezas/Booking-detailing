/**
 * Full path with controlled test adapters (Nova Poshta + LiqPay), real internal
 * state transitions: checkout → server pricing → signed LiqPay form → signed
 * callback → order paid in the database → visible to the owner.
 */
import {expect, test} from '@playwright/test';
import {adminLogin, fillCheckout, payAndConfirm} from './helpers.ts';

test('каталог → фільтр → товар → кошик → дані → НП → оплата → замовлення в адмінці', async ({page}) => {
  await page.goto('/katalog');
  await page.getByRole('checkbox', {name: 'Суха'}).click();
  await expect(page).toHaveURL(/typ=sukha/);
  await page.getByRole('checkbox', {name: 'Сухість і зневоднення'}).click();
  await expect(page).toHaveURL(/potreba=sukhist/);
  await expect(page.getByText('Знайдено: 1')).toBeVisible();
  // browser back keeps the previous filter state
  await page.goBack();
  await expect(page).not.toHaveURL(/potreba/);
  await page.goForward();
  await expect(page.getByText('Знайдено: 1')).toBeVisible();

  await page.getByRole('heading', {name: 'E2E Крем для сухої шкіри', level: 3}).click();
  await expect(page.getByRole('heading', {name: 'E2E Крем для сухої шкіри', level: 1})).toBeVisible();
  await page.getByRole('button', {name: /Збільшити кількість/}).click();
  await page.getByRole('button', {name: 'У кошик'}).first().click();

  await page.goto('/koshyk');
  await expect(page.getByText('2 200 грн').first()).toBeVisible();
  await expect(page.getByText(/Доставка Новою поштою не входить у суму/)).toBeVisible();
  await page.getByRole('link', {name: 'Оформити замовлення'}).click();

  await fillCheckout(page);
  const number = await payAndConfirm(page);

  await adminLogin(page);
  await page.getByLabel('Пошук').fill(String(number));
  await page.getByRole('link', {name: `№${number}`}).click();
  await expect(page.getByText('Оплачено (підтверджено LiqPay)')).toBeVisible();
  await expect(page.getByText(/E2E Крем для сухої шкіри, 50 мл × 2/)).toBeVisible();
  await expect(page.getByText(/Відділення №1: вул\. Тестова, 1/)).toBeVisible();
  // fulfilment is separate from payment: the owner can move it, not the payment
  await page.getByRole('button', {name: 'Зберегти'}).click();
  await expect(page.getByText('Збережено')).toBeVisible();
});

test('сервер перераховує ціну: підроблена сума в кошику не потрапляє в замовлення', async ({page}) => {
  await page.goto('/tovar/e2e-tonik');
  await page.getByRole('button', {name: 'У кошик'}).first().click();
  // tamper with the local snapshot price
  await page.evaluate(() => {
    const c = JSON.parse(localStorage.getItem('gt-cart-v1')!);
    c.lines[0].price_kop = 100;
    localStorage.setItem('gt-cart-v1', JSON.stringify(c));
  });
  await page.goto('/koshyk');
  await expect(page.getByText('Ціни змінилися')).toBeVisible();
  await expect(page.getByText('400 грн').first()).toBeVisible();
});
