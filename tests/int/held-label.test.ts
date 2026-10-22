import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { holdCart, listHeldCarts } from '@/db/commands/carts';
import { EMPTY_CART, addItem, type CartItem } from '@/domain/cart';

import { newDevice } from './helpers';

const paint: CartItem = {
  productId: 'p1',
  productUnitId: null,
  unitFactorMilli: 1000,
  name: 'paint',
  qtyMilli: 1000,
  unitPrice: 1000,
  listPrice: 1000,
};

describe('a written name on a held invoice', () => {
  it('is kept with the held cart; without one it is null', async () => {
    const ctx = newDevice();
    const cart = addItem(EMPTY_CART, paint);
    await holdCart(ctx, cart, 1000, 'Abu Ahmed');
    await holdCart(ctx, cart, 1000);
    const held = await listHeldCarts(ctx.db);
    expect(held.map((h) => h.label ?? null).sort()).toEqual(['Abu Ahmed', null].sort());
  });
});
