import { describe, expect, it } from 'vitest';

import {
  DEFAULT_SETTINGS,
  discountNeedsApproval,
  parseSettings,
  priceNeedsApproval,
  type Settings,
} from './settings';

const allowed: Settings = {
  ...DEFAULT_SETTINGS,
  cashierMayDiscount: true,
  cashierDiscountLimitBp: 500,
  cashierMayChangePrice: true,
};

describe('parseSettings', () => {
  it('uses safe defaults: no discount, no price change', () => {
    expect(parseSettings([])).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS).toMatchObject({
      cashierMayDiscount: false,
      cashierMayChangePrice: false,
      cashierDiscountLimitBp: 500,
    });
  });
  it('reads rows by key and ignores unknown keys and bad values', () => {
    const s = parseSettings([
      { key: 'sale.cashierMayDiscount', value: true },
      { key: 'sale.cashierDiscountLimitBp', value: 1000 },
      { key: 'sale.cashierMayChangePrice', value: 'yes' },
      { key: 'receipt.footer', value: 'شكرًا' },
      { key: 'something.else', value: 1 },
    ]);
    expect(s).toMatchObject({
      cashierMayDiscount: true,
      cashierDiscountLimitBp: 1000,
      cashierMayChangePrice: false,
      footer: 'شكرًا',
    });
  });
});

describe('discountNeedsApproval', () => {
  const gross = 10000;
  it('managers never need approval', () => {
    expect(
      discountNeedsApproval(DEFAULT_SETTINGS, 'manager', { kind: 'percentBp', valueBp: 5000 }, gross),
    ).toBe(false);
  });
  it('a cashier needs approval for any discount when the manager did not allow it', () => {
    expect(
      discountNeedsApproval(DEFAULT_SETTINGS, 'cashier', { kind: 'percentBp', valueBp: 100 }, gross),
    ).toBe(true);
    expect(discountNeedsApproval(DEFAULT_SETTINGS, 'cashier', { kind: 'fixed', value: 1 }, gross)).toBe(true);
  });
  it('no discount never needs approval', () => {
    expect(discountNeedsApproval(DEFAULT_SETTINGS, 'cashier', undefined, gross)).toBe(false);
    expect(discountNeedsApproval(DEFAULT_SETTINGS, 'cashier', { kind: 'fixed', value: 0 }, gross)).toBe(
      false,
    );
  });
  it('when allowed, up to the limit is free and above it needs approval (percent and amount)', () => {
    expect(discountNeedsApproval(allowed, 'cashier', { kind: 'percentBp', valueBp: 500 }, gross)).toBe(false);
    expect(discountNeedsApproval(allowed, 'cashier', { kind: 'percentBp', valueBp: 501 }, gross)).toBe(true);
    expect(discountNeedsApproval(allowed, 'cashier', { kind: 'fixed', value: 500 }, gross)).toBe(false);
    expect(discountNeedsApproval(allowed, 'cashier', { kind: 'fixed', value: 501 }, gross)).toBe(true);
  });
});

describe('priceNeedsApproval', () => {
  it('the list price is always fine', () => {
    expect(priceNeedsApproval(DEFAULT_SETTINGS, 'cashier', 1000, 1000)).toBe(false);
  });
  it('a cashier changing a price needs approval unless the manager allowed it', () => {
    expect(priceNeedsApproval(DEFAULT_SETTINGS, 'cashier', 900, 1000)).toBe(true);
    expect(priceNeedsApproval(allowed, 'cashier', 900, 1000)).toBe(false);
  });
  it('managers never need approval', () => {
    expect(priceNeedsApproval(DEFAULT_SETTINGS, 'manager', 1, 1000)).toBe(false);
  });
});

describe('purchase return period (P1)', () => {
  it('defaults to 30 days, separate from the sales period', () => {
    expect(parseSettings([]).purchaseReturnPeriodDays).toBe(30);
    expect(parseSettings([{ key: 'return.periodDays', value: 7 }]).purchaseReturnPeriodDays).toBe(30);
  });
  it('reads the saved days, 0 included, and ignores nonsense', () => {
    expect(parseSettings([{ key: 'return.purchaseDays', value: 90 }]).purchaseReturnPeriodDays).toBe(90);
    expect(parseSettings([{ key: 'return.purchaseDays', value: 0 }]).purchaseReturnPeriodDays).toBe(0);
    for (const bad of [-1, 1.5, '30', null, 100000])
      expect(parseSettings([{ key: 'return.purchaseDays', value: bad }]).purchaseReturnPeriodDays).toBe(30);
  });
});
