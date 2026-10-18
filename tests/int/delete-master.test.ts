import 'fake-indexeddb/auto';

import { describe, expect, it } from 'vitest';

import { newCommon, type DeviceContext } from '@/db/commands/context';
import { deleteBlock, deleteMaster } from '@/db/commands/delete-master';
import { paySalary, recordAdvance } from '@/db/commands/payroll';
import type { CashAccount, Customer, Supplier, Worker } from '@/db/types';

import { newDevice } from './helpers';

async function setup(role: DeviceContext['role'] = 'manager') {
  const ctx = newDevice('K1', role);
  const customer: Customer = {
    ...newCommon(ctx),
    name: 'عميل',
    phone: null,
    address: null,
    company: null,
    notes: null,
    creditLimit: 0,
    defaultDiscountBp: 0,
    photoPath: null,
    active: true,
    legacyPersonId: null,
  };
  const supplier: Supplier = {
    ...newCommon(ctx),
    name: 'مورد',
    contactName: null,
    phone: null,
    address: null,
    notes: null,
    isExpenseSupplier: false,
    active: true,
    legacyPersonId: null,
  };
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
  const safe: CashAccount = { ...newCommon(ctx), name: 'خزنة', kind: 'safe', ownerDeviceId: null };
  await ctx.db.customers.put(customer);
  await ctx.db.suppliers.put(supplier);
  await ctx.db.workers.put(employee);
  await ctx.db.cashAccounts.put(safe);
  return { ctx, customer, supplier, employee, safe };
}

describe('delete a customer, a supplier or a worker', () => {
  it('a customer at balance 0 is soft-deleted, queued and audited', async () => {
    const t = await setup();
    expect(await deleteMaster(t.ctx, 'customer', t.customer.id)).toEqual({ ok: true });
    expect((await t.ctx.db.customers.get(t.customer.id))?.deletedAt).toBeTruthy();
    const out = (await t.ctx.db.outbox.toArray()).filter((o) => o.table === 'customers');
    expect(out).toHaveLength(1);
    expect(out[0]!.changedFields).toEqual(['deletedAt']);
    expect((await t.ctx.db.auditLog.toArray()).map((a) => a.action)).toContain('customer.delete');
  });

  it('a customer with a balance is refused and stays', async () => {
    const t = await setup();
    await t.ctx.db.partyBalances.put({ partyType: 'customer', partyId: t.customer.id, amount: 5000 });
    expect(await deleteBlock(t.ctx, 'customer', t.customer.id)).toMatchObject({ code: 'HAS_BALANCE' });
    expect(await deleteMaster(t.ctx, 'customer', t.customer.id)).toMatchObject({
      ok: false,
      code: 'HAS_BALANCE',
    });
    expect((await t.ctx.db.customers.get(t.customer.id))?.deletedAt).toBeNull();
  });

  it('a supplier: deleted at 0, refused with a balance', async () => {
    const t = await setup();
    await t.ctx.db.partyBalances.put({ partyType: 'supplier', partyId: t.supplier.id, amount: -3000 });
    expect(await deleteMaster(t.ctx, 'supplier', t.supplier.id)).toMatchObject({
      ok: false,
      code: 'HAS_BALANCE',
    });
    await t.ctx.db.partyBalances.put({ partyType: 'supplier', partyId: t.supplier.id, amount: 0 });
    expect(await deleteMaster(t.ctx, 'supplier', t.supplier.id)).toEqual({ ok: true });
    expect((await t.ctx.db.suppliers.get(t.supplier.id))?.deletedAt).toBeTruthy();
  });

  it('a worker: never yourself, not while an advance is owed, yes once a salary took it', async () => {
    const t = await setup();
    expect(await deleteBlock(t.ctx, 'worker', t.ctx.workerId)).toMatchObject({ code: 'SELF' });
    const adv = await recordAdvance(t.ctx, {
      employeeId: t.employee.id,
      amount: 50000,
      cashAccountId: t.safe.id,
      month: '2026-10',
    });
    expect(adv.ok).toBe(true);
    expect(await deleteMaster(t.ctx, 'worker', t.employee.id)).toMatchObject({
      ok: false,
      code: 'HAS_ADVANCE',
    });
    const sal = await paySalary(t.ctx, {
      employeeId: t.employee.id,
      month: '2026-10',
      cashAccountId: t.safe.id,
    });
    expect(sal.ok).toBe(true);
    expect(await deleteMaster(t.ctx, 'worker', t.employee.id)).toEqual({ ok: true });
    expect((await t.ctx.db.workers.get(t.employee.id))?.deletedAt).toBeTruthy();
  });

  it('a cashier cannot delete', async () => {
    const t = await setup('cashier');
    expect(await deleteMaster(t.ctx, 'customer', t.customer.id)).toMatchObject({
      ok: false,
      code: 'E_FORBIDDEN',
    });
  });
});
