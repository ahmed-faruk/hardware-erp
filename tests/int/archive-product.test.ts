import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { archiveProduct, restoreProduct } from '@/db/commands/archive-product';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { deleteProduct } from '@/db/commands/delete-product';
import { postSale } from '@/db/commands/post-sale';
import { postPurchase } from '@/db/commands/purchasing';
import { postSalesReturn } from '@/db/commands/returns';
import { saveProduct } from '@/db/commands/save-product';
import { uuidv7 } from '@/db/ids';
import { searchProducts } from '@/db/search';
import type { Supplier } from '@/db/types';

import { newDevice, seedCatalog } from './helpers';

/** A product that was sold (so it has history) and is back at stock 0: an opening of 1 unit and a sale of 1 unit. */
async function setup(role: DeviceContext['role'] = 'manager') {
  const seedCtx = newDevice('K1', 'manager');
  const s = await seedCatalog(seedCtx);
  const ctx: DeviceContext = { ...seedCtx, role };
  const main = {
    ...newCommon(ctx),
    branchId: null,
    name: 'main',
    kind: 'main' as const,
    legacyLocationId: null,
  };
  await ctx.db.warehouses.bulkPut([
    main,
    { ...main, ...newCommon(ctx), name: 'scrap', kind: 'scrap' as const },
  ]);
  const made = await saveProduct(seedCtx, {
    fields: { name: 'دهان أرشيف', price: 5000, unitCost: 3000, baseUnitName: 'قطعة', qtyDecimals: 0 },
    barcodes: ['6222222222222', '6222222222223'],
    packUnit: { name: 'كرتونة', factorMilli: 12000, price: null },
  });
  if (!made.ok) throw new Error('product');
  await ctx.db.stockMovements.put({
    ...newCommon(ctx),
    productId: made.id,
    warehouseId: main.id,
    qty: 1000,
    unitCost: 3000,
    docType: 'opening',
    docId: uuidv7(),
    lineId: null,
    occurredAt: new Date().toISOString(),
  } as never);
  const sale = await postSale(seedCtx, {
    lines: [{ productId: made.id, qtyMilli: 1000, unitPrice: 5000 }],
    payments: [{ method: 'cash', amount: 5000 }],
    customerId: null,
    warehouseId: main.id,
    shiftId: s.shiftId,
    cashAccountId: s.cashAccountId,
  } as never);
  if (!sale.ok) throw new Error(sale.code);
  const stock = async () =>
    (await ctx.db.stockMovements.toArray())
      .filter((m) => m.productId === made.id)
      .reduce((a, m) => a + m.qty, 0);
  return { ctx, seedCtx, s, main, id: made.id, sale, stock };
}

describe('archive and restore a product with history (P3)', () => {
  it('a sold product at stock 0 is archived with its barcodes and unit, hidden from search, queued and audited', async () => {
    const t = await setup();
    expect(await t.stock()).toBe(0);
    // deleting is for products that never moved
    expect(await deleteProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'IN_USE' });
    expect(await archiveProduct(t.ctx, t.id)).toEqual({ ok: true });
    const { db } = t.ctx;
    expect((await db.products.get(t.id))?.deletedAt).toBeTruthy();
    expect((await db.barcodes.where('productId').equals(t.id).toArray()).every((b) => b.deletedAt)).toBe(
      true,
    );
    expect((await db.productUnits.where('productId').equals(t.id).toArray()).every((u) => u.deletedAt)).toBe(
      true,
    );
    expect(await searchProducts(db, 'دهان أرشيف')).toEqual([]);
    expect(await searchProducts(db, '6222222222222')).toEqual([]);
    expect(
      (await db.auditLog.toArray()).some((a) => a.action === 'product.archive' && a.entityId === t.id),
    ).toBe(true);
    const tables = (await db.outbox.toArray()).filter((o) => o.status !== 'sent').map((o) => o.table);
    expect(tables).toEqual(expect.arrayContaining(['products', 'barcodes', 'productUnits', 'auditLog']));
    // the invoice and its lines are untouched
    expect(await db.salesInvoiceLines.where('invoiceId').equals(t.sale.id).count()).toBe(1);
  });

  it('stock on hand blocks it and nothing changes', async () => {
    const t = await setup();
    await t.ctx.db.stockMovements.put({
      ...newCommon(t.ctx),
      productId: t.id,
      warehouseId: t.main.id,
      qty: 2000,
      unitCost: 3000,
      docType: 'opening',
      docId: uuidv7(),
      lineId: null,
      occurredAt: new Date().toISOString(),
    } as never);
    await t.ctx.db.stockBalances.put({ productId: t.id, warehouseId: t.main.id, qty: 2000 } as never);
    expect(await archiveProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'HAS_STOCK' });
    expect((await t.ctx.db.products.get(t.id))?.deletedAt).toBeFalsy();
    expect((await t.ctx.db.auditLog.toArray()).some((a) => a.action === 'product.archive')).toBe(false);
  });

  it('negative stock blocks it too (not zero)', async () => {
    const t = await setup();
    await t.ctx.db.stockBalances.put({ productId: t.id, warehouseId: t.main.id, qty: -1000 } as never);
    expect(await archiveProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'HAS_STOCK' });
  });

  it('only a manager or a group with archiveProduct: a storekeeper and a cashier are refused', async () => {
    const t = await setup('storekeeper');
    expect(await archiveProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    const c = await setup('cashier');
    expect(await archiveProduct(c.ctx, c.id)).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    const g = await setup('cashier');
    expect(await archiveProduct({ ...g.ctx, permissions: { archiveProduct: 'yes' } }, g.id)).toEqual({
      ok: true,
    });
    expect(await restoreProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
  });

  it('restore brings back the product, its barcodes and its search words', async () => {
    const t = await setup();
    await archiveProduct(t.ctx, t.id);
    const r = await restoreProduct(t.ctx, t.id);
    expect(r).toEqual({ ok: true, skippedBarcodes: [] });
    const { db } = t.ctx;
    expect((await db.products.get(t.id))?.deletedAt).toBeFalsy();
    expect(
      (await db.barcodes.where('productId').equals(t.id).toArray()).filter((b) => !b.deletedAt),
    ).toHaveLength(2);
    expect(
      (await db.productUnits.where('productId').equals(t.id).toArray()).filter((u) => !u.deletedAt),
    ).toHaveLength(1);
    expect((await searchProducts(db, '6222222222222')).map((p) => p.id)).toContain(t.id);
    expect((await db.auditLog.toArray()).some((a) => a.action === 'product.restore')).toBe(true);
  });

  it('a barcode another product took meanwhile stays off and is reported', async () => {
    const t = await setup();
    await archiveProduct(t.ctx, t.id);
    const other = await saveProduct(t.ctx, {
      fields: { name: 'صنف تاني', price: 100, unitCost: 50, baseUnitName: 'قطعة', qtyDecimals: 0 },
      barcodes: ['6222222222222'],
    });
    expect(other.ok).toBe(true);
    const r = await restoreProduct(t.ctx, t.id);
    expect(r).toEqual({ ok: true, skippedBarcodes: ['6222222222222'] });
    const live = (await t.ctx.db.barcodes.where('productId').equals(t.id).toArray()).filter(
      (b) => !b.deletedAt,
    );
    expect(live.map((b) => b.code)).toEqual(['6222222222223']);
  });

  it('a barcode removed by an edit before the archive does not come back', async () => {
    const t = await setup();
    await saveProduct(t.ctx, { id: t.id, fields: {}, barcodes: ['6222222222222'] });
    await new Promise((r) => setTimeout(r, 5));
    await archiveProduct(t.ctx, t.id);
    await restoreProduct(t.ctx, t.id);
    const live = (await t.ctx.db.barcodes.where('productId').equals(t.id).toArray()).filter(
      (b) => !b.deletedAt,
    );
    expect(live.map((b) => b.code)).toEqual(['6222222222222']);
  });

  it('a taken SKU refuses the restore; a live product cannot be restored', async () => {
    const t = await setup();
    const sku = 'SKU-ARCH-1';
    await t.ctx.db.products.update(t.id, { sku });
    await archiveProduct(t.ctx, t.id);
    await t.ctx.db.products.put({
      ...(await t.ctx.db.products.get(t.id))!,
      id: uuidv7(),
      sku,
      deletedAt: null,
      name: 'نفس الكود',
    });
    expect(await restoreProduct(t.ctx, t.id)).toMatchObject({ ok: false, code: 'SKU_TAKEN' });
    expect((await t.ctx.db.products.get(t.id))?.deletedAt).toBeTruthy();
    const u = await setup();
    expect(await restoreProduct(u.ctx, u.id)).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  it('an archived product cannot be sold or bought, so a held cart or a draft that holds it is refused at posting', async () => {
    const t = await setup();
    await archiveProduct(t.ctx, t.id);
    const sale = await postSale(t.seedCtx, {
      lines: [{ productId: t.id, qtyMilli: 1000, unitPrice: 5000 }],
      payments: [{ method: 'cash', amount: 5000 }],
      customerId: null,
      warehouseId: t.main.id,
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    } as never);
    expect(sale).toMatchObject({ ok: false, code: 'PRODUCT_NOT_FOUND' });
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
    const buy = await postPurchase(t.ctx, {
      supplierId: supplier.id,
      warehouseId: t.main.id,
      lines: [{ productId: t.id, qtyMilli: 1000, unitCost: 500 }],
      payments: [{ method: 'credit', amount: 500, cashAccountId: null }],
    });
    expect(buy).toMatchObject({ ok: false, code: 'PRODUCT_NOT_FOUND' });
  });

  it('a sold, archived product can still be returned without invoice (it was sold) and the stock comes back', async () => {
    const t = await setup();
    await archiveProduct(t.ctx, t.id);
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: null,
      lines: [{ originalLineId: null, productId: t.id, qtyMilli: 1000, unitRefund: 5000, condition: 'good' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(r).toMatchObject({ ok: true });
    expect(await t.stock()).toBe(1000);
  });
});
