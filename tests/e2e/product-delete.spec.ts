import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newFixture, productId, sql, type Fixture } from './helpers';

const run = Math.random().toString(36).slice(2, 7);
const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const price = `${strings.products.price} (${strings.common.egp})`;
const reasons = strings.products.deleteReasons;

async function activateAndLogin(page: Page, f: Fixture): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

const openProduct = (page: Page, id: string) =>
  page.evaluate((x) => (window.location.hash = `#/products/${x}`), id);

test.describe('delete a product', () => {
  test('an unused product: undo keeps it, letting the toast run out deletes it everywhere', async ({
    page,
  }) => {
    const f = newFixture();
    await activateAndLogin(page, f);
    const name = `صنف للحذف ${run}`;
    await page.getByRole('button', { name: strings.nav.products }).click();
    await page.getByTestId('new-product').click();
    await page.getByTestId('product-name').fill(name);
    await page.getByLabel(price).fill('10');
    await page.getByTestId('barcode-0').fill(`9${Date.now()}`.slice(0, 13));
    await page.getByTestId('save-product').click();
    await expect
      .poll(() => sql(`select count(*) from products where name = '${name}'`), { timeout: 60_000 })
      .toBe('1');

    await page.getByTestId('product-search').fill(name);
    await page.getByText(name).first().click();
    // undo within the toast: nothing is deleted
    await page.getByTestId('delete-product').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await page.getByRole('button', { name: strings.sell.undo }).click();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await page.waitForTimeout(1500);
    expect(sql(`select count(*) from products where name = '${name}' and deleted_at is null`)).toBe('1');

    // let it run out
    await page.getByTestId('delete-product').click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect(page.getByTestId('product-search')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => sql(`select count(*) from products where name = '${name}' and deleted_at is not null`), {
        timeout: 60_000,
      })
      .toBe('1');
    // gone from the list and from search
    await page.getByTestId('product-search').fill(name);
    await expect(page.getByText(name)).toHaveCount(0);
    await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
  });

  test('a product with a stock movement or with imported history cannot be deleted, and says why', async ({
    page,
  }) => {
    const f = newFixture();
    const moved = productId(9);
    const old = productId(10);
    const doc = '0190f000-0000-7000-8000-00000000d0c1';
    sql(
      `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values ('${doc}', '${COMPANY}', '${moved}', 'a0000000-0000-7000-8000-0000000000c1', 2000, 100, 'opening', '${doc}', now())`,
    );
    sql(`update products set legacy_item_id = 880010 where id = '${old}'`);
    sql(`delete from legacy_sales where id = 800301`);
    sql(
      `insert into legacy_sales (company_id, id, kind, day, total, cash) values ('${COMPANY}', 800301, 0, '2020-03-01', 500, 500)`,
    );
    sql(
      `insert into legacy_sale_lines (sale_id, line_no, product_id, qty, net, cost) values (800301, 1, 880010, 1000, 500, 300)`,
    );
    try {
      await activateAndLogin(page, f);
      await openProduct(page, moved);
      await page.getByTestId('delete-product').click();
      await expect(page.getByTestId('delete-blocked')).toContainText(reasons.movements);
      await expect(page.getByTestId('delete-blocked')).toContainText(reasons.stock);
      await expect(page.getByTestId('undo-toast')).toHaveCount(0);

      await openProduct(page, old);
      await page.getByTestId('delete-product').click();
      await expect(page.getByTestId('delete-blocked')).toContainText(reasons.legacy);
      expect(
        sql(`select count(*) from products where id in ('${moved}', '${old}') and deleted_at is null`),
      ).toBe('2');
    } finally {
      sql(`delete from stock_movements where id = '${doc}'`);
      sql(`delete from legacy_sale_lines where sale_id = 800301`);
      sql(`delete from legacy_sales where id = 800301`);
      sql(`update products set legacy_item_id = null where id = '${old}'`);
    }
  });

  test('offline it says it needs the internet and changes nothing', async ({ page, context }) => {
    const f = newFixture();
    await activateAndLogin(page, f);
    await openProduct(page, productId(11));
    await expect(page.getByTestId('delete-product')).toBeVisible();
    await context.setOffline(true);
    await page.getByTestId('delete-product').click();
    await expect(page.getByText(strings.products.deleteNeedsNet)).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await context.setOffline(false);
    expect(sql(`select count(*) from products where id = '${productId(11)}' and deleted_at is null`)).toBe(
      '1',
    );
  });
});
