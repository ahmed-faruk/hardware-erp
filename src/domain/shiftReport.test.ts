import { describe, expect, it } from 'vitest';

import { buildShiftReport } from './shiftReport';

describe('shift report (X / Z)', () => {
  const base = {
    openingFloat: 10000,
    salesPayments: [
      { method: 'cash', amount: 5000 },
      { method: 'cash', amount: 2500 },
      { method: 'card', amount: 3000 },
      { method: 'credit', amount: 4000 },
    ],
    cashMovements: [
      { docType: 'sales_invoice', amount: 7500 },
      { docType: 'sales_return', amount: -1000 },
      { docType: 'customer_receipt', amount: 2000 },
      { docType: 'expense', amount: -500 },
      { docType: 'cash_transfer', amount: -3000 },
    ],
    returnsTotal: 1500,
    returnsCount: 1,
    voidsCount: 0,
    noSaleCount: 2,
    collections: [
      { method: 'cash', amount: 2000 },
      { method: 'instapay', amount: 800 },
    ],
  };

  it('X: expected cash is float + every drawer movement; no count yet', () => {
    const r = buildShiftReport({ ...base, counted: null });
    expect(r.salesByMethod).toEqual({ cash: 7500, card: 3000, credit: 4000 });
    expect(r.salesTotal).toBe(14500);
    expect(r.expenses).toBe(500);
    expect(r.transfersOut).toBe(3000);
    expect(r.expected).toBe(10000 + 7500 - 1000 + 2000 - 500 - 3000);
    expect(r.counted).toBeNull();
    expect(r.variance).toBeNull();
    expect(r.noSaleCount).toBe(2);
  });

  it('Z: variance is counted − expected, both signs', () => {
    expect(buildShiftReport({ ...base, counted: 15000 }).variance).toBe(0);
    expect(buildShiftReport({ ...base, counted: 14800 }).variance).toBe(-200);
    expect(buildShiftReport({ ...base, counted: 15100 }).variance).toBe(100);
  });

  it('collections are grouped by method', () => {
    expect(buildShiftReport({ ...base, counted: null }).collectionsByMethod).toEqual({
      cash: 2000,
      instapay: 800,
    });
  });
});
