import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { postExpense } from '@/db/commands/cash';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { openShift } from '@/db/commands/open-shift';
import { editExpense, voidExpense } from '@/db/commands/void-docs';
import type { CashAccount, ExpenseCategory } from '@/db/types';

import { newDevice } from './helpers';

async function setup(role: DeviceContext['role'] = 'manager', withShift = true) {
  const ctx = newDevice('K1', role);
  const safe: CashAccount = { ...newCommon(ctx), name: 'الخزنة', kind: 'safe', ownerDeviceId: null };
  const category: ExpenseCategory = { ...newCommon(ctx), name: 'مصروفات محل', icon: null };
  await ctx.db.cashAccounts.put(safe);
  await ctx.db.expenseCategories.put(category);
  let shiftId: string | null = null;
  if (withShift) {
    const s = await openShift(ctx, { cashAccountId: safe.id, openingFloat: 10000 });
    if (!s.ok) throw new Error(s.code);
    shiftId = s.id;
  }
  const cash = async () =>
    (await ctx.db.cashMovements.toArray())
      .filter((m) => m.cashAccountId === safe.id)
      .reduce((a, m) => a + m.amount, 0);
  const spend = async (amount: number) => {
    const r = await postExpense(ctx, { categoryId: category.id, amount, cashAccountId: safe.id });
    if (!r.ok) throw new Error(r.code);
    return r;
  };
  return { ctx, safe, category, shiftId, cash, spend };
}

describe('delete and edit an expense', () => {
  it('a deleted expense puts its cash back into the box of the open shift and is marked voided', async () => {
    const t = await setup();
    const before = await t.cash();
    const e = await t.spend(500);
    const r = await voidExpense(t.ctx, { expenseId: e.id, reason: 'mistake' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const expense = await t.ctx.db.expenses.get(e.id);
    expect(expense?.status).toBe('voided');
    expect(expense?.voidedBy).toBe(r.id);
    const voids = await t.ctx.db.voids.toArray();
    expect(voids).toHaveLength(1);
    expect(voids[0]!.targetType).toBe('expense');
    const back = (await t.ctx.db.cashMovements.toArray()).filter((m) => m.docId === r.id);
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ amount: 500, docType: 'void', shiftId: t.shiftId });
    expect(await t.cash()).toBe(before);
    const out = (await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'voids');
    expect(out).toHaveLength(1);
    expect((out[0]!.payload.cashMovements as unknown[]).length).toBe(1);
    expect(await voidExpense(t.ctx, { expenseId: e.id, reason: 'mistake' })).toMatchObject({
      ok: false,
      code: 'ALREADY_VOIDED',
    });
  });

  it('without an open shift nothing is written', async () => {
    const t = await setup('manager', false);
    const e = await t.spend(500);
    expect(await voidExpense(t.ctx, { expenseId: e.id, reason: 'mistake' })).toMatchObject({
      ok: false,
      code: 'NO_SHIFT',
    });
    expect(await t.ctx.db.voids.count()).toBe(0);
    expect((await t.ctx.db.expenses.get(e.id))?.status).toBe('posted');
  });

  it('an edit voids the old expense and posts the new amount; the void is queued first', async () => {
    const t = await setup();
    const before = await t.cash();
    const e = await t.spend(500);
    const r = await editExpense(t.ctx, { expenseId: e.id, categoryId: t.category.id, amount: 800 });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.expenses.get(e.id))?.status).toBe('voided');
    const posted = (await t.ctx.db.expenses.toArray()).filter((x) => x.status === 'posted');
    expect(posted.map((x) => x.amount)).toEqual([800]);
    expect(await t.cash()).toBe(before - 800);
    const tables = (await t.ctx.db.outbox.toArray())
      .sort((a, b) => a.deviceSeq - b.deviceSeq)
      .map((o) => o.table);
    expect(tables.indexOf('voids')).toBeLessThan(tables.lastIndexOf('expenses'));
  });

  it('a failed edit changes nothing (rollback)', async () => {
    const t = await setup();
    const before = await t.cash();
    const e = await t.spend(500);
    const r = await editExpense(t.ctx, { expenseId: e.id, categoryId: 'no-such-type', amount: 800 });
    expect(r).toMatchObject({ ok: false, code: 'NOT_FOUND' });
    expect((await t.ctx.db.expenses.get(e.id))?.status).toBe('posted');
    expect(await t.ctx.db.voids.count()).toBe(0);
    expect(await t.cash()).toBe(before - 500);
  });

  it('a cashier can neither delete nor edit', async () => {
    const t = await setup('cashier');
    const e = await t.spend(500);
    expect(await voidExpense(t.ctx, { expenseId: e.id, reason: 'mistake' })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
    expect(await editExpense(t.ctx, { expenseId: e.id, categoryId: t.category.id, amount: 1 })).toMatchObject(
      {
        code: 'E_FORBIDDEN',
      },
    );
  });
});
