import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function start(page: Page, who: 'cashier' | 'manager'): Promise<CashierFixture> {
  const f = newCashierFixture();
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
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

async function sellAndReturnOne(page: Page, f: CashierFixture): Promise<string> {
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
  await page.getByTestId('return').click();
  await page.getByTestId(`return-${f.prefix}-INV-000001`).click();
  await page.getByTestId('plus-1').click();
  await page.getByTestId('confirm-return').click();
  const number = `${f.prefix}-RET-000001`;
  await expect
    .poll(() => sql(`select count(*) from sales_returns where number = '${number}'`), { timeout: 60_000 })
    .toBe('1');
  return number;
}

test.describe('void a sales return', () => {
  test('the manager voids a cash return: server, drawer, history and the invoice can be returned again', async ({
    page,
  }) => {
    const f = await start(page, 'manager');
    const number = await sellAndReturnOne(page, f);
    await page.getByTestId('recent').click();
    await page.getByTestId(`view-${f.prefix}-INV-000001`).click();
    await page.getByTestId(`void-return-${number}`).click();
    await page.getByTestId('void-reason-mistake').click();
    await expect
      .poll(() => sql(`select status from sales_returns where number = '${number}'`), { timeout: 60_000 })
      .toBe('voided');
    // the drawer is back to float + sale: the cash that went out came back
    expect(
      sql(
        `select coalesce(sum(m.amount), 0) from cash_movements m join cash_accounts c on c.id = m.cash_account_id where c.owner_device_id = '${f.deviceId}'`,
      ),
    ).toBe('1500');
    // the void shows in the item history next to the return
    await page.evaluate((id) => (window.location.hash = `#/products/${id}`), productId(2));
    await page.getByTestId('product-view-history').click();
    await page.getByTestId('history-all').click();
    await expect(page.getByTestId('report-table-0')).toContainText(strings.reports.docTypes.void_return);
    await expect(page.getByTestId('report-table-0')).toContainText(strings.reports.docTypes.sales_return);
    // the same invoice can be returned again in full
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('return').click();
    await page.getByTestId(`return-${f.prefix}-INV-000001`).click();
    await expect(page.getByTestId('plus-1')).toBeVisible();
    await page.getByTestId('plus-1').click();
    await page.getByTestId('confirm-return').click();
    await expect
      .poll(() => sql(`select count(*) from sales_returns where number = '${f.prefix}-RET-000002'`), {
        timeout: 60_000,
      })
      .toBe('1');
  });

  test('a cashier does not get the void-return button', async ({ page }) => {
    const f = await start(page, 'cashier');
    const number = await sellAndReturnOne(page, f);
    await page.getByTestId('recent').click();
    await page.getByTestId(`view-${f.prefix}-INV-000001`).click();
    await expect(page.getByTestId('iv-returns')).toContainText(number);
    await expect(page.getByTestId(`void-return-${number}`)).toHaveCount(0);
  });
});
