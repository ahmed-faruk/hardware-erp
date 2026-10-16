import { describe, expect, it } from 'vitest';

import { baseQty, movingAverage, reverseMovingAverage } from './costing';

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

describe('reverseMovingAverage', () => {
  it('undoes a purchase: 10 at 5.00 plus 10 at 7.00 averages 6.00, taking the second out gives 5.00 back', () => {
    const avg = movingAverage({ oldQtyMilli: 10_000, oldAvg: 500, inQtyMilli: 10_000, inCost: 700 });
    expect(avg).toBe(600);
    expect(reverseMovingAverage({ qtyMilli: 20_000, avg, outQtyMilli: 10_000, outCost: 700 })).toBe(500);
  });
  it('keeps the average when the whole stock is the purchase', () => {
    expect(reverseMovingAverage({ qtyMilli: 10_000, avg: 700, outQtyMilli: 10_000, outCost: 700 })).toBe(700);
  });
  it('keeps the average when more went out than is on hand', () => {
    expect(reverseMovingAverage({ qtyMilli: 5_000, avg: 700, outQtyMilli: 10_000, outCost: 700 })).toBe(700);
  });
  it('keeps the average when the numerator is not positive', () => {
    expect(reverseMovingAverage({ qtyMilli: 20_000, avg: 100, outQtyMilli: 10_000, outCost: 900 })).toBe(100);
  });
  it('rounds half up', () => {
    // (3000*250 - 1000*100) / 2000 = 325
    expect(reverseMovingAverage({ qtyMilli: 3_000, avg: 250, outQtyMilli: 1_000, outCost: 100 })).toBe(325);
    // (3*5 - 1*0)/2 -> 7.5 -> 8 (milli units keep it integral)
    expect(reverseMovingAverage({ qtyMilli: 3, avg: 5, outQtyMilli: 1, outCost: 0 })).toBe(8);
  });
});
