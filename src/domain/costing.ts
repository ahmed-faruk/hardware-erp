import { err, ok, type Result } from './result';
import { mulDivRound, type Milli, type Piasters } from './money';

/** Sold-unit quantity -> base-unit quantity; must come out as a whole milli-unit. */
export function baseQty(qtyMilli: Milli, unitFactorMilli: Milli): Result<Milli> {
  const product = qtyMilli * unitFactorMilli;
  if (!Number.isSafeInteger(product) || product % 1000 !== 0) {
    return err('FRACTIONAL_BASE_QTY', 'quantity does not convert to a whole base quantity');
  }
  return ok(product / 1000);
}

/** Moving weighted-average cost per base unit after a purchase. */
export function movingAverage(p: {
  oldQtyMilli: Milli;
  oldAvg: Piasters;
  inQtyMilli: Milli;
  inCost: Piasters;
}): Piasters {
  if (p.oldQtyMilli <= 0) return p.inCost;
  return mulDivRound(p.oldQtyMilli * p.oldAvg + p.inQtyMilli * p.inCost, 1, p.oldQtyMilli + p.inQtyMilli);
}

/**
 * The moving average after a purchase is taken back out: (Q*A - q*c) / (Q - q), half-up.
 * Q = stock on hand before, A = the average now, q and c = what the deleted purchase added and at what cost.
 * When nothing sensible comes out (stock would reach zero, or the numerator is not positive) the average stays.
 */
export function reverseMovingAverage(p: {
  qtyMilli: Milli;
  avg: Piasters;
  outQtyMilli: Milli;
  outCost: Piasters;
}): Piasters {
  const left = p.qtyMilli - p.outQtyMilli;
  const numerator = p.qtyMilli * p.avg - p.outQtyMilli * p.outCost;
  if (left <= 0 || numerator <= 0) return p.avg;
  return mulDivRound(numerator, 1, left);
}
