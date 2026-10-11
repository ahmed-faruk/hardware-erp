import { z } from 'zod';

import { newCommon, type DeviceContext, canCtx } from './context';
import { drawerBalance, shiftDrawerMovements } from '../cash';
import { nowIso, uuidv7 } from '../ids';
import { nextNumber } from '../numbering';
import { enqueue } from '../outbox';
import { loadSettings } from '../settings';
import { peekApproval, spendApproval } from './approval';
import { upsertRow, type SaveResult } from './save-master';
import type { AuditRow, CashMovement, ExpenseCategory } from '../types';
import { err, type Err } from '@/domain/result';
import { countByDenomination, requiresVarianceApproval, shiftVariance } from '@/domain/shift';

const id = z.string().min(1);

const audit = (
  ctx: DeviceContext,
  action: string,
  entity: string,
  entityId: string,
  after: unknown,
  at: string,
  approvedBy: string | null = null,
): AuditRow => ({
  ...newCommon(ctx),
  action,
  entity,
  entityId,
  before: null,
  after,
  workerId: ctx.workerId,
  approvedBy,
  occurredAt: at,
});

const countedSchema = z.array(
  z.object({ value: z.number().int().positive(), count: z.number().int().nonnegative() }),
);

export interface ClosePreview {
  expected: number;
  counted: number;
  variance: number;
  /** the difference is above the manager's limit: a manager's PIN and a note are needed */
  needsApproval: boolean;
}

/** FIN-02: what the blind count came to against what the drawer should hold. Shown only AFTER the cashier has entered the count. */
export async function previewClose(
  ctx: DeviceContext,
  shiftId: string,
  rawCounted: z.input<typeof countedSchema>,
): Promise<{ ok: true; preview: ClosePreview } | Err> {
  const counted = countedSchema.safeParse(rawCounted);
  if (!counted.success) return err('E_VALIDATION', 'العد غير صحيح');
  const { shift, movements } = await shiftDrawerMovements(ctx.db, shiftId);
  if (!shift || shift.status !== 'open') return err('NOT_FOUND', 'الوردية مش مفتوحة');
  const total = countByDenomination(counted.data);
  const { expected, variance } = shiftVariance({
    countedCash: total,
    openingFloat: shift.openingFloat,
    cashIn: movements.filter((m) => m.amount > 0).reduce((a, m) => a + m.amount, 0),
    cashOut: -movements.filter((m) => m.amount < 0).reduce((a, m) => a + m.amount, 0),
  });
  const limit = (await loadSettings(ctx.db)).shiftVarianceAbove;
  return {
    ok: true,
    preview: { expected, counted: total, variance, needsApproval: requiresVarianceApproval(variance, limit) },
  };
}

/** FIN-02..03: close the shift with the counted notes. Above the limit a manager must approve and a note is required. */
export async function closeShift(
  ctx: DeviceContext,
  input: { shiftId: string; counted: z.input<typeof countedSchema>; note?: string; approvalToken?: string },
): Promise<{ ok: true; shiftId: string; preview: ClosePreview } | Err> {
  if (canCtx(ctx, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  const p = await previewClose(ctx, input.shiftId, input.counted);
  if (!p.ok) return p;
  const { db } = ctx;
  const note = (input.note ?? '').trim();
  let approver: string | null = null;
  if (p.preview.needsApproval) {
    if (!note) return err('NOTE_REQUIRED', 'اكتب تعليق');
    if (canCtx(ctx, 'shiftVarianceApprove') === 'yes') approver = ctx.workerId;
    else {
      const approval = input.approvalToken ? peekApproval(input.approvalToken, 'shiftVarianceApprove') : null;
      if (!input.approvalToken || !approval) return err('APPROVAL_REQUIRED', 'shiftVarianceApprove');
      approver = approval.approvedBy;
      spendApproval(input.approvalToken);
    }
  }
  const at = nowIso();
  return db.transaction('rw', [db.shifts, db.auditLog, db.outbox, db.syncState], async () => {
    const shift = await db.shifts.get(input.shiftId);
    if (!shift || shift.status !== 'open') return err('NOT_FOUND', 'الوردية مش مفتوحة');
    const row = {
      ...shift,
      status: 'closed' as const,
      closedAt: at,
      countedTotal: p.preview.counted,
      countedBreakdown: countedSchema.parse(input.counted).filter((c) => c.count > 0),
      expectedTotal: p.preview.expected,
      variance: p.preview.variance,
      closeNote: note || null,
      approvedBy: approver,
      updatedAt: at,
      version: shift.version + 1,
    };
    await db.shifts.put(row);
    const a = audit(
      ctx,
      'shift_closed',
      'shifts',
      shift.id,
      { number: shift.number, variance: p.preview.variance },
      at,
      approver,
    );
    await db.auditLog.add(a);
    await enqueue(db, 'shifts', row, ctx.workerId);
    await enqueue(db, 'auditLog', a, ctx.workerId);
    return { ok: true as const, shiftId: shift.id, preview: p.preview };
  });
}

const expenseInput = z.object({
  categoryId: id,
  amount: z.number().int().positive(),
  cashAccountId: id,
  shiftId: id.nullable().default(null),
});

/** FIN-07: take cash out of an account for an expense. A cashier uses his own drawer, within what it holds. */
export async function postExpense(
  ctx: DeviceContext,
  raw: z.input<typeof expenseInput>,
): Promise<{ ok: true; id: string; number: string } | Err> {
  const parsed = expenseInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات المصروف غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'recordExpense') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const [category, account] = await Promise.all([
    db.expenseCategories.get(input.categoryId),
    db.cashAccounts.get(input.cashAccountId),
  ]);
  if (!category || category.deletedAt || !account || account.deletedAt)
    return err('NOT_FOUND', 'بيانات ناقصة');
  const ownDrawer = account.kind === 'drawer' && account.ownerDeviceId === ctx.deviceId;
  if (ctx.role !== 'manager' && !ownDrawer) return err('E_FORBIDDEN', 'من درج الجهاز بس');
  if (ownDrawer && input.shiftId && input.amount > (await drawerBalance(db, input.shiftId)))
    return err('DRAWER_SHORT', 'الدرج مفيهوش فلوس كفاية');
  const expenseId = uuidv7();
  const at = nowIso();
  const movement: CashMovement = {
    ...newCommon(ctx),
    cashAccountId: account.id,
    shiftId: input.shiftId,
    amount: -input.amount,
    method: 'cash',
    docType: 'expense',
    docId: expenseId,
    occurredAt: at,
  };
  return db.transaction(
    'rw',
    [db.expenses, db.cashMovements, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'EXP');
      const doc = {
        ...newCommon(ctx),
        id: expenseId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: input.shiftId,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        categoryId: category.id,
        amount: input.amount,
        cashAccountId: account.id,
        supplierId: null,
      };
      const a = audit(
        ctx,
        'expense_posted',
        'expenses',
        expenseId,
        { number, amount: input.amount, category: category.name },
        at,
      );
      await db.expenses.add(doc);
      await db.cashMovements.add(movement);
      await db.auditLog.add(a);
      await enqueue(db, 'expenses', { ...doc, cashMovements: [movement] }, ctx.workerId);
      await enqueue(db, 'auditLog', a, ctx.workerId);
      return { ok: true as const, id: expenseId, number };
    },
  );
}

const transferInput = z.object({
  fromAccountId: id,
  toAccountId: id,
  amount: z.number().int().positive(),
  shiftId: id.nullable().default(null),
});

/** FIN-05: hand cash from the drawer to the main safe (or, for a manager, between any two accounts). */
export async function postCashTransfer(
  ctx: DeviceContext,
  raw: z.input<typeof transferInput>,
): Promise<{ ok: true; id: string; number: string } | Err> {
  const parsed = transferInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات التوريد غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'cashTransfer') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.fromAccountId === input.toAccountId) return err('E_VALIDATION', 'نفس الحساب');
  const { db } = ctx;
  const [from, to] = await Promise.all([
    db.cashAccounts.get(input.fromAccountId),
    db.cashAccounts.get(input.toAccountId),
  ]);
  if (!from || !to || from.deletedAt || to.deletedAt) return err('NOT_FOUND', 'حساب غير موجود');
  const ownDrawer = from.kind === 'drawer' && from.ownerDeviceId === ctx.deviceId;
  if (ctx.role !== 'manager' && !(ownDrawer && to.kind === 'safe'))
    return err('E_FORBIDDEN', 'من الدرج للخزنة بس');
  if (ownDrawer && input.shiftId && input.amount > (await drawerBalance(db, input.shiftId)))
    return err('DRAWER_SHORT', 'الدرج مفيهوش فلوس كفاية');
  const transferId = uuidv7();
  const at = nowIso();
  const rows: CashMovement[] = [
    {
      ...newCommon(ctx),
      cashAccountId: from.id,
      shiftId: input.shiftId,
      amount: -input.amount,
      method: 'cash',
      docType: 'cash_transfer',
      docId: transferId,
      occurredAt: at,
    },
    {
      ...newCommon(ctx),
      cashAccountId: to.id,
      shiftId: input.shiftId,
      amount: input.amount,
      method: 'cash',
      docType: 'cash_transfer',
      docId: transferId,
      occurredAt: at,
    },
  ];
  return db.transaction(
    'rw',
    [db.cashTransfers, db.cashMovements, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'XFR');
      const doc = {
        ...newCommon(ctx),
        id: transferId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: input.shiftId,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        fromAccountId: from.id,
        toAccountId: to.id,
        amount: input.amount,
      };
      const a = audit(
        ctx,
        'cash_transferred',
        'cash_transfers',
        transferId,
        { number, amount: input.amount, from: from.name, to: to.name },
        at,
      );
      await db.cashTransfers.add(doc);
      await db.cashMovements.bulkAdd(rows);
      await db.auditLog.add(a);
      await enqueue(db, 'cashTransfers', { ...doc, cashMovements: rows }, ctx.workerId);
      await enqueue(db, 'auditLog', a, ctx.workerId);
      return { ok: true as const, id: transferId, number };
    },
  );
}

/** Manager: add or rename an expense category (the cashier picks from these as big buttons). */
export async function saveExpenseCategory(
  ctx: DeviceContext,
  input: { id?: string; name: string; icon?: string | null; baseVersion?: number },
): Promise<SaveResult> {
  if (canCtx(ctx, 'settings') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const name = input.name.trim();
  if (!name || name.length > 60) return err('E_VALIDATION', 'الاسم مطلوب');
  const { db } = ctx;
  return db.transaction('rw', [db.expenseCategories, db.outbox, db.syncState], async () => {
    const r = await upsertRow<ExpenseCategory>(
      ctx,
      'expenseCategories',
      db.expenseCategories,
      { id: input.id, baseVersion: input.baseVersion, fields: {} },
      { name, icon: input.icon ?? null },
      () => ({ ...newCommon(ctx), name: '', icon: null }),
    );
    return r.ok ? { ok: true as const, id: r.id, version: r.version } : r;
  });
}

export const CASH_ADJUST_REASONS = ['count_error', 'old_difference', 'entry_fix', 'other'] as const;

const adjustInput = z.object({
  cashAccountId: id,
  /** + the cash is more than the books say, − it is less */
  amount: z
    .number()
    .int()
    .refine((n) => n !== 0),
  reason: z.enum(CASH_ADJUST_REASONS),
  note: z.string().trim().max(200).default(''),
});

/** FIN-11: a manager corrects a cash account with a voucher and a reason; there is no way to edit a balance. */
export async function postCashAdjustment(
  ctx: DeviceContext,
  raw: z.input<typeof adjustInput>,
): Promise<{ ok: true; id: string; number: string } | Err> {
  const parsed = adjustInput.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات التسوية غير صحيحة');
  const input = parsed.data;
  if (canCtx(ctx, 'cashAdjustment') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (input.reason === 'other' && !input.note) return err('NOTE_REQUIRED', 'اكتب ملاحظة');
  const { db } = ctx;
  const account = await db.cashAccounts.get(input.cashAccountId);
  if (!account || account.deletedAt) return err('NOT_FOUND', 'حساب غير موجود');
  const openShift =
    account.kind === 'drawer'
      ? ((await db.shifts
          .where('status')
          .equals('open')
          .filter((s) => s.cashAccountId === account.id)
          .first()) ?? null)
      : null;
  const adjId = uuidv7();
  const at = nowIso();
  const movement: CashMovement = {
    ...newCommon(ctx),
    cashAccountId: account.id,
    shiftId: openShift?.id ?? null,
    amount: input.amount,
    method: 'cash',
    docType: 'cash_adjustment',
    docId: adjId,
    occurredAt: at,
  };
  return db.transaction(
    'rw',
    [db.cashAdjustments, db.cashMovements, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'CAJ');
      const doc = {
        ...newCommon(ctx),
        id: adjId,
        number,
        issuedAt: at,
        workerId: ctx.workerId,
        shiftId: openShift?.id ?? null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        cashAccountId: account.id,
        amount: input.amount,
        reasonCode: input.reason,
        note: input.note || null,
      };
      const a = audit(
        ctx,
        'cash_adjusted',
        'cash_adjustments',
        adjId,
        { number, amount: input.amount, reason: input.reason, account: account.name },
        at,
      );
      await db.cashAdjustments.add(doc);
      await db.cashMovements.add(movement);
      await db.auditLog.add(a);
      await enqueue(db, 'cashAdjustments', { ...doc, cashMovements: [movement] }, ctx.workerId);
      await enqueue(db, 'auditLog', a, ctx.workerId);
      return { ok: true as const, id: adjId, number };
    },
  );
}
