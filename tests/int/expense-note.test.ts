import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { postExpense } from '@/db/commands/cash';
import { newCommon } from '@/db/commands/context';
import { openShift } from '@/db/commands/open-shift';
import { editExpense } from '@/db/commands/void-docs';
import type { CashAccount, ExpenseCategory } from '@/db/types';

import { newDevice } from './helpers';

async function setup() {
  const ctx = newDevice('K1', 'manager');
  const safe: CashAccount = { ...newCommon(ctx), name: 'box', kind: 'safe', ownerDeviceId: null };
  const category: ExpenseCategory = { ...newCommon(ctx), name: 'shop', icon: null };
  await ctx.db.cashAccounts.put(safe);
  await ctx.db.expenseCategories.put(category);
  // an edit puts the old expense's cash back into the shift open now
  const shift = await openShift(ctx, { cashAccountId: safe.id, openingFloat: 0 });
  if (!shift.ok) throw new Error(shift.code);
  return { ctx, safe, category };
}

describe('a note on an expense', () => {
  it('is saved trimmed; an empty note is stored as none', async () => {
    const t = await setup();
    const a = await postExpense(t.ctx, {
      categoryId: t.category.id,
      amount: 500,
      cashAccountId: t.safe.id,
      note: '  electricity  ',
    });
    const b = await postExpense(t.ctx, { categoryId: t.category.id, amount: 300, cashAccountId: t.safe.id });
    if (!a.ok || !b.ok) throw new Error('setup');
    expect((await t.ctx.db.expenses.get(a.id))?.notes).toBe('electricity');
    expect((await t.ctx.db.expenses.get(b.id))?.notes).toBeNull();
    const out = (await t.ctx.db.outbox.toArray()).find((o) => o.id === a.id);
    expect(out!.payload).toMatchObject({ notes: 'electricity' });
  });

  it('an edit keeps the old note unless a new one is given', async () => {
    const t = await setup();
    const a = await postExpense(t.ctx, {
      categoryId: t.category.id,
      amount: 500,
      cashAccountId: t.safe.id,
      note: 'tea',
    });
    if (!a.ok) throw new Error('setup');
    const kept = await editExpense(t.ctx, { expenseId: a.id, categoryId: t.category.id, amount: 600 });
    if (!kept.ok) throw new Error(kept.code);
    expect((await t.ctx.db.expenses.get(kept.id))?.notes).toBe('tea');
    const changed = await editExpense(t.ctx, {
      expenseId: kept.id,
      categoryId: t.category.id,
      amount: 600,
      note: 'tea and sugar',
    });
    if (!changed.ok) throw new Error(changed.code);
    expect((await t.ctx.db.expenses.get(changed.id))?.notes).toBe('tea and sugar');
  });
});
