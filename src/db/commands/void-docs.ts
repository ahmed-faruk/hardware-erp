import { err, type Err } from '@/domain/result';

import { auditRow } from './audit';
import { postExpense } from './cash';
import { canCtx, newCommon, type DeviceContext } from './context';
import { openShopShift } from '../cash';
import { nowIso, uuidv7 } from '../ids';
import { nextNumber } from '../numbering';
import { enqueue } from '../outbox';
import type { CashMovement, DocRow } from '../types';

export type EditReason = 'mistake' | 'edited';
export type Done = { ok: true; id: string; number: string } | Err;

/** Thrown inside an edit's transaction so the void and the new document are undone together when the second step fails. */
export class Rollback extends Error {
  constructor(readonly result: Err) {
    super(result.code);
  }
}

/**
 * The void of an expense or a payroll entry: its cash rows reversed on the same account inside the shift open now (the owner's
 * rule: the money comes back into the box today), the target marked voided, an audit row; ONE transaction.
 */
export async function writeVoid(
  ctx: DeviceContext,
  target: DocRow,
  targetType: 'expense' | 'payroll_entry',
  reason: EditReason,
): Promise<Done> {
  const { db } = ctx;
  const store = targetType === 'expense' ? db.expenses : db.payrollEntries;
  const cash = await db.cashMovements.where('docId').equals(target.id).toArray();
  const shift = cash.length > 0 ? await openShopShift(db) : null;
  if (cash.length > 0 && !shift) return err('NO_SHIFT', 'افتح وردية الأول');
  const voidId = uuidv7();
  const now = nowIso();
  const cashMovements: CashMovement[] = cash.map((m) => ({
    ...newCommon(ctx),
    cashAccountId: m.cashAccountId,
    shiftId: shift!.id,
    amount: -m.amount,
    method: m.method,
    docType: 'void',
    docId: voidId,
    occurredAt: now,
  }));
  return db.transaction(
    'rw',
    [db.voids, store, db.cashMovements, db.auditLog, db.numberSequences, db.outbox, db.syncState],
    async () => {
      const number = await nextNumber(db, ctx.devicePrefix, 'VOID');
      const doc = {
        ...newCommon(ctx),
        id: voidId,
        number,
        issuedAt: now,
        workerId: ctx.workerId,
        shiftId: shift?.id ?? null,
        status: 'posted' as const,
        voidedBy: null,
        notes: null,
        isLegacy: false,
        legacy: null,
        targetType,
        targetId: target.id,
        reason,
        approvedBy: ctx.workerId,
      };
      const entity = targetType === 'expense' ? 'expenses' : 'payroll_entries';
      const audit = auditRow(ctx, `${targetType}_voided`, entity, target.id, {
        number: target.number,
        reason,
      });
      await db.voids.add(doc);
      await db.cashMovements.bulkAdd(cashMovements);
      await store.update(target.id, { status: 'voided', voidedBy: voidId });
      await db.auditLog.add(audit);
      await enqueue(
        db,
        'voids',
        { ...doc, stockMovements: [], partyLedger: [], cashMovements },
        ctx.workerId,
      );
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true as const, id: voidId, number };
    },
  );
}

/** Deletes an expense (permission voidExpense): the money comes back into the box of the shift open now. */
export async function voidExpense(
  ctx: DeviceContext,
  input: { expenseId: string; reason: EditReason },
): Promise<Done> {
  if (canCtx(ctx, 'voidExpense') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const expense = await ctx.db.expenses.get(input.expenseId);
  if (!expense) return err('NOT_FOUND', 'المصروف مش موجود');
  if (expense.status !== 'posted') return err('ALREADY_VOIDED', 'المصروف محذوف');
  if (expense.isLegacy) return err('LEGACY', 'مصروف قديم');
  return writeVoid(ctx, expense, 'expense', input.reason);
}

/** Edits an expense = void it and post a new one (new type and amount, same account), in ONE transaction. */
export async function editExpense(
  ctx: DeviceContext,
  input: { expenseId: string; categoryId: string; amount: number },
): Promise<Done> {
  if (canCtx(ctx, 'voidExpense') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  const old = await db.expenses.get(input.expenseId);
  if (!old) return err('NOT_FOUND', 'المصروف مش موجود');
  try {
    return await db.transaction(
      'rw',
      [
        db.voids,
        db.expenses,
        db.expenseCategories,
        db.cashAccounts,
        db.cashMovements,
        db.shifts,
        db.auditLog,
        db.numberSequences,
        db.outbox,
        db.syncState,
      ],
      async (): Promise<Done> => {
        const v = await voidExpense(ctx, { expenseId: old.id, reason: 'edited' });
        if (!v.ok) throw new Rollback(v);
        const p = await postExpense(ctx, {
          categoryId: input.categoryId,
          amount: input.amount,
          cashAccountId: old.cashAccountId as string,
        });
        if (!p.ok) throw new Rollback(p);
        return p;
      },
    );
  } catch (e) {
    if (e instanceof Rollback) return e.result;
    throw e;
  }
}
