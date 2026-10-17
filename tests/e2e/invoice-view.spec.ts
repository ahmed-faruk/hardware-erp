import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture, loginAs } from './helpers';

const run = Math.random().toString(36).slice(2, 7);
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const t = strings.invoiceView;

async function start(page: Page): Promise<CashierFixture> {
  const f = newCashierFixture();
  await page.addInitScript(() => {
    const w = window as unknown as { __prints: string[] };
    if (window === window.top) w.__prints = [];
    else
      window.print = () =>
        (window.top as unknown as { __prints: string[] }).__prints.push(document.documentElement.outerHTML);
  });
  await loginAs(page, f, 'manager');
  await expect(page.getByTestId('sync-status')).toBeVisible();
  return f;
}

const prints = (page: Page) => page.evaluate(() => (window as unknown as { __prints: string[] }).__prints);

async function sellTwoItems(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.nav.sell }).click();
  await page.getByTestId('open-shift').click();
  await page.keyboard.type('100');
  await page.keyboard.press('Enter');
  for (const n of [2, 3])
    await page
      .locator(`[data-testid="tile-${productId(n)}"] button`)
      .first()
      .click();
  await vis(page, 'pay').click();
  await page.getByTestId('pay-cash').click();
  await page.keyboard.type('10');
  await page.keyboard.press('Enter');
  await page.getByTestId('pay-card').click();
  await page.getByTestId('full-amount').click();
  await page.keyboard.type('4321');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('remaining')).toHaveText('0.00');
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await page.getByTestId('new-sale').click();
}

test.describe('invoice view on screen', () => {
  test('E1: a sale shows its lines, totals and both payments, equal to the database; E4 prints from inside', async ({
    page,
  }) => {
    const f = await start(page);
    await sellTwoItems(page);
    const number = `${f.prefix}-INV-000001`;
    await page.getByTestId('recent').click();
    await page.getByTestId(`view-${number}`).click();
    const view = page.getByTestId('invoice-view');
    await expect(view).toBeVisible();
    await expect(page.getByTestId('iv-number')).toHaveText(number);
    await expect(view).toContainText('Test product 2');
    await expect(view).toContainText('Test product 3');
    await expect(page.getByTestId('iv-total')).toHaveText('32.50'); // 15.00 + 17.50
    const payments = page.getByTestId('iv-payments');
    await expect(payments).toContainText(strings.receipt.pay.cash);
    await expect(payments).toContainText(strings.receipt.pay.card);
    await expect(payments).toContainText('10.00');
    await expect(payments).toContainText('22.50');
    await expect(page.getByTestId('iv-status')).toHaveCount(0);
    // equal to the database once it syncs
    await expect
      .poll(() => sql(`select total from sales_invoices where number = '${number}'`), { timeout: 60_000 })
      .toBe('3250');
    // E5: a sale never shows cost or profit
    await expect(view).not.toContainText(strings.reports.tabs.profit);
    // E4: print from inside the view
    await page.getByTestId('iv-print').click();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(1);
    expect((await prints(page))[0]).toContain(number);
  });

  test('E2: a voided sale says so, and a sale with a return lists the return and the returned quantity', async ({
    page,
  }) => {
    const f = await start(page);
    await sellTwoItems(page);
    const number = `${f.prefix}-INV-000001`;
    // return one unit of the first line by invoice
    await page.getByTestId('return').click();
    await page.getByTestId(`return-${number}`).click();
    await page.getByTestId('plus-1').click();
    await page.getByTestId('confirm-return').click();
    await page.getByTestId('recent').click();
    await page.getByTestId(`view-${number}`).click();
    await expect(page.getByTestId('iv-returns')).toContainText(`${f.prefix}-RET-000001`);
    await expect(page.getByTestId('invoice-view')).toContainText('1');
    // close the view, then the recent list (each dialog has its own close button)
    for (let i = 0; i < 2; i++)
      await page.locator('dialog[open]').last().getByRole('button', { name: strings.common.close }).click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);

    // a second sale, voided
    await page
      .locator(`[data-testid="tile-${productId(1)}"] button`)
      .first()
      .click();
    await vis(page, 'pay').click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await page.getByTestId('new-sale').click();
    const second = `${f.prefix}-INV-000002`;
    await page.getByTestId('recent').click();
    await page.getByTestId(`void-${second}`).click();
    await page.getByTestId('void-reason-mistake').click();
    await page.getByTestId('recent').click();
    await page.getByTestId(`view-${second}`).click();
    await expect(page.getByTestId('iv-status')).toHaveText(t.voided);
  });

  test('E3: a purchase shows its lines, the total and the part paid from the owner pocket, equal to the database', async ({
    page,
  }) => {
    const f = await start(page);
    const supplier = `مورد عرض ${run}`;
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
    await page.getByLabel(strings.purchases.paidCash).fill('40');
    await page.getByLabel(strings.purchases.paidOwner).fill('30');
    await page.getByTestId('save-purchase').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(0);
    const number = `${f.prefix}-PUR-000001`;
    await page.getByTestId(`view-${number}`).click();
    const view = page.getByTestId('invoice-view');
    await expect(view).toContainText(supplier);
    await expect(view).toContainText('Test product 5');
    await expect(page.getByTestId('iv-total')).toHaveText('100.00');
    await expect(page.getByTestId('iv-owner')).toContainText('30.00');
    await expect(page.getByTestId('iv-payments')).toContainText('40.00');
    await expect
      .poll(() => sql(`select total from purchase_invoices where number = '${number}'`), { timeout: 60_000 })
      .toBe('10000');
    await page.getByTestId('iv-print').click();
    await expect.poll(async () => (await prints(page)).length, { timeout: 8000 }).toBe(1);
  });

  test('E6: the view fits 320, 390, 1024 and 1366 px: no sideways scroll, a 56 px print button', async ({
    page,
  }) => {
    const f = await start(page);
    await sellTwoItems(page);
    await page.getByTestId('recent').click();
    await page.getByTestId(`view-${f.prefix}-INV-000001`).click();
    await expect(page.getByTestId('invoice-view')).toBeVisible();
    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [1024, 768],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      const found = await page.evaluate(() => {
        const dialog = document.querySelector<HTMLElement>('dialog[open]:has([data-testid="invoice-view"])');
        const print = document.querySelector<HTMLElement>('[data-testid="iv-print"]');
        const view = document.querySelector<HTMLElement>('[data-testid="invoice-view"]');
        return {
          page: document.documentElement.scrollWidth - window.innerWidth,
          view: view ? view.scrollWidth - view.clientWidth : 0,
          dialog: dialog ? dialog.getBoundingClientRect().width - window.innerWidth : 0,
          print: print ? print.getBoundingClientRect().height : 0,
        };
      });
      expect(found.page, `${width}px page scrolls sideways`).toBeLessThanOrEqual(1);
      expect(found.view, `${width}px view scrolls sideways`).toBeLessThanOrEqual(1);
      expect(found.dialog, `${width}px dialog wider than the screen`).toBeLessThanOrEqual(0);
      expect(found.print, `${width}px print button`).toBeGreaterThanOrEqual(55.5);
    }
  });
});
