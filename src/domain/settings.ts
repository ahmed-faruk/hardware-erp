import type { Role } from './permissions';
import type { Discount } from './totals';
import type { Piasters } from './money';

/** Company settings the cashier screens read (the `settings` table: key -> JSON value, saved by the manager). */
export interface Settings {
  cashierMayDiscount: boolean;
  /** only used when `cashierMayDiscount`: a discount above it needs the manager's PIN */
  cashierDiscountLimitBp: number;
  cashierMayChangePrice: boolean;
  phone: string;
  address: string;
  footer: string;
  /** days after the sale in which a cashier may take a return without the manager */
  returnPeriodDays: number;
}

export const SETTING_KEYS = {
  cashierMayDiscount: 'sale.cashierMayDiscount',
  cashierDiscountLimitBp: 'sale.cashierDiscountLimitBp',
  cashierMayChangePrice: 'sale.cashierMayChangePrice',
  phone: 'receipt.phone',
  address: 'receipt.address',
  footer: 'receipt.footer',
  returnPeriodDays: 'return.periodDays',
} as const satisfies Record<keyof Settings, string>;

/** Safe defaults: the cashier may not discount or change prices until the manager allows it. */
export const DEFAULT_SETTINGS: Settings = {
  cashierMayDiscount: false,
  cashierDiscountLimitBp: 500,
  cashierMayChangePrice: false,
  phone: '',
  address: '',
  footer: '',
  returnPeriodDays: 30,
};

export function parseSettings(rows: { key: string; value: unknown }[]): Settings {
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const bool = (name: keyof Settings): boolean => {
    const v = byKey.get(SETTING_KEYS[name]);
    return typeof v === 'boolean' ? v : (DEFAULT_SETTINGS[name] as boolean);
  };
  const text = (name: keyof Settings): string => {
    const v = byKey.get(SETTING_KEYS[name]);
    return typeof v === 'string' ? v : (DEFAULT_SETTINGS[name] as string);
  };
  const limit = byKey.get(SETTING_KEYS.cashierDiscountLimitBp);
  const days = byKey.get(SETTING_KEYS.returnPeriodDays);
  return {
    cashierMayDiscount: bool('cashierMayDiscount'),
    cashierDiscountLimitBp:
      typeof limit === 'number' && Number.isInteger(limit) && limit >= 0 && limit <= 10000
        ? limit
        : DEFAULT_SETTINGS.cashierDiscountLimitBp,
    cashierMayChangePrice: bool('cashierMayChangePrice'),
    phone: text('phone'),
    address: text('address'),
    footer: text('footer'),
    returnPeriodDays:
      typeof days === 'number' && Number.isInteger(days) && days >= 0 && days <= 3650
        ? days
        : DEFAULT_SETTINGS.returnPeriodDays,
  };
}

/** True when this discount on a line (or on the invoice) needs a manager's PIN. Managers never do; a zero discount never does. */
export function discountNeedsApproval(
  settings: Settings,
  role: Role,
  discount: Discount | undefined,
  gross: Piasters,
): boolean {
  if (role === 'manager' || !discount) return false;
  const amount = discount.kind === 'percentBp' ? discount.valueBp : discount.value;
  if (amount === 0) return false;
  if (!settings.cashierMayDiscount) return true;
  return discount.kind === 'percentBp'
    ? discount.valueBp > settings.cashierDiscountLimitBp
    : discount.value * 10000 > gross * settings.cashierDiscountLimitBp;
}

/** True when selling at `price` instead of the list price needs a manager's PIN. */
export function priceNeedsApproval(
  settings: Settings,
  role: Role,
  price: Piasters,
  listPrice: Piasters,
): boolean {
  if (role === 'manager' || price === listPrice) return false;
  return !settings.cashierMayChangePrice;
}
