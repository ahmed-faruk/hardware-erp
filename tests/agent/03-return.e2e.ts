import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { addProduct, login, newCashierFixture, openShift, payCash, piasters, sql } from './helpers';

describe('return', () => {
  test('return one unit of the first invoice', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await addProduct(screen, 2);
    await payCash(screen, browser, '20');
    await expect(screen.getByTestId('done')).toBeVisible();
    await screen.getByTestId('new-sale').tap();
    await screen.getByTestId('return').tap();
    await screen.getByTestId(`return-${f.prefix}-INV-000001`).tap();
    await screen.getByTestId('plus-1').tap();
    await expect(screen.getByTestId('refund-total')).toHaveText('15.00');
    await screen.getByTestId('confirm-return').tap();
    await expect
      .poll(() => sql(`select total from sales_returns where number = '${f.prefix}-RET-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(15));
  });
});
