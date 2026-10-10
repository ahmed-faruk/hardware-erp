import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { approveWithPin, APPROVAL_TTL_MS } from '@/db/commands/approval';
import {
  holdCart,
  listHeldCarts,
  loadCurrentCart,
  resumeCart,
  saveCurrentCart,
  discardCart,
} from '@/db/commands/carts';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { openShift } from '@/db/commands/open-shift';
import { postSale } from '@/db/commands/post-sale';
import { noSale, reprintInvoice } from '@/db/commands/receipts';
import { addCustomer, saveCustomer } from '@/db/commands/save-master';
import { saveSetting } from '@/db/commands/save-setting';
import { findByBarcode } from '@/db/lookup';
import { loadSettings } from '@/db/settings';
import type { Worker } from '@/db/types';
import { hashPin } from '@/db/workers';
import { addItem, EMPTY_CART, productToItem } from '@/domain/cart';

import { newDevice, seedCatalog } from './helpers';

const MANAGER_PIN = '482915';

async function setup(role: DeviceContext['role'] = 'cashier') {
  const ctx = newDevice('K1', role);
  const s = await seedCatalog(ctx);
  const { pinHash, pinSalt } = await hashPin(MANAGER_PIN);
  const manager: Worker = {
    ...newCommon(ctx),
    name: 'المدير',
    role: 'manager',
    pinHash,
    pinSalt,
    photoPath: null,
    active: true,
    legacyEmployeeId: null,
  };
  await ctx.db.workers.put(manager);
  const base = { warehouseId: s.warehouseId, shiftId: s.shiftId, cashAccountId: s.cashAccountId };
  const sell = (extra: Record<string, unknown> = {}) =>
    postSale(ctx, {
      lines: [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
      payments: [{ method: 'cash', amount: 1000 }],
      ...base,
      ...extra,
    } as never);
  const approve = async (
    action: 'discountOverLimit' | 'priceOverride' | 'creditOverLimit' | 'noSaleDrawer',
  ) => {
    const r = await approveWithPin(ctx, manager.id, MANAGER_PIN, action);
    if (!r.ok) throw new Error(r.code);
    return r.value;
  };
  return { ctx, s, manager, base, sell, approve };
}

describe('openShift rules', () => {
  it('refuses a second open shift on the same drawer, even for another worker', async () => {
    const { ctx, s } = await setup();
    const other = { ...ctx, workerId: 'someone-else' };
    expect(await openShift(other, { cashAccountId: s.cashAccountId, openingFloat: 0 })).toMatchObject({
      ok: false,
      code: 'SHIFT_ALREADY_OPEN',
    });
  });
  it('refuses to open a shift when the device clock is unsafe', async () => {
    const { ctx } = await setup();
    await ctx.db.shifts.clear();
    await ctx.db.syncState.put({ key: 'clockSkewMs', value: 10 * 60 * 1000 });
    expect(await openShift(ctx, { cashAccountId: 'drawer', openingFloat: 0 })).toMatchObject({
      ok: false,
      code: 'CLOCK_UNSAFE',
    });
  });
});

describe('approveWithPin', () => {
  it('gives a single-use token for one action after the right manager PIN', async () => {
    const { ctx, manager } = await setup();
    const ok = await approveWithPin(ctx, manager.id, MANAGER_PIN, 'discountOverLimit');
    expect(ok).toMatchObject({ ok: true });
    const wrong = await approveWithPin(ctx, manager.id, '000000', 'discountOverLimit');
    expect(wrong).toMatchObject({ ok: false, code: 'PIN_WRONG' });
  });
  it('only an active manager can approve', async () => {
    const { ctx } = await setup();
    expect(await approveWithPin(ctx, ctx.workerId, MANAGER_PIN, 'noSaleDrawer')).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
  });
});

describe('postSale approvals', () => {
  const discount = { kind: 'percentBp', valueBp: 100 };
  it('a cashier discount needs the manager PIN by default; with a token it sells and the approver is audited', async () => {
    const { ctx, s, sell, approve, manager } = await setup();
    const line = [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000, discount }];
    expect(await sell({ lines: line, payments: [{ method: 'cash', amount: 990 }] })).toMatchObject({
      ok: false,
      code: 'APPROVAL_REQUIRED',
      message: 'discountOverLimit',
    });
    const token = (await approve('discountOverLimit')).token;
    const r = await sell({
      lines: line,
      payments: [{ method: 'cash', amount: 990 }],
      approvalTokens: [token],
    });
    expect(r).toMatchObject({ ok: true, total: 990 });
    const audit = (await ctx.db.auditLog.toArray()).find((a) => a.action === 'sale_posted');
    expect(audit?.approvedBy).toBe(manager.id);
  });
  it('a token is single use and bound to its action', async () => {
    const { s, sell, approve } = await setup();
    const line = [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000, discount }];
    const token = (await approve('discountOverLimit')).token;
    expect(
      await sell({ lines: line, payments: [{ method: 'cash', amount: 990 }], approvalTokens: [token] }),
    ).toMatchObject({ ok: true });
    expect(
      await sell({ lines: line, payments: [{ method: 'cash', amount: 990 }], approvalTokens: [token] }),
    ).toMatchObject({ code: 'APPROVAL_REQUIRED' });
    const wrongAction = (await approve('priceOverride')).token;
    expect(
      await sell({ lines: line, payments: [{ method: 'cash', amount: 990 }], approvalTokens: [wrongAction] }),
    ).toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });
  it('an expired token is refused', async () => {
    const { ctx, manager, s, sell } = await setup();
    const old = await approveWithPin(
      ctx,
      manager.id,
      MANAGER_PIN,
      'discountOverLimit',
      Date.now() - APPROVAL_TTL_MS - 1000,
    );
    if (!old.ok) throw new Error('approve');
    const line = [{ productId: s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000, discount }];
    expect(
      await sell({
        lines: line,
        payments: [{ method: 'cash', amount: 990 }],
        approvalTokens: [old.value.token],
      }),
    ).toMatchObject({ code: 'APPROVAL_REQUIRED' });
  });
  it('when the manager allows discounts, up to the limit is free and above it needs approval', async () => {
    const m = { ...(await setup()) };
    const mgr: DeviceContext = { ...m.ctx, role: 'manager' };
    await saveSetting(mgr, 'sale.cashierMayDiscount', true);
    await saveSetting(mgr, 'sale.cashierDiscountLimitBp', 500);
    const line = (bp: number) => [
      {
        productId: m.s.products[0]!.id,
        qtyMilli: 1000,
        unitPrice: 1000,
        discount: { kind: 'percentBp', valueBp: bp },
      },
    ];
    expect(await m.sell({ lines: line(500), payments: [{ method: 'cash', amount: 950 }] })).toMatchObject({
      ok: true,
    });
    expect(await m.sell({ lines: line(501), payments: [{ method: 'cash', amount: 950 }] })).toMatchObject({
      code: 'APPROVAL_REQUIRED',
    });
  });
  it('a changed price needs approval unless the manager allows it', async () => {
    const m = await setup();
    const cheaper = [{ productId: m.s.products[0]!.id, qtyMilli: 1000, unitPrice: 900 }];
    expect(await m.sell({ lines: cheaper, payments: [{ method: 'cash', amount: 900 }] })).toMatchObject({
      code: 'APPROVAL_REQUIRED',
      message: 'priceOverride',
    });
    await saveSetting({ ...m.ctx, role: 'manager' }, 'sale.cashierMayChangePrice', true);
    expect(await m.sell({ lines: cheaper, payments: [{ method: 'cash', amount: 900 }] })).toMatchObject({
      ok: true,
    });
  });
  it('a manager never needs approval', async () => {
    const m = await setup('manager');
    const line = [
      {
        productId: m.s.products[0]!.id,
        qtyMilli: 1000,
        unitPrice: 700,
        discount: { kind: 'percentBp', valueBp: 5000 },
      },
    ];
    expect(await m.sell({ lines: line, payments: [{ method: 'cash', amount: 350 }] })).toMatchObject({
      ok: true,
    });
  });
  it('credit over the customer limit needs approval', async () => {
    const m = await setup();
    await m.ctx.db.customers.update(m.s.customer.id, { creditLimit: 500 });
    const credit = { customerId: m.s.customer.id, payments: [{ method: 'credit', amount: 1000 }] };
    expect(await m.sell(credit)).toMatchObject({ code: 'APPROVAL_REQUIRED', message: 'creditOverLimit' });
    const token = (await m.approve('creditOverLimit')).token;
    expect(await m.sell({ ...credit, approvalTokens: [token] })).toMatchObject({ ok: true });
  });
});

describe('held carts', () => {
  it('autosaves the open cart and survives a reload', async () => {
    const { ctx } = await setup();
    const cart = addItem(EMPTY_CART, productToItem({ id: 'p1', name: 'دهان', price: 1000 }));
    await saveCurrentCart(ctx.db, cart);
    expect(await loadCurrentCart(ctx.db)).toEqual(cart);
    await saveCurrentCart(ctx.db, EMPTY_CART);
    expect(await loadCurrentCart(ctx.db)).toBeNull();
  });
  it('holds, lists and resumes a cart exactly once; a held cart can be discarded', async () => {
    const { ctx } = await setup();
    const cart = addItem(EMPTY_CART, productToItem({ id: 'p1', name: 'دهان', price: 1000 }));
    await saveCurrentCart(ctx.db, cart);
    const id = await holdCart(ctx, cart, 1000);
    expect(await loadCurrentCart(ctx.db)).toBeNull();
    expect((await listHeldCarts(ctx.db)).map((h) => [h.id, h.total])).toEqual([[id, 1000]]);
    expect(await resumeCart(ctx.db, id)).toEqual(cart);
    expect(await resumeCart(ctx.db, id)).toBeNull();
    const second = await holdCart(ctx, cart, 1000);
    await discardCart(ctx.db, second);
    expect(await listHeldCarts(ctx.db)).toEqual([]);
  });
});

describe('noSale and reprint', () => {
  it('a cashier needs a manager PIN to open the drawer; the reason and approver are audited and queued', async () => {
    const { ctx, approve, manager } = await setup();
    expect(await noSale(ctx, 'change')).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const token = (await approve('noSaleDrawer')).token;
    const r = await noSale(ctx, 'change', token);
    expect(r).toMatchObject({ ok: true });
    const audit = (await ctx.db.auditLog.toArray()).find((a) => a.action === 'no_sale');
    expect(audit).toMatchObject({ approvedBy: manager.id, after: { reason: 'change' } });
    expect((await ctx.db.outbox.toArray()).some((o) => o.table === 'auditLog' && o.id === audit?.id)).toBe(
      true,
    );
  });
  it('a manager opens it without approval', async () => {
    const { ctx } = await setup('manager');
    expect(await noSale(ctx, 'cashCheck')).toMatchObject({ ok: true });
  });
  it('a reprint is marked copy, identical to the original, and audited', async () => {
    const { ctx, sell } = await setup();
    const sale = await sell();
    if (!sale.ok) throw new Error('sale');
    const r = await reprintInvoice(ctx, sale.id);
    expect(r).toMatchObject({ ok: true, value: { copy: true, number: 'K1-INV-000001', total: '10.00' } });
    expect(
      (await ctx.db.auditLog.toArray()).some(
        (a) => a.action === 'invoice_reprinted' && a.entityId === sale.id,
      ),
    ).toBe(true);
  });
  it('a credit receipt shows the customer balance before, this invoice and after', async () => {
    const { ctx, s, sell } = await setup();
    const first = await sell({ customerId: s.customer.id, payments: [{ method: 'credit', amount: 1000 }] });
    const second = await sell({
      customerId: s.customer.id,
      payments: [{ method: 'credit', amount: 500 }],
      lines: [{ productId: s.products[0]!.id, qtyMilli: 500, unitPrice: 1000 }],
    });
    if (!first.ok || !second.ok) throw new Error('sale');
    const r = await reprintInvoice(ctx, second.id);
    expect(r).toMatchObject({
      ok: true,
      value: { credit: { previous: '10.00', thisInvoice: '5.00', now: '15.00' } },
    });
  });
});

describe('settings and customers', () => {
  it('only a manager saves a setting; the same key always updates the same row', async () => {
    const { ctx } = await setup();
    const mgr = { ...ctx, role: 'manager' as const };
    expect(await saveSetting(ctx, 'sale.cashierMayDiscount', true)).toMatchObject({ code: 'E_FORBIDDEN' });
    await saveSetting(mgr, 'sale.cashierMayDiscount', true);
    await saveSetting(mgr, 'sale.cashierMayDiscount', false);
    expect(await ctx.db.settings.count()).toBe(1);
    expect((await loadSettings(ctx.db)).cashierMayDiscount).toBe(false);
  });
  it('a cashier adds a customer with limit 0; a storekeeper cannot; editing stays with the manager', async () => {
    const { ctx } = await setup();
    const r = await addCustomer(ctx, { name: 'عميل جديد', phone: '01012345678' });
    if (!r.ok) throw new Error(r.code);
    expect(await ctx.db.customers.get(r.id)).toMatchObject({
      creditLimit: 0,
      defaultDiscountBp: 0,
      phone: '01012345678',
    });
    expect(await addCustomer({ ...ctx, role: 'storekeeper' }, { name: 'ص' })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
    expect(await saveCustomer(ctx, { id: r.id, fields: { creditLimit: 99999 } })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
  });
});

describe('findByBarcode', () => {
  it('finds a product by barcode, a pack unit by its own barcode, and nothing for unknown or removed codes', async () => {
    const { ctx, s } = await setup();
    const product = s.products[0]!;
    const unit = {
      ...newCommon(ctx),
      productId: product.id,
      name: 'كرتونة',
      factor: 12000,
      price: 140000,
      isDefaultSale: false,
      isDefaultPurchase: false,
    };
    await ctx.db.productUnits.put(unit);
    await ctx.db.barcodes.bulkPut([
      { ...newCommon(ctx), productId: product.id, productUnitId: null, code: '111' },
      { ...newCommon(ctx), productId: product.id, productUnitId: unit.id, code: '222' },
      {
        ...newCommon(ctx),
        productId: product.id,
        productUnitId: null,
        code: '333',
        deletedAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(await findByBarcode(ctx.db, '111')).toMatchObject({ product: { id: product.id }, unit: null });
    expect(await findByBarcode(ctx.db, '222')).toMatchObject({
      product: { id: product.id },
      unit: { id: unit.id },
    });
    expect(await findByBarcode(ctx.db, '999')).toBeNull();
    expect(await findByBarcode(ctx.db, '333')).toBeNull();
    expect(await findByBarcode(ctx.db, '  ')).toBeNull();
  });
});
