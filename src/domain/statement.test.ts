import { describe, expect, it } from 'vitest';

import { buildStatement } from './statement';

const row = (id: string, at: string, amount: number) => ({ id, occurredAt: at, amount, docNumber: id });

describe('party statement', () => {
  const rows = [
    row('a', '2026-07-01T09:00:00Z', 10000), // old debt
    row('b', '2026-09-20T09:00:00Z', 5000),
    row('c', '2026-10-01T09:00:00Z', -12000), // payment
    row('d', '2026-10-05T09:00:00Z', 3000),
  ];
  const now = '2026-10-10T09:00:00Z';

  it('opening balance, running balance and closing balance for a period', () => {
    const s = buildStatement(rows, { from: '2026-09-15', to: '2026-10-10' }, now);
    expect(s.opening).toBe(10000);
    expect(s.rows.map((r) => r.balance)).toEqual([15000, 3000, 6000]);
    expect(s.closing).toBe(6000);
  });
  it('a payment settles the oldest debt first; the rest is aged by days', () => {
    const s = buildStatement(rows, { from: '2026-01-01', to: '2026-10-10' }, now);
    // 10000 + 5000 - 12000 -> the July debt is cleared first (leaving 3000 of b? no: 15000-12000 = 3000 left from b)
    expect(s.aging).toEqual({ d0to30: 6000, d31to60: 0, d61to90: 0, d90plus: 0 });
    expect(s.closing).toBe(6000);
  });
  it('an unpaid old debt lands in the right bucket and the buckets add up to the closing balance', () => {
    const s = buildStatement(rows.slice(0, 2), { from: '2026-01-01', to: '2026-10-10' }, now);
    expect(s.aging).toEqual({ d0to30: 5000, d31to60: 0, d61to90: 0, d90plus: 10000 });
    const sum = Object.values(s.aging).reduce((a, b) => a + b, 0);
    expect(sum).toBe(s.closing);
  });
  it('a customer in credit (negative balance) has no aging', () => {
    const s = buildStatement(
      [row('x', '2026-10-01T09:00:00Z', -500)],
      { from: '2026-10-01', to: '2026-10-10' },
      now,
    );
    expect(s.closing).toBe(-500);
    expect(Object.values(s.aging).every((v) => v === 0)).toBe(true);
  });
});
