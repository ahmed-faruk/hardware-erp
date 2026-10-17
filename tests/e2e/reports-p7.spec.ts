import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture, loginAs } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const WAREHOUSE = 'a0000000-0000-7000-8000-0000000000c1';
const CUSTOMER = 'a0000000-0000-7000-8000-000000000c01';

async function loginManager(page: Page, f: CashierFixture): Promise<void> {
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.reports }).click();
}

test('P7: the purchases report lists invoices under each supplier, with counts and top products, and filters to one supplier', async ({
  page,
}) => {
  const f = newCashierFixture();
  const run = randomUUID().slice(0, 5);
  const names = [`مورد ${run} أ`, `مورد ${run} ب`];
  const ids = [randomUUID(), randomUUID()];
  ids.forEach((id, i) =>
    sql(`insert into suppliers (id, company_id, name) values ('${id}', '${COMPANY}', '${names[i]}')`),
  );
  const buy = (n: number, sup: string, prod: number, net: number): string => {
    const id = randomUUID();
    const number = `Z${run}-PUR-${900000 + n}`;
    sql(
      `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${id}', '${COMPANY}', '${number}', now(), '${sup}', '${WAREHOUSE}', ${net}, ${net})`,
    );
    sql(
      `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${id}', 1, '${productId(prod)}', 1000, 1000, ${net}, ${net})`,
    );
    return number;
  };
  const a1 = buy(1, ids[0]!, 5, 3000);
  const a2 = buy(2, ids[0]!, 5, 1000);
  const b1 = buy(3, ids[1]!, 6, 8000);
  await loginManager(page, f);
  await page.getByTestId('report-tab-purchases').click();
  const body = page.locator('main');
  await expect(body).toContainText(`${names[0]} · ${strings.reports.invoices}: 2`);
  await expect(body).toContainText(`${names[1]} · ${strings.reports.invoices}: 1`);
  for (const n of [a1, a2, b1]) await expect(body).toContainText(n);
  // the top product of the first supplier is the one bought on both invoices, at 30.00 + 10.00
  await expect(body).toContainText('Test product 5 (40.00)');
  // one supplier only
  await page.getByTestId('report-supplier').selectOption(ids[1]!);
  await expect(body).toContainText(b1);
  await expect(body).not.toContainText(a1);
  await expect(body).not.toContainText(`${names[0]} · ${strings.reports.invoices}`);
});

test('P7: the smart report shows the returns of today and the most returned products', async ({ page }) => {
  const f = newCashierFixture();
  const inv = randomUUID();
  const invLine = randomUUID();
  const ret = randomUUID();
  const run = randomUUID().slice(0, 5).toUpperCase();
  sql(
    `insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status, customer_id) values ('${inv}', '${COMPANY}', 'Z${run}-INV-900001', now(), 1000, 1000, 'posted', '${CUSTOMER}')`,
  );
  sql(
    `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost) values ('${invLine}', '${COMPANY}', '${inv}', 1, '${productId(5)}', 1000, 4000, 250, 1000, 100)`,
  );
  sql(
    `insert into sales_returns (id, company_id, number, issued_at, total, refund_method, original_invoice_id) values ('${ret}', '${COMPANY}', 'Z${run}-RET-900001', now(), 250, 'cash', '${inv}')`,
  );
  sql(
    `insert into sales_return_lines (id, company_id, return_id, product_id, qty, unit_refund, net_amount, unit_cost, original_line_id) values ('${randomUUID()}', '${COMPANY}', '${ret}', '${productId(5)}', 1000, 250, 250, 100, '${invLine}')`,
  );
  await loginManager(page, f);
  const smart = page.getByTestId('smart-report');
  await expect(smart).toBeVisible();
  await expect(smart).toContainText(strings.reports.smart.kpiSalesBack);
  await expect(smart).toContainText(strings.reports.smart.kpiPurchasesBack);
  await expect(page.getByTestId('smart-returned')).toContainText('Test product 5', { timeout: 30_000 });
  await expect(page.getByTestId('smart-returned')).toContainText(strings.reports.smart.returnedShare);
});
