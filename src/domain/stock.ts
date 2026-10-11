import { formatQty, type Milli } from './money';

export interface StockLine {
  productId: string;
  /** base-unit quantity in the warehouse before this sale */
  before: Milli;
  /** base-unit quantity this line sells */
  sold: Milli;
}

/** INV-11: products whose stock would drop below zero after the sale; lines of the same product are added together. */
export function negativeAfterSale(lines: StockLine[]): StockLine[] {
  const byProduct = new Map<string, StockLine>();
  for (const l of lines) {
    const seen = byProduct.get(l.productId);
    byProduct.set(l.productId, seen ? { ...seen, sold: seen.sold + l.sold } : { ...l });
  }
  return [...byProduct.values()].filter((l) => l.before - l.sold < 0);
}

/** The quantity on a sale-screen tile: whole units without decimals, fractions as they are (2.5), negative with its minus sign. */
export const tileStockText = (qtyMilli: Milli): string => formatQty(qtyMilli);
