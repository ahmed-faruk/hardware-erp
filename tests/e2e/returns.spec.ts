import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

async function recordPrints(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: string[] };
    if (window === window.top) w.__prints = [];
    else
      window.print = () =>
        (window.top as unknown as { __prints: string[] }).__prints.push(document.documentElement.outerHTML);
  });
}
const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: string[] }).__prints);
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function start(page: Page, who: 'cashier' | 'manager'): Promise<CashierFixture> {
  const f = newCashierFixture();
  await recordPrints(page);
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page
    .getByRole('button', { name: new RegExp(who === 'cashier' ? f.cashierName : f.managerName) })
    .click();
  await page.keyboard.type(who === 'cashier' ? f.cashierPin : f.pin);
  await page.keyboard.press('Enter');
  if (who === 'manager') await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
  return f;
}

async function sellOneCash(page: Page): Promise<void> {
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

test.describe('returns, voids and collections', () => {
  test('@smoke a cashier returns an item by invoice: refund from the drawer, stock back, return receipt, server agrees', async ({
    page,
  }) => {
    const f = await start(page, 'cashier');
    await sellOneCash(page);
    await page.getByTestId('return').click();
    await page.getByTestId(`return-${f.prefix}-INV-000001`).click();
    await page.getByTestId('plus-1').click();
    await expect(page.getByTestId('refund-total')).toHaveText('15.00');
    await page.getByTestId('confirm-return').click();
    await page.waitForTimeout(1000);
    expect(await prints(page)).toHaveLength(0);
    await page.getByTestId('print-offer').click();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(1);
    const html = (await prints(page))[0] as string;
    expect(html).toContain(`${f.prefix}-RET-000001`);
    expect(html).toContain('مرتجع');

    await expect
      .poll(() => sql(`select total from sales_returns where number = '${f.prefix}-RET-000001'`), {
        timeout: 60_000,
      })
      .toBe('1500');
    await expect
      .poll(() =>
        sql(
          `select coalesce(sum(qty), 0) from stock_movements where doc_type = 'sales_return' and doc_id in (select id from sales_returns where number = '${f.prefix}-RET-000001')`,
        ),
      )
      .toBe('1000');
  });

  test('the manager voids an invoice and the server marks it voided', async ({ page }) => {
    const f = await start(page, 'manager');
    await sellOneCash(page);
    await page.getByTestId('recent').click();
    await page.getByTestId(`void-${f.prefix}-INV-000001`).click();
    await page.getByTestId('void-reason-mistake').click();
    await expect
      .poll(() => sql(`select status from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 60_000,
      })
      .toBe('voided');
    // no auto print after a void; «اطبع» prints the voided copy
    await page.waitForTimeout(1000);
    expect(await prints(page)).toHaveLength(0);
    await page.getByTestId('print-offer').click();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(1);
  });

  test('a collection from a customer reaches the server and prints a slip', async ({ page }) => {
    const f = await start(page, 'cashier');
    await page.getByTestId('collect').click();
    await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
    await page.getByTestId('collect-amount-btn').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');
    await page.getByTestId('collect-save').click();
    await page.waitForTimeout(1000);
    expect(await prints(page)).toHaveLength(0);
    await page.getByTestId('print-offer').click();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(1);
    expect((await prints(page))[0]).toContain(`${f.prefix}-RCV-000001`);
    await expect
      .poll(() => sql(`select amount from customer_receipts where number = '${f.prefix}-RCV-000001'`), {
        timeout: 60_000,
      })
      .toBe('500');
  });
});

test('a collection ticked on a credit invoice reaches the server with its allocation', async ({ page }) => {
  const f = await start(page, 'cashier');
  await page
    .locator(`[data-testid="tile-${productId(2)}"] button`)
    .first()
    .click();
  await vis(page, 'pay').click();
  await page.getByTestId('pay-credit').click();
  await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
  await page.getByTestId('full-amount').click();
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await page.getByTestId('new-sale').click();

  await page.getByTestId('collect').click();
  await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
  await page.getByTestId(`alloc-${f.prefix}-INV-000001`).check();
  await page.getByTestId('collect-amount-btn').click();
  await page.keyboard.type('5');
  await page.keyboard.press('Enter');
  await page.getByTestId('collect-save').click();
  await expect
    .poll(
      () =>
        sql(
          `select allocations -> 0 ->> 'amount' from customer_receipts where number = '${f.prefix}-RCV-000001'`,
        ),
      { timeout: 60_000 },
    )
    .toBe('500');
});
