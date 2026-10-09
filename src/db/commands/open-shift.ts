import { can } from '@/domain/permissions';
import { err, type Err } from '@/domain/result';
import { openShiftSchema } from '@/domain/schemas';

import { newCommon, type DeviceContext } from './context';
import { nowIso } from '../ids';
import { nextNumber } from '../numbering';
import { enqueue } from '../outbox';
import type { Shift } from '../types';

/** FIN-01: open a shift with the counted float. The blind close is built in phase 8. */
export async function openShift(
  ctx: DeviceContext,
  raw: unknown,
): Promise<{ ok: true; id: string; number: string } | Err> {
  const parsed = openShiftSchema.safeParse(raw);
  if (!parsed.success) return err('E_VALIDATION', 'بيانات الوردية غير صحيحة');
  if (can(ctx.role, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  return db.transaction('rw', [db.shifts, db.numberSequences, db.outbox, db.syncState], async () => {
    const open = await db.shifts
      .where('status')
      .equals('open')
      .filter((s) => s.workerId === ctx.workerId)
      .first();
    if (open) return err('SHIFT_ALREADY_OPEN', 'فيه وردية مفتوحة');
    const number = await nextNumber(db, ctx.devicePrefix, 'SHF');
    const shift: Shift = {
      ...newCommon(ctx),
      number,
      workerId: ctx.workerId,
      cashAccountId: parsed.data.cashAccountId,
      openedAt: nowIso(),
      openingFloat: parsed.data.openingFloat,
      closedAt: null,
      countedTotal: null,
      countedBreakdown: null,
      expectedTotal: null,
      variance: null,
      closeNote: null,
      status: 'open',
    };
    await db.shifts.add(shift);
    await enqueue(db, 'shifts', shift);
    return { ok: true as const, id: shift.id, number };
  });
}
