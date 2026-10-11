import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { addProduct, login, newCashierFixture, openShift, payCash, sql } from './helpers';

describe('offline selling', () => {
  test('two sales while every server call is aborted, then they reach the server', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await browser.route('**/rest/v1/**', async (route) => {
      await route.abort();
    });
    for (const n of [1, 2]) {
      await addProduct(screen, n);
      await payCash(screen, browser, '20');
      await expect(screen.getByTestId('done')).toBeVisible();
      await screen.getByTestId('new-sale').tap();
    }
    await browser.unroute('**/rest/v1/**');
    await expect
      .poll(
        () => sql(`select count(*) from sales_invoices where split_part(number, '-', 1) = '${f.prefix}'`),
        { timeout: 90_000 },
      )
      .toBe('2');
  });
});
