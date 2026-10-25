import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { invoiceProfits } from '@/db/invoice-profit';

import { newDevice } from './helpers';

describe('profit per sales invoice', () => {
  it('adds the lines, takes posted returns back, ignores voided returns, and is 0 without lines', async () => {
    const ctx = newDevice('K1', 'manager');
    await ctx.db.salesInvoiceLines.bulkPut([
      {
        id: 'a1',
        invoiceId: 'A',
        qty: 2000,
        unitFactor: 1000,
        netAmount: 3000,
        allocDiscount: 0,
        unitCost: 1000,
      },
      {
        id: 'a2',
        invoiceId: 'A',
        qty: 1000,
        unitFactor: 12000,
        netAmount: 20000,
        allocDiscount: 1000,
        unitCost: 1000,
      },
      {
        id: 'b1',
        invoiceId: 'B',
        qty: 2000,
        unitFactor: 1000,
        netAmount: 3000,
        allocDiscount: 0,
        unitCost: 1000,
      },
    ] as never);
    await ctx.db.salesReturns.bulkPut([
      { id: 'R1', originalInvoiceId: 'B', status: 'posted' },
      { id: 'R2', originalInvoiceId: 'B', status: 'voided' },
    ] as never);
    await ctx.db.salesReturnLines.bulkPut([
      { id: 'r1', returnId: 'R1', originalLineId: 'b1', qty: 1000, netAmount: 1500, unitCost: 1000 },
      { id: 'r2', returnId: 'R2', originalLineId: 'b1', qty: 1000, netAmount: 1500, unitCost: 1000 },
    ] as never);
    const p = await invoiceProfits(ctx.db, ['A', 'B', 'C']);
    expect(p.get('A')).toBe(8000);
    expect(p.get('B')).toBe(500);
    expect(p.get('C')).toBe(0);
    expect((await invoiceProfits(ctx.db, [])).size).toBe(0);
  });
});
