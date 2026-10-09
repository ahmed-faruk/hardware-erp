import 'fake-indexeddb/auto';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { openShift } from '@/db/commands/open-shift';
import { HanafyDB } from '@/db/schema';
import type { Customer, Product } from '@/db/types';
import { uuidv7 } from '@/db/ids';

export const COMPANY = 'a0000000-0000-7000-8000-000000000001';
let counter = 0;

export function newDevice(prefix = 'K1', role: DeviceContext['role'] = 'cashier'): DeviceContext {
  counter += 1;
  return {
    db: new HanafyDB(`test-${prefix}-${counter}-${Math.random().toString(36).slice(2)}`),
    companyId: COMPANY,
    deviceId: uuidv7(),
    devicePrefix: prefix,
    workerId: uuidv7(),
    role,
  };
}

export async function seedCatalog(ctx: DeviceContext, shared?: { products: Product[]; customer: Customer }) {
  const products: Product[] =
    shared?.products ??
    [1, 2, 3].map((n) => ({
      ...newCommon(ctx),
      sku: `P${n}`,
      name: `Product ${n}`,
      categoryId: null,
      type: 'stock' as const,
      baseUnitName: 'pcs',
      qtyDecimals: 0,
      price: 1000 * n,
      unitCost: 600 * n,
      reorderLevel: 0,
      defaultSupplierId: null,
      imagePath: null,
      extraFields: null,
      active: true,
      legacyItemId: null,
    }));
  const customer: Customer = shared?.customer ?? {
    ...newCommon(ctx),
    name: 'Customer',
    phone: null,
    address: null,
    company: null,
    notes: null,
    creditLimit: 100_000_000,
    defaultDiscountBp: 0,
    photoPath: null,
    active: true,
    legacyPersonId: null,
  };
  await ctx.db.products.bulkPut(products);
  await ctx.db.customers.put(customer);
  const warehouseId = uuidv7();
  const cashAccountId = uuidv7();
  const shift = await openShift(ctx, { cashAccountId, openingFloat: 10000 });
  if (!shift.ok) throw new Error('shift');
  return { products, customer, warehouseId, cashAccountId, shiftId: shift.id };
}
