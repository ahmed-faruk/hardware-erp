import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { addWorker, newCashierFixture, productId, sql, type CashierFixture, deviceCash } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const WAREHOUSE = 'a0000000-0000-7000-8000-0000000000c1';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function login(page: Page, f: CashierFixture, who: { name: string; pin: string }): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(who.name) }).click();
  await page.keyboard.type(who.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

/** A purchase of 10 pcs of a brand-new product at 5.00 on credit, with its stock and supplier rows, on the server. */
function purchaseOnServer(): { number: string; supplier: string; product: string } {
  const run = randomUUID().slice(0, 6);
  const sid = randomUUID();
  const inv = randomUUID();
  const prod = randomUUID();
  const number = `ZV-PUR-${run.toUpperCase()}`;
  const supplier = `مورد حذف ${run}`;
  sql(`insert into suppliers (id, company_id, name) values ('${sid}', '${COMPANY}', '${supplier}')`);
  sql(
    `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals) values ('${prod}', '${COMPANY}', 'V${prod.slice(0, 6)}', 'صنف حذف ${run}', 'pcs', 1000, 500, 0)`,
  );
  sql(
    `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${COMPANY}', '${number}', now() - interval '3 days', '${sid}', '${WAREHOUSE}', 5000, 5000)`,
  );
  const line = randomUUID();
  sql(
    `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${line}', '${COMPANY}', '${inv}', 1, '${prod}', 1000, 10000, 500, 5000)`,
  );
  sql(
    `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, line_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', '${prod}', '${WAREHOUSE}', 10000, 500, 'purchase_invoice', '${inv}', '${line}', now() - interval '3 days')`,
  );
  sql(
    `insert into party_ledger (id, company_id, party_type, party_id, amount, doc_type, doc_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', 'supplier', '${sid}', -5000, 'purchase_invoice', '${inv}', now() - interval '3 days')`,
  );
  return { number, supplier, product: prod };
}

test.describe('delete invoices', () => {
  test('the manager deletes a cash sales invoice from the sales invoices screen: status, drawer and reports follow', async ({
    page,
  }) => {
    const f = newCashierFixture();
    await login(page, f, { name: f.managerName, pin: f.pin });
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await page
      .locator(`[data-testid="tile-${productId(2)}"] button`)
      .first()
      .click();
    await vis(page, 'pay').click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await page.getByTestId('new-sale').click();
    const number = `${f.prefix}-INV-000001`;
    await expect
      .poll(() => sql(`select count(*) from sales_invoices where number = '${number}'`), { timeout: 60_000 })
      .toBe('1');
    await page.getByRole('button', { name: strings.nav.salesInvoices }).click();
    await page.getByTestId('f-number').fill(f.prefix);
    await page.getByTestId(`delete-${number}`).click();
    await page.getByTestId('void-reason-mistake').click();
    await expect(page.getByText(strings.voidInvoice.done)).toBeVisible();
    await expect(page.getByTestId(`status-${number}`)).toHaveText(strings.invoiceSearch.statusVoided);
    await expect(page.getByTestId(`delete-${number}`)).toHaveCount(0);
    await expect
      .poll(() => sql(`select status from sales_invoices where number = '${number}'`), { timeout: 60_000 })
      .toBe('voided');
    // the cash left the open drawer again: the invoice and its delete cancel out
    expect(String(deviceCash(f.prefix))).toBe('0');
    // the exceptions report lists the delete with what it targeted
    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-exceptions').click();
    await expect(page.locator('main')).toContainText(number);
    await expect(page.locator('main')).toContainText(strings.reports.voidSalesInvoice);
  });

  test('the manager deletes a purchase: stock and supplier back, the reports follow; the exceptions report lists it', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const p = purchaseOnServer();
    await login(page, f, { name: f.managerName, pin: f.pin });
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('f-number').fill(p.number);
    await page.getByTestId(`delete-purchase-${p.number}`).click();
    await page.getByTestId('void-reason-mistake').click();
    await expect(page.getByText(strings.voidPurchase.done)).toBeVisible();
    await expect(page.getByTestId(`purchase-voided-${p.number}`)).toBeVisible();
    await expect
      .poll(() => sql(`select status from purchase_invoices where number = '${p.number}'`), {
        timeout: 60_000,
      })
      .toBe('voided');
    expect(sql(`select coalesce(sum(qty), 0) from stock_movements where product_id = '${p.product}'`)).toBe(
      '0',
    );
    expect(
      sql(
        `select coalesce(sum(l.amount), 0) from party_ledger l join suppliers s on s.id = l.party_id where s.name = '${p.supplier}'`,
      ),
    ).toBe('0');
    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-purchases').click();
    await expect(page.locator('main')).toContainText(strings.reports.purchTotal);
    await expect(page.locator('main')).not.toContainText(`${p.supplier} · ${strings.reports.invoices}`);
    await page.getByTestId('report-tab-exceptions').click();
    await expect(page.locator('main')).toContainText(p.number);
    await expect(page.locator('main')).toContainText(strings.reports.voidPurchaseInvoice);
  });

  test('a storekeeper sees no delete button on purchases', async ({ page }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const p = purchaseOnServer();
    await login(page, f, keeper);
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('f-number').fill(p.number);
    await expect(page.getByTestId(`view-${p.number}`)).toBeVisible();
    await expect(page.getByTestId(`delete-purchase-${p.number}`)).toHaveCount(0);
    await page.getByTestId(`view-${p.number}`).click();
    await expect(page.getByTestId('invoice-view')).toBeVisible();
    await expect(page.getByTestId('iv-delete')).toHaveCount(0);
  });

  test('the delete button in the invoice view works; the screens fit 320, 390, 1024 and 1366 px', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const p = purchaseOnServer();
    await login(page, f, { name: f.managerName, pin: f.pin });
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('f-number').fill(p.number);
    await expect(page.getByTestId(`delete-purchase-${p.number}`)).toBeVisible();
    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [1024, 768],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
      const found = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        small: [...document.querySelectorAll<HTMLElement>('main button')]
          .filter((b) => b.getBoundingClientRect().width > 0 && b.getBoundingClientRect().height < 43.5)
          .map((b) => b.textContent?.trim()),
      }));
      expect(found.page, `${width}px page scrolls sideways`).toBeLessThanOrEqual(1);
      expect(found.small, `${width}px small buttons`).toEqual([]);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await page.getByTestId(`view-${p.number}`).click();
    await page.getByTestId('iv-delete').click();
    await page.getByTestId('void-reason-other').click();
    await expect
      .poll(() => sql(`select status from purchase_invoices where number = '${p.number}'`), {
        timeout: 60_000,
      })
      .toBe('voided');
  });
});
