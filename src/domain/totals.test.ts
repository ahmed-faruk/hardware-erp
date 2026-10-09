import { describe, expect, it } from 'vitest';

import { computeInvoice, type LineInput } from './totals';

const line = (qtyMilli: number, unitPrice: number, extra: Partial<LineInput> = {}): LineInput => ({
  qtyMilli,
  unitPrice,
  ...extra,
});

describe('computeInvoice', () => {
  it('computes a simple total', () => {
    const r = computeInvoice([line(2000, 1050), line(500, 3000)], null);
    expect(r.lines.map((l) => l.netAmount)).toEqual([2100, 1500]);
    expect(r.total).toBe(3600);
  });
  it('rounds the line half-up (qty 0.333 x 10.00 = 3.33)', () => {
    expect(computeInvoice([line(333, 1000)], null).total).toBe(333);
  });
  it('applies line percent and fixed discounts', () => {
    const r = computeInvoice(
      [
        line(1000, 1000, { discount: { kind: 'percentBp', valueBp: 1000 } }),
        line(1000, 1000, { discount: { kind: 'fixed', value: 150 } }),
      ],
      null,
    );
    expect(r.lines.map((l) => l.discount)).toEqual([100, 150]);
    expect(r.total).toBe(1750);
  });
  it('supports fractional percents in basis points (12.5%)', () => {
    const r = computeInvoice([line(1000, 1000, { discount: { kind: 'percentBp', valueBp: 1250 } })], null);
    expect(r.lines[0]?.discount).toBe(125);
  });
  it('rejects a line discount above gross', () => {
    expect(() =>
      computeInvoice([line(1000, 1000, { discount: { kind: 'fixed', value: 1001 } })], null),
    ).toThrow();
  });
  it('allocates the invoice discount exactly (largest remainder)', () => {
    const r = computeInvoice([line(1000, 1000), line(1000, 1000), line(1000, 1000)], {
      kind: 'fixed',
      value: 100,
    });
    const alloc = r.lines.map((l) => l.allocatedInvoiceDiscount);
    expect(alloc.reduce((a, b) => a + b, 0)).toBe(100);
    expect(alloc).toEqual([34, 33, 33]);
    expect(r.total).toBe(2900);
  });
  it('supports an invoice percent discount', () => {
    const r = computeInvoice([line(1000, 2000), line(1000, 1000)], { kind: 'percentBp', valueBp: 1000 });
    expect(r.invoiceDiscount).toBe(300);
    expect(r.total).toBe(2700);
  });
  it('rejects an invoice discount above the net sum', () => {
    expect(() => computeInvoice([line(1000, 1000)], { kind: 'fixed', value: 1001 })).toThrow();
  });
  it('invariant: allocations always sum to the invoice discount', () => {
    for (let d = 0; d <= 777; d += 37) {
      const r = computeInvoice([line(333, 1234), line(1500, 999), line(7, 5555)], {
        kind: 'fixed',
        value: d,
      });
      expect(r.lines.reduce((a, l) => a + l.allocatedInvoiceDiscount, 0)).toBe(d);
      expect(r.lines.reduce((a, l) => a + l.finalAmount, 0)).toBe(r.total);
    }
  });
  it('stores tax as zero', () => {
    expect(computeInvoice([line(1000, 100)], null).taxAmount).toBe(0);
  });
});
