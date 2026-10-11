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
