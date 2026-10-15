import { describe, expect, it } from 'vitest';

import { defaultReturnValue } from './purchase-return';

describe('default value of a purchase return without invoice (P4)', () => {
  it('uses the last price from that supplier', () => {
    // last invoice: 10 pcs for 50.00 -> 5.00 each
    expect(defaultReturnValue({ net: 5000, baseQtyMilli: 10000 }, 999, 3000)).toBe(1500);
  });
  it('a pack line is priced per base unit: 2 cartons of 12 for 240.00 -> 10.00 a piece', () => {
    expect(defaultReturnValue({ net: 24000, baseQtyMilli: 24000 }, 999, 1000)).toBe(1000);
  });
  it('rounds half up to the piaster', () => {
    expect(defaultReturnValue({ net: 100, baseQtyMilli: 3000 }, 0, 1500)).toBe(50);
    expect(defaultReturnValue({ net: 1, baseQtyMilli: 3000 }, 0, 1500)).toBe(1); // 0.5 -> 1
  });
  it('with no earlier purchase it falls back to the current cost', () => {
    expect(defaultReturnValue(null, 700, 2000)).toBe(1400);
    expect(defaultReturnValue({ net: 5000, baseQtyMilli: 0 }, 700, 1000)).toBe(700);
  });
  it('a fractional quantity works (kilos)', () => {
    expect(defaultReturnValue({ net: 8000, baseQtyMilli: 4000 }, 0, 500)).toBe(1000);
  });
});
