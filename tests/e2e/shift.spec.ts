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

async function start(page: Page): Promise<CashierFixture> {
  const f = newCashierFixture();
  await recordPrints(page);
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
  await page.keyboard.type(f.cashierPin);
  await page.keyboard.press('Enter');
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();
  return f;
}

async function sellCash(page: Page): Promise<void> {
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

const click = (page: Page, id: string, times = 1) =>
  (async () => {
    for (let i = 0; i < times; i++) await page.getByTestId(id).click();
  })();

test.describe('shift close', () => {
  test('@smoke blind close: float + sale − expense = counted; the Z slip prints and the server agrees', async ({
    page,
  }) => {
    const f = await start(page);
    await sellCash(page);
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-expense').click();
    // only the two expense types are offered
    await expect(page.locator('[data-testid^="expense-cat-"]')).toHaveText(['مشتريات', 'مصروفات محل']);
    await page.getByTestId('expense-cat-مصروفات محل').click();
    await page.keyboard.type('5');
    await page.keyboard.press('Enter');

    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-close').click();
    // blind: the expected amount is nowhere on the counting screen
    await expect(page.getByTestId('close-expected')).toHaveCount(0);
    await click(page, 'denom-10000-plus'); // 100.00
    await click(page, 'denom-1000-plus'); // 10.00  -> 110.00 = 100 + 15 - 5
    await expect(page.getByTestId('counted-so-far')).toHaveText('110.00');
    await page.getByTestId('count-done').click();
    await expect(page.getByTestId('close-expected')).toHaveText('110.00');
    await expect(page.getByTestId('close-variance')).toHaveText('0.00');
    await page.getByTestId('close-confirm').click();
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await prints(page)).toHaveLength(0);
    await page.getByTestId('print-offer').click();

    await expect
      .poll(async () => (await prints(page)).filter((h) => h.includes(strings.shift.z)).length, {
        timeout: 8000,
      })
      .toBe(1);
    await expect
      .poll(
        () =>
          sql(
            `select status || ':' || variance || ':' || expected_total from shifts where number = '${f.prefix}-SHF-000001'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('closed:0:11000');
    await expect
      .poll(() => sql(`select amount from expenses where number = '${f.prefix}-EXP-000001'`), {
        timeout: 60_000,
      })
      .toBe('500');
  });

  test('a shortage above 20.00 needs the manager PIN and a note', async ({ page }) => {
    const f = await start(page);
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-close').click();
    await click(page, 'denom-5000-plus'); // 50.00 of 100.00 -> shortage 50.00
    await page.getByTestId('count-done').click();
    await expect(page.getByTestId('close-variance')).toHaveText('-50.00');
    await page.getByTestId('close-note').fill('نقص في الدرج');
    await page.getByTestId('close-confirm').click();
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await expect
      .poll(
        () =>
          sql(
            `select variance || ':' || (approved_by is not null) from shifts where number = '${f.prefix}-SHF-000001'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('-5000:true');
  });

  test('cash to the safe leaves the drawer count lower', async ({ page }) => {
    const f = await start(page);
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-transfer').click();
    await page.keyboard.type('30');
    await page.keyboard.press('Enter');
    await expect
      .poll(() => sql(`select amount from cash_transfers where number = '${f.prefix}-XFR-000001'`), {
        timeout: 60_000,
      })
      .toBe('3000');
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-close').click();
    await click(page, 'denom-5000-plus');
    await click(page, 'denom-2000-plus', 1); // 70.00 = 100 - 30
    await page.getByTestId('count-done').click();
    await expect(page.getByTestId('close-expected')).toHaveText('70.00');
    await expect(page.getByTestId('close-variance')).toHaveText('0.00');
  });
});

test('the manager corrects a cash account with a voucher; it reaches the server with its reason', async ({
  page,
}) => {
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.expenses }).click();
  await page.getByTestId('new-adjustment').click();
  await page.getByTestId('adjust-direction').selectOption('minus');
  await page.getByTestId('adjust-cash-reason').selectOption('count_error');
  await page.getByLabel(strings.cash.amount).fill('5');
  await page.getByTestId('save-money').click();
  await expect
    .poll(
      () =>
        sql(
          `select reason_code || ':' || amount from cash_adjustments where number = '${f.prefix}-CAJ-000001'`,
        ),
      { timeout: 60_000 },
    )
    .toBe('count_error:-500');
});
