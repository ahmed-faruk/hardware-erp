import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { addWorker, newFixture, sql, type Fixture, loginAs, type Who } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

/** A product with history on the server: an opening and a sale that leave `stock` pcs. */
function productWithHistory(stock: number): { id: string; name: string; barcode: string } {
  const id = randomUUID();
  const name = `صنف أرشيف ${randomUUID().slice(0, 5)}`;
  const barcode = `7${Date.now()}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 13);
  sql(
    `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals) values ('${id}', '${COMPANY}', 'A${id.slice(0, 6)}', '${name}', 'pcs', 1000, 500, 0)`,
  );
  sql(
    `insert into barcodes (id, company_id, product_id, code) values ('${randomUUID()}', '${COMPANY}', '${id}', '${barcode}')`,
  );
  for (const [q, doc] of [
    [(stock + 1) * 1000, 'opening'],
    [-1000, 'sales_invoice'],
  ] as const)
    sql(
      `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', '${id}', 'a0000000-0000-7000-8000-0000000000c1', ${q}, 500, '${doc}', '${randomUUID()}', now())`,
    );
  return { id, name, barcode };
}

async function login(page: Page, f: Fixture, who: Who): Promise<void> {
  await loginAs(page, f, who);
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

const open = (page: Page, id: string) => page.evaluate((x) => (window.location.hash = `#/products/${x}`), id);

test.describe('archive and restore a product with history', () => {
  test('at stock 0 the manager archives it (undo toast), finds it under «المحذوف» and restores it', async ({
    page,
  }) => {
    const f = newFixture();
    const p = productWithHistory(0);
    await login(page, f, 'manager');
    await open(page, p.id);
    await page.getByTestId('delete-product').click();
    await expect(page.getByTestId('undo-toast')).toContainText(strings.products.archiving);
    await expect(page.getByTestId('product-search')).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(() => sql(`select count(*) from products where id = '${p.id}' and deleted_at is not null`), {
        timeout: 60_000,
      })
      .toBe('1');
    // gone from the normal list, there under the archived filter with its mark
    await page.getByTestId('product-search').fill(p.name);
    await expect(page.getByText(p.name)).toHaveCount(0);
    await page.getByTestId('archived-filter').check();
    await expect(page.getByTestId(`archived-mark-${p.id}`)).toBeVisible();
    await page.getByTestId(`restore-${p.id}`).click();
    await expect(page.getByText(strings.products.restored)).toBeVisible();
    await expect
      .poll(() => sql(`select count(*) from products where id = '${p.id}' and deleted_at is null`), {
        timeout: 60_000,
      })
      .toBe('1');
    await expect
      .poll(() => sql(`select count(*) from barcodes where product_id = '${p.id}' and deleted_at is null`), {
        timeout: 60_000,
      })
      .toBe('1');
    await page.getByTestId('archived-filter').uncheck();
    await expect(page.getByText(p.name).first()).toBeVisible();
  });

  test('with stock on hand it says to adjust stock first and changes nothing', async ({ page }) => {
    const f = newFixture();
    const p = productWithHistory(3);
    await login(page, f, 'manager');
    await open(page, p.id);
    await page.getByTestId('delete-product').click();
    await expect(page.getByText(strings.products.archiveNeedsZeroStock)).toBeVisible();
    await expect(page.getByTestId('delete-blocked')).toContainText(strings.products.deleteReasons.stock);
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    expect(sql(`select count(*) from products where id = '${p.id}' and deleted_at is null`)).toBe('1');
  });

  test('a storekeeper cannot archive a product with history and has no archived filter', async ({ page }) => {
    const f = newFixture();
    const keeper = addWorker('storekeeper');
    const p = productWithHistory(0);
    await login(page, f, keeper);
    await expect(page.getByTestId('archived-filter')).toHaveCount(0);
    await open(page, p.id);
    await page.getByTestId('delete-product').click();
    await expect(page.getByTestId('delete-blocked')).toContainText(strings.products.deleteReasons.movements);
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    expect(sql(`select count(*) from products where id = '${p.id}' and deleted_at is null`)).toBe('1');
  });
});
