import { randomInt, randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

import { formatMoney, formatQty } from '../../src/domain/money';
import { strings } from '../../src/ui/strings.ar';

import { loginAs, newCashierFixture, productId, sql } from './helpers';

const COMPANY = 'a0000000-0000-7000-8000-000000000001';
const WAREHOUSE = 'a0000000-0000-7000-8000-0000000000c1';
const vis = (page: Page, id: string) => page.locator(`[data-testid="${id}"]:visible`).first();
const tag = (): string =>
  randomUUID()
    .replace(/[^0-9a-f]/g, '')
    .slice(0, 4)
    .toUpperCase();

interface Line {
  id?: string;
  qty: number;
  factor: number;
  net: number;
  alloc: number;
  cost: number;
}
function invoice(number: string, status: 'posted' | 'voided', lines: Line[]): string {
  const id = randomUUID();
  const total = lines.reduce((a, l) => a + l.net - l.alloc, 0);
  sql(
    `insert into sales_invoices (id, company_id, number, issued_at, total, subtotal, status) values ('${id}', '${COMPANY}', '${number}', now(), ${total}, ${total}, '${status}')`,
  );
  lines.forEach((l, i) =>
    sql(
      `insert into sales_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_price, alloc_discount, net_amount, unit_cost) values ('${l.id ?? randomUUID()}', '${COMPANY}', '${id}', ${i + 1}, '${productId(2)}', ${l.factor}, ${l.qty}, ${l.net}, ${l.alloc}, ${l.net}, ${l.cost})`,
    ),
  );
  return id;
}
function salesReturn(
  invoiceId: string,
  number: string,
  status: 'posted' | 'voided',
  originalLineId: string,
): void {
  const id = randomUUID();
  sql(
    `insert into sales_returns (id, company_id, number, issued_at, total, refund_method, original_invoice_id, status) values ('${id}', '${COMPANY}', '${number}', now(), 1500, 'credit', '${invoiceId}', '${status}')`,
  );
  sql(
    `insert into sales_return_lines (id, company_id, return_id, original_line_id, product_id, qty, net_amount, unit_cost) values ('${randomUUID()}', '${COMPANY}', '${id}', '${originalLineId}', '${productId(2)}', 1000, 1500, 1000)`,
  );
}

test.describe('profit and cart facts', () => {
  test('the sales invoices screen shows each invoice profit: lines, carton, discount, returns, voided, negative', async ({
    page,
  }) => {
    const t = tag();
    const a = `PA${t}-INV-000001`;
    const b = `PB${t}-INV-000001`;
    const c = `PC${t}-INV-000001`;
    const d = `PD${t}-INV-000001`;
    // A: 2 pcs (net 30.00, cost 10.00 each) + 1 carton of 12 (net 200.00, 10.00 invoice discount, cost 10.00 a piece) = 80.00
    invoice(a, 'posted', [
      { qty: 2000, factor: 1000, net: 3000, alloc: 0, cost: 1000 },
      { qty: 1000, factor: 12000, net: 20000, alloc: 1000, cost: 1000 },
    ]);
    // B: voided -> no profit shown
    invoice(b, 'voided', [{ qty: 1000, factor: 1000, net: 3000, alloc: 0, cost: 1000 }]);
    // C: profit 10.00, one piece returned (posted, -5.00); a voided return is ignored -> 5.00
    const lineC = randomUUID();
    const cId = invoice(c, 'posted', [
      { id: lineC, qty: 2000, factor: 1000, net: 3000, alloc: 0, cost: 1000 },
    ]);
    salesReturn(cId, `PC${t}-RET-000001`, 'posted', lineC);
    salesReturn(cId, `PC${t}-RET-000002`, 'voided', lineC);
    // D: sold below cost -> -5.00
    invoice(d, 'posted', [{ qty: 1000, factor: 1000, net: 500, alloc: 0, cost: 1000 }]);

    const f = newCashierFixture();
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: strings.nav.salesInvoices }).click();
    await expect(page.getByTestId(`profit-${a}`)).toHaveText(formatMoney(8000), { timeout: 60_000 });
    await expect(page.getByTestId(`profit-${b}`)).toHaveText('—');
    await expect(page.getByTestId(`profit-${c}`)).toHaveText(formatMoney(500));
    await expect(page.getByTestId(`profit-${d}`)).toHaveText(formatMoney(-500));
  });

  test('the old-system tab shows the profit of a sale and of a return', async ({ page }) => {
    const sale = randomInt(600000, 800000);
    const ret = sale + 1;
    sql(
      `insert into legacy_sales (company_id, id, kind, day, total, cash) values ('${COMPANY}', ${sale}, 0, (now() at time zone 'Africa/Cairo')::date, 10000, 10000), ('${COMPANY}', ${ret}, 1, (now() at time zone 'Africa/Cairo')::date, 3000, 3000) on conflict (id) do nothing`,
    );
    sql(
      `insert into legacy_sale_lines (sale_id, line_no, product_id, text, qty, net, cost) values (${sale}, 1, null, 'x', 2000, 6000, 4000), (${sale}, 2, null, 'y', 1000, 4000, 1000), (${ret}, 1, null, 'x', 1000, 3000, 2000) on conflict do nothing`,
    );
    const f = newCashierFixture();
    await loginAs(page, f, 'manager');
    await expect(page.getByTestId('sync-status')).toBeVisible();
    await page.getByRole('navigation').getByRole('button', { name: strings.nav.salesInvoices }).click();
    await page.getByTestId('sales-mode-old').click();
    await expect(page.getByTestId(`profit-LG-INV-${sale}`)).toHaveText(formatMoney(5000), {
      timeout: 60_000,
    });
    await expect(page.getByTestId(`profit-LG-RET-${ret}`)).toHaveText(formatMoney(-1000));
  });

  test('each cart line shows the stock left after the sale and the last purchase price (or the product cost)', async ({
    page,
  }) => {
    const t = tag();
    // own products only (other tests running at the same time sell the seed products and change their stock)
    // fresh: never bought here and no stock -> cost falls back to its own (12.34), stock left goes below zero
    const fresh = randomUUID();
    // bought: 5 pcs on the shelf; bought 2 pcs for 15.00 -> last purchase price 7.50 a piece (its own cost 9.99 is not shown)
    const bought = randomUUID();
    sql(
      `insert into products (id, company_id, sku, name, base_unit_name, price, unit_cost, qty_decimals) values ('${fresh}', '${COMPANY}', 'CF${t}A', 'Freshcf${t}', 'pcs', 2000, 1234, 0), ('${bought}', '${COMPANY}', 'CF${t}B', 'Boughtcf${t}', 'pcs', 2000, 999, 0)`,
    );
    sql(
      `insert into stock_movements (id, company_id, product_id, warehouse_id, qty, unit_cost, doc_type, doc_id, occurred_at) values ('${randomUUID()}', '${COMPANY}', '${bought}', '${WAREHOUSE}', 5000, 750, 'opening', '${randomUUID()}', now())`,
    );
    const supplier = randomUUID();
    const purchase = randomUUID();
    sql(`insert into suppliers (id, company_id, name) values ('${supplier}', '${COMPANY}', 'Supplier ${t}')`);
    sql(
      `insert into purchase_invoices (id, company_id, number, issued_at, supplier_id, warehouse_id, subtotal, total, status) values ('${purchase}', '${COMPANY}', 'CF${t}-PUR-000001', now(), '${supplier}', '${WAREHOUSE}', 1500, 1500, 'posted')`,
    );
    sql(
      `insert into purchase_invoice_lines (id, company_id, invoice_id, line_no, product_id, unit_factor, qty, unit_cost, net_amount) values ('${randomUUID()}', '${COMPANY}', '${purchase}', 1, '${bought}', 1000, 2000, 750, 1500)`,
    );
    const f = newCashierFixture();
    await loginAs(page, f, 'cashier');
    await page.getByTestId('open-shift').click();
    await page.keyboard.type('100');
    await page.keyboard.press('Enter');
    const search = page.getByTestId('sell-search');
    await expect(search).toBeVisible();
    const add = async (name: string, id: string): Promise<void> => {
      await search.fill(name);
      await expect(page.getByTestId(`tile-${id}`).first()).toBeVisible({ timeout: 30_000 });
      await page.locator(`[data-testid="tile-${id}"] button`).first().click();
    };

    // line 0: the fresh product (no stock, never bought)
    await add(`Freshcf${t}`, fresh);
    await expect(vis(page, 'stock-left-0')).toHaveText(`${strings.sell.stockLeft}: ${formatQty(-1000)}`);
    await expect(vis(page, 'stock-left-0')).toHaveClass(/factsWarn/);
    await expect(vis(page, 'last-cost-0')).toHaveText(`${strings.sell.lastCost}: ${formatMoney(1234)}`);

    // line 1: the bought product, its last purchase price; the stock left drops with each added piece
    await add(`Boughtcf${t}`, bought);
    await expect(vis(page, 'last-cost-1')).toHaveText(`${strings.sell.lastCost}: ${formatMoney(750)}`);
    await expect(vis(page, 'stock-left-1')).toHaveText(`${strings.sell.stockLeft}: ${formatQty(4000)}`);
    await expect(vis(page, 'stock-left-1')).not.toHaveClass(/factsWarn/);
    await add(`Boughtcf${t}`, bought);
    await expect(vis(page, 'stock-left-1')).toHaveText(`${strings.sell.stockLeft}: ${formatQty(3000)}`);
  });
});
