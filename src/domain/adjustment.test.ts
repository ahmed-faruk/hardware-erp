import { describe, expect, it } from 'vitest';

import { adjustmentNeedsApproval, adjustmentValue, reasonFitsDelta } from './adjustment';

describe('stock adjustment', () => {
  it('value = |delta| x cost per base unit', () => {
    expect(
      adjustmentValue([
        { qtyDelta: -2500, unitCost: 600 },
        { qtyDelta: 1000, unitCost: 100 },
      ]),
    ).toBe(1600);
  });
  it('a storekeeper needs the manager above the limit, a manager never', () => {
    expect(adjustmentNeedsApproval(50000, 'storekeeper', 50000)).toBe(false);
    expect(adjustmentNeedsApproval(50000, 'storekeeper', 50001)).toBe(true);
    expect(adjustmentNeedsApproval(50000, 'manager', 9_999_999)).toBe(false);
  });
  it('reasons fit the direction', () => {
    expect(reasonFitsDelta('lost', -1)).toBe(true);
    expect(reasonFitsDelta('lost', 1)).toBe(false);
    expect(reasonFitsDelta('found', -1)).toBe(false);
    expect(reasonFitsDelta('count', -1)).toBe(true);
    expect(reasonFitsDelta('count', 1)).toBe(true);
  });
});
