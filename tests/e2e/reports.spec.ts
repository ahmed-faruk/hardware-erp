import { readFileSync } from 'node:fs';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, loginAs } from './helpers';

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

test.describe('manager reports', () => {
  test('@smoke sales report equals the database for today; CSV and A4 print work; other tabs open', async ({
    page,
  }) => {
    const f = newCashierFixture();
    await recordPrints(page);
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();

    // one sale so that today has something
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await page
      .locator(`[data-testid="tile-${productId(2)}"] button`)
      .first()
      .click();
    await page.locator('[data-testid="pay"]:visible').first().click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await expect
      .poll(() => sql(`select count(*) from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 60_000,
      })
      .toBe('1');

    await page.getByRole('button', { name: strings.nav.reports }).click();
    await page.getByTestId('report-tab-sales').click();
    await page.getByTestId('period-today').click();
    await expect(page.getByTestId('report-table-0')).toBeVisible();
    await expect
      .poll(
        async () => {
          const shown = (
            (await page.getByTestId('report-totals-0').locator('td').nth(2).textContent()) ?? ''
          ).trim();
          const total = sql(
            `select coalesce(sum(total), 0) from sales_invoices where status = 'posted' and (issued_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date`,
          );
          return Number(shown) * 100 === Number(total);
        },
        { timeout: 30_000 },
      )
      .toBe(true);
    await expect(page.getByTestId('report-up-to')).toContainText(strings.reports.upTo);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByTestId('report-csv').click(),
    ]);
    const csv = readFileSync(await download.path(), 'utf8');
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain(strings.reports.gross);

    await page.getByTestId('report-print').click();
    await expect
      .poll(async () => (await prints(page)).filter((h) => h.includes('size: A4')).length, { timeout: 8000 })
      .toBe(1);

    for (const tab of ['profit', 'exceptions', 'devices', 'stock'] as const) {
      await page.getByTestId(`report-tab-${tab}`).click();
      await expect(page.getByTestId('report-table-0')).toBeVisible();
    }
    await page.getByTestId('report-tab-devices').click();
    await expect(page.getByText(new RegExp(`\\(${f.prefix}\\)`))).toBeVisible();
  });
});
