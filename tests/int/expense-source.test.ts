import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { postExpense } from '@/db/commands/cash';
import { newCommon } from '@/db/commands/context';
import { editExpense, voidExpense } from '@/db/commands/void-docs';
import type { CashAccount, ExpenseCategory } from '@/db/types';

import { newDevice } from './helpers';

async function setup() {
  const ctx = newDevice('K1', 'manager');
  const safe: CashAccount = { ...newCommon(ctx), name: 'الخزنة', kind: 'safe', ownerDeviceId: null };
  const category: ExpenseCategory = { ...newCommon(ctx), name: 'مصروفات محل', icon: null };
  await ctx.db.cashAccounts.put(safe);
  await ctx.db.expenseCategories.put(category);
  return { ctx, safe, category };
}

describe('an expense from the box or from outside the box', () => {
  it('from the box (the default): one cash movement out of the box, source safe', async () => {
    const t = await setup();
    const r = await postExpense(t.ctx, { categoryId: t.category.id, amount: 500, cashAccountId: t.safe.id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await t.ctx.db.expenses.get(r.id)).toMatchObject({ source: 'safe', cashAccountId: t.safe.id });
    expect((await t.ctx.db.cashMovements.toArray()).map((m) => m.amount)).toEqual([-500]);
  });

  it('from outside the box: no account, no cash movement, and the queued record says so', async () => {
    const t = await setup();
    const r = await postExpense(t.ctx, { categoryId: t.category.id, amount: 700, source: 'owner' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(await t.ctx.db.expenses.get(r.id)).toMatchObject({ source: 'owner', cashAccountId: null });
    expect(await t.ctx.db.cashMovements.count()).toBe(0);
    const out = (await t.ctx.db.outbox.toArray()).find((o) => o.table === 'expenses');
    expect(out!.payload).toMatchObject({ source: 'owner', cashAccountId: null, cashMovements: [] });
  });

  it('an outside expense is deleted without an open shift and edited without becoming a box expense', async () => {
    const t = await setup();
    const a = await postExpense(t.ctx, { categoryId: t.category.id, amount: 700, source: 'owner' });
    const b = await postExpense(t.ctx, { categoryId: t.category.id, amount: 300, source: 'owner' });
    if (!a.ok || !b.ok) throw new Error('setup');
    expect((await voidExpense(t.ctx, { expenseId: a.id, reason: 'mistake' })).ok).toBe(true);
    const e = await editExpense(t.ctx, { expenseId: b.id, categoryId: t.category.id, amount: 400 });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(await t.ctx.db.expenses.get(e.id)).toMatchObject({
      source: 'owner',
      amount: 400,
      cashAccountId: null,
    });
    expect(await t.ctx.db.cashMovements.count()).toBe(0);
  });
});
