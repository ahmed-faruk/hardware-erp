import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { postExpense } from '@/db/commands/cash';
import { newCommon, type DeviceContext } from '@/db/commands/context';
import { savePermissionGroup, saveWorker } from '@/db/commands/save-master';
import { groupPermissions, workerAccess } from '@/db/permissions';
import type { CashAccount, ExpenseCategory, Worker } from '@/db/types';

import { newDevice } from './helpers';

async function setup(
  permissions: DeviceContext['permissions'] = null,
  role: DeviceContext['role'] = 'cashier',
) {
  const ctx: DeviceContext = { ...newDevice('K1', role), permissions };
  const account: CashAccount = {
    ...newCommon(ctx),
    name: 'درج',
    kind: 'drawer',
    ownerDeviceId: ctx.deviceId,
  };
  const category: ExpenseCategory = { ...newCommon(ctx), name: 'نثريات', icon: null };
  await ctx.db.cashAccounts.put(account);
  await ctx.db.expenseCategories.put(category);
  return { ctx, account, category };
}

describe('permission groups on the device', () => {
  it('a command refuses what the worker group says no to, even when his role would allow it', async () => {
    const { ctx, account, category } = await setup({ sell: 'yes' }); // a cashier whose group has no expense right
    const r = await postExpense(ctx, { categoryId: category.id, amount: 500, cashAccountId: account.id });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('E_FORBIDDEN');
  });

  it('a group can give a cashier a right his role does not have', async () => {
    const { ctx, account, category } = await setup({ recordExpense: 'yes' });
    const r = await postExpense(ctx, { categoryId: category.id, amount: 500, cashAccountId: account.id });
    expect(r.ok).toBe(true);
  });

  it('without a group the role defaults apply (cashier may record an expense)', async () => {
    const { ctx, account, category } = await setup(null);
    const r = await postExpense(ctx, { categoryId: category.id, amount: 500, cashAccountId: account.id });
    expect(r.ok).toBe(true);
  });

  it('a manager creates a group, a cashier cannot', async () => {
    const m = await setup(null, 'manager');
    const made = await savePermissionGroup(m.ctx, {
      fields: { name: 'محاسب', permissions: { 'view.reports': 'yes' } },
    });
    expect(made.ok).toBe(true);
    expect(await m.ctx.db.permissionGroups.count()).toBe(1);
    expect((await m.ctx.db.outbox.toArray()).some((o) => o.table === 'permissionGroups')).toBe(true);
    const c = await setup(null, 'cashier');
    const denied = await savePermissionGroup(c.ctx, { fields: { name: 'x', permissions: {} } });
    expect(denied.ok).toBe(false);
  });

  it('a bad access value is refused', async () => {
    const m = await setup(null, 'manager');
    const r = await savePermissionGroup(m.ctx, { fields: { name: 'x', permissions: { sell: 'maybe' } } });
    expect(r.ok).toBe(false);
  });

  it('a worker is put in a group and workerAccess follows the group, then the role when the group is deleted', async () => {
    const m = await setup(null, 'manager');
    const g = await savePermissionGroup(m.ctx, { fields: { name: 'مخازن', permissions: { void: 'yes' } } });
    if (!g.ok) throw new Error('group not saved');
    const w = await saveWorker(m.ctx, {
      fields: { name: 'كاشير', role: 'cashier', groupId: g.id },
    });
    if (!w.ok) throw new Error('worker not saved');
    const worker = (await m.ctx.db.workers.get(w.id)) as Worker;
    expect(worker.groupId).toBe(g.id);
    expect(await workerAccess(m.ctx.db, worker, 'void')).toBe('yes');
    expect(await workerAccess(m.ctx.db, worker, 'sell')).toBe('no');
    await savePermissionGroup(m.ctx, { id: g.id, fields: { deletedAt: new Date().toISOString() } });
    expect(await groupPermissions(m.ctx.db, g.id)).toBeNull();
    expect(await workerAccess(m.ctx.db, worker, 'sell')).toBe('yes');
  });

  it('with no approvals, a group that gives a cashier discountOverLimit lets him do it, and only that', async () => {
    const { ctx } = await setup(null, 'cashier');
    const group = { ...newCommon(ctx), name: 'مشرف', permissions: { discountOverLimit: 'yes' as const } };
    await ctx.db.permissionGroups.put(group);
    const supervisor: Worker = {
      ...newCommon(ctx),
      name: 'مشرف',
      role: 'cashier',
      pinHash: null,
      pinSalt: null,
      photoPath: null,
      active: true,
      legacyEmployeeId: null,
      groupId: group.id,
    };
    await ctx.db.workers.put(supervisor);
    expect(await workerAccess(ctx.db, supervisor, 'discountOverLimit')).toBe('yes');
    expect(await workerAccess(ctx.db, supervisor, 'priceOverride')).toBe('no');
  });
});
