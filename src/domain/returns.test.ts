import { describe, expect, it } from 'vitest';

import { computeReturnLine, returnableQty } from './returns';

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
