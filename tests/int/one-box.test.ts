import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { openShopShift, shiftDrawerMovements } from '@/db/cash';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { postPurchase } from '@/db/commands/purchasing';
import { postSale } from '@/db/commands/post-sale';
import { uuidv7 } from '@/db/ids';
import type { Supplier } from '@/db/types';

import { newDevice, seedCatalog } from './helpers';

describe('one box, one shift', () => {
  it('a sale from another device sits in the one open shift, and a cash purchase during it is in its movements', async () => {
    const a = newDevice('K1', 'manager');
    const s = await seedCatalog(a);
    // device B: the same database (the pulled copy of the shop), another device id
    const b: DeviceContext = { ...a, deviceId: uuidv7(), devicePrefix: 'K2' };
    const warehouse = {
      ...newCommon(a),
      branchId: null,
      name: 'main',
      kind: 'main' as const,
      legacyLocationId: null,
    };
    await a.db.warehouses.put(warehouse);
    expect((await openShopShift(a.db))?.id).toBe(s.shiftId);
    const sold = await postSale(b, {
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: s.products[0]!.price }],
      payments: [{ method: 'cash', amount: s.products[0]!.price }],
      customerId: null,
      warehouseId: warehouse.id,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    } as never);
    if (!sold.ok) throw new Error(sold.code);
    const supplier: Supplier = {
      ...newCommon(a),
      name: 'مورد',
      contactName: null,
      phone: null,
      address: null,
      notes: null,
      isExpenseSupplier: false,
      active: true,
      legacyPersonId: null,
    };
    await a.db.suppliers.put(supplier);
    const bought = await postPurchase(a, {
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitCost: 500 }],
      payments: [{ method: 'cash', amount: 500, cashAccountId: s.cashAccountId }],
    });
    if (!bought.ok) throw new Error(bought.code);
    const { movements } = await shiftDrawerMovements(a.db, s.shiftId);
    expect(movements.map((m) => m.docType).sort()).toEqual(['purchase_invoice', 'sales_invoice']);
    expect(movements.reduce((x, m) => x + m.amount, 0)).toBe(s.products[0]!.price - 500);
  });
});
