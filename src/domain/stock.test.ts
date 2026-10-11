import { describe, expect, it } from 'vitest';

import { negativeAfterSale, tileStockText } from './stock';

describe('negativeAfterSale', () => {
  it('lists only the products that would go below zero', () => {
    const r = negativeAfterSale([
      { productId: 'a', before: 5000, sold: 3000 },
      { productId: 'b', before: 1000, sold: 2000 },
      { productId: 'c', before: 0, sold: 1000 },
    ]);
    expect(r.map((x) => x.productId)).toEqual(['b', 'c']);
  });
  it('selling exactly what is left is fine', () => {
    expect(negativeAfterSale([{ productId: 'a', before: 2000, sold: 2000 }])).toEqual([]);
  });
  it('the same product on two lines is summed', () => {
    const r = negativeAfterSale([
      { productId: 'a', before: 3000, sold: 2000 },
      { productId: 'a', before: 3000, sold: 2000 },
    ]);
    expect(r).toEqual([{ productId: 'a', before: 3000, sold: 4000 }]);
  });
});

describe('tileStockText', () => {
  it('shows whole units without decimals, fractions as they are and the minus sign of negative stock', () => {
    expect(tileStockText(24_000)).toBe('24');
    expect(tileStockText(2_500)).toBe('2.5');
    expect(tileStockText(0)).toBe('0');
    expect(tileStockText(-2_500)).toBe('-2.5');
  });
});
