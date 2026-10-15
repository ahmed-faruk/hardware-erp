import { describe, expect, it } from 'vitest';

import {
  allocateInvoiceDiscount,
  computePurchase,
  costPerBase,
  priceChangeWarns,
  priceChangePercent,
  splitPurchasePayment,
} from './purchase';

describe('computePurchase', () => {
  it('qty x cost per line, half-up, with line discount', () => {
    const r = computePurchase([
      { qtyMilli: 10000, unitCost: 500, discount: 0 },
      { qtyMilli: 2500, unitCost: 333, discount: 100 },
    ]);
    // 10 x 5.00 = 5000 ; 2.5 x 3.33 = 832.5 -> 833, less 100 = 733
    expect(r.lines.map((l) => l.netAmount)).toEqual([5000, 733]);
    expect(r).toMatchObject({ subtotal: 5833, discount: 100, total: 5733 });
  });
  it('rejects a discount above the line value and non-positive quantities', () => {
    expect(() => computePurchase([{ qtyMilli: 1000, unitCost: 100, discount: 101 }])).toThrow();
    expect(() => computePurchase([{ qtyMilli: 0, unitCost: 100, discount: 0 }])).toThrow();
  });
});

describe('costPerBase', () => {
  it('a pack of 12 bought for 60.00 costs 5.00 per piece', () => {
    expect(costPerBase(6000, 12000)).toBe(500);
  });
  it('rounds half up', () => {
    expect(costPerBase(1000, 3000)).toBe(333);
    expect(costPerBase(1001, 2000)).toBe(501); // 500.5
  });
});

describe('splitPurchasePayment', () => {
  it('leaves what neither the safe nor the owner paid on credit', () => {
    expect(splitPurchasePayment(10000, 4000, 3000)).toEqual({ safe: 4000, owner: 3000, credit: 3000 });
    expect(splitPurchasePayment(10000, 10000, 0)).toEqual({ safe: 10000, owner: 0, credit: 0 });
    expect(splitPurchasePayment(10000, 0, 10000)).toEqual({ safe: 0, owner: 10000, credit: 0 });
  });
  it('refuses more than the invoice and negative parts', () => {
    expect(splitPurchasePayment(10000, 6000, 5000)).toBeNull();
    expect(splitPurchasePayment(10000, -1, 0)).toBeNull();
    expect(splitPurchasePayment(10000, 0, -5)).toBeNull();
  });
});

describe('purchase screen helpers (P5b)', () => {
  it('a price change of 20 percent or more is flagged, either way; no last price never warns', () => {
    expect(priceChangePercent(3800, 4800)).toBe(26);
    expect(priceChangeWarns(3800, 4800)).toBe(true);
    expect(priceChangeWarns(5000, 4000)).toBe(true); // −20
    expect(priceChangeWarns(5000, 4100)).toBe(false); // −18
    expect(priceChangeWarns(null, 99999)).toBe(false);
    expect(priceChangeWarns(0, 500)).toBe(false);
  });

  it('an invoice discount is spread over the lines and adds up exactly', () => {
    expect(allocateInvoiceDiscount([5000, 5000], 100)).toEqual([50, 50]);
    expect(allocateInvoiceDiscount([1000, 2000, 3000], 100)).toEqual([17, 33, 50]);
    expect(allocateInvoiceDiscount([1, 1, 1], 2).reduce((a, b) => a + b, 0)).toBe(2);
    expect(allocateInvoiceDiscount([100, 200], 0)).toEqual([0, 0]);
    // never more than a line is worth
    const parts = allocateInvoiceDiscount([1, 999], 400);
    expect(parts.every((p, i) => p <= [1, 999][i]!)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(400);
  });

  it('a discount above the invoice, or a negative one, is refused', () => {
    expect(() => allocateInvoiceDiscount([100], 101)).toThrow(RangeError);
    expect(() => allocateInvoiceDiscount([100], -1)).toThrow(RangeError);
  });
});
