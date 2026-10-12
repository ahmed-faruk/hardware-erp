import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { compactLegacy } from './compact.ts';
import { transform } from './transform.ts';
import type { OsposExport } from './types.ts';

const data = JSON.parse(readFileSync('tests/fixtures/ospos-sample-export.json', 'utf8')) as OsposExport;
const r = transform(data);
const c = compactLegacy(r.tables);

describe('compact legacy history', () => {
  it('every imported sale and return becomes one row with its OpenSourcePOS id and Cairo day', () => {
    expect(c.legacy_sales).toHaveLength(r.tables.sales_invoices.length + r.tables.sales_returns.length);
    const sale2 = c.legacy_sales.find((s) => s.id === 2)!;
    expect(sale2).toMatchObject({
      kind: 0,
      day: '2026-07-01',
      total: 10000,
      cash: 4000,
      credit: 6000,
      card: 0,
      other: 0,
    });
    expect(c.legacy_sales.find((s) => s.id === 3)).toMatchObject({ kind: 1, total: 10000, cash: 10000 });
  });
  it('customers and the employee are linked by their legacy ids', () => {
    expect(c.legacy_sales.find((s) => s.id === 2)).toMatchObject({ customer_id: 20 });
    expect(c.legacy_sales.find((s) => s.id === 1)).toMatchObject({ customer_id: null, employee_id: 40 });
  });
  it('lines keep the product link, text of unmatched products, quantity, net and cost of the whole line', () => {
    const lines = c.legacy_sale_lines.filter((l) => l.sale_id === 1);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      line_no: 1,
      product_id: 1,
      text: null,
      qty: 2000,
      net: 20000,
      cost: 12000,
    });
    expect(lines[1]).toMatchObject({
      line_no: 2,
      product_id: null,
      text: 'صنف محذوف | خصم 10%',
      qty: 1000,
      net: 800,
      cost: 500,
    });
  });
  it('return lines get a line number per return', () => {
    const l = c.legacy_sale_lines.filter((x) => x.sale_id === 3);
    expect(l).toEqual([
      expect.objectContaining({ line_no: 1, product_id: 1, qty: 1000, net: 10000, cost: 6000 }),
    ]);
  });
  it('line counts match the wide rows (sale lines + return lines)', () => {
    expect(c.legacy_sale_lines).toHaveLength(
      r.tables.sales_invoice_lines.length + r.tables.sales_return_lines.length,
    );
  });
  it('purchases carry the payment split and the supplier; unknown suppliers are null', () => {
    const p1 = c.legacy_purchases.find((p) => p.id === 1)!;
    expect(p1).toMatchObject({ kind: 0, total: 60000, cash: 60000, credit: 0, supplier_id: 30 });
    expect(c.legacy_purchases.find((p) => p.id === 3)).toMatchObject({ kind: 1, total: 6000 });
    expect(c.legacy_purchases.find((p) => p.id === 5)).toMatchObject({ supplier_id: null, other: 2500 });
  });
  it('purchase lines convert packs to base units', () => {
    const l = c.legacy_purchase_lines.find((x) => x.purchase_id === 2)!;
    expect(l).toMatchObject({ qty: 24000, net: 12000 });
  });
});
