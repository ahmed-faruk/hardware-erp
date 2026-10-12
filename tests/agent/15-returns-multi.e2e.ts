import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { addProduct, login, newCashierFixture, openShift, payCash, piasters, sql } from './helpers';

describe('return without invoice with many items', () => {
  test('two sold products return in one document; an unsold product is refused', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', 'البيع').tap();
    await openShift(screen, browser);
    for (const n of [2, 3]) {
      await addProduct(screen, n);
      await payCash(screen, browser, '50');
      await expect(screen.getByTestId('done')).toBeVisible();
      await screen.getByTestId('new-sale').tap();
    }
    await screen.getByTestId('return').tap();
    await screen.getByTestId('return-free').tap();
    for (const n of [2, 3]) {
      await screen.getByTestId('free-search').fill(`Test product ${n}`);
      await screen.getByTestId(`free-P00${n}`).tap();
      await screen.getByTestId('free-add').tap();
    }
    await expect(screen.getByTestId('free-total')).toHaveText('32.50');
    await screen.getByTestId('confirm-free-return').tap();
    await expect
      .poll(
        () =>
          sql(
            `select count(*) || ':' || max(r.total) from sales_returns r join sales_return_lines l on l.return_id = r.id where r.number = '${f.prefix}-RET-000001'`,
          ),
        { timeout: 60_000 },
      )
      .toBe(`2:${piasters(32.5)}`);
  });
});
