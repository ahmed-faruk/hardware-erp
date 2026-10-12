import { createClient } from '@supabase/supabase-js';

import type { Target } from './env.ts';
import { COMPACT_ORDER, compactLegacy, WIDE_LEGACY } from './compact.ts';
import { TABLE_ORDER, type Row, type TableName } from './types.ts';

export const BATCH = 500;

export function client(t: Target) {
  return createClient(t.url, t.key, { auth: { persistSession: false } });
}

type Db = ReturnType<typeof client>;

/** Sends rows through `import_batch` (idempotent: on conflict (id) do nothing). Retries network errors. */
export async function loadTable(
  db: Db,
  table: TableName,
  rows: Row[],
  onProgress?: (done: number) => void,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await db.rpc('import_batch', { p_kind: table, p_rows: chunk });
      if (!error && data?.ok) {
        inserted += data.data.inserted;
        skipped += data.data.skipped;
        break;
      }
      const fatal = (data && !data.ok) || attempt >= 4;
      if (fatal)
        throw new Error(
          `import_batch(${table}) failed: ${error?.message ?? data?.error?.message ?? 'unknown'}`,
        );
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    onProgress?.(Math.min(i + BATCH, rows.length));
  }
  return { inserted, skipped };
}

export const COMPACT_BATCH = 5000;

/** Sends rows of a compact history table through `import_legacy_batch` (idempotent). */
export async function loadCompact(
  db: Db,
  table: string,
  rows: Row[],
  onProgress?: (done: number) => void,
): Promise<{ inserted: number; skipped: number }> {
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += COMPACT_BATCH) {
    const chunk = rows.slice(i, i + COMPACT_BATCH);
    for (let attempt = 1; ; attempt++) {
      const { data, error } = await db.rpc('import_legacy_batch', { p_kind: table, p_rows: chunk });
      if (!error && data?.ok) {
        inserted += data.data.inserted;
        skipped += data.data.skipped;
        break;
      }
      if ((data && !data.ok) || attempt >= 4)
        throw new Error(
          `import_legacy_batch(${table}) failed: ${error?.message ?? data?.error?.message ?? 'unknown'}`,
        );
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
    onProgress?.(Math.min(i + COMPACT_BATCH, rows.length));
  }
  return { inserted, skipped };
}

export async function loadAll(
  db: Db,
  tables: Partial<Record<TableName, Row[]>>,
  log: (line: string) => void,
): Promise<void> {
  // the imported history goes in compact form: the wide rows (invoices, lines, payments) are never sent
  const hasHistory = WIDE_LEGACY.some((n) => (tables[n]?.length ?? 0) > 0);
  for (const table of TABLE_ORDER) {
    if (WIDE_LEGACY.includes(table) && hasHistory) continue;
    const rows = tables[table] ?? [];
    if (rows.length === 0) continue;
    let last = 0;
    const r = await loadTable(db, table, rows, (done) => {
      if (done - last >= 20000 || done === rows.length) {
        log(`  ${table}: ${done}/${rows.length}`);
        last = done;
      }
    });
    log(`${table}: ${rows.length} rows (${r.inserted} new, ${r.skipped} already there)`);
  }
  if (hasHistory) {
    const compact = compactLegacy(tables as Record<TableName, Row[]>);
    for (const name of COMPACT_ORDER) {
      const rows = compact[name];
      let last = 0;
      const r = await loadCompact(db, name, rows, (done) => {
        if (done - last >= 50000 || done === rows.length) {
          log(`  ${name}: ${done}/${rows.length}`);
          last = done;
        }
      });
      log(`${name}: ${rows.length} rows (${r.inserted} new, ${r.skipped} already there)`);
    }
  }
}
