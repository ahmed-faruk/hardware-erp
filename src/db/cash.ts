import type { HanafyDB } from './schema';

/** The cash movements on the shift's box while it was open: any document, any device. */
export async function shiftDrawerMovements(db: HanafyDB, shiftId: string) {
  const shift = await db.shifts.get(shiftId);
  if (!shift) return { shift: undefined, movements: [] };
  const all = await db.cashMovements
    .filter(
      (m) =>
        m.cashAccountId === shift.cashAccountId &&
        !m.deletedAt &&
        m.occurredAt >= shift.openedAt &&
        m.occurredAt <= (shift.closedAt ?? '9999'),
    )
    .toArray();
  return { shift, movements: all };
}

/** What the drawer should hold now: opening float + every movement of the shift on that drawer. */
export async function drawerBalance(db: HanafyDB, shiftId: string): Promise<number> {
  const { shift, movements } = await shiftDrawerMovements(db, shiftId);
  return (shift?.openingFloat ?? 0) + movements.reduce((a, m) => a + m.amount, 0);
}

/** The one shift open now in the shop (any device opened it), or null: money that goes back out of a deleted invoice leaves from there. */
export async function openShopShift(db: HanafyDB) {
  return (await db.shifts.where('status').equals('open').first()) ?? null;
}
