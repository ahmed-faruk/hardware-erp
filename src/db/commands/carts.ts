import type { Cart } from '@/domain/cart';

import type { DeviceContext } from './context';
import { nowIso, uuidv7 } from '../ids';
import type { HanafyDB } from '../schema';

const CURRENT = 'current';

export interface HeldCartRow {
  id: string;
  cart: Cart;
  workerId: string;
  total: number;
  heldAt: string;
  /** a name the cashier wrote when holding (not a customer record); null = none */
  label?: string | null;
}

/** POS-06: the open cart is saved on every change, so a reload or a power cut never loses it. Local only, never synced. */
export async function saveCurrentCart(db: HanafyDB, cart: Cart): Promise<void> {
  if (cart.lines.length === 0) await db.heldCarts.delete(CURRENT);
  else await db.heldCarts.put({ id: CURRENT, payload: { cart }, updatedAt: nowIso() });
}

export async function loadCurrentCart(db: HanafyDB): Promise<Cart | null> {
  const row = await db.heldCarts.get(CURRENT);
  return ((row?.payload as { cart?: Cart } | undefined)?.cart as Cart | undefined) ?? null;
}

/** POS-05: park the cart and start a new one. */
export async function holdCart(
  ctx: DeviceContext,
  cart: Cart,
  total: number,
  label: string | null = null,
): Promise<string> {
  const id = uuidv7();
  await ctx.db.transaction('rw', ctx.db.heldCarts, async () => {
    await ctx.db.heldCarts.put({
      id,
      payload: { cart, workerId: ctx.workerId, total, heldAt: nowIso(), label },
      updatedAt: nowIso(),
    });
    await ctx.db.heldCarts.delete(CURRENT);
  });
  return id;
}

export async function listHeldCarts(db: HanafyDB): Promise<HeldCartRow[]> {
  const rows = (await db.heldCarts.toArray()).filter((r) => r.id !== CURRENT);
  return rows
    .map((r) => ({ id: r.id, ...(r.payload as Omit<HeldCartRow, 'id'>) }))
    .sort((a, b) => b.heldAt.localeCompare(a.heldAt));
}

/** Takes a held cart back; it is removed from the list so it cannot be sold twice. */
export async function resumeCart(db: HanafyDB, id: string): Promise<Cart | null> {
  return db.transaction('rw', db.heldCarts, async () => {
    const row = await db.heldCarts.get(id);
    if (!row) return null;
    await db.heldCarts.delete(id);
    return (row.payload as { cart: Cart }).cart;
  });
}

export const discardCart = (db: HanafyDB, id: string): Promise<void> => db.heldCarts.delete(id);
