import { describe, expect, it } from 'vitest';

import {
  customerCadence,
  deadStock,
  hourHeat,
  reorderPlan,
  topSellers,
  type ProductFacts,
  type SaleEvent,
} from './insights';

const base: ProductFacts = {
  id: 'p1',
  name: 'دهان',
  stockMilli: 24_000,
  unitCost: 72_000,
  price: 92_500,
  supplierName: 'النصر',
  sold30Milli: 96_000, // 96 units in 30 days = 3.2 / day
  lastSoldDay: '2026-10-09',
  revenue30: 96 * 92_500,
};

describe('reorderPlan', () => {
  it('suggests what covers lead time + cover days, rounded up to whole units', () => {
    const [r] = reorderPlan([base], 14);
    // need = 3.2/day * (3 lead + 14 cover) = 54.4 units, minus 24 in stock = 30.4 -> 31 units
    expect(r!.suggestMilli).toBe(31_000);
    expect(r!.cost).toBe(31 * 72_000);
  });

  it('computes days left and the reorder point (lead + safety days of sales)', () => {
    const [r] = reorderPlan([base], 14);
    expect(r!.daysLeft).toBe(7); // 24 / 3.2 = 7.5 -> 7
    expect(r!.reorderPointMilli).toBe(19_200); // 3.2 * (3 + 3) = 19.2 units
  });

  it('marks urgency: now when stock ends within the lead time, soon within lead + safety', () => {
    const now = { ...base, id: 'a', stockMilli: 6_000 }; // 1.9 days
    const soon = { ...base, id: 'b', stockMilli: 19_000 }; // 5.9 days
    const fine = { ...base, id: 'c', stockMilli: 60_000 };
    const rows = reorderPlan([now, soon, fine], 14);
    expect(rows.map((r) => [r.productId, r.urgency])).toEqual([
      ['a', 'now'],
      ['b', 'soon'],
    ]);
  });

  it('skips products that were not sold and orders by days left', () => {
    const idle = { ...base, id: 'idle', sold30Milli: 0 };
    const a = { ...base, id: 'a', stockMilli: 3_000 };
    const b = { ...base, id: 'b', stockMilli: 9_000 };
    expect(reorderPlan([idle, b, a], 14).map((r) => r.productId)).toEqual(['a', 'b']);
  });

  it('an out-of-stock product with sales is urgent with 0 days left', () => {
    const [r] = reorderPlan([{ ...base, stockMilli: 0 }], 7);
    expect(r!.daysLeft).toBe(0);
    expect(r!.urgency).toBe('now');
    expect(r!.suggestMilli).toBe(32_000); // 3.2 * 10 = 32
  });
});

describe('deadStock', () => {
  it('lists stocked products not sold for the given days, with the cash tied up', () => {
    const old = { ...base, id: 'old', stockMilli: 10_000, lastSoldDay: '2026-06-01' };
    const never = { ...base, id: 'never', stockMilli: 2_000, lastSoldDay: null };
    const live = { ...base, id: 'live' };
    const empty = { ...base, id: 'empty', stockMilli: 0, lastSoldDay: null };
    const r = deadStock([live, old, never, empty], '2026-10-10', 90);
    expect(r.map((x) => x.productId)).toEqual(['old', 'never']);
    expect(r[0]!.value).toBe(10 * 72_000);
    expect(r[0]!.daysIdle).toBe(131);
    expect(r[1]!.daysIdle).toBeNull();
  });
});

describe('topSellers', () => {
  it('ranks by revenue and keeps the share of the best one for the bar', () => {
    const a = { ...base, id: 'a', revenue30: 1000 };
    const b = { ...base, id: 'b', revenue30: 4000 };
    const r = topSellers([a, b], 2);
    expect(r.map((x) => x.productId)).toEqual(['b', 'a']);
    expect(r[0]!.sharePercent).toBe(100);
    expect(r[1]!.sharePercent).toBe(25);
  });
});

describe('customerCadence', () => {
  const sale = (customerId: string, day: string, total: number): SaleEvent => ({
    customerId,
    day,
    hour: 10,
    weekday: 1,
    total,
  });
  it('finds the usual gap between purchases and flags who is late', () => {
    const events = [
      sale('c1', '2026-08-01', 100_00),
      sale('c1', '2026-08-13', 300_00),
      sale('c1', '2026-08-25', 200_00),
      sale('c1', '2026-09-24', 400_00),
      sale('c2', '2026-10-01', 50_00),
      sale('c2', '2026-10-08', 70_00),
    ];
    const r = customerCadence(events, '2026-10-10');
    const c1 = r.find((x) => x.customerId === 'c1')!;
    expect(c1.everyDays).toBe(12); // median gap of 12, 12, 30
    expect(c1.daysSinceLast).toBe(16);
    expect(c1.status).toBe('late');
    expect(c1.avgOrder).toBe(250_00);
    expect(c1.spend).toBe(1000_00);
    const c2 = r.find((x) => x.customerId === 'c2')!;
    expect(c2.status).toBe('ontime');
  });

  it('needs at least two purchases to talk about a pattern', () => {
    expect(customerCadence([sale('c1', '2026-10-01', 100)], '2026-10-10')).toEqual([]);
  });

  it('ignores sales without a customer', () => {
    const e: SaleEvent = { customerId: null, day: '2026-10-01', hour: 9, weekday: 0, total: 5 };
    expect(customerCadence([e, e], '2026-10-10')).toEqual([]);
  });
});

describe('hourHeat', () => {
  it('counts invoices per weekday and hour (9..21) and scales to the busiest cell', () => {
    const ev = (weekday: number, hour: number): SaleEvent => ({
      customerId: null,
      day: '2026-10-01',
      hour,
      weekday,
      total: 1,
    });
    const h = hourHeat([ev(4, 17), ev(4, 17), ev(4, 17), ev(4, 17), ev(2, 10)]);
    expect(h.cells[4]![17 - 9]).toBe(100);
    expect(h.cells[2]![10 - 9]).toBe(25);
    expect(h.busiest).toEqual({ weekday: 4, hour: 17 });
  });
  it('is empty when nothing was sold', () => {
    expect(hourHeat([]).busiest).toBeNull();
  });
});
