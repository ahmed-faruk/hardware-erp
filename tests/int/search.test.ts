import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { HanafyDB } from '@/db/schema';
import { patchIndex, rebuildSearchIndex, searchProducts, tokensOf } from '@/db/search';
import type { Barcode, Product } from '@/db/types';

import { newDevice } from './helpers';

const product = (ctx: ReturnType<typeof newDevice>, name: string, extra: Partial<Product> = {}): Product => ({
  ...newCommon(ctx),
  sku: null,
  name,
  categoryId: null,
  type: 'stock',
  baseUnitName: 'قطعة',
  qtyDecimals: 0,
  price: 100,
  unitCost: 50,
  reorderLevel: 0,
  defaultSupplierId: null,
  imagePath: null,
  extraFields: null,
  active: true,
  legacyItemId: null,
  ...extra,
});

describe('product search', () => {
  it('finds by partial Arabic words, ignoring alef and ta marbuta variants', async () => {
    const ctx = newDevice();
    const [a, b, c] = [
      product(ctx, 'دهان أبيض 4 لتر'),
      product(ctx, 'مسمار صلب'),
      product(ctx, 'مدرسة دهان'),
    ];
    await ctx.db.products.bulkPut([a, b, c]);
    await rebuildSearchIndex(ctx.db);
    expect((await searchProducts(ctx.db, 'دها')).map((p) => p.id).sort()).toEqual([a.id, c.id].sort());
    expect((await searchProducts(ctx.db, 'ابيض')).map((p) => p.id)).toEqual([a.id]);
    expect((await searchProducts(ctx.db, 'مدرسه')).map((p) => p.id)).toEqual([c.id]);
    expect((await searchProducts(ctx.db, 'دهان لتر')).map((p) => p.id)).toEqual([a.id]);
    expect(await searchProducts(ctx.db, 'غير موجود')).toEqual([]);
  });

  it('finds by any part of a word, not only its beginning', async () => {
    const ctx = newDevice();
    const [a, b, c] = [
      product(ctx, 'دهان أبيض 4 لتر'),
      product(ctx, 'مسمار صلب'),
      product(ctx, 'مدرسة دهان'),
    ];
    await ctx.db.products.bulkPut([a, b, c]);
    await rebuildSearchIndex(ctx.db);
    expect((await searchProducts(ctx.db, 'هان')).map((p) => p.id).sort()).toEqual([a.id, c.id].sort());
    expect((await searchProducts(ctx.db, 'بيض')).map((p) => p.id)).toEqual([a.id]);
    expect((await searchProducts(ctx.db, 'سمار')).map((p) => p.id)).toEqual([b.id]);
    expect((await searchProducts(ctx.db, 'هان لت')).map((p) => p.id)).toEqual([a.id]);
    // a single letter matches from the start of a word only
    expect((await searchProducts(ctx.db, 'ه')).map((p) => p.id)).toEqual([]);
    expect((await searchProducts(ctx.db, 'د')).map((p) => p.id).sort()).toEqual([a.id, c.id].sort());
  });

  it('follows a renamed product at once, and a reopened database finds by any part too', async () => {
    const ctx = newDevice();
    const a = product(ctx, 'دهان أبيض');
    await ctx.db.products.put(a);
    await rebuildSearchIndex(ctx.db);
    expect((await searchProducts(ctx.db, 'بيض')).map((p) => p.id)).toEqual([a.id]);
    const before = await tokensOf(ctx.db, a.id);
    await ctx.db.products.update(a.id, { name: 'ورنيش لامع' });
    await patchIndex(ctx.db, a.id, before);
    expect(await searchProducts(ctx.db, 'بيض')).toEqual([]);
    expect((await searchProducts(ctx.db, 'رنيش')).map((p) => p.id)).toEqual([a.id]);
    const reopened = new HanafyDB(ctx.db.name);
    expect((await searchProducts(reopened, 'امع')).map((p) => p.id)).toEqual([a.id]);
  });

  it('finds by barcode prefix and ignores deleted or inactive products', async () => {
    const ctx = newDevice();
    const live = product(ctx, 'فرشة');
    const gone = product(ctx, 'فرشة قديمة', { deletedAt: '2026-01-01T00:00:00Z' });
    const off = product(ctx, 'فرشة موقوفة', { active: false });
    await ctx.db.products.bulkPut([live, gone, off]);
    const code: Barcode = { ...newCommon(ctx), productId: live.id, productUnitId: null, code: '6221234567' };
    await ctx.db.barcodes.put(code);
    await rebuildSearchIndex(ctx.db);
    expect((await searchProducts(ctx.db, '62212')).map((p) => p.id)).toEqual([live.id]);
    expect((await searchProducts(ctx.db, 'فرشه')).map((p) => p.id)).toEqual([live.id]);
  });

  it('answers within 300 ms with 20,000 products', async () => {
    const ctx = newDevice();
    const words = ['دهان', 'مسمار', 'فرشة', 'سلك', 'لمبة', 'حنفية', 'شاكوش', 'دريل', 'مفتاح', 'صامولة'];
    const rows = Array.from({ length: 20000 }, (_, i) =>
      product(ctx, `${words[i % 10]} ${words[(i * 7) % 10]} صنف ${i}`),
    );
    await ctx.db.products.bulkPut(rows);
    await rebuildSearchIndex(ctx.db);
    const started = performance.now();
    const found = await searchProducts(ctx.db, 'دها صنف 1');
    expect(performance.now() - started).toBeLessThan(300);
    expect(found.length).toBeGreaterThan(0);
  }, 120_000);
});
