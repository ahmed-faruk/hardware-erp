import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { postSale } from '@/db/commands/post-sale';
import { postPurchase } from '@/db/commands/purchasing';
import { postSalesReturn, voidInvoice } from '@/db/commands/returns';
import { loadInvoiceView } from '@/db/invoice-view';
import { uuidv7 } from '@/db/ids';
import type { Supplier } from '@/db/types';

import { newDevice, seedCatalog } from './helpers';

async function setup() {
  const ctx = newDevice('K1', 'manager');
  const s = await seedCatalog(ctx);
  const main = {
    ...newCommon(ctx),
    branchId: null,
    name: 'main',
    kind: 'main' as const,
    legacyLocationId: null,
  };
  const scrap = { ...main, ...newCommon(ctx), name: 'scrap', kind: 'scrap' as const };
  await ctx.db.warehouses.bulkPut([main, scrap]);
  const sale = await postSale(ctx, {
    lines: [
      { productId: s.products[0]!.id, qtyMilli: 3000, unitPrice: 1000 },
      { productId: s.products[1]!.id, qtyMilli: 1000, unitPrice: 2000 },
    ],
    payments: [
      { method: 'cash', amount: 3000 },
      { method: 'card', amount: 2000, reference: '4321' },
    ],
    customerId: null,
    warehouseId: main.id,
    shiftId: s.shiftId,
    cashAccountId: s.cashAccountId,
  } as never);
  if (!sale.ok) throw new Error(sale.code);
  return { ctx, s, main, sale };
}

describe('invoice view data (E1, E2, E3, E5)', () => {
  it('E1: a sale gives its lines, totals and payments exactly as saved', async () => {
    const t = await setup();
    const v = await loadInvoiceView(t.ctx.db, 'sale', t.sale.id);
    expect(v).toMatchObject({ kind: 'sale', status: 'posted', total: 5000, discount: 0 });
    expect(v?.lines.map((l) => [l.qtyMilli, l.unitPrice, l.total])).toEqual([
      [3000, 1000, 3000],
      [1000, 2000, 2000],
    ]);
    expect(v?.payments.map((p) => [p.method, p.amount, p.reference])).toEqual(
      expect.arrayContaining([
        ['cash', 3000, null],
        ['card', 2000, '4321'],
      ]),
    );
    expect(v?.returns).toEqual([]);
  });

  it('E5: a sale view never carries cost or profit', async () => {
    const t = await setup();
    const v = await loadInvoiceView(t.ctx.db, 'sale', t.sale.id);
    expect(JSON.stringify(v)).not.toMatch(/unitCost|cost|profit/i);
  });

  it('E2: a return shows on the sale with the returned quantity; a void shows as voided', async () => {
    const t = await setup();
    const line = (await t.ctx.db.salesInvoiceLines.where('invoiceId').equals(t.sale.id).sortBy('lineNo'))[0]!;
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: t.sale.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000, condition: 'good' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(r.ok).toBe(true);
    const v = await loadInvoiceView(t.ctx.db, 'sale', t.sale.id);
    expect(v?.returns).toHaveLength(1);
    expect(v?.lines[0]?.returnedMilli).toBe(1000);
    expect(v?.lines[1]?.returnedMilli).toBe(0);

    const u = await setup();
    expect(
      (await voidInvoice(u.ctx, { invoiceId: u.sale.id, reason: 'mistake', shiftId: u.s.shiftId })).ok,
    ).toBe(true);
    expect((await loadInvoiceView(u.ctx.db, 'sale', u.sale.id))?.status).toBe('voided');
  });

  it('E3: a purchase gives the supplier, lines, total and the part paid by the owner', async () => {
    const t = await setup();
    const supplier: Supplier = {
      ...newCommon(t.ctx),
      name: 'مورد',
      contactName: null,
      phone: null,
      address: null,
      notes: null,
      isExpenseSupplier: false,
      active: true,
      legacyPersonId: null,
    };
    await t.ctx.db.suppliers.put(supplier);
    const bought = await postPurchase(t.ctx, {
      supplierId: supplier.id,
      warehouseId: t.main.id,
      lines: [{ productId: t.s.products[0]!.id, qtyMilli: 10000, unitCost: 500 }],
      payments: [
        { method: 'cash', amount: 2000, cashAccountId: uuidv7() },
        { method: 'owner', amount: 3000, cashAccountId: null },
      ],
    });
    if (!bought.ok) throw new Error(bought.code);
    const v = await loadInvoiceView(t.ctx.db, 'purchase', bought.id);
    expect(v).toMatchObject({ kind: 'purchase', party: 'مورد', total: 5000, status: 'posted' });
    expect(v?.lines).toEqual([
      expect.objectContaining({ qtyMilli: 10000, unitPrice: 500, total: 5000, discount: 0 }),
    ]);
    expect(v?.payments.filter((p) => p.method === 'owner').reduce((a, p) => a + p.amount, 0)).toBe(3000);
  });

  it('an unknown id is null', async () => {
    const t = await setup();
    expect(await loadInvoiceView(t.ctx.db, 'sale', uuidv7())).toBeNull();
    expect(await loadInvoiceView(t.ctx.db, 'purchase', uuidv7())).toBeNull();
  });
});
