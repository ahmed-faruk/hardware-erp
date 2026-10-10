import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newFixture, sql, type Fixture } from './helpers';

const run = Math.random().toString(36).slice(2, 7);
const barcode = String(Date.now()).slice(-9);
const price = `${strings.products.price} (${strings.common.egp})`;

async function activateAndLogin(page: Page, f: Fixture): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

test.describe('manager journeys', () => {
  test('@smoke activate, log in, create and find a product, then a customer, supplier and worker', async ({
    page,
  }) => {
    const f = newFixture();
    await activateAndLogin(page, f);

    // category
    await page.getByRole('button', { name: strings.nav.categories }).click();
    await page.getByTestId('new-category').click();
    await page.getByTestId('category-name').fill(`دهانات اختبار ${run}`);
    await page.getByTestId('save-category').click();
    await expect(page.getByText(`دهانات اختبار ${run}`)).toBeVisible();

    // product with barcode, price and an icon
    await page.getByRole('button', { name: strings.nav.products }).click();
    await page.getByTestId('new-product').click();
    await page.getByTestId('product-name').fill(`رولة دهان اختبار ${run}`);
    await page.getByLabel(price).fill('45.50');
    await page.getByTestId('barcode-0').fill(barcode);
    await page.getByTestId('choose-icon').click();
    await page.getByPlaceholder(strings.icons.search).fill('رولة');
    await page
      .getByRole('button', { name: /رولة دهان/ })
      .first()
      .click();
    await page.getByTestId('save-product').click();
    await page.getByTestId('product-search').fill(`رولة دهان اختبار ${run}`);
    await expect(page.getByText(`رولة دهان اختبار ${run}`)).toBeVisible();
    await page.getByTestId('product-search').fill(barcode.slice(0, 6));
    await expect(page.getByText(`رولة دهان اختبار ${run}`)).toBeVisible();

    // customer, supplier, worker
    await page.getByRole('button', { name: strings.nav.customers }).click();
    await page.getByTestId('new-customer').click();
    await page.getByTestId('customer-name').fill(`عميل اختبار ${run}`);
    await page.getByTestId('customer-phone').fill('01012345678');
    await page.getByTestId('save-customer').click();
    await expect(page.getByText(`عميل اختبار ${run}`)).toBeVisible();

    await page.getByRole('button', { name: strings.nav.suppliers }).click();
    await page.getByTestId('new-supplier').click();
    await page.getByTestId('supplier-name').fill(`مورد اختبار ${run}`);
    await page.getByTestId('save-supplier').click();
    await expect(page.getByText(`مورد اختبار ${run}`)).toBeVisible();

    await page.getByRole('button', { name: strings.nav.workers }).click();
    await page.getByTestId('new-worker').click();
    await page.getByTestId('worker-name').fill(`كاشير اختبار ${run}`);
    await page.getByTestId('worker-pin').fill('654321');
    await page.getByTestId('worker-pin2').fill('654321');
    await page.getByTestId('save-worker').click();
    await expect(page.getByText(`كاشير اختبار ${run}`)).toBeVisible();

    // everything reaches the server
    await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
    await expect
      .poll(() => sql(`select price from products where name = 'رولة دهان اختبار ${run}'`), {
        timeout: 60_000,
      })
      .toBe('4550');
    await expect
      .poll(() => sql(`select count(*) from barcodes where code = '${barcode}' and deleted_at is null`), {
        timeout: 60_000,
      })
      .toBe('1');
    await expect
      .poll(() => sql(`select count(*) from customers where name = 'عميل اختبار ${run}'`), {
        timeout: 60_000,
      })
      .toBe('1');
    await expect
      .poll(
        () => sql(`select count(*) from workers where name = 'كاشير اختبار ${run}' and pin_hash is not null`),
        { timeout: 60_000 },
      )
      .toBe('1');

    // lock, then the new cashier logs in with the PIN the manager set and sees no manager screens
    await page.getByTestId('lock').click();
    await page.getByRole('button', { name: new RegExp(`كاشير اختبار ${run}`) }).click();
    await page.keyboard.type('654321');
    await page.keyboard.press('Enter');
    await expect(page.getByText(strings.soon.title)).toBeVisible();
    await expect(page.getByRole('button', { name: strings.nav.workers })).toHaveCount(0);
  });

  test('wrong PIN shakes and 5 wrong tries lock the worker', async ({ page }) => {
    const f = newFixture();
    await page.goto('/');
    await page.getByTestId('activation-code').fill(f.code);
    await page.getByTestId('activate').click();
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    for (let i = 0; i < 5; i++) {
      await page.keyboard.type('000000');
      await page.keyboard.press('Enter');
      const dots = page.getByTestId('pin-dots');
      await expect(dots).toHaveClass(/shake/); // a wrong PIN shakes the dots
      await expect(dots).not.toHaveClass(/shake/);
    }
    await expect(page.getByText(strings.login.locked)).toBeVisible();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('sync-status')).toHaveCount(0); // still locked out even with the right PIN
  });

  test('works offline: an edit waits in the outbox and syncs when the connection returns', async ({
    page,
    context,
  }) => {
    const f = newFixture();
    await activateAndLogin(page, f);
    await page.getByTestId('new-product').click();
    await page.getByTestId('product-name').fill(`صنف أوفلاين ${run}`);
    await page.getByLabel(price).fill('10');
    await page.getByTestId('save-product').click();
    // wait until the server really has it (the pending counter reads 0 before the first save is queued)
    await expect
      .poll(() => sql(`select price from products where name = 'صنف أوفلاين ${run}'`), { timeout: 60_000 })
      .toBe('1000');

    await context.setOffline(true);
    await page.getByText(`صنف أوفلاين ${run}`).click();
    await page.getByLabel(price).fill('12.25');
    await page.getByTestId('save-product').click();
    await expect(page.getByTestId('sync-pending')).not.toHaveText('0');
    await expect
      .poll(() => sql(`select price from products where name = 'صنف أوفلاين ${run}'`), { timeout: 60_000 })
      .toBe('1000');

    await context.setOffline(false);
    await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 90_000 });
    await expect
      .poll(() => sql(`select price from products where name = 'صنف أوفلاين ${run}'`), { timeout: 60_000 })
      .toBe('1225');
  });

  test('keyboard only: type a product name and press Enter to save', async ({ page }) => {
    const f = newFixture();
    await activateAndLogin(page, f);
    await page.getByTestId('new-product').focus();
    await page.keyboard.press('Enter');
    await page.getByTestId('product-name').focus();
    await page.keyboard.type(`صنف كيبورد ${run}`);
    await page.keyboard.press('Enter');
    await page.getByTestId('product-search').fill(`صنف كيبورد ${run}`);
    await expect(page.getByText(`صنف كيبورد ${run}`)).toBeVisible();
  });
});
