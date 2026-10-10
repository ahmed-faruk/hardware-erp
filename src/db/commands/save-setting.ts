import { can } from '@/domain/permissions';
import { err } from '@/domain/result';

import { newCommon, type DeviceContext } from './context';
import { upsertRow, type SaveResult } from './save-master';
import { settingId } from '../ids';
import type { Setting } from '../types';

/** One company setting (managers only). The row id comes from the key, so every device writes the same row. */
export async function saveSetting(ctx: DeviceContext, key: string, value: unknown): Promise<SaveResult> {
  if (can(ctx.role, 'settings') !== 'yes') return err('E_FORBIDDEN', 'غير مسموح');
  if (!/^[a-z]+\.[A-Za-z]+$/.test(key)) return err('E_VALIDATION', 'مفتاح إعداد غير صحيح');
  const id = await settingId(ctx.companyId, key);
  const { db } = ctx;
  return db.transaction('rw', [db.settings, db.outbox, db.syncState], async () => {
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
    return saved.ok ? { ok: true as const, id: saved.id, version: saved.version } : saved;
  });
}
