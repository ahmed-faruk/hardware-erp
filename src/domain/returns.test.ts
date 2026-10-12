import { describe, expect, it } from 'vitest';

import { allocateRefund, checkFreeReturn, computeReturnLine, returnableOf, returnableQty } from './returns';

const sold = { id: 'l1', qtyMilli: 3000, finalAmount: 2999, unitCost: 80 };

describe('returns', () => {
  it('returnable = sold - already returned', () => {
    expect(
      returnableQty(sold, [
        { originalLineId: 'l1', qtyMilli: 1000 },
        { originalLineId: 'x', qtyMilli: 500 },
      ]),
    ).toBe(2000);
  });
  it('rejects returning above the returnable quantity (RET-01)', () => {
    const r = computeReturnLine(sold, [{ originalLineId: 'l1', qtyMilli: 2500 }], 1000);
    expect(r).toMatchObject({ ok: false, code: 'RETURN_EXCEEDS_SOLD' });
  });
  it('refunds proportionally including the discount share', () => {
    const r = computeReturnLine(sold, [], 1000);
    expect(r).toMatchObject({ ok: true, refund: 1000, unitCost: 80 });
  });
  it('refunding everything gives back exactly the line amount', () => {
    const first = computeReturnLine(sold, [], 1000);
    const second = computeReturnLine(sold, [{ originalLineId: 'l1', qtyMilli: 1000 }], 2000);
    expect(first.ok && second.ok && first.refund + second.refund).toBe(2999);
  });
  it('rejects zero quantity', () => {
    expect(computeReturnLine(sold, [], 0)).toMatchObject({ ok: false, code: 'INVALID_QTY' });
  });
});

describe('allocateRefund', () => {
  const mix = [
    { method: 'cash', amount: 5000 },
    { method: 'credit', amount: 2000 },
  ];
  it('splits a refund by the original mix and adds up exactly', () => {
    expect(allocateRefund(mix, 1000)).toEqual({ ok: true, credit: 286, cash: 714 });
    expect(allocateRefund(mix, 7000)).toEqual({ ok: true, credit: 2000, cash: 5000 });
  });
  it('a cash-only invoice refunds cash only; more than paid is refused', () => {
    expect(allocateRefund([{ method: 'card', amount: 900 }], 300)).toEqual({
      ok: true,
      credit: 0,
      cash: 300,
    });
    expect(allocateRefund(mix, 7001)).toMatchObject({ ok: false });
  });
});

describe('return without invoice, many items (D1, D3, D4)', () => {
  const totals = new Map([
    ['p1', { sold: 3000, returned: 1000 }],
    ['p2', { sold: 2000, returned: 0 }],
    ['p4', { sold: 0, returned: 0 }],
  ]);
  it('returnable is sold minus returned, never below zero, zero for an unknown product', () => {
    expect(returnableOf(totals.get('p1'))).toBe(2000);
    expect(returnableOf({ sold: 1000, returned: 1500 })).toBe(0);
    expect(returnableOf(undefined)).toBe(0);
  });
  it('accepts several products within their limits, up to the exact limit', () => {
    expect(
      checkFreeReturn(
        [
          { productId: 'p1', qtyMilli: 2000 },
          { productId: 'p2', qtyMilli: 1 },
        ],
        totals,
      ),
    ).toEqual({ ok: true });
  });
  it('a product never sold, or not in the totals, is NOT_SOLD (and says which)', () => {
    expect(checkFreeReturn([{ productId: 'p4', qtyMilli: 1 }], totals)).toMatchObject({
      ok: false,
      code: 'NOT_SOLD',
      productId: 'p4',
    });
    expect(checkFreeReturn([{ productId: 'zz', qtyMilli: 1 }], totals)).toMatchObject({ code: 'NOT_SOLD' });
  });
  it('lines of the same product add up before the limit is checked', () => {
    expect(
      checkFreeReturn(
        [
          { productId: 'p1', qtyMilli: 1500 },
          { productId: 'p1', qtyMilli: 1000 },
        ],
        totals,
      ),
    ).toMatchObject({ ok: false, code: 'OVER_SOLD', productId: 'p1' });
  });
});
