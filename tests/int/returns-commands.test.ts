import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { approveWithPin } from '@/db/commands/approval';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { postCustomerReceipt, postSalesReturn, voidInvoice } from '@/db/commands/returns';
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
