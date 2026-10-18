import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, sql } from './helpers';

test('an expense is deleted (its cash back in the box) and another one is edited', async ({ page }) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  // the money of a deleted expense comes back into the box of the open shift
  await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sell-search')).toBeVisible();

  await page.getByRole('button', { name: strings.nav.expenses }).click();
  await page.getByTestId('new-expense').click();
  await page.getByLabel(strings.cash.amount).fill('25');
  await page.getByTestId('save-money').click();
  const first = `${f.prefix}-EXP-000001`;
  await page.getByTestId(`delete-expense-${first}`).click();
  await expect(page.getByTestId('undo-toast')).toBeVisible();
  await expect(page.getByTestId(`expense-voided-${first}`)).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => sql(`select status from expenses where number = '${first}'`), { timeout: 60_000 })
    .toBe('voided');
  await expect
    .poll(
      () =>
        sql(
          `select coalesce(sum(m.amount), 0) from cash_movements m where m.doc_id in (select id from expenses where number = '${first}' union all select v.id from voids v join expenses e on e.id = v.target_id where v.target_type = 'expense' and e.number = '${first}')`,
        ),
      { timeout: 60_000 },
    )
    .toBe('0');

  await page.getByTestId('new-expense').click();
  await page.getByLabel(strings.cash.amount).fill('40');
  await page.getByTestId('save-money').click();
  await page.getByTestId(`edit-expense-${f.prefix}-EXP-000002`).click();
  await page.getByLabel(strings.cash.amount).fill('60');
  await page.getByTestId('save-money').click();
  await expect(page.getByText(strings.expenseEdit.edited)).toBeVisible();
  await expect
    .poll(
      () =>
        sql(
          `select string_agg(status || ':' || amount, ',' order by number) from expenses where number in ('${f.prefix}-EXP-000002', '${f.prefix}-EXP-000003')`,
        ),
      { timeout: 60_000 },
    )
    .toBe('voided:4000,posted:6000');
});
