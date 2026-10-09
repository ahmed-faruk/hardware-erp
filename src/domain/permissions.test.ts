import { describe, expect, it } from 'vitest';

import { can, type Action, type Role } from './permissions';

describe('permissions', () => {
  it('cashier can sell but not void', () => {
    expect(can('cashier', 'sell')).toBe('yes');
    expect(can('cashier', 'void')).toBe('no');
  });
  it('cashier needs a PIN for override actions', () => {
    for (const a of ['discountOverLimit', 'priceOverride', 'creditOverLimit', 'noSaleDrawer'] as Action[]) {
      expect(can('cashier', a)).toBe('pin');
    }
  });
  it('storekeeper handles stock only', () => {
    expect(can('storekeeper', 'receivePurchase')).toBe('yes');
    expect(can('storekeeper', 'stockAdjustment')).toBe('yes');
    expect(can('storekeeper', 'sell')).toBe('no');
  });
  it('only the manager sees cost and profit', () => {
    expect(can('manager', 'seeCost')).toBe('yes');
    expect(can('cashier', 'seeCost')).toBe('no');
    expect(can('storekeeper', 'seeCost')).toBe('no');
  });
  it('manager can do everything', () => {
    const roles: Role[] = ['manager'];
    for (const r of roles) expect(can(r, 'returnWithoutInvoice')).toBe('yes');
  });
});
