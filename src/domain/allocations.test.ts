import { describe, expect, it } from 'vitest';

import { allocateInOrder, openAmount } from './allocations';
import { buildStatement } from './statement';

describe('openAmount', () => {
  it('credit part minus what was already settled, never below zero', () => {
    expect(openAmount(2000, 1500)).toBe(500);
    expect(openAmount(2000, 2500)).toBe(0);
  });
});

describe('allocateInOrder', () => {
  const open = [
    { invoiceId: 'a', open: 500 },
    { invoiceId: 'b', open: 700 },
    { invoiceId: 'c', open: 900 },
  ];
  it('gives each checked invoice min(what is left of the amount, what is open), in the order checked', () => {
    expect(allocateInOrder(1000, ['b', 'a'], open)).toEqual([
      { invoice_id: 'b', amount: 700 },
      { invoice_id: 'a', amount: 300 },
    ]);
  });
  it('stops when the amount is used up and ignores unknown invoices', () => {
    expect(allocateInOrder(100, ['x', 'c', 'a'], open)).toEqual([{ invoice_id: 'c', amount: 100 }]);
  });
});

describe('aging with explicit allocations', () => {
  const row = (id: string, at: string, amount: number, extra = {}) => ({
    id,
    docNumber: id,
    occurredAt: at,
    amount,
    ...extra,
  });
  const now = '2026-10-10T09:00:00Z';
  it('a payment aimed at the NEWER invoice leaves the older one open (FIFO would have cleared the older)', () => {
    const rows = [
      row('old', '2026-06-01T09:00:00Z', 5000, { docId: 'inv-old' }),
      row('new', '2026-10-01T09:00:00Z', 3000, { docId: 'inv-new' }),
      row('pay', '2026-10-02T09:00:00Z', -3000, {
        docId: 'rcv',
        allocations: [{ docId: 'inv-new', amount: 3000 }],
      }),
    ];
    const s = buildStatement(rows, { from: '2026-01-01', to: '2026-10-10' }, now);
    expect(s.aging).toEqual({ d0to30: 0, d31to60: 0, d61to90: 0, d90plus: 5000 });
  });
  it('the part of a payment that is not allocated still settles the oldest debt first', () => {
    const rows = [
      row('old', '2026-06-01T09:00:00Z', 5000, { docId: 'inv-old' }),
      row('new', '2026-10-01T09:00:00Z', 3000, { docId: 'inv-new' }),
      row('pay', '2026-10-02T09:00:00Z', -4000, {
        docId: 'rcv',
        allocations: [{ docId: 'inv-new', amount: 3000 }],
      }),
    ];
    const s = buildStatement(rows, { from: '2026-01-01', to: '2026-10-10' }, now);
    expect(s.aging.d90plus).toBe(4000);
    expect(Object.values(s.aging).reduce((a, b) => a + b, 0)).toBe(s.closing);
  });
});
