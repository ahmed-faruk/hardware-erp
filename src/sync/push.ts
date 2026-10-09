import type { HanafyDB } from '@/db/schema';
import { SERVER_TABLE } from '@/db/schema';
import type { OutboxRow } from '@/db/types';

import { convertRow } from './case';
import { callRpc, type RpcResult } from './errors';
import type { RpcClient } from './supabase';

export const MAX_BATCH_ROWS = 200;
/** children embedded in a document record: local key -> converted by `convertRow` */
const BUNDLE_CHILDREN = ['lines', 'payments', 'stockMovements', 'partyLedger', 'cashMovements'];

export function toServerRow(o: OutboxRow & { seq: number }): Record<string, unknown> {
  const record = convertRow(o.payload, 'snake');
  for (const key of BUNDLE_CHILDREN) {
    const snake = Object.keys(convertRow({ [key]: 1 }, 'snake'))[0]!;
    const children = o.payload[key];
    if (Array.isArray(children))
      record[snake] = children.map((c) => convertRow(c as Record<string, unknown>, 'snake'));
  }
  return {
    seq: o.seq,
    device_seq: o.deviceSeq,
    table: SERVER_TABLE[o.table],
    op: o.op,
    record,
    changed_fields: o.changedFields
      ? Object.keys(convertRow(Object.fromEntries(o.changedFields.map((f) => [f, 1])), 'snake'))
      : null,
    base_version: o.baseVersion,
  };
}

export interface PushResult {
  sent: number;
  rejected: number;
  /** more pending rows remain */
  more: boolean;
  error?: Extract<RpcResult<never>, { ok: false }>;
}

/** Pushes one batch (≤ 200 rows, in seq order). Accepted rows become `sent`, rejected rows keep their reason. */
export async function pushOnce(
  db: HanafyDB,
  client: RpcClient,
  deviceId: string,
  appVersion: string,
): Promise<PushResult> {
  const rows = (await db.outbox.where('status').equals('pending').sortBy('seq')).slice(
    0,
    MAX_BATCH_ROWS,
  ) as (OutboxRow & { seq: number })[];
  if (rows.length === 0) return { sent: 0, rejected: 0, more: false };
  const res = await callRpc<{
    accepted_up_to: number;
    rejected: { seq: number; code: string; message: string }[];
  }>(client, 'ingest_batch', {
    p_device_id: deviceId,
    p_app_version: appVersion,
    p_rows: rows.map(toServerRow),
  });
  if (!res.ok) {
    await db.outbox
      .where('seq')
      .anyOf(rows.map((r) => r.seq))
      .modify((r) => {
        r.attempts += 1;
        r.lastError = res.code;
      });
    return { sent: 0, rejected: 0, more: true, error: res };
  }
  const rejected = new Map(res.data.rejected.map((r) => [r.seq, r]));
  await db.transaction('rw', db.outbox, async () => {
    for (const r of rows) {
      if (r.seq > res.data.accepted_up_to) continue;
      const bad = rejected.get(r.seq);
      await db.outbox.update(
        r.seq,
        bad
          ? { status: 'rejected', lastError: `${bad.code}: ${bad.message}` }
          : { status: 'sent', lastError: null },
      );
    }
  });
  const left = await db.outbox.where('status').equals('pending').count();
  return { sent: rows.length - rejected.size, rejected: rejected.size, more: left > 0 };
}

/** Pushes until nothing is pending or a call fails (the caller schedules the retry with `backoffMs`). */
export async function pushAll(
  db: HanafyDB,
  client: RpcClient,
  deviceId: string,
  appVersion: string,
): Promise<PushResult> {
  const total: PushResult = { sent: 0, rejected: 0, more: false };
  for (;;) {
    const r = await pushOnce(db, client, deviceId, appVersion);
    total.sent += r.sent;
    total.rejected += r.rejected;
    if (r.error) return { ...total, more: true, error: r.error };
    if (!r.more) return total;
  }
}
