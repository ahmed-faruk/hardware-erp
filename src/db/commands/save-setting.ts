import { err } from '@/domain/result';

import { newCommon, type DeviceContext, canCtx } from './context';
import { upsertRow, type SaveResult } from './save-master';
import { settingId } from '../ids';
import { auditRow } from './audit';
import { enqueue } from '../outbox';
import type { Setting } from '../types';

/** One company setting (managers only). The row id comes from the key, so every device writes the same row. */
export async function saveSetting(ctx: DeviceContext, key: string, value: unknown): Promise<SaveResult> {
  if (canCtx(ctx, 'settings') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (!/^[a-z]+\.[A-Za-z]+$/.test(key)) return err('E_VALIDATION', 'مفتاح إعداد غير صحيح');
  const id = await settingId(ctx.companyId, key);
  const { db } = ctx;
  return db.transaction('rw', [db.settings, db.auditLog, db.outbox, db.syncState], async () => {
    const before = (await db.settings.get(id))?.value ?? null;
    const saved = await upsertRow<Setting>(
      ctx,
      'settings',
      db.settings,
      { id, fields: { value } },
      { value },
      () => ({
        ...newCommon(ctx),
        id,
        key,
        value,
      }),
    );
    if (saved.ok && saved.changed.length > 0) {
      const row = auditRow(ctx, 'setting_changed', 'settings', saved.id, { key, before, after: value });
      await db.auditLog.add(row);
      await enqueue(db, 'auditLog', row, ctx.workerId);
    }
    return saved.ok ? { ok: true as const, id: saved.id, version: saved.version } : saved;
  });
}
