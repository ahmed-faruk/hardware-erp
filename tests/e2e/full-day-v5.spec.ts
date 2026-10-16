import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

/**
 * One shop day across this release on two devices: sell, return, void the return, return to a supplier without an invoice,
 * archive and restore a product, search invoices from the other device, and the reports; then an offline variant.
 */
const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const WAREHOUSE = 'a0000000-0000-7000-8000-0000000000c1';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function activate(page: Page, f: CashierFixture): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

async function openShift(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

async function sellOne(page: Page): Promise<void> {
  await page
    .locator(`[data-testid="tile-${productId(2)}"] button`)
    .first()
    .click(); // 15.00
  await vis(page, 'pay').click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('20');
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await page.getByTestId('new-sale').click();
}

const count = (q: string) => sql(q);

test('a whole day on two devices: sell, return, void the return, supplier return, archive, search from the other device, reports', async ({
  browser,
  page,
}) => {
  const a = newCashierFixture();
  const b = newCashierFixture();
  // a supplier that sold us product 5 at 5.00 a piece, and a product with history at stock 0
  const run = randomUUID().slice(0, 6);
  const sid = randomUUID();
  const supplier = `مورد اليوم ${run}`;
  sql(`insert into suppliers (id, company_id, name) values ('${sid}', '${COMPANY}', '${supplier}')`);
  const inv = randomUUID();
  sql(
    `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${COMPANY}', 'Z${run.toUpperCase()}-PUR-1', now(), '${sid}', '${WAREHOUSE}', 5000, 5000)`,
  );
  sql(
    `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${inv}', 1, '${productId(5)}', 1000, 10000, 500, 5000)`,
  );
  const archived = randomUUID();
  const archivedName = `صنف اليوم ${run}`;
  sql(
    `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals) values ('${archived}', '${COMPANY}', 'D${archived.slice(0, 6)}', '${archivedName}', 'pcs', 1000, 500, 0)`,
  );
  for (const [q, doc] of [
    [1000, 'opening'],
    [-1000, 'sales_invoice'],
  ] as const)
    sql(
      `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', '${archived}', '${WAREHOUSE}', ${q}, 500, '${doc}', '${randomUUID()}', now())`,
    );

  // device A: a sale, a return of it, the return voided
  await activate(page, a);
  await openShift(page);
  await sellOne(page);
  await page.getByTestId('return').click();
  await page.getByTestId(`return-${a.prefix}-INV-000001`).click();
  await page.getByTestId('plus-1').click();
  await page.getByTestId('confirm-return').click();
  const ret = `${a.prefix}-RET-000001`;
  await expect
    .poll(() => count(`select count(*) from sales_returns where number = '${ret}'`), { timeout: 60_000 })
    .toBe('1');
  await page.getByTestId('recent').click();
  await page.getByTestId(`view-${a.prefix}-INV-000001`).click();
  await page.getByTestId(`void-return-${ret}`).click();
  await page.getByTestId('void-reason-mistake').click();
  await expect
    .poll(() => count(`select status from sales_returns where number = '${ret}'`), { timeout: 60_000 })
    .toBe('voided');
  expect(
    count(
      `select coalesce(sum(m.amount), 0) from cash_movements m join cash_accounts c on c.id = m.cash_account_id where c.owner_device_id = '${a.deviceId}'`,
    ),
  ).toBe('1500');

  // device A: return to the supplier without an invoice at the last price
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase-return').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: supplier });
  await page.getByTestId('return-mode-plain').click();
  await page.getByTestId('product-picker').fill('Test product 5');
  await page.getByTestId('product-picker').press('Enter');
  await expect(page.getByLabel(strings.purchases.returnValue)).toHaveValue('5.00');
  await page.getByTestId('save-purchase-return').click();
  await expect
    .poll(
      () =>
        count(
          `select count(*) || ':' || coalesce(sum(total), 0) from purchase_returns r where r.supplier_id = '${sid}'`,
        ),
      { timeout: 60_000 },
    )
    .toBe('1:500');

  // device A: archive a product with history at stock 0, then restore it
  await page.evaluate((id) => (window.location.hash = `#/products/${id}`), archived);
  await page.getByTestId('delete-product').click();
  await expect(page.getByTestId('product-search')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => count(`select count(*) from products where id = '${archived}' and deleted_at is not null`), {
      timeout: 60_000,
    })
    .toBe('1');
  await page.getByTestId('product-search').fill(archivedName);
  await page.getByTestId('archived-filter').check();
  await page.getByTestId(`restore-${archived}`).click();
  await expect
    .poll(() => count(`select count(*) from products where id = '${archived}' and deleted_at is null`), {
      timeout: 60_000,
    })
    .toBe('1');

  // the purchases report names the supplier with its invoice, and the smart report counts the returns of today
  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-purchases').click();
  await expect(page.locator('main')).toContainText(`${supplier} · ${strings.reports.invoices}: 1`);
  await page.getByTestId('report-tab-smart').click();
  await expect(page.getByTestId('smart-report')).toContainText(strings.reports.smart.kpiPurchasesBack);

  // device B (another manager device) finds A's invoice by its number, from its own copy of the data
  const ctxB = await browser.newContext();
  const pageB = await ctxB.newPage();
  try {
    await activate(pageB, b);
    await pageB.getByRole('button', { name: strings.nav.salesInvoices }).click();
    await pageB.getByTestId('f-number').fill(a.prefix);
    await expect(pageB.getByTestId(`view-${a.prefix}-INV-000001`)).toBeVisible({ timeout: 60_000 });
    // the voided return no longer marks the invoice as returned
    await expect(pageB.getByTestId(`status-${a.prefix}-INV-000001`)).toHaveText(
      strings.invoiceSearch.statusPosted,
    );
  } finally {
    await ctxB.close();
  }
});

test('offline variant: a sale made offline is found by number offline, and reaches the server once', async ({
  page,
  context,
}) => {
  const f = newCashierFixture();
  await activate(page, f);
  await openShift(page);
  // the screens load their code when first opened: open the invoices screen once while online
  await page.getByRole('button', { name: strings.nav.salesInvoices }).click();
  await expect(page.getByTestId('invoice-filters')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.sell }).click();
  await context.setOffline(true);
  await sellOne(page);
  await page.getByRole('button', { name: strings.nav.salesInvoices }).click();
  await page.getByTestId('f-number').fill(f.prefix);
  await expect(page.getByTestId(`view-${f.prefix}-INV-000001`)).toBeVisible();
  expect(count(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`)).toBe('0');
  await context.setOffline(false);
  await expect
    .poll(() => count(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`), {
      timeout: 90_000,
    })
    .toBe('1');
  expect(count(`select count(*) from sales_invoices where number like '${f.prefix}-INV-%'`)).toBe('1');
});
