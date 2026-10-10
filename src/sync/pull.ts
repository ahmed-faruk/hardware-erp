import { rebuildPartyBalances, rebuildStockBalances } from '@/db/balances';
import { patchIndexMany, tokensOf } from '@/db/search';
import type { HanafyDB } from '@/db/schema';
import { LOCAL_TABLE } from '@/db/schema';

import { convertRow } from './case';
import { callRpc, type RpcResult } from './errors';
import type { RpcClient } from './supabase';

interface PullPage {
  rows: { table: string; record: Record<string, unknown> }[];
  last_seq: number;
  has_more: boolean;
}

/** Master tables: a pending local edit must not be overwritten by an older server copy. */
const MASTER = new Set(['products', 'customers', 'suppliers', 'categories', 'productUnits', 'barcodes']);

export async function lastServerSeq(db: HanafyDB): Promise<number> {
  const row = await db.syncState.get('lastServerSeq');
  return typeof row?.value === 'number' ? row.value : 0;
}

/** Applies one pulled page atomically, then rebuilds the balance caches it touched. */
export async function applyPage(db: HanafyDB, page: PullPage): Promise<void> {
  const stockKeys = new Map<string, [string, string]>();
  const partyKeys = new Map<string, [string, string]>();
  const touched = new Set<string>();
  await db.transaction('rw', db.tables, async () => {
    for (const { table, record } of page.rows) {
      if (table === 'products') touched.add(String(record.id));
      if (table === 'barcodes') touched.add(String(record.product_id));
    }
    const before = new Map<string, Set<string>>();
    for (const id of touched) before.set(id, await tokensOf(db, id));
    for (const { table, record } of page.rows) {
      const local = LOCAL_TABLE[table];
      if (!local) continue;
      const row = convertRow(record, 'camel') as { id: string } & Record<string, unknown>;
      const store = db.table(local);
      if (MASTER.has(local)) {
        const pending = await db.outbox
          .where('status')
          .equals('pending')
          .filter((o) => o.id === row.id)
          .count();
        if (pending > 0) continue;
      }
      const existing = (await store.get(row.id)) as Record<string, unknown> | undefined;
      await store.put({ ...existing, ...row });
      if (local === 'stockMovements')
        stockKeys.set(`${row.productId}|${row.warehouseId}`, [
          String(row.productId),
          String(row.warehouseId),
        ]);
      if (local === 'partyLedger')
        partyKeys.set(`${row.partyType}|${row.partyId}`, [String(row.partyType), String(row.partyId)]);
    }
    await patchIndexMany(db, before);
    await db.syncState.put({ key: 'lastServerSeq', value: page.last_seq });
    await rebuildStockBalances(db, [...stockKeys.values()]);
    await rebuildPartyBalances(db, [...partyKeys.values()]);
  });
}

export type PullResult = { ok: true; rows: number } | Extract<RpcResult<never>, { ok: false }>;

/** Pulls pages until the server has nothing newer. */
export async function pullAll(db: HanafyDB, client: RpcClient): Promise<PullResult> {
  let rows = 0;
  for (;;) {
    const res = await callRpc<PullPage>(client, 'pull_changes', {
      p_after_seq: await lastServerSeq(db),
      p_max_rows: 1000,
    });
    if (!res.ok) return res;
    await applyPage(db, res.data);
    rows += res.data.rows.length;
    if (!res.data.has_more) return { ok: true, rows };
  }
}
