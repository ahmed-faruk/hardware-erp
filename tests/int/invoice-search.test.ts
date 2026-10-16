import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon } from '@/db/commands/context';
import { postSale } from '@/db/commands/post-sale';
import { postPurchase, postPurchaseReturn } from '@/db/commands/purchasing';
import { postSalesReturn, voidInvoice } from '@/db/commands/returns';
import {
  resolveProductIds,
  searchPurchaseInvoices,
  searchSalesInvoices,
  todaysInvoices,
} from '@/db/invoice-search';
import type { Supplier } from '@/db/types';
import { EMPTY_FILTER, type InvoiceFilter } from '@/domain/invoice-filter';

import { newDevice, seedCatalog } from './helpers';

const f = (patch: Partial<InvoiceFilter>): InvoiceFilter => ({ ...EMPTY_FILTER, ...patch });

async function setup() {
  const ctx = newDevice('K1', 'manager');
  const s = await seedCatalog(ctx);
  const main = {
    ...newCommon(ctx),
    branchId: null,
    name: 'main',
    kind: 'main' as const,
    legacyLocationId: null,
  };
  const scrap = { ...main, ...newCommon(ctx), name: 'scrap', kind: 'scrap' as const };
  await ctx.db.warehouses.bulkPut([main, scrap]);
  const sale = async (
    lines: [number, number][],
    payments: { method: string; amount: number; reference?: string }[],
    customer = false,
  ) => {
    const r = await postSale(ctx, {
      lines: lines.map(([p, q]) => ({
        productId: s.products[p]!.id,
        qtyMilli: q,
        unitPrice: s.products[p]!.price,
      })),
      payments,
      customerId: customer ? s.customer.id : null,
      warehouseId: main.id,
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
    } as never);
    if (!r.ok) throw new Error(r.code);
    return r;
  };
  return { ctx, s, main, sale };
}

describe('searching the sales invoices of this device (P6)', () => {
  it('every filter alone, then together; newest first; the count and the cut', async () => {
    const t = await setup();
    // A: 1 x product 1 (10.00) cash; B: 2 x product 2 (40.00) on credit to the customer; C: product 3 (30.00) card + 1 x product 1
    const a = await t.sale([[0, 1000]], [{ method: 'cash', amount: 1000 }]);
    const b = await t.sale([[1, 2000]], [{ method: 'credit', amount: 4000 }], true);
    const c = await t.sale(
      [
        [2, 1000],
        [0, 1000],
      ],
      [
        { method: 'card', amount: 3000, reference: '1234' },
        { method: 'cash', amount: 1000 },
      ],
    );
    const search = (patch: Partial<InvoiceFilter>) => searchSalesInvoices(t.ctx.db, f(patch));
    const numbers = async (patch: Partial<InvoiceFilter>) => (await search(patch)).rows.map((r) => r.number);
    expect(await numbers({})).toEqual([c.number, b.number, a.number]); // newest first
    expect(await numbers({ number: '000002' })).toEqual([b.number]);
    expect(await numbers({ method: 'cash' })).toEqual([c.number, a.number]);
    expect(await numbers({ method: 'credit' })).toEqual([b.number]);
    expect(await numbers({ method: 'card' })).toEqual([c.number]);
    expect(await numbers({ method: 'wallet' })).toEqual([]);
    expect(await numbers({ party: 'Customer' })).toEqual([b.number]);
    expect(await numbers({ minAmount: 4000, maxAmount: 4000 })).toEqual([c.number, b.number]);
    expect(await numbers({ minAmount: 1000, maxAmount: 1000 })).toEqual([a.number]);
    // product by name and by id: invoices containing product 1 are A and C
    const ids = await resolveProductIds(t.ctx.db, 'Product 1');
    expect(await numbers({ productIds: ids })).toEqual([c.number, a.number]);
    expect(await numbers({ productIds: [] })).toEqual([]);
    expect(await numbers({ workerId: t.ctx.workerId })).toHaveLength(3);
    expect(await numbers({ workerId: 'nobody' })).toEqual([]);
    expect(await numbers({ deviceId: t.ctx.deviceId })).toHaveLength(3);
    expect(await numbers({ shiftId: t.s.shiftId })).toHaveLength(3);
    expect(await numbers({ shiftId: 'other' })).toEqual([]);
    // together: cash AND product 1 AND not voided
    expect(await numbers({ method: 'cash', productIds: ids, status: 'posted', minAmount: 2000 })).toEqual([
      c.number,
    ]);
    // the cut: matched counts all, rows only `limit`
    const cut = await searchSalesInvoices(t.ctx.db, EMPTY_FILTER, 2);
    expect(cut.matched).toBe(3);
    expect(cut.rows).toHaveLength(2);
  });

  it('status: voided, returned (a posted return) and posted; a voided return is not a return', async () => {
    const t = await setup();
    const a = await t.sale([[0, 2000]], [{ method: 'cash', amount: 2000 }]);
    const b = await t.sale([[1, 1000]], [{ method: 'cash', amount: 2000 }]);
    const c = await t.sale([[2, 1000]], [{ method: 'cash', amount: 3000 }]);
    expect((await voidInvoice(t.ctx, { invoiceId: a.id, reason: 'mistake', shiftId: t.s.shiftId })).ok).toBe(
      true,
    );
    const line = (await t.ctx.db.salesInvoiceLines.where('invoiceId').equals(b.id).first())!;
    const ret = await postSalesReturn(t.ctx, {
      originalInvoiceId: b.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000, condition: 'good' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(ret).toMatchObject({ ok: true });
    const numbers = async (status: InvoiceFilter['status']) =>
      (await searchSalesInvoices(t.ctx.db, f({ status }))).rows.map((r) => r.number);
    expect(await numbers('voided')).toEqual([a.number]);
    expect(await numbers('returned')).toEqual([b.number]);
    expect((await numbers('posted')).sort()).toEqual([b.number, c.number].sort());
    const row = (await searchSalesInvoices(t.ctx.db, f({}))).rows.find((r) => r.number === b.number)!;
    expect(row.hasReturn).toBe(true);
  });

  it('dates: a day range in Cairo days, both ends included', async () => {
    const t = await setup();
    const a = await t.sale([[0, 1000]], [{ method: 'cash', amount: 1000 }]);
    const b = await t.sale([[1, 1000]], [{ method: 'cash', amount: 2000 }]);
    // a: 10 Oct 2026 (Cairo); b: 12 Oct 2026 at 23:30 UTC = 13 Oct 02:30 Cairo
    await t.ctx.db.salesInvoices.update(a.id, { issuedAt: '2026-10-10T09:00:00.000Z' });
    await t.ctx.db.salesInvoices.update(b.id, { issuedAt: '2026-10-12T23:30:00.000Z' });
    const n = async (from: string, to: string) =>
      (await searchSalesInvoices(t.ctx.db, f({ from, to }))).rows.map((r) => r.number);
    expect(await n('2026-10-10', '2026-10-10')).toEqual([a.number]);
    expect(await n('2026-10-11', '2026-10-12')).toEqual([]);
    expect(await n('2026-10-13', '2026-10-13')).toEqual([b.number]);
    expect(await n('2026-10-10', '2026-10-13')).toEqual([b.number, a.number]);
    expect(await n('2026-10-14', '')).toEqual([]);
  });

  it('an archived product is still found by its name (its invoices exist)', async () => {
    const t = await setup();
    await t.sale([[0, 1000]], [{ method: 'cash', amount: 1000 }]);
    await t.ctx.db.products.update(t.s.products[0]!.id, { deletedAt: '2026-10-01T00:00:00.000Z' });
    const ids = await resolveProductIds(t.ctx.db, 'Product 1');
    expect(ids).toContain(t.s.products[0]!.id);
    expect((await searchSalesInvoices(t.ctx.db, f({ productIds: ids }))).matched).toBe(1);
  });
});

describe("today's invoices of this device (P6)", () => {
  it('all of today from every shift of this device, voided ones included; not yesterday, not another device', async () => {
    const t = await setup();
    const a = await t.sale([[0, 1000]], [{ method: 'cash', amount: 1000 }]);
    const b = await t.sale([[1, 1000]], [{ method: 'cash', amount: 2000 }]);
    const old = await t.sale([[2, 1000]], [{ method: 'cash', amount: 3000 }]);
    const foreign = await t.sale([[0, 1000]], [{ method: 'cash', amount: 1000 }]);
    await t.ctx.db.salesInvoices.update(old.id, {
      issuedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    await t.ctx.db.salesInvoices.update(foreign.id, { deviceId: 'another-device' });
    // an invoice of an older shift (closed) is still today's
    await t.ctx.db.salesInvoices.update(a.id, { shiftId: 'an-older-shift' });
    await voidInvoice(t.ctx, { invoiceId: b.id, reason: 'mistake', shiftId: t.s.shiftId });
    const today = await todaysInvoices(t.ctx.db, t.ctx.deviceId);
    expect(today.map((i) => i.number).sort()).toEqual([a.number, b.number].sort());
    expect(today.find((i) => i.id === b.id)?.status).toBe('voided');
    // newest first
    const issued = today.map((i) => i.issuedAt);
    expect([...issued].sort().reverse()).toEqual(issued);
  });

  it('just after Cairo midnight a sale of 23:30 UTC belongs to the new day', async () => {
    const t = await setup();
    const a = await t.sale([[0, 1000]], [{ method: 'cash', amount: 1000 }]);
    await t.ctx.db.salesInvoices.update(a.id, { issuedAt: '2026-10-12T21:30:00.000Z' }); // 00:30 on 13 Oct in Cairo (summer time)
    expect(
      (await todaysInvoices(t.ctx.db, t.ctx.deviceId, new Date('2026-10-13T08:00:00.000Z'))).map((i) => i.id),
    ).toEqual([a.id]);
    expect(await todaysInvoices(t.ctx.db, t.ctx.deviceId, new Date('2026-10-12T20:00:00.000Z'))).toEqual([]);
  });
});

describe('searching the purchase invoices (P6)', () => {
  async function purchases() {
    const t = await setup();
    const mk = (name: string): Supplier => ({
      ...newCommon(t.ctx),
      name,
      contactName: null,
      phone: null,
      address: null,
      notes: null,
      isExpenseSupplier: false,
      active: true,
      legacyPersonId: null,
    });
    const s1 = mk('مورد الألوان');
    const s2 = mk('مورد الكهرباء');
    await t.ctx.db.suppliers.bulkPut([s1, s2]);
    const buy = async (
      sup: Supplier,
      p: number,
      qty: number,
      cost: number,
      pays: { method: 'cash' | 'credit' | 'owner'; amount: number }[],
    ) => {
      const r = await postPurchase(t.ctx, {
        supplierId: sup.id,
        warehouseId: t.main.id,
        lines: [{ productId: t.s.products[p]!.id, qtyMilli: qty, unitCost: cost }],
        payments: pays.map((x) => ({ ...x, cashAccountId: x.method === 'cash' ? t.s.cashAccountId : null })),
      });
      if (!r.ok) throw new Error(r.code);
      return r;
    };
    return { ...t, s1, s2, buy };
  }

  it('supplier, payment method, amount, product, status and worker', async () => {
    const t = await purchases();
    const a = await t.buy(t.s1, 0, 10000, 500, [{ method: 'credit', amount: 5000 }]);
    const b = await t.buy(t.s2, 1, 4000, 1000, [
      { method: 'cash', amount: 3000 },
      { method: 'owner', amount: 1000 },
    ]);
    const search = async (patch: Partial<InvoiceFilter>) =>
      (await searchPurchaseInvoices(t.ctx.db, f(patch))).rows.map((r) => r.number);
    expect(await search({})).toEqual([b.number, a.number]);
    expect(await search({ party: 'الألوان' })).toEqual([a.number]);
    expect(await search({ method: 'owner' })).toEqual([b.number]);
    expect(await search({ method: 'credit' })).toEqual([a.number]);
    expect(await search({ minAmount: 4500 })).toEqual([a.number]);
    expect(await search({ productIds: [t.s.products[1]!.id] })).toEqual([b.number]);
    expect(await search({ workerId: t.ctx.workerId })).toHaveLength(2);
    expect(await search({ number: a.number.slice(-6) })).toEqual([a.number]);
    // returned: a posted purchase return points at it
    const line = (await t.ctx.db.purchaseInvoiceLines.where('invoiceId').equals(a.id).first())!;
    const ret = await postPurchaseReturn(t.ctx, {
      supplierId: t.s1.id,
      warehouseId: t.main.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000 }],
    });
    expect(ret).toMatchObject({ ok: true });
    expect(await search({ status: 'returned' })).toEqual([a.number]);
    expect(await search({ status: 'voided' })).toEqual([]);
  });
});
