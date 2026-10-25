import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { cartFacts } from '@/db/cart-facts';
import type { Product } from '@/db/types';

import { newDevice } from './helpers';

const product = (ctx: ReturnType<typeof newDevice>, name: string, extra: Partial<Product> = {}): Product => ({
  ...newCommon(ctx),
  sku: null,
  name,
  categoryId: null,
  type: 'stock',
  baseUnitName: 'pcs',
  qtyDecimals: 0,
  price: 2000,
  unitCost: 1234,
  reorderLevel: 0,
  defaultSupplierId: null,
  imagePath: null,
  extraFields: null,
  active: true,
  legacyItemId: null,
  ...extra,
});

describe('facts shown under a sell cart line', () => {
  it('stock in the selling warehouse; last purchase price, else the product cost; a service has no stock', async () => {
    const ctx = newDevice('K1', 'manager');
    const bought = product(ctx, 'bought');
    const never = product(ctx, 'never');
    const service = product(ctx, 'service', { type: 'service' });
    await ctx.db.products.bulkPut([bought, never, service]);
    await ctx.db.stockBalances.bulkPut([
      { productId: bought.id, warehouseId: 'W', qty: 5000 },
      { productId: bought.id, warehouseId: 'OTHER', qty: 9000 },
    ] as never);
    await ctx.db.purchaseInvoices.bulkPut([
      { id: 'P1', status: 'posted', issuedAt: '2026-10-01T10:00:00.000Z' },
      { id: 'P2', status: 'posted', issuedAt: '2026-10-02T10:00:00.000Z' },
      { id: 'P3', status: 'voided', issuedAt: '2026-10-03T10:00:00.000Z' },
    ] as never);
    await ctx.db.purchaseInvoiceLines.bulkPut([
      { id: 'l1', invoiceId: 'P1', productId: bought.id, qty: 1000, unitFactor: 1000, netAmount: 900 },
      { id: 'l2', invoiceId: 'P2', productId: bought.id, qty: 2000, unitFactor: 1000, netAmount: 1500 },
      { id: 'l3', invoiceId: 'P3', productId: bought.id, qty: 1000, unitFactor: 1000, netAmount: 9999 },
    ] as never);
    const f = await cartFacts(ctx.db, [bought.id, never.id, service.id, 'missing'], 'W');
    expect(f.get(bought.id)).toEqual({ stockMilli: 5000, costPerBase: 750 });
    expect(f.get(never.id)).toEqual({ stockMilli: 0, costPerBase: 1234 });
    expect(f.get(service.id)?.stockMilli).toBeNull();
    expect(f.has('missing')).toBe(false);
  });
});
