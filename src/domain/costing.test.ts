import { describe, expect, it } from 'vitest';

import { baseQty, movingAverage } from './costing';

describe('baseQty', () => {
  it('converts pack to base units', () => {
    expect(baseQty(2000, 12000)).toEqual({ ok: true, value: 24000 });
  });
  it('rejects a fractional base quantity', () => {
    expect(baseQty(1, 500).ok).toBe(false);
  });
});

describe('movingAverage', () => {
  it('weights old and incoming stock', () => {
    expect(movingAverage({ oldQtyMilli: 10000, oldAvg: 100, inQtyMilli: 10000, inCost: 200 })).toBe(150);
  });
  it('uses incoming cost when old stock is zero or negative', () => {
    expect(movingAverage({ oldQtyMilli: 0, oldAvg: 100, inQtyMilli: 5000, inCost: 200 })).toBe(200);
    expect(movingAverage({ oldQtyMilli: -3000, oldAvg: 100, inQtyMilli: 5000, inCost: 200 })).toBe(200);
  });
  it('rounds half-up to a piaster', () => {
    expect(movingAverage({ oldQtyMilli: 1000, oldAvg: 100, inQtyMilli: 2000, inCost: 101 })).toBe(101);
    expect(movingAverage({ oldQtyMilli: 1000, oldAvg: 100, inQtyMilli: 1000, inCost: 101 })).toBe(101);
  });
});
