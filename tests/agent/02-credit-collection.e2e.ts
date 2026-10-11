import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import {
  addProduct,
  CUSTOMER,
  login,
  newCashierFixture,
  openShift,
  payCreditToTestCustomer,
  piasters,
  sql,
  typeKeys,
} from './helpers';

describe('credit sale and collection', () => {
  test('sell on credit to Test Customer then collect 5 pounds', async ({ app, screen, browser }) => {
    const f = newCashierFixture();
    await app.open('/');
    await login(screen, browser, f, 'cashier');
    await openShift(screen, browser);
    await addProduct(screen, 2);
    await payCreditToTestCustomer(screen);
    await expect(screen.getByTestId('done')).toBeVisible();
    await expect
      .poll(
        () =>
          sql(
            `select coalesce(sum(amount), 0) from party_ledger where party_id = '${CUSTOMER}' and doc_type = 'sales_invoice' and doc_id in (select id from sales_invoices where number = '${f.prefix}-INV-000001')`,
          ),
        { timeout: 60_000 },
      )
      .toBe(piasters(15));
    await screen.getByTestId('new-sale').tap();
    await screen.getByTestId('collect').tap();
    await screen.getByTestId(`customer-${CUSTOMER}`).tap();
    await screen.getByTestId('collect-amount-btn').tap();
    await typeKeys(browser, '5');
    await browser.keyboard.press('Enter');
    await screen.getByTestId('collect-save').tap();
    await expect
      .poll(() => sql(`select amount from customer_receipts where number = '${f.prefix}-RCV-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(5));
  });
});
