import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { formatMoney } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

/**
 * One shop day with every feature of this release, then the database checked against the ledgers:
 * sales (cash, credit, mixed), a free return of two items, a collection, the two expense types, a purchase paid
 * from three sources with a part return, invoices viewed on screen, a product created and deleted (and one that
 * cannot be), a manual Z print, a second device that syncs, and every report against SQL.
 */
const CUSTOMER = 'a0000000-0000-7000-8000-000000000c01';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: string[] }).__prints);
const stockOf = (n: number) =>
  Number(sql(`select coalesce(sum(qty), 0) from stock_movements where product_id = '${productId(n)}'`));
const customerBalance = () =>
  Number(sql(`select coalesce(sum(amount), 0) from party_ledger where party_id = '${CUSTOMER}'`));
const todayRange = `(issued_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date`;

async function activate(page: Page, f: CashierFixture, who: 'cashier' | 'manager'): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: string[] };
    if (window === window.top) w.__prints = [];
    else
      window.print = () =>
        (window.top as unknown as { __prints: string[] }).__prints.push(document.documentElement.outerHTML);
  });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page
    .getByRole('button', { name: new RegExp(who === 'cashier' ? f.cashierName : f.managerName) })
    .click();
  await page.keyboard.type(who === 'cashier' ? f.cashierPin : f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

async function openShift(page: Page, nav = true): Promise<void> {
  // a cashier lands on the sale screen; a manager goes there
  if (nav) await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

const addTile = (page: Page, n: number) =>
  page
    .locator(`[data-testid="tile-${productId(n)}"] button`)
    .first()
    .click();
const newSale = (page: Page) => page.getByTestId('new-sale').click();

async function payCash(page: Page, tendered: string): Promise<void> {
  await vis(page, 'pay').click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type(tendered);
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
}

async function synced(page: Page): Promise<void> {
  await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
}

test('a whole shop day with every feature, two devices, and every ledger and report agrees with SQL', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(420_000);
  const a = newCashierFixture();
  const baseline = { p2: stockOf(2), p3: stockOf(3), p4: stockOf(4), p5: stockOf(5), p6: stockOf(6) };
  const custBefore = customerBalance();
  await activate(page, a, 'manager');
  await openShift(page);

  // 1. three sales: cash 15.00 (change 5.00), credit 37.50 to the test customer, mixed 37.50 = 10.00 cash + 27.50 card
  await addTile(page, 2);
  await payCash(page, '20');
  await newSale(page);
  await addTile(page, 3);
  await addTile(page, 4);
  await vis(page, 'pay').click();
  await page.getByTestId('pay-credit').click();
  await page.getByTestId(`customer-${CUSTOMER}`).click();
  await page.getByTestId('full-amount').click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await newSale(page);
  await addTile(page, 2);
  await addTile(page, 5);
  await vis(page, 'pay').click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.getByTestId('pay-card').click();
  await page.getByTestId('full-amount').click();
  await page.keyboard.type('1234');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('remaining')).toHaveText('0.00');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  // nothing printed by itself; only the button prints
  await page.waitForTimeout(800);
  expect(await prints(page)).toHaveLength(0);
  await newSale(page);

  // 2. a free return of two items that were sold: product 2 (15.00) and product 3 (17.50)
  await page.getByTestId('return').click();
  await page.getByTestId('return-free').click();
  for (const n of [2, 3]) {
    await page.getByTestId('free-search').fill(`Test product ${n}`);
    await page.getByTestId(`free-P00${n}`).click();
    await page.getByTestId('free-add').click();
  }
  await expect(page.getByTestId('free-total')).toHaveText('32.50');
  await page.getByTestId('confirm-free-return').click();
  await expect(page.getByTestId('print-offer')).toBeVisible();

  // 3. a collection of 10.00 from the customer
  await page.getByTestId('collect').click();
  await page.getByTestId(`customer-${CUSTOMER}`).click();
  await page.getByTestId('collect-amount-btn').click();
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.getByTestId('collect-save').click();

  // 4. the two expense types, 5.00 and 3.00 from the drawer
  for (const [cat, amount] of [
    ['مصروفات محل', '5'],
    ['مشتريات', '3'],
  ] as const) {
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-expense').click();
    await expect(page.locator('[data-testid^="expense-cat-"]')).toHaveText(['مشتريات', 'مصروفات محل']);
    await page.getByTestId(`expense-cat-${cat}`).click();
    await page.keyboard.type(amount);
    await page.keyboard.press('Enter');
  }

  // 5. the first sale on screen: lines, total and payment equal what was saved
  await page.getByTestId('recent').click();
  await page.getByTestId(`view-${a.prefix}-INV-000001`).click();
  await expect(page.getByTestId('iv-total')).toHaveText('15.00');
  await expect(page.getByTestId('invoice-view')).toContainText('Test product 2');
  await page.locator('dialog[open]').last().getByRole('button', { name: strings.common.close }).click();
  await page.locator('dialog[open]').last().getByRole('button', { name: strings.common.close }).click();

  // 6. a supplier and a purchase of 10 x 10.00: 40.00 cash from the safe, 30.00 from the owner, 30.00 on credit; then 2 returned
  const supplier = `مورد اليوم ${randomUUID().slice(0, 5)}`;
  await page.getByRole('button', { name: strings.nav.suppliers }).click();
  await page.getByTestId('new-supplier').click();
  await page.getByTestId('supplier-name').fill(supplier);
  await page.getByTestId('save-supplier').click();
  await expect(page.getByText(supplier)).toBeVisible();
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: supplier });
  await page.getByTestId('product-picker').fill('Test product 6');
  await page.getByTestId('product-picker').press('Enter');
  await page.getByLabel(strings.purchases.qty).fill('10');
  await page.getByLabel(strings.purchases.unitCost).fill('10');
  await page.getByLabel(strings.purchases.paidCash).fill('40');
  await page.getByLabel(strings.purchases.paidOwner).fill('30');
  await page.getByTestId('save-purchase').click();
  await expect(page.getByTestId('purchase-line')).toHaveCount(0);
  const purchase = `${a.prefix}-PUR-000001`;
  await page.getByTestId(`view-${purchase}`).click();
  await expect(page.getByTestId('iv-total')).toHaveText('100.00');
  await expect(page.getByTestId('iv-owner')).toContainText('30.00');
  await page.locator('dialog[open]').last().getByRole('button', { name: strings.common.close }).click();
  await page.getByTestId('new-purchase-return').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: supplier });
  await page.getByTestId(`rt-plus-${purchase}-1`).click();
  await page.getByTestId(`rt-plus-${purchase}-1`).click();
  await expect(page.getByTestId('return-total')).toContainText('20.00');
  await page.getByTestId('save-purchase-return').click();

  // 7. a product created and deleted; a sold product cannot be deleted and says why
  const fresh = `صنف اليوم ${randomUUID().slice(0, 5)}`;
  await page.getByRole('button', { name: strings.nav.products }).click();
  await page.getByTestId('new-product').click();
  await page.getByTestId('product-name').fill(fresh);
  await page.getByTestId('save-product').click();
  await expect
    .poll(() => sql(`select count(*) from products where name = '${fresh}'`), { timeout: 60_000 })
    .toBe('1');
  await page.getByTestId('product-search').fill(fresh);
  await page.getByText(fresh).first().click();
  await page.getByTestId('delete-product').click();
  await expect(page.getByTestId('product-search')).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => sql(`select count(*) from products where name = '${fresh}' and deleted_at is not null`), {
      timeout: 60_000,
    })
    .toBe('1');
  await page.evaluate((id) => (window.location.hash = `#/products/${id}`), productId(2));
  await page.getByTestId('delete-product').click();
  await expect(page.getByTestId('delete-blocked')).toContainText(strings.products.deleteReasons.sales);

  // 8. close the shift blind: 100 + 15 + 10 − 32.50 + 10 − 8 = 94.50; the Z report is printed by the button
  await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('shift-menu').click();
  await page.getByTestId('shift-close').click();
  const count = async (id: string, times: number) => {
    for (let i = 0; i < times; i++) await page.getByTestId(`denom-${id}-plus`).click();
  };
  await count('5000', 1);
  await count('2000', 2);
  await count('100', 4);
  await count('50', 1);
  await page.getByTestId('count-done').click();
  await expect(page.getByTestId('close-expected')).toHaveText('94.50');
  await expect(page.getByTestId('close-variance')).toHaveText('0.00');
  await page.getByTestId('close-confirm').click();
  await expect(page.getByTestId('open-shift')).toBeVisible();
  await page.waitForTimeout(800);
  expect(await prints(page)).toHaveLength(0);
  await page.getByTestId('print-offer').click();
  await expect
    .poll(async () => (await prints(page)).filter((h) => h.includes(strings.shift.z)).length, {
      timeout: 8000,
    })
    .toBe(1);
  await synced(page);

  // 9. a second device (a cashier) sells and syncs everything the first one did
  const b = newCashierFixture();
  const ctxB = await browser.newContext({ baseURL: info.project.use.baseURL });
  const pageB = await ctxB.newPage();
  await activate(pageB, b, 'cashier');
  await openShift(pageB, false);
  await expect(pageB.getByTestId(`stock-${productId(2)}`)).toHaveText(
    `${strings.sell.stockOnHand} ${stockOf(2) / 1000}`,
    { timeout: 60_000 },
  );
  await addTile(pageB, 4);
  await payCash(pageB, '20');
  await synced(pageB);
  await ctxB.close();

  // ---- the database against the ledgers ----
  const inv = (n: number) => `${a.prefix}-INV-${String(n).padStart(6, '0')}`;
  expect(
    sql(
      `select string_agg(number, ',' order by number) from sales_invoices where number like '${a.prefix}-INV-%'`,
    ),
  ).toBe([1, 2, 3].map(inv).join(',')); // numbers without gaps
  expect(
    sql(
      `select count(*) from sales_invoices i where i.number like '${a.prefix}-INV-%' and i.total <> (select coalesce(sum(p.amount), 0) from payments p where p.document_id = i.id)`,
    ),
  ).toBe('0'); // payments = total on every invoice
  // stock: sold 2 (p2 twice, p3, p4, p5 once each), returned p2 and p3 once, bought 10 and returned 2 of p6
  expect(stockOf(2) - baseline.p2).toBe(-2000 + 1000);
  expect(stockOf(3) - baseline.p3).toBe(-1000 + 1000);
  expect(stockOf(4) - baseline.p4).toBe(-1000 - 1000); // device A's sale and the cashier device's sale
  expect(stockOf(5) - baseline.p5).toBe(-1000);
  expect(stockOf(6) - baseline.p6).toBe(10000 - 2000);
  // the customer owes 37.50 less the 10.00 collected
  expect(customerBalance() - custBefore).toBe(3750 - 1000);
  // the supplier is owed the credit part, 30.00 less the credit share of the 2 returned (20.00 comes off the debt)
  expect(
    sql(
      `select coalesce(sum(amount), 0) from party_ledger where party_type = 'supplier' and party_id = (select id from suppliers where name = '${supplier}')`,
    ),
  ).toBe('-1000');
  // the drawer of device A: its movements add up to 15 + 10 − 32.50 + 10 − 8 = −5.50, which with the 100.00 float is the counted 94.50
  expect(
    sql(
      `select coalesce(sum(m.amount), 0) from cash_movements m join cash_accounts c on c.id = m.cash_account_id where c.owner_device_id = '${a.deviceId}'`,
    ),
  ).toBe('-550');
  expect(sql(`select status || ':' || variance from shifts where number = '${a.prefix}-SHF-000001'`)).toBe(
    'closed:0',
  );
  // the audit trail has the product delete
  expect(sql(`select count(*) from audit_log where action = 'product.delete'`)).not.toBe('0');

  // ---- the reports against SQL ----
  const retCount = sql(
    `select count(*) from sales_returns where status = 'posted' and is_legacy = false and ${todayRange}`,
  );
  const retTotal = Number(
    sql(
      `select coalesce(sum(total), 0) from sales_returns where status = 'posted' and is_legacy = false and ${todayRange}`,
    ),
  );
  const expTotal = Number(
    sql(`select coalesce(sum(amount), 0) from expenses where status = 'posted' and ${todayRange}`),
  );
  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-returns').click();
  await page.getByTestId('period-today').click();
  await expect(page.getByTestId('report-table-0')).toContainText(formatMoney(retTotal));
  await expect(
    page.getByTestId('report-table-0').locator('tbody tr').first().locator('td').first(),
  ).toHaveText(retCount);
  await page.getByTestId('report-tab-expenses').click();
  await page.getByTestId('period-today').click();
  await expect(page.getByTestId('report-table-0')).toContainText('مصروفات محل');
  await expect(page.getByTestId('report-table-0')).toContainText('مشتريات');
  await expect(page.getByTestId('report-totals-0')).toContainText(formatMoney(expTotal));
  await page.getByTestId('report-tab-sales').click();
  await page.getByTestId('period-today').click();
  const salesToday = Number(
    sql(`select coalesce(sum(total), 0) from sales_invoices where status = 'posted' and ${todayRange}`),
  );
  await expect(page.getByTestId('report-table-0')).toContainText(formatMoney(salesToday));
  // the item history of product 2 lists both sales and the return
  await page.evaluate((id) => (window.location.hash = `#/products/${id}`), productId(2));
  await page.getByTestId('product-view-history').click();
  await page.getByTestId('history-all').click();
  await expect(page.getByTestId('report-table-0')).toContainText(inv(1));
  await expect(page.getByTestId('report-table-0')).toContainText(`${a.prefix}-RET-000001`);
});

test('offline half day: a sale and a free return while offline sync once, with no duplicates and nothing rejected', async ({
  page,
  context,
}) => {
  test.setTimeout(300_000);
  const a = newCashierFixture();
  await activate(page, a, 'manager');
  await openShift(page);
  await addTile(page, 2);
  await payCash(page, '20');
  await synced(page);
  await newSale(page);
  await context.setOffline(true);
  await addTile(page, 3);
  await payCash(page, '20');
  await newSale(page);
  await page.getByTestId('return').click();
  await page.getByTestId('return-free').click();
  await page.getByTestId('free-search').fill('Test product 2');
  await page.getByTestId('free-P002').click();
  await page.getByTestId('free-add').click();
  await page.getByTestId('confirm-free-return').click();
  await expect(page.getByTestId('print-offer')).toBeVisible();
  expect(sql(`select count(*) from sales_invoices where number like '${a.prefix}-INV-%'`)).toBe('1');
  await context.setOffline(false);
  await synced(page);
  expect(
    sql(
      `select string_agg(number, ',' order by number) from sales_invoices where number like '${a.prefix}-INV-%'`,
    ),
  ).toBe(`${a.prefix}-INV-000001,${a.prefix}-INV-000002`);
  expect(sql(`select count(*) from sales_returns where number = '${a.prefix}-RET-000001'`)).toBe('1');
  expect(
    sql(
      `select count(*) from sales_return_lines where return_id = (select id from sales_returns where number = '${a.prefix}-RET-000001')`,
    ),
  ).toBe('1');
  // reload: the same numbers and no pending or rejected rows come back
  await page.reload();
  await page.getByRole('button', { name: new RegExp(a.managerName) }).click();
  await page.keyboard.type(a.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
});
