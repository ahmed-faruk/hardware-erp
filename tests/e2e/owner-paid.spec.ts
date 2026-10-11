import { expect, test } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, sql } from './helpers';

const run = Math.random().toString(36).slice(2, 7);

test('a purchase paid 40 from the safe, 30 from the owner pocket and 30 on credit: server and reports agree', async ({
  page,
}) => {
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();

  const supplier = `مورد خارجي ${run}`;
  await page.getByRole('button', { name: strings.nav.suppliers }).click();
  await page.getByTestId('new-supplier').click();
  await page.getByTestId('supplier-name').fill(supplier);
  await page.getByTestId('save-supplier').click();
  await expect(page.getByText(supplier)).toBeVisible();

  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase').click();
  await page.getByTestId('purchase-supplier').selectOption({ label: supplier });
  await page.getByTestId('product-picker').fill('Test product 5');
  await page.getByTestId('product-picker').press('Enter');
  await page.getByLabel(strings.purchases.qty).fill('10');
  await page.getByLabel(strings.purchases.unitCost).fill('10');
  await expect(page.getByTestId('purchase-total')).toContainText('100.00');
  await page.getByLabel(strings.purchases.paidCash).fill('40');
  await page.getByLabel(strings.purchases.paidOwner).fill('30');
  await expect(page.getByTestId('purchase-credit')).toContainText('30.00');
  await page.getByTestId('save-purchase').click();
  await expect(page.getByTestId('purchase-line')).toHaveCount(0);

  const number = `${f.prefix}-PUR-000001`;
  await expect
    .poll(
      () =>
        sql(
          `select coalesce(sum(amount) filter (where method = 'owner'), 0) || ':' || coalesce(sum(amount) filter (where method = 'cash'), 0) from payments where document_id = (select id from purchase_invoices where number = '${number}')`,
        ),
      { timeout: 60_000 },
    )
    .toBe('3000:4000');
  expect(
    sql(
      `select coalesce(sum(amount), 0) from cash_movements where doc_id = (select id from purchase_invoices where number = '${number}')`,
    ),
  ).toBe('-4000');

  // the list shows it and the purchases report splits it
  await expect(page.getByText('30.00').first()).toBeVisible();
  await page.getByRole('button', { name: strings.nav.reports }).click();
  await page.getByTestId('report-tab-purchases').click();
  await expect(page.getByTestId('report-table-0')).toBeVisible();
  await expect(page.getByTestId('report-table-0')).toContainText(strings.reports.fromOwner);
  await expect(page.getByTestId('report-table-1')).toContainText(supplier);
});
