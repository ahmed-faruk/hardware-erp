import { z } from 'zod';

import { err, type Err } from '@/domain/result';
import { payrollState, type PayrollEntry } from '@/domain/payroll';

import { canCtx, newCommon, type DeviceContext } from './context';
import { nowIso, uuidv7 } from '../ids';
import { nextNumber } from '../numbering';
import { enqueue } from '../outbox';
import type { AuditRow, CashMovement } from '../types';

const id = z.string().min(1);
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const audit = (
  ctx: DeviceContext,
  action: string,
  entityId: string,
  after: unknown,
  at: string,
): AuditRow => ({
  ...newCommon(ctx),
  action,
  entity: 'payroll_entries',
  entityId,
  before: null,
  after,
  workerId: ctx.workerId,
  approvedBy: null,
  occurredAt: at,
});

type Posted = { ok: true; id: string; number: string; net?: number } | Err;

/** Every payroll entry of a worker as the rules see it. */
export async function loadPayrollEntries(
  db: DeviceContext['db'],
  employeeId: string,
): Promise<PayrollEntry[]> {
  return (await db.payrollEntries.where('employeeId').equals(employeeId).toArray()).map((r) => ({
    employeeId: r.employeeId as string,
    kind: r.kind as PayrollEntry['kind'],
    month: r.month as string,
    amount: r.amount as number,
    issuedAt: r.issuedAt,
    status: r.status,
    net: (r.net as number | null) ?? null,
    carryOut: (r.carryOut as number | null) ?? null,
  }));
}

const advanceInput = z.object({
  employeeId: id,
  amount: z.number().int().positive(),
  cashAccountId: id,
  month: z.string().regex(MONTH),
  note: z.string().trim().max(200).default(''),
});

/** An advance: the cash leaves a (non-drawer) account now and is taken back from the next salary. */
export async function recordAdvance(ctx: DeviceContext, raw: z.input<typeof advanceInput>): Promise<Posted> {
  const parsed = advanceInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات السلفة غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'managePayroll') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const [employee, account] = await Promise.all([
    db.workers.get(input.employeeId),
    db.cashAccounts.get(input.cashAccountId),
  ]);
  if (!employee || employee.deletedAt) return err('NOT_FOUND', 'عامل غير موجود');
  if (!account || account.deletedAt || account.kind === 'drawer') return err('E_VALIDATION', 'اختار الخزنة');
  const entryId = uuidv7();
  const at = nowIso();
  const movement: CashMovement = {
    ...newCommon(ctx),
    cashAccountId: account.id,
    shiftId: null,
    amount: -input.amount,
    method: 'cash',
    docType: 'payroll',
    docId: entryId,
    occurredAt: at,
  };
  return db.transaction(
    'rw',
    [db.payrollEntries, db.cashMovements, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'ADV');
      const doc = {
        ...newCommon(ctx),
        id: entryId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: input.note || null,
        isLegacy: false,
        legacy: null,
        employeeId: employee.id,
        kind: 'advance',
        month: input.month,
        amount: input.amount,
        cashAccountId: account.id,
        gross: null,
        deductionsTotal: null,
        advancesTotal: null,
        carryIn: null,
        net: null,
        carryOut: null,
      };
      const a = audit(
        ctx,
        'payroll_advance',
        entryId,
        { number, employee: employee.name, amount: input.amount },
        at,
      );
      await db.payrollEntries.add(doc);
      await db.cashMovements.add(movement);
      await db.auditLog.add(a);
      await enqueue(db, 'payrollEntries', { ...doc, cashMovements: [movement] }, ctx.workerId);
      await enqueue(db, 'auditLog', a, ctx.workerId);
      return { ok: true as const, id: entryId, number };
    },
  );
}

const deductionInput = z.object({
  employeeId: id,
  amount: z.number().int().positive(),
  month: z.string().regex(MONTH),
  note: z.string().trim().max(200).default(''),
});

/** A deduction (penalty, absence...): no cash moves, it comes off that month's salary. */
export async function recordDeduction(
  ctx: DeviceContext,
  raw: z.input<typeof deductionInput>,
): Promise<Posted> {
  const parsed = deductionInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات الخصم غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'managePayroll') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const employee = await db.workers.get(input.employeeId);
  if (!employee || employee.deletedAt) return err('NOT_FOUND', 'عامل غير موجود');
  const state = payrollState(
    await loadPayrollEntries(db, employee.id),
    employee.id,
    employee.monthlySalary ?? 0,
    input.month,
  );
  if (state.paid) return err('MONTH_PAID', 'الشهر ده اتصرف مرتبه');
  const entryId = uuidv7();
  const at = nowIso();
  return db.transaction(
    'rw',
    [db.payrollEntries, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'DED');
      const doc = {
        ...newCommon(ctx),
        id: entryId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: input.note || null,
        isLegacy: false,
        legacy: null,
        employeeId: employee.id,
        kind: 'deduction',
        month: input.month,
        amount: input.amount,
        cashAccountId: null,
        gross: null,
        deductionsTotal: null,
        advancesTotal: null,
        carryIn: null,
        net: null,
        carryOut: null,
      };
      const a = audit(
        ctx,
        'payroll_deduction',
        entryId,
        { number, employee: employee.name, amount: input.amount },
        at,
      );
      await db.payrollEntries.add(doc);
      await db.auditLog.add(a);
      await enqueue(db, 'payrollEntries', doc, ctx.workerId);
      await enqueue(db, 'auditLog', a, ctx.workerId);
      return { ok: true as const, id: entryId, number };
    },
  );
}

const salaryInput = z.object({
  employeeId: id,
  month: z.string().regex(MONTH),
  cashAccountId: id,
});

/** Pays the monthly salary: every advance since the last salary and the month's deductions come off, the rest carries over. */
export async function paySalary(ctx: DeviceContext, raw: z.input<typeof salaryInput>): Promise<Posted> {
  const parsed = salaryInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات المرتب غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'managePayroll') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const [employee, account] = await Promise.all([
    db.workers.get(input.employeeId),
    db.cashAccounts.get(input.cashAccountId),
  ]);
  if (!employee || employee.deletedAt) return err('NOT_FOUND', 'عامل غير موجود');
  if (employee.monthlySalary == null) return err('NO_SALARY', 'العامل ملوش مرتب شهري');
  if (!account || account.deletedAt || account.kind === 'drawer') return err('E_VALIDATION', 'اختار الخزنة');
  const state = payrollState(
    await loadPayrollEntries(db, employee.id),
    employee.id,
    employee.monthlySalary,
    input.month,
  );
  if (state.paid) return err('MONTH_PAID', 'المرتب اتصرف قبل كده للشهر ده');
  const slip = state.slip;
  const entryId = uuidv7();
  const at = nowIso();
  const movement: CashMovement | null =
    slip.net > 0
      ? {
          ...newCommon(ctx),
          cashAccountId: account.id,
          shiftId: null,
          amount: -slip.net,
          method: 'cash',
          docType: 'payroll',
          docId: entryId,
          occurredAt: at,
        }
      : null;
  return db.transaction(
    'rw',
    [db.payrollEntries, db.cashMovements, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'SAL');
      const doc = {
        ...newCommon(ctx),
        id: entryId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        employeeId: employee.id,
        kind: 'salary',
        month: input.month,
        amount: slip.net,
        cashAccountId: movement ? account.id : null,
        gross: slip.gross,
        deductionsTotal: slip.deductionsTotal,
        advancesTotal: slip.advancesTotal,
        carryIn: slip.carryIn,
        net: slip.net,
        carryOut: slip.carryOut,
      };
      const a = audit(ctx, 'payroll_salary', entryId, { number, employee: employee.name, ...slip }, at);
      await db.payrollEntries.add(doc);
      if (movement) await db.cashMovements.add(movement);
      await db.auditLog.add(a);
      await enqueue(
        db,
        'payrollEntries',
        { ...doc, cashMovements: movement ? [movement] : [] },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', a, ctx.workerId);
      return { ok: true as const, id: entryId, number, net: slip.net };
    },
  );
}
