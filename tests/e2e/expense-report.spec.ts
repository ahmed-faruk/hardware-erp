import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, sql } from './helpers';

const run = Math.random().toString(36).slice(2, 7);

test('two expenses show in the expenses report by category, equal to the database', async ({ page }) => {
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  const category = `تقرير ${run}`;
  await page.getByRole('button', { name: strings.nav.expenses }).click();
  await page.getByTestId('category-name').fill(category);
  await page.getByTestId('add-category').click();
  await expect(page.getByTestId('categories')).toContainText(category);
  for (const amount of ['40', '35']) {
    await page.getByTestId('new-expense').click();
    await page.getByTestId('expense-category').selectOption({ label: category });
    await page.getByLabel(strings.cash.amount).fill(amount);
    await page.getByTestId('save-money').click();
  }
  await expect
    .poll(
      () =>
        sql(
          `select coalesce(sum(e.amount), 0) from expenses e join expense_categories c on c.id = e.category_id where c.name = '${category}'`,
        ),
      { timeout: 60_000 },
    )
    .toBe('7500');

  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-expenses').click();
  await page.getByTestId('period-today').click();
  const table = page.getByTestId('report-table-0');
  await expect(table).toContainText(category);
  await expect(table).toContainText('75.00');
  await expect(page.getByTestId('report-totals-0')).toBeVisible();
});
