import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, piasters, sql } from './helpers';

describe('return', () => {
  test('return one unit of the first invoice', async ({ app, screen, browser, agent }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await agent.act('add {product} to the cart and pay the exact amount in cash, then finish the payment', {
      params: { product: 'Test product 1' },
    });
    await expect(screen.getByTestId('done')).toBeVisible();
    await agent.act('start a return of one unit of invoice {number} and give the money back in cash', {
      params: { number: `${f.prefix}-INV-000001` },
    });
    await expect
      .poll(() => sql(`select total from sales_returns where number = '${f.prefix}-RET-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(12.5));
  });
});
