import { err, type Err } from './result';
import { mulDivRound, type Milli, type Piasters } from './money';

export interface SoldLine {
  id: string;
  qtyMilli: Milli;
  /** line amount after its share of the invoice discount */
  finalAmount: Piasters;
  unitCost: Piasters;
}

export interface PriorReturn {
  originalLineId: string;
  qtyMilli: Milli;
}

export const returnableQty = (line: SoldLine, prior: PriorReturn[]): Milli =>
  line.qtyMilli - prior.filter((r) => r.originalLineId === line.id).reduce((a, r) => a + r.qtyMilli, 0);

/** RET-01: never above sold - already returned. Refund = cumulative proportional share, so returning everything refunds exactly the line amount. */
export function computeReturnLine(
  line: SoldLine,
  prior: PriorReturn[],
  qtyMilli: Milli,
): { ok: true; qtyMilli: Milli; refund: Piasters; unitCost: Piasters } | Err {
  if (!Number.isInteger(qtyMilli) || qtyMilli <= 0)
    return err('INVALID_QTY', 'return quantity must be positive');
  const already = line.qtyMilli - returnableQty(line, prior);
  if (qtyMilli > line.qtyMilli - already)
    return err('RETURN_EXCEEDS_SOLD', 'cannot return more than was sold');
  const refund =
    mulDivRound(line.finalAmount, already + qtyMilli, line.qtyMilli) -
    mulDivRound(line.finalAmount, already, line.qtyMilli);
  return { ok: true, qtyMilli, refund, unitCost: line.unitCost };
}

export interface OriginalPayment {
  method: string;
  amount: Piasters;
}

/**
 * The refund follows the original payment mix: the credit share reduces the customer's debt, everything else is
 * handed back in cash. Largest-remainder-free by construction: cash = refund - credit, so the parts add up exactly.
 */
export function allocateRefund(
  originalPayments: OriginalPayment[],
  refund: Piasters,
): { ok: true; credit: Piasters; cash: Piasters } | Err {
  const total = originalPayments.reduce((a, p) => a + p.amount, 0);
  if (!Number.isInteger(refund) || refund < 0 || refund > total)
    return err('REFUND_EXCEEDS_PAID', 'refund is more than the invoice');
  if (total === 0) return { ok: true, credit: 0, cash: 0 };
  const creditPaid = originalPayments.filter((p) => p.method === 'credit').reduce((a, p) => a + p.amount, 0);
  const credit = mulDivRound(refund, creditPaid, total);
  return { ok: true, credit, cash: refund - credit };
}

/** What was sold and already returned of one product, in base milli-units, over every posted invoice and return. */
export interface SoldReturned {
  sold: Milli;
  returned: Milli;
}

export const returnableOf = (t: SoldReturned | undefined): Milli =>
  t ? Math.max(0, t.sold - t.returned) : 0;

/**
 * A return without invoice (manager) may have many lines. Each product must have been sold before on the system
 * (NOT_SOLD) and the quantities of its lines together may not exceed sold - already returned (OVER_SOLD).
 */
export function checkFreeReturn(
  lines: { productId: string; qtyMilli: Milli }[],
  totals: Map<string, SoldReturned>,
): { ok: true } | (Err & { productId: string }) {
  const asked = new Map<string, Milli>();
  for (const l of lines) asked.set(l.productId, (asked.get(l.productId) ?? 0) + l.qtyMilli);
  for (const [productId, qty] of asked) {
    const t = totals.get(productId);
    if (!t || t.sold <= 0) return { ...err('NOT_SOLD', 'الصنف ده ما اتباعش'), productId };
    if (qty > returnableOf(t)) return { ...err('OVER_SOLD', 'الكمية أكبر من المباع'), productId };
  }
  return { ok: true };
}
