import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, piasters, sql, type CashierFixture } from './helpers';

describe('cash sale', () => {
  let f: CashierFixture;
  test('sell Test product 2 for 20 pounds cash and get 5.00 change', async ({
    app,
    screen,
    browser,
    agent,
  }) => {
    f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await agent.act('add {product} to the cart and pay {amount} pounds in cash, then finish the payment', {
      params: { product: 'Test product 2', amount: '20' },
    });
    await expect(screen.getByTestId('done')).toBeVisible();
    await expect
      .poll(() => sql(`select total from sales_invoices where number = '${f.prefix}-INV-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(15));
    expect(
      sql(`select cash_tendered - total from sales_invoices where number = '${f.prefix}-INV-000001'`),
    ).toBe(piasters(5));
  });
});
