import { describe, expect, it } from 'vitest';

import { NO_USAGE, mergeUsage, usageFromServer, usageReasons } from './product-usage';

describe('product usage (C2..C6)', () => {
  it('an untouched product has no reason to stay', () => {
    expect(usageReasons(NO_USAGE)).toEqual([]);
  });

  it.each([
    [{ sales: 1 }, ['sales']],
    [{ purchases: 2 }, ['purchases']],
    [{ salesReturns: 1 }, ['returns']],
    [{ purchaseReturns: 1 }, ['returns']],
    [{ movements: 1 }, ['movements']],
    [{ adjustments: 1 }, ['movements']],
    [{ legacySales: 1 }, ['legacy']],
    [{ legacyPurchases: 1 }, ['legacy']],
    [{ stockMilli: -500 }, ['stock']],
    [{ stockMilli: 3000 }, ['stock']],
  ])('%j blocks the delete as %j', (patch, reasons) => {
    expect(usageReasons({ ...NO_USAGE, ...patch })).toEqual(reasons);
  });

  it('lists every reason, in a fixed order', () => {
    expect(
      usageReasons({ ...NO_USAGE, sales: 2, purchases: 1, movements: 3, legacySales: 4, stockMilli: 1000 }),
    ).toEqual(['sales', 'purchases', 'movements', 'legacy', 'stock']);
  });

  it('reads the server answer', () => {
    expect(usageFromServer({ sales: 2, legacy_sales: 5, stock_milli: '-1000' })).toMatchObject({
      sales: 2,
      legacySales: 5,
      stockMilli: -1000,
      purchases: 0,
    });
  });

  it('merging keeps the larger count of each side', () => {
    const merged = mergeUsage({ ...NO_USAGE, sales: 1 }, { ...NO_USAGE, legacySales: 7, stockMilli: 2000 });
    expect(merged).toMatchObject({ sales: 1, legacySales: 7, stockMilli: 2000 });
  });
});
