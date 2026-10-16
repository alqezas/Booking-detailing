import {expect, test} from '@playwright/test';
import {DEMO_OWNER_PASSWORD} from '../../scripts/lib/demo.ts';

/**
 * The main flow: a customer books on the public page (no account), then the
 * owner signs in and sees exactly that booking in the cabinet.
 */
test('customer books a service; the owner sees it in the cabinet', async ({page, browser}, info) => {
  const name = `E2E ${info.project.name} ${Date.now().toString(36)}`;

  await page.goto('/s/graphite/');
  await expect(page.getByRole('heading', {level: 1, name: 'GRAPHITE Detailing'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Запись в студию'})).toBeVisible();

  // Hero glass button → service → first free slot
  await page.getByRole('button', {name: 'Записаться', exact: true}).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet.getByRole('heading', {name: 'Запись в студию'})).toBeVisible();
  await sheet.getByText('Детейлинг-мойка').click();
  await expect(sheet.getByRole('heading', {name: 'Детейлинг-мойка'})).toBeVisible();

  const times = sheet.getByRole('radiogroup', {name: 'Выбор времени'});
  await expect(times).toBeVisible();
  // Taken slots are visibly marked and not selectable
  const taken = times.getByRole('radio', {name: /занято/});
  if ((await taken.count()) > 0) await expect(taken.first()).toBeDisabled();
  const free = times.getByRole('radio').filter({hasNotText: 'занято'}).first();
  const time = (await free.innerText()).trim();
  await free.click();
  await sheet.getByRole('button', {name: 'Дальше'}).click();

  // Validation first, then valid data
  await sheet.getByRole('button', {name: 'Проверить запись'}).click();
  await expect(sheet.getByText('Укажите имя')).toBeVisible();
  await sheet.getByLabel('Имя').fill(name);
  await sheet.getByLabel('Телефон').fill('8 900 123-45-67');
  await sheet.getByLabel('Автомобиль').fill('Kia Rio');
  await sheet.getByRole('button', {name: 'Проверить запись'}).click();
  await expect(sheet.getByText('+7 900 123-45-67')).toBeVisible();

  // Double tap must not create two bookings
  const confirm = sheet.getByRole('button', {name: 'Подтвердить запись'});
  await confirm.dblclick();
  await expect(sheet.getByRole('heading', {name: 'Вы записаны'})).toBeVisible();
  await expect(sheet.getByText('В образце приложения напоминания не отправляются')).toBeVisible();

  // «Моя запись» shows it, opened by the device's stored token
  await sheet.getByRole('button', {name: 'Моя запись'}).click();
  await expect(page.getByRole('heading', {name: 'Детейлинг-мойка'})).toBeVisible();
  await expect(page.getByText(name).first()).toBeVisible();

  // Owner, in a separate browser context (no shared session). Only against the
  // local stack: the deployed owner password is never typed by automation.
  if (!/localhost|127\.0\.0\.1/.test(String(info.project.use.baseURL))) return;
  const ctx = await browser.newContext(info.project.use);
  const owner = await ctx.newPage();
  await owner.goto('/s/graphite/owner/');
  await owner.getByLabel('Почта').fill('owner@graphite.demo');
  await owner.getByLabel('Пароль').fill(DEMO_OWNER_PASSWORD);
  await owner.getByRole('button', {name: 'Войти'}).click();
  await expect(owner.getByRole('heading', {name: 'Записи', level: 1})).toBeVisible();
  await owner.getByRole('radio', {name: 'Неделя'}).click();
  const row = owner.getByText(new RegExp(name));
  // Wait for this week's list; only if the booking is not in it, look at the next week.
  const inThisWeek = await row.waitFor({timeout: 10_000}).then(() => true, () => false);
  if (!inThisWeek) {
    await owner.getByRole('button', {name: 'Вперёд'}).click();
    await row.waitFor({timeout: 10_000});
  }
  await expect(row).toHaveCount(1);
  await expect(owner.getByText(time).first()).toBeVisible();
  await ctx.close();
});

test('the same slot cannot be booked twice from two devices', async ({browser}, info) => {
  test.skip(info.project.name !== 'phone', 'one run is enough');
  test.setTimeout(150_000); // two full booking flows in two browser contexts
  const open = async () => {
    const ctx = await browser.newContext(info.project.use);
    const p = await ctx.newPage();
    await p.goto('/s/severny/');
    await p.getByRole('button', {name: 'Записаться', exact: true}).click();
    await p.getByRole('dialog').getByText('Шиномонтаж R13–R18').click();
    return {ctx, p, d: p.getByRole('dialog')};
  };
  const a = await open();
  const b = await open();
  const pickSame = async (d: typeof a.d, label?: string) => {
    const times = d.getByRole('radiogroup', {name: 'Выбор времени'});
    const slot = label ? times.getByRole('radio', {name: label, exact: true}) : times.getByRole('radio').filter({hasNotText: 'занято'}).last();
    const text = (await slot.innerText()).trim();
    await slot.click();
    await d.getByRole('button', {name: 'Дальше'}).click();
    await d.getByLabel('Имя').fill('Гонка');
    await d.getByLabel('Телефон').fill(`+7999${Math.floor(1e6 + Math.random() * 8e6)}`);
    await d.getByLabel('Автомобиль').fill('Lada Vesta');
    await d.getByRole('button', {name: 'Проверить запись'}).click();
    return text;
  };
  const t = await pickSame(a.d);
  await pickSame(b.d, t);
  await a.d.getByRole('button', {name: 'Подтвердить запись'}).click();
  await expect(a.d.getByRole('heading', {name: 'Вы записаны'})).toBeVisible();
  await b.d.getByRole('button', {name: 'Подтвердить запись'}).click();
  // The loser is sent back to the time grid with an explanation; the slot is now marked taken.
  await expect(b.d.getByText('Это время только что заняли')).toBeVisible();
  await expect(b.d.getByRole('radio', {name: `${t}, занято`})).toBeDisabled();
  await a.ctx.close();
  await b.ctx.close();
});
