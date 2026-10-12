import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { deleteProduct } from '@/db/commands/delete-product';
import { saveProduct } from '@/db/commands/save-product';
import { uuidv7 } from '@/db/ids';
import { searchProducts } from '@/db/search';
import type { Product } from '@/db/types';

import { newDevice, seedCatalog } from './helpers';

async function setup(role: 'manager' | 'cashier' | 'storekeeper' = 'manager') {
  const seedCtx = newDevice('K1', 'manager');
  const s = await seedCatalog(seedCtx);
  const ctx = { ...seedCtx, role };
  const made = await saveProduct(seedCtx, {
    fields: { name: 'دهان تجربة حذف', price: 5000, unitCost: 3000, baseUnitName: 'قطعة', qtyDecimals: 0 },
    barcodes: ['6111111111111'],
    packUnit: { name: 'كرتونة', factorMilli: 12000, price: null },
  });
  if (!made.ok) throw new Error('product');
  return { ctx, id: made.id, seed: s };
}

const move = (ctx: Awaited<ReturnType<typeof setup>>['ctx'], productId: string, qty: number) =>
  ctx.db.stockMovements.put({
    ...newCommon(ctx),
    productId,
    warehouseId: uuidv7(),
    qty,
    unitCost: 3000,
    docType: 'opening',
    docId: uuidv7(),
    lineId: null,
    occurredAt: new Date().toISOString(),
  } as never);

const line = (ctx: Awaited<ReturnType<typeof setup>>['ctx'], table: string, productId: string) =>
  (ctx.db as unknown as Record<string, { put: (r: unknown) => Promise<unknown> }>)[table]!.put({
    ...newCommon(ctx),
    productId,
    invoiceId: uuidv7(),
    returnId: uuidv7(),
    adjustmentId: uuidv7(),
  });

describe('delete product (C1..C12)', () => {
  it('C1: a product that never moved is deleted with its barcodes and pack unit, and the delete is queued and audited', async () => {
    const t = await setup();
    const r = await deleteProduct(t.ctx, t.id);
    expect(r).toEqual({ ok: true });
    const { db } = t.ctx;
    expect((await db.products.get(t.id))?.deletedAt).toBeTruthy();
    expect((await db.barcodes.where('productId').equals(t.id).toArray()).every((b) => b.deletedAt)).toBe(
      true,
    );
    expect((await db.productUnits.where('productId').equals(t.id).toArray()).every((u) => u.deletedAt)).toBe(
      true,
    );
    const outbox = await db.outbox.toArray();
    const tables = outbox.filter((o) => o.status !== 'sent').map((o) => o.table);
    expect(tables).toEqual(expect.arrayContaining(['products', 'barcodes', 'productUnits', 'auditLog']));
    expect(
      (await db.auditLog.toArray()).some((a) => a.action === 'product.delete' && a.entityId === t.id),
    ).toBe(true);
  });

  it('C11: it leaves search and the barcode can be used again (C12)', async () => {
    const t = await setup();
    expect((await searchProducts(t.ctx.db, 'تجربة حذف')).map((p: Product) => p.id)).toContain(t.id);
    await deleteProduct(t.ctx, t.id);
    expect((await searchProducts(t.ctx.db, 'تجربة حذف')).map((p: Product) => p.id)).not.toContain(t.id);
    expect(await searchProducts(t.ctx.db, '6111111111111')).toEqual([]);
    const again = await saveProduct(t.ctx, {
      fields: { name: 'صنف جديد', price: 100, unitCost: 50, baseUnitName: 'قطعة', qtyDecimals: 0 },
      barcodes: ['6111111111111'],
    });
    expect(again.ok).toBe(true);
  });

  it.each([
    ['salesInvoiceLines', 'sales'],
    ['salesReturnLines', 'returns'],
    ['purchaseInvoiceLines', 'purchases'],
    ['purchaseReturnLines', 'returns'],
    ['stockAdjustmentLines', 'movements'],
  ])('C2..C4: a %s row blocks the delete (%s) and nothing changes', async (table, reason) => {
    const t = await setup();
    await line(t.ctx, table, t.id);
    const r = await deleteProduct(t.ctx, t.id);
    expect(r).toMatchObject({ ok: false, code: 'IN_USE', reasons: [reason] });
    expect((await t.ctx.db.products.get(t.id))?.deletedAt).toBeFalsy();
    expect((await t.ctx.db.auditLog.toArray()).some((a) => a.action === 'product.delete')).toBe(false);
  });

  it('C4/C5: a stock movement blocks it, and so does stock on hand', async () => {
    const t = await setup();
    await move(t.ctx, t.id, 3000);
    expect(await deleteProduct(t.ctx, t.id)).toMatchObject({
      ok: false,
      reasons: ['movements', 'stock'],
    });
    const u = await setup();
    await move(u.ctx, u.id, 3000);
    await move(u.ctx, u.id, -3000);
    // back to zero stock but it moved: still blocked
    expect(await deleteProduct(u.ctx, u.id)).toMatchObject({ ok: false, reasons: ['movements'] });
  });

  it('C8: a cashier cannot, a storekeeper (edit product data) can', async () => {
    const t = await setup('cashier');
    expect(await deleteProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect((await t.ctx.db.products.get(t.id))?.deletedAt).toBeFalsy();
    const k = await setup('storekeeper');
    expect(await deleteProduct(k.ctx, k.id)).toEqual({ ok: true });
  });

  it('a product that is already deleted, or unknown, is NOT_FOUND', async () => {
    const t = await setup();
    await deleteProduct(t.ctx, t.id);
    expect(await deleteProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect(await deleteProduct(t.ctx, uuidv7())).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });
});
