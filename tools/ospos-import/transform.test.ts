import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { legacyId } from './parse.ts';
import { transform } from './transform.ts';
import type { OsposExport, Row } from './types.ts';

const data = JSON.parse(readFileSync('tests/fixtures/ospos-sample-export.json', 'utf8')) as OsposExport;
const r = transform(data);
const t = r.tables;
const byId = (rows: Row[], id: string): Row => {
  const row = rows.find((x) => x.id === id);
  if (!row) throw new Error(`row ${id} not found`);
  return row;
};
const warning = (code: string): number => r.warnings.find((w) => w.code === code)?.count ?? 0;

describe('structure and master data', () => {
  it('creates one company, branch, main and scrap warehouse', () => {
    expect(t.companies).toHaveLength(1);
    expect(t.warehouses.map((w) => w.kind)).toEqual(['main', 'scrap']);
  });
  it('ids are stable across runs (UUID v5)', () => {
    expect(transform(data).tables.products.map((p) => p.id)).toEqual(t.products.map((p) => p.id));
    expect(t.products.map((p) => p.id)).toContain(legacyId('item', 1));
  });
  it('products keep price, cost, reorder level and a quantity precision that fits the stock', () => {
    const paint = byId(t.products, legacyId('item', 1));
    expect(paint).toMatchObject({
      price: 10000,
      unit_cost: 6000,
      reorder_level: 2000,
      sku: '111',
      qty_decimals: 0,
    });
    expect(byId(t.products, legacyId('item', 2)).qty_decimals).toBe(3); // fractional stock and fractional sales
  });
  it('only products with a barcode get a barcode row', () => {
    expect(t.barcodes.map((b) => b.code).sort()).toEqual(['111', '333']);
    expect(warning('ITEM_NO_BARCODE')).toBe(1);
  });
  it('customers: name, digits-only phone, address, discount in basis points', () => {
    const c = byId(t.customers, legacyId('customer', 20));
    expect(c).toMatchObject({
      name: 'عميل تجريبي',
      phone: '01000000000',
      address: 'شارع 1، القاهرة',
      notes: 'ملاحظة',
      credit_limit: 0,
    });
    expect(byId(t.customers, legacyId('customer', 21)).default_discount_bp).toBe(500);
  });
  it('suppliers: company name first, expense supplier flag, plus an archive placeholder', () => {
    expect(byId(t.suppliers, legacyId('supplier', 30)).name).toBe('شركة الألوان');
    expect(byId(t.suppliers, legacyId('supplier', 31)).is_expense_supplier).toBe(true);
    expect(t.suppliers.some((s) => s.id === legacyId('supplier', 'unknown'))).toBe(true);
  });
  it('workers are inactive, cashier role, no PIN', () => {
    expect(t.workers[0]).toMatchObject({ active: false, role: 'cashier', pin_hash: null });
  });
});

describe('stock opening (the only ledger rows)', () => {
  it('one opening movement per product with a non-zero quantity, equal to the inventory summary', () => {
    expect(t.stock_movements).toHaveLength(2);
    expect(r.stats.stockByProduct[legacyId('item', 1)]).toBe(10000);
    expect(r.stats.stockByProduct[legacyId('item', 2)]).toBe(-2500);
    expect(t.stock_movements.every((m) => m.doc_type === 'opening')).toBe(true);
  });
  it('legacy history writes no party or cash ledger rows', () => {
    expect(t.party_ledger).toHaveLength(0);
  });
});

describe('sales', () => {
  it('imports invoices and returns, skips unknown types', () => {
    expect(t.sales_invoices).toHaveLength(6);
    expect(t.sales_returns).toHaveLength(1);
    expect(warning('UNKNOWN_SALE_TYPE')).toBe(1);
  });
  it('every history row is flagged legacy and numbered LG-…', () => {
    for (const rows of [
      t.sales_invoices,
      t.sales_returns,
      t.sales_invoice_lines,
      t.sales_return_lines,
      t.payments,
      t.purchase_invoices,
      t.expenses,
    ]) {
      expect(rows.every((x) => x.is_legacy === true)).toBe(true);
    }
    expect(byId(t.sales_invoices, legacyId('sale', 1)).number).toBe('LG-INV-000001');
    expect(byId(t.sales_returns, legacyId('return', 3)).number).toBe('LG-RET-000003');
  });
  it('dates become Cairo noon', () => {
    expect(byId(t.sales_invoices, legacyId('sale', 1)).issued_at).toBe('2017-06-29T10:00:00.000Z');
    expect(byId(t.sales_invoices, legacyId('sale', 2)).issued_at).toBe('2026-07-01T09:00:00.000Z');
  });
  it('lines: unit price = subtotal / qty, unit cost per unit, product matched by barcode, unmatched kept as text', () => {
    const lines = t.sales_invoice_lines.filter((l) => l.invoice_id === legacyId('sale', 1));
    expect(lines[0]).toMatchObject({
      product_id: legacyId('item', 1),
      qty: 2000,
      unit_price: 10000,
      unit_cost: 6000,
      net_amount: 20000,
      legacy_text: null,
    });
    expect(lines[1]).toMatchObject({ product_id: null, qty: 1000, legacy_text: 'صنف محذوف | خصم 10%' });
  });
  it('money discounts are kept, name matching ignores spaces and alef/ya variants', () => {
    expect(t.sales_invoice_lines.find((l) => l.invoice_id === legacyId('sale', 2))?.line_discount).toBe(500);
    expect(t.sales_invoice_lines.find((l) => l.invoice_id === legacyId('sale', 4))?.product_id).toBe(
      legacyId('item', 2),
    );
  });
  it('split payment becomes cash + credit that add up to the invoice total', () => {
    const pays = t.payments.filter((p) => p.document_id === legacyId('sale', 2));
    expect(pays.map((p) => [p.method, p.amount])).toEqual([
      ['cash', 4000],
      ['credit', 6000],
    ]);
  });
  it('unlabeled payment is stored as cash and reported; card label maps to card', () => {
    expect(t.payments.find((p) => p.document_id === legacyId('sale', 4))).toMatchObject({
      method: 'cash',
      amount: 1800,
    });
    expect(warning('SALE_EMPTY_PAYMENT')).toBe(1);
    expect(t.payments.find((p) => p.document_id === legacyId('sale', 5))?.method).toBe('card');
  });
  it('return lines have no line_no column (matches docs/DATABASE.md)', () => {
    expect(Object.keys(t.sales_return_lines[0] ?? {})).not.toContain('line_no');
  });
  it('returns are stored with positive amounts', () => {
    expect(byId(t.sales_returns, legacyId('return', 3))).toMatchObject({
      total: 10000,
      refund_method: 'cash',
      customer_id: legacyId('customer', 20),
    });
    expect(t.sales_return_lines[0]).toMatchObject({ qty: 1000, net_amount: 10000, unit_refund: 10000 });
    expect(t.payments.find((p) => p.document_id === legacyId('return', 3))?.amount).toBe(10000);
  });
  it('keeps the customer name as text when no customer matches', () => {
    expect(byId(t.sales_invoices, legacyId('sale', 4)).customer_id).toBeNull();
    expect(
      (byId(t.sales_invoices, legacyId('sale', 4)).legacy as { customer_name: string }).customer_name,
    ).toBe('اسم غير موجود');
    expect(warning('SALE_CUSTOMER_UNMATCHED')).toBe(1);
  });
  it('monthly totals (returns subtract) for the validation report', () => {
    expect(r.stats.salesTotalByMonth['2026-07']).toBe(10000 - 10000 + 1800 + 800 + 7525 + 5000);
    expect(r.stats.unmatchedSaleLines).toBe(1);
  });
});

describe('cash rounding', () => {
  it('stores the difference between paid and total in cash_rounding', () => {
    expect(byId(t.sales_invoices, legacyId('sale', 7))).toMatchObject({ total: 7525, cash_rounding: 5 });
    expect(byId(t.sales_invoices, legacyId('sale', 1)).cash_rounding).toBe(0);
  });
  it('reports a difference bigger than a rounding step', () => {
    expect(byId(t.sales_invoices, legacyId('sale', 8)).cash_rounding).toBe(1000);
    expect(warning('SALE_PAYMENT_MISMATCH')).toBe(1);
  });
});

describe('receivings and expenses', () => {
  it('purchases, returns, requisitions', () => {
    expect(t.purchase_invoices).toHaveLength(3);
    expect(t.purchase_returns).toHaveLength(1);
    expect(r.stats.requisitions).toEqual(['4']);
  });
  it('pack quantities multiply (2 x 12 = 24 units) and cost is per unit', () => {
    const line = t.purchase_invoice_lines.find((l) => l.invoice_id === legacyId('purchase', 2));
    expect(line).toMatchObject({ qty: 24000, unit_cost: 500, net_amount: 12000 });
  });
  it('unknown suppliers use the placeholder, known ones match by name; cash is assumed for an empty label', () => {
    expect(byId(t.purchase_invoices, legacyId('purchase', 1)).supplier_id).toBe(legacyId('supplier', 30));
    expect(byId(t.purchase_invoices, legacyId('purchase', 2)).supplier_id).toBe(
      legacyId('supplier', 'unknown'),
    );
    expect(warning('RECEIVING_SUPPLIER_UNMATCHED')).toBe(2);
    expect(t.payments.find((p) => p.document_id === legacyId('purchase', 2))?.method).toBe('cash');
    expect(t.payments.find((p) => p.document_id === legacyId('purchase', 5))?.method).toBe('other');
    expect(warning('UNKNOWN_PAYMENT_LABEL')).toBe(1);
  });
  it('purchase returns are positive and keep their supplier', () => {
    expect(byId(t.purchase_returns, legacyId('purchase-return', 3))).toMatchObject({
      total: 6000,
      supplier_id: legacyId('supplier', 30),
    });
  });
  it('expenses: zero amount skipped, missing category goes to a catch-all, time of day kept', () => {
    expect(t.expenses).toHaveLength(2);
    expect(warning('EXPENSE_SKIPPED')).toBe(1);
    expect(byId(t.expenses, legacyId('expense', 1)).issued_at).toBe('2021-02-13T00:17:55.000Z');
    expect(byId(t.expenses, legacyId('expense', 3)).category_id).toBe(
      legacyId('expense-category', '__none__'),
    );
    expect(byId(t.expenses, legacyId('expense', 3)).supplier_id).toBe(legacyId('supplier', 30));
  });
});

describe('integrity', () => {
  it('every row of a table has the same keys (required by the bulk insert)', () => {
    for (const [name, rows] of Object.entries(t)) {
      const keys = new Set(rows.map((row) => Object.keys(row).sort().join(',')));
      expect(keys.size, name).toBeLessThanOrEqual(1);
    }
  });
  it('no duplicate ids or document numbers', () => {
    for (const [name, rows] of Object.entries(t))
      expect(new Set(rows.map((x) => x.id)).size, name).toBe(rows.length);
    const numbers = [
      ...t.sales_invoices,
      ...t.sales_returns,
      ...t.purchase_invoices,
      ...t.purchase_returns,
      ...t.expenses,
      ...t.openings,
    ].map((x) => x.number);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
  it('invoice payments minus cash_rounding add up to the invoice total', () => {
    for (const inv of t.sales_invoices) {
      const sum = t.payments
        .filter((p) => p.document_id === inv.id)
        .reduce((a, p) => a + Number(p.amount), 0);
      expect(sum - Number(inv.cash_rounding), String(inv.number)).toBe(inv.total);
    }
  });
});
