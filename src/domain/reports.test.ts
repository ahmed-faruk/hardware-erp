import { describe, expect, it } from 'vitest';

import { devicesTable, profitTable, salesTables, stockTable } from './reports';

const t = new Proxy({}, { get: (_, k) => String(k) }) as Record<string, string>;

describe('report tables', () => {
  it('sales: a row per day, totals, and the method / cashier splits', () => {
    const tables = salesTables(
      {
        days: [{ day: '2026-10-01', invoices: 2, gross: 15000, returns: 0, net: 15000 }],
        total: { invoices: 2, gross: 15000, returns: 0, net: 15000 },
        by_method: [{ method: 'cash', amount: 10000 }],
        by_worker: [{ worker: 'عبدالله', invoices: 2, gross: 15000 }],
        legacy_invoices: 1,
      },
      t,
      (k) => k.toUpperCase(),
    );
    expect(tables[0]!.rows[0]).toEqual(['2026-10-01', '2', '150.00', '0.00', '150.00']);
    expect(tables[0]!.totals).toEqual(['total', '2', '150.00', '0.00', '150.00']);
    expect(tables[0]!.note).toBe('legacy: 1');
    expect(tables[1]!.rows).toEqual([['CASH', '100.00']]);
    expect(tables[2]!.rows[0]![0]).toBe('عبدالله');
  });
  it('profit carries its explanation', () => {
    const r = profitTable({ days: [], total: { revenue: 14000, cost: 3400, profit: 10600 } }, t);
    expect(r.totals).toEqual(['total', '140.00', '34.00', '106.00']);
    expect(r.note).toBe('profitNote');
  });
  it('stock: value = qty x cost, marks rows under the reorder level', () => {
    const r = stockTable(
      [
        { name: 'A', sku: null, qtyMilli: 2500, unitCost: 400, reorderLevel: 5000 },
        { name: 'B', sku: null, qtyMilli: 10000, unitCost: 100, reorderLevel: 0 },
      ],
      t,
    );
    expect(r.rows[0]).toEqual(['A', '2.5', '4.00', '10.00', 'low']);
    expect(r.rows[1]![4]).toBe('');
    expect(r.totals![3]).toBe('20.00');
  });
  it('devices: never seen and revoked read clearly', () => {
    const r = devicesTable(
      [
        {
          name: 'K1',
          prefix: 'K1',
          last_seen_at: null,
          app_version: null,
          revoked: true,
          open_shift: false,
          errors_24h: 0,
        },
      ],
      t,
      (x) => x,
    );
    expect(r.rows[0]).toEqual(['K1 (K1) — revoked', 'never', '', '', '0']);
  });
});

describe('exceptions report extras', () => {
  it('lists the audit counters and the setting changes', async () => {
    const { exceptionsTables } = await import('./reports');
    const tables = exceptionsTables(
      {
        voids: [],
        reprints: 0,
        no_sales: [],
        discounts: { lines: 0, amount: 0 },
        stock_adjustments: [],
        shift_variances: [],
        negative_stock: 2,
        price_overrides: 3,
        discount_overrides: 1,
        pin_failures: 4,
        cart_removals: 5,
        settings_changes: [{ key: 'sale.cashierMayDiscount', at: '2026-10-10T09:00:00Z', worker: 'م' }],
        clock_warnings: [],
      },
      t,
      (x) => x,
      (x) => x,
    );
    const summary = Object.fromEntries(tables[0]!.rows.map((r) => [r[0], r[1]]));
    expect(summary).toMatchObject({
      negativeStock: '2',
      priceOverrides: '3',
      discountOverrides: '1',
      pinFailures: '4',
      cartRemovals: '5',
    });
    expect(tables.find((x) => x.title === 'settingsChanges')?.rows[0]![0]).toBe('sale.cashierMayDiscount');
  });
});
