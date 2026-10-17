import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, sql, loginAs } from './helpers';

test('two expenses show in the expenses report by category, equal to the database', async ({ page }) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  // only two expense types exist: «مشتريات» and «مصروفات محل»; the manager cannot add more
  await page.getByRole('button', { name: strings.nav.expenses }).click();
  await expect(page.getByTestId('category-name')).toHaveCount(0);
  await page.getByTestId('new-expense').click();
  await expect(page.getByTestId('expense-category').locator('option')).toHaveText(['مشتريات', 'مصروفات محل']);
  await page.getByTestId('expense-category').selectOption({ label: 'مصروفات محل' });
  await page.getByLabel(strings.cash.amount).fill('40');
  await page.getByTestId('save-money').click();
  await page.getByTestId('new-expense').click();
  await page.getByTestId('expense-category').selectOption({ label: 'مشتريات' });
  await page.getByLabel(strings.cash.amount).fill('35');
  await page.getByTestId('save-money').click();
  await expect
    .poll(() => sql(`select count(*) from expenses where number like '${f.prefix}-EXP-%'`), {
      timeout: 60_000,
    })
    .toBe('2');
  const today = `(e.issued_at at time zone 'Africa/Cairo')::date = (now() at time zone 'Africa/Cairo')::date and e.status = 'posted'`;
  const shop =
    Number(
      sql(
        `select coalesce(sum(e.amount), 0) from expenses e join expense_categories c on c.id = e.category_id where c.name = 'مصروفات محل' and ${today}`,
      ),
    ) / 100;
  const total = Number(sql(`select coalesce(sum(e.amount), 0) from expenses e where ${today}`)) / 100;

  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-expenses').click();
  await page.getByTestId('period-today').click();
  const table = page.getByTestId('report-table-0');
  await expect(table).toContainText('مصروفات محل');
  await expect(table).toContainText('مشتريات');
  await expect(table).toContainText(shop.toFixed(2));
  await expect(page.getByTestId('report-totals-0')).toContainText(total.toFixed(2));
});
