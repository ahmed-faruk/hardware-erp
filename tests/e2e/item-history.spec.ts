import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

test('the product screen shows every movement with the balance after it, including the imported history', async ({
  page,
}) => {
  const f = newCashierFixture();
  // an imported sale of this product in 2020: a line without any stock movement
  const legacyId = '0190f000-0000-7000-8000-0000000007a1';
  sql(`delete from sales_invoice_lines where invoice_id = '${legacyId}'`);
  sql(`delete from sales_invoices where id = '${legacyId}'`);
  sql(
    `insert into sales_invoices (id, company_id, number, issued_at, subtotal, total, status, is_legacy) values ('${legacyId}', '${COMPANY}', 'OSPOS-HIST-1', '2020-01-10 10:00:00+02', 1500, 1500, 'posted', true)`,
  );
  sql(
    `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost, line_discount, is_legacy) values (gen_random_uuid(), '${COMPANY}', '${legacyId}', 1, '${productId(2)}', 1000, 2000, 750, 1500, 400, 0, true)`,
  );

  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
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
  await expect(table).toContainText('OSPOS-HIST-1');
  await expect(table).toContainText(strings.reports.legacyTag);
  const now =
    Number(sql(`select coalesce(sum(qty), 0) from stock_movements where product_id = '${productId(2)}'`)) /
    1000;
  await expect(page.getByTestId('history-balance')).toContainText(String(now));
});
