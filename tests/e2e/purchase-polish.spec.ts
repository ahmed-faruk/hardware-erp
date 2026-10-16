import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, sql, type CashierFixture } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const t = strings.purchases;

async function login(page: Page, f: CashierFixture): Promise<void> {
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page.getByRole('button', { name: new RegExp(f.managerName) }).click();
  await page.keyboard.type(f.pin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

async function openNew(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.nav.purchases }).click();
  await page.getByTestId('new-purchase').click();
  await expect(page.getByTestId('purchase-scan')).toBeVisible();
}

function suppliers(names: string[]): void {
  for (const name of names)
    sql(`insert into suppliers (id, company_id, name) values ('${randomUUID()}', '${COMPANY}', '${name}')`);
}

test.describe('new product from the purchase screen: a button, a barcode by the system or by hand', () => {
  test('the button opens the dialog with a valid system barcode; it can be changed, or typed by hand', async ({
    page,
  }) => {
    const f = newCashierFixture();
    await login(page, f);
    await openNew(page);
    await page.getByTestId('purchase-new-product').click();
    const code = await page.getByTestId('qa-barcode').inputValue();
    expect(code).toMatch(/^990\d{10}$/);
    await expect(page.getByTestId('qa-barcode')).toHaveAttribute('readonly', '');
    await page.getByTestId('qa-regen').click();
    await expect(page.getByTestId('qa-barcode')).not.toHaveValue(code);
    // by hand: empty and editable
    await page.getByTestId('qa-barcode-mode-manual').click();
    await expect(page.getByTestId('qa-barcode')).toHaveValue('');
    await expect(page.getByTestId('qa-barcode')).not.toHaveAttribute('readonly', '');
    const mine = `5${Date.now()}`.slice(0, 13);
    const name = `صنف بباركودي ${randomUUID().slice(0, 5)}`;
    await page.getByTestId('qa-name').fill(name);
    await page.getByTestId('qa-barcode').fill(mine);
    await page.getByTestId('qa-save').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from barcodes b join products p on p.id = b.product_id where p.name = '${name}' and b.code = '${mine}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1');
  });

  test('the system barcode is saved with the product and is the one shown', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f);
    await openNew(page);
    await page.getByTestId('purchase-new-product').click();
    const code = await page.getByTestId('qa-barcode').inputValue();
    const name = `صنف بباركود النظام ${randomUUID().slice(0, 5)}`;
    await page.getByTestId('qa-name').fill(name);
    await page.getByTestId('qa-save').click();
    await expect(page.getByTestId('purchase-line')).toHaveCount(1);
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from barcodes b join products p on p.id = b.product_id where p.name = '${name}' and b.code = '${code}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1');
    // scanning that code now finds the product: it adds one to the same line
    await page.getByTestId('purchase-scan').fill(code);
    await page.getByTestId('purchase-scan').press('Enter');
    await expect(page.getByTestId('pl-qty-0')).toHaveValue('2');
  });

  test('a barcode that is taken is refused, and an empty name asks for it', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f);
    await openNew(page);
    await page.getByTestId('purchase-new-product').click();
    await page.getByTestId('qa-save').click();
    await expect(page.getByText(strings.common.required)).toBeVisible();
    await page.getByTestId('qa-name').fill('صنف');
    await page.getByTestId('qa-barcode-mode-manual').click();
    await page.getByTestId('qa-barcode').fill('9000001'); // a barcode the fixture gives to product 1
    await page.getByTestId('qa-save').click();
    await expect(page.getByText(strings.products.duplicateBarcode)).toBeVisible();
  });
});

test.describe('the supplier field suggests while you type', () => {
  test('a small list of matches; arrow keys and Enter, or a tap, pick; a balance shows', async ({ page }) => {
    const f = newCashierFixture();
    const run = randomUUID().slice(0, 4);
    suppliers([`ألوان ${run} الأولى`, `ألوان ${run} التانية`, `كهرباء ${run}`]);
    await login(page, f);
    await openNew(page);
    const field = page.getByTestId('purchase-supplier');
    await field.click();
    await field.fill(`ألوان ${run}`);
    const list = page.getByTestId('purchase-supplier-list');
    await expect(list).toBeVisible();
    await expect(list.getByRole('option')).toHaveCount(2); // only the matches
    // the list is a small popup under the field, not wider than it
    const box = await list.boundingBox();
    const fieldBox = await field.boundingBox();
    expect(box!.height).toBeLessThanOrEqual(270);
    expect(box!.width).toBeLessThanOrEqual(fieldBox!.width + 1);
    await field.press('ArrowDown');
    await field.press('Enter');
    await expect(field).toHaveValue(`ألوان ${run} التانية`);
    await expect(page.getByTestId('supplier-balance')).toContainText('0.00');
    // a tap picks too
    await field.fill(`كهرباء ${run}`);
    await page.getByTestId('purchase-supplier-option-0').click();
    await expect(field).toHaveValue(`كهرباء ${run}`);
    // nothing matches: it says so, and no supplier is chosen
    await field.fill('مفيش مورد بالاسم ده');
    await expect(page.getByText(strings.common.noMatches)).toBeVisible();
    await expect(page.getByTestId('supplier-balance')).toContainText(t.pickSupplierFirst);
    await field.press('Escape');
    await expect(page.getByTestId('purchase-supplier-list')).toHaveCount(0);
  });

  test('typing the full name is enough: the supplier is chosen and the invoice can be saved', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const name = `مورد كامل ${randomUUID().slice(0, 5)}`;
    suppliers([name]);
    await login(page, f);
    await openNew(page);
    await page.getByTestId('purchase-supplier').fill(name);
    await page.getByTestId('purchase-scan').fill('Test product 5');
    await page.getByTestId('purchase-scan').press('Enter');
    await page.getByTestId('pl-cost-0').fill('4');
    await page.getByTestId('pay-mode-credit').click();
    await expect(page.getByTestId('save-purchase')).toBeEnabled();
    await page.getByTestId('save-purchase').click();
    await expect
      .poll(
        () =>
          sql(
            `select count(*) from purchase_invoices i join suppliers s on s.id = i.supplier_id where s.name = '${name}'`,
          ),
        { timeout: 60_000 },
      )
      .toBe('1');
  });

  test('the field fits a phone and is at least 44 px high', async ({ page }) => {
    const f = newCashierFixture();
    suppliers([`مورد موبايل ${randomUUID().slice(0, 4)}`]);
    await login(page, f);
    await openNew(page);
    await page.setViewportSize({ width: 320, height: 640 });
    const field = page.getByTestId('purchase-supplier');
    await field.click();
    await expect(page.getByTestId('purchase-supplier-list')).toBeVisible();
    const found = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - window.innerWidth,
      field:
        document.querySelector<HTMLElement>('[data-testid="purchase-supplier"]')?.getBoundingClientRect()
          .height ?? 0,
      option: document.querySelector<HTMLElement>('[role="option"]')?.getBoundingClientRect().height ?? 0,
    }));
    expect(found.page).toBeLessThanOrEqual(1);
    expect(found.field).toBeGreaterThanOrEqual(44);
    expect(found.option).toBeGreaterThanOrEqual(43.5);
  });
});

test.describe('the delete button in the products grid', () => {
  function product(opts: { stock: number; history: boolean }): { id: string; name: string } {
    const id = randomUUID();
    const name = `صنف الشبكة ${randomUUID().slice(0, 5)}`;
    sql(
      `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals) values ('${id}', '${COMPANY}', 'G${id.slice(0, 6)}', '${name}', 'pcs', 1000, 500, 0)`,
    );
    if (opts.history)
      for (const q of [(opts.stock + 1) * 1000, -1000])
        sql(
          `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', '${id}', 'a0000000-0000-7000-8000-0000000000c1', ${q}, 500, '${q > 0 ? 'opening' : 'sales_invoice'}', '${randomUUID()}', now())`,
        );
    return { id, name };
  }
  async function toProducts(page: Page, name: string): Promise<void> {
    await page.getByRole('button', { name: strings.nav.products }).click();
    await page.getByTestId('product-search').fill(name);
  }

  test('an unused product is deleted from its row (undo first keeps it)', async ({ page }) => {
    const f = newCashierFixture();
    const p = product({ stock: 0, history: false });
    await login(page, f);
    await toProducts(page, p.name);
    await page.getByTestId(`row-delete-${p.id}`).click();
    await expect(page.getByTestId('undo-toast')).toContainText(strings.products.deleting);
    await page.getByRole('button', { name: strings.sell.undo }).click();
    await page.waitForTimeout(1200);
    expect(sql(`select count(*) from products where id = '${p.id}' and deleted_at is null`)).toBe('1');
    await page.getByTestId(`row-delete-${p.id}`).click();
    await expect(page.getByTestId('undo-toast')).toBeVisible();
    await expect
      .poll(() => sql(`select count(*) from products where id = '${p.id}' and deleted_at is not null`), {
        timeout: 60_000,
      })
      .toBe('1');
    await expect(page.getByText(p.name)).toHaveCount(0);
    // still on the list screen: the button did not open the product
    await expect(page.getByTestId('product-search')).toBeVisible();
  });

  test('a product with history at stock 0 is archived from its row; with stock it says why and names it', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const zero = product({ stock: 0, history: true });
    const stocked = product({ stock: 3, history: true });
    await login(page, f);
    await toProducts(page, stocked.name);
    await page.getByTestId(`row-delete-${stocked.id}`).click();
    await expect(page.getByTestId('delete-blocked')).toContainText(stocked.name);
    await expect(page.getByTestId('delete-blocked')).toContainText(strings.products.deleteReasons.stock);
    await expect(page.getByText(strings.products.archiveNeedsZeroStock)).toBeVisible();
    await expect(page.getByTestId('undo-toast')).toHaveCount(0);
    await toProducts(page, zero.name);
    await page.getByTestId(`row-delete-${zero.id}`).click();
    await expect(page.getByTestId('undo-toast')).toContainText(strings.products.archiving);
    await expect
      .poll(() => sql(`select count(*) from products where id = '${zero.id}' and deleted_at is not null`), {
        timeout: 60_000,
      })
      .toBe('1');
  });

  test('clicking the row still opens the product; offline the button says it needs the internet', async ({
    page,
    context,
  }) => {
    const f = newCashierFixture();
    const p = product({ stock: 0, history: false });
    await login(page, f);
    await toProducts(page, p.name);
    await context.setOffline(true);
    await page.getByTestId(`row-delete-${p.id}`).click();
    await expect(page.getByText(strings.products.deleteNeedsNet)).toBeVisible();
    await context.setOffline(false);
    await page.getByText(p.name).first().click();
    await expect(page.getByTestId('product-name')).toHaveValue(p.name);
    expect(sql(`select count(*) from products where id = '${p.id}' and deleted_at is null`)).toBe('1');
  });
});
