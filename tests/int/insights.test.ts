import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { loadInsights } from '@/db/insights';
import { HanafyDB } from '@/db/schema';
import { reorderPlan } from '@/domain/insights';

const NOW = new Date('2026-10-10T10:00:00Z');
const at = (daysAgo: number): string => new Date(NOW.getTime() - daysAgo * 86_400_000).toISOString();
const common = { companyId: 'c', createdBy: null, version: 1, deviceId: 'd', deletedAt: null };
const stamp = { ...common, createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() };

/** The smart report reads sales speed and stock from this device only, imported history included. */
describe('loadInsights', () => {
  it('turns invoices, lines and stock into per-product facts and today KPIs', async () => {
    const db = new HanafyDB(`insights-${Math.random()}`);
    await db.products.bulkAdd([
      {
        ...stamp,
        id: 'p1',
        sku: null,
        name: 'دهان',
        categoryId: null,
        type: 'stock',
        baseUnitName: 'pcs',
        qtyDecimals: 0,
        price: 92_500,
        unitCost: 72_000,
        reorderLevel: 0,
        defaultSupplierId: null,
        imagePath: null,
        extraFields: null,
        active: true,
        legacyItemId: null,
      },
    ] as never);
    await db.stockBalances.bulkAdd([{ productId: 'p1', warehouseId: 'w', qty: 24_000 }]);
    const inv = (id: string, daysAgo: number, total: number, legacy = false) => ({
      ...stamp,
      id,
      number: id,
      issuedAt: at(daysAgo),
      workerId: null,
      shiftId: null,
      status: 'posted',
      voidedBy: null,
      notes: null,
      isLegacy: legacy,
      legacy: null,
      customerId: null,
      warehouseId: null,
      subtotal: total,
      lineDiscountTotal: 0,
      invoiceDiscount: 0,
      taxTotal: 0,
      cashRounding: 0,
      total,
      cashTendered: total,
      changeDue: 0,
    });
    await db.salesInvoices.bulkAdd([
      inv('today', 0, 185_000),
      inv('old-legacy', 10, 92_500, true),
      inv('too-old', 50, 92_500),
    ] as never);
    const line = (id: string, invoiceId: string, qty: number) => ({
      ...stamp,
      id,
      invoiceId,
      lineNo: 1,
      productId: 'p1',
      productUnitId: null,
      unitFactor: 1000,
      qty,
      unitPrice: 92_500,
      lineDiscount: 0,
      allocDiscount: 0,
      taxAmount: 0,
      netAmount: (qty * 92_500) / 1000,
      unitCost: 72_000,
      warehouseId: null,
      legacyText: null,
    });
    await db.salesInvoiceLines.bulkAdd([
      line('l1', 'today', 2000),
      line('l2', 'old-legacy', 1000),
      line('l3', 'too-old', 50_000),
    ] as never);

    const exp = (id: string, daysAgo: number, amount: number, status = 'posted') => ({
      ...stamp,
      id,
      number: id,
      issuedAt: at(daysAgo),
      workerId: null,
      shiftId: null,
      status,
      voidedBy: null,
      notes: null,
      isLegacy: false,
      legacy: null,
      categoryId: 'c',
      amount,
      cashAccountId: null,
      supplierId: null,
    });
    // today is 10 Oct: the 5 Oct expense counts, a voided one and a September one do not
    await db.expenses.bulkAdd([exp('e1', 5, 4000), exp('e2', 5, 999, 'voided'), exp('e3', 20, 777)] as never);

    const d = await loadInsights(db, NOW);
    expect(d.kpis.monthExpenses).toBe(4000);
    expect(d.kpis.todayNet).toBe(185_000);
    expect(d.kpis.todayInvoices).toBe(1);
    expect(d.kpis.stockValue).toBe(24 * 72_000);
    const p = d.products[0]!;
    expect(p.sold30Milli).toBe(3000); // the 50-day-old invoice is outside the window, the legacy one counts
    expect(p.lastSoldDay).toBe('2026-10-10');
    expect(d.events).toHaveLength(3); // the 90-day window
    expect(reorderPlan(d.products, 30)).toHaveLength(0); // 3 units / 30 days with 24 on the shelf: nothing to buy
    expect(d.returned).toEqual([]);

    // one unit comes back today (and a voided return does not count); a purchase goes back too
    const doc = (id: string, status: string, total: number) => ({
      ...stamp,
      id,
      number: id,
      issuedAt: at(0),
      status,
      total,
    });
    await db.salesReturns.bulkAdd([doc('r1', 'posted', 92_500), doc('r2', 'voided', 92_500)] as never);
    await db.salesReturnLines.bulkAdd([
      {
        ...stamp,
        id: 'rl1',
        returnId: 'r1',
        productId: 'p1',
        originalLineId: 'l1',
        qty: 1000,
        netAmount: 92_500,
      },
      {
        ...stamp,
        id: 'rl2',
        returnId: 'r2',
        productId: 'p1',
        originalLineId: 'l1',
        qty: 1000,
        netAmount: 92_500,
      },
    ] as never);
    await db.purchaseReturns.bulkAdd([doc('pr1', 'posted', 30_000)] as never);
    const back = await loadInsights(db, NOW);
    expect(back.returnsToday.sales).toEqual({ count: 1, value: 92_500 });
    expect(back.returnsToday.purchases).toEqual({ count: 1, value: 30_000 });
    expect(back.kpis.todayNet).toBe(185_000 - 92_500);
    expect(back.kpis.avgBasket).toBe(185_000 - 92_500);
    expect(back.products[0]!.sold30Milli).toBe(2000); // 3 sold, 1 returned
    expect(back.returned).toEqual([
      { productId: 'p1', name: 'دهان', returnedMilli: 1000, soldMilli: 3000, sharePct: 33 },
    ]);
  });
});
