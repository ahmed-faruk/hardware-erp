import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { addProduct, login, newCashierFixture, openShift, payCash, piasters, sql } from './helpers';

describe('cash sale', () => {
  test('sell Test product 2 for 20 pounds cash and get 5.00 change', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await addProduct(screen, 2);
    await payCash(screen, browser, '20');
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
