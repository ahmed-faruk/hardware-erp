import { mulDivRound, type Piasters } from './money';

export interface CreditState {
  creditLimit: Piasters;
  lastSyncedBalance: Piasters;
  unsyncedCredit: Piasters;
}

/** Offline policy setting (CUS-05). */
export type OfflineCreditPolicy = 'allow' | 'block' | { reduceByBp: number };

export type CreditCheck =
  { ok: true } | { ok: false; code: 'OVER_LIMIT' | 'OFFLINE_CREDIT_BLOCKED'; needsManagerPin: boolean };

export const availableCredit = (c: CreditState): Piasters =>
  c.creditLimit - (c.lastSyncedBalance + c.unsyncedCredit);

export function checkCredit(
  c: CreditState,
  amount: Piasters,
  policy: OfflineCreditPolicy,
  isOffline: boolean,
): CreditCheck {
  let limit = c.creditLimit;
  if (isOffline) {
    if (policy === 'block') return { ok: false, code: 'OFFLINE_CREDIT_BLOCKED', needsManagerPin: true };
    if (typeof policy === 'object') limit = mulDivRound(limit, 10000 - policy.reduceByBp, 10000);
  }
  return amount <= availableCredit({ ...c, creditLimit: limit })
    ? { ok: true }
    : { ok: false, code: 'OVER_LIMIT', needsManagerPin: true };
}
