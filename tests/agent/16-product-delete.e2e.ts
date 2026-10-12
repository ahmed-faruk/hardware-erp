import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, productId, sql } from './helpers';

describe('delete a product', () => {
  test('an unused product is deleted; a product that moved says why it cannot be', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    const name = `Agent delete ${Date.now()}`;
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.products).tap();
    await screen.getByTestId('new-product').tap();
    await screen.getByTestId('product-name').fill(name);
    await screen.getByTestId('save-product').tap();
    await expect
      .poll(() => sql(`select count(*) from products where name = '${name}'`), { timeout: 60_000 })
      .toBe('1');
    await screen.getByTestId('product-search').fill(name);
    await screen.getByText(name).first().tap();
    await screen.getByTestId('delete-product').tap();
    await expect
      .poll(() => sql(`select count(*) from products where name = '${name}' and deleted_at is not null`), {
        timeout: 60_000,
      })
      .toBe('1');

    // a product with a stock movement
    const doc = '0190f000-0000-7000-8000-00000000d0c9';
    sql(
      `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values ('${doc}', 'a0000000-0000-7000-8000-000000000001', '${productId(12)}', 'a0000000-0000-7000-8000-0000000000c1', 1000, 100, 'opening', '${doc}', now())`,
    );
    try {
      await screen.getByRole('button', strings.nav.products).tap();
      await screen.getByTestId('product-search').fill('Test product 12');
      await screen.getByText('Test product 12').first().tap();
      await screen.getByTestId('delete-product').tap();
      await expect(screen.getByTestId('delete-blocked')).toContainText(
        strings.products.deleteReasons.movements,
      );
    } finally {
      sql(`delete from stock_movements where id = '${doc}'`);
    }
  });
});
