import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { openShift } from '@/db/commands/open-shift';
import { loadPayrollEntries, paySalary, recordAdvance, recordDeduction } from '@/db/commands/payroll';
import { editPayrollEntry, voidPayrollEntry } from '@/db/commands/void-docs';
import { payrollState } from '@/domain/payroll';
import type { CashAccount, Worker } from '@/db/types';

import { newDevice } from './helpers';

async function setup(role: DeviceContext['role'] = 'manager') {
  const ctx = newDevice('K1', role);
  const safe: CashAccount = { ...newCommon(ctx), name: 'الخزنة', kind: 'safe', ownerDeviceId: null };
  await ctx.db.cashAccounts.put(safe);
  const employee: Worker = {
    ...newCommon(ctx),
    name: 'علاء',
    role: 'cashier',
    pinHash: null,
    pinSalt: null,
    photoPath: null,
    active: true,
    legacyEmployeeId: null,
    monthlySalary: 300000,
  };
  await ctx.db.workers.put(employee);
  const s = await openShift(ctx, { cashAccountId: safe.id, openingFloat: 0 });
  if (!s.ok) throw new Error(s.code);
  const cash = async () =>
    (await ctx.db.cashMovements.toArray())
      .filter((m) => m.cashAccountId === safe.id)
      .reduce((a, m) => a + m.amount, 0);
  const state = async (month: string) =>
    payrollState(await loadPayrollEntries(ctx.db, employee.id), employee.id, 300000, month);
  return { ctx, safe, employee, shiftId: s.id, cash, state };
}

describe('delete and edit an advance or a deduction', () => {
  it('a deleted advance puts its cash back into the open shift; it no longer counts', async () => {
    const t = await setup();
    const before = await t.cash();
    const a = await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 50000,
      cashAccountId: t.safe.id,
      month: '2026-10',
    });
    if (!a.ok) throw new Error(a.code);
    const r = await voidPayrollEntry(t.ctx, { entryId: a.id, reason: 'mistake' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await t.ctx.db.payrollEntries.get(a.id))?.status).toBe('voided');
    expect(await t.cash()).toBe(before);
    const back = (await t.ctx.db.cashMovements.toArray()).filter((m) => m.docId === r.id);
    expect(back[0]).toMatchObject({ amount: 50000, docType: 'void', shiftId: t.shiftId });
    expect((await t.state('2026-10')).advances).toBe(0);
  });

  it('a deleted deduction moves no cash and no longer counts', async () => {
    const t = await setup();
    const d = await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 10000, month: '2026-10' });
    if (!d.ok) throw new Error(d.code);
    const r = await voidPayrollEntry(t.ctx, { entryId: d.id, reason: 'mistake' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((await t.ctx.db.cashMovements.toArray()).filter((m) => m.docId === r.id)).toHaveLength(0);
    expect((await t.state('2026-10')).deductions).toBe(0);
  });

  it('after the salary: the deduction of the month and the advance it took are locked', async () => {
    const t = await setup();
    const a = await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 50000,
      cashAccountId: t.safe.id,
      month: '2026-10',
    });
    const d = await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 10000, month: '2026-10' });
    if (!a.ok || !d.ok) throw new Error('setup');
    await new Promise((r) => setTimeout(r, 5));
    const s = await paySalary(t.ctx, {
      employeeId: t.employee.id,
      month: '2026-10',
      cashAccountId: t.safe.id,
    });
    expect(s.ok).toBe(true);
    expect(await voidPayrollEntry(t.ctx, { entryId: d.id, reason: 'mistake' })).toMatchObject({
      code: 'MONTH_PAID',
    });
    expect(await voidPayrollEntry(t.ctx, { entryId: a.id, reason: 'mistake' })).toMatchObject({
      code: 'ADVANCE_TAKEN',
    });
    expect(await editPayrollEntry(t.ctx, { entryId: d.id, amount: 5000, note: '' })).toMatchObject({
      code: 'MONTH_PAID',
    });
    expect(await t.ctx.db.voids.count()).toBe(0);
  });

  it('an edit voids the old advance and records the new amount on the same month and account', async () => {
    const t = await setup();
    const before = await t.cash();
    const a = await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 50000,
      cashAccountId: t.safe.id,
      month: '2026-10',
    });
    if (!a.ok) throw new Error(a.code);
    const r = await editPayrollEntry(t.ctx, { entryId: a.id, amount: 70000, note: 'تصحيح' });
    expect(r.ok).toBe(true);
    expect((await t.ctx.db.payrollEntries.get(a.id))?.status).toBe('voided');
    const posted = (await t.ctx.db.payrollEntries.toArray()).filter((x) => x.status === 'posted');
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      kind: 'advance',
      amount: 70000,
      month: '2026-10',
      cashAccountId: t.safe.id,
    });
    expect(await t.cash()).toBe(before - 70000);
  });

  it('a failed edit changes nothing (rollback)', async () => {
    const t = await setup();
    const d = await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 10000, month: '2026-10' });
    if (!d.ok) throw new Error(d.code);
    expect((await editPayrollEntry(t.ctx, { entryId: d.id, amount: 0, note: '' })).ok).toBe(false);
    expect((await t.ctx.db.payrollEntries.get(d.id))?.status).toBe('posted');
    expect(await t.ctx.db.voids.count()).toBe(0);
  });

  it('a cashier can neither delete nor edit', async () => {
    const t = await setup('manager');
    const d = await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 10000, month: '2026-10' });
    if (!d.ok) throw new Error(d.code);
    const cashier = { ...t.ctx, role: 'cashier' as const };
    expect(await voidPayrollEntry(cashier, { entryId: d.id, reason: 'mistake' })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
    expect(await editPayrollEntry(cashier, { entryId: d.id, amount: 1, note: '' })).toMatchObject({
      code: 'E_FORBIDDEN',
    });
  });
});
