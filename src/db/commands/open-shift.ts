import { err, type Err } from '@/domain/result';
import { openShiftSchema } from '@/domain/schemas';

import { newCommon, type DeviceContext, canCtx } from './context';
import { nowIso } from '../ids';
import { isClockSafe } from '../clock';
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
  if (canCtx(ctx, 'sell') === 'no') return err('E_FORBIDDEN', 'غير مسموح');
  const { db } = ctx;
  // a device clock that went backwards or is far from the server would date the whole shift wrong (offline-sync skill §6)
  if (!(await isClockSafe(db))) return err('CLOCK_UNSAFE', 'ساعة الجهاز غلط');
  return db.transaction('rw', [db.shifts, db.numberSequences, db.outbox, db.syncState], async () => {
    // one open shift per drawer, whoever opened it (one shop, one cashier at a time)
    const open = await db.shifts
      .where('status')
      .equals('open')
      .filter((s) => s.cashAccountId === parsed.data.cashAccountId)
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
    await enqueue(db, 'shifts', shift, ctx.workerId);
    return { ok: true as const, id: shift.id, number };
  });
}
