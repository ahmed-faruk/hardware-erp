import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, setSetting, sql, type CashierFixture } from './helpers';

/** Every print() (the receipt frame calls it) is recorded instead of opening a dialog: window.__prints holds the printed HTML. */
async function recordPrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: string[] };
    if (window === window.top) w.__prints = [];
    else
      window.print = () =>
        (window.top as unknown as { __prints: string[] }).__prints.push(document.documentElement.outerHTML);
  });
}

const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: string[] }).__prints);

async function loginAs(page: Page, f: CashierFixture, who: 'cashier' | 'manager'): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page
    .getByRole('button', { name: new RegExp(who === 'cashier' ? f.cashierName : f.managerName) })
    .click();
  await page.keyboard.type(who === 'cashier' ? f.cashierPin : f.pin);
  await page.keyboard.press('Enter');
}

async function openShift(page: Page, float = '100'): Promise<void> {
  await page.getByTestId('open-shift').click();
  await page.keyboard.type(float);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
}

const tap = (page: Page, n: number) =>
  page
    .locator(`[data-testid="tile-${productId(n)}"] button`)
    .first()
    .click();

async function start(page: Page, who: 'cashier' | 'manager' = 'cashier'): Promise<CashierFixture> {
  const f = newCashierFixture();
  await recordPrints(page);
  await loginAs(page, f, who);
  await openShift(page);
  return f;
}

async function payCash(page: Page, tendered: string): Promise<void> {
  await vis(page, 'pay').click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type(tendered);
  await page.keyboard.press('Enter');
  await page.getByTestId('finish').click();
}

test.describe('cashier journeys', () => {
  test('@smoke open shift, five items by tap, scan and search, cash with change, receipt prints, reaches the server', async ({
    page,
  }) => {
    const f = await start(page);
    await tap(page, 1); // 12.50
    await tap(page, 2); // 15.00
    await page.keyboard.type('9000003', { delay: 0 }); // scanner burst: product 3, 17.50
    await page.keyboard.press('Enter');
    await page.getByTestId('sell-search').fill('Test product 4'); // 20.00
    await page.getByTestId('sell-search').press('Enter');
    await tap(page, 5); // 22.50
    await expect(vis(page, 'total')).toHaveText('87.50');

    await vis(page, 'pay').click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    const started = Date.now();
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await expect(page.getByTestId('change-display')).toContainText('12.50');
    await expect.poll(async () => (await prints(page)).length, { timeout: 5000 }).toBe(1);
    expect(Date.now() - started).toBeLessThan(3000);
    const html = (await prints(page))[0] as string;
    expect(html).toContain(`${f.prefix}-INV-000001`);
    expect(html).toContain('87.50');
    expect(html).toContain('<rect'); // the invoice-number barcode

    await expect
      .poll(() => sql(`select total from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 60_000,
      })
      .toBe('8750');
    await expect
      .poll(() =>
        sql(
          `select count(*) from stock_movements sm join sales_invoices si on si.id = sm.doc_id where si.number = '${f.prefix}-INV-000001'`,
        ),
      )
      .toBe('5');
  });

  test('credit sale shows the customer balance and limit, then a split cash + card', async ({ page }) => {
    await start(page);
    await tap(page, 2); // 15.00
    await vis(page, 'pay').click();
    await page.getByTestId('pay-credit').click(); // no customer yet: the picker opens
    await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
    await expect(page.getByTestId('num-display')).toBeVisible();
    await page.getByTestId('full-amount').click();
    await expect(page.getByTestId('remaining')).toHaveText('0.00');
    await expect(page.getByTestId('customer-info')).toBeVisible();
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();

    await page.getByTestId('new-sale').click();
    await tap(page, 3); // 17.50 = 10.00 cash + 7.50 card
    await vis(page, 'pay').click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('10');
    await page.keyboard.press('Enter');
    await page.getByTestId('pay-card').click();
    await page.getByTestId('full-amount').click();
    await page.keyboard.type('4321'); // the card reference
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('remaining')).toHaveText('0.00');
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(2);
    expect((await prints(page)).at(-1)).toContain('4321');
  });

  test('hold, resume, and the open cart survives a reload', async ({ page }) => {
    const f = await start(page);
    await tap(page, 1); // 12.50
    await page.keyboard.press('F8'); // hold
    await expect(vis(page, 'total')).toHaveText('0.00');
    await expect(vis(page, 'held')).toHaveText('1');
    await tap(page, 2); // 15.00 stays in the open cart
    await expect(vis(page, 'total')).toHaveText('15.00');

    await page.reload(); // a power cut or a reload: the shop is back at the login, the cart is still there
    await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
    await page.keyboard.type(f.cashierPin);
    await page.keyboard.press('Enter');
    await expect(vis(page, 'total')).toHaveText('15.00');

    await page.keyboard.press('Shift+F8'); // the held carts
    await page.locator('[data-testid^="resume-"]').first().click();
    await expect(vis(page, 'total')).toHaveText('12.50');
    await expect(vis(page, 'held')).toHaveText('1'); // the 15.00 cart was held when the other one came back
  });

  test('a cashier discount needs the manager PIN, then applies', async ({ page }) => {
    const f = await start(page);
    await tap(page, 1); // 12.50
    await page.getByTestId('discount-0').click();
    await page.keyboard.type('10'); // 10 percent
    await page.keyboard.press('Enter');
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect(vis(page, 'total')).toHaveText('11.25');
  });

  test('no-sale opens the drawer with a manager PIN, prints a slip and is audited', async ({ page }) => {
    const f = await start(page);
    await page.getByTestId('no-sale').click();
    await page.getByTestId('reason-change').click();
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(1);
    expect((await prints(page))[0]).toContain(strings.receipt.noSale);
    await expect
      .poll(
        () => sql(`select count(*) from audit_log where action = 'no_sale' and approved_by is not null`),
        { timeout: 60_000 },
      )
      .not.toBe('0');
  });

  test('reprint is marked copy', async ({ page }) => {
    const f = await start(page);
    await tap(page, 1);
    await payCash(page, '20');
    await expect(page.getByTestId('done')).toBeVisible();
    await page.getByTestId('new-sale').click();
    await page.getByTestId('recent').click();
    await page.getByTestId(`reprint-${f.prefix}-INV-000001`).click();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(2);
    expect((await prints(page))[1]).toContain(strings.receipt.copy);
  });

  test('works offline: a sale waits in the outbox and syncs when the connection returns', async ({
    page,
    context,
  }) => {
    const f = await start(page);
    await expect(page.getByTestId('sync-pending')).toBeVisible();
    await context.setOffline(true);
    await tap(page, 1);
    await payCash(page, '20');
    await expect(page.getByTestId('done')).toBeVisible();
    expect(sql(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`)).toBe('0');
    await context.setOffline(false);
    await expect
      .poll(() => sql(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 90_000,
      })
      .toBe('1');
  });

  test('keyboard only: F2, type, Enter, F9, then Ctrl+Enter', async ({ page }) => {
    await start(page);
    await page.keyboard.press('F2');
    await page.keyboard.type('Test product 2');
    await page.keyboard.press('Enter');
    await expect(vis(page, 'total')).toHaveText('15.00');
    await page.keyboard.press('F9');
    await page.getByTestId('pay-cash').focus();
    await page.keyboard.press('Enter');
    await page.keyboard.type('15');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('remaining')).toHaveText('0.00');
    await page.keyboard.press('Control+Enter');
    await expect(page.getByTestId('done')).toBeVisible();
  });
});

test('with the negative-stock policy on block, selling a product with no stock is refused', async ({
  page,
}) => {
  setSetting('stock.negativePolicy', '"block"');
  try {
    await start(page);
    await tap(page, 2); // the shared test catalog has no stock for it
    await vis(page, 'pay').click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.getByTestId('finish').click();
    await expect(page.getByText(strings.sell.negativeBlocked)).toBeVisible();
    await expect(page.getByTestId('done')).toHaveCount(0);
  } finally {
    sql(`delete from settings where key = 'stock.negativePolicy'`);
  }
});

test('a wholesale customer changes the price of the lines already in the cart', async ({ page }) => {
  sql(`update products set price_wholesale = 1500 where id = '${productId(3)}'`); // retail 17.50
  sql(`update customers set price_list = 'wholesale' where id = 'a0000000-0000-7000-8000-000000000c01'`);
  try {
    await start(page);
    await tap(page, 3);
    await expect(vis(page, 'total')).toHaveText('17.50');
    await vis(page, 'pay').click();
    await page.getByTestId('choose-customer').click();
    await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
    await expect(page.getByTestId('pay-total')).toHaveText('15.00');
  } finally {
    sql(`update products set price_wholesale = null where id = '${productId(3)}'`);
    sql(`update customers set price_list = 'retail' where id = 'a0000000-0000-7000-8000-000000000c01'`);
  }
});
