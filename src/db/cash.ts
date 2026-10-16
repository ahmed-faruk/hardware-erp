import type { HanafyDB } from './schema';

/** The cash movements of one shift on its own drawer (a transfer's safe row carries the shift id too, but belongs to another account). */
export async function shiftDrawerMovements(db: HanafyDB, shiftId: string) {
  const shift = await db.shifts.get(shiftId);
  if (!shift) return { shift: undefined, movements: [] };
  const all = await db.cashMovements.where('shiftId').equals(shiftId).toArray();
  return { shift, movements: all.filter((m) => m.cashAccountId === shift.cashAccountId) };
}

/** What the drawer should hold now: opening float + every movement of the shift on that drawer. */
export async function drawerBalance(db: HanafyDB, shiftId: string): Promise<number> {
  const { shift, movements } = await shiftDrawerMovements(db, shiftId);
  return (shift?.openingFloat ?? 0) + movements.reduce((a, m) => a + m.amount, 0);
}

/** The shift open now on this device (opened here, on its own drawer), or null: money that goes back out of a deleted invoice leaves from there. */
export async function openShiftOfDevice(db: HanafyDB, deviceId: string) {
  return (
    (await db.shifts
      .where('status')
      .equals('open')
      .filter((s) => s.deviceId === deviceId)
      .first()) ?? null
  );
}
