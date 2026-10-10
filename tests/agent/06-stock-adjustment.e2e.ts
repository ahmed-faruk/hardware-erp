import { describe, test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';

import { login, newCashierFixture, sql } from './helpers';

describe('stock adjustment', () => {
  test('count Test product 6 with the count reason', async ({ app, screen, browser, agent }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await agent.act('open the stock adjustment screen and count {product} as {n} with the reason "count"', {
      params: { product: 'Test product 6', n: unique('7') },
    });
    await expect
      .poll(() => sql(`select reason_code from stock_adjustments where number = '${f.prefix}-ADJ-000001'`), {
        timeout: 60_000,
      })
      .toBe('count');
  });
});
