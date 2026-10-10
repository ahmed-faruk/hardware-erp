import { loadIdentity } from '@/app/device-setup';
import { uuidv7, nowIso } from '@/db/ids';
import { enqueue } from '@/db/outbox';
import type { HanafyDB } from '@/db/schema';

const cairoDay = (ms: number): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date(ms));

/** AUD-02: a device clock far from the server's is written to the audit log, once per Cairo day. */
export async function auditClock(db: HanafyDB, skewMs: number, nowMs: number): Promise<void> {
  const today = cairoDay(nowMs);
  if ((await db.syncState.get('clockAuditDay'))?.value === today) return;
  const identity = await loadIdentity(db);
  if (!identity) return;
  const at = nowIso();
  const row = {
    id: uuidv7(),
    companyId: identity.companyId,
    deviceId: identity.deviceId,
    createdBy: null,
    createdAt: at,
    updatedAt: at,
    version: 1,
    deletedAt: null,
    action: 'clock_suspicious',
    entity: 'devices',
    entityId: identity.deviceId,
    before: null,
    after: { skewMs },
    workerId: null,
    approvedBy: null,
    occurredAt: at,
  };
  await db.transaction('rw', [db.auditLog, db.outbox, db.syncState], async () => {
    await db.auditLog.add(row);
    await enqueue(db, 'auditLog', row, null);
    await db.syncState.put({ key: 'clockAuditDay', value: today });
  });
}
