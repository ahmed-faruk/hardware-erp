import { newCommon, type DeviceContext } from './context';
import { nowIso } from '../ids';
import { enqueue } from '../outbox';
import type { AuditRow } from '../types';

/** AUD-02: one append-only audit row (queued for sync), written in its own small transaction. Use `auditRow` + `enqueue` instead when a command already has a transaction. */
export function auditRow(
  ctx: DeviceContext,
  action: string,
  entity: string,
  entityId: string | null,
  after: unknown,
  approvedBy: string | null = null,
): AuditRow {
  return {
    ...newCommon(ctx),
    action,
    entity,
    entityId,
    before: null,
    after,
    workerId: ctx.workerId,
    approvedBy,
    occurredAt: nowIso(),
  };
}

export async function recordAudit(
  ctx: DeviceContext,
  action: string,
  entity: string,
  entityId: string | null,
  after: unknown,
  approvedBy: string | null = null,
): Promise<void> {
  const { db } = ctx;
  const row = auditRow(ctx, action, entity, entityId, after, approvedBy);
  await db.transaction('rw', [db.auditLog, db.outbox, db.syncState], async () => {
    await db.auditLog.add(row);
    await enqueue(db, 'auditLog', row, ctx.workerId);
  });
}
