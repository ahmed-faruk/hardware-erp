import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { addWorker, newCashierFixture, productId, sql, type CashierFixture } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

async function login(page: Page, f: CashierFixture, who: { name: string; pin: string }): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(who.name) }).click();
  await page.keyboard.type(who.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

/** A purchase of 10 pcs of product 5 on the server, made `daysAgo` days ago from a fresh supplier. */
function purchaseOnServer(daysAgo: number): { number: string; supplier: string } {
  const run = randomUUID().slice(0, 6);
  const supplier = `مورد فترة ${run}`;
  const sid = randomUUID();
  const inv = randomUUID();
  const number = `ZP-PUR-${run.toUpperCase()}`;
  sql(`insert into suppliers (id, company_id, name) values ('${sid}', '${COMPANY}', '${supplier}')`);
  sql(
    `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${COMPANY}', '${number}', now() - interval '${daysAgo} days', '${sid}', 'a0000000-0000-7000-8000-0000000000c1', 10000, 10000)`,
  );
  sql(
    `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${inv}', 1, '${productId(5)}', 1000, 10000, 1000, 10000)`,
  );
  return { number, supplier };
}

async function startPurchaseReturn(page: Page, number: string): Promise<void> {
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase-return').click();
  await page.getByTestId('return-find').fill(number);
  await page.getByTestId('return-invoice').selectOption({ index: 1 });
  await page.getByLabel(strings.purchases.returned).fill('1');
  await page.getByTestId('save-purchase-return').click();
}

test.describe('return periods and finding any invoice', () => {
  test('the sales return dialog finds an invoice older than the latest 12, by date', async ({ page }) => {
    const f = newCashierFixture();
    const old = `ZR${randomUUID().slice(0, 4).toUpperCase()}`;
    const ids: string[] = [];
    for (let i = 0; i < 14; i++) {
      const id = randomUUID();
      ids.push(id);
      sql(
        `insert into sales_invoices (id, company_id, number, issued_at, total, subtotal) values ('${id}', '${COMPANY}', '${old}-INV-9000${String(i).padStart(2, '0')}', '2025-01-${String(i + 1).padStart(2, '0')} 10:00:00+00', 1000, 1000)`,
      );
    }
    try {
      await login(page, f, { name: f.cashierName, pin: f.cashierPin });
      await page.getByTestId('open-shift').click();
      await page.keyboard.type('100');
      await page.keyboard.press('Enter');
      await page.getByTestId('return').click();
      // the newest 12 are listed; the oldest (1 Jan 2025) is not, until the cashier searches for its date or asks for more
      await expect(page.getByTestId(`return-${old}-INV-900000`)).toHaveCount(0);
      await page.getByTestId('return-find').fill('01/01/2025');
      await expect(page.getByTestId(`return-${old}-INV-900000`)).toBeVisible();
      await expect(page.getByTestId(`return-${old}-INV-900001`)).toHaveCount(0);
      await page.getByTestId('return-find').fill(old);
      await expect(page.getByTestId('return-more')).toBeVisible();
      await page.getByTestId('return-more').click();
      await expect(page.getByTestId(`return-${old}-INV-900000`)).toBeVisible();
    } finally {
      for (const id of ids) sql(`delete from sales_invoices where id = '${id}'`);
    }
  });

  test('a purchase return after the period needs the manager PIN; inside it a storekeeper returns alone', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const oldOne = purchaseOnServer(60);
    const recent = purchaseOnServer(2);
    await login(page, f, keeper);
    // inside the period: no PIN
    await startPurchaseReturn(page, recent.number);
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from purchase_returns r join purchase_invoices i on i.id = r.original_invoice_id where i.number = '${recent.number}'`,
          ),
        {
          timeout: 60_000,
        },
      )
      .toBe('1');
    // after the period: the PIN of a manager is asked and kept on the return
    await startPurchaseReturn(page, oldOne.number);
    await expect(page.getByText(strings.sell.approve).first()).toBeVisible();
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect
      .poll(
        () =>
          sql(
            `select (r.approved_by is not null) from purchase_returns r join purchase_invoices i on i.id = r.original_invoice_id where i.number = '${oldOne.number}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('t');
  });

  test('the manager sets the period to 90 days in Settings: then 60 days old needs no PIN, and the manager is never asked', async ({
    page,
    browser,
  }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const oldOne = purchaseOnServer(60);
    await login(page, f, { name: f.managerName, pin: f.pin });
    // the manager returns a 60 day old purchase without any PIN
    await startPurchaseReturn(page, oldOne.number);
    await expect(page.getByText(strings.sell.approve)).toHaveCount(0);
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from purchase_returns r join purchase_invoices i on i.id = r.original_invoice_id where i.number = '${oldOne.number}'`,
          ),
        {
          timeout: 60_000,
        },
      )
      .toBe('1');
    // set the period to 90 days
    await page.getByRole('button', { name: strings.nav.settings }).click();
    await page.getByTestId('purchase-return-days').fill('90');
    await page.getByTestId('save-settings').click();
    await expect
      .poll(
        () =>
          sql(`select value from settings where key = 'return.purchaseDays' and company_id = '${COMPANY}'`),
        {
          timeout: 60_000,
        },
      )
      .toBe('90');
    // a storekeeper on another device returns the same 60 day old purchase's second unit alone
    const page2 = await (await browser.newContext()).newPage();
    const second = newCashierFixture();
    await login(page2, second, keeper);
    await startPurchaseReturn(page2, oldOne.number);
    await expect(page2.getByText(strings.sell.approve)).toHaveCount(0);
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from purchase_returns r join purchase_invoices i on i.id = r.original_invoice_id where i.number = '${oldOne.number}'`,
          ),
        {
          timeout: 60_000,
        },
      )
      .toBe('2');
    sql(`delete from settings where key = 'return.purchaseDays' and company_id = '${COMPANY}'`);
  });
});
