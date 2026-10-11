import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { approveWithPin } from '@/db/commands/approval';
import {
  closeShift,
  postCashTransfer,
  postExpense,
  previewClose,
  postCashAdjustment,
  saveExpenseCategory,
} from '@/db/commands/cash';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { postSale } from '@/db/commands/post-sale';
import { drawerBalance } from '@/db/cash';
import type { CashAccount, ExpenseCategory, Worker } from '@/db/types';
import { hashPin } from '@/db/workers';

import { newDevice, seedCatalog } from './helpers';

const PIN = '482915';

async function setup(role: DeviceContext['role'] = 'cashier') {
  const seedCtx = newDevice('K1', 'manager');
  const s = await seedCatalog(seedCtx);
  const ctx: DeviceContext = { ...seedCtx, role };
  const drawer: CashAccount = {
    ...newCommon(ctx),
    id: s.cashAccountId,
    name: 'درج',
    kind: 'drawer',
    ownerDeviceId: ctx.deviceId,
  };
  const safe: CashAccount = { ...newCommon(ctx), name: 'خزنة', kind: 'safe', ownerDeviceId: null };
  const category: ExpenseCategory = { ...newCommon(ctx), name: 'نثريات', icon: null };
  await ctx.db.cashAccounts.bulkPut([drawer, safe]);
  await ctx.db.expenseCategories.put(category);
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
  const expense = (amount: number) =>
    postExpense(ctx, { categoryId: category.id, amount, cashAccountId: drawer.id, shiftId: s.shiftId });
  // 5 x 20.00 notes etc: helper builds a count of exactly `piasters` out of 50.00 notes and 1.00 coins
  const count = (piasters: number) => [
    { value: 5000, count: Math.floor(piasters / 5000) },
    { value: 100, count: (piasters % 5000) / 100 },
  ];
  return { ctx, s, drawer, safe, category, manager, expense, count };
}

describe('close shift', () => {
  it('a drawer that matches closes cleanly and both rows reach the outbox', async () => {
    const t = await setup();
    await t.expense(500); // float 100.00 - 5.00
    const p = await previewClose(t.ctx, t.s.shiftId, t.count(9500));
    expect(p).toMatchObject({
      ok: true,
      preview: { expected: 9500, counted: 9500, variance: 0, needsApproval: false },
    });
    const r = await closeShift(t.ctx, { shiftId: t.s.shiftId, counted: t.count(9500) });
    expect(r.ok).toBe(true);
    const shift = (await t.ctx.db.shifts.get(t.s.shiftId))!;
    expect(shift).toMatchObject({ status: 'closed', variance: 0, expectedTotal: 9500, countedTotal: 9500 });
    expect((await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'shifts')).toHaveLength(2);
    expect(await closeShift(t.ctx, { shiftId: t.s.shiftId, counted: t.count(9500) })).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('expected = float + sales − expense − transfer to the safe', async () => {
    const t = await setup();
    await postSale(t.ctx, {
      lines: [{ productId: t.s.products[0]!.id, qtyMilli: 1000, unitPrice: 1000 }],
      payments: [{ method: 'cash', amount: 1000 }],
      warehouseId: t.s.warehouseId,
      shiftId: t.s.shiftId,
      cashAccountId: t.drawer.id,
    } as never);
    await t.expense(500);
    const tr = await postCashTransfer(t.ctx, {
      fromAccountId: t.drawer.id,
      toAccountId: t.safe.id,
      amount: 2000,
      shiftId: t.s.shiftId,
    });
    expect(tr.ok).toBe(true);
    expect(await drawerBalance(t.ctx.db, t.s.shiftId)).toBe(10000 + 1000 - 500 - 2000);
    const p = await previewClose(t.ctx, t.s.shiftId, t.count(8500));
    expect(p).toMatchObject({ ok: true, preview: { expected: 8500, variance: 0 } });
    // the safe row of the transfer carries the shift id but is not drawer cash
    const safeRows = (await t.ctx.db.cashMovements.toArray()).filter((m) => m.cashAccountId === t.safe.id);
    expect(safeRows.map((m) => m.amount)).toEqual([2000]);
  });

  it('a shortage above 20.00 needs a note and the manager PIN; a small one does not', async () => {
    const t = await setup();
    const small = await previewClose(t.ctx, t.s.shiftId, t.count(9000));
    expect(small).toMatchObject({ ok: true, preview: { variance: -1000, needsApproval: false } });
    const big = await previewClose(t.ctx, t.s.shiftId, t.count(7000));
    expect(big).toMatchObject({ ok: true, preview: { variance: -3000, needsApproval: true } });
    expect(await closeShift(t.ctx, { shiftId: t.s.shiftId, counted: t.count(7000) })).toMatchObject({
      ok: false,
      code: 'NOTE_REQUIRED',
    });
    expect(
      await closeShift(t.ctx, { shiftId: t.s.shiftId, counted: t.count(7000), note: 'نقص' }),
    ).toMatchObject({ ok: false, code: 'APPROVAL_REQUIRED' });
    const a = await approveWithPin(t.ctx, t.manager.id, PIN, 'shiftVarianceApprove');
    if (!a.ok) throw new Error(a.code);
    const r = await closeShift(t.ctx, {
      shiftId: t.s.shiftId,
      counted: t.count(7000),
      note: 'نقص',
      approvalToken: a.value.token,
    });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.shifts.get(t.s.shiftId))?.approvedBy).toBe(t.manager.id);
  });

  it('a manager closing his own shift only needs the note', async () => {
    const t = await setup('manager');
    expect(await closeShift(t.ctx, { shiftId: t.s.shiftId, counted: t.count(7000) })).toMatchObject({
      ok: false,
      code: 'NOTE_REQUIRED',
    });
    expect((await closeShift(t.ctx, { shiftId: t.s.shiftId, counted: t.count(7000), note: 'نقص' })).ok).toBe(
      true,
    );
  });
});

describe('expense and transfer', () => {
  it('an expense lowers the drawer; more than the drawer holds is refused', async () => {
    const t = await setup();
    expect((await t.expense(2500)).ok).toBe(true);
    expect(await drawerBalance(t.ctx.db, t.s.shiftId)).toBe(7500);
    expect(await t.expense(7501)).toMatchObject({ ok: false, code: 'DRAWER_SHORT' });
  });

  it('a cashier cannot spend from the safe or move cash anywhere but to the safe', async () => {
    const t = await setup();
    expect(
      await postExpense(t.ctx, { categoryId: t.category.id, amount: 100, cashAccountId: t.safe.id }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(
      await postCashTransfer(t.ctx, { fromAccountId: t.safe.id, toAccountId: t.drawer.id, amount: 100 }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    const m = await setup('manager');
    expect(
      (await postCashTransfer(m.ctx, { fromAccountId: m.safe.id, toAccountId: m.drawer.id, amount: 100 })).ok,
    ).toBe(true);
  });

  it('only the manager manages expense categories', async () => {
    const t = await setup();
    expect(await saveExpenseCategory(t.ctx, { name: 'إيجار' })).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
    const m = await setup('manager');
    expect((await saveExpenseCategory(m.ctx, { name: 'إيجار' })).ok).toBe(true);
    expect((await m.ctx.db.expenseCategories.toArray()).some((c) => c.name === 'إيجار')).toBe(true);
  });
});

describe('cash adjustment voucher (FIN-11)', () => {
  it('only the manager; the safe moves by exactly the voucher amount', async () => {
    const c = await setup();
    expect(
      await postCashAdjustment(c.ctx, { cashAccountId: c.safe.id, amount: -500, reason: 'count_error' }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    const m = await setup('manager');
    const r = await postCashAdjustment(m.ctx, {
      cashAccountId: m.safe.id,
      amount: -500,
      reason: 'count_error',
    });
    expect(r).toMatchObject({ ok: true });
    const rows = (await m.ctx.db.cashMovements.toArray()).filter((x) => x.docType === 'cash_adjustment');
    expect(rows.map((x) => x.amount)).toEqual([-500]);
    expect((await m.ctx.db.outbox.toArray()).some((o) => o.table === 'cashAdjustments')).toBe(true);
  });

  it('"other" needs a note; zero is refused; a drawer with an open shift counts the voucher in that shift', async () => {
    const m = await setup('manager');
    expect(
      await postCashAdjustment(m.ctx, { cashAccountId: m.safe.id, amount: 100, reason: 'other' }),
    ).toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
    expect(
      await postCashAdjustment(m.ctx, { cashAccountId: m.safe.id, amount: 0, reason: 'entry_fix' }),
    ).toMatchObject({ ok: false, code: 'E_VALIDATION' });
    await postCashAdjustment(m.ctx, { cashAccountId: m.drawer.id, amount: -300, reason: 'old_difference' });
    expect(await drawerBalance(m.ctx.db, m.s.shiftId)).toBe(10000 - 300);
  });
});
