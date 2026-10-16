import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { postPurchase } from '@/db/commands/purchasing';
import { addSupplier } from '@/db/commands/save-master';
import { saveProduct } from '@/db/commands/save-product';
import { loadInvoiceView } from '@/db/invoice-view';
import { clearDraft, loadDraft, parseDraft, saveDraft, type PurchaseDraft } from '@/db/purchase-draft';
import { lineHints } from '@/db/purchase-hints';
import type { Supplier } from '@/db/types';

import { newDevice, seedCatalog } from './helpers';

const draft = (patch: Partial<PurchaseDraft> = {}): PurchaseDraft => ({
  supplierId: 's1',
  supplierRef: '4471',
  discount: 1000,
  mode: 'mix',
  paid: 4000,
  ownerPaid: null,
  rows: [{ productId: 'p1', unitId: null, qty: 2000, cost: 500, price: null }],
  savedAt: '2026-10-16T10:00:00.000Z',
  ...patch,
});

describe('purchase draft (P5b)', () => {
  it('is kept on this device, comes back as typed, and is cleared after saving', async () => {
    const ctx = newDevice('K1', 'manager');
    expect(await loadDraft(ctx.db)).toBeNull();
    await saveDraft(ctx.db, draft());
    expect(await loadDraft(ctx.db)).toEqual(draft());
    await clearDraft(ctx.db);
    expect(await loadDraft(ctx.db)).toBeNull();
  });

  it('never syncs: nothing is queued for the server', async () => {
    const ctx = newDevice('K1', 'manager');
    await saveDraft(ctx.db, draft());
    expect(await ctx.db.outbox.count()).toBe(0);
  });

  it('an empty draft (no supplier, no lines, no reference) is not kept', async () => {
    const ctx = newDevice('K1', 'manager');
    await saveDraft(ctx.db, draft());
    await saveDraft(ctx.db, draft({ supplierId: '', supplierRef: '', rows: [] }));
    expect(await loadDraft(ctx.db)).toBeNull();
  });

  it('malformed stored JSON is dropped, bad lines are filtered', () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft('x')).toBeNull();
    expect(parseDraft({ rows: 'no' })).toBeNull();
    const d = parseDraft({
      supplierId: 5,
      discount: -3,
      mode: 'weird',
      rows: [{ productId: 'a', qty: 0 }, { productId: 'b', qty: 1000, cost: 'x' }, null, { qty: 5 }],
    });
    expect(d).toMatchObject({ supplierId: '', discount: 0, mode: 'mix' });
    expect(d?.rows).toEqual([{ productId: 'b', unitId: null, qty: 1000, cost: null, price: null }]);
  });
});

async function setup(role: DeviceContext['role'] = 'manager') {
  const seedCtx = newDevice('K1', 'manager');
  const s = await seedCatalog(seedCtx);
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
  return { ctx, s, warehouse, supplier };
}

describe('quick add of a product and a supplier from the purchase screen (P5b)', () => {
  const fields = { name: 'صنف جديد من الشراء', baseUnitName: 'قطعة', qtyDecimals: 0 };

  it('the storekeeper adds a product by default, without a price', async () => {
    const t = await setup('storekeeper');
    const r = await saveProduct(t.ctx, { fields, barcodes: ['6333333333333'] });
    expect(r.ok).toBe(true);
    // a price is a manager thing: asking for it is refused
    expect(await saveProduct(t.ctx, { fields: { ...fields, name: 'تاني', price: 500 } })).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
  });

  it('a cashier cannot add a product; a group can take addProduct away from a storekeeper', async () => {
    const c = await setup('cashier');
    expect(
      await saveProduct({ ...c.ctx, permissions: { editProductData: 'yes' } }, { fields }),
    ).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    const k = await setup('storekeeper');
    expect(
      await saveProduct({ ...k.ctx, permissions: { editProductData: 'yes' } }, { fields }),
    ).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    // editing an existing one still works with editProductData alone
    const made = await saveProduct(k.ctx, { fields });
    if (!made.ok) throw new Error(made.code);
    expect(
      (
        await saveProduct(
          { ...k.ctx, permissions: { editProductData: 'yes' } },
          { id: made.id, fields: { name: 'اسم جديد' } },
        )
      ).ok,
    ).toBe(true);
  });

  it('a manager adds it with the sale price', async () => {
    const m = await setup('manager');
    const r = await saveProduct(m.ctx, { fields: { ...fields, price: 2500 }, barcodes: ['6333333333334'] });
    if (!r.ok) throw new Error(r.code);
    expect((await m.ctx.db.products.get(r.id))?.price).toBe(2500);
  });

  it('a duplicate barcode is refused', async () => {
    const m = await setup('manager');
    expect((await saveProduct(m.ctx, { fields, barcodes: ['6333333333335'] })).ok).toBe(true);
    expect(
      await saveProduct(m.ctx, { fields: { ...fields, name: 'تاني' }, barcodes: ['6333333333335'] }),
    ).toMatchObject({
      ok: false,
      code: 'DUPLICATE_BARCODE',
    });
  });

  it('a supplier is added with addSupplier only: a manager yes, a storekeeper not by default, a group can give it', async () => {
    const m = await setup('manager');
    expect((await addSupplier(m.ctx, { name: 'مورد جديد', phone: '0100' })).ok).toBe(true);
    const k = await setup('storekeeper');
    expect(await addSupplier(k.ctx, { name: 'مورد' })).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(
      (await addSupplier({ ...k.ctx, permissions: { addSupplier: 'yes' } }, { name: 'مورد المخزن' })).ok,
    ).toBe(true);
    expect(await addSupplier(m.ctx, { name: '   ' })).toMatchObject({ ok: false, code: 'E_VALIDATION' });
  });
});

describe('the supplier invoice number and the invoice discount are kept (P5b)', () => {
  it('discount lines and the paper number are saved and shown by the invoice view', async () => {
    const t = await setup('manager');
    const p = t.s.products[0]!.id;
    const bought = await postPurchase(t.ctx, {
      supplierId: t.supplier.id,
      warehouseId: t.warehouse.id,
      supplierRef: '4471',
      lines: [
        { productId: p, qtyMilli: 10000, unitCost: 500, discount: 40 },
        { productId: t.s.products[1]!.id, qtyMilli: 1000, unitCost: 1000, discount: 60 },
      ],
      payments: [{ method: 'credit', amount: 5900 }],
    });
    if (!bought.ok) throw new Error(bought.code);
    const doc = (await t.ctx.db.purchaseInvoices.toArray())[0]!;
    expect(doc).toMatchObject({ supplierRef: '4471', discount: 100, total: 5900 });
    const view = await loadInvoiceView(t.ctx.db, 'purchase', bought.id);
    expect(view).toMatchObject({ supplierRef: '4471', discount: 100, total: 5900 });
  });
});

describe('the numbers under a purchase line (P5b)', () => {
  it('last price per base unit, current cost and stock', async () => {
    const t = await setup('manager');
    const p = t.s.products[0]!.id;
    expect((await lineHints(t.ctx.db, p)).lastCostPerBase).toBeNull();
    const bought = await postPurchase(t.ctx, {
      supplierId: t.supplier.id,
      warehouseId: t.warehouse.id,
      lines: [{ productId: p, qtyMilli: 10000, unitCost: 500 }],
      payments: [{ method: 'credit', amount: 5000 }],
    });
    expect(bought.ok).toBe(true);
    const h = await lineHints(t.ctx.db, p);
    expect(h.lastCostPerBase).toBe(500);
    expect(h.stockMilli).toBe(10000);
    expect(h.currentCost).toBeGreaterThan(0);
  });
});

describe('barcodes made by the system (P5b polish)', () => {
  it('gives a valid shop barcode and never one a live barcode already has', async () => {
    const ctx = newDevice('K1', 'manager');
    const { generateBarcode } = await import('@/db/barcode');
    const { isEan13 } = await import('@/domain/barcode');
    // the first number the generator would pick is already taken: it picks another
    const first = (await generateBarcode(ctx.db, () => 0.5)) as string;
    expect(isEan13(first)).toBe(true);
    expect(first.startsWith('990')).toBe(true);
    const made = await saveProduct(ctx, {
      fields: { name: 'يحمل الباركود', baseUnitName: 'قطعة', qtyDecimals: 0 },
      barcodes: [first],
    });
    expect(made.ok).toBe(true);
    let n = 0;
    const next = await generateBarcode(ctx.db, () => (n++ === 0 ? 0.5 : 0.25));
    expect(next).not.toBe(first);
    expect(isEan13(next)).toBe(true);
  });
});
