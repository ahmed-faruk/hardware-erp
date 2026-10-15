import { mulDivRound, type Milli, type Piasters } from './money';

export interface PurchaseLineInput {
  qtyMilli: Milli;
  /** cost per unit of the purchased unit (a pack, if the line is in packs) */
  unitCost: Piasters;
  discount: Piasters;
}

export interface PurchaseTotals {
  lines: { grossAmount: Piasters; netAmount: Piasters }[];
  subtotal: Piasters;
  discount: Piasters;
  total: Piasters;
}

/** PUR-01: line = qty x cost (half-up) - its discount; the invoice is the sum of its lines. Mirrors the server's check. */
export function computePurchase(lines: PurchaseLineInput[]): PurchaseTotals {
  const out = lines.map((l) => {
    if (!Number.isInteger(l.qtyMilli) || l.qtyMilli <= 0) throw new RangeError('quantity must be positive');
    if (!Number.isInteger(l.unitCost) || l.unitCost < 0) throw new RangeError('cost must not be negative');
    const grossAmount = mulDivRound(l.qtyMilli, l.unitCost, 1000);
    if (l.discount < 0 || l.discount > grossAmount) throw new RangeError('discount outside the line value');
    return { grossAmount, netAmount: grossAmount - l.discount };
  });
  const subtotal = out.reduce((a, l) => a + l.grossAmount, 0);
  const net = out.reduce((a, l) => a + l.netAmount, 0);
  return { lines: out, subtotal, discount: subtotal - net, total: net };
}

/** Cost of ONE base unit from what a line cost and how many base units (milli) it brought in; same maths as the server's `line_cost_per_base`. */
export const costPerBase = (netAmount: Piasters, baseQtyMilli: Milli): Piasters =>
  mulDivRound(netAmount, 1000, baseQtyMilli);

export interface PaymentSplit {
  safe: Piasters;
  owner: Piasters;
  credit: Piasters;
}

/**
 * How a purchase is paid: `safe` from a cash account, `owner` from the owner's pocket (no cash account moves, no debt to the owner),
 * the rest stays owed to the supplier. Null when the two parts together are more than the invoice or either is negative.
 */
export function splitPurchasePayment(total: Piasters, safe: Piasters, owner: Piasters): PaymentSplit | null {
  if (safe < 0 || owner < 0 || safe + owner > total) return null;
  return { safe, owner, credit: total - safe - owner };
}

/** A new cost this far from the last one (in percent, either way) is flagged on the line so a typing slip is noticed. */
export const PRICE_CHANGE_WARN_PERCENT = 20;

/** Percent change from the last price to the new one, rounded; null when there is no last price to compare with. */
export function priceChangePercent(last: Piasters | null, now: Piasters): number | null {
  if (last === null || last <= 0) return null;
  return Math.round(((now - last) * 100) / last);
}

export const priceChangeWarns = (last: Piasters | null, now: Piasters): boolean => {
  const pct = priceChangePercent(last, now);
  return pct !== null && Math.abs(pct) >= PRICE_CHANGE_WARN_PERCENT;
};

/**
 * An invoice discount spread over the lines in proportion to their value (largest remainder, so the parts add up exactly).
 * The server only knows line discounts; their sum is the invoice's `discount`.
 */
export function allocateInvoiceDiscount(grossAmounts: Piasters[], discount: Piasters): Piasters[] {
  const total = grossAmounts.reduce((a, g) => a + g, 0);
  if (!Number.isInteger(discount) || discount < 0 || discount > total)
    throw new RangeError('discount outside the invoice value');
  if (discount === 0 || total === 0) return grossAmounts.map(() => 0);
  const exact = grossAmounts.map((g) => (g * discount) / total);
  const parts = exact.map((e) => Math.floor(e));
  let left = discount - parts.reduce((a, p) => a + p, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (left <= 0) break;
    if (parts[i]! < grossAmounts[i]!) {
      parts[i]! += 1;
      left -= 1;
    }
  }
  return parts;
}
