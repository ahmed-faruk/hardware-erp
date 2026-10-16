import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { strings } from '../../src/ui/strings.ar';

import { newCashierFixture, productId, sql, type CashierFixture } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const CUSTOMER = 'a0000000-0000-7000-8000-000000000c01';
const t = strings.invoiceSearch;

async function login(page: Page, f: CashierFixture, who: 'manager' | 'cashier' = 'manager'): Promise<void> {
  await page.addInitScript(() => {
    if (window !== window.top) window.print = () => undefined;
  });
  await page.goto('/');
  await page.getByTestId('activation-code').fill(f.code);
  await page.getByTestId('activate').click();
  await page
    .getByRole('button', { name: new RegExp(who === 'manager' ? f.managerName : f.cashierName) })
    .click();
  await page.keyboard.type(who === 'manager' ? f.pin : f.cashierPin);
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('sync-status')).toBeVisible();
}

interface Seed {
  days: number;
  method: 'cash' | 'card' | 'credit';
  total: number;
  product: number;
  customer?: boolean;
  voided?: boolean;
  device?: string;
  returned?: boolean;
}

/** A sales invoice on the server, made `days` days ago. Its number carries `run` so a test can scope its search to its own data. */
function seedInvoice(run: string, i: number, s: Seed): string {
  const id = randomUUID();
  const number = `Z${run}-INV-${String(900000 + i)}`;
  sql(
    `insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status, customer_id${s.device ? ', device_id' : ''}) values ('${id}', '${COMPANY}', '${number}', now() - interval '${s.days} days', ${s.total}, ${s.total}, '${s.voided ? 'voided' : 'posted'}', ${s.customer ? `'${CUSTOMER}'` : 'null'}${s.device ? `, '${s.device}'` : ''})`,
  );
  sql(
    `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, net_amount, unit_cost) values ('${randomUUID()}', '${COMPANY}', '${id}', 1, '${productId(s.product)}', 1000, 1000, ${s.total}, ${s.total}, 100)`,
  );
  sql(
    `insert into payments (id, company_id, document_type, document_id, method, amount) values ('${randomUUID()}', '${COMPANY}', 'sales_invoice', '${id}', '${s.method}', ${s.total})`,
  );
  if (s.returned)
    sql(
      `insert into sales_returns (id, company_id, number, issued_at, total, refund_method, original_invoice_id) values ('${randomUUID()}', '${COMPANY}', 'Z${run}-RET-${String(900000 + i)}', now(), 100, 'cash', '${id}')`,
    );
  return number;
}

async function openSales(page: Page): Promise<void> {
  await page.getByRole('button', { name: strings.nav.salesInvoices }).click();
  await expect(page.getByTestId('invoice-filters')).toBeVisible();
}

test.describe("today's invoices on the sale screen", () => {
  test('all of today from every shift of this device, voided marked; not yesterday, not another device', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const run = randomUUID().slice(0, 5).toUpperCase();
    const yesterday = seedInvoice(run, 1, {
      days: 2,
      method: 'cash',
      total: 1000,
      product: 5,
      device: f.deviceId,
    });
    const other = seedInvoice(run, 2, {
      days: 0,
      method: 'cash',
      total: 1000,
      product: 5,
      device: randomUUID(),
    });
    sql(
      `insert into devices (id, company_id, name, prefix, kind, max_role) select device_id, company_id, 'other', 'O${run.slice(0, 2)}', 'pc', 'manager' from sales_invoices where number = '${other}' on conflict do nothing`,
    );
    await login(page, f);
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    const sell = async () => {
      await page
        .locator(`[data-testid="tile-${productId(2)}"] button`)
        .first()
        .click();
      await page.locator('[data-testid="pay"]:visible').first().click();
      await page.getByTestId('pay-cash').click();
      await page.keyboard.type('20');
      await page.keyboard.press('Enter');
      await page.getByTestId('finish').click();
      await expect(page.getByTestId('done')).toBeVisible();
      await page.getByTestId('new-sale').click();
    };
    await sell(); // shift 1, invoice 1
    // close shift 1 (blind count: nothing counted, so a manager note is needed; use the shortage flow)
    await page.getByTestId('shift-menu').click();
    await page.getByTestId('shift-close').click();
    for (const [d, n] of [
      ['10000', 1],
      ['1000', 1],
      ['500', 1],
    ] as const)
      for (let i = 0; i < n; i++) await page.getByTestId(`denom-${d}-plus`).click();
    await page.getByTestId('count-done').click();
    await page.getByTestId('close-confirm').click();
    await expect(page.getByTestId('open-shift')).toBeVisible();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await sell(); // shift 2, invoice 2
    await sell(); // invoice 3
    // void invoice 2
    await page.getByTestId('recent').click();
    await page.getByTestId(`void-${f.prefix}-INV-000002`).click();
    await page.getByTestId('void-reason-mistake').click();
    await page.getByTestId('recent').click();
    for (const n of [1, 2, 3])
      await expect(page.getByTestId(`recent-${f.prefix}-INV-00000${n}`)).toBeVisible();
    await expect(page.getByTestId(`voided-${f.prefix}-INV-000002`)).toBeVisible();
    await expect(page.getByTestId(`voided-${f.prefix}-INV-000001`)).toHaveCount(0);
    await expect(page.getByTestId(`recent-${yesterday}`)).toHaveCount(0);
    await expect(page.getByTestId(`recent-${other}`)).toHaveCount(0);
    // newest first
    const order = await page
      .locator('[data-testid^="recent-"]')
      .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
    expect(order).toEqual([3, 2, 1].map((n) => `recent-${f.prefix}-INV-00000${n}`));
  });
});

test.describe('the sales invoices screen', () => {
  test('a cashier does not see it; a manager does', async ({ page }) => {
    const f = newCashierFixture();
    await login(page, f, 'cashier');
    await expect(page.getByRole('button', { name: strings.nav.salesInvoices })).toHaveCount(0);
  });

  test('every filter narrows the list the way the database says, alone and together', async ({ page }) => {
    const f = newCashierFixture();
    const run = randomUUID().slice(0, 5).toUpperCase();
    const x1 = seedInvoice(run, 1, { days: 0, method: 'cash', total: 1000, product: 5 });
    const x2 = seedInvoice(run, 2, { days: 3, method: 'card', total: 5000, product: 6, customer: true });
    const x3 = seedInvoice(run, 3, {
      days: 10,
      method: 'credit',
      total: 3000,
      product: 5,
      customer: true,
      voided: true,
    });
    const x4 = seedInvoice(run, 4, { days: 40, method: 'cash', total: 500, product: 7 });
    const x5 = seedInvoice(run, 5, { days: 1, method: 'cash', total: 2000, product: 6, returned: true });
    await login(page, f);
    await openSales(page);
    const shown = async () => {
      await page.waitForTimeout(500);
      return (
        await page
          .locator('[data-testid^="view-"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)))
      ).sort();
    };
    const mine = [x1, x2, x3, x4, x5].sort();
    await page.getByTestId('f-number').fill(run); // scope to this test's data
    expect(await shown()).toEqual(mine);
    // method
    await page.getByTestId('f-method').selectOption('card');
    expect(await shown()).toEqual([x2]);
    await page.getByTestId('f-method').selectOption('credit');
    expect(await shown()).toEqual([x3]);
    await page.getByTestId('f-method').selectOption('');
    // status
    await page.getByTestId('f-status').selectOption('voided');
    expect(await shown()).toEqual([x3]);
    await page.getByTestId('f-status').selectOption('returned');
    expect(await shown()).toEqual([x5]);
    await page.getByTestId('f-status').selectOption('posted');
    expect(await shown()).toEqual([x1, x2, x4, x5].sort());
    await page.getByTestId('f-status').selectOption('');
    // amount
    await page.getByTestId('f-min').fill('20');
    await page.getByTestId('f-max').fill('50');
    expect(await shown()).toEqual([x2, x3, x5].sort());
    await page.getByTestId('f-min').fill('');
    await page.getByTestId('f-max').fill('');
    // customer
    await page.getByTestId('f-party').fill('Test Customer');
    expect(await shown()).toEqual([x2, x3].sort());
    await page.getByTestId('f-party').fill('');
    // product by name
    await page.getByTestId('f-product').fill('Test product 5');
    expect(await shown()).toEqual([x1, x3].sort());
    await page.getByTestId('f-product').fill('');
    // dates: the last 7 days
    const day = (back: number) =>
      sql(`select to_char((now() at time zone 'Africa/Cairo')::date - ${back}, 'YYYY-MM-DD')`);
    await page.getByTestId('f-from').fill(day(7));
    await page.getByTestId('f-to').fill(day(0));
    expect(await shown()).toEqual([x1, x2, x5].sort());
    // together: card AND the last 7 days AND product 6
    await page.getByTestId('f-method').selectOption('card');
    await page.getByTestId('f-product').fill('Test product 6');
    expect(await shown()).toEqual([x2]);
    // nothing matches: it says so
    await page.getByTestId('f-party').fill('اسم مش موجود');
    await expect(page.getByText(t.none)).toBeVisible();
    // reset: everything of the test again (the number filter is cleared too, so scope it again)
    await page.getByTestId('f-reset').click();
    await page.getByTestId('f-number').fill(run);
    expect(await shown()).toEqual(mine);
    await expect(page.getByTestId('status-' + x3)).toHaveText(t.statusVoided);
    await expect(page.getByTestId('status-' + x5)).toHaveText(t.statusReturned);
    await expect(page.getByTestId('result-count')).toContainText('5');
  });

  test('a sale made on the device is found by its barcode and its worker, and opens in the invoice view', async ({
    page,
  }) => {
    const f = newCashierFixture();
    await login(page, f);
    await page.getByRole('button', { name: strings.nav.sell }).click();
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    await page
      .locator(`[data-testid="tile-${productId(2)}"] button`)
      .first()
      .click();
    await page.locator('[data-testid="pay"]:visible').first().click();
    await page.getByTestId('pay-cash').click();
    await page.keyboard.type('20');
    await page.keyboard.press('Enter');
    await page.getByTestId('finish').click();
    await expect(page.getByTestId('done')).toBeVisible();
    await openSales(page);
    await page.getByTestId('f-number').fill(f.prefix);
    await page.getByTestId('f-product').fill('9000002'); // the barcode the fixture gives to product 2
    await page.getByTestId('f-worker').selectOption({ label: f.managerName });
    await expect(page.getByTestId(`view-${f.prefix}-INV-000001`)).toBeVisible();
    await page.getByTestId(`view-${f.prefix}-INV-000001`).click();
    await expect(page.getByTestId('iv-total')).toHaveText('15.00');
    // a worker nobody used finds nothing
    await page.keyboard.press('Escape');
    await page.getByTestId('f-worker').selectOption({ label: f.cashierName });
    await expect(page.getByText(t.none)).toBeVisible();
  });

  test('the old history is searched on the server: filters, a detail, and an offline message', async ({
    page,
    context,
  }) => {
    const f = newCashierFixture();
    const base = 500_000 + Math.floor(Math.random() * 400_000);
    sql(`delete from legacy_sales where id between ${base} and ${base + 3}`);
    sql(
      `insert into legacy_sales (company_id, id, kind, day, total, cash, card) values ('${COMPANY}', ${base}, 0, '2019-05-05', 12345, 12345, 0), ('${COMPANY}', ${base + 1}, 0, '2019-05-06', 99900, 0, 99900), ('${COMPANY}', ${base + 2}, 1, '2019-05-07', 500, 500, 0)`,
    );
    sql(
      `insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost) values (${base}, 1, null, 'دهان قديم ${base}', 2000, 12345, 6000)`,
    );
    try {
      await login(page, f);
      await openSales(page);
      await page.getByTestId('sales-mode-old').click();
      await expect(page.getByTestId('old-note')).toBeVisible();
      await page.getByTestId('f-number').fill(String(base));
      const legacyNumber = `LG-INV-${String(base).padStart(6, '0')}`;
      await expect(page.getByTestId(`view-${legacyNumber}`)).toBeVisible();
      await expect(page.getByTestId('result-count')).toContainText('1');
      await page.getByTestId('f-number').fill(String(base).slice(0, 5));
      await page.getByTestId('f-from').fill('2019-05-06');
      await page.getByTestId('f-to').fill('2019-05-06');
      await expect(page.getByTestId(`view-LG-INV-${String(base + 1).padStart(6, '0')}`)).toBeVisible();
      await expect(page.getByTestId(`view-${legacyNumber}`)).toHaveCount(0);
      await page.getByTestId('f-from').fill('');
      await page.getByTestId('f-to').fill('');
      await page.getByTestId('f-number').fill(String(base));
      await page.getByTestId(`view-${legacyNumber}`).click();
      await expect(page.getByTestId('old-detail')).toContainText(`دهان قديم ${base}`);
      await expect(page.getByTestId('old-detail-total')).toContainText('123.45');
      await page.keyboard.press('Escape');
      // offline: it says so instead of an empty list
      await context.route('**/rpc/search_legacy_sales*', (r) => r.abort());
      await page.getByTestId('f-number').fill(String(base + 1));
      await expect(page.getByText(t.needsNet)).toBeVisible();
      await context.unroute('**/rpc/search_legacy_sales*');
    } finally {
      sql(`delete from legacy_sale_lines where sale_id between ${base} and ${base + 3}`);
      sql(`delete from legacy_sales where id between ${base} and ${base + 3}`);
    }
  });

  test('the screen fits 320, 390, 1024 and 1366 px: no sideways scroll, fields of 44 px', async ({
    page,
  }) => {
    const f = newCashierFixture();
    const run = randomUUID().slice(0, 5).toUpperCase();
    seedInvoice(run, 1, { days: 0, method: 'cash', total: 1000, product: 5 });
    await login(page, f);
    await openSales(page);
    await page.getByTestId('f-number').fill(run);
    await expect(page.locator('[data-testid^="view-"]').first()).toBeVisible();
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
        field: Math.min(
          ...[...document.querySelectorAll<HTMLElement>('[data-testid^="f-"]:not(button)')].map(
            (e) => e.getBoundingClientRect().height,
          ),
        ),
      }));
      expect(found.page, `${width}px page scrolls sideways`).toBeLessThanOrEqual(1);
      expect(found.field, `${width}px filter fields`).toBeGreaterThanOrEqual(43.5);
    }
  });
});

test.describe('filters on the purchases screen', () => {
  test('supplier, payment method, amount, product and status narrow the list', async ({ page }) => {
    const f = newCashierFixture();
    const run = randomUUID().slice(0, 5).toUpperCase();
    const sup1 = randomUUID();
    const sup2 = randomUUID();
    sql(
      `insert into suppliers (id, company_id, name) values ('${sup1}', '${COMPANY}', 'مورد ${run} أ'), ('${sup2}', '${COMPANY}', 'مورد ${run} ب')`,
    );
    const buy = (
      i: number,
      sup: string,
      prod: number,
      net: number,
      method: string,
      days: number,
      returned = false,
    ): string => {
      const id = randomUUID();
      const number = `Z${run}-PUR-${900000 + i}`;
      sql(
        `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total) values ('${id}', '${COMPANY}', '${number}', now() - interval '${days} days', '${sup}', 'a0000000-0000-7000-8000-0000000000c1', ${net}, ${net})`,
      );
      sql(
        `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${id}', 1, '${productId(prod)}', 1000, 1000, ${net}, ${net})`,
      );
      sql(
        `insert into payments (id, company_id, document_type, document_id, method, amount) values ('${randomUUID()}', '${COMPANY}', 'purchase_invoice', '${id}', '${method}', ${net})`,
      );
      if (returned)
        sql(
          `insert into purchase_returns (id, company_id, number, issued_at, supplier_id, total, original_invoice_id) values ('${randomUUID()}', '${COMPANY}', 'Z${run}-PRT-${900000 + i}', now(), '${sup}', 100, '${id}')`,
        );
      return number;
    };
    const p1 = buy(1, sup1, 5, 5000, 'credit', 0);
    const p2 = buy(2, sup2, 6, 8000, 'owner', 2, true);
    const p3 = buy(3, sup2, 5, 1000, 'cash', 40);
    await login(page, f);
    await page.getByRole('button', { name: strings.nav.purchases }).click();
    const shown = async () => {
      await page.waitForTimeout(500);
      return (
        await page
          .locator('[data-testid^="view-"]')
          .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.slice(5)))
      ).sort();
    };
    await page.getByTestId('f-number').fill(`Z${run}`);
    expect(await shown()).toEqual([p1, p2, p3].sort());
    await page.getByTestId('f-party').fill(`مورد ${run} ب`);
    expect(await shown()).toEqual([p2, p3].sort());
    await page.getByTestId('f-method').selectOption('owner');
    expect(await shown()).toEqual([p2]);
    await page.getByTestId('f-method').selectOption('');
    await page.getByTestId('f-party').fill('');
    await page.getByTestId('f-status').selectOption('returned');
    expect(await shown()).toEqual([p2]);
    await page.getByTestId('f-status').selectOption('');
    await page.getByTestId('f-min').fill('40');
    expect(await shown()).toEqual([p1, p2].sort());
    await page.getByTestId('f-min').fill('');
    await page.getByTestId('f-product').fill('Test product 5');
    expect(await shown()).toEqual([p1, p3].sort());
    await page.getByTestId('f-product').fill('');
    const d = (back: number) =>
      sql(`select to_char((now() at time zone 'Africa/Cairo')::date - ${back}, 'YYYY-MM-DD')`);
    await page.getByTestId('f-from').fill(d(7));
    expect(await shown()).toEqual([p1, p2].sort());
    // device and shift filters are for sales only
    await expect(page.getByTestId('f-device')).toHaveCount(0);
    await expect(page.getByTestId('f-shift')).toHaveCount(0);
  });
});
