import { err, ok, type Result } from './result';
import { mulDivRound, type Piasters } from './money';

export type PayMethod = 'cash' | 'credit' | 'card' | 'instapay' | 'wallet';

export interface PaymentInput {
  method: PayMethod;
  amount: Piasters;
  /** cash handed over by the customer (cash only) */
  tendered?: Piasters;
  reference?: string;
}

export type PaymentCheck = { ok: true; change: Piasters } | { ok: false; code: string; message: string };

/** Payments must add up to the total exactly (docs: skill hardware-erp-domain §3). */
export function validatePayments(
  total: Piasters,
  payments: PaymentInput[],
  customerId: string | null,
): PaymentCheck {
  let sum = 0;
  let change = 0;
  for (const p of payments) {
    if (!Number.isInteger(p.amount) || p.amount <= 0)
      return err('INVALID_AMOUNT', 'payment amount must be positive');
    if (p.method === 'credit' && !customerId) return err('CUSTOMER_REQUIRED', 'credit needs a customer');
    if ((p.method === 'card' || p.method === 'instapay') && !p.reference?.trim()) {
      return err('REFERENCE_REQUIRED', 'card and instapay need a reference');
    }
    if (p.method === 'cash' && p.tendered !== undefined) {
      if (p.tendered < p.amount)
        return err('TENDERED_TOO_LOW', 'cash handed over is less than the cash share');
      change += p.tendered - p.amount;
    }
    sum += p.amount;
  }
  if (sum !== total) return err('PAYMENTS_MISMATCH', 'payments do not add up to the total');
  return { ok: true, change };
}

/** Cash rounding applies to the cash payment only; the difference is stored separately. */
export function applyCashRounding(
  amount: Piasters,
  step: 0 | 25 | 50,
): { rounded: Piasters; difference: Piasters } {
  if (step === 0) return { rounded: amount, difference: 0 };
  const rounded = mulDivRound(amount, 1, step) * step;
  return { rounded, difference: rounded - amount };
}

export interface Denomination {
  value: Piasters;
  count: number;
}

/** EGP notes 200..5 and coins 1, 0.50, 0.25 in piasters. */
export const DEFAULT_DENOMINATIONS: readonly Piasters[] = [20000, 10000, 5000, 2000, 1000, 500, 100, 50, 25];

/** Greedy change breakdown; `remainder` is what the smallest denomination cannot cover. */
export function breakChange(
  amount: Piasters,
  denominations: readonly Piasters[],
): { parts: Denomination[]; remainder: Piasters } {
  const parts: Denomination[] = [];
  let left = amount;
  for (const value of [...denominations].sort((a, b) => b - a)) {
    const count = Math.floor(left / value);
    if (count > 0) {
      parts.push({ value, count });
      left -= count * value;
    }
  }
  return { parts, remainder: left };
}

export type { Result };
export { ok };
