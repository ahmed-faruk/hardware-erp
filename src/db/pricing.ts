import { priceFor, repriceLines, type PriceList } from '@/domain/pricing';
import type { Cart } from '@/domain/cart';

import type { HanafyDB } from './schema';

/** The list a customer buys on; no customer or an unknown one = retail. */
export async function customerPriceList(db: HanafyDB, customerId: string | null): Promise<PriceList> {
  if (!customerId) return 'retail';
  return (await db.customers.get(customerId))?.priceList ?? 'retail';
}

/** POS-10: the customer changed, so lines still at their list price move to that customer's list. */
export async function repriceForCustomer(db: HanafyDB, cart: Cart, customerId: string | null): Promise<Cart> {
  const list = await customerPriceList(db, customerId);
  const products = await db.products.bulkGet(cart.lines.map((l) => l.productId));
  const units = await db.productUnits.bulkGet(cart.lines.map((l) => l.productUnitId ?? ''));
  const prices = new Map<string, number>();
  cart.lines.forEach((l, i) => {
    const p = products[i];
    if (!p) return;
    const u = units[i];
    prices.set(
      l.key,
      priceFor(
        p,
        u
          ? { factor: u.factor, price: u.price }
          : l.unitFactorMilli !== 1000
            ? { factor: l.unitFactorMilli, price: null }
            : null,
        list,
      ),
    );
  });
  return repriceLines(cart, prices);
}
