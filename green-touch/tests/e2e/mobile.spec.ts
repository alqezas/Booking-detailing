/** Phone layout: no horizontal scroll, catalog cards aligned, filter sheet works. */
import {expect, test} from '@playwright/test';

test('телефон: без горизонтального скролу, картки вирівняні, панель фільтрів', async ({page}) => {
  for (const path of ['/', '/katalog', '/tovar/e2e-krem-sukha', '/nabir/e2e-nabir-zvolozhennia', '/koshyk', '/dostavka-i-oplata']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
  }
  await page.goto('/katalog?kategoriia=kremy');
  await expect(page.getByText(/Знайдено: \d+/)).toBeVisible();
  // cards in one row share the same price/button line
  const tops = await page.getByRole('button', {name: 'У кошик'}).evaluateAll(els => els.slice(0, 2).map(e => Math.round(e.getBoundingClientRect().top)));
  expect(tops[0]).toBe(tops[1]);

  await page.getByRole('button', {name: /^Фільтри/}).click();
  await page.getByRole('checkbox', {name: 'Суха'}).click();
  await page.getByRole('button', {name: /Показати результати/}).click();
  await expect(page).toHaveURL(/typ=sukha/);
  await expect(page.getByRole('link', {name: 'E2E Крем для сухої шкіри'}).first()).toBeVisible();
});
