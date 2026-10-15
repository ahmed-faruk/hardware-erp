import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, productId, sql } from './helpers';

describe('purchase returns', () => {
  test('two invoices of one supplier are returned in one document', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    const run = Date.now();
    const supplier = `Agent supplier ${run}`;
    const sid = '0190f000-0000-7000-8000-0000000b1e01';
    sql(`delete from suppliers where id = '${sid}'`);
    sql(
      `insert into suppliers (id, company_id, name) values ('${sid}', 'a0000000-0000-7000-8000-000000000001', '${supplier}')`,
    );
    const numbers = [`AG-PUR-${run}A`, `AG-PUR-${run}B`];
    numbers.forEach((number, i) => {
      const inv = `0190f000-0000-7000-8000-0000000b1e1${i}`;
      sql(`delete from purchase_invoices where id = '${inv}'`);
      sql(
        `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', 'a0000000-0000-7000-8000-000000000001', '${number}', now(), '${sid}', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000)`,
      );
      sql(
        `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values (gen_random_uuid(), 'a0000000-0000-7000-8000-000000000001', '${inv}', 1, '${productId(7 + i)}', 1000, 10000, 500, 5000)`,
      );
    });
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.purchases).tap();
    await screen.getByTestId('new-purchase-return').tap();
    await screen.getByTestId('purchase-supplier').selectOption({ label: supplier });
    for (const n of numbers) await screen.getByTestId(`rt-plus-${n}-1`).tap();
    await expect(screen.getByTestId('return-total')).toContainText('10.00');
    await screen.getByTestId('save-purchase-return').tap();
    await expect
      .poll(
        () =>
          sql(
            `select count(*) || ':' || max(r.total) from purchase_returns r join purchase_return_lines l on l.return_id = r.id where r.supplier_id = '${sid}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('2:1000');
  });
});
