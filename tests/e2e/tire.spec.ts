import {expect, test} from '@playwright/test';

/**
 * Tyre service: calculator → server-priced slots → plate → confirmation.
 * Runs against the Czech demo «pneuservis-ukazka» (a preview studio: the
 * booking is flagged as demo). Locally it needs `pnpm tenant:publish
 * pneuservis-ukazka --local`; against a deployed site set E2E_BASE_URL.
 */
const SLUG = 'pneuservis-ukazka';

test.use({locale: 'cs-CZ', timezoneId: 'Europe/Prague'});

test('a SUV on alloy R17 is priced by the matrix and booked with a plate', async ({page}) => {
  await page.goto(`/s/${SLUG}/`);
  const calc = page.getByRole('region', {name: 'Kalkulačka ceny'});
  await calc.scrollIntoViewIfNeeded();
  await calc.getByRole('radio', {name: 'SUV / 4×4'}).click();
  await calc.getByRole('radio', {name: 'Alu'}).click();
  await calc.getByRole('combobox', {name: 'Průměr'}).click();
  await page.getByRole('option', {name: 'R17', exact: true}).click();
  await expect(calc.getByTestId('tire-price')).toHaveText(/750\sKč za 4 kola/);

  // Two wheels: half the price.
  await calc.getByLabel('Počet kol').fill('2');
  await calc.getByLabel('Počet kol').press('Enter');
  await expect(calc.getByTestId('tire-price')).toHaveText(/375\sKč za 2 kola/);
  await calc.getByLabel('Počet kol').fill('4');
  await calc.getByLabel('Počet kol').press('Enter');

  await calc.getByRole('button', {name: 'Vybrat termín'}).click();
  const sheet = page.getByRole('dialog');
  // The heading is the server's label: the price was recomputed by the database.
  await expect(sheet.getByRole('heading', {level: 2}).first()).toHaveText('Přezutí kompletních kol + vyvážení — SUV / 4×4, Alu R17, 4×');
  await expect(sheet.getByText(/1 h · 750\sKč za 4 kola|750\sKč za 4 kola/).first()).toBeVisible();
  await sheet.getByRole('radiogroup', {name: /čas/i}).getByRole('radio').first().click();
  await sheet.getByRole('button', {name: 'Pokračovat'}).click();

  await sheet.getByLabel('Jméno', {exact: true}).fill('E2E Pneu');
  await sheet.getByLabel('Telefon', {exact: true}).fill(`777 ${String(Date.now()).slice(-6, -3)} ${String(Date.now()).slice(-3)}`);
  await sheet.getByLabel('Vůz', {exact: true}).fill('Škoda Kodiaq');
  await sheet.getByRole('button', {name: 'Zkontrolovat rezervaci'}).click();
  await expect(sheet.getByText('Zadejte SPZ')).toBeVisible();
  await sheet.getByLabel('SPZ', {exact: true}).fill('1e2 3456');
  await sheet.getByLabel('Rozměr pneu').fill('235/55 R17');
  await sheet.getByRole('button', {name: 'Zkontrolovat rezervaci'}).click();

  await expect(sheet.getByText('1E23456')).toBeVisible();
  await sheet.getByRole('button', {name: 'Potvrdit rezervaci'}).click();
  await expect(sheet.getByText('Jste objednáni')).toBeVisible();
  await expect(sheet.getByText(/750\sKč/).first()).toBeVisible();
  await expect(sheet.getByText('1E23456')).toBeVisible();
});

test('the home page shows the tyre price list and seasons, not detailing cards', async ({page}) => {
  await page.goto(`/s/${SLUG}/`);
  await expect(page.getByRole('heading', {name: 'Ceník pneuservisu'})).toBeVisible();
  await expect(page.getByRole('heading', {name: 'Sezóna přezouvání'})).toBeVisible();
  await expect(page.getByText('Uskladnění pneumatik')).toBeVisible();
  // A van on R20+ is priced on request, never as 0 Kč.
  const calc = page.getByRole('region', {name: 'Kalkulačka ceny'});
  await calc.getByRole('radio', {name: 'Dodávka'}).click();
  await calc.getByRole('combobox', {name: 'Průměr'}).click();
  await page.getByRole('option', {name: 'R21', exact: true}).click();
  await expect(calc.getByTestId('tire-price')).toHaveText('Cena na dotaz');
});
