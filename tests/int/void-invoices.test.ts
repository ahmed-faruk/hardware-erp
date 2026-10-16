import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { postSale } from '@/db/commands/post-sale';
import { postPurchase, postPurchaseReturn, voidPurchaseInvoice } from '@/db/commands/purchasing';
import { postSalesReturn, voidInvoice } from '@/db/commands/returns';
import { drawerBalance } from '@/db/cash';
import { uuidv7 } from '@/db/ids';
import type { Supplier } from '@/db/types';

import { newDevice, seedCatalog } from './helpers';

async function setup(role: DeviceContext['role'] = 'manager') {
  const seed = newDevice('K1', 'manager');
  const s = await seedCatalog(seed);
  const ctx: DeviceContext = { ...seed, role };
  const warehouse = {
    ...newCommon(ctx),
    branchId: null,
    name: 'main',
    kind: 'main' as const,
    legacyLocationId: null,
  };
  await ctx.db.warehouses.bulkPut([
    warehouse,
    { ...warehouse, ...newCommon(ctx), name: 'scrap', kind: 'scrap' as const },
  ]);
  const supplier: Supplier = {
    ...newCommon(ctx),
    name: 'مورد',
    contactName: null,
    phone: null,
    address: null,
    notes: null,
    isExpenseSupplier: false,
    active: true,
    legacyPersonId: null,
  };
  await ctx.db.suppliers.put(supplier);
  const safe = uuidv7();
  const p1 = s.products[0]!.id;
  const buy = async (
    qtyMilli: number,
    unitCost: number,
    pays: { method: 'cash' | 'credit'; amount: number }[],
  ) => {
    const r = await postPurchase(seed, {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      lines: [{ productId: p1, qtyMilli, unitCost }],
      payments: pays.map((p) => ({ ...p, cashAccountId: p.method === 'cash' ? safe : null })),
    });
    if (!r.ok) throw new Error(r.code);
    return r;
  };
  const sell = async (payments: { method: string; amount: number }[], customer = false) => {
    const r = await postSale(seed, {
      lines: [{ productId: p1, qtyMilli: 1000, unitPrice: s.products[0]!.price }],
      payments,
      customerId: customer ? s.customer.id : null,
      warehouseId: warehouse.id,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    } as never);
    if (!r.ok) throw new Error(r.code);
    return r;
  };
  const stock = async () =>
    (await ctx.db.stockBalances.toArray()).filter((b) => b.productId === p1).reduce((a, b) => a + b.qty, 0);
  return { ctx, seed, s, warehouse, supplier, safe, p1, buy, sell, stock };
}

describe('delete a sales invoice (any age)', () => {
  it('a 400-day-old cash invoice: the cash leaves the drawer of the shift open now, the status is voided', async () => {
    const t = await setup();
    const sold = await t.sell([{ method: 'cash', amount: 1000 }]);
    await t.ctx.db.salesInvoices.update(sold.id, {
      issuedAt: new Date(Date.now() - 400 * 86_400_000).toISOString(),
    });
    const drawerBefore = await drawerBalance(t.ctx.db, t.s.shiftId);
    const r = await voidInvoice(t.ctx, { invoiceId: sold.id, reason: 'mistake', shiftId: null });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.salesInvoices.get(sold.id))?.status).toBe('voided');
    expect(await drawerBalance(t.ctx.db, t.s.shiftId)).toBe(drawerBefore - 1000);
    const back = (await t.ctx.db.cashMovements.toArray()).filter((m) => m.docType === 'void');
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ shiftId: t.s.shiftId, amount: -1000 });
  });

  it('with no shift open a cash invoice is refused, a credit one is not', async () => {
    const t = await setup();
    const cash = await t.sell([{ method: 'cash', amount: 1000 }]);
    const credit = await t.sell([{ method: 'credit', amount: 1000 }], true);
    await t.ctx.db.shifts.update(t.s.shiftId, { status: 'closed' });
    expect(await voidInvoice(t.ctx, { invoiceId: cash.id, reason: 'mistake', shiftId: null })).toMatchObject({
      ok: false,
      code: 'NO_SHIFT',
    });
    expect((await t.ctx.db.salesInvoices.get(cash.id))?.status).toBe('posted');
    expect((await voidInvoice(t.ctx, { invoiceId: credit.id, reason: 'mistake', shiftId: null })).ok).toBe(
      true,
    );
  });

  it('refused with a posted return, to a cashier, and a second time', async () => {
    const t = await setup();
    const sold = await t.sell([{ method: 'cash', amount: 1000 }]);
    const line = (await t.ctx.db.salesInvoiceLines.where('invoiceId').equals(sold.id).first())!;
    const ret = await postSalesReturn(t.ctx, {
      originalInvoiceId: sold.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000, condition: 'good' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    if (!ret.ok) throw new Error(ret.code);
    expect(await voidInvoice(t.ctx, { invoiceId: sold.id, reason: 'mistake', shiftId: null })).toMatchObject({
      ok: false,
      code: 'HAS_RETURNS',
    });
    const other = await t.sell([{ method: 'cash', amount: 1000 }]);
    expect(
      await voidInvoice(
        { ...t.ctx, role: 'cashier' },
        { invoiceId: other.id, reason: 'mistake', shiftId: null },
      ),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect((await voidInvoice(t.ctx, { invoiceId: other.id, reason: 'mistake', shiftId: null })).ok).toBe(
      true,
    );
    expect(await voidInvoice(t.ctx, { invoiceId: other.id, reason: 'mistake', shiftId: null })).toMatchObject(
      {
        ok: false,
        code: 'ALREADY_VOIDED',
      },
    );
  });
});

describe('delete a purchase invoice', () => {
  it('reverses stock and the supplier credit, puts the safe cash back, and works the average cost out again', async () => {
    const t = await setup();
    // 10 pcs at 7.00 are on the shelf first, so this purchase of 10 at 5.00 moves the average to 6.00
    await t.buy(10000, 700, [{ method: 'credit', amount: 7000 }]);
    const stockBefore = await t.stock();
    const owedBefore = (await t.ctx.db.partyBalances.get(['supplier', t.supplier.id]))?.amount ?? 0;
    expect((await t.ctx.db.products.get(t.p1))!.unitCost).toBe(700);
    const bought = await t.buy(10000, 500, [
      { method: 'cash', amount: 2000 },
      { method: 'credit', amount: 3000 },
    ]);
    expect(await t.stock()).toBe(stockBefore + 10000);
    const r = await voidPurchaseInvoice(t.ctx, { invoiceId: bought.id, reason: 'mistake' });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.purchaseInvoices.get(bought.id))?.status).toBe('voided');
    expect(await t.stock()).toBe(stockBefore);
    expect((await t.ctx.db.partyBalances.get(['supplier', t.supplier.id]))?.amount ?? 0).toBe(owedBefore);
    const cash = (await t.ctx.db.cashMovements.toArray()).filter((m) => m.cashAccountId === t.safe);
    expect(cash.reduce((a, m) => a + m.amount, 0)).toBe(0);
    // the average goes back to what it was before this purchase
    expect((await t.ctx.db.products.get(t.p1))!.unitCost).toBe(700);
    expect((await t.ctx.db.voids.toArray()).filter((v) => v.targetType === 'purchase_invoice')).toHaveLength(
      1,
    );
    expect((await t.ctx.db.outbox.toArray()).some((o) => o.table === 'voids')).toBe(true);
  });

  it('is refused when a posted return points at it, when its goods were sold, to a storekeeper, and the second time', async () => {
    const t = await setup();
    const a = await t.buy(10000, 500, [{ method: 'credit', amount: 5000 }]);
    const line = (await t.ctx.db.purchaseInvoiceLines.where('invoiceId').equals(a.id).first())!;
    const ret = await postPurchaseReturn(t.ctx, {
      supplierId: t.supplier.id,
      originalInvoiceId: a.id,
      warehouseId: t.warehouse.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000 }],
    });
    expect(ret.ok).toBe(true);
    expect(await voidPurchaseInvoice(t.ctx, { invoiceId: a.id, reason: 'mistake' })).toMatchObject({
      ok: false,
      code: 'HAS_RETURNS',
    });
    const b = await t.buy(10000, 700, [{ method: 'credit', amount: 7000 }]);
    // sell down the shelf below what b brought in
    const level = await t.stock();
    await t.ctx.db.stockBalances.update([t.p1, t.warehouse.id], { qty: 5000 });
    expect(level).toBeGreaterThan(5000);
    expect(await voidPurchaseInvoice(t.ctx, { invoiceId: b.id, reason: 'mistake' })).toMatchObject({
      ok: false,
      code: 'STOCK_SOLD',
    });
    await t.ctx.db.stockBalances.update([t.p1, t.warehouse.id], { qty: level });
    expect(
      await voidPurchaseInvoice({ ...t.ctx, role: 'storekeeper' }, { invoiceId: b.id, reason: 'mistake' }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect((await voidPurchaseInvoice(t.ctx, { invoiceId: b.id, reason: 'mistake' })).ok).toBe(true);
    expect(await voidPurchaseInvoice(t.ctx, { invoiceId: b.id, reason: 'mistake' })).toMatchObject({
      ok: false,
      code: 'ALREADY_VOIDED',
    });
  });

  it('a purchase from the old system cannot be deleted', async () => {
    const t = await setup();
    const a = await t.buy(1000, 500, [{ method: 'credit', amount: 500 }]);
    await t.ctx.db.purchaseInvoices.update(a.id, { isLegacy: true });
    expect(await voidPurchaseInvoice(t.ctx, { invoiceId: a.id, reason: 'mistake' })).toMatchObject({
      ok: false,
      code: 'LEGACY',
    });
  });
});
