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
const t = strings.purchases;

async function login(page: Page, f: CashierFixture, who: Who): Promise<void> {
  await loginAs(page, f, who);
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

/** A supplier with purchases on the server: [product, qty pcs, net piasters] each on its own invoice, today. */
function supplierWith(purchases: [number, number, number][]): { supplier: string; numbers: string[] } {
  const run = randomUUID().slice(0, 6);
  const sid = randomUUID();
  const supplier = `مورد مرتجع ${run}`;
  sql(`insert into suppliers (id, company_id, name) values ('${sid}', '${COMPANY}', '${supplier}')`);
  const numbers: string[] = [];
  purchases.forEach(([prod, pcs, net], i) => {
    const inv = randomUUID();
    const number = `ZR-PUR-${run.toUpperCase()}${i}`;
    numbers.push(number);
    sql(
      `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${COMPANY}', '${number}', now(), '${sid}', 'a0000000-0000-7000-8000-0000000000c1', ${net}, ${net})`,
    );
    sql(
      `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${inv}', 1, '${productId(prod)}', 1000, ${pcs * 1000}, ${Math.round(net / pcs)}, ${net})`,
    );
  });
  return { supplier, numbers };
}

const supplierReturns = (supplier: string) =>
  `select count(*) || ':' || coalesce(sum(total), 0) from purchase_returns r join suppliers s on s.id = r.supplier_id where s.name = '${supplier}'`;

test.describe('purchase returns, easier', () => {
  test('several invoices of one supplier in one return, with +/− buttons and a live total', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const s = supplierWith([
      [5, 10, 5000],
      [6, 4, 4000],
    ]);
    await login(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('new-purchase-return').click();
    // nothing to return before a supplier is picked
    await expect(page.getByTestId('save-purchase-return')).toBeDisabled();
    await page.getByTestId('purchase-supplier').selectOption({ label: s.supplier });
    await page.getByTestId(`rt-plus-${s.numbers[0]}-1`).click();
    await page.getByTestId(`rt-plus-${s.numbers[0]}-1`).click();
    await page.getByTestId(`rt-plus-${s.numbers[1]}-1`).click();
    await expect(page.getByTestId('return-total')).toContainText('20.00'); // 2 x 5.00 + 1 x 10.00
    // minus works, and the quantity stops at what is left
    await page.getByTestId(`rt-minus-${s.numbers[1]}-1`).click();
    await expect(page.getByTestId('return-total')).toContainText('10.00');
    await page.getByTestId(`rt-plus-${s.numbers[1]}-1`).click();
    for (let i = 0; i < 6; i++)
      if (await page.getByTestId(`rt-plus-${s.numbers[1]}-1`).isEnabled())
        await page.getByTestId(`rt-plus-${s.numbers[1]}-1`).click();
    await expect(page.getByTestId(`rt-qty-${s.numbers[1]}-1`)).toHaveText('4');
    await expect(page.getByTestId(`rt-plus-${s.numbers[1]}-1`)).toBeDisabled();
    await page.getByTestId(`rt-minus-${s.numbers[1]}-1`).click();
    await page.getByTestId(`rt-minus-${s.numbers[1]}-1`).click();
    await page.getByTestId(`rt-minus-${s.numbers[1]}-1`).click();
    await page.getByTestId('save-purchase-return').click();
    await expect.poll(() => sql(supplierReturns(s.supplier)), { timeout: 60_000 }).toBe('1:2000');
    expect(
      sql(
        `select count(*) || ':' || coalesce(bool_and(r.original_invoice_id is null)::text, '') from purchase_return_lines l join purchase_returns r on r.id = l.return_id join suppliers s on s.id = r.supplier_id where s.name = '${s.supplier}'`,
      ),
    ).toBe('2:true');
  });

  test('a supplier with no invoices says so; the search finds an invoice by number', async ({ page }) => {
    const f = newCashierFixture();
    const s = supplierWith([
      [5, 10, 5000],
      [6, 4, 4000],
    ]);
    const empty = supplierWith([]);
    await login(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('new-purchase-return').click();
    await page.getByTestId('purchase-supplier').selectOption({ label: empty.supplier });
    await expect(page.getByText(t.noInvoicesForSupplier)).toBeVisible();
    await page.getByTestId('purchase-supplier').selectOption({ label: s.supplier });
    await page.getByTestId('return-find').fill(s.numbers[1]!);
    await expect(page.getByTestId(`return-invoice-${s.numbers[1]}`)).toBeVisible();
    await expect(page.getByTestId(`return-invoice-${s.numbers[0]}`)).toHaveCount(0);
  });

  test('without an invoice a storekeeper returns at the last price from that supplier and cannot edit the value', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const s = supplierWith([[5, 10, 5000]]); // 5.00 a piece
    await login(page, f, keeper);
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('new-purchase-return').click();
    await page.getByTestId('purchase-supplier').selectOption({ label: s.supplier });
    await page.getByTestId('return-mode-plain').click();
    await page.getByTestId('product-picker').fill('Test product 5');
    await page.getByTestId('product-picker').press('Enter');
    await expect(page.getByTestId('rt-value-0')).toHaveText('5.00');
    await page.locator('[data-testid="rt-plain-0"] button').nth(1).click(); // + : 2 pieces
    await expect(page.getByTestId('rt-value-0')).toHaveText('10.00');
    await expect(page.getByTestId('rt-plain-0').getByLabel(t.returnValue)).toHaveCount(0);
    await expect(page.getByTestId('return-total')).toContainText('10.00');
    await page.getByTestId('save-purchase-return').click();
    await expect.poll(() => sql(supplierReturns(s.supplier)), { timeout: 60_000 }).toBe('1:1000');
    expect(
      sql(
        `select count(*) from purchase_return_lines l join purchase_returns r on r.id = l.return_id join suppliers x on x.id = r.supplier_id where x.name = '${s.supplier}' and l.original_line_id is null`,
      ),
    ).toBe('1');
  });

  test('the manager can change the value of a return without invoice', async ({ page }) => {
    const f = newCashierFixture();
    const s = supplierWith([[5, 10, 5000]]);
    await login(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('new-purchase-return').click();
    await page.getByTestId('purchase-supplier').selectOption({ label: s.supplier });
    await page.getByTestId('return-mode-plain').click();
    await page.getByTestId('product-picker').fill('Test product 5');
    await page.getByTestId('product-picker').press('Enter');
    await page.getByLabel(t.returnValue).fill('3.50');
    await expect(page.getByTestId('return-total')).toContainText('3.50');
    await page.getByTestId('save-purchase-return').click();
    await expect.poll(() => sql(supplierReturns(s.supplier)), { timeout: 60_000 }).toBe('1:350');
  });
});
