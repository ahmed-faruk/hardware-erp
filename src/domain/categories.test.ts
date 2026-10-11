import { describe, expect, it } from 'vitest';

import { categoryKpis, categoryTables, marginBp, stackDaily, type CatRow } from './categories';
import { niceScale } from './chart';

const row = (p: Partial<CatRow>): CatRow => ({
  id: 'x',
  name: 'x',
  color: 'cat-1',
  qty: 0,
  revenue: 0,
  cost: 0,
  profit: 0,
  invoices: 0,
  items: 0,
  stock_value: 0,
  ...p,
});

describe('niceScale', () => {
  it('rounds the top up to a 1, 2 or 5 step so the axis reads cleanly', () => {
    expect(niceScale(0)).toEqual({ top: 4, step: 1, ticks: [0, 1, 2, 3, 4] });
    expect(niceScale(870)).toEqual({ top: 1000, step: 250, ticks: [0, 250, 500, 750, 1000] });
    expect(niceScale(9990).top).toBe(10000);
    expect(niceScale(10)).toEqual({ top: 10, step: 2.5, ticks: [0, 2.5, 5, 7.5, 10] });
  });
});

describe('marginBp', () => {
  it('is profit over revenue in basis points, 0 without revenue', () => {
    expect(marginBp(2500, 10000)).toBe(2500);
    expect(marginBp(1, 3)).toBe(3333);
    expect(marginBp(5, 0)).toBe(0);
  });
});

describe('categoryKpis', () => {
  const rows = [
    row({ id: 'a', name: 'دهانات', revenue: 20000, profit: 6000, items: 5, stock_value: 30000 }),
    row({ id: 'b', name: 'سباكة', revenue: 6000, profit: 3000, items: 2, stock_value: 9000 }),
    row({ id: 'c', name: 'ساكنة', revenue: 0, items: 1, stock_value: 70000 }),
  ];
  it('finds the best seller, the best margin, the active count and the biggest stock', () => {
    const k = categoryKpis(rows);
    expect(k.topSales?.name).toBe('دهانات');
    expect(k.topMargin?.name).toBe('سباكة'); // 50% against 30%
    expect(k.active).toBe(2);
    expect(k.biggestStock?.name).toBe('ساكنة');
  });
  it('has nothing to say about an empty list', () => {
    expect(categoryKpis([])).toEqual({ topSales: null, topMargin: null, active: 0, biggestStock: null });
  });
});

describe('categoryTables', () => {
  it('lists each category with margin and share and a totals row', () => {
    const t = {} as Record<string, string>;
    const labels = new Proxy(t, { get: (_, k) => String(k) });
    const r = categoryTables(
      {
        total: { revenue: 26000, cost: 15000, qty: 5000, stock_value: 39000 },
        categories: [
          row({
            id: 'a',
            name: 'دهانات',
            qty: 2000,
            revenue: 20000,
            cost: 12000,
            profit: 8000,
            invoices: 2,
            items: 5,
            stock_value: 30000,
          }),
        ],
        days: [],
      },
      labels,
    );
    expect(r[0]!.rows[0]).toEqual(['دهانات', '2', '200.00', '120.00', '80.00', '40%', '77%', '2', '300.00']);
    expect(r[0]!.totals![2]).toBe('260.00');
  });
});

describe('stackDaily', () => {
  const rows = [
    row({ id: 'a', name: 'A', revenue: 500 }),
    row({ id: 'b', name: 'B', revenue: 300 }),
    row({ id: 'c', name: 'C', revenue: 100 }),
  ];
  const days = [
    { day: '2026-11-03', category: 'a', revenue: 300 },
    { day: '2026-11-03', category: 'c', revenue: 50 },
    { day: '2026-11-04', category: 'b', revenue: 300 },
    { day: '2026-11-04', category: 'a', revenue: 200 },
  ];
  it('keeps the top categories as their own segments and folds the rest into "other"', () => {
    const s = stackDaily(days, rows, 2);
    expect(s.keys.map((k) => k.id)).toEqual(['a', 'b', 'other']);
    expect(s.days).toEqual([
      { day: '2026-11-03', values: [300, 0, 50], total: 350 },
      { day: '2026-11-04', values: [200, 300, 0], total: 500 },
    ]);
  });
  it('shows every category when there are few of them, with no "other"', () => {
    const s = stackDaily(days, rows, 6);
    expect(s.keys.map((k) => k.id)).toEqual(['a', 'b', 'c']);
  });
});
