import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, sql, loginAs } from './helpers';

test('salary 3000, advance 500, deduction 100: the slip pays 2400 and the server agrees', async ({
  page,
}) => {
  const f = newCashierFixture();
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  // the cashier gets a monthly salary
  await page.getByRole('button', { name: strings.nav.workers }).click();
  await page.getByText(f.cashierName).click();
  await page.getByLabel(strings.workers.monthlySalary).fill('3000');
  await page.getByTestId('save-worker').click();
  await expect(page.getByTestId('save-worker')).toHaveCount(0);

  await page.getByRole('button', { name: strings.nav.payroll }).click();
  const card = page.locator('[data-testid^="payroll-"]').filter({ hasText: f.cashierName });
  await expect(card).toBeVisible();
  await card.locator('[data-testid^="advance-"]').click();
  await page.getByLabel(strings.payroll.amount).fill('500');
  await page.getByTestId('save-payroll').click();
  await expect(page.getByTestId('save-payroll')).toHaveCount(0);
  await card.locator('[data-testid^="deduction-"]').click();
  await page.getByLabel(strings.payroll.amount).fill('100');
  await page.getByTestId('save-payroll').click();
  await expect(page.getByTestId('save-payroll')).toHaveCount(0);

  await expect(card.locator('[data-testid^="net-"]')).toHaveText('2400.00');
  await card.locator('[data-testid^="pay-salary-"]').click();
  await expect(page.getByTestId('slip-gross')).toHaveText('3000.00');
  await expect(page.getByTestId('slip-advances')).toHaveText('500.00');
  await expect(page.getByTestId('slip-deductions')).toHaveText('100.00');
  await expect(page.getByTestId('slip-net')).toHaveText('2400.00');
  await page.getByTestId('confirm-salary').click();
  await expect(page.getByTestId('print-slip')).toBeVisible();

  await expect
    .poll(
      () =>
        sql(
          `select net || ':' || carry_out || ':' || advances_total from payroll_entries where number = '${f.prefix}-SAL-000001'`,
        ),
      {
        timeout: 60_000,
      },
    )
    .toBe('240000:0:50000');
  expect(
    sql(
      `select coalesce(sum(m.amount), 0) from cash_movements m join payroll_entries p on p.id = m.doc_id where p.number like '${f.prefix}-%'`,
    ),
  ).toBe('-290000');

  await page.keyboard.press('Escape');

  // the report and the expenses report both show it
  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-payroll').click();
  await page.getByTestId('period-today').click();
  await expect(page.getByTestId('report-table-0')).toContainText(f.cashierName);
  await expect(page.getByTestId('report-table-0')).toContainText('2400.00');
});
