import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { rebuildSearchIndex, searchProducts } from '@/db/search';
import type { Product } from '@/db/types';

import { newDevice } from './helpers';

const product = (ctx: ReturnType<typeof newDevice>, name: string, categoryId: string | null): Product => ({
  ...newCommon(ctx),
  sku: null,
  name,
  categoryId,
  type: 'stock',
  baseUnitName: 'pcs',
  qtyDecimals: 0,
  price: 100,
  unitCost: 50,
  reorderLevel: 0,
  defaultSupplierId: null,
  imagePath: null,
  extraFields: null,
  active: true,
  legacyItemId: null,
});

describe('search inside a category', () => {
  it('limits the search to the category, by any part of the name; without a category it looks everywhere', async () => {
    const ctx = newDevice();
    const a = product(ctx, 'paint white 4L', 'CAT-A');
    const b = product(ctx, 'paint red 1L', 'CAT-B');
    const c = product(ctx, 'paint blue', null);
    await ctx.db.products.bulkPut([a, b, c]);
    await rebuildSearchIndex(ctx.db);
    expect((await searchProducts(ctx.db, 'paint')).map((p) => p.id).sort()).toEqual(
      [a.id, b.id, c.id].sort(),
    );
    expect((await searchProducts(ctx.db, 'aint', { categoryId: 'CAT-A' })).map((p) => p.id)).toEqual([a.id]);
    expect((await searchProducts(ctx.db, 'red', { categoryId: 'CAT-A' })).map((p) => p.id)).toEqual([]);
    expect((await searchProducts(ctx.db, 'red', { categoryId: null })).map((p) => p.id)).toEqual([b.id]);
  });
});
