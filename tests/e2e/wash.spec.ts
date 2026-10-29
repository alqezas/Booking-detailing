import {expect, test} from '@playwright/test';

/**
 * Car wash: program + class + extras priced by the price list → server-priced
 * slots → required plate → confirmation. Runs against the Czech demo
 * «myti-ukazka» (a preview studio: the booking is flagged as demo). Locally it
 * needs `pnpm tenant:publish myti-ukazka --local`; against a deployed site set
 * E2E_BASE_URL.
 */
const SLUG = 'myti-ukazka';

test.use({locale: 'cs-CZ', timezoneId: 'Europe/Prague'});

test('a SUV complete wash with wax is priced by class and booked with a plate', async ({page}) => {
  await page.goto(`/s/${SLUG}/`);
  const calc = page.getByRole('region', {name: 'Kalkulačka ceny'});
  await calc.scrollIntoViewIfNeeded();
  await calc.getByRole('combobox', {name: 'Program'}).click();
  await page.getByRole('option', {name: /Kompletní mytí/}).click();
  await calc.getByRole('combobox', {name: 'Velikost auta'}).click();
  await page.getByRole('option', {name: 'SUV / MPV'}).click();
  await expect(calc.getByTestId('wash-price')).toHaveText(/1\s800\sKč/);
  await calc.getByRole('checkbox', {name: /Tvrdý vosk/}).click();
  await expect(calc.getByTestId('wash-price')).toHaveText(/3\s600\sKč/);

  await calc.getByRole('button', {name: 'Vybrat termín'}).click();
  const sheet = page.getByRole('dialog');
  // The heading is the server's label: the database recomputed the price.
  await expect(sheet.getByRole('heading', {level: 2}).first()).toHaveText('Kompletní mytí — SUV / MPV + Tvrdý vosk');
  await sheet.getByRole('radiogroup', {name: /čas/i}).getByRole('radio').first().click();
  await sheet.getByRole('button', {name: 'Pokračovat'}).click();

  await sheet.getByLabel('Jméno', {exact: true}).fill('E2E Mytí');
  await sheet.getByLabel('Telefon', {exact: true}).fill(`777 ${String(Date.now()).slice(-6, -3)} ${String(Date.now()).slice(-3)}`);
  await sheet.getByLabel('Vůz', {exact: true}).fill('Škoda Kodiaq');
  await sheet.getByRole('button', {name: 'Zkontrolovat rezervaci'}).click();
  await expect(sheet.getByText('Zadejte SPZ')).toBeVisible();
  await sheet.getByLabel('SPZ', {exact: true}).fill('1e2 3456');
  await sheet.getByRole('button', {name: 'Zkontrolovat rezervaci'}).click();

  await expect(sheet.getByText('1E23456').filter({visible: true}).first()).toBeVisible();
  await sheet.getByRole('button', {name: 'Potvrdit rezervaci'}).click();
  await expect(sheet.getByText('Jste objednáni')).toBeVisible();
  await expect(sheet.getByText(/3\s600\sKč/).filter({visible: true}).first()).toBeVisible();
  await expect(sheet.getByText('3 h 15 min').filter({visible: true}).first()).toBeVisible();
});

test('the home page shows prices by class, extras and peak hours', async ({page}) => {
  await page.goto(`/s/${SLUG}/`);
  await expect(page.getByRole('heading', {name: 'Ceník mytí'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Kdy se objednat'})).toBeVisible();
  await expect(page.getByText(/jen bez objednání, živou frontou/)).toBeVisible();
  // A van interior is priced on request, never as 0 Kč.
  const calc = page.getByRole('region', {name: 'Kalkulačka ceny'});
  await calc.getByRole('combobox', {name: 'Program'}).click();
  await page.getByRole('option', {name: /Čištění interiéru/}).click();
  await calc.getByRole('combobox', {name: 'Velikost auta'}).click();
  await page.getByRole('option', {name: 'Dodávka'}).click();
  await expect(calc.getByTestId('wash-price')).toHaveText('Cena na dotaz');
});
