import { describe, test } from '@e2e-dev/web';
import { expect } from 'e2e';

import { strings } from '../../src/ui/strings.ar';

import { login, newCashierFixture, piasters, sql } from './helpers';

describe('purchase paid from the safe and from the owner pocket', () => {
  test('40 from the safe, 30 from the owner and 30 on credit: only the safe moves cash, the report splits it', async ({
    app,
    screen,
    browser,
  }) => {
    const f = newCashierFixture();
    const supplier = `Owner supplier ${Date.now()}`;
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
    await screen.getByLabel(strings.purchases.paidCash).fill('40');
    await screen.getByLabel(strings.purchases.paidOwner).fill('30');
    await expect(screen.getByTestId('purchase-credit')).toContainText('30.00');
    await screen.getByTestId('save-purchase').tap();
    const number = `${f.prefix}-PUR-000001`;
    await expect
      .poll(
        () =>
          sql(
            `select coalesce(sum(amount) filter (where method = 'owner'), 0) || ':' || coalesce(sum(amount) filter (where method = 'cash'), 0) from payments where document_id = (select id from purchase_invoices where number = '${number}')`,
          ),
        { timeout: 60_000 },
      )
      .toBe(`${piasters(30)}:${piasters(40)}`);
    expect(
      sql(
        `select coalesce(sum(amount), 0) from cash_movements where doc_id = (select id from purchase_invoices where number = '${number}')`,
      ),
    ).toBe(`-${piasters(40)}`);
    await screen.getByRole('button', strings.nav.reports).tap();
    await screen.getByTestId('report-tab-purchases').tap();
    await expect(screen.getByTestId('report-table-0')).toContainText(strings.reports.fromOwner);
    await expect(screen.getByTestId('report-table-1')).toContainText(supplier);
  });
});
