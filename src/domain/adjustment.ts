import { mulDivRound, type Milli, type Piasters } from './money';
import type { Role } from './permissions';

export const ADJUSTMENT_REASONS = ['count', 'damaged', 'lost', 'found', 'other'] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const adjustmentValue = (lines: { qtyDelta: Milli; unitCost: Piasters }[]): Piasters =>
  lines.reduce((a, l) => a + mulDivRound(Math.abs(l.qtyDelta), l.unitCost, 1000), 0);

/** INV-10: above the value set by the manager, anyone but a manager needs a manager's PIN. */
export const adjustmentNeedsApproval = (limit: Piasters, role: Role, value: Piasters): boolean =>
  role !== 'manager' && value > limit;

/** Lost and damaged only take stock away, found only adds it; a count or "other" goes both ways. */
export const reasonFitsDelta = (reason: AdjustmentReason, delta: Milli): boolean =>
  reason === 'lost' || reason === 'damaged' ? delta < 0 : reason === 'found' ? delta > 0 : delta !== 0;
