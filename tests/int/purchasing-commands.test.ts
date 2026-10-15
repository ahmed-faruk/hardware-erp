import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { approveWithPin } from '@/db/commands/approval';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import {
  postPurchase,
  postPurchaseReturn,
  postStockAdjustment,
  postSupplierPayment,
} from '@/db/commands/purchasing';
import { saveSetting } from '@/db/commands/save-setting';
import { uuidv7 } from '@/db/ids';
import type { Supplier, Worker } from '@/db/types';
import { hashPin } from '@/db/workers';

import { newDevice, seedCatalog } from './helpers';

const PIN = '482915';

async function setup(role: DeviceContext['role'] = 'manager') {
  const seedCtx = newDevice('K1', 'manager');
  const s = await seedCatalog(seedCtx);
  // seeding needs a manager (opens a shift); the test then acts with the requested role on the same database
  const ctx: DeviceContext = { ...seedCtx, role };
  const warehouse = {
    ...newCommon(ctx),
    branchId: null,
    name: 'main',
    kind: 'main' as const,
    legacyLocationId: null,
  };
  await ctx.db.warehouses.put(warehouse);
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
  const { pinHash, pinSalt } = await hashPin(PIN);
  const manager: Worker = {
    ...newCommon(ctx),
    name: 'م',
    role: 'manager',
    pinHash,
    pinSalt,
    photoPath: null,
    active: true,
    legacyEmployeeId: null,
  };
  await ctx.db.workers.put(manager);
  const p1 = s.products[0]!.id;
  const buy = (
    qtyMilli: number,
    unitCost: number,
    pays: { method: 'cash' | 'credit' | 'owner'; amount: number }[],
    extra: Record<string, unknown> = {},
  ) =>
    postPurchase(ctx, {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      lines: [{ productId: p1, qtyMilli, unitCost }],
      payments: pays.map((p) => ({ ...p, cashAccountId: p.method === 'cash' ? safe : null })),
      ...extra,
    });
  const stock = async () =>
    (await ctx.db.stockBalances.toArray()).filter((b) => b.productId === p1).reduce((a, b) => a + b.qty, 0);
  const owed = async () => (await ctx.db.partyBalances.get(['supplier', supplier.id]))?.amount ?? 0;
  return { ctx, s, warehouse, supplier, safe, manager, p1, buy, stock, owed };
}

describe('purchase', () => {
  it('stock up, supplier owed the credit part, cash out of the safe, outbox bundle queued', async () => {
    const t = await setup();
    const before = await t.stock();
    const r = await t.buy(10000, 500, [
      { method: 'cash', amount: 2000 },
      { method: 'credit', amount: 3000 },
    ]);
    expect(r).toMatchObject({ ok: true, total: 5000 });
    expect((await t.stock()) - before).toBe(10000);
    expect(await t.owed()).toBe(-3000);
    expect(
      (await t.ctx.db.cashMovements.toArray())
        .filter((m) => m.docType === 'purchase_invoice')
        .map((m) => m.amount),
    ).toEqual([-2000]);
    expect((await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'purchaseInvoices')).toHaveLength(1);
  });

  it('payments must add up to the total', async () => {
    const t = await setup();
    expect(await t.buy(1000, 500, [{ method: 'cash', amount: 400 }])).toMatchObject({
      ok: false,
      code: 'PAYMENT_MISMATCH',
    });
  });

  it('a cashier cannot receive goods; a storekeeper cannot change a sale price', async () => {
    const c = await setup('cashier');
    expect(await c.buy(1000, 500, [{ method: 'credit', amount: 500 }])).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    const k = await setup('storekeeper');
    expect(
      await k.buy(1000, 500, [{ method: 'credit', amount: 500 }], {
        lines: [{ productId: k.p1, qtyMilli: 1000, unitCost: 500, newSalePrice: 900 }],
      }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect((await k.buy(1000, 500, [{ method: 'credit', amount: 500 }])).ok).toBe(true);
  });

  it('a manager can set the sale price while receiving', async () => {
    const t = await setup();
    const r = await t.buy(1000, 500, [{ method: 'credit', amount: 500 }], {
      lines: [{ productId: t.p1, qtyMilli: 1000, unitCost: 500, newSalePrice: 1300 }],
    });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.products.get(t.p1))?.price).toBe(1300);
  });

  it('a pack of 12 bought as 2 packs adds 24 pieces at the per-piece cost', async () => {
    const t = await setup();
    const before = await t.stock();
    await postPurchase(t.ctx, {
      supplierId: t.supplier.id,
      warehouseId: t.warehouse.id,
      lines: [{ productId: t.p1, qtyMilli: 2000, unitFactorMilli: 12000, unitCost: 6000 }],
      payments: [{ method: 'credit', amount: 12000 }],
    });
    expect((await t.stock()) - before).toBe(24000);
    const m = (await t.ctx.db.stockMovements.toArray()).find((x) => x.docType === 'purchase_invoice')!;
    expect(m.unitCost).toBe(500);
  });
});

describe('paid from the owner pocket', () => {
  it('moves no cash and creates no debt to the owner: only the credit part is owed', async () => {
    const t = await setup();
    const r = await t.buy(10000, 1000, [
      { method: 'cash', amount: 4000 },
      { method: 'owner', amount: 3000 },
      { method: 'credit', amount: 3000 },
    ]);
    expect(r).toMatchObject({ ok: true, total: 10000 });
    expect(
      (await t.ctx.db.cashMovements.toArray())
        .filter((m) => m.docType === 'purchase_invoice')
        .map((m) => m.amount),
    ).toEqual([-4000]);
    expect(await t.owed()).toBe(-3000);
    const pays = (await t.ctx.db.payments.toArray()).map((p) => [p.method, p.amount]);
    expect(pays).toEqual(expect.arrayContaining([['owner', 3000]]));
  });

  it('needs the payFromOwner right: a storekeeper (or a group without it) is refused, nothing is written', async () => {
    const t = await setup('storekeeper');
    const r = await t.buy(1000, 500, [{ method: 'owner', amount: 500 }]);
    expect(r).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(await t.ctx.db.purchaseInvoices.count()).toBe(0);
  });

  it('a supplier payment from the owner pocket lowers what we owe without touching a cash account', async () => {
    const t = await setup();
    await t.buy(10000, 1000, [{ method: 'credit', amount: 10000 }]);
    const r = await postSupplierPayment(t.ctx, { supplierId: t.supplier.id, amount: 4000, method: 'owner' });
    expect(r).toMatchObject({ ok: true, balanceAfter: -6000 });
    expect(
      (await t.ctx.db.cashMovements.toArray()).filter((m) => m.docType === 'supplier_payment'),
    ).toHaveLength(0);
  });
});

describe('purchase return', () => {
  it('goes out at the invoice cost, lowers what we owe, and cannot exceed bought − returned', async () => {
    const t = await setup();
    const bought = await t.buy(10000, 500, [{ method: 'credit', amount: 5000 }]);
    if (!bought.ok) throw new Error(bought.code);
    const line = (await t.ctx.db.purchaseInvoiceLines.where('invoiceId').equals(bought.id).first())!;
    const ret = (qty: number) =>
      postPurchaseReturn(t.ctx, {
        supplierId: t.supplier.id,
        originalInvoiceId: bought.id,
        warehouseId: t.warehouse.id,
        lines: [{ originalLineId: line.id, qtyMilli: qty }],
      });
    const r = await ret(4000);
    expect(r).toMatchObject({ ok: true, total: 2000 });
    expect(await t.owed()).toBe(-3000);
    expect(
      (await t.ctx.db.stockMovements.toArray()).find((m) => m.docType === 'purchase_return')?.unitCost,
    ).toBe(500);
    expect(await ret(7000)).toMatchObject({ ok: false, code: 'RETURN_EXCEEDS_SOLD' });
  });

  it('without an invoice it is for the manager only', async () => {
    const k = await setup('storekeeper');
    const r = await postPurchaseReturn(k.ctx, {
      supplierId: k.supplier.id,
      originalInvoiceId: null,
      warehouseId: k.warehouse.id,
      lines: [{ originalLineId: null, productId: k.p1, qtyMilli: 1000, netAmount: 500 }],
    });
    expect(r).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
  });
});

describe('purchase return period', () => {
  // a purchase made `daysAgo` days ago, as the storekeeper (the manager can approve with the PIN)
  async function oldPurchase(daysAgo: number) {
    const t = await setup('storekeeper');
    const bought = await t.buy(10000, 500, [{ method: 'credit', amount: 5000 }]);
    if (!bought.ok) throw new Error(bought.code);
    await t.ctx.db.purchaseInvoices.update(bought.id, {
      issuedAt: new Date(Date.now() - daysAgo * 86_400_000).toISOString(),
    });
    const line = (await t.ctx.db.purchaseInvoiceLines.where('invoiceId').equals(bought.id).first())!;
    const ret = (extra: Record<string, unknown> = {}) =>
      postPurchaseReturn(t.ctx, {
        supplierId: t.supplier.id,
        originalInvoiceId: bought.id,
        warehouseId: t.warehouse.id,
        lines: [{ originalLineId: line.id, qtyMilli: 1000 }],
        ...extra,
      });
    return { ...t, bought, ret };
  }

  it('inside the period a storekeeper returns alone', async () => {
    const t = await oldPurchase(10);
    expect((await t.ret()).ok).toBe(true);
  });

  it('after the period a storekeeper needs the manager PIN, and the approval is kept on the return', async () => {
    const t = await oldPurchase(60);
    expect(await t.ret()).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    expect(await t.ctx.db.purchaseReturns.count()).toBe(0);
    const a = await approveWithPin(t.ctx, t.manager.id, PIN, 'purchaseReturnAfterPeriod');
    if (!a.ok) throw new Error(a.code);
    const r = await t.ret({ approvalTokens: [a.value.token] });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.purchaseReturns.toArray())[0]?.approvedBy).toBe(t.manager.id);
  });

  it('a manager is never blocked by the period', async () => {
    const t = await oldPurchase(400);
    const m = { ...t.ctx, role: 'manager' as const };
    const r = await postPurchaseReturn(m, {
      supplierId: t.supplier.id,
      originalInvoiceId: t.bought.id,
      warehouseId: t.warehouse.id,
      lines: [
        {
          originalLineId: (await t.ctx.db.purchaseInvoiceLines
            .where('invoiceId')
            .equals(t.bought.id)
            .first())!.id,
          qtyMilli: 1000,
        },
      ],
    });
    expect(r.ok).toBe(true);
  });

  it('the period is a setting: 90 days lets 60 days pass, 0 means the same day only', async () => {
    const t = await oldPurchase(60);
    await saveSetting({ ...t.ctx, role: 'manager' }, 'return.purchaseDays', 90);
    expect((await t.ret()).ok).toBe(true);
    const u = await oldPurchase(1);
    await saveSetting({ ...u.ctx, role: 'manager' }, 'return.purchaseDays', 0);
    expect(await u.ret()).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const v = await oldPurchase(0);
    await saveSetting({ ...v.ctx, role: 'manager' }, 'return.purchaseDays', 0);
    expect((await v.ret()).ok).toBe(true);
  });

  it('a group can take the approval away from a storekeeper: without the right the approval is still asked', async () => {
    const t = await oldPurchase(60);
    const g = { ...t.ctx, permissions: { receivePurchase: 'yes' as const } };
    const line = (await t.ctx.db.purchaseInvoiceLines.where('invoiceId').equals(t.bought.id).first())!;
    const r = await postPurchaseReturn(g, {
      supplierId: t.supplier.id,
      originalInvoiceId: t.bought.id,
      warehouseId: t.warehouse.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000 }],
    });
    expect(r).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
  });
});

describe('supplier payment', () => {
  it('manager only; lowers what we owe and takes the cash from the chosen account', async () => {
    const t = await setup();
    await t.buy(10000, 500, [{ method: 'credit', amount: 5000 }]);
    const r = await postSupplierPayment(t.ctx, {
      supplierId: t.supplier.id,
      amount: 2000,
      method: 'cash',
      cashAccountId: t.safe,
    });
    expect(r).toMatchObject({ ok: true, balanceAfter: -3000 });
    const k = await setup('storekeeper');
    expect(
      await postSupplierPayment(k.ctx, {
        supplierId: k.supplier.id,
        amount: 100,
        method: 'cash',
        cashAccountId: k.safe,
      }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
  });
});

describe('stock adjustment', () => {
  it('a storekeeper adjusts a small value alone, a big one needs the manager PIN', async () => {
    const t = await setup('storekeeper');
    // seeded cost is 600 per piece: 1 piece = 6.00, 200 pieces = 1200.00 (limit 500.00)
    const adj = (qty: number, tokens: string[] = []) =>
      postStockAdjustment(t.ctx, {
        warehouseId: t.warehouse.id,
        reason: 'count',
        lines: [{ productId: t.p1, qtyDeltaMilli: qty }],
        approvalTokens: tokens,
      });
    expect((await adj(1000)).ok).toBe(true);
    expect(await adj(200000)).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const a = await approveWithPin(t.ctx, t.manager.id, PIN, 'stockAdjustmentOverLimit');
    if (!a.ok) throw new Error(a.code);
    expect((await adj(200000, [a.value.token])).ok).toBe(true);
    const row = (await t.ctx.db.stockAdjustments.toArray()).find((x) => x.approvedBy);
    expect(row?.approvedBy).toBe(t.manager.id);
  });

  it('lost cannot add stock', async () => {
    const t = await setup('storekeeper');
    expect(
      await postStockAdjustment(t.ctx, {
        warehouseId: t.warehouse.id,
        reason: 'lost',
        lines: [{ productId: t.p1, qtyDeltaMilli: 1000 }],
      }),
    ).toMatchObject({ ok: false, code: 'E_VALIDATION' });
  });
});
