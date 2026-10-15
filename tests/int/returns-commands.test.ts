import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { approveWithPin } from '@/db/commands/approval';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { postCustomerReceipt, postSalesReturn, voidInvoice, voidReturn } from '@/db/commands/returns';
import { openShift } from '@/db/commands/open-shift';
import { drawerBalance } from '@/db/cash';
import { postSale } from '@/db/commands/post-sale';
import { uuidv7 } from '@/db/ids';
import type { Worker } from '@/db/types';
import { hashPin } from '@/db/workers';

import { newDevice, seedCatalog } from './helpers';

const PIN = '482915';

async function setup(role: DeviceContext['role'] = 'cashier') {
  const ctx = newDevice('K1', role);
  const s = await seedCatalog(ctx);
  const main = {
    ...newCommon(ctx),
    branchId: null,
    name: 'main',
    kind: 'main' as const,
    legacyLocationId: null,
  };
  const scrap = { ...main, id: uuidv7(), name: 'scrap', kind: 'scrap' as const };
  await ctx.db.warehouses.bulkPut([main, scrap]);
  const { pinHash, pinSalt } = await hashPin(PIN);
  const manager: Worker = {
    ...newCommon(ctx),
    name: 'م',
    role: 'manager',
    pinHash,
    pinSalt,
    photoPath: null,
    active: true,
    legacyEmployeeId: null,
  };
  await ctx.db.workers.put(manager);
  // 3 x product 1 at 10.00 = 30.00: 15.00 cash + 15.00 on the customer's account
  const sold = await postSale(ctx, {
    lines: [{ productId: s.products[0]!.id, qtyMilli: 3000, unitPrice: 1000 }],
    payments: [
      { method: 'cash', amount: 1500 },
      { method: 'credit', amount: 1500 },
    ],
    customerId: s.customer.id,
    warehouseId: main.id,
    shiftId: s.shiftId,
    cashAccountId: s.cashAccountId,
  } as never);
  if (!sold.ok) throw new Error(sold.code);
  const line = (await ctx.db.salesInvoiceLines.where('invoiceId').equals(sold.id).first())!;
  const ret = (qty: number, extra: Record<string, unknown> = {}) =>
    postSalesReturn(ctx, {
      originalInvoiceId: sold.id,
      lines: [{ originalLineId: line.id, qtyMilli: qty, condition: 'good' }],
      shiftId: s.shiftId,
      cashAccountId: s.cashAccountId,
      ...extra,
    });
  const stock = async (wh: string) =>
    (await ctx.db.stockMovements.where('productId').equals(s.products[0]!.id).toArray())
      .filter((m) => m.warehouseId === wh)
      .reduce((a, m) => a + m.qty, 0);
  const balance = async () => (await ctx.db.partyBalances.get(['customer', s.customer.id]))?.amount ?? 0;
  return { ctx, s, main, scrap, manager, sold, line, ret, stock, balance };
}

describe('sales return', () => {
  it('splits the refund by the original payments, puts the goods back and queues one bundle', async () => {
    const t = await setup();
    const r = await t.ret(1000);
    expect(r).toMatchObject({ ok: true, total: 1000, cash: 500, credit: 500 });
    expect(await t.stock(t.main.id)).toBe(-2000);
    expect(await t.balance()).toBe(1000);
    const out = await t.ctx.db.outbox.toArray();
    expect(out.filter((o) => o.table === 'salesReturns')).toHaveLength(1);
  });

  it('cannot return more than sold, also over two returns', async () => {
    const t = await setup();
    expect((await t.ret(2000)).ok).toBe(true);
    expect(await t.ret(2000)).toMatchObject({ ok: false, code: 'RETURN_EXCEEDS_SOLD' });
    expect((await t.ret(1000)).ok).toBe(true);
    expect(await t.stock(t.main.id)).toBe(0);
  });

  it('damaged goods go to the scrap warehouse', async () => {
    const t = await setup();
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: t.sold.id,
      lines: [{ originalLineId: t.line.id, qtyMilli: 1000, condition: 'damaged' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(r.ok).toBe(true);
    expect(await t.stock(t.scrap.id)).toBe(1000);
  });

  it('after the return period a cashier needs the manager PIN; a manager does not', async () => {
    const t = await setup();
    await t.ctx.db.salesInvoices.update(t.sold.id, {
      issuedAt: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    });
    expect(await t.ret(1000)).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const a = await approveWithPin(t.ctx, t.manager.id, PIN, 'returnAfterPeriod');
    if (!a.ok) throw new Error(a.code);
    expect((await t.ret(1000, { approvalTokens: [a.value.token] })).ok).toBe(true);
  });

  it('a cashier cannot return without an invoice', async () => {
    const t = await setup();
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: null,
      lines: [
        {
          originalLineId: null,
          productId: t.s.products[0]!.id,
          qtyMilli: 1000,
          unitRefund: 1000,
          condition: 'good',
        },
      ],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(r).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
  });

  it('a manager returns without an invoice for cash', async () => {
    const t = await setup('manager');
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: null,
      lines: [
        {
          originalLineId: null,
          productId: t.s.products[0]!.id,
          qtyMilli: 2000,
          unitRefund: 800,
          condition: 'good',
        },
      ],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(r).toMatchObject({ ok: true, total: 1600, cash: 1600, credit: 0 });
  });
});

describe('return without invoice with many items (D1..D11)', () => {
  const free = (
    t: Awaited<ReturnType<typeof setup>>,
    lines: [number, number, number, ('good' | 'damaged')?][],
  ) =>
    postSalesReturn(t.ctx, {
      originalInvoiceId: null,
      lines: lines.map(([p, qtyMilli, unitRefund, condition]) => ({
        originalLineId: null,
        productId: t.s.products[p]!.id,
        qtyMilli,
        unitRefund,
        condition: condition ?? 'good',
      })),
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
  const sellSecond = async (t: Awaited<ReturnType<typeof setup>>) => {
    const r = await postSale(t.ctx, {
      lines: [{ productId: t.s.products[1]!.id, qtyMilli: 2000, unitPrice: 2000 }],
      payments: [{ method: 'cash', amount: 4000 }],
      customerId: null,
      warehouseId: t.main.id,
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    } as never);
    if (!r.ok) throw new Error(r.code);
  };

  it('D2: two sold products in one return give one document with two lines and both back in stock', async () => {
    const t = await setup('manager');
    await sellSecond(t);
    const before = await t.ctx.db.salesReturns.count();
    const r = await free(t, [
      [0, 1000, 900],
      [1, 2000, 1800],
    ]);
    expect(r).toMatchObject({ ok: true, total: 900 + 3600, cash: 4500, credit: 0 });
    expect(await t.ctx.db.salesReturns.count()).toBe(before + 1);
    const lines = await t.ctx.db.salesReturnLines.toArray();
    expect(lines).toHaveLength(2);
    const moved = (await t.ctx.db.stockMovements.toArray()).filter((m) => m.docType === 'sales_return');
    expect(moved.map((m) => m.qty).sort()).toEqual([1000, 2000]);
    expect((await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'salesReturns')).toHaveLength(1);
  });

  it('D3: a product that was never sold is refused and nothing is written', async () => {
    const t = await setup('manager');
    const before = await t.ctx.db.salesReturns.count();
    const outbox = await t.ctx.db.outbox.count();
    expect(await free(t, [[2, 1000, 500]])).toMatchObject({ ok: false, code: 'NOT_SOLD' });
    expect(
      await free(t, [
        [0, 1000, 500],
        [2, 1000, 500],
      ]),
    ).toMatchObject({ ok: false, code: 'NOT_SOLD' });
    expect(await t.ctx.db.salesReturns.count()).toBe(before);
    expect(await t.ctx.db.outbox.count()).toBe(outbox);
  });

  it('D3: a product sold only on a voided invoice counts as not sold', async () => {
    const t = await setup('manager');
    const v = await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId });
    expect(v.ok).toBe(true);
    expect(await free(t, [[0, 1000, 500]])).toMatchObject({ ok: false, code: 'NOT_SOLD' });
  });

  it('D4: never more than sold minus already returned, over lines, documents and invoice returns', async () => {
    const t = await setup('manager');
    expect((await t.ret(1000)).ok).toBe(true); // 3 sold, 1 returned by invoice: 2 left
    expect(await free(t, [[0, 2500, 100]])).toMatchObject({ ok: false, code: 'OVER_SOLD' });
    expect(
      await free(t, [
        [0, 1500, 100],
        [0, 1000, 100],
      ]),
    ).toMatchObject({ ok: false, code: 'OVER_SOLD' });
    expect((await free(t, [[0, 1500, 100]])).ok).toBe(true);
    expect(await free(t, [[0, 1000, 100]])).toMatchObject({ ok: false, code: 'OVER_SOLD' });
    expect((await free(t, [[0, 500, 100]])).ok).toBe(true);
    expect(await free(t, [[0, 1, 100]])).toMatchObject({ ok: false, code: 'OVER_SOLD' });
  });

  it('D5: a damaged line goes to scrap and a good one to the main warehouse, in the same document', async () => {
    const t = await setup('manager');
    await sellSecond(t);
    const r = await free(t, [
      [0, 1000, 900, 'damaged'],
      [1, 1000, 1800, 'good'],
    ]);
    expect(r.ok).toBe(true);
    const moved = (await t.ctx.db.stockMovements.toArray()).filter((m) => m.docType === 'sales_return');
    expect(moved.find((m) => m.productId === t.s.products[0]!.id)?.warehouseId).toBe(t.scrap.id);
    expect(moved.find((m) => m.productId === t.s.products[1]!.id)?.warehouseId).toBe(t.main.id);
  });

  it('D6: a refund bigger than the drawer holds is refused, with the same rule as before', async () => {
    const t = await setup('manager');
    expect(await free(t, [[0, 2000, 50_000]])).toMatchObject({ ok: false, code: 'DRAWER_SHORT' });
  });

  it('D11: the total is the sum of the lines only', async () => {
    const t = await setup('manager');
    await sellSecond(t);
    const r = await free(t, [
      [0, 1000, 1000],
      [1, 1000, 2000],
    ]);
    expect(r).toMatchObject({ ok: true, total: 3000 });
  });
});

describe('void a sales return (P2)', () => {
  it('a cash and credit return is reversed exactly: stock, drawer, customer; the return is voided and audited', async () => {
    const t = await setup('manager');
    const drawerBefore = await drawerBalance(t.ctx.db, t.s.shiftId);
    const balanceBefore = await t.balance();
    const stockBefore = await t.stock(t.main.id);
    const r = await t.ret(1000);
    if (!r.ok) throw new Error(r.code);
    expect(await t.stock(t.main.id)).toBe(stockBefore + 1000);
    const v = await voidReturn(t.ctx, { returnId: r.id, reason: 'mistake', shiftId: t.s.shiftId });
    expect(v.ok).toBe(true);
    expect(await t.stock(t.main.id)).toBe(stockBefore);
    expect(await drawerBalance(t.ctx.db, t.s.shiftId)).toBe(drawerBefore);
    expect(await t.balance()).toBe(balanceBefore);
    expect((await t.ctx.db.salesReturns.get(r.id))?.status).toBe('voided');
    const doc = (await t.ctx.db.voids.toArray()).find((x) => x.targetType === 'sales_return');
    expect(doc).toMatchObject({ targetId: r.id, reason: 'mistake' });
    expect(
      (await t.ctx.db.auditLog.toArray()).some((a) => a.action === 'return_voided' && a.entityId === r.id),
    ).toBe(true);
    expect((await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'voids')).toHaveLength(1);
  });

  it('damaged goods leave the scrap warehouse again', async () => {
    const t = await setup('manager');
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: t.sold.id,
      lines: [{ originalLineId: t.line.id, qtyMilli: 1000, condition: 'damaged' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    if (!r.ok) throw new Error(r.code);
    expect(await t.stock(t.scrap.id)).toBe(1000);
    expect((await voidReturn(t.ctx, { returnId: r.id, reason: 'other', shiftId: t.s.shiftId })).ok).toBe(
      true,
    );
    expect(await t.stock(t.scrap.id)).toBe(0);
  });

  it('a credit-only return needs no shift: the customer debt comes back', async () => {
    const t = await setup('manager');
    const sale = await postSale(t.ctx, {
      lines: [{ productId: t.s.products[1]!.id, qtyMilli: 1000, unitPrice: 2000 }],
      payments: [{ method: 'credit', amount: 2000 }],
      customerId: t.s.customer.id,
      warehouseId: t.main.id,
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    } as never);
    if (!sale.ok) throw new Error(sale.code);
    const line = (await t.ctx.db.salesInvoiceLines.where('invoiceId').equals(sale.id).first())!;
    const before = await t.balance();
    const r = await postSalesReturn(t.ctx, {
      originalInvoiceId: sale.id,
      lines: [{ originalLineId: line.id, qtyMilli: 1000, condition: 'good' }],
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    if (!r.ok) throw new Error(r.code);
    expect(await t.balance()).toBe(before - 2000);
    expect((await voidReturn(t.ctx, { returnId: r.id, reason: 'mistake', shiftId: null })).ok).toBe(true);
    expect(await t.balance()).toBe(before);
  });

  it('twice is refused, and a void of the void does not exist', async () => {
    const t = await setup('manager');
    const r = await t.ret(1000);
    if (!r.ok) throw new Error(r.code);
    expect((await voidReturn(t.ctx, { returnId: r.id, reason: 'mistake', shiftId: t.s.shiftId })).ok).toBe(
      true,
    );
    expect(
      await voidReturn(t.ctx, { returnId: r.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({
      ok: false,
      code: 'ALREADY_VOIDED',
    });
    expect(
      await voidReturn(t.ctx, { returnId: uuidv7(), reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('the invoice is returnable again in full, and can itself be voided once its only return is voided', async () => {
    const t = await setup('manager');
    const all = await t.ret(3000);
    if (!all.ok) throw new Error(all.code);
    expect(await t.ret(1000)).toMatchObject({ ok: false, code: 'RETURN_EXCEEDS_SOLD' });
    expect(
      await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({
      ok: false,
      code: 'HAS_RETURNS',
    });
    expect((await voidReturn(t.ctx, { returnId: all.id, reason: 'mistake', shiftId: t.s.shiftId })).ok).toBe(
      true,
    );
    // all three units are returnable again
    const again = await t.ret(3000);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect((await voidReturn(t.ctx, { returnId: again.id, reason: 'other', shiftId: t.s.shiftId })).ok).toBe(
      true,
    );
    expect(
      (await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId })).ok,
    ).toBe(true);
  });

  it('the free-return limit counts the voided quantity as not returned', async () => {
    const t = await setup('manager');
    const free = (q: number) =>
      postSalesReturn(t.ctx, {
        originalInvoiceId: null,
        lines: [
          {
            originalLineId: null,
            productId: t.s.products[0]!.id,
            qtyMilli: q,
            unitRefund: 500,
            condition: 'good',
          },
        ],
        shiftId: t.s.shiftId,
        cashAccountId: t.s.cashAccountId,
      });
    const two = await free(2000);
    if (!two.ok) throw new Error(two.code);
    expect(await free(2000)).toMatchObject({ ok: false, code: 'OVER_SOLD' });
    expect((await voidReturn(t.ctx, { returnId: two.id, reason: 'mistake', shiftId: t.s.shiftId })).ok).toBe(
      true,
    );
    expect((await free(3000)).ok).toBe(true);
  });

  it('only a manager with voidReturn: a cashier, and a manager whose group says no, are refused', async () => {
    const t = await setup('manager');
    const r = await t.ret(1000);
    if (!r.ok) throw new Error(r.code);
    const cashier = { ...t.ctx, role: 'cashier' as const };
    expect(
      await voidReturn(cashier, { returnId: r.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    const grouped = { ...t.ctx, permissions: { void: 'yes' as const } };
    expect(
      await voidReturn(grouped, { returnId: r.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    expect((await t.ctx.db.salesReturns.get(r.id))?.status).toBe('posted');
  });

  it('a cash refund needs an open shift on the drawer that paid it', async () => {
    const t = await setup('manager');
    const r = await t.ret(1000);
    if (!r.ok) throw new Error(r.code);
    expect(await voidReturn(t.ctx, { returnId: r.id, reason: 'mistake', shiftId: null })).toMatchObject({
      ok: false,
      code: 'NO_SHIFT',
    });
    // another drawer's shift is the wrong drawer
    const other = {
      ...newCommon(t.ctx),
      name: 'درج تاني',
      kind: 'drawer' as const,
      ownerDeviceId: t.ctx.deviceId,
    };
    await t.ctx.db.cashAccounts.put(other);
    const second = await openShift(t.ctx, { cashAccountId: other.id, openingFloat: 0 });
    expect(second.ok).toBe(true);
    if (second.ok)
      expect(
        await voidReturn(t.ctx, { returnId: r.id, reason: 'mistake', shiftId: second.id }),
      ).toMatchObject({
        ok: false,
        code: 'WRONG_DRAWER',
      });
    expect((await t.ctx.db.salesReturns.get(r.id))?.status).toBe('posted');
    // a reason outside the list
    expect(
      await voidReturn(t.ctx, { returnId: r.id, reason: 'x' as never, shiftId: t.s.shiftId }),
    ).toMatchObject({
      ok: false,
      code: 'E_VALIDATION',
    });
  });
});

describe('void', () => {
  it('is for the manager only', async () => {
    const t = await setup();
    expect(
      await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
  });

  it('puts stock, customer balance and drawer back exactly, once', async () => {
    const t = await setup('manager');
    const drawer = async () => (await t.ctx.db.cashMovements.toArray()).reduce((a, m) => a + m.amount, 0);
    expect(await drawer()).toBe(1500);
    expect(
      (await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId })).ok,
    ).toBe(true);
    expect(await t.stock(t.main.id)).toBe(0);
    expect(await t.balance()).toBe(0);
    expect(await drawer()).toBe(0);
    expect((await t.ctx.db.salesInvoices.get(t.sold.id))?.status).toBe('voided');
    expect(
      await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({ ok: false, code: 'ALREADY_VOIDED' });
  });

  it('is refused when the invoice already has a return', async () => {
    const t = await setup('manager');
    await t.ret(1000);
    expect(
      await voidInvoice(t.ctx, { invoiceId: t.sold.id, reason: 'mistake', shiftId: t.s.shiftId }),
    ).toMatchObject({ ok: false, code: 'HAS_RETURNS' });
  });
});

describe('customer receipt', () => {
  it('cash reduces the debt and enters the drawer; a card payment needs a reference and skips the drawer', async () => {
    const t = await setup();
    const cash = await postCustomerReceipt(t.ctx, {
      customerId: t.s.customer.id,
      amount: 500,
      method: 'cash',
      shiftId: t.s.shiftId,
      cashAccountId: t.s.cashAccountId,
    });
    expect(cash).toMatchObject({ ok: true, balanceAfter: 1000 });
    expect(
      await postCustomerReceipt(t.ctx, { customerId: t.s.customer.id, amount: 100, method: 'card' }),
    ).toMatchObject({ ok: false });
    const card = await postCustomerReceipt(t.ctx, {
      customerId: t.s.customer.id,
      amount: 200,
      method: 'card',
      reference: '1234',
    });
    expect(card).toMatchObject({ ok: true, balanceAfter: 800 });
    const moves = (await t.ctx.db.cashMovements.toArray()).filter((m) => m.docType === 'customer_receipt');
    expect(moves).toHaveLength(1);
  });
});
