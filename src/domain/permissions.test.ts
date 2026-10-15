import { describe, expect, it } from 'vitest';

import {
  ACTIONS,
  PERMISSION_SECTIONS,
  can,
  defaultsFor,
  resolveAccess,
  type Action,
  type Permissions,
  type Role,
} from './permissions';

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
    for (const a of ACTIONS) expect(can('manager', a)).toBe('yes');
  });
  it('the screens each role saw before groups are unchanged', () => {
    const views = ACTIONS.filter((a) => a.startsWith('view.'));
    const seen = (r: Role) => views.filter((a) => can(r, a) === 'yes');
    expect(seen('cashier')).toEqual(['view.sell']);
    expect(seen('storekeeper')).toEqual(['view.products', 'view.categories', 'view.stock', 'view.purchases']);
  });
});

describe('permission groups', () => {
  const group: Permissions = { sell: 'yes', recordExpense: 'pin', 'view.expenses': 'yes' };

  it('a worker without a group gets his role defaults', () => {
    expect(resolveAccess('cashier', null, 'sell')).toBe('yes');
    expect(resolveAccess('cashier', null, 'void')).toBe('no');
  });
  it('with a group the group is the whole truth: unlisted means no', () => {
    expect(resolveAccess('cashier', group, 'recordExpense')).toBe('pin');
    expect(resolveAccess('cashier', group, 'view.expenses')).toBe('yes');
    expect(resolveAccess('cashier', group, 'holdCart')).toBe('no');
  });
  it('a group can give a cashier more than his role has', () => {
    expect(resolveAccess('cashier', { void: 'yes' }, 'void')).toBe('yes');
  });
  it('a manager always keeps the screens that let him fix permissions', () => {
    for (const a of ['view.workers', 'manageUsers', 'manageGroups', 'view.settings', 'settings'] as Action[])
      expect(resolveAccess('manager', {}, a)).toBe('yes');
    expect(resolveAccess('manager', {}, 'sell')).toBe('no');
  });
  it('defaultsFor gives a full explicit map for managers', () => {
    expect(Object.keys(defaultsFor('manager'))).toHaveLength(ACTIONS.length);
  });
});

describe('sections', () => {
  it('list every action exactly once', () => {
    const all = PERMISSION_SECTIONS.flatMap((s) => s.actions);
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...ACTIONS].sort());
  });

  it('F6: the returns report is a manager action; a group decides it for anyone else', () => {
    expect(can('manager', 'report.returns')).toBe('yes');
    expect(can('cashier', 'report.returns')).toBe('no');
    expect(can('storekeeper', 'report.returns')).toBe('no');
    expect(resolveAccess('cashier', { 'report.returns': 'yes' }, 'report.returns')).toBe('yes');
    // a group made before this report existed does not have it: a missing action is no
    expect(resolveAccess('manager', { 'report.sales': 'yes' }, 'report.returns')).toBe('no');
  });

  it('P1: a purchase return after the period is a manager approval for a storekeeper', () => {
    expect(can('manager', 'purchaseReturnAfterPeriod')).toBe('yes');
    expect(can('storekeeper', 'purchaseReturnAfterPeriod')).toBe('pin');
    expect(can('cashier', 'purchaseReturnAfterPeriod')).toBe('no');
  });
});
