import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, openShift, piasters, sql } from './helpers';

describe('credit sale and collection', () => {
  test('sell on credit to Test Customer then collect 5 pounds', async ({ app, screen, browser, agent }) => {
    const f = newCashierFixture();
    const customer = 'a0000000-0000-7000-8000-000000000c01';
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await agent.act(
      'add {product} to the cart, choose the customer {customer}, and pay the whole amount on credit, then finish the payment',
      {
        params: { product: 'Test product 3', customer: 'Test Customer' },
      },
    );
    await expect(screen.getByTestId('done')).toBeVisible();
    await expect
      .poll(
        () =>
          sql(
            `select coalesce(sum(amount),0) from party_ledger where party_id = '${customer}' and doc_type = 'sales_invoice' and device_id = '${f.deviceId}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe(piasters(17.5));
    await agent.act(
      'close the finished sale screen and start collecting {amount} pounds in cash from the customer {customer}',
      {
        params: { amount: '5', customer: 'Test Customer' },
      },
    );
    await expect
      .poll(() => sql(`select amount from customer_receipts where number = '${f.prefix}-RCV-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(5));
  });
});
