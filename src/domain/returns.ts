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
