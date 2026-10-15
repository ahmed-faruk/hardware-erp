import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { login, newCashierFixture, piasters, sql } from './helpers';
import { strings } from '../../src/ui/strings.ar';

describe('purchase and supplier payment', () => {
  test('receive 10 units, 40 cash and the rest on credit, then pay the supplier 20', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    const supplier = `Supplier ${Date.now()}`;
    await app.open('/');
    await login(screen, browser, f, 'manager');
    await screen.getByRole('button', strings.nav.suppliers).tap();
    await screen.getByTestId('new-supplier').tap();
    await screen.getByTestId('supplier-name').fill(supplier);
    await screen.getByTestId('save-supplier').tap();
    await expect(screen.getByText(supplier)).toBeVisible();
    await screen.getByRole('button', strings.nav.purchases).tap();
    await screen.getByTestId('new-purchase').tap();
    await screen.getByTestId('purchase-supplier').fill(supplier);
    await screen.getByTestId('purchase-scan').fill('Test product 5');
    await screen.getByTestId('purchase-scan').press('Enter');
    await screen.getByLabel(strings.purchases.qty).fill('10');
    await screen.getByLabel(strings.purchases.unitCost).fill('10');
    await expect(screen.getByTestId('purchase-total')).toContainText('100.00');
    await screen.getByLabel(strings.purchases.paidCash).fill('40');
    await expect(screen.getByTestId('purchase-credit')).toContainText('60.00');
    await screen.getByTestId('save-purchase').tap();
    await expect
      .poll(() => sql(`select total from purchase_invoices where number = '${f.prefix}-PUR-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(100));
    await screen.getByRole('button', strings.nav.suppliers).tap();
    await screen.getByText(supplier).tap();
    await screen.getByTestId('open-supplier-payment').tap();
    await expect(screen.getByTestId('we-owe')).toContainText('60.00');
    await screen.getByLabel(strings.supplierPay.amount).fill('20');
    await screen.getByTestId('save-supplier-payment').tap();
    await expect
      .poll(() => sql(`select amount from supplier_payments where number = '${f.prefix}-PAY-000001'`), {
        timeout: 60_000,
      })
      .toBe(piasters(20));
  });
});
