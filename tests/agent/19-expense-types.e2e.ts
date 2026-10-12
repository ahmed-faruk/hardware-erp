import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, sql, typeKeys } from './helpers';

describe('expense types', () => {
  test('only مشتريات and مصروفات محل are offered, and an expense on one reaches the server', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await screen.getByTestId('shift-menu').tap();
    await screen.getByTestId('shift-expense').tap();
    await expect(screen.getByTestId('expense-cat-مشتريات')).toBeVisible();
    await expect(screen.getByTestId('expense-cat-مصروفات محل')).toBeVisible();
    await screen.getByTestId('expense-cat-مصروفات محل').tap();
    await typeKeys(browser, '5');
    await browser.keyboard.press('Enter');
    await expect
      .poll(
        () =>
          sql(
            `select c.name || ':' || e.amount from expenses e join expense_categories c on c.id = e.category_id where e.number = '${f.prefix}-EXP-000001'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('مصروفات محل:500');
  });
});
