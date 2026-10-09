import { nowIso } from './ids';
import type { HanafyDB } from './schema';
import { SERVER_TABLE } from './schema';

async function nextDeviceSeq(db: HanafyDB): Promise<number> {
  const row = await db.syncState.get('deviceSeq');
  const seq = (typeof row?.value === 'number' ? row.value : 0) + 1;
  await db.syncState.put({ key: 'deviceSeq', value: seq });
  return seq;
}

export interface EnqueueOptions {
  changedFields?: string[] | null;
  baseVersion?: number | null;
}

/** Queues one record for push. Must run inside the same transaction as the write it describes. */
export async function enqueue(
  db: HanafyDB,
  table: keyof typeof SERVER_TABLE & string,
  record: { id: string; [extra: string]: unknown } | { id: string },
  options: EnqueueOptions = {},
): Promise<void> {
  await db.outbox.add({
    deviceSeq: await nextDeviceSeq(db),
    table,
    id: record.id,
    op: 'upsert',
    payload: record as unknown as Record<string, unknown>,
    changedFields: options.changedFields ?? null,
    baseVersion: options.baseVersion ?? null,
    status: 'pending',
    attempts: 0,
    lastError: null,
    createdAt: nowIso(),
  });
}
