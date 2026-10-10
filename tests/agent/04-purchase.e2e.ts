import { describe, test } from '@e2e-dev/web';
import { expect, unique } from 'e2e';

import { login, newCashierFixture, piasters, sql } from './helpers';

describe('purchase and supplier payment', () => {
  test('receive 10 units, 40 cash and the rest on credit, then pay the supplier 20', async ({
    app,
    screen,
    browser,
    agent,
  }) => {
    const f = newCashierFixture();
    const supplier = unique(`Supplier ${Date.now()}`);
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await agent.act('open Suppliers and add a supplier named {name}', { params: { name: supplier } });
    await agent.act(
      'open Purchases and receive {qty} of {product} from supplier {name} at {price} pounds each, pay {cash} pounds cash and leave the rest on credit',
      {
        params: { qty: '10', product: 'Test product 5', name: supplier, price: '10', cash: '40' },
      },
    );
    await expect
      .poll(() => sql(`select total from purchase_invoices where number = '${f.prefix}-PUR-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(100));
    await agent.act('open Suppliers and pay the supplier {name} {amount} pounds in cash', {
      params: { name: supplier, amount: '20' },
    });
    await expect
      .poll(() => sql(`select amount from supplier_payments where number = '${f.prefix}-PAY-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(20));
  });
});
