import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, loginAs } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

test('the product screen shows every movement with the balance after it, including the imported history', async ({
  page,
}) => {
  const f = newCashierFixture();
  // an imported sale of this product in 2020: a line without any stock movement
  // an imported sale of this product in 2020 (compact history tables: it never had a stock movement)
  sql(`update products set legacy_item_id = 880002 where id = '${productId(2)}'`);
  sql(`delete from legacy_sale_lines where sale_id = 800101`);
  sql(`delete from legacy_sales where id = 800101`);
  sql(
    `insert into legacy_sales (company_id, id, kind, day, total, cash) values ('${COMPANY}', 800101, 0, '2020-01-10', 1500, 1500)`,
  );
  sql(
    `insert into legacy_sale_lines (sale_id, line_no, product_id, qty, net, cost) values (800101, 1, 880002, 2000, 1500, 800)`,
  );
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  // one sale from this device
  await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await page
    .locator(`[data-testid="tile-${productId(2)}"] button`)
    .first()
    .click();
  await page.locator('[data-testid="pay"]:visible').first().click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await expect
    .poll(() => sql(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`), {
      timeout: 60_000,
    })
    .toBe('1');

  await page.evaluate((id) => (window.location.hash = `#/products/${id}`), productId(2));
  await page.getByTestId('product-view-history').click();
  await page.getByTestId('history-all').click();
  const table = page.getByTestId('report-table-0');
  await expect(table).toContainText(`${f.prefix}-INV-000001`);
  await expect(table).toContainText('LG-INV-800101');
  await expect(table).toContainText(strings.reports.legacyTag);
  const now =
    Number(sql(`select coalesce(sum(qty), 0) from stock_movements where product_id = '${productId(2)}'`)) /
    1000;
  await expect(page.getByTestId('history-balance')).toContainText(String(now));
});
