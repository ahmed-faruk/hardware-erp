import { describe, expect, it } from 'vitest';

import { computePurchase, costPerBase } from './purchase';

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
