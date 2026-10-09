import { createClient } from '@supabase/supabase-js';

import type { Target } from './env.ts';
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

export async function loadAll(
  db: Db,
  tables: Partial<Record<TableName, Row[]>>,
  log: (line: string) => void,
): Promise<void> {
  for (const table of TABLE_ORDER) {
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
}
