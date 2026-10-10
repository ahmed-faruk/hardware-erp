import { mulDivRound, type Milli, type Piasters } from './money';
import type { Cart } from './cart';

export const PRICE_LISTS = ['retail', 'wholesale', 'craftsman', 'contractor'] as const;
export type PriceList = (typeof PRICE_LISTS)[number];

interface Priced {
  price: Piasters;
  priceWholesale?: Piasters | null;
  priceCraftsman?: Piasters | null;
  priceContractor?: Piasters | null;
}

const FIELD = {
  wholesale: 'priceWholesale',
  craftsman: 'priceCraftsman',
  contractor: 'priceContractor',
} as const;

/** POS-10: the price of a product (or of a pack of it) on a customer's list; a list without its own price falls back to retail. */
export function priceFor(
  product: Priced,
  unit: { factor: Milli; price: Piasters | null } | null,
  list: PriceList,
): Piasters {
  const base = list === 'retail' ? product.price : (product[FIELD[list]] ?? product.price);
  if (!unit) return base;
  if (list === 'retail' && unit.price != null) return unit.price;
  return mulDivRound(base, unit.factor, 1000);
}

/** The customer changed: lines still at their list price move to the new list; a price typed by hand stays. */
export function repriceLines(cart: Cart, prices: Map<string, Piasters>): Cart {
  return {
    ...cart,
    lines: cart.lines.map((l) => {
      const next = prices.get(l.key);
      if (next === undefined) return l;
      return { ...l, unitPrice: l.unitPrice === l.listPrice ? next : l.unitPrice, listPrice: next };
    }),
  };
}
