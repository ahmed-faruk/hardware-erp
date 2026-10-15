import { randomUUID } from 'node:crypto';

import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, sql } from './helpers';

describe('archive a product with history', () => {
  test('at stock 0 it is archived, shown under «المحذوف» and restored', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    const id = randomUUID();
    const name = `Agent archive ${Date.now()}`;
    sql(
      `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals) values ('${id}', 'a0000000-0000-7000-8000-000000000001', 'AG${Date.now() % 100000}', '${name}', 'pcs', 1000, 500, 0)`,
    );
    for (const [q, doc] of [
      [1000, 'opening'],
      [-1000, 'sales_invoice'],
    ] as const)
      sql(
        `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '${id}', 'a0000000-0000-7000-8000-0000000000c1', ${q}, 500, '${doc}', gen_random_uuid(), now())`,
      );
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.products).tap();
    await screen.getByTestId('product-search').fill(name);
    await screen.getByText(name).first().tap();
    await screen.getByTestId('delete-product').tap();
    await expect
      .poll(() => sql(`select count(*) from products where id = '${id}' and deleted_at is not null`), {
        timeout: 60_000,
      })
      .toBe('1');
    await screen.getByTestId('product-search').fill(name);
    await screen.getByTestId('archived-filter').tap();
    await screen.getByTestId(`restore-${id}`).tap();
    await expect
      .poll(() => sql(`select count(*) from products where id = '${id}' and deleted_at is null`), {
        timeout: 60_000,
      })
      .toBe('1');
  });
});
