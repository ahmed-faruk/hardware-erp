import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, sql } from './helpers';

const run = Math.random().toString(36).slice(2, 7);

async function managerLogin(page: Page) {
  const f = newCashierFixture();
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  return f;
}

test.describe('purchasing and stock', () => {
  test('@smoke receive goods on credit, pay the supplier, and adjust stock; the server agrees', async ({
    page,
  }) => {
    const f = await managerLogin(page);
    const supplier = `مورد ${run}`;

    await page.getByRole('button', { name: strings.nav.suppliers }).click();
    await page.getByTestId('new-supplier').click();
    await page.getByTestId('supplier-name').fill(supplier);
    await page.getByTestId('save-supplier').click();
    await expect(page.getByText(supplier)).toBeVisible();

    await page.getByRole('button', { name: strings.nav.purchases }).click();
    await page.getByTestId('new-purchase').click();
    await page.getByTestId('purchase-supplier').fill(supplier);
    await page.getByTestId('purchase-scan').fill('Test product 5');
    await page.getByTestId('purchase-scan').press('Enter');
    await page.getByLabel(strings.purchases.qty).fill('10');
    await page.getByLabel(strings.purchases.unitCost).fill('10');
    await expect(page.getByTestId('purchase-total')).toContainText('100.00');
    await page.getByLabel(strings.purchases.paidCash).fill('40');
    await expect(page.getByTestId('purchase-credit')).toContainText('60.00');
    await page.getByTestId('save-purchase').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(0);

    await expect
      .poll(() => sql(`select total from purchase_invoices where number = '${f.prefix}-PUR-000001'`), {
        timeout: 60_000,
      })
      .toBe('10000');
    await expect
      .poll(() =>
        sql(
          `select coalesce(sum(amount), 0) from party_ledger where doc_type = 'purchase_invoice' and doc_id in (select id from purchase_invoices where number = '${f.prefix}-PUR-000001')`,
        ),
      )
      .toBe('-6000');

    // pay part of it
    await page.getByRole('button', { name: strings.nav.suppliers }).click();
    await page.getByText(supplier).click();
    await page.getByTestId('open-supplier-payment').click();
    await expect(page.getByTestId('we-owe')).toContainText('60.00');
    await page.getByLabel(strings.supplierPay.amount).fill('20');
    await page.getByTestId('save-supplier-payment').click();
    await expect
      .poll(() => sql(`select amount from supplier_payments where number = '${f.prefix}-PAY-000001'`), {
        timeout: 60_000,
      })
      .toBe('2000');

    // stock adjustment
    await page.getByRole('button', { name: strings.nav.stock }).click();
    await page.getByTestId('product-picker').fill('Test product 6');
    await page.getByTestId('product-picker').press('Enter');
    // the shared test catalog keeps stock between runs: count three more than the system says
    const system = Number(
      ((await page.getByText(`${strings.stock.system}:`).textContent()) ?? '').replace(/[^\d.-]/g, ''),
    );
    await page.getByLabel(strings.stock.counted).fill(String(system + 3));
    await expect(page.getByTestId('adjust-diff')).toContainText('3');
    await page.getByTestId('save-adjustment').click();
    await expect
      .poll(() => sql(`select reason_code from stock_adjustments where number = '${f.prefix}-ADJ-000001'`), {
        timeout: 60_000,
      })
      .toBe('count');
  });
});
