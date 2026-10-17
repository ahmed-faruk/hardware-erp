import { randomUUID } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { formatMoney } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, loginAs } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const today = `(issued_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date`;

test('F7: the returns tab shows sales and purchase returns of today, equal to the database', async ({
  page,
}) => {
  const f = newCashierFixture();
  // a purchase return dated today, written before the device loads anything
  const supplier = randomUUID();
  const supplierName = `مورد مرتجع ${randomUUID().slice(0, 5)}`;
  const purReturn = randomUUID();
  const purNumber = `ZP${randomUUID().slice(0, 4).toUpperCase()}-PRT-900001`;
  sql(`insert into suppliers (id, company_id, name) values ('${supplier}', '${COMPANY}', '${supplierName}')`);
  sql(
    `insert into purchase_returns (id, company_id, number, issued_at, supplier_id, total) values ('${purReturn}', '${COMPANY}', '${purNumber}', now(), '${supplier}', 4200)`,
  );
  sql(
    `insert into purchase_return_lines (id, company_id, return_id, line_no, product_id, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${purReturn}', 1, '${productId(5)}', 2000, 2100, 4200)`,
  );

  // printing is swallowed so Firefox does not open a real print dialog
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  // a sale and a return of one unit by invoice
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
  await page.getByTestId('new-sale').click();
  await page.getByTestId('return').click();
  await page.getByTestId(`return-${f.prefix}-INV-000001`).click();
  await page.getByTestId('plus-1').click();
  await page.getByTestId('confirm-return').click();
  await expect
    .poll(() => sql(`select count(*) from sales_returns where number = '${f.prefix}-RET-000001'`), {
      timeout: 60_000,
    })
    .toBe('1');

  const salesCount = sql(
    `select count(*) from sales_returns where status = 'posted' and is_legacy = false and ${today}`,
  );
  const salesTotal = Number(
    sql(
      `select coalesce(sum(total), 0) from sales_returns where status = 'posted' and is_legacy = false and ${today}`,
    ),
  );
  const purTotal = Number(
    sql(`select coalesce(sum(total), 0) from purchase_returns where status = 'posted' and ${today}`),
  );

  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-returns').click();
  await page.getByTestId('period-today').click();
  // sales returns (default): the count and the amount, the reason as «غير مسجّل» is not used (the return dialog saves none)
  const table = page.getByTestId('report-table-0');
  await expect(table).toBeVisible();
  await expect(table).toContainText(formatMoney(salesTotal));
  await expect(table.locator('tbody tr').first().locator('td').first()).toHaveText(salesCount);
  await expect(page.getByTestId('report-table-5')).toContainText(`${f.prefix}-RET-000001`);
  await expect(page.getByTestId('report-totals-1')).toContainText(formatMoney(salesTotal));

  // purchase returns
  await page.getByTestId('returns-kind-purchases').click();
  await expect(page.getByTestId('report-table-0')).toContainText(formatMoney(purTotal));
  await expect(page.getByTestId('report-table-1')).toContainText(supplierName);
  await expect(page.getByTestId('report-table-4')).toContainText(purNumber);
  expect(sql(`select count(*) from purchase_returns where number = '${purNumber}'`)).toBe('1');
});
