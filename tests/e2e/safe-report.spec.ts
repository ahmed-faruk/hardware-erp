import { expect, test, type Page } from '@playwright/test';

import { formatMoney } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture, loginAs } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();

async function login(page: Page, f: CashierFixture, who: 'manager' | 'cashier'): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await loginAs(page, f, who);
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

interface ServerSafe {
  net: number;
  sections: { key: string; total: number; lines: { key: string; amount: number }[] }[];
}
/** The server's own answer for this month (the screen's default period). */
function serverSafe(): ServerSafe {
  return JSON.parse(
    sql(
      `select report_safe_core('${COMPANY}', date_trunc('month', (now() at time zone 'Africa/Cairo'))::date, (now() at time zone 'Africa/Cairo')::date)::text`,
    ),
  ) as ServerSafe;
}
const lineOf = (s: ServerSafe, key: string): number =>
  s.sections.flatMap((x) => x.lines).find((l) => l.key === key)?.amount ?? 0;

test.describe('the safe report', () => {
  test('sections, totals and net equal the server; each line opens the documents it came from', async ({
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
    // a shop expense from outside the box (listed, not counted)
    await page.getByRole('button', { name: strings.nav.expenses }).click();
    await page.getByTestId('new-expense').click();
    await page.getByTestId('expense-source-owner').click();
    await page.getByLabel(strings.cash.amount).fill('7');
    await page.getByTestId('save-money').click();
    await expect(page.getByTestId('save-money')).toHaveCount(0);
    await expect
      .poll(
        () =>
          sql(
            `select (select count(*) from sales_invoices where split_part(number, '-', 1) = '${f.prefix}') || ':' || (select count(*) from expenses where split_part(number, '-', 1) = '${f.prefix}')`,
          ),
        { timeout: 60_000 },
      )
      .toBe('2:1');

    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-safe').click();
    await expect(page.getByTestId('safe-cards')).toBeVisible();
    // the page and the database agree (retried: other work may land in between)
    await expect
      .poll(
        async () => {
          await page.getByTestId('report-tab-sales').click();
          await page.getByTestId('report-tab-safe').click();
          await expect(page.getByTestId('safe-formula-net')).toBeVisible();
          const s = serverSafe();
          const want = [
            formatMoney(s.net),
            ...['sales', 'purchases', 'expenses', 'payroll'].map((k) =>
              formatMoney(s.sections.find((x) => x.key === k)!.total),
            ),
          ];
          const got = [
            await page.getByTestId('safe-formula-net').innerText(),
            await page.getByTestId('safe-total-sales').innerText(),
            await page.getByTestId('safe-total-purchases').innerText(),
            await page.getByTestId('safe-total-expenses').innerText(),
            await page.getByTestId('safe-total-payroll').innerText(),
          ];
          return got.join('|') === want.join('|');
        },
        { timeout: 60_000 },
      )
      .toBe(true);
    await expect(page.getByTestId('safe-net')).toHaveText(formatMoney(serverSafe().net));

    // drill down: the cash sales line lists both invoices and its total equals the line
    await page.getByTestId('safe-line-cash_sales').click();
    const detail = page.getByTestId('safe-detail');
    await expect(detail).toBeVisible();
    await expect(page.getByTestId('safe-detail-rule')).toContainText(strings.reports.safeRules.cash_sales!);
    await expect(detail).toContainText(`${f.prefix}-INV-000001`);
    await expect(detail).toContainText(`${f.prefix}-INV-000002`);
    await expect(page.getByTestId('safe-detail-summary')).toContainText(
      formatMoney(lineOf(serverSafe(), 'cash_sales')),
    );
    await page.keyboard.press('Escape');
    // the outside expense is listed in «مش محسوب في الصافي»
    await page.getByTestId('safe-line-outside_expenses').click();
    await expect(page.getByTestId('safe-detail')).toContainText(`${f.prefix}-EXP-000001`);
    await page.keyboard.press('Escape');
  });

  test('a cashier has no safe tab (and no reports at all)', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f, 'cashier');
    await expect(page.getByRole('button', { name: strings.nav.reports })).toHaveCount(0);
  });

  test('the report and its drill-down fit 320, 390, 1024 and 1366 px', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f, 'manager');
    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-safe').click();
    await expect(page.getByTestId('safe-formula-net')).toBeVisible();
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
      await page.getByTestId('safe-line-cash_sales').click();
      await expect(page.getByTestId('safe-detail')).toBeVisible();
      const overDialog = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      expect(overDialog, `${width}px drill-down scrolls sideways`).toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
    }
  });
});
