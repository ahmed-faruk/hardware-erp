import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, piasters, sql } from './helpers';

describe('payroll', () => {
  test('salary 3000, advance 500, deduction 100: the slip pays 2400', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.workers).tap();
    await screen.getByText(f.cashierName).tap();
    await screen.getByLabel(strings.workers.monthlySalary).fill('3000');
    await screen.getByTestId('save-worker').tap();
    await expect(screen.getByTestId('save-worker')).toHaveCount(0);

    const employee = sql(`select id from workers where name = '${f.cashierName}'`);
    await screen.getByRole('button', strings.nav.payroll).tap();
    await screen.getByTestId(`advance-${employee}`).tap();
    await screen.getByLabel(strings.payroll.amount).fill('500');
    await screen.getByTestId('save-payroll').tap();
    await expect(screen.getByTestId('save-payroll')).toHaveCount(0);
    await screen.getByTestId(`deduction-${employee}`).tap();
    await screen.getByLabel(strings.payroll.amount).fill('100');
    await screen.getByTestId('save-payroll').tap();
    await expect(screen.getByTestId('save-payroll')).toHaveCount(0);
    await expect(screen.getByTestId(`net-${employee}`)).toHaveText('2400.00');
    await screen.getByTestId(`pay-salary-${employee}`).tap();
    await expect(screen.getByTestId('slip-net')).toHaveText('2400.00');
    await screen.getByTestId('confirm-salary').tap();
    await expect(screen.getByTestId('print-slip')).toBeVisible();
    await expect
      .poll(
        () =>
          sql(`select net || ':' || carry_out from payroll_entries where number = '${f.prefix}-SAL-000001'`),
        { timeout: 60_000 },
      )
      .toBe(`${piasters(2400)}:0`);
  });
});
