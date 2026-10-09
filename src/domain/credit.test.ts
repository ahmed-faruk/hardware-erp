import { describe, expect, it } from 'vitest';

import { availableCredit, checkCredit } from './credit';

describe('credit limit', () => {
  it('subtracts synced and unsynced balances', () => {
    expect(availableCredit({ creditLimit: 100000, lastSyncedBalance: 30000, unsyncedCredit: 20000 })).toBe(
      50000,
    );
  });
  it('allows within limit', () => {
    expect(
      checkCredit({ creditLimit: 100000, lastSyncedBalance: 0, unsyncedCredit: 0 }, 100000, 'allow', false),
    ).toEqual({ ok: true });
  });
  it('needs approval over limit', () => {
    expect(
      checkCredit({ creditLimit: 100000, lastSyncedBalance: 0, unsyncedCredit: 0 }, 100001, 'allow', false),
    ).toEqual({
      ok: false,
      code: 'OVER_LIMIT',
      needsManagerPin: true,
    });
  });
  it('reduces the limit while offline', () => {
    const c = { creditLimit: 100000, lastSyncedBalance: 0, unsyncedCredit: 0 };
    expect(checkCredit(c, 60000, { reduceByBp: 5000 }, true).ok).toBe(false);
    expect(checkCredit(c, 50000, { reduceByBp: 5000 }, true).ok).toBe(true);
    expect(checkCredit(c, 60000, { reduceByBp: 5000 }, false).ok).toBe(true);
  });
  it('blocks credit offline', () => {
    const c = { creditLimit: 100000, lastSyncedBalance: 0, unsyncedCredit: 0 };
    expect(checkCredit(c, 1, 'block', true)).toMatchObject({ ok: false, code: 'OFFLINE_CREDIT_BLOCKED' });
  });
});
