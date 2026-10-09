export type Role = 'cashier' | 'storekeeper' | 'manager';

export const ACTIONS = [
  'sell',
  'holdCart',
  'returnWithInvoice',
  'discountWithinLimit',
  'discountOverLimit',
  'priceOverride',
  'creditOverLimit',
  'noSaleDrawer',
  'seeCost',
  'void',
  'returnWithoutInvoice',
  'cashAdjustment',
  'receivePurchase',
  'stockAdjustment',
  'editProductData',
  'customerReceipt',
  'supplierPayment',
  'expenseOverLimit',
  'editPrices',
  'settings',
  'manageUsers',
] as const;
export type Action = (typeof ACTIONS)[number];

/** `pin` = allowed after a manager enters his PIN on the same device. */
export type Access = 'yes' | 'pin' | 'no';

const cashier: Partial<Record<Action, Access>> = {
  sell: 'yes',
  holdCart: 'yes',
  returnWithInvoice: 'yes',
  discountWithinLimit: 'yes',
  discountOverLimit: 'pin',
  priceOverride: 'pin',
  creditOverLimit: 'pin',
  noSaleDrawer: 'pin',
  customerReceipt: 'yes',
};
const storekeeper: Partial<Record<Action, Access>> = {
  receivePurchase: 'yes',
  stockAdjustment: 'yes',
  editProductData: 'yes',
};

/** One table for UI and server (docs: skill hardware-erp-domain §11). */
export function can(role: Role, action: Action): Access {
  if (role === 'manager') return 'yes';
  return (role === 'cashier' ? cashier : storekeeper)[action] ?? 'no';
}
