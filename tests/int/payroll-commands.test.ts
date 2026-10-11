import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { paySalary, recordAdvance, recordDeduction } from '@/db/commands/payroll';
import type { CashAccount, Worker } from '@/db/types';

import { newDevice } from './helpers';

async function setup(role: DeviceContext['role'] = 'manager', salary: number | null = 300000) {
  const ctx = newDevice('K1', role);
  const safe: CashAccount = { ...newCommon(ctx), name: 'خزنة', kind: 'safe', ownerDeviceId: null };
  const drawer: CashAccount = { ...newCommon(ctx), name: 'درج', kind: 'drawer', ownerDeviceId: ctx.deviceId };
  await ctx.db.cashAccounts.bulkPut([safe, drawer]);
  const employee: Worker = {
    ...newCommon(ctx),
    name: 'علاء',
    role: 'cashier',
    pinHash: null,
    pinSalt: null,
    photoPath: null,
    active: true,
    legacyEmployeeId: null,
    monthlySalary: salary,
  };
  await ctx.db.workers.put(employee);
  const cash = async () =>
    (await ctx.db.cashMovements.toArray())
      .filter((m) => m.cashAccountId === safe.id)
      .reduce((a, m) => a + m.amount, 0);
  return { ctx, safe, drawer, employee, cash };
}

describe('payroll commands', () => {
  it('an advance takes cash out of the safe now; a deduction moves no cash', async () => {
    const t = await setup();
    const a = await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 50000,
      cashAccountId: t.safe.id,
      month: '2026-10',
    });
    expect(a).toMatchObject({ ok: true });
    if (a.ok) expect(a.number).toBe('K1-ADV-000001');
    expect(await t.cash()).toBe(-50000);
    const d = await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 10000, month: '2026-10' });
    expect(d).toMatchObject({ ok: true });
    expect(await t.cash()).toBe(-50000);
    expect((await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'payrollEntries')).toHaveLength(2);
  });

  it('the salary subtracts the advances and the deductions by itself: 3000 - 500 - 100 = 2400 out of the safe', async () => {
    const t = await setup();
    await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 50000,
      cashAccountId: t.safe.id,
      month: '2026-10',
    });
    await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 10000, month: '2026-10' });
    const s = await paySalary(t.ctx, {
      employeeId: t.employee.id,
      month: '2026-10',
      cashAccountId: t.safe.id,
    });
    expect(s).toMatchObject({ ok: true, net: 240000 });
    expect(await t.cash()).toBe(-50000 - 240000);
    const row = (await t.ctx.db.payrollEntries.toArray()).find((r) => r.kind === 'salary')!;
    expect(row).toMatchObject({
      gross: 300000,
      advancesTotal: 50000,
      deductionsTotal: 10000,
      net: 240000,
      carryOut: 0,
    });
  });

  it('a salary that cannot cover the advances pays nothing and carries the rest to the next month', async () => {
    const t = await setup();
    await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 350000,
      cashAccountId: t.safe.id,
      month: '2026-11',
    });
    const s = await paySalary(t.ctx, {
      employeeId: t.employee.id,
      month: '2026-11',
      cashAccountId: t.safe.id,
    });
    expect(s).toMatchObject({ ok: true, net: 0 });
    expect(await t.cash()).toBe(-350000); // no cash for the salary itself
    const dec = await paySalary(t.ctx, {
      employeeId: t.employee.id,
      month: '2026-12',
      cashAccountId: t.safe.id,
    });
    expect(dec).toMatchObject({ ok: true, net: 250000 }); // 3000 - the 500 that carried
    expect(await t.cash()).toBe(-350000 - 250000);
  });

  it('refuses a second salary for the same month, a deduction for a paid month and a drawer as the source', async () => {
    const t = await setup();
    await paySalary(t.ctx, { employeeId: t.employee.id, month: '2026-10', cashAccountId: t.safe.id });
    expect(
      await paySalary(t.ctx, { employeeId: t.employee.id, month: '2026-10', cashAccountId: t.safe.id }),
    ).toMatchObject({ ok: false, code: 'MONTH_PAID' });
    expect(
      await recordDeduction(t.ctx, { employeeId: t.employee.id, amount: 100, month: '2026-10' }),
    ).toMatchObject({ ok: false, code: 'MONTH_PAID' });
    expect(
      await recordAdvance(t.ctx, {
        employeeId: t.employee.id,
        amount: 100,
        cashAccountId: t.drawer.id,
        month: '2026-11',
      }),
    ).toMatchObject({ ok: false, code: 'E_VALIDATION' });
  });

  it('needs a monthly salary and the managePayroll right', async () => {
    const none = await setup('manager', null);
    expect(
      await paySalary(none.ctx, {
        employeeId: none.employee.id,
        month: '2026-10',
        cashAccountId: none.safe.id,
      }),
    ).toMatchObject({ ok: false, code: 'NO_SALARY' });
    const cashier = await setup('cashier');
    expect(
      await recordAdvance(cashier.ctx, {
        employeeId: cashier.employee.id,
        amount: 100,
        cashAccountId: cashier.safe.id,
        month: '2026-10',
      }),
    ).toMatchObject({ ok: false, code: 'E_FORBIDDEN' });
    expect(await cashier.ctx.db.payrollEntries.count()).toBe(0);
  });
});
