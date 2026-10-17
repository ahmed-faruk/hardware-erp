import { expect, test, type Page } from '@playwright/test';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

/** R1 in miniature (PRD flow 7): two devices lose the network, sell, return and take credit all "day", then reconnect. */
/** The first device opens the shop's one shift; the second one finds it already open (it syncs in). */
async function openDevice(page: Page, f: CashierFixture, opensShift: boolean): Promise<CashierFixture> {
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined; // never open a real print dialog
  });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.cashierName) }).click();
  await page.keyboard.type(f.cashierPin);
  await page.keyboard.press('Enter');
  if (opensShift) {
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
  }
  await expect(page.getByTestId('sell-search')).toBeVisible({ timeout: 60_000 });
  return f;
}

async function sell(page: Page, method: 'cash' | 'credit'): Promise<void> {
  await page
    .locator(`[data-testid="tile-${productId(2)}"] button`)
    .first()
    .click(); // 15.00
  await page.locator('[data-testid="pay"]:visible').first().click();
  if (method === 'cash') {
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
  } else {
    await page.getByTestId('pay-credit').click();
    await page.getByTestId('customer-a0000000-0000-7000-8000-000000000c01').click();
    await page.getByTestId('full-amount').click();
  }
  await page.getByTestId('finish').click();
  await expect(page.getByTestId('done')).toBeVisible();
  await page.getByTestId('new-sale').click();
}

/** The stock of product 2 this device holds locally (summed over warehouses), read straight from its IndexedDB. */
const localStock = (page: Page): Promise<number> =>
  page.evaluate(
    (pid) =>
      new Promise<number>((resolve, reject) => {
        const open = indexedDB.open('HanafyPOS');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const all = open.result.transaction('stockBalances').objectStore('stockBalances').getAll();
          all.onsuccess = () => {
            open.result.close();
            resolve(
              (all.result as { productId: string; qty: number }[])
                .filter((b) => b.productId === pid)
                .reduce((a, b) => a + b.qty, 0),
            );
          };
        };
      }),
    productId(2),
  );

test('@smoke two devices offline all day: sales, a return and a credit sale, then identical stock and balances everywhere', async ({
  browser,
}) => {
  test.setTimeout(300_000);
  const ctxA = await browser.newContext();
  const ctxB = await browser.newContext();
  const a = await ctxA.newPage();
  const b = await ctxB.newPage();
  // both fixtures first: creating a fixture closes any shift left open
  const fa = newCashierFixture();
  const fb = newCashierFixture();
  await openDevice(a, fa, true);
  await expect(a.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
  await openDevice(b, fb, false);
  // both devices have finished their first sync before the router is "unplugged"
  await expect(a.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });
  await expect(b.getByTestId('sync-pending')).toHaveText('0', { timeout: 60_000 });

  await ctxA.setOffline(true);
  await ctxB.setOffline(true);

  for (let i = 0; i < 3; i++) await sell(a, 'cash');
  await a.getByTestId('return').click();
  await a.getByTestId(`return-${fa.prefix}-INV-000001`).click();
  await a.getByTestId('plus-1').click();
  await a.getByTestId('confirm-return').click();
  await expect(a.getByTestId('return')).toBeVisible();

  await sell(b, 'cash');
  await sell(b, 'cash');
  await sell(b, 'credit');

  await ctxA.setOffline(false);
  await ctxB.setOffline(false);
  await expect(a.getByTestId('sync-pending')).toHaveText('0', { timeout: 120_000 });
  await expect(b.getByTestId('sync-pending')).toHaveText('0', { timeout: 120_000 });

  const prefixes = `'${fa.prefix}', '${fb.prefix}'`;
  // nothing lost, nothing doubled: 6 invoices + 1 return reached the server exactly once
  await expect
    .poll(
      () => sql(`select count(*) from sales_invoices where split_part(number, '-', 1) in (${prefixes})`),
      { timeout: 60_000 },
    )
    .toBe('6');
  expect(sql(`select count(*) from sales_returns where split_part(number, '-', 1) in (${prefixes})`)).toBe(
    '1',
  );
  // the day's net effect on product 2: −6 sold + 1 returned
  expect(
    sql(
      `select sum(qty) from stock_movements where product_id = '${productId(2)}' and (doc_id in (select id from sales_invoices where split_part(number, '-', 1) in (${prefixes})) or doc_id in (select id from sales_returns where split_part(number, '-', 1) in (${prefixes})))`,
    ),
  ).toBe('-5000');
  // the customer owes exactly the one credit sale of 15.00 from this test on top of what he owed before
  expect(
    sql(
      `select coalesce(sum(amount), 0) from party_ledger where doc_id in (select id from sales_invoices where split_part(number, '-', 1) = '${fb.prefix}')`,
    ),
  ).toBe('1500');

  // after a reload both devices pull each other's movements and agree with the server
  await a.reload();
  await b.reload();
  const server = Number(sql(`select sum(qty) from stock_movements where product_id = '${productId(2)}'`));
  await expect.poll(() => localStock(a), { timeout: 60_000 }).toBe(server);
  await expect.poll(() => localStock(b), { timeout: 60_000 }).toBe(server);
  await ctxA.close();
  await ctxB.close();
});
