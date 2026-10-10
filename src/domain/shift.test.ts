import { describe, expect, it } from 'vitest';

import { countByDenomination, requiresVarianceApproval, shiftVariance } from './shift';

describe('shift', () => {
  it('counts cash by denomination', () => {
    expect(
      countByDenomination([
        { value: 10000, count: 2 },
        { value: 2000, count: 3 },
        { value: 25, count: 4 },
      ]),
    ).toBe(26100);
  });
  it('variance = counted - expected', () => {
    expect(shiftVariance({ countedCash: 50000, openingFloat: 10000, cashIn: 40000, cashOut: 2000 })).toEqual({
      expected: 48000,
      variance: 2000,
    });
  });
  it('negative variance for a shortage', () => {
    expect(
      shiftVariance({ countedCash: 47000, openingFloat: 10000, cashIn: 40000, cashOut: 2000 }).variance,
    ).toBe(-1000);
  });
  it('a difference above the limit needs approval, at the limit it does not', () => {
    expect(requiresVarianceApproval(2000, 2000)).toBe(false);
    expect(requiresVarianceApproval(-2001, 2000)).toBe(true);
    expect(requiresVarianceApproval(0, 0)).toBe(false);
  });
});
