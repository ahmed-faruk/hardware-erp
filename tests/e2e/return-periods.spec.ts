import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import {
  addWorker,
  newCashierFixture,
  productId,
  sql,
  type CashierFixture,
  loginAs,
  type Who,
} from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';

async function login(page: Page, f: CashierFixture, who: Who): Promise<void> {
  await loginAs(page, f, who);
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

async function startPurchaseReturn(page: Page, number: string, supplier: string): Promise<void> {
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase-return').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: supplier });
  await page.getByTestId('return-find').fill(number);
  await page.getByTestId(`rt-plus-${number}-1`).click();
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
      await login(page, f, 'cashier');
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

  test('there is no return period: a storekeeper returns a 400-day-old purchase alone, no PIN', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const oldOne = purchaseOnServer(400);
    await login(page, f, keeper);
    await startPurchaseReturn(page, oldOne.number, oldOne.supplier);
    await expect(page.getByText(strings.sell.approve)).toHaveCount(0);
    await expect
      .poll(
        () =>
          sql(
            `select count(*) || ':' || bool_and(r.approved_by is null) from purchase_returns r join purchase_invoices i on i.id = r.original_invoice_id where i.number = '${oldOne.number}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1:true');
  });

  test('the whole-invoice button returns every line of a purchase at once', async ({ page }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const one = purchaseOnServer(5);
    await login(page, f, keeper);
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('new-purchase-return').click();
    await page.getByTestId('purchase-supplier').selectOption({ label: one.supplier });
    await page.getByTestId(`rt-all-${one.number}`).click();
    await expect(page.getByTestId(`rt-qty-${one.number}-1`)).toHaveText('10');
    await page.getByTestId('save-purchase-return').click();
    await expect
      .poll(
        () =>
          sql(
            `select coalesce(sum(l.qty), 0) from purchase_return_lines l join purchase_returns r on r.id = l.return_id join purchase_invoices i on i.id = r.original_invoice_id where i.number = '${one.number}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('10000');
  });

  test('a cashier returns a 400-day-old sales invoice with no PIN, using the whole-invoice button', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const id = randomUUID();
    const number = `ZO${randomUUID().slice(0, 4).toUpperCase()}-INV-900001`;
    sql(
      `insert into sales_invoices (id, company_id, number, issued_at, total, subtotal) values ('${id}', '${COMPANY}', '${number}', now() - interval '400 days', 3500, 3500)`,
    );
    sql(
      `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost) values ('${randomUUID()}', '${COMPANY}', '${id}', 1, '${productId(2)}', 1000, 2000, 1500, 3000, 100)`,
    );
    sql(
      `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost) values ('${randomUUID()}', '${COMPANY}', '${id}', 2, '${productId(3)}', 1000, 1000, 500, 500, 100)`,
    );
    sql(
      `insert into payments (id, company_id, document_type, document_id, method, amount) values ('${randomUUID()}', '${COMPANY}', 'sales_invoice', '${id}', 'cash', 3500)`,
    );
    await login(page, f, 'cashier');
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await page.getByTestId('return').click();
    await page.getByTestId('return-find').fill(number);
    await page.getByTestId(`return-${number}`).click();
    await page.getByTestId('return-all').click();
    await expect(page.getByTestId('qty-1')).toHaveText('2');
    await expect(page.getByTestId('qty-2')).toHaveText('1');
    await page.getByTestId('confirm-return').click();
    await expect
      .poll(
        () =>
          sql(
            `select count(*) || ':' || coalesce(sum(total), 0) from sales_returns where original_invoice_id = '${id}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1:3500');
  });
});
