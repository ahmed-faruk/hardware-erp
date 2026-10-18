import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newFixture, sql, type Fixture, loginAs, typeLogin } from './helpers';

const run = Math.random().toString(36).slice(2, 7);
const barcode = String(Date.now()).slice(-9);
const price = `${strings.products.price} (${strings.common.egp})`;

async function activateAndLogin(page: Page, f: Fixture): Promise<void> {
  await loginAs(page, f, 'manager');
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
    await page.getByRole('navigation').getByRole('button', { name: strings.nav.products }).click();
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
    await page.getByTestId('save-worker').click();
    await expect(page.getByText(`كاشير اختبار ${run}`)).toBeVisible();
    // the worker reaches the server, then the manager gives them a login (username once, password any time)
    await expect
      .poll(() => sql(`select count(*) from workers where name = 'كاشير اختبار ${run}'`), { timeout: 60_000 })
      .toBe('1');
    const cashierUser = `c${run}`.toLowerCase();
    await page.getByText(`كاشير اختبار ${run}`).click();
    await page.getByTestId('worker-username').fill(cashierUser);
    await page.getByTestId('worker-password').fill('654321');
    await page.getByTestId('worker-password2').fill('654321');
    await page.getByTestId('worker-save-login').click();
    await expect(page.getByText(strings.workers.loginSaved)).toBeVisible();
    await page.getByRole('button', { name: strings.common.cancel }).click();

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
        () =>
          sql(
            `select count(*) from workers w join worker_credentials c on c.worker_id = w.id where w.name = 'كاشير اختبار ${run}' and w.username = '${cashierUser}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1');

    // lock, then the new cashier logs in with the login the manager set and sees no manager screens
    await page.getByTestId('lock').click();
    await typeLogin(page, { user: cashierUser, password: '654321' });
    // a cashier lands on the sale screen: the shop box exists, so he is asked to open the shift
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await expect(page.getByRole('button', { name: strings.nav.workers })).toHaveCount(0);
  });

  test('the settings screen has no auto-print switch any more', async ({ page }) => {
    const f = newFixture();
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('button', { name: strings.nav.settings }).click();
    await expect(page.getByTestId('backup-pass')).toBeVisible();
    await expect(page.getByTestId('auto-print')).toHaveCount(0);
  });

  test('5 wrong passwords lock the username, even the right password is refused for a while', async ({
    page,
  }) => {
    const f = newFixture();
    const creds = { user: f.managerUser, password: f.managerPassword };
    await page.goto('/');
    await typeLogin(page, creds); // the first login registers the browser
    await expect(page.getByTestId('login-form')).toBeVisible({ timeout: 300_000 });
    for (let i = 0; i < 5; i++) await typeLogin(page, { ...creds, password: 'wrong-password' });
    await typeLogin(page, creds);
    await expect(page.getByText(strings.login.locked)).toBeVisible();
    await expect(page.getByTestId('sync-status')).toHaveCount(0); // still locked out even with the right password
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
