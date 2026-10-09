import 'fake-indexeddb/auto';

import { describe, expect, it, vi } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { saveCategory, saveCustomer, saveSupplier, saveWorker } from '@/db/commands/save-master';
import { saveProduct } from '@/db/commands/save-product';
import { searchProducts } from '@/db/search';
import { checkPin } from '@/db/workers';

import { newDevice } from './helpers';

const manager = () => newDevice('K1', 'manager');
const rowsOf = async (ctx: ReturnType<typeof newDevice>, table: 'products' | 'productUnits' | 'barcodes') =>
  (await ctx.db[table].toArray()) as { id: string; deletedAt: string | null; code?: string }[];

describe('saveProduct', () => {
  it('creates the product with barcodes, a pack unit and an icon in one transaction', async () => {
    const ctx = manager();
    const r = await saveProduct(ctx, {
      fields: {
        name: 'دهان أبيض',
        price: 12500,
        unitCost: 9000,
        reorderLevel: 2000,
        baseUnitName: 'علبة',
        extraFields: { icon: 'paint-bucket' },
      },
      barcodes: ['6221', '6222'],
      packUnit: { name: 'كرتونة', factorMilli: 12000, price: 140000 },
    });
    expect(r.ok).toBe(true);
    expect(await ctx.db.products.count()).toBe(1);
    expect((await rowsOf(ctx, 'barcodes')).map((b) => b.code).sort()).toEqual(['6221', '6222']);
    expect(await ctx.db.productUnits.toArray()).toMatchObject([
      { name: 'كرتونة', factor: 12000, price: 140000 },
    ]);
    expect((await ctx.db.products.toArray())[0]).toMatchObject({
      sku: null,
      extraFields: { icon: 'paint-bucket' },
    });
    expect((await ctx.db.outbox.toArray()).map((o) => o.table).sort()).toEqual([
      'barcodes',
      'barcodes',
      'productUnits',
      'products',
    ]);
    expect((await searchProducts(ctx.db, 'ابيض')).length).toBe(1);
    expect((await searchProducts(ctx.db, '6222')).length).toBe(1);
  });

  it('is atomic: a failure writes nothing, not even the search index', async () => {
    const ctx = manager();
    vi.spyOn(ctx.db.barcodes, 'bulkAdd').mockRejectedValue(new Error('power cut'));
    await expect(
      saveProduct(ctx, { fields: { name: 'x', baseUnitName: 'قطعة' }, barcodes: ['1'] }),
    ).rejects.toThrow('power cut');
    for (const t of [ctx.db.products, ctx.db.barcodes, ctx.db.outbox, ctx.db.searchIndex])
      expect(await t.count()).toBe(0);
  });

  it('refuses a barcode that belongs to another product', async () => {
    const ctx = manager();
    await saveProduct(ctx, { fields: { name: 'أول', baseUnitName: 'قطعة' }, barcodes: ['111'] });
    const second = await saveProduct(ctx, {
      fields: { name: 'تاني', baseUnitName: 'قطعة' },
      barcodes: ['222', '111'],
    });
    expect(second).toMatchObject({ ok: false, code: 'DUPLICATE_BARCODE' });
    expect(await ctx.db.products.count()).toBe(1);
  });

  it('edits barcodes and unit: removed ones are soft-deleted, only changed fields are queued, old search words stop matching', async () => {
    const ctx = manager();
    const created = await saveProduct(ctx, {
      fields: { name: 'فرشة', baseUnitName: 'قطعة' },
      barcodes: ['100', '200'],
      packUnit: { name: 'دستة', factorMilli: 12000, price: null },
    });
    if (!created.ok) throw new Error('create');
    await ctx.db.outbox.clear();
    const r = await saveProduct(ctx, {
      id: created.id,
      baseVersion: 1,
      fields: { name: 'رولة' },
      barcodes: ['200', '300'],
      packUnit: null,
    });
    expect(r).toMatchObject({ ok: true, version: 2 });
    const barcodes = await rowsOf(ctx, 'barcodes');
    expect(
      barcodes
        .filter((b) => !b.deletedAt)
        .map((b) => b.code)
        .sort(),
    ).toEqual(['200', '300']);
    expect(barcodes.find((b) => b.code === '100')?.deletedAt).not.toBeNull();
    expect((await rowsOf(ctx, 'productUnits'))[0]?.deletedAt).not.toBeNull();
    expect(await searchProducts(ctx.db, 'فرشه')).toEqual([]);
    expect((await searchProducts(ctx.db, 'رولة')).length).toBe(1);
    expect(await searchProducts(ctx.db, '100')).toEqual([]);
    const product = (await ctx.db.outbox.toArray()).find((o) => o.table === 'products');
    expect(product).toMatchObject({ changedFields: ['name'], baseVersion: 1 });
  });

  it('permissions: cashier cannot save, storekeeper cannot change prices', async () => {
    const base = manager();
    const ok = await saveProduct(base, { fields: { name: 'ص', baseUnitName: 'قطعة', price: 100 } });
    if (!ok.ok) throw new Error('create');
    expect(
      await saveProduct({ ...base, role: 'cashier' }, { id: ok.id, fields: { name: 'غ' } }),
    ).toMatchObject({ code: 'E_FORBIDDEN' });
    const keeper = { ...base, role: 'storekeeper' as const };
    expect(await saveProduct(keeper, { id: ok.id, fields: { price: 5 } })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
    expect(await saveProduct(keeper, { id: ok.id, fields: { name: 'اسم جديد' } })).toMatchObject({
      ok: true,
    });
  });

  it('rejects an empty name and a bad pack factor', async () => {
    const ctx = manager();
    expect(await saveProduct(ctx, { fields: { name: '  ', baseUnitName: 'قطعة' } })).toMatchObject({
      code: 'E_VALIDATION',
    });
    expect(
      await saveProduct(ctx, {
        fields: { name: 'ص', baseUnitName: 'قطعة' },
        packUnit: { name: 'ع', factorMilli: 0, price: null },
      }),
    ).toMatchObject({ code: 'E_VALIDATION' });
  });
});

describe('categories, suppliers, customers, workers', () => {
  it('saves a category with parent, color and icon', async () => {
    const ctx = manager();
    const parent = await saveCategory(ctx, {
      fields: { name: 'دهانات', colorToken: 'cat-1', icon: 'paint-roller', sort: 0 },
    });
    if (!parent.ok) throw new Error('parent');
    const child = await saveCategory(ctx, { fields: { name: 'زيت', parentId: parent.id, icon: 'droplet' } });
    expect(child.ok).toBe(true);
    expect(await ctx.db.categories.count()).toBe(2);
    expect(await saveCategory({ ...ctx, role: 'cashier' }, { fields: { name: 'x' } })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
  });

  it('only a manager saves suppliers and customers', async () => {
    const ctx = manager();
    expect(await saveSupplier(ctx, { fields: { name: 'مورد', phone: '0122' } })).toMatchObject({ ok: true });
    expect(await saveSupplier({ ...ctx, role: 'storekeeper' }, { fields: { name: 'م' } })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
    expect(await saveCustomer(ctx, { fields: { name: 'عميل', creditLimit: 500000 } })).toMatchObject({
      ok: true,
    });
  });

  it('saveWorker hashes the PIN (never stored in clear) and the PIN then works offline', async () => {
    const ctx = manager();
    const r = await saveWorker(ctx, { fields: { name: 'كاشير جديد', role: 'cashier', pin: '482915' } });
    if (!r.ok) throw new Error('worker');
    const stored = (await ctx.db.workers.get(r.id))!;
    expect(stored.pinHash).toBeTruthy();
    expect(JSON.stringify(stored)).not.toContain('482915');
    expect(JSON.stringify(await ctx.db.outbox.toArray())).not.toContain('482915');
    expect(await checkPin(ctx, r.id, '482915')).toMatchObject({ ok: true });
    expect(await checkPin(ctx, r.id, '000000')).toMatchObject({ ok: false });
  });

  it('saveWorker refuses a short PIN, a cashier caller, and can deactivate', async () => {
    const ctx = manager();
    expect(await saveWorker(ctx, { fields: { name: 'ع', role: 'cashier', pin: '1234' } })).toMatchObject({
      code: 'E_VALIDATION',
    });
    expect(
      await saveWorker(
        { ...ctx, role: 'cashier' },
        { fields: { name: 'ع', role: 'cashier', pin: '123456' } },
      ),
    ).toMatchObject({ code: 'E_FORBIDDEN' });
    const r = await saveWorker(ctx, { fields: { name: 'ع', role: 'cashier', pin: '123456' } });
    if (!r.ok) throw new Error('worker');
    expect(await saveWorker(ctx, { id: r.id, fields: { active: false } })).toMatchObject({ ok: true });
    expect((await ctx.db.workers.get(r.id))?.active).toBe(false);
    expect(await checkPin(ctx, r.id, '123456')).toMatchObject({ ok: false });
    const changed = (await ctx.db.outbox.toArray()).at(-1);
    expect(changed).toMatchObject({ table: 'workers', changedFields: ['active'] });
  });

  it('newCommon is used for new rows (company, device, creator)', async () => {
    const ctx = manager();
    const r = await saveSupplier(ctx, { fields: { name: 'مورد' } });
    if (!r.ok) throw new Error('supplier');
    expect(await ctx.db.suppliers.get(r.id)).toMatchObject({
      companyId: ctx.companyId,
      deviceId: ctx.deviceId,
      createdBy: ctx.workerId,
      version: 1,
    });
    expect(newCommon(ctx).version).toBe(1);
  });
});
