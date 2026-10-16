import { expect, test, type Page } from '@playwright/test';

import { formatMoney } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function login(page: Page, f: CashierFixture, who: 'manager' | 'cashier'): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page
    .getByRole('button', { name: new RegExp(who === 'manager' ? f.managerName : f.cashierName) })
    .click();
  await page.keyboard.type(who === 'manager' ? f.pin : f.cashierPin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

/** The server's own answer for this month, read straight from the function. */
function serverSafe(): { net: number; cashNow: number; todayTotal: number } {
  const row = sql(
    `select (d ->> 'net') || ',' || (d -> 'cash_now' ->> 'total') || ',' || (d -> 'returns_today' ->> 'today_total') from (select report_safe_core('${COMPANY}', date_trunc('month', (now() at time zone 'Africa/Cairo'))::date, (now() at time zone 'Africa/Cairo')::date) d) x`,
  );
  const [net, cashNow, todayTotal] = row.split(',').map(Number) as [number, number, number];
  return { net, cashNow, todayTotal };
}

test.describe('the safe report', () => {
  test('the net, the cash now and today returns equal the database; the tables list what came in and went out', async ({
    page,
  }) => {
    const f = newCashierFixture();
    await login(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    // a cash sale (15.00), then a mixed sale: 10.00 cash and the rest by card
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
    await page
      .locator(`[data-testid="tile-${productId(5)}"] button`)
      .first()
      .click();
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
    await page.getByTestId('new-sale').click();
    await expect
      .poll(
        () => sql(`select count(*) from sales_invoices where split_part(number, '-', 1) = '${f.prefix}'`),
        {
          timeout: 60_000,
        },
      )
      .toBe('2');
    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-safe').click();
    await expect(page.getByTestId('safe-cards')).toBeVisible();
    // the page and the database agree (retried: other work may land in between)
    await expect
      .poll(
        async () => {
          await page.getByTestId('report-tab-sales').click();
          await page.getByTestId('report-tab-safe').click();
          await expect(page.getByTestId('safe-net')).toBeVisible();
          const s = serverSafe();
          return (
            [
              await page.getByTestId('safe-net').innerText(),
              await page.getByTestId('safe-cash-now').innerText(),
              await page.getByTestId('safe-returns-today').innerText(),
            ].join('|') === [s.net, s.cashNow, s.todayTotal].map(formatMoney).join('|')
          );
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    const tables = page.locator('main');
    await expect(tables).toContainText(strings.reports.safeKeys.cash_sales!);
    await expect(tables).toContainText(strings.reports.safeKeys.card_sales!);
    await expect(tables).toContainText(strings.reports.safeNet);
    // this device's drawer is listed among the accounts
    await expect(page.locator('[data-testid^="safe-account-"]').first()).toBeVisible();
  });

  test('a cashier has no safe tab (and no reports at all)', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f, 'cashier');
    await expect(page.getByRole('button', { name: strings.nav.reports })).toHaveCount(0);
  });

  test('the report fits 320, 390, 1024 and 1366 px', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-safe').click();
    await expect(page.getByTestId('safe-net')).toBeVisible();
    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [1024, 768],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(over, `${width}px page scrolls sideways`).toBeLessThanOrEqual(1);
    }
  });
});
