import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const SECOND = 'a0000000-0000-7000-8000-0000000ca002';

test('sales in two categories show as bars, KPIs and a table that equal the database', async ({ page }) => {
  const f = newCashierFixture();
  sql(
    `insert into categories (id, company_id, name, color_token, icon, sort) values ('${SECOND}', '${COMPANY}', 'سباكة اختبار', 'cat-2', 'wrench', -2) on conflict (id) do nothing`,
  );
  sql(`update products set category_id = '${SECOND}' where id = '${productId(3)}'`);

  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  // 15.00 from the first category and 17.50 from the second, on one invoice
  await page.getByRole('button', { name: 'قسم الكاشير' }).click();
  await page
    .locator(`[data-testid="tile-${productId(2)}"] button`)
    .first()
    .click();
  await page.getByRole('button', { name: 'سباكة اختبار' }).click();
  await page
    .locator(`[data-testid="tile-${productId(3)}"] button`)
    .first()
    .click();
  await page.locator('[data-testid="pay"]:visible').first().click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('40');
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await expect
    .poll(() => sql(`select total from sales_invoices where number = '${f.prefix}-INV-000001'`), {
      timeout: 60_000,
    })
    .toBe('3250');

  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-categories').click();
  await page.getByTestId('period-today').click();
  await expect(page.getByTestId('chart-bars')).toBeVisible();
  await expect(page.getByTestId(`bar-${SECOND}`)).toBeVisible();
  await expect(page.getByTestId('chart-days')).toBeVisible();
  await expect(page.getByTestId('kpi-active')).toContainText('2');
  // the test database keeps the sales of earlier runs: compare with what the database says for today
  const today = `(now() at time zone 'Africa/Cairo')::date`;
  const revenue = (where: string) =>
    (
      Number(
        sql(
          `select coalesce(sum(l.net_amount - l.alloc_discount), 0) from sales_invoice_lines l join sales_invoices i on i.id = l.invoice_id join products p on p.id = l.product_id where i.status = 'posted' and (i.issued_at at time zone 'Africa/Cairo')::date = ${today} and ${where}`,
        ),
      ) / 100
    ).toFixed(2);
  const table = page.getByTestId('report-table-0');
  await expect(table).toContainText('سباكة اختبار');
  await expect(table).toContainText(revenue(`p.category_id = '${SECOND}'`));
  await expect(page.getByTestId('report-totals-0')).toContainText(revenue('true'));
});
