import { payrollState } from '@/domain/payroll';
import { err, type Err } from '@/domain/result';

import { auditRow } from './audit';
import { canCtx, type DeviceContext } from './context';
import { loadPayrollEntries } from './payroll';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';

export type DeleteKind = 'customer' | 'supplier' | 'worker';
type Done = { ok: true } | Err;

/** Why this customer, supplier or worker cannot be deleted now, or null. The server refuses the same cases again (triggers). */
export async function deleteBlock(ctx: DeviceContext, kind: DeleteKind, id: string): Promise<Err | null> {
  const { db } = ctx;
  if (canCtx(ctx, kind === 'worker' ? 'manageUsers' : 'settings') !== 'yes')
    return err('E_FORBIDDEN', 'غير مسموح');
  if (kind === 'worker') {
    if (id === ctx.workerId) return err('SELF', 'مينفعش تحذف نفسك');
    const w = await db.workers.get(id);
    if (!w || w.deletedAt) return err('NOT_FOUND', 'عامل غير موجود');
    const st = payrollState(await loadPayrollEntries(db, id), id, w.monthlySalary ?? 0, nowIso().slice(0, 7));
    if (st.advances + st.carryIn > 0) return err('HAS_ADVANCE', 'عليه سلف لسه ما اتخصمتش');
    return null;
  }
  const row = kind === 'customer' ? await db.customers.get(id) : await db.suppliers.get(id);
  if (!row || row.deletedAt) return err('NOT_FOUND', 'مش موجود');
  const balance = (await db.partyBalances.get([kind, id]))?.amount ?? 0;
  if (balance !== 0) return err('HAS_BALANCE', 'عليه رصيد');
  return null;
}

/** Soft delete (deletedAt) of a customer, supplier or worker, with an audit row, in ONE transaction. */
export async function deleteMaster(ctx: DeviceContext, kind: DeleteKind, id: string): Promise<Done> {
  const { db } = ctx;
  const table = kind === 'customer' ? 'customers' : kind === 'supplier' ? 'suppliers' : 'workers';
  return db.transaction(
    'rw',
    [
      db.customers,
      db.suppliers,
      db.workers,
      db.partyBalances,
      db.payrollEntries,
      db.auditLog,
      db.outbox,
      db.syncState,
    ],
    async (): Promise<Done> => {
      const blocked = await deleteBlock(ctx, kind, id);
      if (blocked) return blocked;
      const store = kind === 'customer' ? db.customers : kind === 'supplier' ? db.suppliers : db.workers;
      const row = await store.get(id);
      if (!row) return err('NOT_FOUND', 'مش موجود');
      const now = nowIso();
      const gone = { ...row, deletedAt: now, updatedAt: now, version: row.version + 1 };
      await store.put(gone as never);
      await enqueue(db, table, gone, ctx.workerId, {
        changedFields: ['deletedAt'],
        baseVersion: row.version,
      });
      const audit = auditRow(ctx, `${kind}.delete`, table, id, { name: row.name });
      await db.auditLog.add(audit);
      await enqueue(db, 'auditLog', audit, ctx.workerId);
      return { ok: true };
    },
  );
}
