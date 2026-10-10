import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, sql } from './helpers';

describe('offline selling', () => {
  test('two sales while every server call is aborted, then they reach the server', async ({
    app,
    screen,
    browser,
    agent,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await browser.route('**/rest/v1/**', async (route) => {
      await route.abort();
    });
    for (const product of ['Test product 1', 'Test product 2']) {
      await agent.act(
        'add {product} to the cart and pay the exact amount in cash, then finish the payment and start a new sale',
        {
          params: { product },
        },
      );
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
