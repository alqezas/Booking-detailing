/** Offline: the cart survives, checkout and payment are blocked (nothing is queued). */
import {expect, test} from '@playwright/test';

test('офлайн: кошик зберігається, оформлення й оплата заблоковані', async ({page, context}) => {
  await page.goto('/tovar/e2e-tonik');
  await page.getByRole('button', {name: 'У кошик'}).first().click();
  await page.goto('/koshyk');
  await expect(page.getByRole('link', {name: 'Оформити замовлення'})).toBeVisible();

  await context.setOffline(true);
  await expect(page.getByText('Немає зʼєднання з інтернетом')).toBeVisible();
  await expect(page.getByText('Ви офлайн')).toBeVisible();
  await expect(page.getByRole('button', {name: 'Оформити замовлення'})).toBeDisabled();
  // the cart can still be edited and is kept in this browser
  await page.getByRole('button', {name: /Збільшити кількість/}).click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('gt-cart-v1')!).lines[0].qty);
  expect(saved).toBe(2);

  let functionCalls = 0;
  page.on('request', r => {
    if (r.url().includes('/functions/v1/')) functionCalls++;
  });
  await page.evaluate(() => history.pushState(null, '', '/oformlennia'));
  await page.evaluate(() => dispatchEvent(new PopStateEvent('popstate')));
  await expect(page.getByRole('button', {name: /Підтвердити й оплатити/})).toBeDisabled();
  expect(functionCalls).toBe(0);

  await context.setOffline(false);
  await expect(page.getByText('Немає зʼєднання з інтернетом')).toBeHidden();
});
