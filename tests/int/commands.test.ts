import { describe, expect, it, vi } from 'vitest';

import { postSale } from '@/db/commands/post-sale';
import { saveCustomer } from '@/db/commands/save-master';
import { saveProduct } from '@/db/commands/save-product';

import { newDevice, seedCatalog } from './helpers';

describe('postSale', () => {
  it('writes document, lines, payments, ledgers, audit and outbox in one go', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    const r = await postSale(ctx, {
      lines: [
        { productId: s.products[0]!.id, qtyMilli: 2000, unitPrice: 1000 },
        { productId: s.products[1]!.id, qtyMilli: 1000, unitPrice: 2000 },
      ],
      payments: [{ method: 'cash', amount: 4000, tendered: 5000 }],
      warehouseId: s.warehouseId,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    });
    expect(r).toMatchObject({ ok: true, number: 'K1-INV-000001', total: 4000, changeDue: 1000 });
    const { db } = ctx;
    expect(await db.salesInvoices.count()).toBe(1);
    expect(await db.salesInvoiceLines.count()).toBe(2);
    expect((await db.stockMovements.toArray()).map((m) => m.qty).sort((a, b) => a - b)).toEqual([
      -2000, -1000,
    ]);
    expect((await db.cashMovements.toArray()).map((m) => m.amount)).toEqual([4000]);
    expect(await db.partyLedger.count()).toBe(0);
    expect((await db.stockBalances.get([s.products[0]!.id, s.warehouseId]))?.qty).toBe(-2000);
    const pending = await db.outbox.where('status').equals('pending').toArray();
    expect(pending.map((o) => o.table)).toEqual(['shifts', 'salesInvoices', 'auditLog']);
    expect(pending.map((o) => o.deviceSeq)).toEqual([1, 2, 3]);
  });

  it('credit sale writes the customer ledger and updates the balance', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    const r = await postSale(ctx, {
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
      customerId: s.customer.id,
      payments: [{ method: 'credit', amount: 1000 }],
      warehouseId: s.warehouseId,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    });
    expect(r.ok).toBe(true);
    expect((await ctx.db.partyBalances.get(['customer', s.customer.id]))?.amount).toBe(1000);
    expect(await ctx.db.cashMovements.count()).toBe(0);
  });

  it('refuses credit above the limit without manager approval', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    await ctx.db.customers.update(s.customer.id, { creditLimit: 500 });
    const base = {
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
      customerId: s.customer.id,
      payments: [{ method: 'credit' as const, amount: 1000 }],
      warehouseId: s.warehouseId,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    };
    expect(await postSale(ctx, base)).toMatchObject({ ok: false, code: 'OVER_LIMIT' });
    expect(await ctx.db.salesInvoices.count()).toBe(0);
  });

  it('rejects payments that do not add up and leaves nothing behind', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    const r = await postSale(ctx, {
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
      payments: [{ method: 'cash', amount: 900 }],
      warehouseId: s.warehouseId,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    });
    expect(r).toMatchObject({ ok: false, code: 'PAYMENTS_MISMATCH' });
    expect(await ctx.db.salesInvoices.count()).toBe(0);
  });

  it('is atomic: a failure mid-transaction writes nothing and burns no number', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    const before = {
      outbox: await ctx.db.outbox.count(),
      seq: (await ctx.db.numberSequences.get('INV'))?.next,
    };
    vi.spyOn(ctx.db.cashMovements, 'bulkAdd').mockRejectedValue(new Error('power cut'));
    await expect(
      postSale(ctx, {
        lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
        payments: [{ method: 'cash', amount: 1000 }],
        warehouseId: s.warehouseId,
        shiftId: s.shiftId,
        cashAccountId: s.cashAccountId,
      }),
    ).rejects.toThrow('power cut');
    for (const t of [
      ctx.db.salesInvoices,
      ctx.db.salesInvoiceLines,
      ctx.db.payments,
      ctx.db.stockMovements,
      ctx.db.auditLog,
      ctx.db.stockBalances,
    ]) {
      expect(await t.count()).toBe(0);
    }
    expect(await ctx.db.outbox.count()).toBe(before.outbox);
    expect((await ctx.db.numberSequences.get('INV'))?.next).toBe(before.seq);
  });

  it('numbers 1,000 sales sequentially with no gaps', async () => {
    const ctx = newDevice();
    const s = await seedCatalog(ctx);
    for (let i = 0; i < 1000; i++) {
      const r = await postSale(ctx, {
        lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
        payments: [{ method: 'cash', amount: 1000 }],
        warehouseId: s.warehouseId,
        shiftId: s.shiftId,
        cashAccountId: s.cashAccountId,
      });
      expect(r.ok).toBe(true);
    }
    const numbers = (await ctx.db.salesInvoices.orderBy('number').keys()) as string[];
    expect(numbers).toHaveLength(1000);
    expect(numbers[0]).toBe('K1-INV-000001');
    expect(numbers[999]).toBe('K1-INV-001000');
  }, 120_000);
});

describe('saveProduct / saveCustomer', () => {
  it('only a manager changes prices, and only changed fields are queued', async () => {
    const cashier = newDevice('K1', 'cashier');
    const manager = { ...cashier, role: 'manager' as const };
    const s = await seedCatalog(manager);
    const id = s.products[0]!.id;
    expect(
      await saveProduct({ ...cashier, role: 'storekeeper' }, { id, fields: { price: 5 } }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    const r = await saveProduct(manager, {
      id,
      fields: { price: 1234, name: s.products[0]!.name },
      baseVersion: 1,
    });
    expect(r).toMatchObject({ ok: true, version: 2 });
    const queued = (await manager.db.outbox.toArray()).at(-1)!;
    expect(queued).toMatchObject({ table: 'products', changedFields: ['price'], baseVersion: 1 });
  });

  it('detects a stale base version', async () => {
    const ctx = newDevice('K1', 'manager');
    const s = await seedCatalog(ctx);
    expect(
      await saveProduct(ctx, { id: s.products[0]!.id, fields: { price: 9 }, baseVersion: 7 }),
    ).toMatchObject({ ok: false, code: 'E_CONFLICT' });
  });

  it('cashiers cannot edit customers', async () => {
    const ctx = newDevice('K1', 'cashier');
    expect(await saveCustomer(ctx, { fields: { name: 'x' } })).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
  });
});
