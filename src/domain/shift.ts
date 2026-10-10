import type { Denomination } from './payments';
import type { Piasters } from './money';

export const countByDenomination = (parts: Denomination[]): Piasters =>
  parts.reduce((a, p) => a + p.value * p.count, 0);

/** FIN-02..05: expected = float + cash in - cash out; variance = counted - expected. */
export function shiftVariance(s: {
  countedCash: Piasters;
  openingFloat: Piasters;
  cashIn: Piasters;
  cashOut: Piasters;
}): {
  expected: Piasters;
  variance: Piasters;
} {
  const expected = s.openingFloat + s.cashIn - s.cashOut;
  return { expected, variance: s.countedCash - expected };
}

/** FIN-03: a drawer difference above the limit (either way) needs the manager's PIN and a note. */
export const requiresVarianceApproval = (variance: Piasters, limit: Piasters): boolean =>
  Math.abs(variance) > limit;
