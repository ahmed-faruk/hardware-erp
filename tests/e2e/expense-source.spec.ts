import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, sql } from './helpers';

test('an expense is recorded from the box or from outside the box; only the shop type is offered', async ({
  page,
}) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  await page.getByRole('button', { name: strings.nav.expenses }).click();

  // from the box (the default)
  await page.getByTestId('new-expense').click();
  await expect(page.getByTestId('expense-category').locator('option')).toHaveText(['مصروفات محل']);
  await expect(page.getByTestId('expense-source-safe')).toHaveAttribute('aria-selected', 'true');
  await page.getByLabel(strings.cash.amount).fill('5');
  await page.getByTestId('save-money').click();
  await expect(page.getByTestId('save-money')).toHaveCount(0);

  // from outside the box
  await page.getByTestId('new-expense').click();
  await page.getByTestId('expense-source-owner').click();
  await page.getByLabel(strings.cash.amount).fill('7');
  await page.getByTestId('save-money').click();
  await expect(page.getByTestId('save-money')).toHaveCount(0);
  await expect(page.getByRole('cell', { name: strings.expenseSource.owner }).first()).toBeVisible();

  await expect
    .poll(
      () =>
        sql(
          `select string_agg(e.source || ':' || e.amount || ':' || (select count(*) from cash_movements m where m.doc_id = e.id), ',' order by e.number) from expenses e where e.number like '${f.prefix}-EXP-%'`,
        ),
      { timeout: 60_000 },
    )
    .toBe('safe:500:1,owner:700:0');
});
