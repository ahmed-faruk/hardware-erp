import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { addWorker, newCashierFixture, productId, sql, type CashierFixture } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const t = strings.purchases;

async function login(page: Page, f: CashierFixture, who: { name: string; pin: string }): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(who.name) }).click();
  await page.keyboard.type(who.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

const manager = (f: CashierFixture) => ({ name: f.managerName, pin: f.pin });

function supplier(): { id: string; name: string } {
  const id = randomUUID();
  const name = `مورد شاشة ${randomUUID().slice(0, 5)}`;
  sql(`insert into suppliers (id, company_id, name) values ('${id}', '${COMPANY}', '${name}')`);
  return { id, name };
}

async function openNew(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase').click();
  await expect(page.getByTestId('purchase-scan')).toBeVisible();
}

async function scanLine(page: Page, text: string): Promise<void> {
  await page.getByTestId('purchase-scan').fill(text);
  await page.getByTestId('purchase-scan').press('Enter');
}

const invoiceOf = (name: string) =>
  `select i.id from purchase_invoices i join suppliers s on s.id = i.supplier_id where s.name = '${name}' order by i.created_at desc limit 1`;

test.describe('the new purchase screen', () => {
  test('scanning the same item twice adds one to the quantity; a manual quantity and +/− work', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const s = supplier();
    sql(
      `insert into barcodes (id, company_id, product_id, code) values ('${randomUUID()}', '${COMPANY}', '${productId(7)}', '${Date.now()}77') on conflict do nothing`,
    );
    const code = sql(
      `select code from barcodes where product_id = '${productId(7)}' order by created_at desc limit 1`,
    );
    await login(page, f, manager(f));
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await scanLine(page, code);
    await scanLine(page, code);
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('2');
    await page.getByTestId('pl-plus-0').click();
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('3');
    await page.getByTestId('pl-minus-0').click();
    await page.getByTestId('pl-minus-0').click();
    await page.getByTestId('pl-minus-0').click(); // never below 1
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('1');
    await scanLine(page, 'اسم مش موجود أبدا');
    await expect(page.getByText(t.unknownItem)).toBeVisible();
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
  });

  test('an unknown barcode opens «صنف جديد» with the barcode filled; the storekeeper has no price field; the product goes into the invoice', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    const s = supplier();
    const barcode = `8${Date.now()}`.slice(0, 13);
    const name = `صنف سريع ${randomUUID().slice(0, 5)}`;
    await login(page, f, keeper);
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await scanLine(page, barcode);
    await expect(page.getByTestId('qa-barcode')).toHaveValue(barcode);
    await expect(page.getByTestId('qa-price')).toHaveCount(0);
    await page.getByTestId('qa-name').fill(name);
    await page.getByTestId('qa-save').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect(page.getByTestId('pl-new-0')).toContainText(t.noSalePrice);
    await expect(page.getByTestId('pl-price-0')).toHaveCount(0);
    // the cost is not known yet: the invoice cannot be saved until it is typed
    await expect(page.getByTestId('save-purchase')).toBeDisabled();
    await page.getByTestId('pl-qty-0').fill('4');
    await page.getByTestId('pl-cost-0').fill('12.50');
    await expect(page.getByTestId('purchase-total')).toContainText('50.00');
    await page.getByTestId('save-purchase').click();
    await expect
      .poll(() => sql(`select count(*) from products where name = '${name}'`), { timeout: 60_000 })
      .toBe('1');
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from barcodes b join products p on p.id = b.product_id where p.name = '${name}' and b.code = '${barcode}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1');
    await expect
      .poll(() => sql(`select total from purchase_invoices where id = (${invoiceOf(s.name)})`), {
        timeout: 60_000,
      })
      .toBe('5000');
  });

  test('the manager sees a price field in «صنف جديد» and it is saved; a taken barcode is refused', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const s = supplier();
    const barcode = `9${Date.now()}`.slice(0, 13);
    const name = `صنف بسعر ${randomUUID().slice(0, 5)}`;
    await login(page, f, manager(f));
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await scanLine(page, barcode);
    await page.getByTestId('qa-name').fill(name);
    await page.getByTestId('qa-price').fill('30');
    await page.getByTestId('qa-save').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect
      .poll(() => sql(`select price from products where name = '${name}'`), { timeout: 60_000 })
      .toBe('3000');
    // the same barcode again, for another new product
    await page.getByTestId('purchase-scan').fill(`${barcode}`);
    await page.getByTestId('purchase-scan').press('Enter'); // it exists now: adds to the same line
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('2');
    await page.getByTestId('purchase-scan').fill('6111111111999');
    await page.getByTestId('purchase-scan').press('Enter');
    await page.getByTestId('qa-name').fill('صنف تاني');
    await page.getByTestId('qa-barcode').fill(barcode);
    await page.getByTestId('qa-save').click();
    await expect(page.getByText(strings.products.duplicateBarcode)).toBeVisible();
  });

  test('«كله نقدي» and «كله آجل» make the payments equal the total', async ({ page }) => {
    const f = newCashierFixture();
    const cash = supplier();
    const credit = supplier();
    await login(page, f, manager(f));
    for (const [s, mode] of [
      [cash, 'cash'],
      [credit, 'credit'],
    ] as const) {
      await openNew(page);
      await page.getByTestId('purchase-supplier').fill(s.name);
      await scanLine(page, 'Test product 5');
      await page.getByTestId('pl-qty-0').fill('2');
      await page.getByTestId('pl-cost-0').fill('10');
      await page.getByTestId(`pay-mode-${mode}`).click();
      await expect(page.getByTestId('purchase-credit')).toContainText(mode === 'cash' ? '0.00' : '20.00');
      await page.getByTestId('save-purchase').click();
      await expect(page.getByTestId('new-purchase')).toBeVisible();
    }
    await expect
      .poll(
        () =>
          sql(
            `select coalesce(sum(amount) filter (where method = 'cash'), 0) || ':' || coalesce(sum(amount) filter (where method = 'credit'), 0) from payments where document_id = (${invoiceOf(cash.name)})`,
          ),
        { timeout: 60_000 },
      )
      .toBe('2000:0');
    await expect
      .poll(
        () =>
          sql(
            `select coalesce(sum(amount) filter (where method = 'cash'), 0) || ':' || coalesce(sum(amount) filter (where method = 'credit'), 0) from payments where document_id = (${invoiceOf(credit.name)})`,
          ),
        { timeout: 60_000 },
      )
      .toBe('0:2000');
  });

  test('an invoice discount and the supplier paper number are saved and shown in the invoice view', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const s = supplier();
    await login(page, f, manager(f));
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await page.getByTestId('purchase-supplier-ref').fill('4471');
    await scanLine(page, 'Test product 5');
    await page.getByTestId('pl-qty-0').fill('10');
    await page.getByTestId('pl-cost-0').fill('10');
    await page.getByLabel(t.discount).fill('5');
    await expect(page.getByTestId('purchase-total')).toContainText('95.00');
    await page.getByTestId('pay-mode-credit').click();
    await page.getByTestId('save-purchase').click();
    await expect
      .poll(
        () =>
          sql(
            `select supplier_ref || ':' || discount || ':' || total from purchase_invoices where id = (${invoiceOf(s.name)})`,
          ),
        { timeout: 60_000 },
      )
      .toBe('4471:500:9500');
    const number = sql(`select number from purchase_invoices where id = (${invoiceOf(s.name)})`);
    await page.getByTestId(`view-${number}`).click();
    await expect(page.getByTestId('iv-supplier-ref')).toHaveText('4471');
    await expect(page.getByTestId('iv-discount')).toHaveText('5.00');
    await expect(page.getByTestId('iv-total')).toHaveText('95.00');
  });

  test('a new price far from the last one is flagged; the last price is filled in', async ({ page }) => {
    const f = newCashierFixture();
    const s = supplier();
    const inv = randomUUID();
    sql(
      `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${inv}', '${COMPANY}', 'ZW-PUR-${inv.slice(0, 6)}', now() - interval '3 days', '${s.id}', 'a0000000-0000-7000-8000-0000000000c1', 5000, 5000)`,
    );
    sql(
      `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${inv}', 1, '${productId(8)}', 1000, 10000, 500, 5000)`,
    );
    await login(page, f, manager(f));
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await scanLine(page, 'Test product 8');
    await expect(page.getByTestId('pl-cost-0')).toHaveValue('5.00'); // the last price is filled in
    await expect(page.getByTestId('pl-hint-0')).toContainText('5.00');
    await expect(page.getByTestId('pl-warn-0')).toHaveCount(0);
    await page.getByTestId('pl-cost-0').fill('6.50'); // +30%
    await expect(page.getByTestId('pl-warn-0')).toContainText('30%');
    await page.getByTestId('pl-cost-0').fill('5.20'); // +4%
    await expect(page.getByTestId('pl-warn-0')).toHaveCount(0);
  });

  test('the draft comes back after a reload, is dropped by «امسح المسودة», and is gone after saving', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const s = supplier();
    await login(page, f, manager(f));
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await page.getByTestId('purchase-supplier-ref').fill('D-1');
    await scanLine(page, 'Test product 5');
    await page.getByTestId('pl-qty-0').fill('7');
    await expect(page.getByTestId('purchase-draft')).toContainText(t.draftSaved);
    // wait until the last edit (7 pieces) is really stored: the draft is saved a moment after typing stops
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              new Promise<string>((resolve) => {
                const req = indexedDB.open('HanafyPOS');
                req.onsuccess = () => {
                  const g = req.result
                    .transaction('deviceSettings', 'readonly')
                    .objectStore('deviceSettings')
                    .get('purchaseDraft');
                  g.onsuccess = () => resolve(JSON.stringify(g.result ?? ''));
                };
              }),
          ),
        { timeout: 10_000 },
      )
      .toContain('"qty":7000');
    await page.reload();
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('purchase-scan')).toBeVisible();
    await expect(page.getByTestId('purchase-supplier')).toHaveValue(s.name);
    await expect(page.getByTestId('purchase-supplier-ref')).toHaveValue('D-1');
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('7');
    await page.getByTestId('discard-draft').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(0);
    await page.reload();
    await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
    await page.keyboard.type(f.pin);
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('purchase-scan')).toBeVisible();
    await expect(page.getByTestId('purchase-line')).toHaveCount(0);
    // a saved invoice leaves no draft behind
    await page.getByTestId('purchase-supplier').fill(s.name);
    await scanLine(page, 'Test product 5');
    await page.getByTestId('pl-cost-0').fill('3');
    await page.getByTestId('pay-mode-credit').click();
    await page.getByTestId('save-purchase').click();
    await expect(page.getByTestId('new-purchase')).toBeVisible();
    await page.getByTestId('new-purchase').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(0);
    await expect(page.getByTestId('purchase-supplier')).toHaveValue('');
  });

  test('a supplier is added from the screen and its balance is shown', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f, manager(f));
    await openNew(page);
    const name = `مورد جديد ${randomUUID().slice(0, 5)}`;
    await page.getByTestId('purchase-new-supplier').click();
    await page.getByTestId('qs-name').fill(name);
    await page.getByTestId('qs-phone').fill('01000000000');
    await page.getByTestId('qs-save').click();
    await expect(page.getByTestId('purchase-supplier')).toHaveValue(name);
    await expect(page.getByTestId('supplier-balance')).toContainText('0.00');
    await expect
      .poll(() => sql(`select count(*) from suppliers where name = '${name}'`), { timeout: 60_000 })
      .toBe('1');
  });

  test('a storekeeper has no «مورد جديد» button by default', async ({ page }) => {
    const f = newCashierFixture();
    const keeper = addWorker('storekeeper');
    await login(page, f, keeper);
    await openNew(page);
    await expect(page.getByTestId('purchase-new-supplier')).toHaveCount(0);
  });

  test('the screen fits 320, 390, 1024 and 1366 px: no sideways scroll, a 56 px save button', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const s = supplier();
    await login(page, f, manager(f));
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(s.name);
    await scanLine(page, 'Test product 5');
    await page.getByTestId('pl-cost-0').fill('10');
    for (const [width, height] of [
      [320, 640],
      [390, 844],
      [1024, 768],
      [1366, 768],
    ] as const) {
      await page.setViewportSize({ width, height });
      await page.waitForTimeout(200);
      const found = await page.evaluate(() => ({
        page: document.documentElement.scrollWidth - window.innerWidth,
        save:
          document.querySelector<HTMLElement>('[data-testid="save-purchase"]')?.getBoundingClientRect()
            .height ?? 0,
        scan:
          document.querySelector<HTMLElement>('[data-testid="purchase-scan"]')?.getBoundingClientRect()
            .height ?? 0,
      }));
      expect(found.page, `${width}px page scrolls sideways`).toBeLessThanOrEqual(1);
      expect(found.save, `${width}px save button`).toBeGreaterThanOrEqual(55.5);
      expect(found.scan, `${width}px scan input`).toBeGreaterThanOrEqual(55.5);
    }
  });
});
